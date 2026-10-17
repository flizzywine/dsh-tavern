import assert from 'node:assert/strict'
import test from 'node:test'

import { registerPlayChatTool } from '../tavern-plugin/lib/tools/play-chat.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from '../tavern-plugin/lib/domain/play-chat-debug.js'

function chats() {
  const source = {
    id: 'chat-play', mode: 'story', cardPath: 'cards/校园.json', cardName: '校园',
    sessionId: 'session-foreground', cardContextSnapshot: '人物卡快照', cardContextSnapshotVersion: 3, updatedAt: 123,
    timeline: { participants: { background: { sessionId: 'session-background' } }, operations: [{ kind: 'settle', turn: 2 }] },
    lastSettle: { turn: 2, status: 'completed' }, candidates: { turn: 2, items: ['A', 'B'] },
    messages: [
      { role: 'assistant', text: '开场', sourceText: '开场', turn: 1, greeting: true },
      { role: 'user', text: '走进教室' },
      { role: 'assistant', text: 'Session 正文', sourceText: '模型原文', displayText: '<div>展示</div>', projectionWarnings: ['旧警告'], turn: 2,
        displayRuntime: { frames: [{ partIndex: 0, captureKind: 'live', dom: '<div>实际 DOM</div>', console: [{ level: 'warn', args: ['警告'] }], network: [{ method: 'GET', url: 'https://example.com/a', status: 200 }] }] } }
    ]
  }
  const editor = { id: 'chat-editor', mode: 'card', cardPath: 'cards/校园.json', workspace: { mountedResources: [] } }
  return { source, editor }
}

test('只允许把同一人物卡的游玩轮次挂载到卡片工作台', () => {
  const { source, editor } = chats()
  const ref = createPlayChatDebugReference(editor, source, 2)
  assert.equal(ref.kind, 'play-chat')
  assert.equal(ref.path, 'play-chat:chat-play')
  assert.equal(ref.turn, 2)
  assert.equal(ref.cardSnapshotVersion, 3)
  assert.equal(ref.cardSnapshotDigest.length, 16)
  assert.equal(createPlayChatDebugReference(editor, source, 1).turn, 2)
  assert.throws(() => createPlayChatDebugReference(Object.assign({}, editor, { cardPath: 'cards/另一张.json' }), source, 2), /人物卡不一致/)
  assert.throws(() => createPlayChatDebugReference(editor, Object.assign({}, source, { mode: 'card' }), 2), /游玩模式/)
})

test('未关联记录、错误轮次和跨人物卡读取会被拒绝', () => {
  const { source, editor } = chats()
  const ref = createPlayChatDebugReference(editor, source, 2)
  assert.throws(() => readPlayChatDebugTurn(editor, source, null, { turn: 2 }), /未关联到当前对话/)
  assert.throws(() => readPlayChatDebugTurn(editor, source, ref, { turn: 9 }), /不存在第 9 轮/)
  assert.throws(() => readPlayChatDebugTurn(Object.assign({}, editor, { cardPath: 'cards/另一张.json' }), source, ref, { turn: 2 }), /人物卡不一致/)
})


test('初始概览提供本局预设和完整上下文查询入口，分页保留大字段并隐藏凭据', () => {
  const { source, editor } = chats()
  source.runtimePresetSnapshot = { presetName: '测试预设', presetPath: 'presets/test.json', front: 'x'.repeat(14000), regexScripts: [{ id: 'preset-rule' }] }
  source.variables = { nested: { apiKey: 'private-key', state: { a: { b: { c: { d: { value: '完整变量' } } } } } } }
  const ref = createPlayChatDebugReference(editor, source)
  const read = (layer, offset = 1) => readPlayChatDebugTurn(editor, source, ref, { layer, offset, limit: 12000 })
  assert.match(read('overview').text, /测试预设/)
  assert.match(read('overview').text, /context/)
  for (const layer of ['preset', 'context']) {
    let text = '', offset = 1, result
    do { result = read(layer, offset); text += result.text; offset = result.to + 1 } while (!result.done)
    assert.ok(text.includes('x'.repeat(14000)))
    assert.match(text, /preset-rule/)
    assert.doesNotMatch(text, /已截断/)
    if (layer === 'context') {
      assert.match(text, /完整变量/)
      assert.doesNotMatch(text, /private-key/)
      assert.match(text, /已隐藏/)
    }
  }
  const regex = readPlayChatDebugTurn(editor, source, ref, { layer: 'regex' }, null, { regex: [{ id: 'global' }, { id: 'preset-rule' }, { id: 'card' }] })
  assert.match(regex.text, /preset-rule/)
  delete source.runtimePresetSnapshot
  assert.match(read('preset').text, /未保存预设快照/)
})


test('调试工具按全局、预设、卡片顺序重算实际展示', async () => {
  const { source, editor } = chats()
  editor.workspace.mountedResources = [createPlayChatDebugReference(editor, source)]
  const rule = (id, from, to) => ({ id, name: id, findRegex: from, replaceString: to, placement: [2], enabled: true, markdownOnly: true })
  const global = rule('global', '模型原文', 'global-output')
  const preset = rule('preset', 'global-output', 'preset-output')
  const card = rule('card', 'preset-output', '完整组合结果')
  source.runtimePresetSnapshot = { regexScripts: [preset] }
  let tool
  registerPlayChatTool({
    tools: { register(value) { tool = value } }, str: value => String(value || ''),
    chatForSession: async () => editor, readChat: async () => source,
    readCardExtensions: async () => ({ regexScripts: [global, card], globalRegexScripts: [global] }),
    sessionDebugEvidence: () => ({ loaded: false }), modelRequestLog: { evidence: async () => ({ requests: [] }) }
  })
  const regex = await tool.execute({ layer: 'regex' }, {})
  assert.deepEqual(JSON.parse(regex.text.slice(regex.text.indexOf('\n') + 1)).map(rule => rule.id), ['global', 'preset', 'card'])
  const display = await tool.execute({ layer: 'display' }, {})
  assert.equal(display.text, '完整组合结果')
  const diagnostics = await tool.execute({ layer: 'diagnostics' }, {})
  assert.match(diagnostics.text, /preset/)
})
