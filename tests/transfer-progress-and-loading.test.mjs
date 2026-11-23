import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createTransferHandlers } from '../tavern-plugin/lib/rpc/transfer.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const builtClientPath = path.join(root, 'tavern-plugin/lib/client.js')
const SEARCH_ROOTS = [path.join(root, 'tavern-plugin/node_modules'), path.join(root, 'node_modules')]

function loadPackage(name) {
  let failure = null
  for (const base of SEARCH_ROOTS) {
    try { return createRequire(path.join(base, 'noop.js'))(name) } catch (error) { failure = error }
  }
  throw new Error('缺少测试依赖 ' + name + '：' + (failure && failure.message))
}

const { JSDOM } = loadPackage('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:41661/' })
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true
})) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })

const React = loadPackage('react')
const { createRoot } = loadPackage('react-dom/client')
const act = React.act

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function loadTransferPanelComponent(env) {
  const clientCode = readFileSync(builtClientPath, 'utf8')
  const spinnerStart = clientCode.indexOf('const SPINNER_DELAY_MS = 150;')
  const spinnerEnd = clientCode.indexOf('return h("span", { className: "fork-spinner"', spinnerStart)
  const spinnerClose = clientCode.indexOf('\n\t\t}\n', spinnerEnd)
  assert.ok(spinnerStart > 0 && spinnerClose > spinnerStart, '无法在构建产物中定位 Spinner')
  const spinnerSource = clientCode.slice(spinnerStart, spinnerClose + 4)

  const modStart = clientCode.indexOf('function createTransferFeatureModule() {')
  const modEnd = clientCode.indexOf('const transferFeature = createTransferFeatureModule()', modStart)
  assert.ok(modStart > 0 && modEnd > modStart, '无法在构建产物中定位 createTransferFeatureModule')
  const transferSource = clientCode.slice(modStart, modEnd)

  let registeredTab = null
  const factory = new Function(
    'React',
    'rpc',
    'usePersistentError',
    'useVisibleDataRefresh',
    'tavernDataChangeAffects',
    'downloadTavernBlob',
    'notifyTavernDataChanged',
    'InlineField',
    'Switch',
    spinnerSource + '\n' + transferSource + '\nreturn createTransferFeatureModule();'
  )

  const feature = factory(
    React,
    env.rpc,
    function usePersistentErrorStub() { return React.useState('') },
    function useVisibleDataRefreshStub() {},
    function tavernDataChangeAffectsStub() { return false },
    function downloadTavernBlobStub(blob, filename) {
      if (env.onDownload) env.onDownload(blob, filename)
    },
    function notifyTavernDataChangedStub() {},
    function InlineFieldStub(props) {
      return React.createElement('select', {
        'aria-label': props.label,
        value: props.value,
        disabled: props.disabled,
        onChange: event => props.onCommit && props.onCommit(event.target.value)
      }, (props.options || []).map(opt => React.createElement('option', { key: opt.value, value: opt.value }, opt.label)))
    },
    function SwitchStub(props) {
      return React.createElement('input', {
        type: 'checkbox',
        'aria-label': props.label,
        checked: Boolean(props.checked),
        disabled: props.disabled,
        onChange: event => props.onChange && props.onChange(event.target.checked)
      })
    }
  )

  feature.register({
    ctx: {
      effect(fn) { return fn() },
      betterSidebar: {
        registerTab(tab) {
          registeredTab = tab
          return () => {}
        }
      }
    }
  })
  assert.ok(registeredTab && typeof registeredTab.component === 'function', '应成功注册 dsh-tavern:transfer 面板')
  return registeredTab.component
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function clickElement(element) {
  assert.ok(element, '目标可点击元素不应为空')
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
}

test('createTransferExport 支持 exportId 实时上报板块与条目进度，完成后自动清理', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tavern-export-progress-'))
  const saveGate1 = deferred()
  const saveGate2 = deferred()
  const snapshots = []

  const handlers = createTransferHandlers({
    dataRoot: path.join(dir, 'data'),
    uploads: { async take() { throw new Error('unused') } },
    fileResources: {
      async list(kind) { return kind === 'card' ? ['cards/alice.json'] : [] },
      async readText() { return JSON.stringify({ name: '爱丽丝' }) },
      absolute(rel) { return path.join(dir, 'data', rel) }
    },
    worldBooks: { async catalog() { return { standalone: [] } }, async characterBookForCard() { return null }, async remove() {} },
    presetLibrary: { async catalog() { return { presets: [] } } },
    promptDocuments: { export() { return { name: '默认提示词', prompts: {} } } },
    userPreferenceProfile: { async read() { return { profiles: [] } } },
    regexManager: { async read() { return { global: [] } } },
    readTavernSettings: () => ({ promptSets: { sets: [] } }),
    updateTavernSettings: async () => ({}),
    importCard: async () => ({}),
    importPreset: async () => ({}),
    readCardWorkspace: async () => ({ name: '爱丽丝' }),
    cardPreparation: { present: ({ card }) => ({ spec: 'chara_card_v3', data: { name: card.name } }) },
    TAVERN_PACKAGE_VERSION: '3.3.0',
    listTavernSessions: async () => [
      { id: 'chat-1', sessionId: 'sess-1', title: '雨夜序章', cardName: '爱丽丝', mode: 'story' },
      { id: 'chat-2', sessionId: 'sess-2', title: '黎明终章', cardName: '爱丽丝', mode: 'story' }
    ],
    readChat: async () => ({ messages: [] }),
    exportGameSave: async sessionId => {
      if (sessionId === 'sess-1') await saveGate1.promise
      if (sessionId === 'sess-2') await saveGate2.promise
      return { filename: sessionId + '.dshsave', base64: Buffer.from('save-' + sessionId).toString('base64') }
    },
    importGameSave: async () => null,
    userPluginInstaller: { pluginsDir: path.join(dir, 'plugins'), async list() { return [] } },
    pluginDataStore: {},
    tavernSkills: { async list() { return [] } },
    transferExports: null,
    exportTavernLogs: async () => null,
    deleteCard: async () => {},
    deletePreset: async () => {},
    deleteResource: async () => {},
    readRawTavernSettings: async () => null,
    updateChat: async () => {},
    assetLibrary: null,
    profileData: null
  })

  const exportPromise = handlers.createTransferExport({
    exportId: 'exp-test-1',
    selection: {
      cards: ['cards/alice.json'],
      chats: ['chat-1', 'chat-2']
    }
  })

  await new Promise(resolve => setTimeout(resolve, 15))
  snapshots.push(await handlers.getTransferExportProgress({ exportId: 'exp-test-1' }))
  assert.equal(snapshots[0].running, true)
  assert.equal(snapshots[0].label, '对话与存档')
  assert.equal(snapshots[0].itemTitle, '雨夜序章')
  assert.equal(snapshots[0].items, 1, '已完成 1 张人物卡，正在导出第 1 局对话')
  assert.equal(snapshots[0].total, 3)

  saveGate1.resolve()
  await new Promise(resolve => setTimeout(resolve, 15))
  snapshots.push(await handlers.getTransferExportProgress({ exportId: 'exp-test-1' }))
  assert.equal(snapshots[1].running, true)
  assert.equal(snapshots[1].label, '对话与存档')
  assert.equal(snapshots[1].itemTitle, '黎明终章')
  assert.equal(snapshots[1].items, 2, '第 1 局对话已完成，正在导出第 2 局对话')
  assert.equal(snapshots[1].total, 3)

  saveGate2.resolve()
  const exported = await exportPromise
  assert.equal(exported.totals.items, 3)

  const afterDone = await handlers.getTransferExportProgress({ exportId: 'exp-test-1' })
  assert.equal(afterDone.running, false, '导出结束后进度记录应立即释放')
})

test('迁移面板未获得目录数据前显示加载提示而非空白，失败后支持重新加载，导出与读取导入包时展示实时进度', async t => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const reactRoot = createRoot(host)
  t.after(async () => {
    await act(async () => { reactRoot.unmount() })
    host.remove()
  })

  let catalogGate = deferred()
  let exportGate = deferred()
  let previewGate = deferred()
  let uploadGate = deferred()
  let currentExportProgress = { running: false }
  const calls = []
  const downloaded = []

  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => uploadGate.promise
  t.after(() => { globalThis.fetch = previousFetch })

  const Panel = loadTransferPanelComponent({
    onDownload(blob, filename) { downloaded.push({ size: blob.size, filename }) },
    rpc(method, args) {
      calls.push({ method, args })
      if (method === 'getTransferCatalog') return catalogGate.promise
      if (method === 'createTransferExport') return exportGate.promise
      if (method === 'getTransferExportProgress') return Promise.resolve(currentExportProgress)
      if (method === 'previewTransferBundle') return previewGate.promise
      return Promise.resolve({})
    }
  })

  await act(async () => {
    reactRoot.render(React.createElement(Panel, { scope: { sessionId: 'sess-ui' }, visible: true }))
  })

  // 1. 未获得目录数据前：显示明确的加载中状态与不确定进度条，而不是空白
  assert.match(host.textContent, /正在加载可迁移的数据…/)
  assert.match(host.textContent, /正在读取本机人物卡、世界书、预设与对话记录/)
  assert.ok(host.querySelector('.dsh-tavern-transfer-meter.is-indeterminate'), '未获得数据前应渲染加载进度指示条')
  const refreshBtnLoading = Array.from(host.querySelectorAll('button')).find(btn => btn.textContent.includes('加载中…'))
  assert.ok(refreshBtnLoading && refreshBtnLoading.disabled, '加载目录期间右上角刷新按钮应显示加载中并禁用')

  // 2. 首次请求失败：不显示空白，提供重新加载入口
  await act(async () => {
    catalogGate.reject(new Error('目录服务繁忙'))
    await catalogGate.promise.catch(() => {})
  })
  await flushMicrotasks()
  assert.match(host.textContent, /未能获取本机可迁移数据/)
  const reloadBtn = Array.from(host.querySelectorAll('button')).find(btn => btn.textContent === '重新加载')
  assert.ok(reloadBtn, '加载失败未获得数据时应提供重新加载按钮')

  // 3. 点击重新加载并成功返回目录
  catalogGate = deferred()
  await act(async () => { clickElement(reloadBtn) })
  assert.match(host.textContent, /正在加载可迁移的数据…/)

  await act(async () => {
    catalogGate.resolve({
      groups: [{ id: 'story', title: '故事与记录' }],
      parts: [{
        kind: 'chats',
        group: 'story',
        label: '对话与存档',
        unit: '局',
        supported: true,
        note: '一局一个 .dshsave',
        items: [
          { key: 'chat-1', title: '雨夜序章', meta: '5 轮', bytes: 0 },
          { key: 'chat-2', title: '黎明终章', meta: '8 轮', bytes: 0 }
        ]
      }]
    })
    await catalogGate.promise
  })
  await flushMicrotasks()
  assert.doesNotMatch(host.textContent, /正在加载可迁移的数据…/)
  assert.match(host.textContent, /对话与存档/)

  // 4. 勾选全部并点击「生成导出包」：立即出现导出进度条，并随轮询更新板块与条目进度
  const selectAllChip = Array.from(host.querySelectorAll('button')).find(btn => btn.textContent === '全部')
  await act(async () => { clickElement(selectAllChip) })

  currentExportProgress = {
    running: true,
    stage: 'item',
    kind: 'chats',
    label: '对话与存档',
    itemTitle: '黎明终章',
    items: 1,
    total: 2,
    elapsedMs: 3000
  }
  const exportBtn = Array.from(host.querySelectorAll('button')).find(btn => btn.textContent === '生成导出包')
  await act(async () => { clickElement(exportBtn) })
  await flushMicrotasks()

  const exportCall = calls.find(entry => entry.method === 'createTransferExport')
  assert.ok(exportCall && typeof exportCall.args.exportId === 'string' && exportCall.args.exportId.length > 0, 'createTransferExport 应携带 exportId')

  const exportBar = host.querySelector('.dsh-tavern-transfer-progress.is-export-bar')
  assert.ok(exportBar, '导出进行中应展示导出进度条面板')
  assert.match(exportBar.textContent, /正在导出 · 对话与存档 \(1\/2\)/)
  assert.match(exportBar.textContent, /当前：黎明终章/)
  assert.match(exportBar.textContent, /45%/)
  const progressBar = exportBar.querySelector('[role="progressbar"]')
  assert.equal(progressBar.getAttribute('aria-valuenow'), '45')

  await act(async () => {
    exportGate.resolve({
      filename: 'DSH酒馆备份-测试.dshtransfer',
      name: 'DSH酒馆备份-测试',
      base64: Buffer.from('PK\x05\x06' + '\x00'.repeat(18)).toString('base64'),
      bytes: 22,
      totals: { items: 2, bytes: 22 },
      parts: [{ kind: 'chats', label: '对话与存档', items: 2, bytes: 22 }]
    })
    await exportGate.promise
  })
  await flushMicrotasks()
  assert.equal(host.querySelector('.dsh-tavern-transfer-progress.is-export-bar'), null, '导出完成后进度面板应收起')
  assert.equal(downloaded.length, 1)
  assert.match(host.textContent, /DSH酒馆备份-测试\.dshtransfer/)

  // 5. 切到「导入」界面读取迁移包：上传与解析阶段均展示加载中提示
  const importTabBtn = Array.from(host.querySelectorAll('.dsh-tavern-transfer-mode')).find(btn => btn.textContent === '导入')
  await act(async () => { clickElement(importTabBtn) })

  const fileInput = host.querySelector('input[type="file"]')
  const fakeFile = new dom.window.File(['dummy-zip'], '迁移测试包.dshtransfer', { type: 'application/octet-stream' })
  Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true })
  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  assert.match(host.textContent, /正在上传 迁移测试包\.dshtransfer…/)

  await act(async () => {
    uploadGate.resolve({ ok: true, status: 200, async json() { return { ok: true, uploadId: 'up-1' } } })
    await uploadGate.promise
  })
  await flushMicrotasks()
  assert.match(host.textContent, /正在读取 迁移测试包\.dshtransfer…/)
  assert.match(host.textContent, /正在解析并校验包内文件与本机冲突/)

  await act(async () => {
    previewGate.resolve({
      token: 'tok-1',
      bundle: {
        name: '迁移测试包',
        bytes: 128,
        parts: [{
          kind: 'cards',
          label: '人物卡',
          importable: true,
          conflicts: 0,
          items: [{ key: 'cards/a.json', title: '爱丽丝', bytes: 64, usable: true }]
        }]
      }
    })
    await previewGate.promise
  })
  await flushMicrotasks()
  assert.match(host.textContent, /迁移测试包/)
  assert.match(host.textContent, /人物卡/)
  assert.match(host.textContent, /确认导入/)
  const expandCardsBtn = host.querySelector('button[aria-label="展开人物卡"]')
  await act(async () => { clickElement(expandCardsBtn) })
  assert.match(host.textContent, /爱丽丝/)
})
