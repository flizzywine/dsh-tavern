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

test('前端只通过统一同步快照消费任务结果，不再竞争读取 Operation 和 candidates', function () {
  const coordination = between(clientSource, 'const tavernCoordination', 'function describeTavernActivity')
  const submit = between(clientSource, 'async function submitCandidateTask', 'const regenPanel')

  assert.match(coordination, /rpc\("syncSession"/)
  assert.match(coordination, /view\.task && view\.task\.busy/)
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
  assert.match(clientSync, /tasks\.background/)
  assert.match(clientSync, /tasks\.candidate/)
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
