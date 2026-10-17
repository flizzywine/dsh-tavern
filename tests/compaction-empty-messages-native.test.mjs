import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { ensureSessionStablePrefix, readSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { sessionEvents, appendSessionEvent, releaseOpeningTurn } from '../tavern-plugin/lib/domain/session-events.js'

import { installCompactionRequestProjection } from '../tavern-plugin/lib/domain/compaction-request.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
for (const side of ['foreground', 'background']) {
  test(`real DSH: ${side} compaction excludes internal empty messages without changing stored context`, native, async t => {
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 32768 })
    t.after(() => h.dispose())
    const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
    let agent = h.target.agent
    if (side === 'background') {
      const handle = await h.ctx.agents.create({ sessionId: 'empty-background', agentOptions: { provider: 'initialization-fixture', model: 'text' } })
      t.after(() => handle.dispose())
      agent = handle.agent
    }
    await ensureSessionStablePrefix(agent.session, '不可丢失的固定背景')
    appendSessionEvent(agent.session, 'user/message', { id: 'frame', role: 'user', content: [], source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame' } }, { surfaceOp: 'append' })
    await ensureSessionStablePrefix(agent.session, '不可丢失的固定背景：更新后的世界书', undefined, 1)
    appendSessionEvent(agent.session, 'user/message', { id: 'cleanup', role: 'user', content: [], source: { kind: 'plugin:dsh-tavern-failed-turn-cleanup' } }, { surfaceOp: 'append' })
    // The prefix writer reserved an opening turn that no greeting fills, and this
    // test drives the Agent directly: close it the way Tavern's own turn starters do.
    releaseOpeningTurn(agent.session, agent)
    agent.followup({ id: 'story', role: 'user', content: [{ type: 'text', text: '花店旧事。'.repeat(500) }], source: { kind: 'user' } })
    await agent.whenIdle()
    const before = structuredClone(sessionEvents(agent.session))
    const prefix = readSessionStablePrefix(agent.session).text
    installCompactionRequestProjection(h.ctx, async id => id === agent.session.id)
    const requests = []
    h.ctx.on('llm/stream', (request, next) => {
      if (request.purpose === 'compaction') {
        requests.push(request)
        if (request.messages.some(m => m.role === 'user' && m.content.length === 0)) throw Error('400: user message must have content')
      }
      return next()
    })
    const result = await new BasicCompactionEngine(h.ctx, { auto: false, maxTokens: 4096 }).compactNow(agent, new AbortController().signal).catch(error => { throw error.cause || error })
    assert.ok(requests.length, 'must reach the real summary request')
    assert.ok(result, 'compaction must produce a summary instead of failing on an empty user message')
    assert.ok(sessionEvents(agent.session).some(e => e.type === 'compaction/summary'))
    assert.equal(readSessionStablePrefix(agent.session).text, prefix)
    assert.deepEqual(sessionEvents(agent.session).slice(0, before.length), before, 'original events stay immutable')
    assert.match(requests[0].messages.filter(m => m.role === 'system').flatMap(m => m.content).map(b => b.text || '').join('\n'), /不可丢失的固定背景/)
  })
}
