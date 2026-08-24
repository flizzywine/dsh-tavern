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

test('资料库 Feature module 只向宿主暴露注册 interface', function () {
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
  assert.equal(registration.title, '资料库')
  assert.equal(typeof registration.component, 'function')
  assert.deepEqual(effects, ['dsh-tavern: Better Sidebar resources tab'])
})

test('预设库 Feature module 封装实验预设 UI 并只暴露注册 interface', function () {
  const feature = browser.createPresetLibraryFeatureModule()
  let registration
  const ctx = {
    effect(activate) { return activate() },
    betterSidebar: { registerTab(value) { registration = value; return function () {} } }
  }

  feature.register({ ctx, appendMention() {} })

  assert.deepEqual(Object.keys(feature), ['register'])
  assert.equal(registration.id, 'dsh-tavern:presets')
  assert.equal(registration.title, '预设库')
  assert.equal(typeof registration.component, 'function')
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
    'conversation.input.dock',
    'conversation.input.dock',
    'conversation.input.dock',
    'conversation.input.dock'
  ])
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
