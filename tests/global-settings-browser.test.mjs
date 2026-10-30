import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

function fixture() {
  let fail = false
  let settings = { defaultForegroundModel: null, defaultBackgroundModel: null,
    defaultPlaySettings: { playerName: '你', statusBarPlacement: 'sidebar', backgroundTasks: { variables: true, posture: true }, webSearchEnabled: false } }
  return {
    setFail(value) { fail = value },
    respond(method, args) {
      if (method === 'getTavernSettings') return { settings, modelCatalog: [{ provider: 'p', models: [{ id: 'm' }] }], releaseCapabilities: {} }
      if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }
      if (method === 'updateTavernSettings') {
        if (fail) throw Error('保存失败测试')
        const defaults = args.patch.defaultPlaySettings
        settings = { ...settings, ...args.patch, defaultPlaySettings: { ...settings.defaultPlaySettings, ...defaults,
          backgroundTasks: { ...settings.defaultPlaySettings.backgroundTasks, ...defaults?.backgroundTasks } } }
        return { settings }
      }
    }
  }
}

test('状态栏位置是全局显示偏好，保存后通知现有对局刷新', async t => {
  const backend = fixture()
  const { page, calls } = await openTavernSettings(t, { respond: backend.respond })
  // The shared inline menu (InlineField kind "menu"): a trigger named 「title：current」 and a popup of menuitemradio options.
  const trigger = page.locator('button[aria-label^="状态栏位置（所有对局）："]')
  await page.waitForFunction(() => document.querySelector('button[aria-label^="状态栏位置（所有对局）："]')?.disabled === false)
  await page.evaluate(() => { window.__statusSettingsChanged = 0; window.addEventListener('dsh-tavern-settings-changed', () => window.__statusSettingsChanged++); })
  await trigger.click()
  await page.getByRole('menuitemradio', { name: '正文下方' }).click()
  await page.getByText('已保存，所有对局使用此状态栏位置。', { exact: true }).waitFor()
  assert.equal(await trigger.getAttribute('aria-label'), '状态栏位置（所有对局）：正文下方')
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { defaultPlaySettings: { statusBarPlacement: 'body' } })
  assert.equal(await page.evaluate(() => window.__statusSettingsChanged), 1)
})

test('皮肤：配色与 CSS 皮肤在同一排，一次只选一套', async t => {
  let index = { active: null, skins: [{ id: 'builtin:paper', name: '纸感', builtin: true }] }, css = ''
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: interface skin settings',
    // The bundled dream-skin's API, as its patched client exposes it.
    beforeRender: () => {
      let current = 'tavern-terracotta'
      const listeners = new Set()
      window.dshDreamSkin = { skins: () => [{ id: 'tavern-terracotta', label: '酒馆 · 暖陶土', tokens: {} }, { id: 'abyss', label: '沉静蓝', tokens: {} }],
        defaultLabel: () => '默认', current: () => current, onChange: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        setSkin: id => { current = id; window.__dreamSet = id; listeners.forEach(listener => listener()) },
        Swatch: () => null, DefaultSwatch: () => null, styles: {} }
    },
    respond(method, args) {
      if (method === 'listInterfaceSkins') return index
      if (method === 'getActiveInterfaceSkin') return { id: index.active, css: index.active === 'builtin:paper' ? 'paper-css' : index.active ? css : '' }
      if (method === 'importInterfaceSkin') { css = args.css; index = { active: 'aaaaaaaaaaaa', skins: [...index.skins, { id: 'aaaaaaaaaaaa', name: args.name.replace(/\.css$/, '') }] }; return index }
      if (method === 'selectInterfaceSkin') { index = { ...index, active: args.id }; return index }
    } })
  const pressed = () => page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].map(button => button.textContent))
  await page.getByRole('button', { name: '纸感', exact: true }).waitFor()
  assert.deepEqual(await pressed(), ['酒馆 · 暖陶土'])
  await page.locator('input[type=file][accept^=".css"]').setInputFiles({ name: '我的.css', mimeType: 'text/css', buffer: Buffer.from('body { color: rgb(1, 2, 3) }') })
  await page.getByText('已导入并启用', { exact: true }).waitFor()
  assert.deepEqual(calls.find(call => call.method === 'importInterfaceSkin').args, { name: '我的.css', css: 'body { color: rgb(1, 2, 3) }' })
  assert.deepEqual(await pressed(), ['我的'])
  await page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(1, 2, 3)')
  await page.getByRole('button', { name: '沉静蓝', exact: true }).click()
  await page.waitForFunction(() => window.__dreamSet === 'abyss')
  await page.waitForFunction(() => !document.querySelector('style[data-plugin-css="dsh-tavern-plugin/interface-skin"]'))
  assert.equal(calls.filter(call => call.method === 'selectInterfaceSkin').at(-1).args.id, null)
  assert.deepEqual(await pressed(), ['沉静蓝'])
  await page.getByRole('button', { name: '纸感', exact: true }).click()
  await page.waitForFunction(() => window.__dreamSet === 'tavern-terracotta')
  assert.deepEqual(await pressed(), ['纸感'])
  await page.waitForFunction(() => document.querySelector('style[data-plugin-css="dsh-tavern-plugin/interface-skin"]')?.textContent === 'paper-css')
})
