import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

for (const task of ['settlement', 'image', 'plugin']) test(task + ' 复用会话时置顶最新指令且清空后移除', async () => {
  let assemble, completeSection, pending, text = '第一版'
  const seen = []
  const session = { id: task, header: {}, events: [], append(type, data) { this.events.push({ type, data }) } }
  const runner = createBackgroundAgentRunner({
    systemAppend: () => text,
    agents: { get: () => ({ session: { header: {} } }), async create(options) {
      await options.setup({ systemPrompt: { section(section) { if (section.complete) completeSection = section }, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on(event, callback) { if (event === 'system-prompt/assemble') assemble = callback } })
      return { agent: { session, followup() { pending = (async () => {
        const result = await assemble({}, { agent: { session } }, async () => ({ sections: [{ name: 'original', text: '原有指令' }], tools: [] }))
        // Match the host: complete sections are snapshotted before the hook
        // and replace its sections afterwards.
        const completeText = completeSection.text()
        seen.push({ hook: result.sections.map(s => s.text), flags: result.sections.map(s => s.interpolate), complete: completeSection.interpolate, system: completeText })
        session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
      })() }, async whenIdle() { await pending } }, async dispose() {} }
    } }
  })
  try {
    for (text of ['第一版', '第二版', '']) await runner.run({ sessionId: 'parent', persistent: true, task, selection: { provider: 'test', model: 'fake' }, messages: [], tools: [] })
    const first = '<system_append>\n第一版\n</system_append>'
    const second = '<system_append>\n第二版\n</system_append>'
    assert.deepEqual(seen.map(result => result.hook), [[first, '原有指令'], [second, '原有指令'], ['原有指令']])
    assert.ok(seen[0].system.startsWith(first + '\n\n'))
    assert.ok(seen[1].system.startsWith(second + '\n\n'))
    assert.equal(seen[2].system.includes('第一版'), false)
    assert.equal(seen[2].system.includes('第二版'), false)
    // 玩家手写指令与后台 persona 都拼接了人物卡快照，必须按字面文本渲染。
    assert.equal(seen[0].flags[0], false)
    assert.equal(seen[0].complete, false)
    assert.equal(seen[1].complete, false)
  } finally { await runner.dispose() }
})
