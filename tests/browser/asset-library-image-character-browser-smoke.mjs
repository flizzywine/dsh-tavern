// Real React batching and unmounts, with only RPC and shared field widgets substituted.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const root = new URL('../../', import.meta.url)
const source = await readFile(new URL('tavern-plugin/src/client/asset-pack-image-character.js', root), 'utf8')
const ui = await readFile(new URL('tavern-plugin/src/client/asset-pack-ui.js', root), 'utf8')
const hooks = ui.slice(ui.indexOf('  function useTask('), ui.indexOf('  // dialogs and floating menus'))
const executablePath = [process.env.DSH_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path)) || chromium.executablePath()
const browser = await chromium.launch({ headless: true, executablePath })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    const React=modules.react, errorText=e=>e?.message||String(e), h=React.createElement;
    const Button=p=>h('button',p), Help=()=>null, Loading=()=>h('p',null,'加载中'),
      HintLine=p=>h('p',null,p.text), InlineGrid=p=>h('div',null,p.children);
    window.fields={};
    const InlineField=p=>{window.fields[p.controlLabel||p.label]=p.onCommit;return h('label',null,p.controlLabel||p.label,h('input',{value:p.value||'',disabled:p.disabled,readOnly:true}));};
    ${hooks}
    ${source}
    window.records=Object.fromEntries(['a','b'].map(id=>[id,{id,name:'人物'+id,figureId:id,figurePackId:'pack',match:'',traits:{face:'外貌'+id},outfits:[]}]));
    window.calls=[];window.hold=false;window.pending=null;
    const binding={rpc:async(method,args)=>{
      window.calls.push({method,args:structuredClone(args)});
      if(method==='getFigureImageCharacter')return {status:'linked',providerId:'images/definitions',character:structuredClone(window.records[args.figureId])};
      if(method==='patchImageCharacter'){
        if(window.hold)await new Promise(resolve=>{window.pending=resolve;});
        const before=window.records[args.figureId];
        if(JSON.stringify(before)!==JSON.stringify(args.expected))throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'});
        const next={...before,...args.patch};window.records[args.figureId]=next;
        return {providerId:'images/definitions',character:structuredClone(next)};
      }
      throw new Error('unexpected RPC '+method);
    }};
    const root=modules['react-dom/client'].createRoot(document.querySelector('#root'));
    window.show=id=>modules['react-dom'].flushSync(()=>root.render(h(ImageCharacterSection,{key:id,binding,pack:{manifest:{id:'pack'}},figure:{id,name:'人物'+id,outfits:[]},outfit:null})));
    window.show('a');
  ` })
  await page.waitForFunction(() => !!window.fields['人物库名字'])
  await page.evaluate(async () => {
    const name = window.fields['人物库名字'], alias = window.fields['人物库别名']
    await Promise.all([name('连续修改名字'), alias('连续修改别名')])
  })
  const writes = await page.evaluate(() => window.calls.filter(c => c.method === 'patchImageCharacter'))
  assert.equal(writes.length, 2)
  assert.equal(writes[1].args.expected.name, '连续修改名字')
  assert.equal(writes[1].args.providerId, 'images/definitions')
  assert.equal(writes[1].args.packId, 'pack')

  // An external edit invalidates this snapshot. Reload it and cancel the remaining queued edit.
  await page.evaluate(async () => {
    window.records.a = { ...window.records.a, name: '别处刚修改' }
    const name = window.fields['人物库名字'], alias = window.fields['人物库别名']
    await Promise.all([name('旧草稿'), alias('不应自动重放')])
  })
  assert.equal(await page.evaluate(() => window.records.a.name), '别处刚修改')
  assert.equal(await page.evaluate(() => window.records.a.match), '连续修改别名')
  assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'patchImageCharacter').length), 3)
  await page.getByRole('alert').filter({ hasText: '已重新载入' }).waitFor()

  // Switch figures during a delayed write. Its response and queued edits belong to the old figure.
  await page.evaluate(() => {
    window.hold = true
    const name = window.fields['人物库名字'], alias = window.fields['人物库别名']
    window.edits = Promise.all([name('旧人物写入中'), alias('旧人物排队中')])
  })
  await page.waitForFunction(() => !!window.pending)
  await page.evaluate(() => { window.show('b'); window.hold = false; window.pending() })
  await page.evaluate(() => window.edits)
  await page.waitForFunction(() => document.querySelector('input')?.value === '人物b')
  assert.equal(await page.evaluate(() => window.records.b.name), '人物b')
  assert.equal(await page.evaluate(() => window.records.a.match), '连续修改别名')
  assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'patchImageCharacter').length), 4)
  assert.deepEqual(errors, [])
  console.log('PASS real React: sequential snapshot chaining, conflict reload, queued-edit cancellation and figure-switch isolation')
} finally { await browser.close() }
