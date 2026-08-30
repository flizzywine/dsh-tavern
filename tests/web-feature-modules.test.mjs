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
