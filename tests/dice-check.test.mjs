import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { compileRules, initialState, rollCheck, settleCheck, seededDraw } from '../tavern-plugin/mods/dice/check-engine.js'
import { parseFormula, evaluate } from '../tavern-plugin/mods/dice/check-expr.js'
import { CHECK_RULES_KEY, createCheckTool, runCheckAction } from '../tavern-plugin/mods/dice/check-tool.js'
import { surfaceToolResults } from '../tavern-plugin/lib/domain/surface-tool-results.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'
const { defineTool } = await import(pathToFileURL(createRequire(new URL('../tavern-plugin/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-tools')).href)

// Two rule families, written only as card data: 2d6 + stat in three bands with a spendable hold, and a pool that
// counts sixes with a player re-roll budget. Neither is the example card's system.
const RULES = {
  format: 'dsh-check-rules', version: 1, name: 'fixture',
  sets: { stats: ['cool', 'hard', 'sharp'] },
  resources: {
    rating: { label: 'Rating', keys: 'stats', initial: { cool: 1, hard: 2, sharp: -1 } },
    harm: { label: 'Harm', initial: 0, min: 0, max: 6 },
    luck: { label: 'Luck', initial: 2, min: 0, max: 2 },
  },
  checks: {
    move: {
      label: 'Move', title: '{stat}',
      params: { stat: { label: 'Stat', set: 'stats' } },
      dice: { d: { count: 2, sides: 6 } },
      let: [['total', 'd[0] + d[1] + rating[stat]']],
      choices: [{ id: 'bump', label: 'Spend luck to bump one band', when: 'total < 10 and luck > 0', int: { min: '0', max: 'min(1, luck)', default: '0' } }],
      then: [['band', 'total >= 10 or bump == 1 and total >= 7 ? 3 : total >= 7 or bump == 1 ? 2 : 1']],
      outcomes: [{ id: 'strong', label: 'Strong hit', when: 'band == 3' }, { id: 'weak', label: 'Weak hit', when: 'band == 2' }, { id: 'miss', label: 'Miss' }],
      effects: [{ resource: 'luck', add: '-bump' }, { resource: 'harm', add: '1', when: "outcome == 'miss'" }],
      report: [{ id: 'total', label: 'Total', value: 'total' }]
    },
    pool: {
      label: 'Pool',
      params: { size: { label: 'Dice', int: { min: '1', max: '10' } } },
      dice: { d: { count: 'size', sides: 6, mark: [6], markColor: '#c8202f' } },
      let: [['hits', 'count(d, 6)']],
      outcomes: [{ id: 'hit', label: 'Hit', when: 'hits >= 1' }, { id: 'none', label: 'None' }],
      report: [{ id: 'hits', label: 'Hits', value: 'hits' }]
    }
  }
}
const rules = compileRules(RULES)
function seedFor(faces) {
  for (let seed = 1; ; seed++) { const draw = seededDraw(seed); if (faces.every(face => draw(6) === face)) return seed }
}

test('formulas: precedence, ternary, functions, indexing and readable errors', () => {
  const scope = { get: name => ({ a: 2, b: 3, list: [1, 3, 3], map: { x: 4 } })[name], attr: () => 7 }
  assert.equal(evaluate(parseFormula('a + b * 2'), scope), 8)
  assert.equal(evaluate(parseFormula('a > 1 and not (b == 2) ? count(list, 3) : 0'), scope), 2)
  assert.equal(evaluate(parseFormula("map['x'] + sum(map) - max(a, b)"), scope), 5)
  assert.equal(evaluate(parseFormula('opt.cost'), scope), 7)
  assert.throws(() => parseFormula('a +'), /ends early/)
  assert.throws(() => parseFormula('eval(a)'), /unknown function eval/)
})

test('rules load once with the author\'s path in every error', () => {
  assert.throws(() => compileRules({ ...RULES, format: 'x' }), /format/)
  assert.throws(() => compileRules({ ...RULES, checks: { pool: { ...RULES.checks.pool, dice: { d: { count: 'size', sides: 6, mark: 3 } } } } }), /checks\.pool\.dice\.d\.mark: must be a list of faces/)
  assert.throws(() => compileRules({ ...RULES, checks: { pool: { ...RULES.checks.pool, dice: { d: { count: 'size', sides: 6, markColor: '#c8202f' } } } } }), /markColor: must be a #rrggbb colour next to mark/)
  assert.throws(() => compileRules({ ...RULES, checks: { move: { ...RULES.checks.move, let: [['total', 'd[0] + nope']] } } }), /checks\.move\.let\.total: reads unknown name nope/)
  assert.throws(() => compileRules({ ...RULES, resources: { ...RULES.resources, rating: { ...RULES.resources.rating, keys: 'missing' } } }), /resources\.rating\.keys/)
  // Bookkeeping without dice is the card's variable rules, not a check.
  assert.throws(() => compileRules({ ...RULES, checks: { advance: { label: 'Advance', outcomes: [{ id: 'on', label: 'On' }], effects: [{ resource: 'harm', add: '1' }] } } }), /checks\.advance\.dice: a check rolls at least one die/)
})

test('2d6 + stat: three bands, a player choice that waits, and replay from the seed', () => {
  const state = initialState(rules)
  const record = rollCheck(rules, state, { check: 'move', params: { stat: 'hard' } }, seedFor([3, 3]))
  assert.equal(record.status, 'awaiting', 'total 8 with luck left waits for the player')
  assert.deepEqual(record.state, state, 'nothing changes while it waits')
  assert.deepEqual(record.choices[0].preview.map(row => row.outcome), ['Weak hit', 'Strong hit'])
  const settled = settleCheck(rules, state, record, { bump: 1 })
  assert.equal(settled.outcome.id, 'strong')
  assert.deepEqual(settled.changes, [{ resource: 'luck', label: 'Luck', from: 2, to: 1, add: -1 }])
  assert.equal(JSON.stringify(settleCheck(rules, state, record, { bump: 1 })), JSON.stringify(settled), 'same seed and choice, same bytes')
  const miss = rollCheck(rules, { resources: { ...state.resources, luck: 0 } }, { check: 'move', params: { stat: 'sharp' } }, seedFor([1, 2]))
  assert.equal(miss.status, 'settled')
  assert.equal(miss.outcome.id, 'miss')
  assert.equal(miss.state.resources.harm, 1)
  assert.throws(() => settleCheck(rules, state, record, { bump: 2 }), /from 0 to 1/)
})

// outcomes[].show: the stage performance an outcome asks for (mods/dice/client/show.js). The record carries it once the
// outcome is known - on an awaiting record already when the outcome is fixed before the player's choice.
test('an outcome\'s show: validated at load, carried by its records, already on an awaiting record when the dice decide it', () => {
  const outcomes = [{ id: 'doubles', label: 'Doubles', when: 'd[0] == d[1]', show: 'converge' }, ...RULES.checks.move.outcomes]
  const staged = compileRules({ ...RULES, checks: { move: { ...RULES.checks.move, outcomes } } })
  assert.throws(() => compileRules({ ...RULES, checks: { move: { ...RULES.checks.move, outcomes: [{ ...outcomes[0], show: 'fireworks' }, ...outcomes.slice(1)] } } }), /checks\.move\.outcomes\.doubles\.show: must be one of converge/)
  const state = initialState(staged), show = { effect: 'converge', label: 'Doubles' }
  const doubles = rollCheck(staged, state, { check: 'move', params: { stat: 'hard' } }, seedFor([3, 3]))
  assert.deepEqual([doubles.status, doubles.show, doubles.outcome], ['awaiting', show, undefined], 'fixed as the dice land: it performs while the choice waits')
  assert.deepEqual(settleCheck(staged, state, doubles, { bump: 1 }).show, show)
  // Not doubles: the next outcome reads the choice (band), so nothing is decided while it waits, and none performs.
  const open = rollCheck(staged, state, { check: 'move', params: { stat: 'hard' } }, seedFor([2, 4]))
  assert.deepEqual([open.status, open.show], ['awaiting', undefined])
  assert.deepEqual([settleCheck(staged, state, open, { bump: 1 }).outcome.id, settleCheck(staged, state, open, { bump: 1 }).show], ['strong', undefined])
  assert.equal(rollCheck(rules, state, { check: 'move', params: { stat: 'hard' } }, seedFor([3, 3])).show, undefined, 'no show declared, none carried')
})

test('a sized pool', () => {
  const state = initialState(rules)
  const record = rollCheck(rules, state, { check: 'pool', params: { size: 4 } }, seedFor([6, 2, 6, 1]))
  assert.equal(record.report.hits.value, 2)
  assert.deepEqual(record.faces, { d: { sides: 6, mark: [6], markColor: '#c8202f' } }, 'the record carries each pool\'s sides and marked faces for the client')
  assert.deepEqual(rollCheck(rules, state, { check: 'move', params: { stat: 'hard' } }, seedFor([3, 3])).faces, { d: { sides: 6 } })
  assert.throws(() => rollCheck(rules, state, { check: 'pool', params: { size: 11 } }, 1), /from 1 to 10/)
})

test('the tool folds the game\'s records: ids, the open check, settle and resources across rounds', () => {
  const records = []
  const act = (args, seed = 1) => { const value = runCheckAction(rules, records, args, seed); records.push(JSON.parse(JSON.stringify(value))); return value }
  assert.equal(act({ action: 'status' }).resources.find(row => row.resource === 'luck').value, 2)
  const first = act({ action: 'roll', check: 'move', params: { stat: 'hard' }, reason: 'Kick the door', stakes: 'In or noise' }, seedFor([3, 3]))
  assert.equal(first.id, '#1')
  assert.throws(() => runCheckAction(rules, records, { action: 'roll', check: 'pool', params: { size: 1 }, reason: 'x', stakes: 'y' }, 1), /#1 still waits/)
  act({ action: 'status' })
  assert.throws(() => runCheckAction(rules, records, { action: 'settle', id: '#9' }, 1), /awaiting check is #1/)
  const settled = act({ action: 'settle', id: '#1', choice: { bump: 1 } })
  assert.equal(settled.id, '#2')
  assert.equal(settled.of, '#1')
  assert.equal(settled.labels.luck, 'Luck')
  assert.equal(settled.secret, undefined, 'no secret resources, no secret list')
  const kept = compileRules({ ...RULES, resources: { ...RULES.resources, luck: { ...RULES.resources.luck, secret: true } } })
  const told = runCheckAction(kept, [], { action: 'status' }, 1)
  assert.deepEqual(told.secret, ['luck'], 'the record names the secret resources for the card')
  assert.ok(told.resources.some(row => row.resource === 'luck'), 'the model still reads a secret resource')
  assert.deepEqual(act({ action: 'status' }).state.resources, { ...initialState(rules).resources, luck: 1 })
  assert.throws(() => runCheckAction(rules, records, { action: 'adjust', changes: [{ resource: 'harm', add: 3 }], reason: 'Fell' }, 1), /action must be status, roll or settle/)
})

// A card keeping resources in its MVU variables: they are the truth between turns (whatever the settlement wrote),
// the running turn's own records chain within it, and a value of the wrong shape is refused by its path.
test('resources kept in the card\'s variables: read between turns, chained within one', () => {
  const kept = compileRules({ ...RULES, resources: { ...RULES.resources,
    rating: { ...RULES.resources.rating, mvu: '/sheet/rating' }, harm: { ...RULES.resources.harm, mvu: '/sheet/harm' } } })
  assert.throws(() => compileRules({ ...RULES, resources: { ...RULES.resources, harm: { ...RULES.resources.harm, mvu: 'sheet' } } }), /resources\.harm\.mvu/)
  const records = [], vars = { sheet: { rating: { cool: 2, hard: -1 }, harm: 4 } }
  const act = (args, turn, seed = 1) => { const value = runCheckAction(kept, records, args, seed, { variables: vars, turn }); records.push(JSON.parse(JSON.stringify(value))); return value }
  assert.deepEqual(act({ action: 'status' }, 2).state.resources.rating, { cool: 2, hard: -1, sharp: 0 }, 'a key the variables omit is 0')
  vars.sheet.rating.$meta = { limits: { '*': { min: -3, max: 3 } } }
  assert.deepEqual(runCheckAction(kept, [], { action: 'status' }, 1, { variables: vars, turn: 9 }).state.resources.rating, { cool: 2, hard: -1, sharp: 0 }, 'MVU metadata in the object is not an entry')
  delete vars.sheet.rating.$meta
  act({ action: 'roll', check: 'move', params: { stat: 'hard' }, reason: 'r', stakes: 's' }, 2, seedFor([1, 2]))
  const miss = act({ action: 'settle', id: '#1', choice: { bump: 0 } }, 2)
  assert.equal(miss.report.total.value, 2, 'the variables\' rating')
  assert.deepEqual(miss.changes.find(row => row.resource === 'harm'), { resource: 'harm', label: 'Harm', from: 4, to: 5, add: 1, path: '/sheet/harm' })
  assert.equal(miss.turn, 2)
  assert.equal(act({ action: 'status' }, 2).state.resources.harm, 5, 'within the turn the record leads')
  vars.sheet.harm = 1
  assert.equal(act({ action: 'status' }, 3).state.resources.harm, 1, 'the next turn reads what the variables settled')
  vars.sheet.harm = 'two'
  assert.throws(() => runCheckAction(kept, records, { action: 'status' }, 1, { variables: vars, turn: 4 }), /card variable \/sheet\/harm \(Harm\) must be a whole number/)
  vars.sheet = { rating: { charm: 1 } }
  assert.throws(() => runCheckAction(kept, records, { action: 'status' }, 1, { variables: vars, turn: 4 }), /has charm, which is not one of/)
})

// The card was updated mid-game and now declares a resource the game's earlier records never had. The earlier record
// is a GM adjustment from before checks lost their dice-less actions: it still folds.
test('a resource added to the rules after a game\'s records starts at its initial value', () => {
  const records = [{ id: '#1', status: 'adjusted', changes: [{ resource: 'harm', label: 'Harm', from: 0, to: 2 }], state: { resources: { ...initialState(rules).resources, harm: 2 } }, reason: 'Fell' }]
  const grown = compileRules({ ...RULES, resources: { ...RULES.resources, stage: { label: 'Stage', initial: 2, min: 0, max: 4 } },
    checks: { ...RULES.checks, advance: { label: 'Advance', dice: { d: { count: 1, sides: 6 } }, outcomes: [{ id: 'on', label: 'On' }], effects: [{ resource: 'stage', add: '1' }] } } })
  const next = runCheckAction(grown, records, { action: 'roll', check: 'advance', reason: 'r', stakes: 's' }, 1)
  assert.equal(next.id, '#2')
  assert.deepEqual(next.changes, [{ resource: 'stage', label: 'Stage', from: 2, to: 3, add: 1 }])
  assert.equal(next.state.resources.harm, 2, 'what the records had is kept')
})

test('core reader: a tool\'s results on the current surface and the running turn only', () => {
  const events = [
    { seq: 1, type: 'tool/call', data: { turn: 2, callId: 'a', name: 'tavern_check' } },
    { seq: 2, type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: 'a', content: [{ type: 'text', text: 'A' }] } } },
    { seq: 3, type: 'tool/call', data: { turn: 3, callId: 'b', name: 'tavern_check' } },
    { seq: 4, type: 'tool/result', data: { turn: 3, message: { role: 'tool', toolCallId: 'b', content: [{ type: 'text', text: 'B' }] } } },
    { seq: 5, type: 'tool/call', data: { turn: 4, callId: 'c', name: 'tavern_roll' } },
    { seq: 6, type: 'tool/result', data: { turn: 4, message: { role: 'tool', toolCallId: 'c', content: [{ type: 'text', text: 'C' }] } } },
    { seq: 7, type: 'tool/call', data: { turn: 5, callId: 'd', name: 'tavern_check' } },
    { seq: 8, type: 'tool/result', data: { turn: 5, message: { role: 'tool', toolCallId: 'd', isError: true, content: [{ type: 'text', text: 'D' }] } } },
    { seq: 9, type: 'tool/call', data: { turn: 5, callId: 'e', name: 'tavern_check' } },
    { seq: 10, type: 'tool/result', data: { turn: 5, message: { role: 'tool', toolCallId: 'e', content: [{ type: 'text', text: 'E' }] } } },
  ]
  // Round 3 was regenerated away (seq 4 off the surface); round 5 runs now and is not on the surface yet.
  const session = { snapshotEvents: () => events, surface: { nodes: [1, 2, 5, 6] } }
  assert.deepEqual(surfaceToolResults(session, 'tavern_check', 5), ['A', 'E'])
})

test('registered from the dice mod with a stable schema; refuses cards without rules', async () => {
  assert.deepEqual(modTools.map(tool => [tool.modId, tool.name]), [['dsh.dice', 'tavern_roll'], ['dsh.dice', 'tavern_check']])
  const exec = { agent: { session: { id: 'front' }, phase: { kind: 'running', turn: 3 } } }
  let card = { extensions: { [CHECK_RULES_KEY]: { rules: RULES } } }, texts = []
  const tool = createCheckTool({ activeTurnOf: e => e.agent.phase.turn, chatForSession: async () => ({ mode: 'story' }), isBackground: () => false,
    readCard: async () => card, results: async () => texts })
  const schema = JSON.stringify(defineTool(tool))
  const sheet = await tool.execute({ action: 'status' }, exec)
  assert.equal(sheet.rules, 'fixture')
  texts = [tool.output.render({}, sheet)[0].text]
  const rolled = await tool.execute({ action: 'roll', check: 'pool', params: { size: 3 }, reason: 'r', stakes: 's' }, exec)
  assert.equal(rolled.id, '#1')
  assert.ok(Number.isInteger(rolled.seed) && rolled.seed >= 0 && rolled.seed < 2 ** 32)
  card = {}
  await assert.rejects(tool.execute({ action: 'status' }, exec), /declares no check rules/)
  assert.equal(JSON.stringify(defineTool(tool)), schema)
  console.log('tavern_check schema bytes', Buffer.byteLength(schema))
})
