// Production pure context/tool seams only. This suite does not boot DSH or capture llm/stream.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { projectAgentContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { ensureSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { createStageSharedContext, frozenStageBackground, assertFrozenStageRequest, readStageStateAtTarget } from '../tavern-plugin/lib/domain/stage-shared-context.js'

import { backgroundPrompt, backgroundSystemPrompt, backgroundTaskPrompt, usesSharedBackgroundContext, directorTaskTools, assertDirectorToolSurface } from '../tavern-plugin/lib/domain/background-task-prompt.js'

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
const sharedInput = tools => ({ task: 'stage-director', contextPolicy: 'shared-background', tools })

function ordered(text, parts) {
  let cursor = -1
  for (const part of parts) {
    const found = text.indexOf(part)
    assert.ok(found > cursor, 'Expected ordered section: ' + part)
    cursor = found
  }
}

test('director planner reuses all card sections with projected Guide, posture and separate instructions', async () => {
  const source = fixture(), before = structuredClone(source)
  const planned = await planner().plan(source)
  for (const sentinel of ['CARD_DESCRIPTION Player', 'CARD_PERSONALITY', 'CARD_SCENARIO', 'CARD_STYLE_EXAMPLE', 'CONSTANT_BOOK Soyo']) assert.ok(planned.stableText.includes(sentinel))
  for (const sentinel of ['GUIDE Soyo Player', 'POSTURE Soyo']) assert.ok(planned.dynamicText.includes(sentinel))
  assert.equal(planned.systemPromptText, 'CARD_SYSTEM Soyo')
  assert.equal(planned.postHistoryText, 'CARD_POST_HISTORY Player')
  assert.equal(planned.taskText, 'STAGE_PROTOCOL')
  // card system instructions stay in the stable prefix.
  assert.ok(planned.stableText.includes('CARD_SYSTEM') && !planned.stableText.includes('GUIDE'))
  assert.ok(!planned.text.includes('{{'))
  assert.deepEqual(planned.audit.included.map(section => section.kind), planned.sections.map(section => section.kind))
  assert.equal(planned.audit.totalChars, planned.text.length)
  assert.deepEqual(planned.audit.omitted, [])
  assert.deepEqual(source, before, 'projection must not mutate card or authoritative macro state')
})

test('director and candidate planners share identical context sections when given the same sources', async () => {
  const source = fixture(), context = planner()
  const director = await context.plan(source)
  const candidate = await context.plan({ ...source, purpose: 'candidate' })
  for (const field of ['stableText', 'dynamicText', 'systemPromptText', 'postHistoryText']) assert.equal(director[field], candidate[field], field)
  assert.deepEqual(director.sections.slice(1), candidate.sections.slice(1))
})

test('director planner keeps long sections and style examples even with a supplied script window', async () => {
  const source = fixture()
  source.card.description = 'START_DESCRIPTION ' + '完整上下文'.repeat(6000) + ' END_DESCRIPTION'
  source.scriptWindow = { cursor: 0, total: 1, ended: false, chunks: [{ id: 'script-1', text: 'SCRIPT {{char}}' }] }
  const planned = await planner().plan(source)
  assert.ok(planned.stableText.includes(source.card.description))
  assert.ok(planned.stableText.includes('CARD_STYLE_EXAMPLE'))
  assert.ok(planned.dynamicText.includes('SCRIPT Soyo'))
  assert.ok(planned.dynamicText.includes('unplayed content is not a story fact'))
  assert.equal(planned.candidateScriptWindow, undefined, 'director does not acquire candidate history-replacement metadata')
  assert.deepEqual(planned.audit.omitted, [])
})

test('director shares the disabled-posture and runtime projection rules', async () => {
  const source = fixture()
  source.chat.backgroundTasks.posture = false
  source.card.system_prompt = 'VISIBLE {{char}}\n<div>DISPLAY_ONLY</div>'
  const planned = await planner().plan(source)
  assert.ok(!planned.dynamicText.includes('POSTURE'))
  assert.ok(planned.systemPromptText.includes('VISIBLE Soyo'))
  assert.equal(planned.systemPromptText, projectAgentContent(source.card.system_prompt, { charName: source.card.name, macroState: source.chat.macroState }).agentText, 'use the existing runtime projection, not a director-specific sanitizer')
  assert.ok(source.card.system_prompt.includes('<div>'), 'raw card is preserved')
})

test('production system/task assemblers retain fixed/current worldbook/read/Guide/card instruction sentinels', async () => {
  const planned = await planner().plan(fixture())
  const events = []
  const session = { id: 'one-shot-director', events, append(type, data) { const event = { type, data, seq: events.length }; events.push(event); return event } }
  await ensureSessionStablePrefix(session, '【用户已确认的长期偏好】\nPREFERENCE\n\n' + planned.stableText)
  const fixed = sessionStablePrefixSections(session)
  const sections = withCurrentWorldbook(fixed, 'CURRENT_CONSTANT_BOOK')
  const input = { ...sharedInput([stageTool]), system: planned.taskText, turnContext: planned.dynamicText,
    systemPromptText: planned.systemPromptText, postHistoryText: planned.postHistoryText,
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'FULL_STORY '.repeat(2000) }] }] }
  const system = backgroundSystemPrompt({ input, sections, persona: 'BACKGROUND_PERSONA', systemAppend: 'SYSTEM_APPEND' })
  const task = backgroundTaskPrompt({ input, foregroundReads: 'FOREGROUND_READS', worldbook: { rendered: 'TURN_WORLDBOOK_SNAPSHOT' } })
  for (const sentinel of ['PREFERENCE', 'CARD_DESCRIPTION Player', 'CARD_PERSONALITY', 'CARD_SCENARIO', 'CARD_STYLE_EXAMPLE', 'CURRENT_CONSTANT_BOOK', 'BACKGROUND_PERSONA', 'SYSTEM_APPEND']) assert.ok(system.includes(sentinel), sentinel)
  assert.ok(!system.includes('CONSTANT_BOOK Soyo'), 'only current worldbook replaces the fixed opening worldbook')
  assert.ok(fixed.some(section => section.text.includes('CONSTANT_BOOK Soyo')), 'stored prefix is not rewritten')
  ordered(task, ['FOREGROUND_READS', 'TURN_WORLDBOOK_SNAPSHOT', 'CARD_SYSTEM Soyo', 'GUIDE Soyo Player', 'POSTURE Soyo', 'Task type: stage direction', 'FULL_STORY', 'STAGE_PROTOCOL', 'CARD_POST_HISTORY Player'])
  assert.ok(task.includes(input.messages[0].content[0].text))
})

test('legacy director remains opt-in: exact system and no shared policy by default', () => {
  const input = { task: 'stage-director', system: 'EXACT_LEGACY_SYSTEM', tools: [legacyTool] }
  assert.equal(usesSharedBackgroundContext(input), false)
  assert.equal(backgroundSystemPrompt({ input, sections: [{ text: 'FORBIDDEN_FIXED' }], persona: 'FORBIDDEN_PERSONA', systemAppend: 'FORBIDDEN_APPEND' }), input.system)
  assert.deepEqual(directorTaskTools(input, readTools), [legacyTool])
  assert.doesNotThrow(() => assertDirectorToolSurface(input, [legacyTool], [legacyTool]))
  assert.throws(() => assertDirectorToolSurface(input, [legacyTool, readTools[0].tool], []), /only submit_direction/)
})

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

test('existing candidate and settlement tasks retain their ordering and roles', () => {
  const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'STORY' }] }]
  // candidate system updates use the persistent snapshot seam.
  const text = backgroundTaskPrompt({ input: { task: 'candidate', messages, turnContext: 'STATE', system: 'CANDIDATE_PROTOCOL', postHistoryText: 'POST_HISTORY' }, systemUpdate: { rendered: 'CARD_SYSTEM' } })
  ordered(text, ['CARD_SYSTEM', 'STATE', 'Task type: choice generation', '[Story]\nSTORY', 'CANDIDATE_PROTOCOL', 'POST_HISTORY'])
  const settlement = backgroundPrompt(messages, 'VARIABLES', 'settlement', 'MVU_PROTOCOL', { systemPromptText: 'EXCLUDED_SYSTEM', postHistoryText: 'EXCLUDED_POST' })
  assert.ok(settlement.includes('Task type: state settlement'))
  assert.ok(!settlement.includes('EXCLUDED_'), 'this change does not silently alter MVU instructions')
})

test('shared director resolves explicitly requested read tools through canonical existing descriptors', () => {
  const tools = directorTaskTools(sharedInput([stageTool, { name: 'worldbook_search', parameters: 'untrusted replacement' }, { name: 'tavern_recall_history' }]), readTools)
  assert.equal(tools[0], stageTool)
  assert.equal(tools[1], readTools[0].tool)
  assert.equal(tools[2], readTools[1].tool)
  assert.deepEqual(directorTaskTools(sharedInput([stageTool]), readTools), [stageTool], 'reads are not implicitly added')
})

test('director tool policy rejects MVU, posture, character writes, unavailable reads and duplicate tools', () => {
  for (const name of ['mvu_submit_update', 'posture_submit', 'character_design_save', 'web_search', 'unknown_tool']) {
    assert.throws(() => directorTaskTools(sharedInput([stageTool, { name }]), readTools), /cannot expose/)
  }
  assert.throws(() => directorTaskTools(sharedInput([stageTool, { name: 'worldbook_search' }]), []), /cannot expose/)
  assert.throws(() => directorTaskTools(sharedInput([stageTool, stageTool]), readTools), /unique/)
  assert.throws(() => directorTaskTools(sharedInput([readTools[0].tool]), readTools), /presentation submission/)
})

test('LLM-boundary tool guard requires the exact authorized native list', () => {
  const input = sharedInput([stageTool, readTools[0].tool]), expected = directorTaskTools(input, readTools)
  assert.doesNotThrow(() => assertDirectorToolSurface(input, [...expected].reverse(), expected))
  assert.throws(() => assertDirectorToolSurface(input, [], undefined), /not initialized/)
  for (const actual of [[], [stageTool], [stageTool, stageTool], [...expected, { name: 'mvu_submit_update' }], [...expected, { name: 'posture_submit' }]]) {
    assert.throws(() => assertDirectorToolSurface(input, actual, expected), /request must expose only/)
  }
})

test('host task is wired to the tested shared production assemblers and canonical read dispatch', async () => {
  // Structural wiring check only; it is not a native execution or llm/stream capture.
  const source = await readFile(new URL('../tavern-plugin/lib/background-agent-task.js', import.meta.url), 'utf8')
  assert.ok(source.includes('return backgroundSystemPrompt({ input: state.input, sections,'))
  assert.ok(source.includes(': backgroundTaskPrompt({ input, turnContext:'))
  // shared context is every task that does not own its prefix (ownsPrefix reads usesSharedBackgroundContext).
  assert.ok(source.includes('!usesSharedBackgroundContext(input)'))
  assert.ok(source.includes('const sharedContext = !ownsPrefix(input)'))
  assert.ok(source.includes('const projectsWorldbook = sharedContext'))
  assert.ok(source.includes('directorTaskTools(input, sharedBackgroundTools)'))
  assert.ok(source.includes('assertDirectorToolSurface(state.input, request.tools, state.directorTools)'))
  assert.ok(source.includes('shared.execute({ input, args, execution })'))
  assert.ok(!source.includes('function backgroundPrompt('), 'do not maintain a duplicate assembly engine')
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

// real cards can have single template entries that fail; the foreground skips them too.
test('per-entry worldbook template failures keep foreground parity; whole-worldbook failures stay fatal', async () => {
  const source = fixture()
  const chat = { ...source.chat, id: 'chat', sessionId: 'parent', _storageRevision: 4, timeline: { branchId: 'b', revision: 2 },
    cardDefinitionSnapshot: source.card, cardContextSnapshot: 'STABLE CARD', cardContextSnapshotVersion: 7,
    messages: [{ role: 'assistant', turn: 1, text: 'BODY' }] }
  const targetOf = (_chat, turn) => ({ key: 'key' + turn, turn })
  const build = book => createStageSharedContext({ planner: planner(), targetOf, readCard: async current => current.cardDefinitionSnapshot,
    ensureStablePrefix: async current => current.cardContextSnapshot, currentWorldbook: async () => book,
    foregroundReads: async () => '', stateAtTarget: async () => undefined, worldbookAtTarget: async () => undefined })
  const partial = await build({ context: 'BOOK', diagnostics: [{ kind: 'worldbook-template', code: 'runtime-error', ref: 'entry-7' }] })(chat, targetOf(chat, 1))
  assert.deepEqual(partial.audit.skippedWorldbookEntries, [{ ref: 'entry-7', code: 'runtime-error' }])
  for (const code of ['worldbook-read-failed', 'projection-failed']) {
    await assert.rejects(build({ context: '', diagnostics: [{ kind: 'worldbook-template', code }] })(chat, targetOf(chat, 1)), error => error.code === 'STAGE_CONTEXT_UNAVAILABLE')
  }
})

test('historical snapshot selection uses the next existing checkpoint and source identity', async () => {
  const historical = { id: 'c', settleStatus: 'done', messages: [{ role: 'assistant', turn: 1 }] }
  const current = { id: 'c', timeline: { checkpoints: [{ turn: 2, beforeRevision: 7 }] } }
  const reads = []
  const result = await readStageStateAtTarget(current, { turn: 1, key: 'same' }, { readRevision: async (id, revision) => { reads.push([id, revision]); return historical }, targetOf: () => ({ key: 'same' }) })
  assert.equal(result, historical); assert.deepEqual(reads, [['c', 7]])
})
