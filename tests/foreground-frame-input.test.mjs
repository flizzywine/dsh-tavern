import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundFrameBuilder, compactUserInput, frameUserInput, foregroundRequestContext } from '../tavern-plugin/lib/domain/agent-input-frame.js'

const builder = createForegroundFrameBuilder()
function build(input) {
  return builder.build({
    chatId: 'chat-1', branchId: 'main', operationId: 'operation-1', turn: 3, basedOnRevision: 7,
    inputs: [{ kind: 'foreground.user-input', ...input }], source: {}
  })
}

test('玩家输入与投影相同时只存一份，读取时按原文补回', async () => {
  const frame = build({ sourceText: '推开门', projectedText: '推开门' })
  assert.equal(frame.userInput.sourceText, '推开门')
  assert.equal(frame.userInput.projectedText, undefined, '相同内容不重复落库')
  assert.deepEqual(frameUserInput(frame), { sourceText: '推开门', projectedText: '推开门', source: {} })
  const context = foregroundRequestContext({ id: 'chat-1', timeline: { branchId: 'main' }, foregroundFrames: { 'operation-1': frame } }, 3)
  assert.equal(context.input, '推开门')
})

test('投影确实不同时保留两份；空投影不被当成缺省', async () => {
  const rewritten = build({ sourceText: '{{user}}推开门', projectedText: '小明推开门' })
  assert.equal(rewritten.userInput.sourceText, '{{user}}推开门')
  assert.equal(rewritten.userInput.projectedText, '小明推开门')
  const dropped = compactUserInput({ sourceText: '有内容', projectedText: '' })
  assert.equal(dropped.projectedText, '')
  assert.equal(frameUserInput({ userInput: dropped }).projectedText, '', '空投影不能退回原文')
})

test('旧格式 Frame（两份都存）与缺失输入的 Frame 都能读', async () => {
  assert.deepEqual(frameUserInput({ userInput: { sourceText: '甲', projectedText: '乙' } }).projectedText, '乙')
  assert.deepEqual(frameUserInput({ userInput: { sourceText: '甲' } }), { sourceText: '甲', projectedText: '甲', source: undefined })
  assert.deepEqual(frameUserInput({}), { sourceText: '', projectedText: '', source: undefined })
  assert.deepEqual(frameUserInput(null), { sourceText: '', projectedText: '', source: undefined })
})
