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

