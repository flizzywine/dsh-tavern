import {readFile} from 'node:fs/promises'
import {openInterfaceSkins} from './fixtures/interface-skin-browser.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

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
  await page.locator('.dsh-tavern-global-defaults [role=status]').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await trigger.getAttribute('aria-label'), '状态栏位置（所有对局）：正文下方')
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { defaultPlaySettings: { statusBarPlacement: 'body' } })
  assert.equal(await page.evaluate(() => window.__statusSettingsChanged), 1)
})

test('显示人物设计默认关闭，可全局开关并通知现有对局刷新', async t => {
  let settingsDocument = {}
  const respond = (method, args) => {
    if (method === 'updateTavernSettings') settingsDocument = applyTavernSettingsPatch(settingsDocument, args.patch)
    if (method === 'getTavernSettings' || method === 'updateTavernSettings') return { settings: presentTavernSettings(settingsDocument, {}) }
  }
  const { page, calls } = await openTavernSettings(t, { respond })
  const toggle = (targetPage, checked) => targetPage.getByRole('region', { name: '显示与交互', exact: true })
    .getByRole('switch', { name: '显示人物设计', exact: true, checked })
  await toggle(page, false).waitFor()
  await page.evaluate(() => {
    window.__characterDesignRefreshes = 0
    window.addEventListener('dsh-tavern-data-changed', event => {
      if (event.detail.kinds.includes('sessions')) window.__characterDesignRefreshes++
    })
  })
  await toggle(page, false).press('Space')
  await toggle(page, true).waitFor()
  assert.deepEqual(calls.find(call => call.method === 'updateTavernSettings').args.patch, { showCharacterDesignPanel: true })
  assert.equal(await page.evaluate(() => window.__characterDesignRefreshes), 1)
  const { page: reopened } = await openTavernSettings(t, { respond })
  await toggle(reopened, true).press('Space')
  await toggle(reopened, false).waitFor()
  assert.deepEqual(settingsDocument, { showCharacterDesignPanel: false })
})

test('候选项点击方式由全局设置保存，重新打开仍然生效', async t => {
  let document = { candidateDismissMode: 'after-fill' }
  const respond = (method, args) => {
    if (method === 'getTavernSettings') return { settings: presentTavernSettings(document, {}) }
    if (method === 'updateTavernSettings') {
      document = applyTavernSettingsPatch(document, args.patch)
      return { settings: presentTavernSettings(document, {}) }
    }
  }

  const { page, calls } = await openTavernSettings(t, { respond })
  const candidates = page.getByRole('region', { name: '候选项', exact: true })
  const mode = candidates.locator('button[aria-label^="点击候选项："]')
  const dismiss = candidates.getByRole('button', { name: '候选项收起时机：选择一项后即隐藏' })
  await dismiss.waitFor()
  assert.equal(await mode.getAttribute('aria-label'), '点击候选项：填入输入框')
  await mode.click()
  await page.getByRole('menuitemradio', { name: '直接发送' }).click()
  await candidates.getByRole('status').getByText('已保存').waitFor()
  assert.equal(await mode.getAttribute('aria-label'), '点击候选项：直接发送')
  assert.deepEqual(calls.find(call => call.method === 'updateTavernSettings').args.patch, { candidatePickMode: 'send' })
  assert.equal(await dismiss.count(), 0)

  const { page: reopened } = await openTavernSettings(t, { respond })
  await reopened.getByRole('button', { name: '点击候选项：直接发送' }).click()
  await reopened.getByRole('menuitemradio', { name: '填入输入框' }).click()
  await reopened.getByRole('button', { name: '候选项收起时机：选择一项后即隐藏' }).waitFor()
  assert.deepEqual(document, { candidateDismissMode: 'after-fill', candidatePickMode: 'fill' })
})

// 对话气泡 / 舞台模式 are switched only in 舞台设置 › 基础设置 (four-state); the generation templates and their cost
// are not shown in the app.
test('舞台配置页没有卡片的基础设置和素材生图', async t => {
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: stage config tab', stageClient: true, respond(method) {
    if (method === 'prepareStageWorkbench') return { installed: true, status: 'ready' }
    if (method === 'getTavernSettings') return { settings: {}, modelCatalog: [], modModelSlots: [] }
  } })
  await page.locator('section[aria-label="舞台模型"]').waitFor()
  assert.equal(await page.locator('section[aria-label="基础设置"], section[aria-label="素材生图"]').count(), 0)
  assert.equal(await page.getByRole('switch', { name: '对话气泡' }).count(), 0)
  assert.equal(calls.some(call => call.method === 'getAssetEngineSettings'), false)
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


test('精修留在开局默认功能区，正文生成有独立分组', async t => {
  const backend = fixture()
  const {page, calls} = await openTavernSettings(t, {respond:backend.respond})
  const features = page.getByRole('region', {name:'开局默认', exact:true}).getByRole('region', {name:'功能', exact:true})
  const polish = features.getByRole('switch', { name: '启用精修', exact: true })
  await polish.press('Space')
  await features.getByRole('switch', { name: '启用精修', exact: true, checked: true }).waitFor()
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { polishEnabled: true })
  await page.getByRole('region', {name:'正文生成', exact:true}).getByRole('switch', {name:'插件生成正文后仍应用宿主正则', exact:true}).waitFor()
  assert.equal(await page.getByRole('region', {name:'剧情', exact:true}).count(),0)
  assert.equal(await page.getByRole('heading', {name:'插件', exact:true}).count(),0)
  assert.equal(await page.getByRole('heading', {name:'运行库', exact:true}).count(),0)
})

test('酒馆插件恢复为独立设置页，加载原有插件列表', async t => {
  const {page, calls} = await openTavernSettings(t, {section:'dsh-tavern: plugins settings section', respond: method => method === 'getStageRuntimeStatus' ? {installed:true,enabled:true,status:'ready'} : undefined})
  await page.getByRole('heading', {name:'酒馆插件', exact:true}).waitFor()
  await page.getByRole('button', {name:'打开插件文件夹', exact:true}).waitFor()
  assert.ok(calls.some(call=>call.method==='listUserPlugins'))
})

// Stage and mod model slots live in 舞台配置. 设置 › DSH Tavern shows the core's own.
test('舞台模型与模组的模型只在舞台配置展示，保存沿用原有模型槽', async t => {
  let settings = {defaultPlaySettings:{playerName:'你',backgroundTasks:{}},modModels:{'dsh.stage':{director:{provider:'p',model:'saved'}}}}
  const slots = [{modId:'dsh.stage',modName:'舞台',id:'director',label:'导演模型',fallback:'foreground',owner:'dsh-tavern-stage'},
    {modId:'dsh.phone',modName:'手机',id:'call',label:'通话模型',fallback:'foreground',owner:'dsh-tavern-stage-mods'}]
  const respond = (method,args) => {
    if (method === 'getBackgroundModelReasoning') return {reasoning:{efforts:[]}}
    if (method === 'prepareStageWorkbench') return {installed:true,status:'ready'}
    if (method === 'getTavernSettings') return {settings, modelCatalog:[{provider:'p',models:[{id:'saved'},{id:'next'}]}], modModelSlots:slots}
    if (method === 'updateTavernSettings') {
      const value=args.patch.modModelSelection
      settings={modModels:{'dsh.stage':{director:value.selection}}}
      return {settings}
    }
  }
  const general = await openTavernSettings(t,{respond})
  await general.page.locator('button[aria-label^="默认前台模型："]').waitFor()
  assert.equal(await general.page.locator('button[aria-label^="导演模型："], button[aria-label^="通话模型："]').count(),0)
  const stage = await openTavernSettings(t,{respond,section:'dsh-tavern: stage config tab',stageClient:true})
  await stage.page.locator('button[aria-label^="导演模型："]').waitFor()
  await stage.page.locator('section[aria-label="舞台模型"] button[aria-label="通话模型：跟随前台"]').waitFor()
  assert.equal(await stage.page.getByRole('button',{name:'停用',exact:true}).count(),0)
  assert.equal(await stage.page.getByRole('heading',{name:'舞台插件',exact:true}).count(),0)
  const picker=stage.page.locator('button[aria-label^="导演模型："]')
  await picker.click()
  await stage.page.getByRole('menuitemradio',{name:/next/}).click()
  assert.equal(stage.calls.filter(c=>c.method==='updateTavernSettings').at(-1).args.patch.modModelSelection.modId,'dsh.stage')
  assert.equal(settings.modModels['dsh.stage'].director.model,'next')
})

test('从侧栏按需打开舞台配置，页面没有全局启动开关', async t => {
  const {page, calls} = await openTavernSettings(t, {sidebarStart:true, stageClient:true, respond(method) {
    if (method === 'cardPluginScopes') return {scopes:{}}
    if (method === 'prepareStageWorkbench') return {installed:true,status:'ready'}
  }})
  const group = page.getByRole('region', {name:'舞台装置'})
  await group.getByRole('button', {name:'舞台素材', exact:true}).waitFor()
  assert.equal(calls.some(row => row.method === 'prepareStageWorkbench'), false)
  await group.getByRole('button', {name:'舞台配置', exact:true}).click()
  await page.getByRole('heading', {name:'舞台模型', exact:true}).waitFor()
  await page.getByRole('heading', {name:'舞台模组', exact:true}).waitFor()
  assert.equal(await page.getByRole('switch', {name:'启动时加载舞台'}).count(), 0)
  assert.equal(await page.getByRole('button', {name:'本次加载舞台'}).count(), 0)
})

// 内置插件（随酒馆发行、装在 plugins/ 里的那几个）照样列出来：可停用、随酒馆更新、不可删除。
// 只有内置舞台模组不进这个列表——它们在「管理模组」里。
test('插件列表列出内置插件，内置舞台模组留给「管理模组」', async t => {
  const {page}=await openTavernSettings(t,{section:'dsh-tavern: plugins settings section',respond(method){
    if(method==='listUserPlugins')return {plugins:[
      {folder:'dice',name:'dsh-tavern-mod-dice',state:'loaded',enabled:true,source:{kind:'managed',builtin:true,modId:'dsh.dice'}},
      {folder:'image',name:'dsh-tavern-image',state:'loaded',enabled:true,source:{kind:'builtin'}},
      {folder:'custom',name:'custom-plugin',state:'loaded',enabled:true,source:{kind:'folder'}}]}
  }})
  await page.locator('.dsh-tavern-user-plugin').filter({hasText:'custom-plugin'}).waitFor()
  assert.equal(await page.locator('.dsh-tavern-user-plugin').count(),2)
  assert.equal(await page.getByText('dsh-tavern-mod-dice',{exact:true}).count(),0)
  const builtin = page.locator('.dsh-tavern-user-plugin').filter({hasText:'dsh-tavern-image'})
  assert.match(await builtin.innerText(), /内置插件 · 默认启用，随酒馆更新，不可删除/)
  assert.equal(await builtin.getByRole('button',{name:'删除',exact:true}).count(),0)
  await builtin.getByRole('button',{name:'停用',exact:true}).waitFor()
  // 用户自己装的插件照旧能删除。
  await page.locator('.dsh-tavern-user-plugin').filter({hasText:'custom-plugin'}).getByRole('button',{name:'删除',exact:true}).waitFor()
})

test('开局默认功能区包含“后台任务附加预设”开关，默认关闭且保存进 defaultPlaySettings', async t => {
  const backend = fixture()
  const { page, calls } = await openTavernSettings(t, { respond: backend.respond })
  const toggle = page.getByRole('switch', { name: '后台任务附加预设', exact: true })
  await toggle.waitFor()
  assert.equal(await page.getByRole('switch', { name: '人物姿势', exact: true }).count(), 0)
  assert.equal(await toggle.isChecked(), false)
  await toggle.press('Space')
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="后台任务附加预设"]')?.checked === true)
  assert.deepEqual(
    calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch,
    { defaultPlaySettings: { backgroundTasks: { preset: true } } }
  )
})

test('候选项生成集中在独立分组，各项仍按原有范围保存', async t => {
  const backend = fixture()
  const {page, calls} = await openTavernSettings(t, {respond:backend.respond})
  const candidates = page.getByRole('region', { name: '候选项', exact: true })
  const defaults = page.getByRole('region', { name: '开局默认', exact: true })
  for (const [name, patch] of [
    ['自动生成候选项', { candidateAutoGenerate: true }],
    ['前台生成候选项', { defaultPlaySettings: { backgroundTasks: { foregroundCandidates: true } } }],
  ]) {
    await candidates.getByRole('switch', { name, exact: true }).press('Space')
    await candidates.getByRole('switch', { name, exact: true, checked: true }).waitFor()
    assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, patch)
    assert.equal(await defaults.getByRole('switch', { name, exact: true }).count(), 0)
  }

  const menu = candidates.locator('button[aria-label^="候选项数量："]')
  await candidates.locator('button[aria-label="候选项数量：少量候选"]:enabled').waitFor()
  assert.equal(await defaults.locator('button[aria-label^="候选项数量："]').count(), 0)
  await menu.click()
  await page.getByRole('menuitemradio', { name: '大量候选' }).click()
  await candidates.locator('button[aria-label="候选项数量：大量候选"]:enabled').waitFor()
  assert.deepEqual(calls.filter(call=>call.method==='updateTavernSettings').at(-1).args.patch, { defaultPlaySettings: { candidateTabs: true } })
  await menu.click()
  await page.getByRole('menuitemradio', { name: '少量候选' }).click()
  await candidates.locator('button[aria-label="候选项数量：少量候选"]:enabled').waitFor()
  assert.deepEqual(calls.filter(call=>call.method==='updateTavernSettings').at(-1).args.patch, { defaultPlaySettings: { candidateTabs: false } })
})
