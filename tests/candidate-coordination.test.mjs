import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('候选生成先持久任务信箱，HTTP 请求不等待 Agent 完成', function () {
  const submit = between(serverSource, 'async function submitCandidateTask', 'async function listTavernSessions')
  const dispatch = between(serverSource, "case 'syncSession'", "case 'getSessionActivity'")

  assert.match(submit, /await taskMailbox\.submit/)
  assert.match(submit, /scheduleCandidateTask\(chat\.id, task\)/)
  assert.doesNotMatch(submit, /await candidateGenerator\.prepare|await prepared\.execute/)
  assert.match(dispatch, /case 'submitTask'/)
})

test('前端只通过 SSE 消费统一快照，不再定时轮询或竞争读取结果', function () {
  const coordination = between(clientSource, 'const tavernCoordination', 'function describeTavernActivity')
  const submit = between(clientSource, 'async function submitCandidateTask', 'const regenPanel')

  assert.match(coordination, /new window\.EventSource/)
  assert.match(coordination, /\/api\/dsh-tavern\/events/)
  assert.doesNotMatch(coordination, /rpc\("syncSession"|setTimeout|setInterval/)
  assert.match(submit, /rpc\("submitTask"/)
  assert.doesNotMatch(submit, /getBackgroundOperation|getChoices|startChoices|Promise\.race/)
  assert.doesNotMatch(clientSource, /createCandidateGenerationCoordinator/)
})

test('Session、世界书、结算与候选使用同一持久同步快照', function () {
  const serverSync = between(serverSource, 'async function sessionSync', 'async function submitCandidateTask')
  const clientSync = between(clientSource, 'function coordinationView', 'const tavernCoordination')

  assert.match(serverSync, /tasks: \{ candidate: task, background: backgroundTask \}/)
  assert.match(serverSync, /runtimeGeneration/)
  assert.match(serverSync, /liveSession/)
  assert.match(serverSync, /projectionRevision/)
  assert.match(clientSync, /tasks\.background/)
  assert.match(clientSync, /tasks\.candidate/)
  assert.match(clientSync, /projectionRevision/)
})

test('服务器先检查轻量存储版本，再通过 SSE 发送变化后的完整快照', function () {
  assert.match(serverSource, /createCoordinationEventPublisher/)
  assert.match(serverSource, /readVersion: async function/)
  assert.match(serverSource, /chatPersistence\.version\(chatId\)/)
  assert.match(serverSource, /profileData\.version\('card-projection-revisions\.json'\)/)
  assert.match(serverSource, /pollIntervalMs: 250/)
  assert.match(serverSource, /'Content-Type': 'text\/event-stream; charset=utf-8'/)
  assert.match(serverSource, /coordinationEvents\.subscribe\(sessionId/)
  assert.match(serverSource, /data: ' \+ JSON\.stringify\(snapshot\)/)
})

test('所有 Tavern Chat 热写入统一经过增量 Persistence', function () {
  assert.match(serverSource, /createChatJournalStore\(\{ dataRoot/)
  assert.match(serverSource, /createChatPersistence\(\{ store: chatJournalStore/)
  assert.doesNotMatch(serverSource, /(?:writeJson|updateJson)\([^\n]*chats\//)
})

test('SSE 收到人物卡展示修订后主动刷新游玩投影', function () {
  const coordination = between(clientSource, 'const tavernCoordination', 'function describeTavernActivity')

  assert.match(coordination, /onView:/)
  assert.match(coordination, /liveTavernView\.invalidate\(sessionId\)/)
})

test('后台完成而提醒丢失时，页面依据持久 task.result 直接恢复候选面板', function () {
  const action = between(clientSource, 'function CandidateAction', 'function CandidateDockActions')

  assert.match(action, /taskForMessage\.status === "succeeded"/)
  assert.match(action, /taskForMessage\.result\.candidates/)
  assert.match(action, /readyCandidatePanel/)
  assert.match(action, /taskForMessage\.terminal/)
  assert.doesNotMatch(action, /hasLoadingPanel \|\| activity\.busy/)
})

test('提交响应丢失时用同一 requestId 有界重试，正确性由持久信箱保证', function () {
  const submit = between(clientSource, 'async function submitCandidateTask', 'const regenPanel')

  assert.match(submit, /const requestId = candidateRequestId\(\)/)
  assert.match(submit, /attempt < 3/)
  assert.match(submit, /requestId: requestId/)
  assert.match(submit, /controller\.abort\(\)/)
  assert.match(submit, /tavernCoordination\.invalidate\(sessionId\)/)
})
