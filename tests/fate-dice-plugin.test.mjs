// 命运之骰内置插件：打包同步、清单登记、安装产物与宿主半 RPC 接线。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { apply as applyFateDicePlugin, DEFAULT_GLOBAL_SETTINGS, PLUGIN_VERSION } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/index.js'
import { buildFateDiceClient } from '../tavern-plugin/packages/dsh-tavern-fate-dice/build.mjs'
import {
  BUNDLED_TAVERN_PLUGINS,
  SOURCE_FILE,
  installBundledTavernPlugins,
  readBundledTavernPlugin,
} from '../bin/bundled-tavern-plugins.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGE_ROOT = new URL('../tavern-plugin/packages/dsh-tavern-fate-dice/', import.meta.url)
const PLUGIN_NAME = 'dsh-tavern-fate-dice'
const quiet = { warn() {}, log() {} }

function createPluginFiber(pluginName, parentService) {
  const cleanups = []
  const ctx = {
    fiber: { name: pluginName },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
  }
  const boundService = Object.create(parentService, {
    ctx: { value: ctx, enumerable: false },
  })
  return {
    ctx: {
      tavern: boundService,
      inject(_deps, cb) {
        if (typeof cb === 'function') cb({ llm: null })
      },
      effect: fn => {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
        return dispose
      },
    },
    settle(result) {
      if (typeof result === 'function') cleanups.push(result)
    },
    dispose() {
      for (const fn of cleanups.splice(0)) fn()
    },
  }
}

test('内置命运之骰插件包 client.js 与源码保持同步', async () => {
  const res = await buildFateDiceClient({ check: true, packageRoot: PACKAGE_ROOT })
  assert.equal(res.changed, false)
})

test('命运之骰插件包清单与 cordis.patch.yml 符合内置插件契约', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', PACKAGE_ROOT), 'utf8'))
  assert.equal(pkg.name, PLUGIN_NAME)
  assert.equal(pkg.version, PLUGIN_VERSION)
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [])
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(pkg.dsh?.client?.inject?.includes('dsh-tavern-plugin'))
  assert.equal(pkg.dsh?.compatibility?.tavernApiVersion, 8)
  const patchText = await readFile(new URL('cordis.patch.yml', PACKAGE_ROOT), 'utf8')
  assert.match(patchText, /id:\s*dsh-tavern-fate-dice/)
})

test('命运之骰已登记到 BUNDLED_TAVERN_PLUGINS，且可安装到 plugins/ 并排除构建输入', () => {
  const entry = BUNDLED_TAVERN_PLUGINS.find(item => item.folder === PLUGIN_NAME)
  assert.ok(entry, 'BUNDLED_TAVERN_PLUGINS 缺少 dsh-tavern-fate-dice')
  const readRes = readBundledTavernPlugin(REPO_ROOT, entry)
  assert.equal(readRes.ok, true, readRes.reason)

  const dataRoot = mkdtempSync(path.join(tmpdir(), 'tavern-fate-dice-data-'))
  try {
    const results = installBundledTavernPlugins({ sourceRoot: REPO_ROOT, dataRoot, logger: quiet })
    const res = results.find(item => item.packageName === PLUGIN_NAME)
    assert.ok(res)
    assert.equal(res.action, 'installed')
    const target = path.join(dataRoot, 'plugins', PLUGIN_NAME)
    for (const file of ['package.json', 'lib/index.js', 'client.js', 'cordis.patch.yml', SOURCE_FILE]) {
      assert.ok(existsSync(path.join(target, file)), '缺少 ' + file)
    }
    for (const file of ['build.mjs', 'src']) {
      assert.equal(existsSync(path.join(target, file)), false, file + ' 不该进插件目录')
    }
    const sourceRecord = JSON.parse(readFileSync(path.join(target, SOURCE_FILE), 'utf8'))
    assert.equal(sourceRecord.kind, 'builtin')
    assert.equal(sourceRecord.bundled, true)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('宿主半能挂上 createTavernPluginApi 并注册 fate-dice:* RPC，停用后清理', async () => {
  const api = createTavernPluginApi({
    ctx: {},
    loaderOrigin: () => 'host',
  })
  const fiber = createPluginFiber(PLUGIN_NAME, api.service)
  const dispose = applyFateDicePlugin(fiber.ctx)
  fiber.settle(dispose)

  const freeRoll = await api.callHandler('fate-dice:free-roll', { expression: '1d20' })
  assert.equal(freeRoll.ok, true)
  assert.ok(freeRoll.result.total >= 1 && freeRoll.result.total <= 20)

  const workbench = await api.callHandler('fate-dice:workbench', {})
  assert.ok(workbench && typeof workbench === 'object')
  assert.equal(DEFAULT_GLOBAL_SETTINGS.enabled, false)
  assert.equal(DEFAULT_GLOBAL_SETTINGS.animation, 'atelier')
  assert.equal(workbench.settings?.enabled, false)
  assert.equal(workbench.settings?.animation, 'atelier')

  for (const skin of ['pixel', 'etching', 'urushi', 'bauhaus', 'murano', 'bounce', 'atelier']) {
    const skinRes = await api.callHandler('fate-dice:save-global-settings', { settings: { animation: skin } })
    assert.equal(skinRes.ok, true)
    assert.equal(skinRes.settings?.animation, skin)
  }

  const invalidSkinRes = await api.callHandler('fate-dice:save-global-settings', { settings: { animation: 'non-existent-skin' } })
  assert.equal(invalidSkinRes.settings?.animation, 'atelier')

  const enabledRes = await api.callHandler('fate-dice:save-global-settings', { settings: { enabled: true } })
  assert.equal(enabledRes.ok, true)
  assert.equal(enabledRes.settings?.enabled, true)

  const workbenchAfterEnable = await api.callHandler('fate-dice:workbench', {})
  assert.equal(workbenchAfterEnable.settings?.enabled, true)

  const disabledRes = await api.callHandler('fate-dice:save-global-settings', { settings: { enabled: false } })
  assert.equal(disabledRes.ok, true)
  assert.equal(disabledRes.settings?.enabled, false)

  const clientText = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  assert.match(clientText, /启用命运之骰/)
  for (const label of ['绅士赌桌', '勇者地牢', '达芬奇手稿', '京都黑漆', '包豪斯白瓷', '深海星仪']) {
    assert.ok(clientText.includes(label), `client.js 缺少典藏皮肤文案：${label}`)
  }

  fiber.dispose()
  await assert.rejects(api.callHandler('fate-dice:free-roll', { expression: '1d20' }), /没有名为 fate-dice:free-roll 的插件处理函数/)
})

test('服务端 fate-dice:read-turns：空局零历史扫描，开启态命中内存锁与正负缓存并在时间线变更时精准失效', async () => {
  const gameStore = new Map()
  const turnStore = new Map()
  const handlers = new Map()
  const turnSections = []
  const settledListeners = []
  const timelineListeners = []
  const stats = {
    readGameData: 0,
    saveGameData: 0,
    readTurnData: 0,
    saveTurnData: 0,
    getTurnState: 0,
  }
  let currentLiveTurn = 0

  const tavern = {
    capabilities: { narrativeDamper: false },
    handle(name, fn) {
      handlers.set(name, fn)
    },
    turnSection(spec) {
      turnSections.push(spec)
    },
    settlementSection() {},
    settlementTool() {},
    onTurnSettled(fn) {
      settledListeners.push(fn)
    },
    onTimelineChanged(fn) {
      timelineListeners.push(fn)
    },
    onGameRemoved() {},
    async publishState() {},
    async readGameData({ gameId }) {
      stats.readGameData += 1
      return gameStore.has(gameId) ? structuredClone(gameStore.get(gameId)) : null
    },
    async saveGameData({ gameId, data }) {
      stats.saveGameData += 1
      gameStore.set(gameId, structuredClone(data))
    },
    async readTurnData({ gameId, turn }) {
      stats.readTurnData += 1
      const key = `${gameId}:${turn}`
      return turnStore.has(key) ? structuredClone(turnStore.get(key)) : null
    },
    async saveTurnData({ gameId, turn, textVersion, data }) {
      stats.saveTurnData += 1
      turnStore.set(`${gameId}:${turn}`, {
        turn,
        textVersion: textVersion ?? null,
        data: structuredClone(data),
      })
    },
    async getTurnState() {
      stats.getTurnState += 1
      return currentLiveTurn > 0 ? { turn: currentLiveTurn, settled: true, greeting: false } : { turn: 0, settled: true, greeting: false }
    },
    async variables() {
      return {}
    },
  }

  const cleanups = []
  const dispose = applyFateDicePlugin({
    tavern,
    inject(_deps, cb) {
      if (typeof cb === 'function') cb({ llm: null })
    },
    effect(fn) {
      const off = fn()
      if (typeof off === 'function') cleanups.push(off)
      return off
    },
  })
  if (typeof dispose === 'function') cleanups.push(dispose)

  try {
    const readTurns = handlers.get('fate-dice:read-turns')
    const saveSettings = handlers.get('fate-dice:save-global-settings')
    assert.equal(typeof readTurns, 'function')
    assert.equal(typeof saveSettings, 'function')

    const thirtyTurns = Array.from({ length: 30 }, (_, idx) => idx + 1)

    // 1. 默认关闭态空局：一次批量读 30 层楼，不应触发任何底层 readTurnData 历史扫描与 getTurnState
    const offRes = await readTurns({ gameId: 'game-empty', turns: thirtyTurns })
    assert.equal(offRes.ok, true)
    assert.equal(offRes.enabled, false)
    assert.equal(stats.readTurnData, 0)
    assert.equal(stats.getTurnState, 0)
    for (const t of thirtyTurns) {
      assert.equal(offRes.turns[String(t)], null)
    }

    // 二次批量读同一空局：命中内存缓存，连 readGameData 都为 0 次新增
    const readsBeforeSecond = stats.readGameData
    await readTurns({ gameId: 'game-empty', turns: thirtyTurns })
    assert.equal(stats.readGameData, readsBeforeSecond)
    assert.equal(stats.readTurnData, 0)

    // 2. 开启命运之骰并走完 3 轮真实检定与落盘结算
    await saveSettings({
      settings: {
        enabled: true,
        alwaysRoll: true,
        allowHeuristicFallback: true,
        preSendPause: false,
      },
    })
    assert.equal(turnSections.length, 1)

    for (let turn = 1; turn <= 3; turn += 1) {
      currentLiveTurn = turn
      const injected = await turnSections[0].text({
        gameId: 'game-active',
        turn,
        input: `第 ${turn} 轮玩家尝试撬开沉重的锈蚀铁锁`,
      })
      assert.ok(typeof injected === 'string' && injected.length > 0)
      for (const listener of settledListeners) {
        await listener({ gameId: 'game-active', turn, textVersion: `v-${turn}` })
      }
    }

    // 首次批量读取 30 层楼（1..3 有检定锁，4..30 为空）：
    // 1..3 直接命中 game.settledRolls 内存 O(1) 快路径，无需调用 readTurnData
    const turnReadsBeforeActiveBatch = stats.readTurnData
    const gameReadsBeforeActiveBatch = stats.readGameData
    const activeBatch = await readTurns({
      gameId: 'game-active',
      turns: thirtyTurns,
      includeLatest: true,
      latestTurn: 3,
    })
    assert.equal(activeBatch.ok, true)
    assert.equal(activeBatch.enabled, true)
    assert.equal(stats.readGameData, gameReadsBeforeActiveBatch, 'writeGame 已写穿缓存，批量读取无需重读磁盘')
    assert.ok(activeBatch.turns['1']?.roll, '第 1 轮应返回检定骰点')
    assert.ok(activeBatch.turns['2']?.roll, '第 2 轮应返回检定骰点')
    assert.ok(activeBatch.turns['3']?.roll, '第 3 轮应返回检定骰点')
    assert.equal(activeBatch.turns['1'].rerollState?.allowed, false, '历史第 1 轮已自动锁定不可重投')
    assert.equal(activeBatch.turns['2'].rerollState?.allowed, false, '历史第 2 轮已自动锁定不可重投')
    assert.equal(activeBatch.latest?.turn, 3)
    // 1..3 命中 settledRolls 零 readTurnData，仅 4..30 首次做负缓存探测
    assert.equal(stats.readTurnData - turnReadsBeforeActiveBatch, 27)

    // 紧接着二次批量读取同一 30 层楼：正缓存 + null 负缓存全部命中，底层 I/O 完全为 0
    const snapReads = { ...stats }
    const cachedBatch = await readTurns({ gameId: 'game-active', turns: thirtyTurns })
    assert.equal(cachedBatch.turns['3']?.roll?.total, activeBatch.turns['3']?.roll?.total)
    assert.equal(stats.readGameData, snapReads.readGameData)
    assert.equal(stats.readTurnData, snapReads.readTurnData)

    // 3. 时间线变更（删楼/回退）后，缓存精准失效，重读会同步最新磁盘状态
    const mutatedGame = structuredClone(gameStore.get('game-active'))
    delete mutatedGame.settledRolls['3']
    mutatedGame.lastTurn = 2
    gameStore.set('game-active', mutatedGame)
    turnStore.delete('game-active:3')
    currentLiveTurn = 2
    for (const listener of timelineListeners) {
      listener({ gameId: 'game-active', kind: 'delete', turn: 2 })
    }

    const afterDelete = await readTurns({ gameId: 'game-active', turns: [1, 2, 3] })
    assert.ok(stats.readGameData > snapReads.readGameData, '时间线变更后应失效并重读最新局数据')
    assert.equal(afterDelete.turns['3'], null, '被删掉的第 3 轮不应残留旧缓存')
    assert.ok(afterDelete.turns['2']?.roll, '保留的第 2 轮仍正常返回')
  } finally {
    for (const fn of cleanups.splice(0)) fn()
  }
})

test('客户端合批与缓存：同帧 30 层并发合并为 1 次 RPC、二次读取零请求、局部失效与关闭态短路', async () => {
  const clientCode = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let loadedFactory = null
  const sandbox = {
    console: quiet,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Map,
    Set,
    WeakMap,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Date,
    JSON,
    RegExp,
    Error,
    Uint8Array,
    Float32Array,
    Uint16Array,
    Int32Array,
    window: {
      __ModuleLoader__: {
        load(spec) {
          loadedFactory = spec.factory
        },
      },
      location: { search: '', hash: '', pathname: '/' },
      addEventListener() {},
      removeEventListener() {},
    },
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'dsh-tavern-fate-dice/client.js' })
  assert.equal(typeof loadedFactory, 'function')

  const minimalReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect() {},
    useMemo: fn => fn(),
    useRef: init => ({ current: init }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
  }
  const mod = loadedFactory(id => {
    if (id === 'react') return minimalReact
    throw new Error('unexpected require: ' + id)
  })
  const {
    fdReadTurnBatched,
    fdInvalidateTurnCache,
    fdNoteRuntimeFlags,
    fdMayNeedPreSendGate,
    fdLoadWorkbench,
  } = mod.__test

  const calls = []
  const ui = {
    async callHost(rpc, payload) {
      calls.push({ rpc, payload: structuredClone(payload) })
      if (rpc === 'fate-dice:read-turns') {
        const turnsOut = {}
        for (const t of payload.turns || []) {
          if (t === 29) {
            turnsOut['29'] = {
              gameId: payload.gameId,
              turn: 29,
              enabled: true,
              autoCheck: true,
              roll: { total: 5, tier: 'failure', tierLabel: '失败', check: '潜行', dice: [2, 3], rule: '2d6' },
              rerollState: { allowed: true, canFate: true, canPush: true },
            }
          } else if (t === 30) {
            turnsOut['30'] = {
              gameId: payload.gameId,
              turn: 30,
              enabled: true,
              autoCheck: true,
              roll: { total: 9, tier: 'success', tierLabel: '成功', check: '交涉', dice: [4, 5], rule: '2d6' },
              rerollState: { allowed: false, reason: '成功无需重投' },
            }
          } else {
            turnsOut[String(t)] = null
          }
        }
        return {
          ok: true,
          gameId: payload.gameId,
          enabled: true,
          autoCheck: true,
          preSendPause: false,
          turns: turnsOut,
          latest: null,
        }
      }
      if (rpc === 'fate-dice:workbench') {
        return {
          ok: true,
          gameId: payload.gameId,
          settings: { enabled: true, preSendPause: false },
          judgeStatus: { available: true, provider: 'gemini' },
          summary: { total: 2, counts: { success: 1, failure: 1 }, recent: [] },
          fate: { points: 2, max: 3, failCount: 1 },
        }
      }
      if (rpc === 'fate-dice:status') {
        return { ok: true, gameId: payload.gameId }
      }
      return null
    },
  }

  // 1. 同一帧并发读取 30 层楼 -> 合并为唯一 1 次 fate-dice:read-turns RPC
  const thirty = Array.from({ length: 30 }, (_, i) => i + 1)
  const firstResults = await Promise.all(
    thirty.map(turn => fdReadTurnBatched(ui, { gameId: 'g-batch', turn }))
  )
  assert.equal(calls.length, 1, '30 层楼并发读取必须合批为单次 RPC')
  assert.equal(calls[0].rpc, 'fate-dice:read-turns')
  assert.equal(calls[0].payload.turns.length, 30)
  assert.equal(firstResults[28].data?.roll?.total, 5)
  assert.equal(firstResults[29].data?.roll?.total, 9)
  assert.equal(firstResults[0].data, null)

  // 2. 二次读取同一 30 层楼 -> 全部命中客户端正/负缓存，0 次 RPC
  const secondResults = await Promise.all(
    thirty.map(turn => fdReadTurnBatched(ui, { gameId: 'g-batch', turn }))
  )
  assert.equal(calls.length, 1, '命中客户端缓存时不应再发任何 RPC')
  assert.equal(secondResults[28].cached, true)
  assert.equal(secondResults[0].cached, true)

  // 3. 新一轮结算局部失效：只失效目标轮（30）与此前允许重投的上一轮（29），1..28 保持缓存
  const affected = fdInvalidateTurnCache('g-batch', 30).sort((a, b) => a - b)
  assert.deepEqual(affected, [29, 30])
  await Promise.all(thirty.map(turn => fdReadTurnBatched(ui, { gameId: 'g-batch', turn })))
  assert.equal(calls.length, 2, '局部失效后重读整屏只需补发 1 次增量合批')
  assert.deepEqual(calls[1].payload.turns.sort((a, b) => a - b), [29, 30])

  // 4. 工作台加载：fate-dice:workbench 已返回完整状态时，不再重复串行调 fate-dice:status
  calls.length = 0
  const wb = await fdLoadWorkbench(ui, 'g-batch')
  assert.equal(wb.settings.enabled, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].rpc, 'fate-dice:workbench')

  // 5. 关闭态与未开启发前暂停：发前闸门与流式楼层读取直接零请求短路
  assert.equal(fdMayNeedPreSendGate('g-batch'), false, '开启命运之骰但未开 preSendPause 时不应触发 gate-peek')
  fdNoteRuntimeFlags('g-disabled', { settings: { enabled: false, preSendPause: true } })
  assert.equal(fdMayNeedPreSendGate('g-disabled'), false, '插件关闭时不应触发 gate-peek')
  calls.length = 0
  const streamOff = await fdReadTurnBatched(ui, { gameId: 'g-disabled', turn: 8, streaming: true })
  assert.equal(streamOff.ok, true)
  assert.equal(streamOff.data, null)
  assert.equal(calls.length, 0, '插件关闭态下流式读取必须零请求短路')
})

test('逆命重投与孤注一掷：长按蓄力与点按即投具备差异化刚体运动学，且 UI 完整透传蓄力能量', async () => {
  const clientCode = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let loadedFactory = null
  let fakeNow = 1000
  const docNodes = []
  const makeFakeEl = tag => {
    const listeners = new Map()
    const classes = new Set()
    const attrs = new Map()
    const styleStore = new Map()
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      className: '',
      textContent: '',
      disabled: false,
      hidden: false,
      clientWidth: 860,
      clientHeight: 280,
      width: 860,
      height: 280,
      children: [],
      parentNode: null,
      ownerDocument: null,
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: c => classes.has(c),
      },
      style: {
        setProperty: (k, v) => styleStore.set(k, String(v)),
        removeProperty: k => styleStore.delete(k),
        getPropertyValue: k => styleStore.get(k) || '',
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      appendChild(child) {
        child.parentNode = el
        el.children.push(child)
        return child
      },
      removeChild(child) {
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = null
        return child
      },
      querySelector(sel) {
        if (sel === '.fd-reroll-btn-title') {
          return el.children.find(c => String(c.className || '').includes('fd-reroll-btn-title')) || null
        }
        return null
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, [])
        listeners.get(ev).push(fn)
      },
      dispatch(ev, payload = {}) {
        for (const fn of listeners.get(ev) || []) fn(payload)
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 860, bottom: 280, width: 860, height: 280 }),
      get isConnected() {
        return Boolean(el.parentNode)
      },
    }
    docNodes.push(el)
    return el
  }

  const fakeBody = makeFakeEl('body')
  const fakeDoc = {
    body: fakeBody,
    createElement: tag => {
      const node = makeFakeEl(tag)
      node.ownerDocument = fakeDoc
      return node
    },
    querySelectorAll: () => [],
  }
  fakeBody.ownerDocument = fakeDoc

  const sandbox = {
    console: quiet,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    Promise,
    Map,
    Set,
    WeakMap,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Math,
    Date,
    JSON,
    RegExp,
    Error,
    Uint8Array,
    Float32Array,
    Uint16Array,
    Int32Array,
    performance: { now: () => fakeNow },
    document: fakeDoc,
    window: {
      __ModuleLoader__: {
        load(spec) {
          loadedFactory = spec.factory
        },
      },
      innerWidth: 1280,
      innerHeight: 820,
      devicePixelRatio: 1,
      location: { search: '', hash: '', pathname: '/' },
      addEventListener() {},
      removeEventListener() {},
    },
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'dsh-tavern-fate-dice/client.js' })

  let capturedHoldTrigger = null
  const minimalReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect() {},
    useMemo: fn => fn(),
    useRef: init => ({ current: init }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
  }
  const mod = loadedFactory(id => {
    if (id === 'react') return minimalReact
    throw new Error('unexpected require: ' + id)
  })
  const {
    FD3D,
    FdRerollActionBox,
    fdAttachHoldChargeToDomBtn,
    fdPlayFloorRollAnim,
    fdGetPrimaryFloorRollOverlay,
    fdDisposeFloorRollOverlay,
  } = mod.__test

  // 1. 刚体舞台：验证 normal / fate / push 在点按与长按蓄力下的差异化运动学与逆命穹顶慢镜
  const mockRenderer = {
    resize() {},
    render() {},
    projectToUV: () => ({ u: 0.5, v: 0.5, visible: true }),
    unprojectToPlane: () => ({ x: 0, y: 0, z: 85 }),
  }
  const audioLog = []
  const mockAudio = {
    startChargeHum: (preset, mode) => audioLog.push(['hum', preset, mode]),
    updateChargeHum() {},
    stopChargeHum: () => audioLog.push(['stopHum']),
    playChargeRattle: (_preset, amp) => audioLog.push(['rattle', amp]),
    playFateApexChime: (_preset, pwr) => audioLog.push(['apexChime', pwr]),
    playThrowWhoosh: (_preset, pwr, mode) => audioLog.push(['whoosh', mode, pwr]),
    playBounce() {},
    playSettle() {},
  }
  const stage = new FD3D.CinematicDiceStage(makeFakeEl('canvas'), null, {
    _preRenderer: mockRenderer,
    audio: mockAudio,
    interactive: false,
    theater: true,
  })
  stage.stop()

  const baseDiceSpecs = [
    { meshKey: 'd6', sides: 6, targetValue: 6 },
    { meshKey: 'd6', sides: 6, targetValue: 5 },
  ]

  // 1A) 普通短按 vs 普通长按蓄力
  stage.throwDice({ diceSpecs: baseDiceSpecs, mode: 'normal', tier: 'success' })
  stage.stop()
  const normalTapSpeed = stage.dice[0].trajSpeed[0]
  const normalTapStartX = Math.abs(stage.dice[0].trajPos[0])

  stage.startButtonCharge('normal')
  for (let i = 0; i < 20; i++) stage._step(0.04)
  assert.equal(stage.charging, true)
  assert.equal(stage.chargeMode, 'normal')
  stage.releaseButtonCharge({ diceSpecs: baseDiceSpecs, mode: 'normal', tier: 'success' }, 0.9)
  stage.stop()
  const normalHoldSpeed = stage.dice[0].trajSpeed[0]
  const normalHoldStartX = Math.abs(stage.dice[0].trajPos[0])
  assert.ok(normalHoldSpeed > normalTapSpeed + 120, `普通长按蓄力初速(${normalHoldSpeed})应明显高于普通短按(${normalTapSpeed})`)
  assert.ok(normalHoldStartX < normalTapStartX * 0.65, '普通长按释放应从中央空中旋涡无缝甩出而非退回两侧边缘')

  // 1B) ✦ 逆命重投：短按原地拔起 vs 长按浑天星轨冲霄 + 穹顶时停凝滞慢镜
  stage.setStaticRoll({ diceSpecs: baseDiceSpecs, mode: 'normal', tier: 'failure' })
  stage.throwDice({ diceSpecs: baseDiceSpecs, mode: 'fate', tier: 'critical' })
  stage.stop()
  const fateTapStartZ = stage.dice[0].trajPos[2]
  let fateTapPeakZ = 0
  for (let s = 0; s < 120; s++) fateTapPeakZ = Math.max(fateTapPeakZ, stage.dice[0].trajPos[s * 3 + 2])
  assert.ok(fateTapStartZ < 42, `短按逆命应从桌面原骰低位(${fateTapStartZ})反重力拔地而起`)
  assert.ok(fateTapPeakZ > fateTapStartZ + 42, '短按逆命应明显拔升至半空翻转改命')
  assert.ok(stage.dice[0].bounces <= 2, '逆命落座应沉稳克制（不超过 2 跳）')

  stage.startButtonCharge('fate')
  for (let i = 0; i < 22; i++) stage._step(0.04)
  assert.equal(stage.chargeMode, 'fate')
  const fateHoverZ = stage.dice[0].z
  assert.ok(fateHoverZ > 65, `逆命长按蓄力应将骰子反重力悬升至空中星轨(${fateHoverZ})`)
  stage.releaseButtonCharge({ diceSpecs: baseDiceSpecs, mode: 'fate', tier: 'critical' }, 1.0)
  stage.stop()
  assert.equal(stage.charging, false)
  assert.ok(stage.dice[0].trajPos[2] > 60, '长按逆命松手应从空中星轨坐标无缝冲霄跃升')
  while (stage.simTime < stage.fateApexTime && !stage.settled) {
    stage._step(0.016)
  }
  stage._step(0.016)
  assert.ok(stage.fateSlowAmount > 0.45, `逆命跃升至最高点时应触发穹顶时停慢镜(fateSlowAmount=${stage.fateSlowAmount})`)
  assert.equal(stage.fateApexChimePlayed, true, '逆命最高点应奏响空灵泛音钟鸣')

  // 1C) 🔥 孤注一掷：短按陡峭俯冲 vs 长按紧攥剧颤 + 雷霆直砸连环高弹
  stage.throwDice({ diceSpecs: baseDiceSpecs, mode: 'push', tier: 'costly' })
  stage.stop()
  const pushTapSpeed = stage.dice[0].trajSpeed[0]
  assert.ok(stage.dice[0].trajPos[6 * 3 + 2] < stage.dice[0].trajPos[2] - 18, '短按孤注应立即向桌面陡峭俯冲重摔')

  const rattleCountBefore = audioLog.filter(x => x[0] === 'rattle').length
  stage.startButtonCharge('push')
  for (let i = 0; i < 24; i++) stage._step(0.04)
  assert.equal(stage.chargeMode, 'push')
  const rattleCountAfter = audioLog.filter(x => x[0] === 'rattle').length
  assert.ok(rattleCountAfter > rattleCountBefore, '孤注长按蓄力紧攥剧颤期间应触发高频磕碰声效')
  stage.releaseButtonCharge({ diceSpecs: baseDiceSpecs, mode: 'push', tier: 'fumble' }, 1.0)
  stage.stop()
  const pushHoldSpeed = stage.dice[0].trajSpeed[0]
  assert.ok(pushHoldSpeed > Math.max(1050, pushTapSpeed + 350), `孤注满蓄力松手应以雷霆初速(${pushHoldSpeed})猛砸桌面`)
  assert.ok(stage.dice[0].bounces >= 4, `孤注猛砸应触发高弹连环碰撞(bounces=${stage.dice[0].bounces})`)

  // SO(3) 终态四元数单位模长校验
  const endQ = (380 - 1) * 4
  const qLen = Math.hypot(
    stage.dice[0].trajQuat[endQ],
    stage.dice[0].trajQuat[endQ + 1],
    stage.dice[0].trajQuat[endQ + 2],
    stage.dice[0].trajQuat[endQ + 3]
  )
  assert.ok(Math.abs(qLen - 1) < 1e-3, '落定四元数必须严格保持单位正交')

  // 1D) 移出取消蓄力：无损还原坐标与临时预览主题
  stage.setTheme(FD3D.resolveTheme('bounce', 'normal', false))
  assert.equal(stage.theme.id, 'astral')
  stage.startButtonCharge('push')
  assert.equal(stage.theme.id, 'inferno')
  stage.cancelButtonCharge()
  assert.equal(stage.charging, false)
  assert.equal(stage.theme.id, 'astral')

  // 2. 原生按钮蓄力控制器与 FdRerollActionBox 能量参数透传校验
  const domBtn = makeFakeEl('button')
  const titleSpan = makeFakeEl('span')
  titleSpan.className = 'fd-reroll-btn-title'
  titleSpan.textContent = '🔥 孤注一掷'
  domBtn.appendChild(titleSpan)

  const triggered = []
  fdAttachHoldChargeToDomBtn(domBtn, {
    mode: 'push',
    getStage: () => stage,
    onTrigger: (m, pwr) => triggered.push([m, pwr]),
    baseLabel: '🔥 孤注一掷',
  })

  // 短按点击 -> power === 0
  fakeNow = 2000
  domBtn.dispatch('pointerdown', { button: 0 })
  fakeNow = 2040
  domBtn.dispatch('pointerup', {})
  assert.deepEqual(triggered.at(-1), ['push', 0])

  // 长按超过阈值 -> 激活蓄力文案与舞台蓄力，松手产出高蓄力 power
  fakeNow = 3000
  domBtn.dispatch('pointerdown', { button: 0 })
  await new Promise(r => setTimeout(r, 165))
  fakeNow = 3920
  assert.equal(stage.charging, true)
  domBtn.dispatch('pointerup', {})
  stage.stop()
  assert.equal(triggered.at(-1)[0], 'push')
  assert.ok(triggered.at(-1)[1] > 0.7, `长按松手应产出高蓄力值(${triggered.at(-1)[1]})`)

  // React FdRerollActionBox 必须将 (mode, power) 两个参数完整转交给 onReroll
  const boxTree = FdRerollActionBox({
    rerollState: { allowed: true, canFate: true, canPush: true, fatePoints: 2, fateMax: 3 },
    fate: { points: 2, max: 3 },
    rerolling: false,
    onReroll: (m, pwr) => { capturedHoldTrigger = [m, pwr] },
  })
  const gridNode = boxTree.children.find(c => c && c.props && c.props.className === 'fd-reroll-grid')
  const fateBtnNode = gridNode.children[0]
  fakeNow = 5000
  fateBtnNode.props.onPointerDown({ button: 0 })
  await new Promise(r => setTimeout(r, 165))
  fakeNow = 5860
  fateBtnNode.props.onPointerUp()
  assert.ok(Array.isArray(capturedHoldTrigger), 'FdRerollActionBox 应触发 onReroll')
  assert.equal(capturedHoldTrigger[0], 'fate')
  assert.ok(capturedHoldTrigger[1] > 0.65, `FdRerollActionBox 不得丢弃长按蓄力参数 power(${capturedHoldTrigger[1]})`)

  // 3. 全宽剧场 ov.rethrow：区分短按 throwDice 与长按 releaseButtonCharge
  const stageCalls = []
  class FakeOverlayStage {
    constructor() {
      this.charging = false
      this.pinSettled = false
    }
    setTheme() {}
    resize() {}
    renderSingleFrame() {}
    stop() {}
    cancelButtonCharge() {
      this.charging = false
      stageCalls.push(['cancel'])
    }
    throwDice(spec) {
      stageCalls.push(['throw', spec.mode, 0])
    }
    releaseButtonCharge(spec, power) {
      this.charging = false
      stageCalls.push(['release', spec.mode, power])
    }
  }

  const dummyEntry = {}
  const initialRoll = { rolledAt: 101, total: 4, dice: [2, 2], tier: 'failure', tierLabel: '失败', check: '开锁', rule: '2d6' }
  const opened = fdPlayFloorRollAnim(null, dummyEntry, initialRoll, 'atelier', {
    _testForceSupported: true,
    _testStageCtor: FakeOverlayStage,
    forceGatePin: true,
  })
  assert.equal(opened, true)
  const ov = fdGetPrimaryFloorRollOverlay()
  assert.ok(ov)

  // 短按逆命重投（power = 0）-> 走纯粹 throwDice，不谎报 0.48 蓄力
  const tapFateRoll = {
    rolledAt: 102,
    total: 10,
    dice: [5, 5],
    tier: 'success',
    tierLabel: '成功',
    check: '开锁',
    rule: '2d6',
    rerollMeta: { mode: 'fate', count: 1 },
  }
  fdPlayFloorRollAnim(null, dummyEntry, tapFateRoll, 'atelier', {
    _testForceSupported: true,
    power: 0,
  })
  assert.deepEqual(stageCalls.at(-1), ['throw', 'fate', 0])
  assert.ok(!ov.kicker.textContent.includes('蓄力'), '短按重投剧场抬头不应显示蓄力百分比')

  // 长按孤注一掷重投（power = 0.88）-> 走 releaseButtonCharge(spec, 0.88) 并在剧场抬头展示蓄力百分比
  const holdPushRoll = {
    rolledAt: 103,
    total: 2,
    dice: [1, 1],
    tier: 'fumble',
    tierLabel: '大失败',
    check: '开锁',
    rule: '2d6',
    rerollMeta: { mode: 'push', count: 1 },
  }
  fdPlayFloorRollAnim(null, dummyEntry, holdPushRoll, 'atelier', {
    _testForceSupported: true,
    power: 0.88,
  })
  assert.deepEqual(stageCalls.at(-1), ['release', 'push', 0.88])
  assert.match(ov.kicker.textContent, /孤注一掷（蓄力 88%）/)

  fdDisposeFloorRollOverlay(dummyEntry)
})


