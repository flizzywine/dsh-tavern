// 叙事阻尼器内置插件：面板（浏览器半）与宿主半的接线、设置服务和打包清单。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTavernPluginApi, TAVERN_PLUGIN_API_VERSION } from '../tavern-plugin/lib/plugin-api.js'
import { createDamperSettings } from '../tavern-plugin/lib/domain/damper-settings.js'
import { defaultNarrativeDamperConfig } from '../tavern-plugin/lib/domain/narrative-damper.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { apply as applyDamperPlugin } from '../tavern-plugin/packages/dsh-tavern-narrative-damper/lib/index.js'
import { buildNarrativeDamperClient } from '../tavern-plugin/packages/dsh-tavern-narrative-damper/build.mjs'
import { BUNDLED_TAVERN_PLUGINS, readBundledTavernPlugin } from '../bin/bundled-tavern-plugins.mjs'

const PACKAGE_ROOT = new URL('../tavern-plugin/packages/dsh-tavern-narrative-damper/', import.meta.url)
const PLUGIN_NAME = 'dsh-tavern-narrative-damper'

// 与 tests/plot-compass.test.mjs 同一种接法：把真实的服务绑到一条假 fiber 上，owner 才有名字。
function createPluginFiber(pluginName, parentService) {
  const cleanups = []
  const ctx = {
    fiber: { name: pluginName },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    }
  }
  const boundService = Object.create(parentService, {
    ctx: { value: ctx, enumerable: false }
  })
  return {
    // Cordis pass: apply 自己返回清理函数
    ctx: { tavern: boundService, effect: agent => cleanups.push(agent) },
    settle(result) { if (typeof result === 'function') cleanups.push(result) },
    dispose() { for (const fn of cleanups.splice(0)) fn() }
  }
}

test('内置叙事阻尼器插件包 client.js 与源码保持同步', async () => {
  const res = await buildNarrativeDamperClient({ check: true, packageRoot: PACKAGE_ROOT })
  assert.equal(res.changed, false)
})

test('面板在插件里：侧栏 registerPanel，四个宿主入口齐全', async () => {
  const client = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  const main = await readFile(new URL('src/client/main.js', PACKAGE_ROOT), 'utf8')
  assert.match(client, /id: 'dsh-tavern-narrative-damper'/)
  assert.match(main, /ui\.registerPanel\(\{/)
  assert.match(main, /title: '叙事阻尼器'/)
  assert.match(main, /inject = \['tavernUi'\]/)
  // 面板的读写全走本插件的宿主半，不直接碰宿主 RPC。
  for (const rpc of ['narrative-damper:read', 'narrative-damper:update', 'narrative-damper:set-key', 'narrative-damper:test']) {
    assert.ok(client.includes(rpc), '缺少 ' + rpc)
  }
  assert.equal(client.includes('getNarrativeDamperSettings'), false)
  // 字段名与宿主配置逐字一致，面板不会造出宿主不认识的值。
  for (const field of ['showTurnStatus', 'judgeMode', 'desensitizeR18', 'clampMvuDelta', 'fallbackStateForPlainCards', 'godmodeThreshold', 'timeoutMs', 'preamble']) {
    assert.ok(client.includes(field), '缺少字段 ' + field)
  }
})

test('宿主半把面板调用转发给 tavern.damperSettings，停用后撤掉处理函数', async () => {
  const calls = []
  const credential = { configured: true, source: 'stored', keyName: 'GEMINI_API_KEY' }
  const config = { ...defaultNarrativeDamperConfig(), enabled: true }
  const api = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
    damperSettings: {
      read: async () => { calls.push(['read']); return { config, credential } },
      update: async patch => { calls.push(['update', patch]); return { config: { ...config, ...patch }, credential } },
      setKey: async input => { calls.push(['setKey', input]); return { config, credential } },
      test: async draft => { calls.push(['test', draft]); return { ok: true, latencyMs: 12, sampleProbability: 0.9 } }
    }
  })
  assert.equal(api.capabilities.damperSettings, 1)
  const fiber = createPluginFiber(PLUGIN_NAME, api.service)
  fiber.settle(applyDamperPlugin(fiber.ctx))

  assert.deepEqual(await api.callHandler('narrative-damper:read', {}), { config, credential })
  const updated = await api.callHandler('narrative-damper:update', { values: { mode: 'strict' } })
  assert.equal(updated.config.mode, 'strict')
  assert.deepEqual(calls[1], ['update', { mode: 'strict' }])
  await api.callHandler('narrative-damper:set-key', { provider: 'openai', value: 'sk-test' })
  assert.deepEqual(calls[2], ['setKey', { provider: 'openai', value: 'sk-test' }])
  const probed = await api.callHandler('narrative-damper:test', {})
  assert.equal(probed.ok, true)
  assert.deepEqual(calls[3], ['test', undefined])

  // 插件停用（fiber 撤销）后处理函数一起消失，面板再调就是「未加载」。
  fiber.dispose()
  await assert.rejects(api.callHandler('narrative-damper:read', {}), /没有名为 narrative-damper:read 的插件处理函数/)
})

test('宿主没提供阻尼器设置接口时，插件处理函数如实报错', async () => {
  const api = createTavernPluginApi({ ctx: {}, loaderOrigin: () => 'host' })
  assert.equal(api.capabilities.damperSettings, undefined)
  assert.equal(api.service.apiVersion, TAVERN_PLUGIN_API_VERSION)
  const fiber = createPluginFiber(PLUGIN_NAME, api.service)
  fiber.settle(applyDamperPlugin(fiber.ctx))
  await assert.rejects(api.callHandler('narrative-damper:read', {}), /当前(版本|宿主)不支持叙事阻尼器设置接口/)
  fiber.dispose()
})

// 内存里的安全存储：和宿主凭据服务同一副样子（resolve/describe/set/unset）。
function memoryCredentials(stored = {}) {
  const map = new Map(Object.entries(stored))
  return {
    map,
    damper: {
      async credentialStatus(provider, keyName = '') {
        const name = 'DSH_TAVERN_DAMPER_' + String(provider).toUpperCase()
        if (map.has(name)) return { configured: true, source: 'stored', keyName: keyName || name }
        return { configured: false, source: null, keyName }
      },
      async isReference(value) { return /^[A-Z_][A-Z0-9_]*$/.test(String(value)) },
      async setKey(provider, value) {
        const name = 'DSH_TAVERN_DAMPER_' + String(provider).toUpperCase()
        if (value === null) map.delete(name)
        else map.set(name, value)
      },
      async test() { return { ok: true, latencyMs: 7, sampleProbability: 0.8 } }
    }
  }
}

test('设置服务：读取不回明文、补丁校验、环境变量名转键名引用、测试连接走引擎', async () => {
  // 设置文档与宿主同一条归一化路径（applyTavernSettingsPatch）：边界值在这里被收紧，不是测试里手改。
  let doc = {}
  const credentials = memoryCredentials()
  const service = createDamperSettings({
    readTavernSettings: async () => presentTavernSettings(doc, {}),
    updateTavernSettings: async patch => {
      doc = applyTavernSettingsPatch(doc, patch)
      return presentTavernSettings(doc, {})
    },
    damper: credentials.damper
  })

  const read = await service.read()
  assert.equal(read.config.enabled, false)
  assert.equal(read.credential.configured, false)
  assert.equal(JSON.stringify(read).includes('sk-'), false)

  const saved = await service.update({ provider: 'openai', model: 'gpt-6-luna', godmodeThreshold: 0.81 })
  assert.equal(saved.config.provider, 'openai')
  assert.equal(saved.config.godmodeThreshold, 0.81)

  await assert.rejects(service.update(null), /设置补丁无效/)
  // 越界阈值在宿主校验处被拒（面板这边已经先按 0.50–0.95 收紧，越界值不会送到这里）
  await assert.rejects(service.update({ godmodeThreshold: 2 }), /越权判定阈值须在 0\.50 至 0\.95 之间/)

  const keyed = await service.setKey({ provider: 'openai', value: 'sk-plain-secret' })
  assert.equal(keyed.credential.configured, true)
  assert.equal(keyed.credential.source, 'stored')
  assert.equal(JSON.stringify(keyed).includes('sk-plain-secret'), false)
  assert.equal(credentials.map.get('DSH_TAVERN_DAMPER_OPENAI'), 'sk-plain-secret')

  // 传环境变量名：存成键名引用，同时清掉已存明文
  const referenced = await service.setKey({ provider: 'openai', value: 'OPENAI_API_KEY' })
  assert.equal(referenced.config.keyName, 'OPENAI_API_KEY')
  assert.equal(credentials.map.has('DSH_TAVERN_DAMPER_OPENAI'), false)

  await assert.rejects(service.setKey({ provider: 'nope', value: 'x' }), /决策模型提供方无效/)
  await assert.rejects(service.setKey({ provider: 'openai', value: 'has space' }), /可见 ASCII/)

  const cleared = await service.setKey({ provider: 'openai', value: null })
  assert.equal(cleared.credential.configured, false)
  assert.equal(credentials.map.size, 0)

  const probe = await service.test(undefined)
  assert.equal(probe.ok, true)
  await assert.rejects(service.test({ provider: 'nope' }), /决策模型提供方无效/)
})

test('浏览器半能被模块加载器接上：注册面板，面板在无会话时也能画出加载态', async () => {
  const source = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let definition = null
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: value => { definition = value } } },
    console
  })
  vm.runInContext(source, context, { filename: 'dsh-tavern-narrative-damper/client.js' })
  assert.ok(definition, 'client.js 没有调用 window.__ModuleLoader__.load')
  assert.equal(definition.id, PLUGIN_NAME)
  assert.deepEqual([...definition.inject], ['tavernUi'])
  const exported = definition.factory(spec => {
    if (spec === 'react') return React
    throw new Error('意外的依赖：' + spec)
  })
  assert.equal(exported.name, PLUGIN_NAME)
  assert.deepEqual([...exported.inject], ['tavernUi'])

  // 面板注册：id / title / render 齐备；同一插件重复 apply 也不炸。
  const panels = []
  const ui = {
    apiVersion: 10,
    components: {},
    registerPanel: input => { panels.push(input); return () => {} },
    callHost: async () => ({ config: null })
  }
  exported.apply({ tavernUi: ui })
  assert.equal(panels.length, 1)
  assert.equal(panels[0].id, 'narrative-damper')
  assert.equal(panels[0].title, '叙事阻尼器')
  const html = renderToStaticMarkup(React.createElement(panels[0].render, { gameId: 'g1' }))
  assert.match(html, /正在读取叙事阻尼器设置/)
  assert.match(html, /dsh-tavern-global-settings/)
})


// 面板的读写路径：用真 React + jsdom 渲染一遍，改开关、换提供方、改阈值，看它发出去的是什么。
async function loadPanelModule(t) {
  const source = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let definition = null
  vm.runInContext(source, vm.createContext({
    window: { __ModuleLoader__: { load: value => { definition = value } } },
    console
  }), { filename: 'dsh-tavern-narrative-damper/client.js' })
  return definition.factory(spec => {
    if (spec === 'react') return React
    throw new Error('意外的依赖：' + spec)
  })
}

test('面板真的会把改动写给宿主：开关、提供方、阈值各走一次调用', async t => {
  // react-dom 的浏览器入口在 import 时就看 window/document：必须先立好 DOM 再动态导入，
  // 否则它会以为跑在无 DOM 的环境里，走 IE 事件补丁那条路（attachEvent）。
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://tavern.test/' })
  const restore = []
  const install = (name, value) => { restore.push([name, globalThis[name]]); globalThis[name] = value }
  install('window', dom.window)
  install('document', dom.window.document)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  t.after(() => {
    for (const [name, value] of restore.reverse()) globalThis[name] = value
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    dom.window.close()
  })

  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const exported = await loadPanelModule(t)
  const { TndPanel } = exported
  let config = {
    enabled: false, showTurnStatus: true, mode: 'balanced', judgeMode: 'roleplay',
    provider: 'gemini', model: 'gemini-decision-1', baseUrl: '', keyName: 'GEMINI_API_KEY',
    godmodeThreshold: 0.72, desensitizeR18: true, clampMvuDelta: true,
    fallbackStateForPlainCards: true, timeoutMs: 2500, preamble: ''
  }
  const calls = []
  const ui = {
    apiVersion: 10,
    components: {
      Switch: ({ label, checked, disabled, onChange }) => React.createElement('input', {
        type: 'checkbox', role: 'switch', 'aria-label': label, checked: Boolean(checked), disabled: Boolean(disabled),
        onChange: event => onChange(event.target.checked)
      }),
      Segmented: ({ label, value, options, disabled, onChange }) => React.createElement('div', { role: 'radiogroup', 'aria-label': label },
        options.map(([optionValue, text]) => React.createElement('button', {
          key: optionValue, type: 'button', role: 'radio', 'aria-checked': value === optionValue,
          disabled: Boolean(disabled), onClick: () => onChange(optionValue)
        }, text)))
    },
    async callHost(name, args) {
      calls.push([name, args])
      if (name === 'narrative-damper:read') return { config, credential: { configured: true, source: 'stored', keyName: 'GEMINI_API_KEY' } }
      if (name === 'narrative-damper:update') { config = { ...config, ...args.values }; return { config, credential: { configured: true, source: 'stored', keyName: 'GEMINI_API_KEY' } } }
      if (name === 'narrative-damper:test') return { ok: true, latencyMs: 9, sampleProbability: 0.9 }
      return null
    }
  }
  // 面板跑在独立的 vm 上下文里，它造出来的对象换个 realm；比内容而不是原型。
  const plain = value => JSON.parse(JSON.stringify(value === undefined ? null : value))
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => { root.render(React.createElement(TndPanel, { ui })) })
  assert.match(host.textContent, /启用叙事阻尼器/)
  assert.match(host.textContent, /已配置（安全存储）/)
  assert.equal(calls[0][0], 'narrative-damper:read')
  assert.equal(host.querySelectorAll('select option').length, 5)

  const enabled = host.querySelector('input[role="switch"][aria-label="启用叙事阻尼器"]')
  await act(async () => { enabled.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(plain(calls.at(-1)), ['narrative-damper:update', { values: { enabled: true } }])

  const provider = host.querySelector('select')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
    setter.call(provider, 'openai-compatible')
    provider.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    provider.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  assert.deepEqual(plain(calls.at(-1)), ['narrative-damper:update', { values: { provider: 'openai-compatible', model: 'gpt-6-luna', keyName: 'OPENAI_API_KEY', baseUrl: '' } }])

  // 自定义接口地址只在兼容接口下出现
  assert.ok([...host.querySelectorAll('.dsh-tavern-settings-title')].some(node => node.textContent.includes('自定义接口地址')))

  // 阈值：填 0.9 后失焦提交，面板先按 0.50–0.95 收紧。
  // 换提供方会让「自定义接口地址」那一行插进来，行的位置全变，必须重新取节点。
  const threshold = [...host.querySelectorAll('input[type="number"]')][0]
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(threshold, '0.9')
    threshold.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await act(async () => {
    threshold.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false }))
    threshold.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
  })
  const thresholdCall = calls.filter(([name, args]) => name === 'narrative-damper:update' && args.values.godmodeThreshold !== undefined).at(-1)
  assert.deepEqual(plain(thresholdCall[1]), { values: { godmodeThreshold: 0.9 } })

  // 测试连接：真发一次宿主调用并把结果显示出来
  const testButton = [...host.querySelectorAll('button')].find(button => button.textContent === '测试连接')
  await act(async () => { testButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const probeCall = plain(calls.at(-1))
  assert.equal(probeCall[0], 'narrative-damper:test')
  // 送来的是面板当前这一份配置：前两次保存的改动都在里面
  assert.equal(probeCall[1].config.godmodeThreshold, 0.9)
  assert.equal(probeCall[1].config.provider, 'openai-compatible')
  assert.equal(probeCall[1].config.model, 'gpt-6-luna')
  assert.match(host.textContent, /连接正常/)

  // 卸载放在这里：全局 window/document 的还原在 t.after 里，晚一步 React 就找不到 window.event。
  await act(async () => { root.unmount() })
})

test('内置清单登记叙事阻尼器插件，发行副本齐备', () => {
  const entry = BUNDLED_TAVERN_PLUGINS.find(item => item.packageName === PLUGIN_NAME)
  assert.ok(entry, '清单缺少 ' + PLUGIN_NAME)
  assert.equal(entry.folder, PLUGIN_NAME)
  const bundled = readBundledTavernPlugin(new URL('../', import.meta.url).pathname, entry)
  assert.equal(bundled.ok, true, bundled.reason)
  assert.equal(bundled.packageName, PLUGIN_NAME)
})
