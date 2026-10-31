import {readFile} from 'node:fs/promises'
import {openInterfaceSkins} from './fixtures/interface-skin-browser.mjs'
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
  const { page, calls } = await openInterfaceSkins(t, {
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
  await page.waitForFunction(() => !document.querySelector('style[data-plugin-css="dsh-dream-skin/interface-skin"]'))
  assert.equal(calls.filter(call => call.method === 'selectInterfaceSkin').at(-1).args.id, null)
  assert.deepEqual(await pressed(), ['沉静蓝'])
  await page.getByRole('button', { name: '纸感', exact: true }).click()
  await page.waitForFunction(() => window.__dreamSet === 'tavern-terracotta')
  assert.deepEqual(await pressed(), ['纸感'])
  await page.waitForFunction(() => document.querySelector('style[data-plugin-css="dsh-dream-skin/interface-skin"]')?.textContent === 'paper-css')
  await page.evaluate(() => {const style=document.createElement('style');style.textContent='body {color: blue}';document.head.appendChild(style)})
  await page.waitForFunction(() => document.head.lastElementChild?.dataset.pluginCss === 'dsh-dream-skin/interface-skin')
  await page.evaluate(() => {window.skinRoot.unmount();window.disposeSkin()})
  assert.equal(await page.locator('style[data-plugin-css="dsh-dream-skin/interface-skin"]').count(),0)
})

test('皮肤接口失败不影响页面，卸载后迟到响应不能恢复样式',async t=>{
  let resolveActive
  const pending = new Promise(resolve=>{resolveActive=resolve})
  const {page} = await openInterfaceSkins(t,{respond(method) {
    if(method==='getActiveInterfaceSkin')return pending
    if(method==='listInterfaceSkins')throw Error('皮肤服务暂时不可用')
  }})
  await page.getByRole('status').filter({hasText:'皮肤服务暂时不可用'}).waitFor()
  await page.evaluate(()=>{window.disposeSkin();document.querySelector('main').dataset.core='alive'})
  resolveActive({id:'old',css:'body {color:red}'})
  assert.equal(await page.locator('main').getAttribute('data-core'),'alive')
  assert.equal(await page.locator('style[data-plugin-css="dsh-dream-skin/interface-skin"]').count(),0)
})

test('全局皮肤覆盖大 PR 视觉变量，移除插件后回到基础样式',async t=>{
  const css = 'body {--dsh-tavern-accent: rgb(12, 34, 56); --dsh-tavern-radius-md: 23px; --dsh-tavern-font-sans: monospace;}'
  const {page}=await openInterfaceSkins(t,{respond:method=>method==='getActiveInterfaceSkin'?{id:'custom',css}:{active:'custom',skins:[]}})
  // Core styles can arrive after the independently loaded skin plugin.
  for(const name of ['tavern.css','theme.css']) await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/'+name,import.meta.url),'utf8')})
  await page.waitForFunction(()=>getComputedStyle(document.body).getPropertyValue('--fork-accent').trim()==='rgb(12, 34, 56)')
  assert.deepEqual(await page.evaluate(()=>{
    const style=getComputedStyle(document.body)
    return ['--fork-accent','--fork-radius','--fork-font-ui','--dsh-theme-accent'].map(key=>style.getPropertyValue(key).trim())
  }),['rgb(12, 34, 56)','23px','monospace','rgb(12, 34, 56)'])
  await page.evaluate(()=>{window.skinRoot.unmount();window.disposeSkin()})
  assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--fork-radius').trim()),'23px')
})


test('恢复剧情自动候选开关，只保存对应配置', async t => {
  const backend = fixture()
  const {page, calls} = await openTavernSettings(t, {respond:backend.respond})
  const toggle = page.getByRole('switch', {name:'自动生成候选项', exact:true})
  await toggle.waitFor()
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="自动生成候选项"]')?.checked === true)
  assert.deepEqual(calls.filter(call=>call.method==='updateTavernSettings').at(-1).args.patch, {candidateAutoGenerate:true})
  assert.equal(await page.getByRole('heading', {name:'插件', exact:true}).count(),0)
  assert.equal(await page.getByRole('heading', {name:'运行库', exact:true}).count(),0)
})

test('酒馆插件恢复为独立设置页，加载原有插件列表', async t => {
  const {page, calls} = await openTavernSettings(t, {section:'dsh-tavern: plugins settings section', respond: method => method === 'getStageRuntimeStatus' ? {installed:true,enabled:true,status:'ready'} : undefined})
  await page.getByRole('heading', {name:'酒馆插件', exact:true}).waitFor()
  await page.getByRole('button', {name:'打开插件文件夹', exact:true}).waitFor()
  assert.ok(calls.some(call=>call.method==='listUserPlugins'))
})

 test('插件管理页展示舞台真实状态，并可独立启停', async t => {
  let enabled = true
  const {page, calls} = await openTavernSettings(t, {section:'dsh-tavern: plugins settings section', respond(method,args) {
    if (method === 'setStageEnabled') enabled = args.enabled
    if (method === 'getStageRuntimeStatus' || method === 'setStageEnabled') return {installed:true, enabled, status:enabled?'ready':'disabled'}
  }})
  await page.locator('.dsh-tavern-user-plugins-list .dsh-tavern-user-plugin').filter({hasText:'dsh-tavern-stage'}).waitFor()
  assert.equal(await page.getByRole('heading', {name:'内置舞台插件', exact:true}).count(), 0)
  await page.getByRole('button', {name:'停用舞台', exact:true}).click()
  await page.getByRole('button', {name:'启用舞台', exact:true}).waitFor()
  assert.deepEqual(calls.find(c=>c.method==='setStageEnabled').args,{enabled:false})
  await page.getByRole('button', {name:'启用舞台', exact:true}).click()
  await page.getByRole('button', {name:'停用舞台', exact:true}).waitFor()
 })
