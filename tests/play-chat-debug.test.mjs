import assert from 'node:assert/strict'
import test from 'node:test'

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

test('卡片 Agent 可按层分段读取指定游玩轮次', () => {
  const { source, editor } = chats()
  const ref = createPlayChatDebugReference(editor, source, 2)
  editor.workspace.mountedResources.push(ref)

  const overview = readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'overview' })
  assert.doesNotMatch(overview.text, /走进教室|Session 正文/)
  assert.match(overview.text, /最新一轮游玩诊断/)
  assert.match(overview.text, /模型原文：4 字/)
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { layer: 'input' }).text, '走进教室')
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'source' }).text, '模型原文')
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'session' }).text, 'Session 正文')
  const currentProjection = { displayText: '<div>当前正则展示</div>', applied: { session: [], display: [] }, warnings: [] }
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'display' }, currentProjection).text, '<div>当前正则展示</div>')
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'saved-display' }, currentProjection).text, '<div>展示</div>')

  const diagnostics = readPlayChatDebugTurn(editor, source, ref, { turn: 2, layer: 'diagnostics' }, {
    applied: { session: [], display: [{ name: '候选项', matches: 1 }] }, warnings: ['展示警告']
  })
  assert.match(diagnostics.text, /候选项/)
  assert.match(diagnostics.text, /按当前人物卡重新计算/)
  assert.match(diagnostics.text, /display.*实时投影/)
})

test('卡片 Agent 从最新轮次渐进披露，并可按需读取整场证据', () => {
  const { source, editor } = chats()
  const ref = createPlayChatDebugReference(editor, source, 2)
  const evidence = {
    foreground: { sessionId: 'session-foreground', loaded: true, events: [{ type: 'assistant-step', text: '前台日志' }] },
    background: { sessionId: 'session-background', loaded: true, events: [{ type: 'tool-result', text: '后台日志' }] },
    requests: { loaded: true, requests: [{ scope: 'foreground', turn: 2, request: { messages: [{ role: 'system', content: [{ type: 'text', text: '真实前缀' }] }] } }] }
  }

  const overview = readPlayChatDebugTurn(editor, source, ref, { layer: 'overview' }, null, evidence)
  assert.match(overview.text, /最新一轮游玩诊断/)
  assert.doesNotMatch(overview.text, /开场|走进教室|前台 Session/)
  assert.match(overview.text, /最新一轮只是默认入口，不是读取边界/)
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'turns' }, null, evidence).text, /第 1 轮[\s\S]*第 2 轮/)
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'conversation' }, null, evidence).text, /玩家：走进教室/)
  assert.equal(readPlayChatDebugTurn(editor, source, ref, { turn: 1, layer: 'source' }, null, evidence).text, '开场')
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'tavern' }, null, evidence).text, /lastSettle/)
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'foreground' }, null, evidence).text, /前台日志/)
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'background' }, null, evidence).text, /后台日志/)
  assert.match(readPlayChatDebugTurn(editor, source, ref, { layer: 'request' }, null, evidence).text, /真实前缀/)
  const iframe = readPlayChatDebugTurn(editor, source, ref, { layer: 'iframe', turn: 2 }, null, evidence)
  assert.match(iframe.text, /实际 DOM/)
  assert.match(iframe.text, /example\.com\/a/)
})

test('未挂载记录、错误轮次和跨人物卡读取会被拒绝', () => {
  const { source, editor } = chats()
  const ref = createPlayChatDebugReference(editor, source, 2)
  assert.throws(() => readPlayChatDebugTurn(editor, source, null, { turn: 2 }), /尚未挂载/)
  assert.throws(() => readPlayChatDebugTurn(editor, source, ref, { turn: 9 }), /不存在第 9 轮/)
  assert.throws(() => readPlayChatDebugTurn(Object.assign({}, editor, { cardPath: 'cards/另一张.json' }), source, ref, { turn: 2 }), /人物卡不一致/)
})
