import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import { projectWorldBookTemplates } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { foregroundFrameInputs } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { clearRegenerationAttemptSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { worldbookSnapshot } from '../tavern-plugin/lib/domain/worldbook-snapshot.js'

const entry = (ref, title, content, extra = {}) => ({ ref, title, content, enabled: true, constant: false, ...extra })
const message = snapshot => ({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: snapshot.rendered }],
  source: { kind: 'plugin', plugin: 'dsh-tavern', worldbookSnapshot: snapshot } })

test('rendered entry reuse follows the visible effective version, keeps prefix bytes and cross-entry EJS wrappers', async () => {
  const runtime = await UpstreamTemplateRuntime.create()
  const planner = createContextPlanner({ prompt: () => '' })
  const adapter = createForegroundFrameSessionAdapter()
  const session = Session.create('reuse-session-13')
  const season = entry('entry:101', 'Season loader', '<%= getvar("season") %>', { constant: true, order: 100 })
  const equipment = entry('entry:102', 'Equipment', 'A silver staff', { order: 90 })
  const person = entry('entry:103', 'Captain', 'The captain waits', { order: 80 })
  let turn = 0
  async function prepare(entries, value = 'Autumn season archive') {
    const chat = { variables: { season: value }, messages: [] }, card = { name: 'Story card' }
    const projected = await projectWorldBookTemplates({ worldBook: { view: { entries } }, selectedEntries: entries, includeConstants: true, runtime, chat, card })
    const plan = await planner.plan({ purpose: 'body', card, chat, worldBookContext: projected.foregroundContext, worldBookEntries: projected.renderedEntries })
    const frame = createForegroundFrameBuilder().build({ chatId: 'chat:71', branchId: 'branch:42', operationId: 'op:' + ++turn,
      basedOnRevision: turn, turn, inputs: foregroundFrameInputs(plan, 'continue', 'continue', null, chat) })
    return adapter.append({ session, frame, step: 1, messages: [] }).messages.filter(m => m.source?.worldbookSnapshot)
  }
  const commit = messages => messages.map(data => appendSessionEvent(session, 'user/message', data, { surfaceOp: 'append' }))
  const first = commit(await prepare([season, equipment]))[0]
  assert.deepEqual(first.data.source.worldbookSnapshot.entries.map(e => e.ref), [equipment.ref, season.ref])
  assert.equal(first.data.source.worldbookSnapshot.rendered, '<worldbook_context>\n' + first.data.source.worldbookSnapshot.text + '\n</worldbook_context>')
  const prefix = JSON.stringify(first.data)
  const second = await prepare([season, person])
  assert.equal(second.length, 1)
  assert.deepEqual(second[0].source.worldbookSnapshot.entries.map(e => e.ref), [person.ref])
  assert.doesNotMatch(second[0].content[0].text, /Autumn|silver staff/)
  commit(second)
  assert.deepEqual(await prepare([season, equipment, person]), [])
  assert.equal(JSON.stringify(session.eventAt(first.seq).data), prefix, 'prior request bytes are immutable')

  const eventStart = session.seq
  const winter = await prepare([season], 'Winter season archive')
  assert.match(winter[0].content[0].text, /Winter/)
  commit(winter)
  const reverted = await prepare([season])
  assert.match(reverted[0].content[0].text, /Autumn/, 'an old visible version does not mask a newer effective version')
  assert.ok(clearRegenerationAttemptSurface({ session, eventStart }))
  assert.deepEqual(await prepare([season]), [])
  assert.equal((await prepare([season], 'Winter season archive')).length, 1)

  appendSessionEvent(session, 'user/message', { id: 'summary:92', role: 'user', content: [{ type: 'text', text: 'Story summary' }], source: { kind: 'plugin', plugin: 'compaction' } },
    { surfaceOp: { op: 'replace', start: first.seq, end: first.seq }, sourceEventSeqs: [first.seq] })
  const refreshed = await prepare([season, equipment, person])
  assert.deepEqual(refreshed[0].source.worldbookSnapshot.entries.map(e => e.ref), [equipment.ref, season.ref])
  commit(refreshed)
  assert.deepEqual(await prepare([season, equipment, person]), [])

  const opening = entry('entry:201', 'Group start', '<%= "<roster><team rank=\'A\'>" %>Known introduction', { constant: true, order: 100 })
  const member = entry('entry:202', 'Member', 'Member original', { order: 200 })
  const closing = entry('entry:203', 'Group end', 'Known conclusion</team></roster>', { constant: true, order: 300 })
  commit(await prepare([opening, member, closing]))
  const delta = await prepare([opening, { ...member, content: 'Member revised' }, closing])
  assert.equal(delta.length, 1)
  assert.deepEqual(delta[0].source.worldbookSnapshot.entries.map(e => e.ref), [member.ref])
  assert.match(delta[0].content[0].text, /<roster><team rank='A'>\n\nMember revised\n\n<\/team><\/roster>/)
  assert.doesNotMatch(delta[0].content[0].text, /Known introduction|Known conclusion|Member original/)
  const projected = delta[0].source.worldbookSnapshot.entries
  assert.equal(worldbookSnapshot(session, projected, delta), null, 'pending messages also count as visible')
  const missing = { ...delta[0], content: [{ type: 'text', text: 'Summary without the entry' }] }
  assert.ok(worldbookSnapshot(session, projected, [missing]), 'metadata without its text is not visibility')
  assert.deepEqual(worldbookSnapshot(null, projected).entries, projected)
  assert.equal(worldbookSnapshot(null, projected, [message(worldbookSnapshot(null, projected))]), null)

  // opaque sections unwrap only recognized envelopes, preserving payload bytes.
  for (const tag of ['worldbook_context', 'constant_worldbook']) {
    const text = '  Opaque payload\n<custom>kept</custom>  '
    const frame = { kind: 'foreground', frameId: 'opaque:' + tag, contributions: [{ slot: 'activeWorldbook', text: `<${tag}>\n${text}\n</${tag}>` }] }
    const opaque = adapter.append({ frame, step: 1, messages: [] }).messages[0].source.worldbookSnapshot
    assert.equal(opaque.text, text)
    assert.equal(opaque.rendered, `<worldbook_context>\n${text}\n</worldbook_context>`)
  }

  const group = [{ ref: 'entry:301', text: '<cast>' }, { ref: 'entry:302', text: 'First member' }, { ref: 'entry:303', text: '</cast>' }]
  const original = message(worldbookSnapshot(null, group))
  group[1] = { ...group[1], text: 'Changed member' }
  const groupedDelta = message(worldbookSnapshot(null, group, [original]))
  assert.equal(worldbookSnapshot(null, group, [groupedDelta]), null, 'retained scaffolding remains visible when its original package is compacted')
})
