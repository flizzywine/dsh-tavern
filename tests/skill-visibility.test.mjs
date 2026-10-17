import assert from 'node:assert/strict'
import test from 'node:test'

import { appendWritingSkillState } from '../tavern-plugin/lib/domain/skill-visibility.js'
import { Session } from './fixtures/dsh-session-host.mjs'

const ordinary = { id: 'ordinary', source: { kind: 'plugin' } }
const catalog = { id: 'catalog', source: { kind: 'skill-catalog' } }
const invocation = { id: 'invocation', source: { kind: 'skill-invocation', name: 'manual-writing' } }

test('恢复的游玩会话不重复通知；策略离开可见历史后重新声明当前开关', () => {
  const session = Session.create('skill-state')
  const options = { session, disabledWritingSkills: ['manual-writing'] }
  const pending = [ordinary, catalog, invocation]
  const first = appendWritingSkillState(pending, 'script', options)
  assert.deepEqual(first.slice(0, 3), pending)
  const notice = first.at(-1)
  session.append('user/message', notice, { surfaceOp: 'append' })
  const restored = Session.fromRestore(session.id, session.snapshotEvents(), session.header)
  assert.equal(appendWritingSkillState(pending, 'script', { ...options, session: restored }), pending)
  // A switch need not change the model-invocable catalog (manual-only skills).
  const enabled = appendWritingSkillState(pending, 'script', { session: restored })
  assert.deepEqual(enabled.at(-1).source.disabledWritingSkills, [])
  // Rewind/compaction can remove the policy from the visible Surface while
  // keeping its event in durable history. It must then be published again.
  restored.append('user/message', { id: 'summary', role: 'user', source: { kind: 'plugin', plugin: 'fixture' }, content: [{ type: 'text', text: '摘要' }] }, {
    sourceEventSeqs: [restored.surface.nodes[0]],
    surfaceOp: { op: 'replace', startSeq: restored.surface.nodes[0], endSeq: restored.surface.nodes[0] }
  })
  assert.deepEqual(appendWritingSkillState(pending, 'script', { ...options, session: restored }).at(-1).source.disabledWritingSkills, ['manual-writing'])
})

test('开关只在影响已加载的 Skill 或已声明的停用时才通知', () => {
  const session = Session.create('skill-state-quiet')
  // Nothing disabled and nothing declared: no notice at all.
  assert.deepEqual(appendWritingSkillState([ordinary], 'story', { session }), [ordinary])
  // Disabled but never loaded: the native catalog already hides it.
  assert.deepEqual(appendWritingSkillState([ordinary], 'story', { session, disabledWritingSkills: ['never-loaded'] }), [ordinary])
  // A model-loaded skill that is then disabled must be revoked.
  session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'skill', arguments: { name: 'loaded-style' } }] } }, { surfaceOp: 'append' })
  const revoked = appendWritingSkillState([ordinary], 'story', { session, disabledWritingSkills: ['loaded-style', 'never-loaded'] })
  assert.deepEqual(revoked.at(-1).source.disabledWritingSkills, ['loaded-style'])
  session.append('user/message', revoked.at(-1), { surfaceOp: 'append' })
  assert.deepEqual(appendWritingSkillState([ordinary], 'story', { session, disabledWritingSkills: ['loaded-style', 'never-loaded'] }), [ordinary])
  // Re-enabling lifts the declared revocation.
  assert.deepEqual(appendWritingSkillState([ordinary], 'story', { session, disabledWritingSkills: ['never-loaded'] }).at(-1).source.disabledWritingSkills, [])
})
