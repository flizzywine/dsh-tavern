// 移动端短对话首屏、切换并发与服务端读缓存的覆盖：
// P0-3 常规短对话走 openingWindow 的字段裁剪快路径（不再退回全量 readFullChat）、
// P0-4 同参数 syncSession 并发复用一次执行、
// P2-9b readIndex 按文件版本缓存且写入后立即反映。
// 服务层部分跑真实 apply/RPC/Chat 存储，只替换宿主的原生 Session 适配（与既有
// tests/fixtures/game-save-roundtrip.mjs 的做法一致）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

import { readRecentWindow, windowCoversHistory } from '../tavern-plugin/lib/domain/bounded-history.js'
import { sessionViewMessageFields } from '../tavern-plugin/lib/domain/session-view-projection.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

const FIXTURE_FLAG = 'TAVERN_SHORT_CHAT_SYNC_PERF_SERVICE'
const ROOT = new URL('../', import.meta.url)
// 子进程只跑夹具：它不注册测试，也不继承测试运行器的 --test 参数，输出只有一行 JSON。
const FIXTURE = process.env[FIXTURE_FLAG] === '1'
const register = FIXTURE ? () => {} : (...args) => test(...args)

function floors(count) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' : 'user',
    turn: Math.floor(index / 2) + 1,
    text: '第 ' + index + ' 楼：' + '剧情'.repeat(40),
    // 每层都带一份变量快照：这正是全量读在手机上要搬运的重量。
    variables: [{ stat_data: Object.fromEntries(Array.from({ length: 40 }, (_, field) => ['字段' + field, { value: '状态'.repeat(20), count: field }])) }]
  }))
}

async function journal(dataRoot) {
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot, newConversations: true }) })
  const timeline = createStoryTimeline()
  return {
    persistence,
    async seed(id, count, extra = {}) {
      const made = timeline.apply({ chat: { id, messages: floors(count) }, intent: { kind: 'ensure' } })
      await persistence.write({ ...made.chat, sessionId: 's-' + id, mode: 'story', cardPath: '', cardDefinitionSnapshot: { name: '卡' }, backgroundConfigVersion: 1, conversationFeaturesVersion: 1, ...extra })
      return id
    }
  }
}

// A store that answers bounded window reads but refuses the complete Chat: the fast
// path must never need the whole-history reader to serve a short game's first paint.
function windowOnlyStore(dataRoot) {
  const store = createChatJournalStore({ dataRoot })
  let fullReads = 0
  return {
    fullReads: () => fullReads,
    read: async id => { fullReads++; return await store.read(id) },
    readWindow: (...args) => store.readWindow(...args),
    version: (...args) => store.version(...args),
    // 其余适配器照旧委托：只有完整读取被计数（Write/modify 仍走真实存储）。
    update: (...args) => store.update(...args),
    remove: (...args) => store.remove(...args),
    readSessionState: (...args) => store.readSessionState(...args),
    patch: (...args) => store.patch(...args),
    readChangedIndices: (...args) => store.readChangedIndices(...args),
    readViewDelta: (...args) => store.readViewDelta(...args),
    readSlice: (...args) => store.readSlice(...args),
    readRecentSummaries: (...args) => store.readRecentSummaries(...args)
  }
}

register('短对话的首屏窗口覆盖全部楼层，长对话才需要裁剪窗口', async t => {
  const root = await mkdtemp(join(tmpdir(), 'short-chat-window-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { seed } = await journal(root)
  const shortId = await seed('chat-short', 6)
  const longId = await seed('chat-long', 60)
  const bounded = createChatJournalStore({ dataRoot: root })

  const short = await readRecentWindow(bounded.readWindow, shortId, { limit: 48, messageFields: sessionViewMessageFields })
  assert.equal(short.from, 0, '六层楼的一局整个都落在窗口里')
  assert.equal(short.messageCount, 6)
  assert.equal(short.chat.messages.length, 6, '每一楼都是真行，不是洞')
  assert.equal(windowCoversHistory(short), true, '覆盖全部历史的窗口可以直接当完整视图用')
  assert.deepEqual(short.chat.messages.map(row => row.turn), [1, 1, 2, 2, 3, 3])
  assert.equal(short.chat.messages[5].variables[0].stat_data['字段3'].count, 3, '裁剪字段仍保留每层变量')

  const long = await readRecentWindow(bounded.readWindow, longId, { limit: 48, messageFields: sessionViewMessageFields })
  assert.equal(long.from, 12, '长对话只取最新一页')
  assert.equal(windowCoversHistory(long), false)
  // 旧的模板读取契约不变：整段历史落在窗口里时仍然拒绝。
  assert.equal(await readRecentWindow(bounded.readWindow, shortId, { limit: 48, requirePartial: true, messageFields: sessionViewMessageFields }), null)
})

register('短对话窗口不读完整 Chat：完整读取器一次都没被调用', async t => {
  const root = await mkdtemp(join(tmpdir(), 'short-chat-nowhole-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { seed, persistence } = await journal(root)
  const chatId = await seed('chat-nowhole', 8)
  const store = windowOnlyStore(root)
  const bounded = createChatPersistence({ store })

  const window = await readRecentWindow(bounded.readWindow, chatId, { limit: 48, from: undefined, requirePartial: false, messageFields: sessionViewMessageFields })
  assert.equal(windowCoversHistory(window), true)
  assert.equal(store.fullReads(), 0, '首屏读取没有回落到完整读取')

  // 周界：只看最新一页而不补齐时窗口上方有楼层，不能冒充完整视图。
  const longChat = await seed('chat-nowhole-long', 13)
  const page = await readRecentWindow(bounded.readWindow, longChat, { limit: 8, messageFields: sessionViewMessageFields })
  assert.equal(page.from, 5)
  assert.equal(page.chat.messages.length, 8)
  assert.equal(windowCoversHistory(page), false, '窗口上方还有楼层时不能冒充完整视图')
  // 一次补齐到第 0 楼时它确实覆盖了全部历史（13 层 <= 单次上限 500）。
  const grown = await readRecentWindow(bounded.readWindow, longChat, { limit: 8, from: 0, requirePartial: false, messageFields: sessionViewMessageFields })
  assert.equal(grown.from, 0)
  assert.equal(windowCoversHistory(grown), true)
  assert.equal(grown.messageCount, 13)
  assert.equal((await persistence.read(chatId)).messages.length, 8)
})

register('windowCoversHistory 只认「零起点且没有洞」的窗口', () => {
  const rows = [{ role: 'assistant', turn: 1 }]
  assert.equal(windowCoversHistory(null), false)
  assert.equal(windowCoversHistory({ from: 1, messageCount: 2, chat: { messages: rows } }), false)
  assert.equal(windowCoversHistory({ from: 0, messageCount: 2, chat: { messages: rows } }), false, '楼层数与窗口不符即视为有洞')
  assert.equal(windowCoversHistory({ from: 0, messageCount: 1, chat: { messages: rows } }), true)
  assert.equal(windowCoversHistory({ from: 0, messageCount: 0, chat: {} }), false)
})

register('分窗首屏先返回视图，再启动存档核对', async () => {
  const calls = []
  let finishReconcile
  const reconciling = new Promise(resolve => { finishReconcile = resolve })
  const handlers = createPlayHandlers({
    reconcileWhenIdle: (_id, { background }) => { calls.push(background ? 'background' : 'foreground'); return reconciling },
    backgroundCatalog: async () => {},
    sessionViews: { response: async () => { calls.push('view'); return { view: { chatId: 'game' } } } },
    templateHistoryFrom: new Map(),
    str: value => String(value ?? '')
  })
  try {
    const result = await handlers.getSession({ sessionId: 's', openingWindow: 1, viewSync: 1 })
    assert.equal(result.view.chatId, 'game')
    assert.deepEqual(calls, ['view', 'background'])
    const full = handlers.getSession({ sessionId: 's', fullView: true })
    assert.deepEqual(calls, ['view', 'background', 'foreground'])
    finishReconcile()
    await full
    assert.deepEqual(calls, ['view', 'background', 'foreground', 'view'])
  } finally { finishReconcile() }
})

register('同参数的并发 syncSession 只执行一次，不同参数各执行一次', async () => {
  let runs = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const deps = {
    candidateTasks: { sync: async (sessionId, selector) => { runs++; await gate; return { runtimeGeneration: 'g', liveSession: false, activity: { busy: false, role: 'idle' }, selector, chatId: 'c' } } },
    requestPerformance: { stage: (_name, work) => work(), state() {} },
    agentRegistry: { get: () => undefined },
    str: value => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
  }
  const handlers = createPlayHandlers(deps)
  const same = [{ sessionId: 's1', kind: 'candidate' }, { sessionId: 's1', kind: 'candidate' }, { sessionId: 's1', kind: 'candidate' }]
  const pending = same.map(args => handlers.syncSession(args))
  const other = handlers.syncSession({ sessionId: 's1', kind: 'background' })
  const third = handlers.syncSession({ sessionId: 's2', kind: 'candidate' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(runs, 3, '相同 [sessionId, kind, requestId] 只跑一次，其余两组各跑一次')
  release()
  const results = await Promise.all(pending)
  await other
  await third
  assert.deepEqual(results.map(result => result.sync.runtimeGeneration), ['g', 'g', 'g'])
  assert.equal(runs, 3)
  // 结束即清理：下一次同参数请求是一次新的读取，不会拿到旧结果。
  await handlers.syncSession({ sessionId: 's1', kind: 'candidate' })
  assert.equal(runs, 4)
})

register('syncSession 的失败不会留在 in-flight 表里', async () => {
  let runs = 0
  const deps = {
    candidateTasks: { sync: async () => { runs++; if (runs === 1) throw new Error('读取失败'); return { runtimeGeneration: 'g' } } },
    requestPerformance: { stage: (_name, work) => work(), state() {} },
    agentRegistry: { get: () => undefined }, str: value => String(value ?? '')
  }
  const handlers = createPlayHandlers(deps)
  const failed = [handlers.syncSession({ sessionId: 's' }), handlers.syncSession({ sessionId: 's' })]
  const settled = await Promise.allSettled(failed)
  assert.deepEqual(settled.map(item => item.status), ['rejected', 'rejected'])
  assert.equal(runs, 1, '两个等待者共用同一次失败')
  const recovered = await handlers.syncSession({ sessionId: 's' })
  assert.equal(recovered.sync.runtimeGeneration, 'g')
  assert.equal(runs, 2)
})

if (FIXTURE) {
  console.log('short-chat-and-sync-perf: ' + JSON.stringify(await runServiceFixture()))
} else {
  test('真实服务：短对话首屏不再全量读、滚回第 0 楼仍取完整视图、readIndex 按版本缓存', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tavern-short-chat-service-'))
    try {
      const childEnv = { ...process.env, DSH_HOME: root, [FIXTURE_FLAG]: '1' }
      // 保留宿主的 --import 预载，去掉测试运行器的 --test：子进程只跑夹具。
      childEnv.NODE_OPTIONS = (process.env.NODE_OPTIONS || '').split(/\s+/).filter(flag => flag && !/^--test/.test(flag)).join(' ')
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: childEnv, encoding: 'utf8', timeout: 180000
      })
      assert.ifError(child.error)
      assert.equal(child.status, 0, child.stderr + child.stdout)
      const line = child.stdout.split('\n').find(item => item.startsWith('short-chat-and-sync-perf: '))
      assert.ok(line, '服务夹具没有输出结果：' + child.stdout.slice(-2000))
      const result = JSON.parse(line.slice('short-chat-and-sync-perf: '.length))
      assert.equal(result.short.from, 0, '短对话首屏走裁剪窗口')
      assert.equal(result.short.count, 6)
      assert.equal(result.short.replies, 3, '六层楼三条回复全部投影进首屏')
      assert.equal(result.long.from > 0, true, '长对话仍是裁剪窗口')
      assert.equal(result.scrolled.historyWindow, null, '滚回第 0 楼请求完整视图')
      assert.equal(result.scrolled.replies, 3)
      assert.equal(result.index.rename, true, 'updateIndex 之后列表立刻反映新标题')
      assert.equal(result.index.external, true, '外部改写的 index.json 通过版本失效被重新读取')
      if (result.index.firstMs !== undefined && result.index.firstMs >= 3) {
        assert.equal(result.index.cachedMs < result.index.firstMs, true,
          '命中版本缓存的列表读取应快于首次解析：' + JSON.stringify(result.index))
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

async function runServiceFixture() {
  const load = path => import(new URL(path, ROOT).href)
  const [{ createPluginHost }, { createProfileDataStore }] = await Promise.all([
    load('tests/fixtures/plugin-host.mjs'), load('tavern-plugin/lib/profile-data-store.js')
  ])
  const host = await createPluginHost()
  try {
    const sessions = new Map()
    host.services.get('sessions').flush = async () => {}
    host.services.get('agents').create = async ({ sessionId, seed = [] }) => {
      const session = { header: { id: sessionId }, events: [...seed] }
      sessions.set(sessionId, session)
      return { agent: { session }, dispose: async () => {} }
    }
    host.services.get('agents').resume = async ({ resumeSessionId }) => {
      const session = sessions.get(resumeSessionId)
      if (!session) throw new Error('原生会话不存在：' + resumeSessionId)
      return { agent: { session }, dispose: async () => {} }
    }
    host.services.set('sessionPersistence', {
      open: async id => ({ header: { id }, read: async () => ({ events: sessions.get(id)?.events || [] }), close: async () => {} })
    })
    const dataRoot = process.env.DSH_HOME + '/profile-data/tavern/data'
    const profile = createProfileDataStore({ dataRoot })
    const { seed } = await journal(dataRoot)
    const shortId = await seed('chat-service-short', 6, { sessionId: 's-short', title: '短局', cardName: '卡' })
    const longId = await seed('chat-service-long', 60, { sessionId: 's-long', title: '长局', cardName: '卡' })
    await profile.writeJson('sessions.json', { 's-short': shortId, 's-long': longId })
    sessions.set('s-short', { header: { id: 's-short' }, events: [] })
    sessions.set('s-long', { header: { id: 's-long' }, events: [] })

    const short = (await host.rpc('getSession', { sessionId: 's-short', openingWindow: 1, viewSync: 1 })).view
    const long = (await host.rpc('getSession', { sessionId: 's-long', openingWindow: 1, viewSync: 1 })).view
    const scrolled = (await host.rpc('getSession', { sessionId: 's-short', historyFrom: 0 })).view

    // 列表读取的第一次与命中版本缓存的第二次；索引故意做厚，让解析开销可辨。
    const thick = { cards: [], chats: Array.from({ length: 4000 }, (_, index) => ({
      id: 'chat-thick-' + index, cardPath: '', cardName: '卡', title: '厚索引 ' + index, mode: 'story',
      requestMode: 'dsh', createdAt: index, updatedAt: index, lastOpenedAt: index, preview: '预览'.repeat(20)
    })) }
    const listed = () => host.rpc('listSessions', {})
    await listed()
    // 厚的索引让「磁盘解析」与「版本命中」的差别可辨。
    await profile.writeJson('index.json', { ...(await profile.readJson('index.json')), chats: [...thick.chats, ...(await profile.readJson('index.json')).chats] })
    const first = await timed(listed)
    const cached = await timed(listed)
    const renamed = await host.rpc('renameConversation', { sessionId: 's-short', title: '改过的标题' })
    const afterRename = (await listed()).sessions.find(row => row.sessionId === 's-short')
    // 直接改写 index.json（不走 writeIndex）：版本戳变化必须让缓存失效。
    const current = await profile.readJson('index.json')
    await profile.writeJson('index.json', { ...current, chats: current.chats.map(row => row.id === shortId ? { ...row, title: '外部标题' } : row) })
    const afterExternal = (await listed()).sessions.find(row => row.sessionId === 's-short')

    return {
      short: { from: short?.historyWindow?.from, count: short?.historyWindow?.messageCount, replies: short?.replyProjections?.length ?? 0 },
      long: { from: long?.historyWindow?.from, count: long?.historyWindow?.messageCount },
      scrolled: { historyWindow: scrolled?.historyWindow ?? null, replies: scrolled?.replyProjections?.length ?? 0 },
      index: { firstMs: first.ms, cachedMs: cached.ms, rename: renamed.title === '改过的标题' && afterRename?.title === '改过的标题',
        external: afterExternal?.title === '外部标题' }
    }
  } finally { await host.dispose() }
}

async function timed(run) {
  const started = performance.now()
  const value = await run()
  return { value, ms: performance.now() - started }
}
