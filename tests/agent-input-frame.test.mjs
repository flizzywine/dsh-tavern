import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundTaskFrame, createForegroundFrameBuilder, foregroundFrameText } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

function builder() {
  return createForegroundFrameBuilder()
}

function frame(instructions) {
  return builder().build({
    chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 3, operationId: 'operation-1', turn: 4,
    inputs: [{ kind: 'foreground.user-input', sourceText: '原始输入', projectedText: '投影输入' }].concat(instructions),
    source: { cardRevision: 'card-hash' }
  })
}

test('ForegroundFrameBuilder 只接受前台输入并显式诊断其他类型', () => {
  const result = frame([
    { kind: 'foreground.card-context', text: '人物设定', source: { field: 'description' } },
    { kind: 'compat.prompt-at-depth', reason: 'compatibility-only', source: { depth: 4 } }
  ])

  assert.equal(result.context.cardContext, '人物设定')
  assert.deepEqual(result.ignored, [{ index: 2, kind: 'compat.prompt-at-depth', source: { depth: 4 }, reason: 'compatibility-only' }])
  assert.equal(result.diagnostics[0].code, 'FOREGROUND_FRAME_INPUT_IGNORED')
})

test('ForegroundFrame 保留结构化槽位、原始顺序、权威 revision 与稳定 id', () => {
  const first = frame([
    { kind: 'foreground.writing-rules', text: '先遵守故事规则' },
    { kind: 'foreground.active-worldbook', text: '钟楼只在午夜开放' },
    { kind: 'foreground.current-state', text: '角色站在门边' },
    { kind: 'foreground.guide', text: '少解释，多动作' }
  ])
  const retried = frame([
    { kind: 'foreground.writing-rules', text: '先遵守故事规则' },
    { kind: 'foreground.active-worldbook', text: '钟楼只在午夜开放' },
    { kind: 'foreground.current-state', text: '角色站在门边' },
    { kind: 'foreground.guide', text: '少解释，多动作' }
  ])

  assert.equal(first.frameId, retried.frameId)
  assert.equal(first.userInput.projectedText, '投影输入')
  assert.equal(first.context.activeWorldbook, '钟楼只在午夜开放')
  assert.equal(first.context.currentStateProjection, '角色站在门边')
  assert.equal(foregroundFrameText(first), '先遵守故事规则\n\n钟楼只在午夜开放\n\n角色站在门边\n\n少解释，多动作')
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.context), true)
})

test('Session Adapter 只在 step 1 追加一次 ForegroundFrame', () => {
  const value = frame([{ kind: 'foreground.writing-rules', text: '本轮规则' }])
  const adapter = createForegroundFrameSessionAdapter({ id: () => 'message-frame-1' })
  const first = adapter.append({ messages: [], frame: value, step: 1 })
  const duplicate = adapter.append({ messages: first.messages, frame: value, step: 1 })
  const laterStep = adapter.append({ messages: first.messages, frame: value, step: 2 })

  assert.equal(first.receipt.appended, true)
  assert.equal(first.messages[0].source.form, 'foreground-frame')
  assert.equal(first.messages[0].source.trace.frameId, value.frameId)
  assert.equal(duplicate.receipt.reason, 'duplicate')
  assert.equal(duplicate.messages, first.messages)
  assert.equal(laterStep.receipt.reason, 'not-first-step')
})

test('BackgroundTaskFrame 只冻结接口，不触发任何后台执行', () => {
  const value = createBackgroundTaskFrame({
    frameId: 'background-1', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 8,
    taskType: 'mvu-variable-analysis', trigger: 'foreground-reply-completed', foregroundOutput: '正文',
    authoritativeState: { hp: 10 }, outputContract: { type: 'json-patch' }
  })

  assert.equal(value.kind, 'background-task')
  assert.equal(value.taskType, 'mvu-variable-analysis')
  assert.equal(Object.isFrozen(value.authoritativeState), true)
})
