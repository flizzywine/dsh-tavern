
import assert from 'node:assert/strict'
import test from 'node:test'

import { resourceWorkspaceContext } from '../tavern-plugin/lib/domain/workspace-resources.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from '../tavern-plugin/lib/domain/play-chat-debug.js'

function chats() {
  return {
    editor: { mode: 'card', cardPath: 'cards/阿芙拉.json' },
    source: { id: 'chat-source', mode: 'story', cardPath: 'cards/阿芙拉.json',
      messages: [{ role: 'assistant', turn: 2, text: '正文' }] }
  }
}

test('工作台的游玩诊断引用使用真实对话身份并校验人物卡', () => {
  const { editor, source } = chats()
  const reference = createPlayChatDebugReference(editor, source, 2)
  assert.equal(reference.path, 'play-chat:chat-source')
  assert.equal(reference.chatId, source.id)
  assert.equal(reference.turn, 2)
  assert.throws(() => createPlayChatDebugReference(editor, { ...source, cardPath: 'cards/另一张.json' }, 2), /人物卡不一致/)
})

test('工作台拒绝未关联的对话引用与不存在的游玩轮次', () => {
  const { editor, source } = chats()
  const reference = createPlayChatDebugReference(editor, source, 2)
  assert.throws(() => readPlayChatDebugTurn(editor, source, { ...reference, chatId: 'chat-other' }), /未关联到当前对话/)
  assert.throws(() => readPlayChatDebugTurn(editor, source, { ...reference, kind: 'card' }), /未关联到当前对话/)
  assert.throws(() => readPlayChatDebugTurn(editor, source, reference, { turn: 9 }), /不存在第 9 轮/)
})

test('前台保存的工作区模板替换真实路径，不递归解释路径或其他模板变量', () => {
  const projection = { specPath: '.tavern/README.md', bindingsPath: 'bindings.json', contextPath: 'session-a/context.json', diagnosticsPath: 'diag.json' }
  const custom = '我的说明：{{resourceRoot}}\n{{projectionPaths}}\n保留 {{user}}'
  const text = resourceWorkspaceContext('/workspace/{{projectionPaths}}', projection, custom)
  assert.ok(text.startsWith('我的说明："/workspace/{{projectionPaths}}"'))
  assert.match(text, /session-a\/context.json/)
  assert.ok(text.endsWith('保留 {{user}}'))
  assert.equal(resourceWorkspaceContext('/root', null, '只保留我的说明'), '只保留我的说明')
  assert.equal(resourceWorkspaceContext('', projection, custom), '')
})
