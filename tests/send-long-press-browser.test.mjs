import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

// 长按发送键 1 秒直接重新生成本轮正文：开关在 设置 › 高级（longPressSendRegenerate）。
// 宿主的输入框只用一具最小替身：卡片 [data-composer-card] + 发送键 button[aria-label="发送消息"]。
// 组件按 aria-label 认键，支持正常命中与 disabled 时的坐标回退，所以替身的层级必须和宿主一致。
const COMPOSER = `<div data-composer-card style="position:fixed;left:0;top:0;width:300px;height:80px">
  <button id="send" type="button" aria-label="发送消息" style="position:fixed;left:240px;top:24px;width:32px;height:32px">↑</button></div>`
const SECTION = 'dsh-tavern: long press send key'
const PROPS = `({ sessionId: 'game', useSession: selector => selector({ running: false }),
  useChat: selector => selector({ legacy: { nodes: [{ kind: 'assistant', messageId: 'body-current' }] } }) })`

function fixture({ enabled = true, view = null } = {}) {
  const calls = []
  const sessionView = view || { sessionId: 'game', mode: 'story', canRollback: true }
  return {
    calls,
    enabled,
    respond(method, args) {
      calls.push({ method, args })
      if (method === 'getTavernSettings') return { settings: { longPressSendRegenerate: enabled, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } } }
      if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
      if (method === 'getCandidatePreferences') return { candidateDismissMode: 'after-fill' }
      if (method === 'getSession') return { view: sessionView }
      if (method === 'regenBody') return { view: { chatId: 'game', canRollback: true } }
      return undefined
    }
  }
}

async function open(t, backend, { mobile = false, running = false } = {}) {
  const opened = await openTavernSettings(t, {
    respond: backend.respond, section: SECTION, renderPropsCode: PROPS.replace('running: false', 'running: ' + running),
    browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    contextOptions: mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : undefined
  })
  const { page } = opened
  assert.ok(await page.evaluate(() => window.__tavernTestSlots.includes('conversation.session.header.utilities')),
    '长按监听必须挂在常驻会话层，不能随 input.dock 的条件渲染一起卸载')
  await page.evaluate(source => { document.body.insertAdjacentHTML('beforeend', source) }, COMPOSER)
  await page.evaluate(() => {
    window.__sends = 0
    document.getElementById('send').addEventListener('click', () => { window.__sends += 1 })
  })
  // 开关是异步读取的；ready 也证明后插入的宿主发送键已被 MutationObserver 预处理。
  if (backend.enabled) await page.waitForFunction(() => document.getElementById('send')?.classList.contains('dsh-tavern-send-hold-ready'))
  const box = await page.locator('#send').boundingBox()
  return { page, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
}

async function touchHold(page, center, { duration = 1400, move = null, cancelPointer = false } = {}) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] })
    let elapsed = 0
    if (move || cancelPointer) {
      await page.waitForTimeout(250)
      elapsed = 250
      if (move) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + move.x, y: center.y + move.y, id: 1 }] })
      if (cancelPointer) await page.evaluate(() => {
        // 模拟浏览器把 PointerEvent 交给滚动/系统手势，但原生触摸流仍活着的情况。
        document.dispatchEvent(new PointerEvent('pointercancel', {
          pointerId: window.__lastTouchPointerId, pointerType: 'touch', isPrimary: true, bubbles: true
        }))
      })
    }
    await page.waitForTimeout(duration - elapsed)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
  // 等兼容 click 与 regenBody 的 RPC 都落完。
  await page.waitForTimeout(250)
}

function regenerations(backend) {
  return backend.calls.filter(call => call.method === 'regenBody')
}

// 传输层会往参数里补 _sessionPatchPage、_traceId 等内部字段，断言只看业务参数。
function regenArgs(backend, index = 0) {
  const args = regenerations(backend)[index]?.args || {}
  return Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('_')))
}

test('桌面端长按发送键 1 秒直接重新生成正文，松手的那次点击不发消息', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(1400)
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(regenerations(backend).length, 1)
  // 空意见 = 跳过意见面板的那次重新生成；sessionId 由 rpc 传输层带上。
  assert.equal(regenerations(backend)[0].args.guidance, '')
  assert.deepEqual(regenArgs(backend), { guidance: '', sessionId: 'game' })
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('桌面端按住不到 1 秒就松开时什么都不做，这一次点击照常发出', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(500)
  await page.mouse.up()
  await page.waitForTimeout(1800)
  assert.equal(regenerations(backend).length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 1)
})

test('宿主忙碌与视图可用性快照过期时，完成长按仍进入服务端提交流程', async t => {
  const backend = fixture({ view: { sessionId: 'game', mode: 'story', canRegenerate: false, canRollback: false } })
  const { page, center } = await open(t, backend, { running: true })
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(1400)
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(regenerations(backend).length, 1)
})

test('触屏按住 1 秒稳定重新生成，轻微移动不会取消', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  assert.equal(await page.locator('#send').evaluate(button => getComputedStyle(button).touchAction), 'none')
  // 真实 touch 事件流；总位移约 14px，小于 24px 容差。
  await touchHold(page, center, { move: { x: 12, y: 8 } })
  assert.equal(regenerations(backend).length, 1)
  assert.deepEqual(regenArgs(backend), { guidance: '', sessionId: 'game' })
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('触屏按住期间即使 pointercancel 被触发，1 秒后仍只重新生成一次', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  await page.evaluate(() => {
    window.__touchStarts = 0
    window.__lastTouchPointerId = null
    window.addEventListener('touchstart', () => { window.__touchStarts += 1 }, { passive: true })
    window.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') window.__lastTouchPointerId = event.pointerId
    }, { passive: true })
  })
  await touchHold(page, center, { cancelPointer: true })
  assert.equal(await page.evaluate(() => window.__touchStarts), 1)
  assert.equal(regenerations(backend).length, 1)
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('动画照常但 1 秒 JS 计时器被节流时，松手按实际时长补触发', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  await page.evaluate(() => {
    window.__nativeSetTimeout = window.setTimeout.bind(window)
    window.__nativeClearTimeout = window.clearTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) => delay === 1000 ? -777 : window.__nativeSetTimeout(callback, delay, ...args)
    window.clearTimeout = id => { if (id !== -777) window.__nativeClearTimeout(id) }
  })
  try {
    await touchHold(page, center, { duration: 1200 })
  } finally {
    await page.evaluate(() => {
      window.setTimeout = window.__nativeSetTimeout
      window.clearTimeout = window.__nativeClearTimeout
    })
  }
  assert.equal(regenerations(backend).length, 1)
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('原生 touchcancel 才表示本次触摸结束，不会迟发重新生成', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] })
    await page.waitForTimeout(300)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
  await page.waitForTimeout(1200)
  assert.equal(regenerations(backend).length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('触屏短点仍只发送，不会重新生成', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  await touchHold(page, center, { duration: 300 })
  assert.equal(regenerations(backend).length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 1)
})

test('触屏发送键禁用且命中测试跳过按钮时，仍能按坐标长按重新生成', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  await page.evaluate(() => {
    document.getElementById('send').disabled = true
    // 模拟部分移动浏览器对 disabled 控件的命中行为：只能命中外层 composer。
    document.elementFromPoint = () => document.querySelector('[data-composer-card]')
  })
  await touchHold(page, center)
  assert.equal(regenerations(backend).length, 1)
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('开关关闭（默认）时长按发送键只发送，不会重新生成', async t => {
  const backend = fixture({ enabled: false })
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(1400)
  await page.mouse.up()
  assert.equal(regenerations(backend).length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 1)
})

test('设置 › 高级 里的开关保存 longPressSendRegenerate 并广播给现有对话', async t => {
  let settings = { defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }
  const calls = []
  const { page } = await openTavernSettings(t, {
    section: 'dsh-tavern: settings section',
    browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    respond(method, args) {
      calls.push({ method, args })
      if (method === 'getTavernSettings') return { settings, modelCatalog: [] }
      if (method === 'updateTavernSettings') { settings = { ...settings, ...args.patch }; return { settings } }
      if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [] } }
      return undefined
    }
  })
  const toggle = page.getByRole('switch', { name: '长按 1 秒发送键重新生成', exact: true })
  await toggle.waitFor()
  await page.evaluate(() => { window.__settingsChanged = 0; window.addEventListener('dsh-tavern-settings-changed', () => { window.__settingsChanged += 1 }) })
  assert.equal(await toggle.isChecked(), false)
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="长按 1 秒发送键重新生成"]')?.checked === true)
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { longPressSendRegenerate: true })
  assert.equal(await toggle.isChecked(), true)
})
