// 外置小手机真实浏览器回归：停靠栏无悬浮球打开/收起、v-show 折叠高度归零、
// 多轮 GENERATION_STARTED/ENDED 派发、空 CHAT_CHANGED 隔离及「复位」reload 恢复。
// PLAYWRIGHT_CHROMIUM_EXECUTABLE=... node tests/browser/external-phone-dock-browser-smoke.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { TAVERN_COMPATIBILITY_CAPABILITIES } from '../../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js'
import { projectTavernHostScript } from '../../tavern-plugin/lib/domain/tavern-host-script-projection.js'

let clientSource = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const cssSource = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const jqSource = await readFile(new URL('../../tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js', import.meta.url), 'utf8')
const jqUiSource = await readFile(new URL('../../tavern-plugin/lib/vendor/runtime-assets/jquery-ui/jquery-ui.min.js', import.meta.url), 'utf8')

for (const dep of ['tavernIconDependencies', 'tavernStaticAssetShim', 'tavernHelperScriptDependencies']) {
  clientSource = clientSource.replaceAll('+ ' + dep + '()', "+ ''")
}

const serverStorage = Object.create(null)

const server = createServer(async (req, res) => {
  if (req.url === '/client.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
    res.end(clientSource)
    return
  }
  if (req.url === '/tavern.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
    res.end(cssSource)
    return
  }
  if (req.url === '/api/dsh-tavern/getFrameStorage') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, values: { ...serverStorage } }))
    return
  }
  if (req.url === '/api/dsh-tavern/updateFrameStorage') {
    let body = ''; for await (const chunk of req) body += chunk
    const { ops = [] } = JSON.parse(body || '{}')
    for (const op of ops) {
      if (op.op === 'clear') {
        for (const k of Object.keys(serverStorage)) if (k.startsWith(op.namespace)) delete serverStorage[k]
      } else if (op.op === 'remove') delete serverStorage[op.key]
      else serverStorage[op.key] = op.value
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, applied: ops.length }))
    return
  }
  if (req.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(jqSource)
    return
  }
  if (req.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/jquery-ui/jquery-ui.min.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(jqUiSource)
    return
  }
  if (req.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/zod/') || req.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/yaml/')) {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end('export default {};')
    return
  }
  if (req.url.startsWith('/api/dsh-tavern/vendor/runtime-assets/fontawesome/')) {
    res.writeHead(200, { 'content-type': 'text/css' })
    res.end('/* fa */')
    return
  }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (req.url === '/phone-sim.mjs') {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(projectTavernHostScript(`
      const scriptId = window.getScriptId();
      const hostDoc = window.parent.document;
      const chatIdNow = window.SillyTavern?.getCurrentChatId?.() || '';
      window.parent.__phoneLoads = (window.parent.__phoneLoads || 0) + 1;
      window.parent.__phoneEvents = window.parent.__phoneEvents || [];
      window.parent.__phoneEventsByChat = window.parent.__phoneEventsByChat || {};

      hostDoc.getElementById('improved-phone-shadow-host-' + scriptId)?.remove();

      if (!localStorage.getItem('phone_initialized')) {
        localStorage.setItem('phone_initialized', '1');
        localStorage.setItem('phone_theme', 'pink');
      }
      window.parent.__lastSeenTheme = localStorage.getItem('phone_theme');

      const host = hostDoc.createElement('div');
      host.id = 'improved-phone-shadow-host-' + scriptId;
      const shadow = host.attachShadow({ mode: 'open' });
      const root = hostDoc.createElement('div');
      root.id = 'improved-phone-root-' + scriptId;
      root.setAttribute('script_id', scriptId);
      const wrapper = hostDoc.createElement('div');
      wrapper.className = 'phone-wrapper';
      wrapper.style.width = '340px';
      wrapper.style.height = '600px';
      const closeBtn = hostDoc.createElement('button');
      closeBtn.className = 'phone-close-btn';
      closeBtn.textContent = '×';
      let shown = true;
      function renderShow() {
        wrapper.style.display = shown ? '' : 'none';
      }
      closeBtn.addEventListener('click', () => { shown = false; renderShow(); });
      wrapper.appendChild(closeBtn);
      root.appendChild(wrapper);
      shadow.appendChild(root);
      hostDoc.body.appendChild(host);

      window.replaceScriptButtons([
        { name: '手机', visible: true },
        { name: '复位', visible: true },
        { name: '刷新', visible: true }
      ]);
      window.eventOn(window.getButtonEvent('手机'), () => {
        shown = !shown;
        renderShow();
      });
      window.eventOn(window.getButtonEvent('刷新'), () => {
        window.parent.__phoneEvents.push(['refresh', chatIdNow]);
        const list = window.parent.__phoneEventsByChat[chatIdNow] || (window.parent.__phoneEventsByChat[chatIdNow] = []);
        list.push('refresh');
      });
      window.eventOn(window.getButtonEvent('复位'), () => {
        localStorage.removeItem('phone_theme');
        window.location.reload();
      });
      window.eventOn(window.tavern_events.CHAT_CHANGED, (chatId) => {
        window.parent.__phoneEvents.push(['chat_changed', chatId]);
        if (chatId === '') {
          window.parent.__phoneSpuriousReloads = (window.parent.__phoneSpuriousReloads || 0) + 1;
          window.location.reload();
        }
      });
      window.eventOn(window.tavern_events.GENERATION_STARTED, (type) => {
        window.parent.__phoneEvents.push(['gen_started', type]);
      });
      window.eventOn(window.tavern_events.GENERATION_ENDED, (id) => {
        window.parent.__phoneEvents.push(['gen_ended', id]);
      });
    `))
    return
  }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><link rel="stylesheet" href="/tavern.css"></head><body>
      <div id="dock-slot" style="width:384px" class="dsh-tavern-card-app-slot"></div>
      <div id="dock-pane-menu" hidden><div id="dock-slot-menu" style="width:384px" class="dsh-tavern-card-app-slot"></div></div>
      <div id="dock-pane-story"><div id="dock-slot-story" style="width:384px" class="dsh-tavern-card-app-slot"></div></div>
      <div id="dock-pane-nophone"><div id="dock-slot-nophone" style="width:384px" class="dsh-tavern-card-app-slot"></div></div>
      <script>
        window.__ModuleLoader__ = { load(d) { window.__dshDesc = d; } };
      </script>
      <script src="/client.js"></script>
    </body></html>`)
    return
  }
  res.writeHead(404); res.end()
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})

try {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err.message))
  let releaseHostJQueryUi
  const hostJQueryUiGate = new Promise(resolve => { releaseHostJQueryUi = resolve })
  await page.exposeFunction('releaseHostJQueryUi', releaseHostJQueryUi)
  await page.route('**/jquery-ui/jquery-ui.min.js', async route => {
    await hostJQueryUiGate
    await route.continue()
  })
  await page.goto(`http://127.0.0.1:${port}/`)

  const result = await page.evaluate(async (caps) => {
    const client = window.__dshDesc.factory(() => ({}))
    const disposer = client.installFrameStorageBridge(window)
    await new Promise(r => setTimeout(r, 30))
    const readyChats = []
    const runtime = client.createTavernHelperScriptRuntime({
      window,
      document,
      rpc: () => Promise.resolve({ updated: true, ok: true }),
      onMutation() {},
      reportError(src, err) { window.__runtimeErrors = (window.__runtimeErrors || []).concat([[src, err.message]]) },
      resolveError() {},
      onReady(sessionId) {
        readyChats.push(sessionId)
        return runtime.emit('CHAT_CHANGED', ['chat-real-1'])
      }
    })
    window.__dshTavernTriggerScriptButton = (_sid, scriptId, name) => runtime.triggerButton(scriptId, name)

    const presence = client.createTavernCardAppPresence({ window })
    const slot = document.getElementById('dock-slot')
    const dock = client.createTavernCardAppDock({
      document,
      slot,
      sessionId: 'S1',
      loadIconCss: () => Promise.resolve(''),
      onChange: presence.change
    })

    const makeView = (messages) => ({
      chatId: 'chat-real-1',
      tavernRuntimePolicy: { trustedCardMode: true },
      tavernHelperScripts: [{
        id: 'ext-phone',
        name: '小手机',
        content: `await import('http://127.0.0.1:${location.port}/phone-sim.mjs');`
      }],
      tavernHelper: {
        version: 1,
        stateRevision: messages.length,
        lifecycleRevision: 1,
        compatibilityCapabilities: caps,
        frameStorageScope: { cardPath: '/cards/tianjiang.png' },
        messages: messages.map((m, i) => ({ message_id: i, ...m })),
        turnMessageIds: {},
        chatVariables: {},
        scriptVariables: {}
      }
    })

    const msgs = [{ role: 'assistant', message: '开场白', variables: {} }]
    const helperFrame = () => document.querySelector('iframe[title="人物卡共享脚本沙箱"]')
    runtime.sync('discarded-S1', makeView(msgs))
    const discardedFrame = helperFrame()
    const hostJQueryUi = () => document.querySelector('script[data-dsh-tavern-host-jquery-ui]')
    for (let i = 0; i < 60 && !hostJQueryUi(); i++) await new Promise(r => setTimeout(r, 50))
    if (!hostJQueryUi()) throw new Error('The first iframe did not start the host jQuery UI load')

    runtime.sync('S1', makeView(msgs))
    if (discardedFrame.isConnected) throw new Error('The previous session iframe is still attached')
    const frame = helperFrame()
    for (let i = 0; i < 60 && !frame.contentWindow.__dshTavernHelperReady; i++) await new Promise(r => setTimeout(r, 50))
    await frame.contentWindow.__dshTavernHelperReady
    await window.releaseHostJQueryUi()

    for (let i = 0; i < 60 && !presence.inspect().attached; i++) await new Promise(r => setTimeout(r, 50))
    if (!presence.inspect().attached) throw new Error('The replacement session did not finish loading host jQuery UI')
    const initialPresence = presence.inspect()
    const initialSlotHeight = slot.getBoundingClientRect().height

    const host = document.getElementById('improved-phone-shadow-host-ext-phone')
    host.shadowRoot.querySelector('.phone-close-btn').click()
    await new Promise(r => setTimeout(r, 50))
    const collapsedPresence = presence.inspect()
    const collapsedSlotHeight = slot.getBoundingClientRect().height

    dock.toggle()
    await new Promise(r => setTimeout(r, 80))
    const reopenedPresence = presence.inspect()
    const reopenedSlotHeight = slot.getBoundingClientRect().height

    await runtime.emit('CHAT_CHANGED', [''])
    await runtime.emit('CHAT_CHANGED', ['chat-real-1'])

    msgs.push({ role: 'user', message: '第一句', variables: {} })
    runtime.sync('S1', makeView(msgs))
    msgs.push({ role: 'assistant', message: '第一回 [AutoMessage]', variables: {} })
    runtime.sync('S1', makeView(msgs))
    msgs.push({ role: 'user', message: '第二句', variables: {} })
    runtime.sync('S1', makeView(msgs))
    msgs.push({ role: 'assistant', message: '第二回 [AddFriend]', variables: {} })
    runtime.sync('S1', makeView(msgs))
    await new Promise(r => setTimeout(r, 100))
    const eventsBeforeReset = [...window.__phoneEvents]
    const themeBeforeReset = window.__lastSeenTheme

    await dock.trigger('复位')
    for (let i = 0; i < 60 && window.__phoneLoads < 2; i++) await new Promise(r => setTimeout(r, 50))
    for (let i = 0; i < 60 && !presence.inspect().attached; i++) await new Promise(r => setTimeout(r, 50))
    await new Promise(r => setTimeout(r, 150))

    const out = {
      loads: window.__phoneLoads,
      spuriousReloads: window.__phoneSpuriousReloads || 0,
      runtimeErrors: window.__runtimeErrors || [],
      initialPresence,
      initialSlotHeight,
      collapsedPresence,
      collapsedSlotHeight,
      reopenedPresence,
      reopenedSlotHeight,
      afterResetPresence: presence.inspect(),
      eventsBeforeReset,
      readyChats,
      themeBeforeReset,
      themeAfterReset: window.__lastSeenTheme
    }
    dock.dispose()
    presence.dispose()
    runtime.dispose()

    // Phase 2: 模拟选人台会话 S-menu (keepMounted) -> 点击 ReadStory 创建新会话 S-story -> 再切换到无手机会话 S-nophone
    const runtimes = new Map()
    window.__dshTavernTriggerScriptButton = (sid, scriptId, name) => {
      const target = runtimes.get(sid)
      if (!target) return Promise.reject(new Error('missing runtime: ' + sid))
      return target.triggerButton(scriptId, name)
    }

    const makeSessionView = (chatId, messages) => ({
      chatId,
      tavernRuntimePolicy: { trustedCardMode: true },
      tavernHelperScripts: [{
        id: 'ext-phone',
        name: '小手机',
        content: `await import('http://127.0.0.1:${location.port}/phone-sim.mjs');`
      }],
      tavernHelper: {
        version: 1,
        stateRevision: messages.length,
        lifecycleRevision: 1,
        compatibilityCapabilities: caps,
        frameStorageScope: { cardPath: '/cards/tianjiang.png' },
        messages: messages.map((m, i) => ({ message_id: i, ...m })),
        turnMessageIds: {},
        chatVariables: {},
        scriptVariables: {}
      }
    })

    const createSessionRuntime = () => client.createTavernHelperScriptRuntime({
      window,
      document,
      rpc: () => Promise.resolve({ updated: true, ok: true }),
      onMutation() {},
      reportError(src, err) { window.__runtimeErrors = (window.__runtimeErrors || []).concat([[src, err.message]]) },
      resolveError() {},
      onReady() {}
    })

    // 1) 启动 S-menu（开场选人台）
    window.__dshTavernSelectedSessionId = 'S-menu'
    document.getElementById('dock-pane-menu').hidden = false
    const runtimeMenu = createSessionRuntime()
    runtimes.set('S-menu', runtimeMenu)
    const presenceMenu = client.createTavernCardAppPresence({ window })
    const slotMenu = document.getElementById('dock-slot-menu')
    const dockMenu = client.createTavernCardAppDock({
      document,
      slot: slotMenu,
      sessionId: 'S-menu',
      active: true,
      loadIconCss: () => Promise.resolve(''),
      onChange: presenceMenu.change
    })
    runtimeMenu.sync('S-menu', makeSessionView('chat-menu', [{ role: 'assistant', message: '<character_menu>', variables: {} }]))
    for (let i = 0; i < 60 && !presenceMenu.inspect().attached; i++) await new Promise(r => setTimeout(r, 50))

    // 2) 点击 ReadStory -> S-menu 退入后台（保持 keepMounted），S-story 进入前台
    window.__dshTavernSelectedSessionId = 'S-story'
    runtimeMenu.setForeground(false)
    dockMenu.setActive(false)
    document.getElementById('dock-pane-menu').hidden = true

    const runtimeStory = createSessionRuntime()
    runtimes.set('S-story', runtimeStory)
    const presenceStory = client.createTavernCardAppPresence({ window })
    const slotStory = document.getElementById('dock-slot-story')
    const dockStory = client.createTavernCardAppDock({
      document,
      slot: slotStory,
      sessionId: 'S-story',
      active: true,
      loadIconCss: () => Promise.resolve(''),
      onChange: presenceStory.change
    })
    const storyBeforeSyncPresence = presenceStory.inspect()
    runtimeStory.sync('S-story', makeSessionView('chat-story', [{ role: 'assistant', message: '正式正文第一段', variables: {} }]))
    for (let i = 0; i < 60 && !presenceStory.inspect().attached; i++) await new Promise(r => setTimeout(r, 50))
    const storyAttachedPresence = presenceStory.inspect()
    const storySlotHeight = slotStory.getBoundingClientRect().height

    await dockStory.trigger('刷新')
    await new Promise(r => setTimeout(r, 60))
    dockStory.toggle()
    await new Promise(r => setTimeout(r, 60))
    const storyCollapsedPresence = presenceStory.inspect()
    const storyCollapsedHeight = slotStory.getBoundingClientRect().height
    dockStory.toggle()
    await new Promise(r => setTimeout(r, 80))
    const storyReopenedPresence = presenceStory.inspect()
    const storyReopenedHeight = slotStory.getBoundingClientRect().height

    // 3) 切换到无手机会话 S-nophone（即使 S-story 停放也不得串台领养）
    window.__dshTavernSelectedSessionId = 'S-nophone'
    runtimeStory.setForeground(false)
    dockStory.dispose()
    const presenceNoPhone = client.createTavernCardAppPresence({ window })
    const slotNoPhone = document.getElementById('dock-slot-nophone')
    const dockNoPhone = client.createTavernCardAppDock({
      document,
      slot: slotNoPhone,
      sessionId: 'S-nophone',
      active: true,
      loadIconCss: () => Promise.resolve(''),
      onChange: presenceNoPhone.change
    })
    await new Promise(r => setTimeout(r, 50))
    const noPhonePresence = presenceNoPhone.inspect()

    out.multiSession = {
      storyBeforeSyncPresence,
      storyAttachedPresence,
      storySlotHeight,
      storyCollapsedPresence,
      storyCollapsedHeight,
      storyReopenedPresence,
      storyReopenedHeight,
      storyRefreshes: window.__phoneEventsByChat?.['chat-story'] || [],
      menuRefreshes: window.__phoneEventsByChat?.['chat-menu'] || [],
      noPhonePresence
    }

    dockNoPhone.dispose()
    presenceNoPhone.dispose()
    dockMenu.dispose()
    presenceMenu.dispose()
    presenceStory.dispose()
    runtimeMenu.dispose()
    runtimeStory.dispose()
    if (disposer) await disposer()
    return out
  }, TAVERN_COMPATIBILITY_CAPABILITIES)

  assert.deepEqual(pageErrors, [])
  assert.deepEqual(result.runtimeErrors, [])
  assert.equal(result.spuriousReloads, 0, '空 CHAT_CHANGED 不触发小手机 reload')
  assert.equal(result.loads, 2, '仅初始加载 + 一次显式复位 reload，无重放死循环')
  assert.equal(result.initialPresence.expanded, true)
  assert(result.initialSlotHeight >= 600)
  assert.equal(result.collapsedPresence.expanded, false)
  assert.equal(result.collapsedSlotHeight, 0, '收起手机后停靠栏高度归零')
  assert.equal(result.reopenedPresence.expanded, true)
  assert(result.reopenedSlotHeight >= 600, '无悬浮球时通过脚本按钮重新展开手机')
  assert.equal(result.afterResetPresence.attached, true, '复位 reload 后停靠栏自动重新挂载新宿主')
  assert.deepEqual(result.eventsBeforeReset, [
    ['chat_changed', 'chat-real-1'],
    ['chat_changed', 'chat-real-1'],
    ['gen_started', 'normal'],
    ['gen_ended', 2],
    ['gen_started', 'normal'],
    ['gen_ended', 4]
  ])
  assert.equal(result.themeBeforeReset, 'pink')
  assert.equal(result.themeAfterReset, null, '复位 reload 后 localStorage 已同步清除旧键')
  assert.deepEqual(result.readyChats, ['S1', 'S1'])
  assert.equal(result.multiSession.storyBeforeSyncPresence.visible, false, '新会话挂载初期独立 presence 不串台显示旧状态')
  assert.equal(result.multiSession.storyAttachedPresence.attached, true, 'ReadStory 进入新会话后成功停靠新手机宿主')
  assert.equal(result.multiSession.storyAttachedPresence.expanded, true)
  assert(result.multiSession.storySlotHeight >= 600, 'ReadStory 新会话停靠槽正常展开显示')
  assert.deepEqual(result.multiSession.storyRefreshes, ['refresh'], '新会话点击「刷新」精准派发到新会话脚本')
  assert.deepEqual(result.multiSession.menuRefreshes, [], '新会话点击「刷新」不会误发给后台选人会话')
  assert.equal(result.multiSession.storyCollapsedPresence.expanded, false, '新会话点击「收起手机」正常折叠')
  assert.equal(result.multiSession.storyCollapsedHeight, 0)
  assert.equal(result.multiSession.storyReopenedPresence.expanded, true, '新会话点击「打开手机」正常重新展开')
  assert(result.multiSession.storyReopenedHeight >= 600)
  assert.equal(result.multiSession.noPhonePresence.visible, false, '无手机会话绝不串台领养停放区手机')
  console.log('PASS 外置小手机停靠栏与沙箱重载真实浏览器回归')
} finally {
  await browser.close()
  server.close()
}
