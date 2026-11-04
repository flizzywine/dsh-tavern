import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

test('retired native rows cannot advance the game; concurrent surfaces share one action', { skip: !process.env.TAVERN_BROWSER_CHANNEL }, async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/reply-observer.js', import.meta.url), 'utf8')
  const surface = source.slice(source.indexOf('function TavernGameModeSurface('), source.indexOf('function TavernComposerSlot('))
  const require = createRequire(import.meta.url)
  let bundle = 'const modules = {};'
  for (const [name, file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) {
    bundle += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=n=>modules[n];${await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')};return module.exports;})();`
  }
  const browser = await chromium.launch({ channel: process.env.TAVERN_BROWSER_CHANNEL, headless: true })
  try {
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.route('http://127.0.0.1/game-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }))
    await page.goto('http://127.0.0.1/game-test')
    await page.addScriptTag({ content: bundle + `
      const React=modules.react, ReactDOM=modules['react-dom'];
      const useTavernUiExtensions=()=>0, tavernSessionSignals={subscribe:()=>()=>{}};
      const tavernPluginBoundary=()=>p=>p.children;
      const tavernUiExtensions={gameModeView:()=>({owner:'test',render:p=>{
        React.useEffect(()=>{p.advance(null)},[]); return React.createElement('span',null,'active game');
      }})};
      window.calls=0; window.views=0;
      const rpc=async (_,args)=>{
        if(args.op==='view'){window.views++;return {mode:{key:'test',revision:1,cursor:0,length:1,foreground:true,foregroundMessageId:'current',data:{}}};}
        window.calls++; return new Promise(()=>{});
      };
      ${surface}
      modules['react-dom/client'].createRoot(document.getElementById('app')).render(React.createElement(React.Fragment,null,
        ...['retired','current','current'].map((id,i)=>React.createElement(TavernGameModeSurface,{key:i,sessionId:'game',foreground:true,messageId:id}))));
    ` })
    await page.waitForFunction(() => window.views === 3 && window.calls > 0)
    assert.equal(await page.getByText('active game', { exact: true }).count(), 2, 'retired row must not mount the game controller')
    assert.equal(await page.evaluate(() => window.calls), 1, 'only one concurrent advance may reach RPC')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
