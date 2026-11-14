import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// A running background task used to re-project the whole session every two
// seconds. Status changes now arrive as tavern-state signals; the poll is only a
// fallback, and a hidden page projects nothing.
test('进行中的后台任务改为推送优先，2 秒全量轮询不再出现', () => {
  assert.equal(source.includes('liveTavernView.invalidate(props.sessionId), 2000)'), false)
  assert.equal(source.includes('void load(); }, 2000)'), false)
  assert.equal(source.includes('invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }, 2000)'), false)
  const watch = source.match(/watchTavernState\(/g) || []
  const poll = source.match(/pollTaskWhile\(/g) || []
  assert.equal(watch.length, 5, '定义处 1 次 + 台账、人物设计、压缩、插件任务各 1 次')
  assert.equal(poll.length, 5)
  assert.equal((source.match(/function pollTaskWhile\(/g) || []).length, 1)
  assert.match(source, /visibleMs[\s\S]{0,80}5000/)
  assert.match(source, /hiddenMs[\s\S]{0,80}30000/)
  assert.match(source, /document\.visibilityState === "hidden"/)
})

test('任务状态的写入会主动通知会话', () => {
  const ledger = readFileSync(new URL('../tavern-plugin/lib/domain/manual-ledger.js', import.meta.url), 'utf8')
  const design = readFileSync(new URL('../tavern-plugin/lib/domain/manual-character-design.js', import.meta.url), 'utf8')
  const compaction = readFileSync(new URL('../tavern-plugin/lib/domain/auto-compaction.js', import.meta.url), 'utf8')
  for (const file of [ledger, design]) {
    assert.match(file, /onStatus\(String\(sessionId \|\| ''\)\)/)
    assert.match(file, /onStatus = \(\) => \{\}/)
  }
  assert.match(compaction, /deps\.onState\?\.\(id, result\)/)
})
