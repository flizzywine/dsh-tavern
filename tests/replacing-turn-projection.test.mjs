import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'

const events = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' } } } }
]
const session = { id: 's', events, surface: { nodes: [0, 1] } }
const fields = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session, events }) })

function viewOf(chat) {
  return fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [], ...chat }, { session, events })
}

// 「正文走工具调用」的回合没有自己的流式正文：唯一能画的是折叠写下的那份 append。
// 重新生成后那份副本仍留在被替换的回合里。若把它连同旧回合一起隐藏，页面上就一条正文
// 都不剩（替换副本只给模型），表现为「轨迹里有、对话里没有」。宁可保留那一回合。
const foldOnlyEvents = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '开场' }] } } },
  { seq: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 4, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'Pass' }] } } },
  { seq: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 6, message: { source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text: '正文' }] } } },
  { seq: 4, type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 3 }, sourceEventSeqs: [2, 3],
    data: { turn: 7, message: { source: { kind: 'model', provider: 'p', model: 'm', tavernStoryTurn: 4 }, content: [{ type: 'text', text: '正文' }] } } }
]
const foldOnlySession = { id: 's', events: foldOnlyEvents, surface: { nodes: [0, 1, 4] } }

// 旧存档的工具回合：正文副本是在提交时折叠进生成期那一轮的 append，随后又被替换
// 副本盖住；重新生成的范围把折叠替换也包了进去，末尾落在一个替换节点上。只看
// range 末尾会映射到没有任何可画行的编辑回合，生成期那一轮又被当成作废回合，
// 整轮正文于是消失（#283 的旧档形态）。
const oldToolFoldEvents = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', surfaceOp: 'append', data: { turn: 4, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '工具回合的旧流' }] } } },
  { seq: 2, type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin:dsh-tavern-regen' } } },
  { seq: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 5, message: { source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text: '工具回合的旧流' }] } } },
  { seq: 4, type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: 1, endSeq: 3 }, sourceEventSeqs: [1, 2, 3],
    data: { turn: 5, message: { source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text: '工具回合的旧流' }] } } },
  { seq: 5, type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: 1, endSeq: 4 }, sourceEventSeqs: [1, 2, 3, 4],
    data: { turn: 6, message: { source: { kind: 'model', provider: 'p', model: 'm', tavernStoryTurn: 4 }, content: [{ type: 'text', text: '重新生成后的新正文' }] } } }
]
const oldToolFoldSession = { id: 's', events: oldToolFoldEvents, surface: { nodes: [0, 5] } }

test('旧工具回合重新生成后，映射指向仍可画的折叠副本，而不是没有行的编辑回合', () => {
  const view = fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [] },
    { session: oldToolFoldSession, events: oldToolFoldEvents })
  assert.equal(view.regeneratedDshTurns[4], 5, '折叠副本画在生成期那一轮')
  assert.deepEqual(view.supersededDshTurns, [4], '只藏旧流所在的回合')
})
