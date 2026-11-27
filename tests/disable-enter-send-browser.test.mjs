import test from './helpers/parallel-test.mjs'
import assert from 'node:assert/strict'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

// 设置 › 高级 › 关闭回车键发送消息（disableEnterSend，默认关闭）。
const COMPOSER = `
<div data-composer-card>
  <div id="lexical" data-composer-input contenteditable="true" role="textbox" aria-multiline="true">hello</div>
  <textarea id="area">hello</textarea>
  <button id="send" type="button" aria-label="发送消息">↑</button>
</div>
<textarea id="outside">outside</textarea>`

test('disableEnterSend 默认关闭，支持布尔值读写并拒绝非布尔值', () => {
  assert.equal(presentTavernSettings({}, {}).disableEnterSend, false)
  const enabled = applyTavernSettingsPatch({ other: 'keep' }, { disableEnterSend: true })
  assert.equal(enabled.disableEnterSend, true)
  assert.equal(enabled.other, 'keep')
  assert.equal(presentTavernSettings(enabled, {}).disableEnterSend, true)
  assert.equal(presentTavernSettings(applyTavernSettingsPatch(enabled, { disableEnterSend: false }), {}).disableEnterSend, false)
  for (const value of ['true', 1, null, {}]) {
    assert.throws(() => applyTavernSettingsPatch(enabled, { disableEnterSend: value }), /关闭回车键发送消息设置必须是布尔值/)
    assert.equal(presentTavernSettings({ disableEnterSend: value }, {}).disableEnterSend, false)
  }
})

async function openComposer(t, { enabled = false } = {}) {
  let settings = { disableEnterSend: enabled, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }
  const calls = []
  const opened = await openTavernSettings(t, {
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
  const { page } = opened
  await page.evaluate(source => {
    document.body.insertAdjacentHTML('beforeend', source)
    window.__hostKeydowns = []
    window.__beforeInputs = []
    for (const id of ['lexical', 'area', 'send', 'outside']) {
      const el = document.getElementById(id)
      el.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return
        window.__hostKeydowns.push({
          id,
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          keyCode: event.keyCode
        })
      })
      el.addEventListener('beforeinput', event => {
        window.__beforeInputs.push({ id, inputType: event.inputType })
      })
    }
  }, COMPOSER)
  // 等设置加载完成后再做键盘测试。
  await page.getByRole('switch', { name: '关闭回车键发送消息', exact: true }).waitFor()
  return { page, calls, setEnabled: value => { settings = { ...settings, disableEnterSend: value } } }
}

test('设置 › 高级 里的开关默认关闭，切换后保存 disableEnterSend 并实时生效', async t => {
  const { page, calls } = await openComposer(t, { enabled: false })
  const toggle = page.getByRole('switch', { name: '关闭回车键发送消息', exact: true })
  assert.equal(await toggle.isChecked(), false)

  // 默认关闭时，在输入框按回车会到达宿主 keydown。
  await page.locator('#lexical').click()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'lexical').length), 1)

  // 打开开关后保存并广播，无需刷新即可拦截普通回车。
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="关闭回车键发送消息"]')?.checked === true)
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { disableEnterSend: true })

  // 等异步 refreshTavernDisableEnterSend 落完。
  await page.waitForTimeout(100)
  await page.evaluate(() => { window.__hostKeydowns = []; window.__beforeInputs = [] })
  await page.locator('#lexical').click()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'lexical').length), 0)
  // 未阻止默认行为，浏览器仍派发 beforeinput（Lexical 据此插入换行）。
  assert.ok(await page.evaluate(() => window.__beforeInputs.some(e => e.id === 'lexical' && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak'))))
})

test('开启后 textarea 回车只插入换行不触发宿主发送，组合键/菜单/按钮/外部输入框不受影响', async t => {
  const { page } = await openComposer(t, { enabled: true })
  await page.waitForTimeout(100)

  // 1. textarea 按纯 Enter：不触发宿主 keydown，实际插入换行符。
  const area = page.locator('#area')
  await area.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'area').length), 0)
  assert.equal(await area.inputValue(), 'hello\n')

  // 2. Ctrl+Enter / Shift+Enter 仍到达宿主。
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Shift+Enter')
  const areaEvents = await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'area'))
  assert.equal(areaEvents.length, 2)
  assert.equal(areaEvents[0].ctrlKey, true)
  assert.equal(areaEvents[1].shiftKey, true)

  // 3. IME 合成中（keyCode === 229）放行。
  await page.evaluate(() => {
    window.__hostKeydowns = []
    document.getElementById('lexical').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', keyCode: 229, bubbles: true, cancelable: true
    }))
  })
  assert.equal(await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'lexical').length), 1)

  // 4. 斜杠/引用补全菜单（role="listbox"）打开时放行。
  await page.evaluate(() => {
    window.__hostKeydowns = []
    const menu = document.createElement('div')
    menu.setAttribute('role', 'listbox')
    document.querySelector('[data-composer-card]').appendChild(menu)
  })
  await page.locator('#lexical').click()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__hostKeydowns.filter(e => e.id === 'lexical').length), 1)
  await page.evaluate(() => { document.querySelector('[data-composer-card] [role="listbox"]')?.remove() })

  // 5. 聚焦在发送按钮上的回车、以及输入框外的普通 textarea 不受影响。
  await page.evaluate(() => { window.__hostKeydowns = [] })
  await page.locator('#send').focus()
  await page.keyboard.press('Enter')
  await page.locator('#outside').click()
  await page.keyboard.press('Enter')
  const rest = await page.evaluate(() => window.__hostKeydowns.map(e => e.id))
  assert.deepEqual(rest, ['send', 'outside'])
})
