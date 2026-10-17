import test from 'node:test'
import assert from 'node:assert/strict'
import { compactionFailureMessage } from '../tavern-plugin/lib/domain/compaction-failure.js'

test('流空闲超时显示时长、未完成状态和处理建议，保留安全技术信息', () => {
  const inner = new Error('pi-ai stream idle timeout after 300000ms PRIVATE payload')
  const error = new Error('manual compaction could not produce a smaller summary', { cause: inner })
  const message = compactionFailureMessage(error)
  assert.match(message, /连续 5 分钟未收到模型响应/)
  assert.match(message, /本次压缩未完成，原始聊天记录仍保留/)
  assert.match(message, /换模型发送一条消息后再压缩/)
  assert.match(message, /stream idle timeout after 300000ms/)
  assert.doesNotMatch(message, /PRIVATE/)
  assert.match(compactionFailureMessage('pi-ai stream idle timeout after 90000ms'), /90 秒/)
  assert.equal(error.cause, inner)
})

test('未知失败附上最内层原因，而不是只显示 DSH 的笼统提示 (#148)', () => {
  const inner = new TypeError("Cannot assign to read only property 'x' of object")
  const error = new Error('manual compaction could not produce a smaller summary', { cause: inner })
  assert.equal(compactionFailureMessage(error), "manual compaction could not produce a smaller summary（原因：Cannot assign to read only property 'x' of object）")
  assert.equal(compactionFailureMessage(new Error('plain')), 'plain')
})
