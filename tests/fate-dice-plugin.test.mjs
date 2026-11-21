// 命运之骰内置插件：打包同步、清单登记、安装产物与宿主半 RPC 接线。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { apply as applyFateDicePlugin, DEFAULT_GLOBAL_SETTINGS } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/index.js'
import { buildFateDiceClient } from '../tavern-plugin/packages/dsh-tavern-fate-dice/build.mjs'

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

test('命运之骰标题旁的滑块在两个页签均可开启和关闭功能', async () => {
  const clientCode = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let mod
  let hook = 0
  let mountPanel
  const values = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = hook++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useRef(initial) {
      const index = hook++
      return values[index] ??= { current: initial }
    },
    useEffect(effect) { mountPanel = effect },
  }
  vm.runInNewContext(clientCode, { console: quiet, window: { __ModuleLoader__: {
    load({ factory }) { mod = factory(() => react) },
  } } })
  const registrations = new Set()
  const register = id => {
    assert.equal(registrations.has(id), false, '每个入口只能注册一次')
    registrations.add(id)
    return () => registrations.delete(id)
  }
  const cleanups = []
  let settings = { enabled: false }
  const ui = {
    registerPanel: () => register('panel'),
    registerMediaRenderer: () => register('capsule'),
    registerTurnView: () => register('turn-view'),
    registerStatusSection: () => register('status'),
    async callHost(name, payload) {
      if (name === 'fate-dice:status' || name === 'fate-dice:workbench') return { settings }
      assert.equal(name, 'fate-dice:save-global-settings')
      settings = payload.settings
      return { ok: true, settings }
    },
  }
  mod.apply({ tavernUi: ui, effect: setup => cleanups.push(setup()) })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([...registrations], ['panel'])

  const renderPanel = () => {
    hook = 0
    const tree = mod.WorkbenchPanel({ ui, gameId: 'g1' })
    const [header, tabBar] = tree.children[0].children
    assert.match(header.children[0].children[0], /命运之骰/)
    const slider = header.children[1].children[0]
    const toggle = slider.type(slider.props).props
    assert.equal(toggle.role, 'switch')
    assert.equal(toggle['aria-label'], '启用命运之骰')
    return { toggle, tabs: tabBar.children[0] }
  }
  assert.equal(renderPanel().toggle.disabled, true)
  const unmountPanel = mountPanel()
  await new Promise(resolve => setImmediate(resolve))
  const checks = renderPanel()
  assert.equal(checks.tabs[0].props['aria-selected'], 'true')
  assert.equal(checks.toggle.disabled, false)
  assert.equal(checks.toggle['aria-checked'], 'false')
  await checks.toggle.onClick()
  assert.deepEqual([...registrations], ['panel', 'capsule', 'turn-view', 'status'])

  checks.tabs[1].props.onClick()
  const config = renderPanel()
  assert.equal(config.tabs[1].props['aria-selected'], 'true')
  assert.equal(config.toggle['aria-checked'], 'true')
  await config.toggle.onClick()
  assert.deepEqual([...registrations], ['panel'])
  assert.equal(renderPanel().toggle['aria-checked'], 'false')
  await renderPanel().toggle.onClick()
  assert.equal(registrations.has('status'), true)

  unmountPanel()
  for (const cleanup of cleanups) cleanup()
  assert.equal(registrations.size, 0)
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

test('关闭命运之骰会撤下画像工具并丢弃待结算的画像', async t => {
  const games = new Map(), handlers = new Map()
  let tool, section, settle
  const tavern = {
    handle: (name, handler) => handlers.set(name, handler),
    settlementSection: value => { section = value },
    settlementTool: value => { tool = value },
    onTurnSettled: handler => { settle = handler },
    readPluginData: async () => ({ settings: { enabled: false, autoCheck: true } }),
    savePluginData: async () => {},
    readGameData: async ({ gameId }) => games.get(gameId),
    saveGameData: async ({ gameId, data }) => games.set(gameId, data)
  }
  const dispose = applyFateDicePlugin({ tavern, inject() {}, effect: run => run() })
  if (typeof dispose === 'function') t.after(dispose)
  const game = { gameId: 'current', turn: 2, textVersion: 'test-v2' }
  const call = { ...game, arguments: { gameId: 'foreign', characterName: '主角' } }
  const configure = settings => handlers.get('fate-dice:save-global-settings')({ settings })

  assert.equal(await tool.enabledFor(game), false)
  assert.equal(await section.text(game), '')
  assert.equal((await tool.execute(call)).ok, false)
  await settle(game)
  assert.equal(games.size, 0)

  await configure({ enabled: true })
  assert.equal(await tool.enabledFor(game), true)
  assert.match(await section.text(game), /fate_dice_profile_sync/)
  assert.equal((await tool.execute(call)).gameId, 'current')
  await configure({ enabled: false })
  await settle(game)
  assert.equal(games.size, 0)

  await configure({ enabled: true })
  await tool.execute(call)
  await settle(game)
  assert.equal(games.get('current')?.characterProfile?.characterName, '主角')
  assert.equal(games.has('foreign'), false)
  await configure({ autoCheck: false })
  assert.equal(await tool.enabledFor(game), false)
  assert.equal((await tool.execute(call)).ok, false)
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

  // 1E) 平贴台面 + 矩阵对位精度 + 微偏移俯视运镜校验（覆盖含 Z 分量的 D6 1/6 面与 D4/D8/D10/D12/D20）
  const rotateVec = (q, v) => {
    const [qx, qy, qz, qw] = q
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
    const xx = qx * x2, xy = qx * y2, xz = qx * z2
    const yy = qy * y2, yz = qy * z2, zz = qz * z2
    const wx = qw * x2, wy = qw * y2, wz = qw * z2
    return [
      (1 - (yy + zz)) * v[0] + (xy - wz) * v[1] + (xz + wy) * v[2],
      (xy + wz) * v[0] + (1 - (xx + zz)) * v[1] + (yz - wx) * v[2],
      (xz - wy) * v[0] + (yz + wx) * v[1] + (1 - (xx + yy)) * v[2],
    ]
  }
  for (const spec of [
    { meshKey: 'd6', sides: 6, targetValue: 1 },
    { meshKey: 'd6', sides: 6, targetValue: 6 },
    { meshKey: 'd8', sides: 8, targetValue: 8 },
    { meshKey: 'd10', sides: 10, targetValue: 10 },
    { meshKey: 'd12', sides: 12, targetValue: 12 },
    { meshKey: 'd20', sides: 20, targetValue: 20 },
  ]) {
    stage.setStaticRoll({ diceSpecs: [spec], mode: 'normal', tier: 'success' })
    const die = stage.dice[0]
    const wn = rotateVec([die.qx, die.qy, die.qz, die.qw], die.targetFace.normal)
    assert.ok(wn[2] > 0.999, `${spec.meshKey}=${spec.targetValue} 目标面法线应严格朝上平贴台面(wn.z=${wn[2]})`)
    const lowestZ = die.z + Math.min(...die.mesh.faces.map(f => rotateVec([die.qx, die.qy, die.qz, die.qw], f.center)[2])) * die.radius
    assert.ok(Math.abs(lowestZ) < 0.6, `${spec.meshKey} 底部面应贴合 z=0 台面(lowestZ=${lowestZ})`)
  }

  stage.setStaticRoll({ diceSpecs: [{ meshKey: 'd4', sides: 4, targetValue: 1 }], mode: 'normal', tier: 'success' })
  const d4Die = stage.dice[0]
  const d4Wn = rotateVec([d4Die.qx, d4Die.qy, d4Die.qz, d4Die.qw], d4Die.targetFace.normal)
  assert.ok(Math.abs(d4Wn[2] - 1 / 3) < 1e-3 && d4Wn[1] < -0.9, `D4 应以对面平放桌面且目标面朝向镜头(d4Wn=${d4Wn.join(',')})`)
  const d4OppositeZ = Math.min(...d4Die.mesh.faces.map(f => rotateVec([d4Die.qx, d4Die.qy, d4Die.qz, d4Die.qw], f.normal)[2]))
  assert.ok(d4OppositeZ < -0.999, `D4 底面法线应严格垂直朝下(d4OppositeZ=${d4OppositeZ})`)

  // 微偏移俯视视角与跟随运镜校验
  const camDx = stage.camTarget[0] - stage.camEye[0]
  const camDy = stage.camTarget[1] - stage.camEye[1]
  const camDz = stage.camEye[2] - stage.camTarget[2]
  const offsetDeg = Math.atan2(Math.hypot(camDx, camDy), camDz) * 180 / Math.PI
  assert.ok(offsetDeg >= 10 && offsetDeg <= 24, `相机应保持微偏移俯视视角(offsetDeg=${offsetDeg.toFixed(1)}°)`)
  stage.dice[0].x = 90
  stage.dice[0].y = 40
  stage._updateSpringCamera(0.1)
  assert.ok(stage.camTarget[0] > 1 && stage.camEye[0] > 0.5, '镜头运镜应平滑跟随骰子位移')

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

test('全套 6 项升级：免骰直通 / 双骰对抗与3D左右碰撞 / 提示词防讨好与极值 / 白盒阻力与MVU提权 / 局势骰 / 宿命序列', async () => {
  const {
    canAutoSucceed,
    evaluateContestOutcome,
    generateFateTape,
    parseTapeUsageFromText,
    rollCheck,
  } = await import('../tavern-plugin/packages/dsh-tavern-fate-dice/lib/dice-engine.js')
  const {
    diffCharacterProfiles,
    summarizeMvuVariables,
  } = await import('../tavern-plugin/packages/dsh-tavern-fate-dice/lib/auto-profiler.js')
  const {
    buildEncounterInjection,
    buildFateTapeInjection,
    buildTurnInjection,
  } = await import('../tavern-plugin/packages/dsh-tavern-fate-dice/lib/prompt-builder.js')

  // 1) MVU 关键属性提权采样（30+ 杂项键不应挤掉后面的核心力量/伤势/天气）
  const noisyVars = { stat_data: {} }
  for (let i = 1; i <= 30; i += 1) {
    noisyVars.stat_data[`杂项笔记${i}`] = `记录内容_${i}`
  }
  noisyVars.stat_data['力量'] = 9
  noisyVars.stat_data['生命值'] = 32
  noisyVars.stat_data['当前天气'] = '暴雨'
  noisyVars.stat_data['左臂受伤'] = true
  const mvu = summarizeMvuVariables(noisyVars)
  const paths = mvu.entries.map(e => e.path)
  assert.ok(paths.includes('力量'), 'MVU 提权应保留核心属性 力量')
  assert.ok(paths.includes('生命值'), 'MVU 提权应保留 生命值')
  assert.ok(paths.includes('当前天气'), 'MVU 提权应保留 当前天气')
  assert.ok(mvu.environmentCues.some(c => c.label.includes('暴雨')), '应识别天气阻力线索')
  assert.ok(mvu.environmentCues.some(c => c.label.includes('左臂受伤')), '应识别伤病阻力线索')

  // 画像差异对比
  const diff = diffCharacterProfiles(
    { traits: [{ name: '剑术精通', tier: 2 }, { name: '潜行', tier: 0 }] },
    { traits: [{ name: '剑术精通', tier: 3 }, { name: '左臂挂彩', tier: -1 }] }
  )
  assert.ok(diff.some(d => d.kind === 'changed' && d.name === '剑术精通' && d.delta === 1))
  assert.ok(diff.some(d => d.kind === 'added' && d.name === '左臂挂彩' && d.tier === -1))
  assert.ok(diff.some(d => d.kind === 'removed' && d.name === '潜行'))

  // 2) 实力碾压免骰直通（2d6 最小掷出 2 + 加值 4 = 6 >= 容易目标 6）
  assert.equal(canAutoSucceed({ rule: '2d6', skillBonus: 4, modifier: 0, difficulty: 'easy' }), true)
  assert.equal(canAutoSucceed({ rule: '2d6', skillBonus: 4, modifier: 0, difficulty: 'hard' }), false)
  const autoRoll = rollCheck({ rule: '2d6', skillBonus: 4, modifier: 0, difficulty: 'easy', check: '攀爬' })
  assert.equal(autoRoll.autoSuccess, true)
  assert.equal(autoRoll.tier, 'success')
  assert.deepEqual(autoRoll.dice, [])
  const autoInj = buildTurnInjection(autoRoll)
  assert.match(autoInj, /免骰直通/)
  // forceRoll: true 时应绕过免骰实际掷骰
  const forcedRoll = rollCheck({ rule: '2d6', skillBonus: 4, modifier: 0, difficulty: 'easy', forceRoll: true })
  assert.equal(Boolean(forcedRoll.autoSuccess), false)
  assert.equal(forcedRoll.dice.length, 2)

  // 3) 交锋对抗裁定 & 提示词防讨好/位阶/极值巧合/阻力白盒
  const loseContest = evaluateContestOutcome({
    rule: '2d6',
    dice: [2, 3],
    rivalDice: [5, 4],
    skillBonus: 1,
    modifier: 0,
    difficulty: 'moderate',
  })
  assert.equal(loseContest.margin, -3)
  assert.equal(loseContest.counterAttack, true)
  assert.equal(loseContest.tier, 'failure')

  const contestRoll = rollCheck({
    rule: '2d6',
    checkType: 'contest',
    check: '挥剑劈砍',
    rivalName: '哥布林剑士',
    skillBonus: 1,
    difficulty: 'moderate',
  }, () => 3)
  assert.equal(contestRoll.checkType, 'contest')
  assert.equal(contestRoll.contest.rivalName, '哥布林剑士')
  assert.equal(contestRoll.contest.rivalDice.length, 2)

  const critInj = buildTurnInjection({
    rule: '2d6',
    check: '斩击',
    dice: [6, 6],
    rawTotal: 12,
    total: 14,
    target: 10,
    skillBonus: 2,
    modifier: 0,
    tier: 'critical',
    tierLabel: '大成功',
    difficultyLabel: '困难',
    resistanceFactors: [{ label: '暴雨', delta: '-1' }],
  })
  assert.match(critInj, /位阶与反讨好校验/)
  assert.match(critInj, /命运巧合（天然极值）/)
  assert.match(critInj, /暴雨\(-1\)/)

  // 4) 3D 对抗双骰渲染规约与左右碰撞物理
  const clientCode = await readFile(new URL('client.js', PACKAGE_ROOT), 'utf8')
  let loadedFactory = null
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
    performance: { now: () => 1000 },
    window: {
      __ModuleLoader__: { load(spec) { loadedFactory = spec.factory } },
      location: { search: '', hash: '', pathname: '/' },
      addEventListener() {},
      removeEventListener() {},
    },
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'dsh-tavern-fate-dice/client.js' })
  const mod = loadedFactory(id => {
    if (id === 'react') {
      return {
        Fragment: Symbol('Fragment'),
        createElement: (type, props, ...children) => ({ type, props, children }),
        useEffect() {},
        useMemo: fn => fn(),
        useRef: init => ({ current: init }),
        useState: init => [typeof init === 'function' ? init() : init, () => {}],
      }
    }
    throw new Error('unexpected require: ' + id)
  })
  const { FD3D, formatRollSummary } = mod.__test
  assert.match(formatRollSummary(autoRoll, true), /免骰直通/)
  assert.match(formatRollSummary(contestRoll, true), /交锋/)

  const stageSpec = FD3D.rollToStageSpec(contestRoll, false)
  assert.equal(stageSpec.mode, 'contest')
  assert.equal(stageSpec.diceSpecs.length, 4)
  assert.equal(stageSpec.diceSpecs.filter(d => d.side === 'ally').length, 2)
  assert.equal(stageSpec.diceSpecs.filter(d => d.side === 'rival').length, 2)
  assert.equal(stageSpec.contestMeta?.rivalLabel, '哥布林剑士')
  assert.equal(stageSpec.contestMeta?.allyTotal, contestRoll.total)
  assert.equal(stageSpec.contestMeta?.rivalTotal, contestRoll.contest.rivalTotal)

  const stage = new FD3D.CinematicDiceStage({
    getBoundingClientRect: () => ({ width: 800, height: 320 }),
    clientWidth: 800,
    clientHeight: 320,
    width: 800,
    height: 320,
  }, null, {
    _preRenderer: {
      resize() {},
      render() {},
      projectToUV: () => ({ u: 0.5, v: 0.5, visible: true }),
      unprojectToPlane: () => ({ x: 0, y: 0, z: 85 }),
    },
    interactive: false,
    theater: true,
  })
  stage.stop()
  stage.throwDice(stageSpec)
  stage.stop()
  assert.equal(stage.dice.length, 4)
  assert.ok(stage.dice[0].trajPos[0] < 0, '我方骰应从左翼抛入')
  assert.ok(stage.dice[2].trajPos[0] > 0, '对手骰应从右翼抛入')
  for (const d of stage.dice) {
    const endX = d.trajPos[d.settleStep * 3]
    if (d.side === 'ally') assert.ok(endX < -15, `我方骰应严格落定在左半区，实际 x=${endX}`)
    if (d.side === 'rival') assert.ok(endX > 15, `对手骰应严格落定在右半区，实际 x=${endX}`)
  }

  // 5) 宿命序列（无小模型真骰带）与局势/奇遇骰端到端接线
  const tape = generateFateTape({ rule: '2d6', count: 6 }, () => 4)
  assert.equal(tape.slots.length, 6)
  const tapeText = buildFateTapeInjection(tape)
  assert.match(tapeText, /①\(4,4\)=8/)
  const parsedTapeRoll = parseTapeUsageFromText('一段紧张的交涉剧情...\n<!-- fate-dice-tape: ① check=说服 diff=moderate mod=1 -->', tape)
  assert.equal(parsedTapeRoll.tapeSlot, '①')
  assert.equal(parsedTapeRoll.total, 9)
  assert.equal(parsedTapeRoll.tier, 'costly')

  assert.match(buildEncounterInjection({ expression: '2d6', dice: [6, 6], sides: 6, total: 12 }), /大吉奇遇/)

  // 宿主集成：无决策模型下开启 tapeFallbackEnabled + 挂载局势骰 + 随正文落定揭晓设置 + 正文结算自动登记胶囊
  const handlers = new Map()
  const turnSections = []
  const settledListeners = []
  const attaches = []
  const gameStore = new Map()
  const turnStore = new Map()
  const tavern = {
    capabilities: { decisionJudge: false, narrativeDamper: false },
    handle(name, fn) { handlers.set(name, fn) },
    turnSection(spec) { turnSections.push(spec) },
    settlementSection() {},
    settlementTool() {},
    onTurnSettled(fn) { settledListeners.push(fn) },
    onTimelineChanged() {},
    onGameRemoved() {},
    async publishState() {},
    async readGameData({ gameId }) { return gameStore.get(gameId) ?? null },
    async saveGameData({ gameId, data }) { gameStore.set(gameId, structuredClone(data)) },
    async readTurnData({ gameId, turn }) { return turnStore.get(`${gameId}:${turn}`) ?? null },
    async saveTurnData({ gameId, turn, textVersion, data }) {
      turnStore.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
    },
    async getTurnState() { return { turn: 1, settled: false, greeting: false } },
    async getTurn() { return { text: '主角试探着推开石门。\n<!-- fate-dice-tape: ① check=力量 diff=moderate mod=2 -->' } },
    async attach(item) { attaches.push(item) },
    async variables() { return {} },
  }
  const cleanups = []
  const dispose = applyFateDicePlugin({
    tavern,
    inject(_d, cb) { if (typeof cb === 'function') cb({ llm: null }) },
    effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); return off },
  })
  if (typeof dispose === 'function') cleanups.push(dispose)
  try {
    const saveSettings = handlers.get('fate-dice:save-global-settings')
    const freeRoll = handlers.get('fate-dice:free-roll')
    const readTurn = handlers.get('fate-dice:read-turn')

    const saved = await saveSettings({
      settings: {
        enabled: true,
        tapeFallbackEnabled: true,
        revealTiming: 'stream-end',
        autoSuccessEnabled: true,
        contestEnabled: true,
      },
    })
    assert.equal(saved.settings.tapeFallbackEnabled, true)
    assert.equal(saved.settings.revealTiming, 'stream-end')

    const encRes = await freeRoll({ gameId: 'g-tape', expression: '2d6', injectAsEncounter: true })
    assert.equal(encRes.ok, true)
    assert.equal(encRes.injectAsEncounter, true)

    const injected = await turnSections[0].text({ gameId: 'g-tape', turn: 1, input: '推开沉重的石门' })
    assert.match(injected, /本轮宿命序列/)
    assert.match(injected, /本轮局势 \/ 奇遇命运骰已落定/)

    for (const fn of settledListeners) {
      await fn({ gameId: 'g-tape', turn: 1, textVersion: 'v1' })
    }
    assert.equal(attaches.length, 1, '宿命序列被消费后应自动挂出楼层胶囊')
    const turnView = await readTurn({ gameId: 'g-tape', turn: 1 })
    assert.equal(turnView.revealTiming, 'stream-end')
    assert.equal(turnView.roll?.checkType, 'tape')
    assert.equal(turnView.roll?.check, '力量')
  } finally {
    for (const fn of cleanups.splice(0)) fn()
  }
})

test('双骰对抗识别：扩充词表 + 决策模型与阻尼器语义题 is_contest / fd_contest', async () => {
  const {
    detectContestIntent,
    heuristicAssess,
    judgeActionDifficulty,
    resolveContestCheckType,
  } = await import('../tavern-plugin/packages/dsh-tavern-fate-dice/lib/difficulty-judge.js')
  const {
    buildDamperJudgeQuestions,
    resolveCheckFromDamperContext,
  } = await import('../tavern-plugin/packages/dsh-tavern-fate-dice/lib/damper-bridge.js')

  // 1) 兜底词表覆盖通用战斗 + 武侠 / 仙侠 / 现代 / 比赛 / 赌博等常见正面交锋表达
  assert.equal(detectContestIntent('我护着安雅和灰枭打斗对抗', 'physical'), true)
  assert.equal(detectContestIntent('与走廊里的守卫激战', 'physical'), true)
  assert.equal(detectContestIntent('冲上去抢夺对方手里的钥匙', 'physical'), true)
  assert.equal(detectContestIntent('与华山掌门在擂台比武切磋、对掌拼内力', 'physical'), true)
  assert.equal(detectContestIntent('祭出飞剑与魔修斗法，神识交锋', 'arcana'), true)
  assert.equal(detectContestIntent('在高速上飙车追车并和匪徒火拼', 'physical'), true)
  assert.equal(detectContestIntent('在法庭辩论中当场质证对方律师', 'social'), true)
  assert.equal(detectContestIntent('进入加时赛点球决胜争夺冠军', 'physical'), true)
  assert.equal(detectContestIntent('在德州扑克牌局里直接梭哈诈唬庄家', 'social'), true)
  assert.equal(detectContestIntent('我护着安雅和灰枭打斗对抗', 'insight'), false)
  const h = heuristicAssess({ input: '我护着安雅和灰枭打斗对抗' })
  assert.equal(h.shouldRoll, true)
  assert.equal(h.checkType, 'contest')
  assert.equal(heuristicAssess({ input: '在赌局里直接梭哈和庄家对赌' }).checkType, 'contest')
  assert.equal(heuristicAssess({ input: '和魔修斗法较量' }).checkType, 'contest')

  // 2) resolveContestCheckType 优先采信 AI 语义概率，高概率触发、低概率抑制、模糊或缺失回退词表
  assert.equal(
    resolveContestCheckType({ input: '我死死抵住门板不让门外的人推开', category: 'physical', hidden: false, contestProb: 0.85 }),
    'contest'
  )
  assert.equal(
    resolveContestCheckType({ input: '我回忆起那场惨烈的战斗，叹了口气', category: 'will', hidden: false, contestProb: 0.1 }),
    'normal'
  )
  assert.equal(
    resolveContestCheckType({ input: '安雅和灰枭打斗对抗', category: 'physical', hidden: false, contestProb: 0.45 }),
    'contest'
  )
  assert.equal(
    resolveContestCheckType({ input: '安雅和灰枭打斗对抗', category: 'physical', hidden: true, contestProb: 0.95 }),
    'normal'
  )

  // 3) 决策模型 judgeActionDifficulty 发送 is_contest 题并正确消费
  let capturedQuestions = null
  const mockTavern = {
    capabilities: { decisionJudge: true },
    async decisionJudgeStatus() {
      return { available: true, provider: 'gemini', capabilities: { choice: true, score: true } }
    },
    async judgeDecision({ questions }) {
      capturedQuestions = questions
      return {
        provider: 'gemini',
        judgeTier: 'full',
        answers: {
          needs_check: { probability: 0.9 },
          difficulty_tier: { choice: 'hard' },
          character_capability: { score: 2 },
          check_category: { choice: 'physical' },
          situation_edge: { score: 1 },
          is_contest: { probability: 0.88 },
        },
      }
    },
  }
  const judged = await judgeActionDifficulty({
    tavern: mockTavern,
    input: '我死死抵住门板不让灰枭撞开',
  })
  assert.ok(capturedQuestions.some(q => q.id === 'is_contest' && q.type === 'noul'))
  assert.equal(judged.checkType, 'contest')

  // 4) 阻尼器合并题包含 fd_contest 并正确解析
  const geminiQs = buildDamperJudgeQuestions({ protocol: 'gemini', autoProfile: true })
  assert.ok(geminiQs.some(q => q.id === 'fd_contest' && q.type === 'noul'))
  const noulQs = buildDamperJudgeQuestions({ protocol: 'noul', autoProfile: true })
  assert.ok(noulQs.some(q => q.id === 'fd_contest' && q.type === 'noul'))

  const damperRes = resolveCheckFromDamperContext({
    input: '我死死抵住门板不让灰枭撞开',
    damperContext: {
      answers: {
        fd_needs_check: { probability: 0.85 },
        fd_difficulty: { choice: 'hard' },
        fd_capability: { score: 2 },
        fd_domain: { choice: 'physical' },
        fd_contest: { probability: 0.82 },
      },
    },
  })
  assert.equal(damperRes.checkType, 'contest')
})
