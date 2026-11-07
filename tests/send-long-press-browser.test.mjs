import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

// 长按发送键 2 秒直接重新生成本轮正文：开关在 设置 › 高级（longPressSendRegenerate）。
// 宿主的输入框只用一具最小替身：卡片 [data-composer-card] + 发送键 button[aria-label="发送消息"]。
// 组件按 aria-label 认键、按坐标命中（发送键禁用时也能长按），所以替身的层级必须和宿主一致。
const COMPOSER = `<div data-composer-card style="position:fixed;left:0;top:0;width:300px;height:80px">
  <button id="send" type="button" aria-label="发送消息" style="position:fixed;left:240px;top:24px;width:32px;height:32px">↑</button></div>`
const SECTION = 'dsh-tavern: long press send key'
const PROPS = `({ sessionId: 'game', useSession: selector => selector({ running: false }),
  useChat: selector => selector({ legacy: { nodes: [{ kind: 'assistant', messageId: 'body-current' }] } }) })`

function fixture({ enabled = true } = {}) {
  const calls = []
  return {
    calls,
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

async function open(t, backend) {
  const opened = await openTavernSettings(t, {
    respond: backend.respond, section: SECTION, renderPropsCode: PROPS,
    browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH
  })
  const { page } = opened
  await page.evaluate(source => { document.body.insertAdjacentHTML('beforeend', source) }, COMPOSER)
  await page.evaluate(() => {
    window.__sends = 0
    document.getElementById('send').addEventListener('click', () => { window.__sends += 1 })
  })
  const box = await page.locator('#send').boundingBox()
  return { page, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
}

test('开启后长按发送键 2 秒直接重新生成正文，松手的那次点击不发消息', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(2400)
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.equal(backend.calls.filter(call => call.method === 'regenBody').length, 1)
  // 空意见 = 跳过意见面板的那次重新生成；sessionId 由 rpc 传输层带上。
  assert.equal(backend.calls.filter(call => call.method === 'regenBody')[0].args.guidance, '')
  // 新契约：长按只发 guidance（sessionId 由 rpc 传输层带上），正文 ID 由服务端按完整消息历史定位。
  assert.deepEqual(backend.calls.filter(call => call.method === 'regenBody')[0].args, { guidance: '', sessionId: 'game' })
  assert.equal(await page.evaluate(() => window.__sends), 0)
})

test('按住不到 2 秒就松开时什么都不做，这一次点击照常发出', async t => {
  const backend = fixture()
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(1800)
  assert.equal(backend.calls.filter(call => call.method === 'regenBody').length, 0)
  assert.equal(await page.evaluate(() => window.__sends), 1)
})

test('开关关闭（默认）时长按发送键只发送，不会重新生成', async t => {
  const backend = fixture({ enabled: false })
  const { page, center } = await open(t, backend)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(2400)
  await page.mouse.up()
  assert.equal(backend.calls.filter(call => call.method === 'regenBody').length, 0)
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
  const toggle = page.getByRole('switch', { name: '长按 2 秒发送键重新生成', exact: true })
  await toggle.waitFor()
  await page.evaluate(() => { window.__settingsChanged = 0; window.addEventListener('dsh-tavern-settings-changed', () => { window.__settingsChanged += 1 }) })
  assert.equal(await toggle.isChecked(), false)
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="长按 2 秒发送键重新生成"]')?.checked === true)
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { longPressSendRegenerate: true })
  assert.equal(await toggle.isChecked(), true)
})
