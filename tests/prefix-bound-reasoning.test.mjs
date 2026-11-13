import test from 'node:test'
import assert from 'node:assert/strict'
import { installPrefixBoundReasoningProjection, projectRebasedReasoning, rebasedMessageIds } from '../tavern-plugin/lib/domain/prefix-bound-reasoning.js'

const text = text => ({ type: 'text', text })
const user = (id, body) => ({ id, role: 'user', content: [text(body)], source: { kind: 'human' } })
// A relay serving Claude over openai-responses: the reasoning item JSON carries Anthropic's signature.
const reply = (id, body, api = 'openai-responses') => ({ id, role: 'assistant', content: [{ type: 'reasoning', text: '想法' }, text(body)],
  source: { kind: 'model', provider: 'relay', model: 'claude', replayState: { response: { kind: 'pi-ai', version: 2, api, provider: 'relay', model: 'claude', stopReason: 'stop' },
    blocks: [{ type: 'reasoning', thinkingSignature: '{"type":"reasoning","encrypted_content":"bound-to-' + id + '-prefix"}' }, { type: 'text', textSignature: '{"id":"msg_' + id + '"}' }] } } })
const event = (seq, message) => message.role === 'assistant'
  ? { seq, type: 'assistant/message', data: { turn: 1, step: 1, message } }
  : { seq, type: 'user/message', data: message }

// Session log: two rounds, then automatic compaction keeps only the last reply behind its checkpoint.
function compactedSession() {
  const checkpoint = { id: 'checkpoint', role: 'user', content: [text('<compacted-summary>摘要</compacted-summary>')], source: { kind: 'compact-checkpoint', compactionId: 'c1' } }
  const log = [user('u1', '玩家1'), reply('a1', '正文1'), user('u2', '玩家2'), reply('a2', '正文2'), checkpoint, user('u3', '玩家3')].map((message, seq) => event(seq, message))
  // The checkpoint (seq 4) replaced seqs 0–2 in place; the kept reply a2 (seq 3) now follows it.
  const session = { surface: { nodes: [4, 3, 5] }, eventAt: seq => log[seq] }
  return { session, messages: session.surface.nodes.map(seq => log[seq].type === 'assistant/message' ? log[seq].data.message : log[seq].data), log }
}

test('a reply kept after a compaction checkpoint loses its signed reasoning; replies written after it keep theirs', () => {
  const { session, messages, log } = compactedSession()
  assert.deepEqual([...rebasedMessageIds(session)], ['a2'])
  const request = { sessionId: 's', messages }
  const projected = projectRebasedReasoning(request, session)
  assert.deepEqual(projected.messages[1].content, [text('正文2')], 'only story text is replayed')
  assert.equal(projected.messages[1].source.replayState, undefined, 'block-indexed replay metadata and paired item ids go with it')
  assert.equal(projected.messages[0], messages[0])
  assert.equal(projected.messages[2], messages[2])
  assert.deepEqual(projectRebasedReasoning(request, session), projected, 'every later request projects the same bytes')

  // The next round's reply was produced after the new prefix: its signature replays.
  log.push(event(6, reply('a3', '正文3')), event(7, user('u4', '玩家4')))
  session.surface.nodes.push(6, 7)
  const next = projectRebasedReasoning({ sessionId: 's', messages: session.surface.nodes.map(seq => log[seq].data.message || log[seq].data) }, session)
  assert.equal(next.messages[3], log[6].data.message)
  assert.equal(next.messages[1].source.replayState, undefined)

  // No surface replacement, nothing to change.
  const plain = { surface: { nodes: [0, 1, 2, 3] }, eventAt: seq => log[seq] }
  const untouched = { sessionId: 's', messages: [0, 1, 2, 3].map(seq => log[seq].data.message || log[seq].data) }
  assert.equal(projectRebasedReasoning(untouched, plain), untouched)
})

test('unsigned reasoning (DeepSeek reasoning_content) is bound to no prefix and stays', () => {
  const { session, log } = compactedSession()
  const deepseek = { ...log[3].data.message, source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4', replayState: { response: { kind: 'pi-ai', version: 2, api: 'openai-completions', provider: 'deepseek', model: 'deepseek-v4', stopReason: 'stop' }, blocks: [{ type: 'reasoning' }, { type: 'text' }] } } }
  const request = { sessionId: 's', messages: [log[4].data, deepseek, log[5].data] }
  assert.equal(projectRebasedReasoning(request, session), request)
})

test('the stream hook sends one projected request that the provider accepts, on every wire API', async () => {
  for (const api of ['openai-responses', 'anthropic-messages']) {
    const { session, log } = compactedSession()
    log[3].data.message = reply('a2', '正文2', api)
    const messages = session.surface.nodes.map(seq => log[seq].data.message || log[seq].data)
    // Scripted provider: the evidence error of 11-12, not a paid request.
    const provider = async function * (input) {
      if (input.messages[1].content.some(block => block.type === 'reasoning')) throw Object.assign(new Error('messages.1.content.0: Invalid signature in thinking block. The block is bound to a different conversation.'), { status: 400 })
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const hooks = [], sent = []
    const dispatch = (request, index = 0) => index < hooks.length ? hooks[index](request, () => dispatch(request, index + 1)) : (sent.push(request), provider(request))
    let owned = true
    const ctx = { on: (_, hook) => hooks.push(hook), llm: { stream: request => dispatch(request) } }
    installPrefixBoundReasoningProjection(ctx, { ownsSession: async () => owned, session: () => session })
    const drain = async stream => { const out = []; for await (const chunk of stream) out.push(chunk); return out }
    assert.equal((await drain(ctx.llm.stream({ sessionId: 's', messages }))).at(-1).reason.kind, 'stop')
    assert.equal(sent.length, 1, api + ': no retry')
    assert.deepEqual(sent[0].messages[1].content, [text('正文2')])
    // Another plugin's session is left as the host built it.
    owned = false
    await assert.rejects(drain(ctx.llm.stream({ sessionId: 'other', messages })), error => error.status === 400)
  }
})
