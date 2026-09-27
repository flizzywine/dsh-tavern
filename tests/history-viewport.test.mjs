import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright'
const ordered = (await readFile(new URL('../tavern-plugin/lib/domain/ordered-numeric-index.js', import.meta.url), 'utf8')).replace('export { createOrderedNumericIndex };', '')
const source = await readFile(new URL('../tavern-plugin/src/client/modules/history-viewport.js', import.meta.url), 'utf8')

const dsh = process.env.DSH_BROWSER_ROOT || path.join(homedir(), '.dsh-tavern/runtime/lib/node_modules/@deepseek-ai/dsh')
test('real React loads older pages on upward input without remounting retained frames', { skip: !existsSync(dsh) && 'Set DSH_BROWSER_ROOT for the browser integration test' }, async () => {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const names = ['react', 'scheduler', 'react-dom', 'react-dom/client']
  const files = ['react.production.js', 'scheduler.production.js', 'react-dom.production.js', 'react-dom-client.production.js']
  let bundle = 'const modules={};\n'
  for (let i = 0; i < names.length; i++) {
    const text = await readFile(path.join(path.dirname(require.resolve(names[i])), 'cjs', files[i]), 'utf8')
    bundle += `modules[${JSON.stringify(names[i])}]=(function(){const module={exports:{}},exports=module.exports,require=name=>modules[name];\n${text}\nreturn module.exports;})();\n`
  }
  const retained = await readFile(new URL('../tavern-plugin/src/client/modules/retained-message-frames.js', import.meta.url), 'utf8')
  const retention = await readFile(new URL('../tavern-plugin/src/client/modules/session-resource-retention.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent('<div id="app" data-conversation-scroll style="height:600px;overflow:auto;overflow-anchor:none"></div>')
    await page.addScriptTag({content: bundle + `
      const React=modules.react;
      ${ordered}\n${retention}\n${retained}\n${source}
      const retention=createTavernSessionRetention({window});retention.select('a');
      const tavernRetainedFrames=createRetainedTavernFrames({window,retention,createLifecycle(props){
        const d={token:Math.random().toString(),trustedCardMode:true,html:'<input value="fresh"><script>window.identity=Math.random()</'+'script>',ref(){}};
        return {snapshot(){return {height:160,visibleDocument:d}},start(){return ()=>{}},update(){}};
      }});
      function Body(props){const ref=React.useRef(null);React.useLayoutEffect(()=>{
        const lease=tavernRetainedFrames.mount({sessionId:'a',turn:props.node.location.turn.turn,partIndex:0,frameOwner:props.frameOwner},ref.current);
        return ()=>lease.detach();
      },[]);return React.createElement('div',{ref,style:{height:160}});}
      const root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
      root.render(React.createElement(React.Fragment,null,Array.from({length:133},(_,i)=>React.createElement(TavernWindowedNode,{key:i,sessionId:'a',node:{location:{turn:{turn:i+1}}},bodyComponent:Body}))));
      window.budget=tavernHistoryViewport;
      window.maxFrames=0;new MutationObserver(()=>{maxFrames=Math.max(maxFrames,document.querySelectorAll('iframe').length)}).observe(document.body,{subtree:true,childList:true});
    `})
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 20)
    assert.equal(await page.locator('iframe').count(), 20)
    await page.evaluate(() => { window.saved = document.querySelector('[data-tavern-history-turn="133"] iframe'); saved.contentDocument.querySelector('input').value = 'kept' })
    await page.evaluate(() => { document.querySelector('#app').scrollTop = 0 })
    await page.waitForTimeout(200)
    assert.equal(await page.locator('iframe').count(), 20, 'initial layout must not eagerly load all history')
    const anchor = await page.locator('[data-tavern-history-turn="114"]').boundingBox()
    await page.getByRole('button', {name:'加载更多（20 轮）', exact:true}).hover()
    await page.mouse.wheel(0, -60)
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 40)
    await page.waitForTimeout(100)
    const anchored = await page.locator('[data-tavern-history-turn="114"]').boundingBox()
    assert.ok(Math.abs(anchored.y - anchor.y) < 100, 'loading preserves the visible round position')
    assert.equal(await page.locator('iframe').count(), 40, 'one upward input loads one page, not all history')
    await page.getByRole('button', {name:'加载更多（20 轮）', exact:true}).click()
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 60)
    assert.equal(await page.evaluate(() => saved === document.querySelector('[data-tavern-history-turn="133"] iframe') && saved.contentDocument.querySelector('input').value === 'kept'), true)
    for (let i = 0; i < 4; i++) await page.getByRole('button', {name:'加载更多（20 轮）', exact:true}).click()
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 133)
    assert.equal(await page.getByRole('button', {name:'加载更多（20 轮）', exact:true}).count(), 0)
    assert.deepEqual(errors, [])
    const artifacts = path.resolve('output/e2e-history-paging')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: path.join(artifacts, 'history-loaded.png') })
    await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ status: 'passed', initialRounds: 20, afterUpwardInput: 40, totalRounds: 133, preservedFrameState: true, anchored: true }, null, 2))
  } finally { await browser.close() }
})
