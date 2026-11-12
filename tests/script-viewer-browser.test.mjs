import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { readTavernRuntimeAsset } from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

// Like cards with an external equipment/quest panel, the status iframe calls
// a companion script that mounts its UI in the host document.
const companion = `
  const panel=parent.document.createElement('section');panel.id='card-panel';panel.hidden=true;
  panel.innerHTML='<output></output><button>Use item</button>';parent.document.body.append(panel);
  window.openCardPanel=tab=>{panel.hidden=false;panel.dataset.tab=tab;panel.querySelector('output').textContent=String(Mvu.getMvuData({type:'message',message_id:'latest'}).stat_data.hp)};
  panel.querySelector('button').onclick=async()=>{
    const data=Mvu.getMvuData({type:'message',message_id:'latest'});data.stat_data.hp--;
    await Mvu.replaceMvuData(data,{type:'message',message_id:'latest'});panel.dataset.saved='yes';
  };
  eventOn('CHAT_CHANGED',()=>{parent.initializations=(parent.initializations||0)+1});
  eventOn('MESSAGE_RECEIVED',()=>{parent.settlements=(parent.settlements||0)+1});
  eventOn('mag_variable_update_ended',()=>{parent.derivedUpdates=(parent.derivedUpdates||0)+1});
  eventOn('character_message_rendered',id=>{
    const layers=window.retrieveDisplayedMessage(id);
    if(layers&&layers[0])layers[0].innerHTML='<div class="decorated-bubble">rendered-'+id+'</div>';
  });
`
const status = `<button data-tab="equipment">Equipment</button><button data-tab="quests">Quests</button><script>
  document.addEventListener('click',event=>{
    const tab=event.target.dataset.tab;if(!tab)return;
    parent.statusClicks=(parent.statusClicks||0)+1;
    for(const frame of parent.document.querySelectorAll('iframe')){
      if(typeof frame.contentWindow.openCardPanel==='function')frame.contentWindow.openCardPanel(tab);
    }
  });
</script>`
const context = revision => ({ stateRevision: revision, lifecycleRevision: 1, chatId: 'chat',
  messages: [{ message_id: 0, role: 'assistant', message: 'opening', variables: { stat_data: { hp: revision }, schema: {} } }] })
const view = (revision, official = true) => ({ chatId: 'chat', card: { name: 'Fixture' },
  tavernRuntimePolicy: { trustedCardMode: true }, tavernHelper: context(revision),
  tavernMvuRuntime: official ? { owner: 'official', assetUrl: '/core.js' } : null,
  tavernHelperScripts: [{ id: 'companion', name: 'Panel', content: companion }] })

test('second HTTP touch browser opens local panels, mirrors variables and leaves settlement with its owner', { timeout: 30000 }, async t => {
  const dispatch = createTavernScriptDispatch()
  const calls = []
  const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const runner = `window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}))}};\n${client}\n
    window.view=${JSON.stringify(view(10))};
    client.mountTavernScriptLayer({native:document.querySelector('#native-msg'),layer:document.querySelector('#script-layer'),sessionId:'session',messageId:0});
    window.owner=client.createTavernScriptExecutionModule({window,rpc:serverRpc,signals:{subscribe(){return ()=>{}}},invalidate(){}});
    document.querySelector('#status').srcdoc=client.buildTavernFrameDocument({token:'status',helperContext:view.tavernHelper,trustedCardMode:true,persistent:true,content:${JSON.stringify(status)}});
    setTimeout(()=>owner.sync('session',view),150);`
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://fixture').pathname
      const asset = await readTavernRuntimeAsset(pathname)
      if (asset) { res.setHeader('content-type', asset.mediaType); res.end(asset.body); return }
      if (pathname === '/runner.js') { res.setHeader('content-type', 'text/javascript'); res.end(runner); return }
      if (pathname === '/core.js') {
        res.setHeader('content-type', 'text/javascript')
        res.end(`parent.coreStarts=(parent.coreStarts||0)+1;const {__dshBootstrap,...api}=window.Mvu;window.initializeGlobal('Mvu',api);`)
        return
      }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="native-msg"><p>raw</p></div><div id="script-layer" data-dsh-script-layer data-session="session" data-mesid="0"></div><iframe id="status" style="width:100%;height:150px"></iframe><script src="/runner.js"></script>')
    } catch (error) { res.statusCode = 500; res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const url = 'http://127.0.0.1:' + server.address().port
  async function open(mobile) {
    const page = await browser.newPage({ viewport: { width: mobile ? 412 : 1280, height: 900 }, isMobile: mobile, hasTouch: mobile })
    page.setDefaultTimeout(5000)
    await page.exposeFunction('serverRpc', (method, args, sessionId) => {
      calls.push({ mobile, method, args })
      if (method === 'claimTavernScriptWork') return dispatch.claim(sessionId, args.runtimeId, args.ready)
      if (method === 'startTavernScriptWork') return dispatch.start(sessionId, args.eventId, args.leaseToken, args.runtimeId)
      if (method === 'completeTavernHelperEvent') return { completed: dispatch.complete(sessionId, args.eventId, args.args, args.runtimeId, args.leaseToken) }
      if (method === 'releaseTavernHelperRuntime') return dispatch.dispose(sessionId, args.runtimeId)
      return { updated: true }
    })
    // A plain HTTP LAN origin has neither secure-context guarantees nor shared
    // window globals with the desktop browser.
    await page.route('http://tavern-lan.test/**', async route => {
      const target = new URL(route.request().url())
      const response = await route.fetch({ url: url + target.pathname })
      await route.fulfill({ response })
    })
    await page.goto(mobile ? 'http://tavern-lan.test/' : url)
    await page.locator('#card-panel').waitFor({ state: 'attached' })
    return page
  }
  const desktop = await open(false)
  await desktop.waitForFunction(() => initializations === 1)
  await desktop.waitForFunction(() => document.querySelector('#script-layer .decorated-bubble')?.textContent === 'rendered-0')
  assert.equal(await desktop.evaluate(() => document.querySelector('#native-msg').hidden), true)
  assert.equal(await desktop.evaluate(() => document.querySelector('#script-layer').hidden), false)
  const phone = await open(true)
  assert.equal(await phone.evaluate(() => isSecureContext), false)
  assert.equal(await phone.evaluate(() => owner.inspect().active), false)
  assert.equal(await phone.evaluate(() => window.coreStarts || 0), 0)
  assert.equal(await phone.evaluate(() => window.initializations || 0), 0)
  for (const tab of ['equipment', 'quests']) {
    await phone.frameLocator('#status').locator(`[data-tab="${tab}"]`).tap()
    assert.equal(await phone.locator('#card-panel').isVisible(), true)
    assert.equal(await phone.locator('#card-panel').getAttribute('data-tab'), tab)
  }
  assert.equal(await phone.evaluate(() => statusClicks), 2)
  assert.equal(await phone.locator('#card-panel output').textContent(), '10')
  // Viewer context changes do not synthesize legacy settlement callbacks.
  await phone.evaluate(next => { window.view=next;owner.sync('session',view) }, view(20, false))
  await phone.frameLocator('#status').locator('[data-tab="equipment"]').tap()
  assert.equal(await phone.locator('#card-panel output').textContent(), '20')
  assert.equal(await phone.evaluate(() => window.derivedUpdates || 0), 0)
  await phone.locator('#card-panel button').tap()
  await phone.waitForFunction(() => document.querySelector('#card-panel').dataset.saved === 'yes')
  assert.equal(calls.filter(call => call.mobile && call.method === 'updateTavernHelperVariables').length, 1, 'explicit panel edits still use the persistence bridge')

  const completion = dispatch.dispatch('session', 'MESSAGE_RECEIVED', [0], context(20))
  await Promise.all([desktop.evaluate(() => owner.sync('session',view)), phone.evaluate(() => owner.sync('session',view))])
  await completion
  assert.equal(await desktop.evaluate(() => window.settlements || 0), 1)
  assert.equal(await phone.evaluate(() => window.settlements || 0), 0)
  assert.equal(calls.filter(call => call.mobile && call.method === 'startTavernScriptWork').length, 0)

  await desktop.evaluate(() => owner.dispose())
  await desktop.waitForFunction(() => !document.querySelector('#card-panel'))
  await phone.evaluate(next => { window.view=next;owner.sync('session',view) }, view(20))
  await phone.waitForFunction(() => owner.inspect().active && window.initializations === 1)
  assert.equal(await phone.evaluate(() => coreStarts), 1)
  assert.equal(await phone.locator('#card-panel').count(), 1, 'promotion replaces the viewer sandbox and removes its old panel')
  await phone.frameLocator('#status').locator('[data-tab="quests"]').tap()
  assert.equal(await phone.locator('#card-panel').getAttribute('data-tab'), 'quests')
  await phone.evaluate(() => owner.dispose())
  assert.equal(await phone.locator('#card-panel').count(), 0)
})
