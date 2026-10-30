import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { DICE_TARGETS, diceTier, rollDice } from '../tavern-plugin/lib/domain/dice.js'
import { createDiceTool } from '../tavern-plugin/lib/tools/dice.js'
import { registerGameplayTools } from '../tavern-plugin/lib/tools/gameplay.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
// dsh-tools is the plugin's dependency (tavern-plugin/node_modules), not resolvable from tests/.
const { defineTool } = await import(pathToFileURL(createRequire(new URL('../tavern-plugin/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-tools')).href)

const args = { check: '潜行', attempt: 'Get the ledger', difficulty: 'normal', reason: 'Patrol nearby', stakes: 'Get evidence or expose the entrance' }
const exec = { agent: { session: { id: 'front' }, phase: { kind: 'running', turn: 1 } } }
const activeTurnOf = e => e?.agent?.phase?.kind === 'running' ? e.agent.phase.turn : 0

test('every face and difficulty obey mutually exclusive tiers, including boundaries', () => {
  for (const [difficulty, target] of Object.entries(DICE_TARGETS)) {
    const counts = { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 }
    for (let face = 1; face <= 100; face++) {
      const result = rollDice({ ...args, difficulty }, (min, max) => { assert.equal(min, 1); assert.equal(max, 101); return face })
      assert.equal(result.target, target)
      assert.equal(result.tier, face <= 5 ? 'critical' : face >= 96 ? 'fumble' : face <= target ? 'success' : face <= target + 10 ? 'costly' : 'failure')
      counts[result.tier]++
    }
    assert.deepEqual(Object.values(counts), [5, target - 5, 10, 85 - target, 5])
  }
  assert.equal(diceTier(5, 1), 'critical')
  assert.equal(diceTier(96, 90), 'fumble')
  assert.equal(diceTier(100, 100), 'fumble')
  assert.throws(() => rollDice({ ...args, difficulty: 'bogus' }, () => assert.fail('must not draw')))
})

test('the tool rejects an empty, overlong or 检定-suffixed check with a repairable error, before drawing', async () => {
  const tool = createDiceTool({ activeTurnOf, chatForSession: async () => ({ mode: 'story' }), isBackground: () => false })
  for (const check of [undefined, '', '  ', '魔力与意志力', 'Perception', '魔力检定', '检定']) {
    await assert.rejects(tool.execute({ ...args, check }, exec), error => /^check: .*2–4 characters.*e\.g\. 魔力/.test(error.message) && error.message.includes(JSON.stringify(check ?? null)), String(check))
    assert.throws(() => rollDice({ ...args, check }, () => assert.fail('must not draw')))
  }
  assert.equal((await tool.execute({ ...args, check: ' 观察 ' }, exec)).check, '观察', 'stored trimmed')
  assert.equal(rollDice({ ...args, check: '说服' }, () => 50).check, '说服')
})

test('100k crypto draws have broad uniform distribution sanity', () => {
  const counts = Array(100).fill(0)
  for (let i = 0; i < 100000; i++) counts[rollDice(args).roll - 1]++
  for (const count of counts) assert.ok(count > 750 && count < 1250, String(count))
})

test('registered tool returns full hidden record, gates execution and keeps schema stable', async () => {
  let mode = 'story'
  const deps = { activeTurnOf, chatForSession: async () => mode === null ? undefined : { mode }, isBackground: id => id === 'background' }
  const registered = []
  registerGameplayTools({ ...deps, tools: { register: tool => registered.push(tool) } })
  assert.ok(registered.some(tool => tool.name === 'tavern_roll'))
  const tool = createDiceTool(deps)
  const schema = JSON.stringify(defineTool(tool))
  assert.equal(tool.isConcurrencySafe(), false)
  for (mode of ['story', 'script']) {
    const value = await tool.execute({ ...args, hidden: true }, exec)
    assert.deepEqual(Object.keys(value), ['check', 'attempt', 'difficulty', 'target', 'roll', 'tier', 'hidden', 'reason', 'stakes'])
    assert.deepEqual(JSON.parse(tool.output.render(args, value)[0].text), value)
    assert.equal(value.hidden, true)
    assert.equal(JSON.stringify(defineTool(createDiceTool(deps))), schema)
  }
  for (mode of ['card', null]) await assert.rejects(tool.execute(args, exec))
  mode = 'story'
  await assert.rejects(tool.execute(args, { agent: { session: { id: 'background' }, phase: exec.agent.phase } }))
  await assert.rejects(tool.execute(args, { agent: { session: { id: 'front' }, phase: { kind: 'idle' } } }))
  await assert.rejects(tool.execute(args, { ...exec, signal: { aborted: true } }))
  // Offered where the card has the 骰子 mod on, or where this game's history already calls it.
  for (const [enabled, usedModTools] of [[true, undefined], [false, ['tavern_roll']], [false, undefined]]) {
    for (mode of ['story', 'script', 'card']) {
      const orchestrator = createTurnOrchestrator({ store: { chatForSession: async () => ({ mode, cardPath: 'cards/a.json', usedModTools }) },
        modEnabled: async modId => enabled && modId === 'dsh.dice', frameBuilder: { build() {} } })
      assert.equal((await orchestrator.visibleTools('front')).includes('tavern_roll'), mode !== 'card' && (enabled || Boolean(usedModTools)))
    }
  }
  mode = 'story'
  const marked = []
  await createDiceTool({ ...deps, markUsed: async chat => marked.push(chat) }).execute(args, exec)
  assert.equal(marked.length, 1, 'the first roll marks the game')
  await createDiceTool({ ...deps, chatForSession: async () => ({ mode: 'story', usedModTools: ['tavern_roll'] }), markUsed: async chat => marked.push(chat) }).execute(args, exec)
  assert.equal(marked.length, 1, 'a marked game is not written again')
  const diceRules = JSON.parse(await readFile(new URL('../tavern-plugin/mods/dice/mod.json', import.meta.url), 'utf8')).prompts.find(row => row.id === 'rules').markdown
  assert.ok(diceRules.includes('costly'))
  const { name, description, parameters } = defineTool(tool)
  console.log(JSON.stringify({ toolSchemaBytes: Buffer.byteLength(JSON.stringify([{ name, description, parameters }])), foregroundDiceBytes: Buffer.byteLength(diceRules), foregroundStoryAndDiceBytes: Buffer.byteLength(prompt('story') + '\n\n' + diceRules) }))
})


test('native roll results leave the current surface with each of three rolled-back turns', () => {
  const session = Session.create('dice-timeline')
  const results = []
  for (let turn = 1; turn <= 3; turn++) {
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'user/message', { id: 'input-' + turn, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Act' }] }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'tool/call', { turn, step: 1, callId: 'roll-' + turn, name: 'tavern_roll', arguments: JSON.stringify(args) })
    results.push(appendSessionEvent(session, 'tool/result', { turn, step: 1, message: { id: 'result-' + turn, role: 'tool', content: [{ type: 'tool-result', toolCallId: 'roll-' + turn, isError: false, content: [{ type: 'text', text: JSON.stringify(rollDice(args)) }] }] } }, { surfaceOp: 'append' }))
    appendSessionEvent(session, 'assistant/message', { turn, step: 2, message: { id: 'reply-' + turn, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'Outcome' }] } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  }
  for (let turn = 3; turn >= 1; turn--) {
    const range = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface.nodes })
    assert.equal(range.turn, turn)
    const resultSeq = value => typeof value === 'number' ? value : value.seq
    assert.ok(range.shadowedSeqs.includes(resultSeq(results[turn - 1])))
    replaceSessionSurface(session, 'assistant/message', { turn, step: 2, message: { id: 'rollback-' + turn, role: 'assistant', source: range.source, content: [] } }, { start: range.userSeq, end: range.endSeq, sourceEventSeqs: [...range.shadowedSeqs] })
    assert.equal(session.surface.nodes.includes(resultSeq(results[turn - 1])), false)
    for (let earlier = 0; earlier < turn - 1; earlier++) assert.ok(session.surface.nodes.includes(resultSeq(results[earlier])))
  }
  assert.equal(sessionEvents(session).filter(event => event.type === 'tool/result').length, 3, 'archive remains, not a second current dice history')
})
