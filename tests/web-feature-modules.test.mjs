import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function clientExports(react = {}) {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function (name) { return name === 'react' ? react : {} })
}

const browser = await clientExports()

test('世界书详情把常驻条目置顶并与非常驻条目分组，组内保持原顺序', function () {
  const entries = [
    { ref: 'dynamic-a', constant: false },
    { ref: 'constant-a', constant: true },
    { ref: 'dynamic-b' },
    { ref: 'constant-b', constant: true }
  ]
  const groups = browser.groupWorldBookEditorEntries(entries)

  assert.deepEqual(Array.from(groups.constant, function (item) { return [item.entry.ref, item.index] }), [
    ['constant-a', 1], ['constant-b', 3]
  ])
  assert.deepEqual(Array.from(groups.dynamic, function (item) { return [item.entry.ref, item.index] }), [
    ['dynamic-a', 0], ['dynamic-b', 2]
  ])
  assert.deepEqual(entries.map(function (entry) { return entry.ref }), ['dynamic-a', 'constant-a', 'dynamic-b', 'constant-b'])
})

test('资源变化只刷新相关资料库，并忽略来源资料库自己的通知', function () {
  const affects = browser.tavernDataChangeAffects
  assert.equal(affects({ detail: { kinds: ['cards'], source: 'cards' } }, ['cards'], 'cards'), false)
  assert.equal(affects({ detail: { kinds: ['cards'], source: 'card-agent' } }, ['cards'], 'cards'), true)
  assert.equal(affects({ detail: { kinds: ['worldbooks'], source: 'worldbooks' } }, ['presets'], 'presets'), false)
  assert.equal(affects({}, ['cards'], 'cards'), true)
})

test('剧本库 Feature module 只向宿主暴露注册 interface', function () {
  const feature = browser.createResourcesLibraryFeatureModule()
  let registration
  const effects = []
  const ctx = {
    effect(activate, label) { effects.push(label); return activate() },
    betterSidebar: {
      registerTab(value) { registration = value; return function () {} },
      openFile() {}
    }
  }

  feature.register({ ctx, appendMention() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registration.id, 'dsh-tavern:resources')
  assert.equal(registration.title, '剧本库')
  assert.equal(typeof registration.component, 'function')
  assert.deepEqual(effects, ['dsh-tavern: Better Sidebar resources tab'])
})

test('预设 Feature module 只注册一个预设库', function () {
  const feature = browser.createPresetLibraryFeatureModule()
  const registrations = []
  const ctx = {
    effect(activate) { return activate() },
    betterSidebar: { registerTab(value) { registrations.push(value); return function () {} } }
  }

  feature.register({ ctx, appendMention() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.deepEqual(registrations.map(function (item) { return [item.id, item.title] }), [
    ['dsh-tavern:presets', '预设库']
  ])
  assert.ok(registrations.every(function (item) { return typeof item.component === 'function' }))
})

test('预设库实际渲染游玩说明、内置默认选项，不再显示实验标签和劝退说明', async () => {
  const react = {
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect() {},
    createElement: (type, props, ...children) => typeof type === 'function' ? type(props) : { type, props, children }
  }
  const exports = await clientExports(react)
  let registration
  exports.createPresetLibraryFeatureModule().register({
    ctx: { effect: activate => activate(), betterSidebar: { registerTab: value => { registration = value } } },
    appendMention() {}
  })
  const rendered = JSON.stringify(registration.component({ scope: { sessionId: 'play-session' } }))
  assert.match(rendered, /预设用于调整游玩的文风、叙事方式和写作规则/)
  assert.match(rendered, /不导入预设也能直接开始/)
  assert.match(rendered, /不使用外部预设（默认）/)
  assert.match(rendered, /效果可能与原酒馆不同/)
  assert.doesNotMatch(rendered, /实验性|除非坚持|破限效果/)
})

test('世界书库 Feature module 封装目录与编辑器并只暴露注册 interface', function () {
  const feature = browser.createWorldBookLibraryFeatureModule()
  let registration
  const ctx = {
    effect(activate) { return activate() },
    betterSidebar: { registerTab(value) { registration = value; return function () {} } }
  }

  feature.register({ ctx })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registration.id, 'dsh-tavern:worldbooks')
  assert.equal(registration.title, '世界书库')
  assert.equal(typeof registration.component, 'function')
})

test('人物卡库 Feature module 封装目录、详情与世界书入口', function () {
  const feature = browser.createCardLibraryFeatureModule()
  let registration
  const ctx = {
    effect(activate) { return activate() },
    betterSidebar: { registerTab(value) { registration = value; return function () {} } }
  }

  feature.register({ ctx, appendMention() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registration.id, 'dsh-tavern:cards')
  assert.equal(registration.title, '人物卡库')
  assert.equal(typeof registration.component, 'function')
})

test('游玩控制 Feature module 统一注册状态栏与对话控制面板', function () {
  const feature = browser.createPlayControlsFeatureModule()
  const tabs = []
  const injectedSlots = []
  const ctx = {
    sessions: {},
    get() { return {} },
    effect(activate) { return activate() },
    betterSidebar: { registerTab(value) { tabs.push(value); return function () {} } }
  }
  const slots = {
    inject(name, activate) { injectedSlots.push(name); return activate() },
    register() { return function () {} }
  }

  feature.register({ ctx, slots })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(tabs[0].id, 'dsh-tavern:status')
  assert.deepEqual(injectedSlots, [
    'conversation.session.header.actions',
    'conversation.session.header.utilities',
    'conversation.input.dock',
    'conversation.input.dock',
    'conversation.input.dock',
    'conversation.input.dock'
  ])
})

test('持久状态视图不再注册到粘滞输入区域', function () {
	assert.equal(browser.createPersistentStatusViewFeatureModule, undefined)
})

test('酒馆 Shell Feature module 封装工作区入口并只暴露注册 interface', function () {
  const feature = browser.createTavernShellFeatureModule()
  const injectedSlots = []
  const ctx = {
    effect(activate, label) { if (label === 'dsh-tavern: shell marker') return; return activate() },
    sessions: {},
    workspaces: {},
    layout: {},
    betterSidebar: {},
    get() { return {} }
  }
  const slots = {
    inject(name, activate) { injectedSlots.push(name); return activate() },
    register() { return function () {} }
  }

  feature.register({ ctx, slots, appendMention() {}, injectTaskPrompt() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.deepEqual(injectedSlots, ['sidebar.workspaces'])
})

test('品牌首页只匹配没有会话的 hero，空白任务和已有对话保留输入框', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const selector = 'body.dsh-tavern-shell-active [data-phase="hero"]:has([data-composer-seat]):not(:has(> [data-slot="conversation.session.header"]))'
  assert.ok(source.includes(selector + ' > * { display: none !important; }'))
  assert.ok(source.includes(selector + '::before { content: "🍺 DSH Tavern";'))
  assert.doesNotMatch(source, /mountTavernHomePlaceholder|dsh-tavern: home placeholder/)
  assert.ok(!source.includes('选择人物卡后开始游戏，或者在卡片工作台中编辑人物卡'))
})


test('首页选择器行只在 Tavern hero 隐藏，不更改宿主预设和工作区逻辑', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes('body.dsh-tavern-shell-active [data-phase="hero"] div:has(> [data-slot="conversation.hero.agentPreset"]) { display: none !important; }'))
  assert.match(source, /const agentPreset = "tavern"/)
  assert.match(source, /props\.workspaces\.create\(\{ path: resourceRoot\.path \}\)/)
})
