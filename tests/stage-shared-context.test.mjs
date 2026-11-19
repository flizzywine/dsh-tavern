// Production pure context/tool seams only. This suite does not boot DSH or capture llm/stream.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createStageSharedContext, frozenStageBackground, assertFrozenStageRequest } from '../tavern-plugin/lib/domain/stage-shared-context.js'

import { directorTaskTools, assertDirectorToolSurface } from '../tavern-plugin/lib/domain/background-task-prompt.js'

const planner = () => createContextPlanner({ prompt: name => 'BASE:' + name })
const fixture = () => ({
  purpose: 'stage-director', task: 'STAGE_PROTOCOL', constantWorldBookContext: 'CONSTANT_BOOK {{char}}',
  card: { name: 'Soyo', description: 'CARD_DESCRIPTION {{user}}', personality: 'CARD_PERSONALITY',
    scenario: 'CARD_SCENARIO', mes_example: 'CARD_STYLE_EXAMPLE', system_prompt: 'CARD_SYSTEM {{char}}',
    post_history_instructions: 'CARD_POST_HISTORY {{user}}' },
  chat: { guides: [{ text: 'GUIDE {{char}} {{user}}' }], posture: 'POSTURE {{char}}',
    macroState: { userName: 'Player', local: {}, global: {} }, backgroundTasks: { posture: true } }
})
const stageTool = { name: 'stage_update', parameters: { type: 'object', properties: { sequence: { type: 'integer' } } } }
const legacyTool = { name: 'submit_direction', parameters: { type: 'object' } }
const readTools = [
  { tool: { name: 'worldbook_search', description: 'Canonical search', parameters: { type: 'object' } }, execute() {} },
  { tool: { name: 'tavern_recall_history', description: 'Canonical recall', parameters: { type: 'object' } }, execute() {} }
]
// pack directors are isolated too, but submit their incremental native tool.
for (const tool of [stageTool,legacyTool]) test('isolated director boundary accepts only its requested '+tool.name, () => {
  const input = {task:'stage-director',tools:[tool]}
  const expected = directorTaskTools(input,readTools)
  assert.deepEqual(expected,[tool])
  assert.doesNotThrow(()=>assertDirectorToolSurface(input,[tool],expected))
  const other = tool === stageTool ? legacyTool : stageTool
  assert.throws(()=>assertDirectorToolSurface(input,[other],expected),/must expose only/)
  assert.throws(()=>assertDirectorToolSurface(input,[tool,{name:'skill'}],expected),/must expose only/)
  for (const tools of [[],[stageTool,legacyTool],[{name:'mvu_submit_update'}],[tool,readTools[0].tool]]) {
    assert.throws(()=>directorTaskTools({...input,tools}),/exactly one presentation/)
  }
})

test('actual shared-context builder freezes projected sections and never reads current sources for history', async () => {
  const source = fixture(), calls = []
  const chat = { ...source.chat, id: 'chat', sessionId: 'parent', _storageRevision: 4, timeline: { branchId: 'b', revision: 2 },
    cardDefinitionSnapshot: source.card, cardContextSnapshot: 'STABLE CARD', cardContextSnapshotVersion: 7,
    messages: [{ role: 'assistant', turn: 1, text: 'OLD BODY {{char}}' }, { role: 'user', turn: 2, text: 'PLAYER INPUT {{char}}' }, { role: 'assistant', turn: 2, text: 'CURRENT BODY' }] }
  const targetOf = (_chat, turn) => ({ key: 'key' + turn, turn })
  const prepare = createStageSharedContext({ planner: planner(), targetOf, readCard: async current => current.cardDefinitionSnapshot,
    ensureStablePrefix: async current => { calls.push('prefix'); return current.cardContextSnapshot },
    currentWorldbook: async () => { calls.push('worldbook'); return { context: 'BOOK', prefixContext: 'PREFIX BOOK', foregroundContext: 'ACTIVE BOOK' } },
    foregroundReads: async () => 'FOREGROUND READS', stateAtTarget: async () => undefined, worldbookAtTarget: async () => { assert.fail('missing historical state must stop first') } })
  const frozen = await prepare(chat, targetOf(chat, 2))
  chat.guides[0].text = 'FUTURE GUIDE'; chat.cardDefinitionSnapshot.description = 'FUTURE CARD'
  assert.match(frozen.dynamicText, /GUIDE Soyo Player/)
  assert.match(frozen.systemPromptText, /CARD_SYSTEM Soyo/)
  // posture-settlement window — only the player's input; never the story backlog.
  assert.equal(frozen.backlogMessages.length, 1)
  assert.equal(frozen.backlogMessages[0].role, 'user')
  assert.match(frozen.backlogMessages[0].content[0].text, /PLAYER INPUT Soyo/)
  assert.ok(!JSON.stringify(frozen.backlogMessages).includes('OLD BODY'))
  assert.equal(frozen.audit.backlogMessages, 1)
  assert.ok(Object.isFrozen(frozen.frozenBackground.worldbook))
  assert.equal(frozenStageBackground({ task: 'stage-director', contextPolicy: 'shared-background', sessionId: 'parent', frozenBackground: frozen.frozenBackground }).foregroundWorldbookReads, 'FOREGROUND READS')
  const before = calls.length
  await assert.rejects(prepare(chat, targetOf(chat, 1)), error => error.code === 'STAGE_HISTORICAL_CONTEXT_UNAVAILABLE')
  assert.equal(calls.length, before)
  assert.throws(() => frozenStageBackground({ task: 'stage-director', contextPolicy: 'shared-background', sessionId: 'wrong', frozenBackground: frozen.frozenBackground }), /未完整冻结/)
  assert.throws(() => assertFrozenStageRequest({ task: 'stage-director', contextPolicy: 'shared-background', parentSessionId: 'parent', frozenBackground: frozen.frozenBackground }, { messages: [{ content: [{ type: 'text', text: '<% liveTemplate() %>' }] }] }), error => error.code === 'STAGE_FROZEN_TEMPLATE_UNAVAILABLE')
})
