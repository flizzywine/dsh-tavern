import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 组件级（BodyEditPanel）运行成本高：这里只做源码静态断言，标注「部分确认」。
test('BodyEditPanel 保存与重试不丢 UID，原生输入按 turn+seq 恢复（静态部分确认）', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const call = /rpc\("saveBodyEdit",\s*\{([^}]*)\}/.exec(source)
  assert.ok(call, '找不到 saveBodyEdit 调用')
  assert.match(call[1], /messageIndex:\s*edit\.messageIndex/)
  assert.match(call[1], /revision:\s*edit\.revision/)
  assert.match(call[1], /messageUid:\s*edit\.messageUid/)
  assert.match(source, /getBodyEdit",\s*\{\s*role:\s*edit\.role,\s*messageIndex:\s*edit\.messageIndex,\s*revision:\s*revision,\s*messageUid:\s*edit\.messageUid/, '故事重试必须携带 UID')
  assert.match(source, /getBodyEdit",\s*\{\s*role:\s*"user",\s*turn:\s*edit\.turn,\s*seq:\s*edit\.seq/, '原生输入重试不再被 messageIndex 条件排除')
  assert.match(source, /refreshed\.edit\.messageUid\s*!==\s*edit\.messageUid/, '同文本的另一 UID 不得通过重试')
  assert.match(source, /JSON\.stringify\(refreshed\.edit\.parts\)\s*!==\s*JSON\.stringify\(panel\.edit\.parts\)/, '过期重试必须先确认可编辑内容逐字未变')
  assert.match(source, /new CustomEvent\("dsh-tavern-story-mutated"/, '保存后仍需广播 story-mutated 让故事列表重读')
})
