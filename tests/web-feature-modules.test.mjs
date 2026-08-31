import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function clientExports() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const browser = await clientExports()

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
    ['dsh-tavern:presets', '预设库（实验性）']
  ])
  assert.ok(registrations.every(function (item) { return typeof item.component === 'function' }))
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
    effect(activate, label) { if (label === 'dsh-tavern: shell marker' || label === 'dsh-tavern: home placeholder') return; return activate() },
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

for (const native of [
  '描述你想要构建的内容… / 调用指令 @ 文件或对话',
  'Describe what you want to build…',
  '选择一个工作区开始',
  'Choose a workspace to start'
]) test(`首页默认语替换「${native}」，支持延迟挂载、原生重绘、切换对话与卸载恢复`, () => {
  const expected = '选择人物卡后开始游戏，或者在卡片工作台中编辑人物卡'
  function element(attributes, textContent = '') {
    return { attributes: { ...attributes }, textContent,
      getAttribute(key) { return this.attributes[key] ?? null },
      hasAttribute(key) { return Object.hasOwn(this.attributes, key) },
      setAttribute(key, value) { this.attributes[key] = value },
    }
  }
  const editor = element({ 'data-placeholder': native, 'aria-label': native }, '用户已有草稿')
  const hint = element({ 'data-composer-placeholder': 'true' }, native)
  const workspace = element({ 'data-placeholder': '先选择工作区', 'aria-label': '选择工作区' })
  let mounted = []
  let notify
  let disconnected = false
  const doc = { body: {}, querySelectorAll(selector) {
    assert.ok(selector.split(',').every(part => part.trim().startsWith('[data-phase="hero"] [data-composer-card]')))
    return mounted
  } }
  class Observer {
    constructor(callback) { notify = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const dispose = browser.mountTavernHomePlaceholder(doc, Observer)
  mounted = [editor, hint, workspace]
  notify()
  assert.equal(editor.getAttribute('data-placeholder'), expected)
  assert.equal(editor.getAttribute('aria-label'), expected)
  assert.equal(editor.textContent, '用户已有草稿')
  assert.equal(hint.textContent, expected)
  assert.equal(workspace.getAttribute('data-placeholder'), '先选择工作区')
  hint.textContent = native
  notify()
  assert.equal(hint.textContent, expected)
  // Native rendering owns active-session text; do not restore a stale hero label over it.
  editor.setAttribute('data-placeholder', '发消息或做任务…')
  mounted = []
  notify()
  assert.equal(editor.getAttribute('data-placeholder'), '发消息或做任务…')
  assert.equal(editor.getAttribute('aria-label'), native)
  assert.equal(hint.textContent, native)
  mounted = [hint]
  notify()
  dispose()
  assert.equal(hint.textContent, native)
  assert.equal(disconnected, true)
})

test('首页选择器行只在 Tavern hero 隐藏，不更改宿主预设和工作区逻辑', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes('body.dsh-tavern-shell-active [data-phase="hero"] div:has(> [data-slot="conversation.hero.agentPreset"]) { display: none !important; }'))
  assert.match(source, /const agentPreset = "tavern"/)
  assert.match(source, /props\.workspaces\.create\(\{ path: resourceRoot\.path \}\)/)
})
