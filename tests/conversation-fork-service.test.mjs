// 故事消息分叉的真实服务级覆盖：真实 apply、RPC、Chat 存储与场景世界书归档，
// 只按现有 fixture（tests/fixtures/game-save-roundtrip.mjs）的做法替换宿主的原生
// Session 适配，分叉逻辑本身不被 mock。
// 纯函数层已有 tests/conversation-fork.test.mjs、tests/conversation-fork-point.test.mjs；
// 这里补齐 prepareConversationFork / forkChat 在服务里的实际行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_FLAG = 'TAVERN_CONVERSATION_FORK_SERVICE'

if (process.env[FIXTURE_FLAG] === '1') {
  // The child owns a throwaway DSH_HOME: the fixture writes real Chat journals,
  // scene worldbook refs and a seeded native Session into it.
  console.log('conversation-fork-service: ' + JSON.stringify(await runServiceFixture()))
} else {
  test('故事消息分叉走真实服务：空白目标、精确前缀、revision 校验、turn 前缀集合、旧 atSeq 路径', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tavern-fork-service-'))
    try {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, DSH_HOME: root, [FIXTURE_FLAG]: '1' }, encoding: 'utf8', timeout: 120000
      })
      assert.ifError(child.error)
      assert.equal(child.status, 0, child.stderr + child.stdout)
      assert.match(child.stdout, /conversation-fork-service: \{/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

async function runServiceFixture() {
  const load = (path) => import(new URL(path, import.meta.url).href)
  const [{ createPluginHost }, { buildGameSave, readGameSave }, { createProfileDataStore }, { createSceneWorldbooks, bindSceneWorldbook }] =
    await Promise.all([load('./fixtures/plugin-host.mjs'), load('../tavern-plugin/lib/domain/game-save.js'),
      load('../tavern-plugin/lib/profile-data-store.js'), load('../tavern-plugin/lib/domain/scene-worldbook.js')])

  const host = await createPluginHost()
  const sessions = host.services.get('sessions')
  // Only the host's native Session service is adapted (as the existing save fixture does):
  // a Session here is its event log, which is all the fork path reads or flushes.
  sessions.flush = async () => {}
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
  const store = createProfileDataStore({ dataRoot: process.env.DSH_HOME + '/profile-data/tavern/data' })
  const books = createSceneWorldbooks({ store })
  const evidence = {}

  const text = value => [{ type: 'text', text: value }]
  const row = (role, body, turn) => ({ role, text: body, ...(turn ? { turn } : {}) })
  function eventsFor(rounds) {
    const events = []
    const add = (type, data) => events.push({ seq: events.length, type, data })
    for (const [index, round] of rounds.entries()) {
      const turn = index + 1
      add('turn/start', { turn })
      add('step/start', { turn, step: 1 })
      add('user/message', { id: `u${turn}`, role: 'user', content: text(round.user), source: { kind: 'user' } })
      add('assistant/message', { turn, step: 1, message: { id: `a${turn}`, role: 'assistant', content: text(round.assistant),
        source: { kind: 'model', provider: 'fixture', model: 'fixture' } } })
      add('step/end', { turn, step: 1 })
      add('turn/end', { turn, reason: { kind: 'completed' } })
    }
    return events
  }
  function chatState({ id, sessionId, messages, checkpoints = [] }) {
    return {
      id, sessionId, mode: 'story', cardPath: 'cards/fixture.json', cardName: '测试', title: '测试',
      createdAt: 1, updatedAt: 2, settleStatus: 'idle', messages,
      timeline: { schemaVersion: 1, branchId: 'branch-' + id, revision: 1, checkpoints, participants: {}, operations: {}, updatedAt: 2 }
    }
  }
  // Import goes through the real RPC: it materializes the Chat, every reachable history
  // revision and a seeded native Session, exactly like a save opened on this machine.
  async function importGame({ id, sessionId, messages, rounds, revisions = [], checkpoints = [], scene }) {
    const state = chatState({ id, sessionId, messages, checkpoints })
    const save = buildGameSave({
      chat: state,
      revisions: revisions.map(item => ({ revision: item.revision, state: chatState({ id, sessionId, messages: item.messages }) })),
      session: { header: { id: sessionId }, inheritedEventCount: rounds.length * 6, events: eventsFor(rounds) },
      card: { path: 'cards/fixture.json', payload: { kind: 'text', name: 'fixture.json', text: '{"name":"测试"}' } },
      ...(scene ? { scene } : {}),
      tavernVersion: '2.7.0', exportedAt: Date.now()
    })
    return await host.rpc('importGameSave', { fileB64: save.toString('base64') })
  }
  const failureOf = promise => promise.then(() => null, error => String(error?.message || error))
  const turnsOf = values => values.map(value => value.turn).sort((left, right) => left - right)
  const transcriptRows = async sessionId => (await host.rpc('getStoryTranscript', { sessionId })).storyTranscript.messages
    .map(item => [item.message.role, item.message.text, item.message.turn])
  const chatOf = async sessionId => readGameSave(Buffer.from((await host.rpc('exportGameSave', { sessionId })).base64, 'base64')).chat
  const forkOf = async sessionId => (await chatOf(sessionId)).forkedFrom
  const blankSession = id => { sessions.set(id, { header: { id }, events: [] }); return id }

  try {
    // ---- 故事消息分叉：空白目标 Session + 精确前缀 + revision 校验 ----
    const rows = [row('assistant', '开场', 1), row('user', '走进客栈'),
      { ...row('assistant', '她抬起头', 2), messageUid: 'fork-world-source', variables: [{ stat_data: { gold: 10 }, schema: {} }] },
      row('user', '坐下'), row('assistant', '茶来了', 3)]
    const source = await importGame({
      id: 'source-a', sessionId: 'session-a', messages: rows,
      rounds: [{ user: '走进客栈', assistant: '她抬起头' }, { user: '坐下', assistant: '茶来了' }],
      revisions: [{ revision: 1, messages: rows.slice(0, 3) }],
      checkpoints: [{ id: 'checkpoint-2', turn: 2, beforeRevision: 1 }]
    })
    const sourceRevision = (await host.rpc('getStoryTranscript', { sessionId: source.sessionId })).revision
    const plan = await host.rpc('prepareConversationFork', { chatId: source.chatId, messageIndex: 2, revision: sourceRevision })
    assert.equal(plan.storyDirect, true)
    assert.equal(plan.atSeq, null)
    assert.equal(plan.messageIndex, 2)
    assert.equal(plan.turn, 2)
    assert.equal(plan.sourceRevision, sourceRevision)

    const target = blankSession('session-a-fork')
    assert.deepEqual(sessions.get(target).events, [])
    assert.equal((await host.rpc('listSessions')).sessions.some(chat => chat.sessionId === target), false, '目标 Session 还没有绑定对话')
    const forked = await host.rpc('forkChat', { chatId: source.chatId, sessionId: source.sessionId, targetSessionId: target,
      messageIndex: 2, sourceRevision: plan.sourceRevision, atSeq: plan.atSeq })
    assert.equal(forked.fork.messageCount, 3)
    const sourceRows = await transcriptRows(source.sessionId)
    assert.deepEqual(await transcriptRows(target), sourceRows.slice(0, 3), '分叉 Chat 是源 Chat 的精确消息前缀')
    const targetChat = await chatOf(target)
    assert.equal(targetChat.messages[2].messageUid, 'fork-world-source', '分叉保留世界来源行的永久 UID')
    assert.equal(targetChat.messages[2].variables[0].stat_data.gold, 10)
    const { createChatJournalStore } = await load('../tavern-plugin/lib/domain/chat-journal-store.js')
    const targetHead = await createChatJournalStore({ dataRoot: process.env.DSH_HOME + '/profile-data/tavern/data' })
      .readWindow(targetChat.id, { limit: 1 })
    assert.equal(targetHead.worldMessage, 2)
    assert.equal(targetHead.worldMessageUid, 'fork-world-source')
    assert.equal(targetHead.worldSwipe, 0)
    const forkedFrom = await forkOf(target)
    assert.equal(forkedFrom.chatId, source.chatId)
    assert.equal(forkedFrom.sessionId, source.sessionId)
    assert.equal(forkedFrom.messageIndex, 2)
    assert.equal(forkedFrom.turn, 2)
    assert.equal(forkedFrom.storageRevision, plan.sourceRevision, '来源记录带上源 Chat 的校验 revision')
    assert.equal(forkedFrom.stateChatId, source.chatId)
    assert.equal(forkedFrom.stateRevision, 1, '来源记录指向实际取用的历史快照 revision')
    assert.equal(forkedFrom.atSeq, null)

    // 现有对话的 Session 不能再当目标：prepare 用当前 revision，fork 才走到目标校验。
    const headRevision = (await host.rpc('getStoryTranscript', { sessionId: source.sessionId })).revision
    const headPlan = await host.rpc('prepareConversationFork', { chatId: source.chatId, messageIndex: 2, revision: headRevision })
    assert.match(await failureOf(host.rpc('forkChat', { chatId: source.chatId, sessionId: source.sessionId, targetSessionId: source.sessionId,
      messageIndex: 2, sourceRevision: headPlan.sourceRevision, atSeq: null })), /分叉目标必须是尚未绑定对话的新 Session/)

    // revision 校验：分叉准备之后源 Chat 只要动过，旧 revision 就被拒绝；按新 head 重新准备即可分叉。
    await host.rpc('setPlayerName', { sessionId: source.sessionId, userName: '旅人' })
    assert.match(await failureOf(host.rpc('prepareConversationFork', { chatId: source.chatId, messageIndex: 2, revision: headRevision })), /剧情已变化/)
    assert.match(await failureOf(host.rpc('forkChat', { chatId: source.chatId, sessionId: source.sessionId, targetSessionId: blankSession('session-a-stale'),
      messageIndex: 2, sourceRevision: headPlan.sourceRevision, atSeq: null })), /剧情已变化/)

    // 新故事请求带稳定 UID：准备前、执行前的无关 revision 写入都不能让同一分叉点过期。
    const stablePlan = await host.rpc('prepareConversationFork', { chatId: source.chatId,
      messageIndex: 2, revision: headRevision, messageUid: 'fork-world-source' })
    assert.equal(stablePlan.messageUid, 'fork-world-source')
    await host.rpc('setPlayerName', { sessionId: source.sessionId, userName: '另一位旅人' })
    await host.rpc('forkChat', { chatId: source.chatId, sessionId: source.sessionId, targetSessionId: blankSession('session-a-stable-uid'),
      messageIndex: stablePlan.messageIndex, sourceRevision: stablePlan.sourceRevision, atSeq: stablePlan.atSeq, messageUid: stablePlan.messageUid })
    assert.deepEqual(await transcriptRows('session-a-stable-uid'), sourceRows.slice(0, 3))

    const movedRevision = (await host.rpc('getStoryTranscript', { sessionId: source.sessionId })).revision
    assert.ok(movedRevision > headRevision)
    const refreshed = await host.rpc('prepareConversationFork', { chatId: source.chatId, messageIndex: 2, revision: movedRevision })
    await host.rpc('forkChat', { chatId: source.chatId, sessionId: source.sessionId, targetSessionId: blankSession('session-a-again'),
      messageIndex: 2, sourceRevision: refreshed.sourceRevision, atSeq: null })
    assert.deepEqual(await transcriptRows('session-a-again'), sourceRows.slice(0, 3))
    evidence.storyFork = { messageCount: forked.fork.messageCount, sourceRevision: plan.sourceRevision, movedRevision }

    // ---- 缺 turn / 重复 turn / 非单调 turn：按前缀集合拷贝，不按数值上界 ----
    const worldBook = { view: { entries: [{ content: '场景设定', ref: 'entry:0' }] } }
    const refs = {}
    for (const turn of [1, 5, 3, 7]) refs[turn] = await books.capture({ worldBook, chat: { id: 'source-c' }, turn })
    const weirdRows = [
      bindSceneWorldbook(row('assistant', '开场', 1), refs[1]), row('user', '甲'),
      bindSceneWorldbook(row('assistant', '乙', 5), refs[5]), row('user', '丙'),
      bindSceneWorldbook(row('assistant', '丁', 3), refs[3]), row('user', '戊'),
      row('assistant', '己', 3), row('user', '庚'),
      bindSceneWorldbook(row('assistant', '辛', 7), refs[7])
    ]
    const scene = { files: [], worldbooks: await books.exportForSave([chatState({ id: 'source-c', sessionId: 'session-c', messages: weirdRows })]), attachments: [] }
    const weird = await importGame({
      id: 'source-c', sessionId: 'session-c', messages: weirdRows,
      rounds: [{ user: '甲', assistant: '乙' }, { user: '丙', assistant: '丁' }, { user: '戊', assistant: '己' }, { user: '庚', assistant: '辛' }],
      revisions: [{ revision: 1, messages: weirdRows.slice(0, 3) }],
      checkpoints: [{ id: 'checkpoint-5', turn: 5, beforeRevision: 1 }], scene
    })
    // A ref whose turn has no message at all: a numeric upper bound would still copy it.
    await books.capture({ worldBook, chat: { id: weird.chatId }, turn: 2 })
    const refPath = id => 'scene-images/worldbook-refs/' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
    const sourceTurns = turnsOf((await store.readJson(refPath(weird.chatId))).refs)
    assert.deepEqual(sourceTurns, [1, 2, 3, 5, 7], '源存档里同时有缺 turn(2)、重复(3)与非单调(5→3) 的引用')
    const weirdRevision = (await host.rpc('getStoryTranscript', { sessionId: weird.sessionId })).revision
    const weirdPlan = await host.rpc('prepareConversationFork', { chatId: weird.chatId, messageIndex: 2, revision: weirdRevision })
    assert.equal(weirdPlan.turn, 5)
    const weirdFork = await host.rpc('forkChat', { chatId: weird.chatId, sessionId: weird.sessionId, targetSessionId: blankSession('session-c-fork'),
      messageIndex: 2, sourceRevision: weirdPlan.sourceRevision, atSeq: null })
    const forkTurns = turnsOf((await store.readJson(refPath(weirdFork.fork.chatId))).refs)
    assert.deepEqual(forkTurns, [1, 5], '只拷贝分成前缀里真的有的 turn，不被 turn 2（缺失）或 3、7（前缀之外）带上')
    assert.deepEqual(await transcriptRows('session-c-fork'), (await transcriptRows(weird.sessionId)).slice(0, 3))
    evidence.turnPrefix = { sourceTurns, forkTurns }

    // ---- 旧 atSeq 分叉路径：原生回合边界仍被校验，不回归 ----
    const legacyRows = [row('assistant', '第一轮', 1), row('user', '继续一'), row('assistant', '第二轮', 2), row('user', '继续二'), row('assistant', '第三轮', 3)]
    const legacy = await importGame({
      id: 'source-d', sessionId: 'session-d', messages: legacyRows,
      rounds: [{ user: '开场输入', assistant: '第一轮' }, { user: '继续一', assistant: '第二轮' }, { user: '继续二', assistant: '第三轮' }],
      revisions: [{ revision: 1, messages: legacyRows.slice(0, 3) }],
      checkpoints: [{ id: 'checkpoint-2', turn: 2, beforeRevision: 1 }]
    })
    const legacyPlan = await host.rpc('prepareConversationFork', { chatId: legacy.chatId, turn: 3 })
    assert.equal(legacyPlan.storyDirect, false)
    assert.equal(legacyPlan.messageIndex, undefined)
    assert.ok(Number.isSafeInteger(legacyPlan.atSeq))
    const legacyEvents = sessions.get(legacy.sessionId).events
    const boundary = legacyEvents.slice(0, legacyPlan.atSeq + 1)
    assert.equal(boundary.at(-1).type, 'turn/end')
    sessions.set('session-d-fork', { header: { id: 'session-d-fork' }, events: boundary })
    const legacyFork = await host.rpc('forkChat', { chatId: legacy.chatId, sessionId: legacy.sessionId, targetSessionId: 'session-d-fork',
      turn: 3, sourceRevision: legacyPlan.sourceRevision, atSeq: legacyPlan.atSeq })
    assert.equal(legacyFork.fork.messageCount, 5)
    assert.equal(legacyFork.fork.lastTurn, 3)
    assert.deepEqual(await transcriptRows('session-d-fork'), await transcriptRows(legacy.sessionId))
    const legacyForkedFrom = await forkOf('session-d-fork')
    assert.equal(legacyForkedFrom.atSeq, legacyPlan.atSeq)
    assert.equal(legacyForkedFrom.messageIndex, undefined)
    assert.equal(legacyForkedFrom.turn, 3)
    assert.match(await failureOf(host.rpc('forkChat', { chatId: legacy.chatId, sessionId: legacy.sessionId, targetSessionId: blankSession('session-d-wrong'),
      turn: 3, sourceRevision: legacyPlan.sourceRevision, atSeq: legacyPlan.atSeq - 1 })), /源对话已变化/)

    // 回退到更早回合仍走 atSeq：原生事件停在更后面的目标会被拒绝。
    const turnTwoPlan = await host.rpc('prepareConversationFork', { chatId: legacy.chatId, turn: 2 })
    assert.equal(turnTwoPlan.storyDirect, false)
    assert.ok(turnTwoPlan.atSeq < legacyPlan.atSeq)
    sessions.set('session-d-beyond', { header: { id: 'session-d-beyond' }, events: legacyEvents.slice(0, legacyPlan.atSeq + 1) })
    assert.match(await failureOf(host.rpc('forkChat', { chatId: legacy.chatId, sessionId: legacy.sessionId, targetSessionId: 'session-d-beyond',
      turn: 2, sourceRevision: turnTwoPlan.sourceRevision, atSeq: turnTwoPlan.atSeq })), /原生分叉没有停在指定回合/)
    sessions.set('session-d-turn2', { header: { id: 'session-d-turn2' }, events: legacyEvents.slice(0, turnTwoPlan.atSeq + 1) })
    const earlier = await host.rpc('forkChat', { chatId: legacy.chatId, sessionId: legacy.sessionId, targetSessionId: 'session-d-turn2',
      turn: 2, sourceRevision: turnTwoPlan.sourceRevision, atSeq: turnTwoPlan.atSeq })
    assert.equal(earlier.fork.messageCount, 3)
    assert.deepEqual(await transcriptRows('session-d-turn2'), (await transcriptRows(legacy.sessionId)).slice(0, 3))
    assert.equal((await forkOf('session-d-turn2')).atSeq, turnTwoPlan.atSeq)
    assert.equal((await forkOf('session-d-turn2')).stateRevision, 1)
    evidence.legacyAtSeq = { atSeq: legacyPlan.atSeq, messageCount: legacyFork.fork.messageCount, earlierAtSeq: turnTwoPlan.atSeq }
  } finally { await host.dispose() }
  return evidence
}
