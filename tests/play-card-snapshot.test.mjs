import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'

// Exercise the host's actual snapshot closure without starting DSH or touching user chats.
const source = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const snapshotSource = source.slice(source.indexOf('  const cardSnapshotBuilds = new Map()'), source.indexOf('  const runtimePresetSnapshots = new Map()'))

test('v4 老对话重建完整固定前缀，v5 后续请求和恢复复用快照', async () => {
  const card = { name: '测试人物', description: '固定描述', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '逐轮系统指令', post_history_instructions: '逐轮历史后指令' }
  let reads = 0
  const writes = []
  function open() {
    return new Function('worldBooks', 'constantWorldBookContext', 'str', 'sanitizeAgentProjectionText', 'contextPlanner', 'groupOfMode', 'readChatCard', 'writeChat', snapshotSource + '\nreturn ensurePlayCardSnapshot;')(
      { async bound(path) {
        assert.equal(path, 'cards/测试人物.json')
        return { view: { entries: [
          { constant: true, content: '固定世界设定' },
          { constant: false, content: '动态条目不得进入前缀' },
          { constant: true, comment: '[mvu_update]规则', content: 'MVU规则不得进入前缀' }
        ] } }
      } }, constantWorldBookContext, value => String(value ?? ''), text => text,
      createContextPlanner({ prompt: () => '' }), mode => mode === 'card' ? 'card' : 'play',
      async () => { reads++; return card },
      async (chat, metadata) => { writes.push({ chat: structuredClone(chat), metadata }) }
    )
  }
  const chat = { id: 'old-chat', mode: 'story', cardPath: 'cards/测试人物.json', cardContextSnapshotVersion: 4, cardContextSnapshot: '旧前缀缺少描述性格', messages: [{ role: 'assistant', text: '原有剧情' }] }
  const beforeMessages = structuredClone(chat.messages)
  const ensure = open()
  const first = await ensure(chat)
  assert.equal(chat.cardContextSnapshotVersion, 5)
  for (const fixed of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界设定']) assert.equal(first.split(fixed).length - 1, 1)
  assert.doesNotMatch(first, /旧前缀|逐轮|动态条目|MVU规则/)
  assert.equal(await ensure(chat), first)
  assert.equal(await open()(structuredClone(chat)), first)
  assert.equal(reads, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].metadata.source, 'card-context.snapshot')
  assert.deepEqual(chat.messages, beforeMessages)
})
