import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

// 长按发送键直接重新生成本轮正文：开关在 设置 › 高级（longPressSendRegenerate）。
// 宿主的输入框只用一具最小替身：卡片 [data-composer-card] + 发送键 button[aria-label="发送消息"]。
// 组件按 aria-label 认键，支持正常命中与 disabled 时的坐标回退，所以替身的层级必须和宿主一致。
const COMPOSER = `<div data-composer-card style="position:fixed;left:0;top:0;width:300px;height:80px">
  <button id="send" type="button" aria-label="发送消息" style="position:fixed;left:240px;top:24px;width:32px;height:32px">↑</button></div>`
const SECTION = 'dsh-tavern: long press send key'
const PROPS = `({ sessionId: 'game', useSession: selector => selector({ running: false }),
  useChat: selector => selector({ legacy: { nodes: [{ kind: 'assistant', messageId: 'body-current' }] } }) })`

function fixture({ enabled = true } = {}) {
  const calls = []
  return {
    calls,
    enabled,
    respond(method, args) {
      calls.push({ method, args })
      if (method === 'getTavernSettings') return { settings: { longPressSendRegenerate: enabled, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } } }
      if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
      if (method === 'getCandidatePreferences') return { candidateDismissMode: 'after-fill' }
      if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', canRollback: true } }
      if (method === 'regenBody') return { view: { chatId: 'game', canRollback: true } }
      return undefined
    }
  }
}

async function open(t, backend, { mobile = false } = {}) {
  const opened = await openTavernSettings(t, {
    respond: backend.respond, section: SECTION, renderPropsCode: PROPS,
    browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    contextOptions: mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : undefined
  })
  const { page } = opened
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

async function touchHold(page, center, { duration = 1100, move = null } = {}) {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] })
    if (move) {
      await page.waitForTimeout(120)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + move.x, y: center.y + move.y, id: 1 }] })
      await page.waitForTimeout(duration - 120)
    } else await page.waitForTimeout(duration)
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

test('桌面端长按发送键 2 秒直接重新生成正文，松手的那次点击不发消息', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(2400)
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(regenerations(backend).length, 1)
  // 空意见 = 跳过意见面板的那次重新生成；sessionId 由 rpc 传输层带上。
  assert.equal(regenerations(backend)[0].args.guidance, '')
  assert.deepEqual(regenerations(backend)[0].args, { guidance: '', sessionId: 'game' })
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('桌面端按住不到 2 秒就松开时什么都不做，这一次点击照常发出', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(1800)
  assert.equal(regenerations(backend).length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 1)
})

test('触屏按住 0.7 秒即可重新生成，轻微移动不会取消，也不会触发系统长按菜单', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend, { mobile: true })
  assert.equal(await page.locator('#send').evaluate(button => getComputedStyle(button).touchAction), 'none')
  await page.evaluate(() => {
    window.__contextMenus = 0
    document.getElementById('send').addEventListener('contextmenu', () => { window.__contextMenus += 1 })
  })
  // 真实 touch pointer；总位移约 14px，小于 24px 容差，且 1.1 秒不足桌面端的 2 秒。
  await touchHold(page, center, { move: { x: 12, y: 8 } })
  assert.equal(regenerations(backend).length, 1)
  assert.deepEqual(regenerations(backend)[0].args, { guidance: '', sessionId: 'game' })
  assert.equal(await page.evaluate(() => window.__sends), 0)
  assert.equal(await page.evaluate(() => window.__contextMenus), 0)
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
  await touchHold(page, center, { duration: 1000 })
  assert.equal(regenerations(backend).length, 1)
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('开关关闭（默认）时长按发送键只发送，不会重新生成', async t => {
  const backend = fixture({ enabled: false })
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(2400)
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
  const toggle = page.getByRole('switch', { name: '长按发送键重新生成', exact: true })
  await toggle.waitFor()
  await page.evaluate(() => { window.__settingsChanged = 0; window.addEventListener('dsh-tavern-settings-changed', () => { window.__settingsChanged += 1 }) })
  assert.equal(await toggle.isChecked(), false)
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="长按发送键重新生成"]')?.checked === true)
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { longPressSendRegenerate: true })
  assert.equal(await toggle.isChecked(), true)
})
