import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { compileRules, seededDraw } from '../tavern-plugin/mods/dice/check-engine.js'
import { parseFormula, evaluate } from '../tavern-plugin/mods/dice/check-expr.js'
import { CHECK_RULES_KEY, REGENERATING, createCheckTool, runCheckAction } from '../tavern-plugin/mods/dice/check-tool.js'
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

// A card keeping resources in its MVU variables: they are the truth up to the turn they settled (whatever the settlement
// wrote), records of later turns chain on top of them, and a value of the wrong shape is refused by its path.
test('resources kept in the card\'s variables: read between turns, chained within one', () => {
  const kept = compileRules({ ...RULES, resources: { ...RULES.resources,
    rating: { ...RULES.resources.rating, mvu: '/sheet/rating' }, harm: { ...RULES.resources.harm, mvu: '/sheet/harm' } } })
  assert.throws(() => compileRules({ ...RULES, resources: { ...RULES.resources, harm: { ...RULES.resources.harm, mvu: 'sheet' } } }), /resources\.harm\.mvu/)
  const records = [], vars = { sheet: { rating: { cool: 2, hard: -1 }, harm: 4 } }
  let settled = 1
  const act = (args, turn, seed = 1) => { const value = runCheckAction(kept, records, args, seed, { variables: { snapshot: vars, turn: settled }, turn }); records.push(JSON.parse(JSON.stringify(value))); return value }
  assert.deepEqual(act({ action: 'status' }, 2).state.resources.rating, { cool: 2, hard: -1, sharp: 0 }, 'a key the variables omit is 0')
  vars.sheet.rating.$meta = { limits: { '*': { min: -3, max: 3 } } }
  assert.deepEqual(runCheckAction(kept, [], { action: 'status' }, 1, { variables: { snapshot: vars, turn: 8 }, turn: 9 }).state.resources.rating, { cool: 2, hard: -1, sharp: 0 }, 'MVU metadata in the object is not an entry')
  delete vars.sheet.rating.$meta
  act({ action: 'roll', check: 'move', params: { stat: 'hard' }, reason: 'r', stakes: 's' }, 2, seedFor([1, 2]))
  const miss = act({ action: 'settle', id: '#1', choice: { bump: 0 } }, 2)
  assert.equal(miss.report.total.value, 2, 'the variables\' rating')
  assert.deepEqual(miss.changes.find(row => row.resource === 'harm'), { resource: 'harm', label: 'Harm', from: 4, to: 5, add: 1, path: '/sheet/harm' })
  assert.equal(miss.turn, 2)
  assert.equal(act({ action: 'status' }, 2).state.resources.harm, 5, 'within the turn the record leads')
  assert.equal(act({ action: 'status' }, 3).state.resources.harm, 5, 'turn 2 has not settled yet: its record still leads')
  vars.sheet.harm = 1
  settled = 3
  assert.equal(act({ action: 'status' }, 4).state.resources.harm, 1, 'once settled, the variables are read')
  vars.sheet.harm = 'two'
  assert.throws(() => runCheckAction(kept, records, { action: 'status' }, 1, { variables: { snapshot: vars, turn: 4 }, turn: 5 }), /card variable \/sheet\/harm \(Harm\) must be a whole number/)
  vars.sheet = { rating: { charm: 1 } }
  assert.throws(() => runCheckAction(kept, records, { action: 'status' }, 1, { variables: { snapshot: vars, turn: 4 }, turn: 5 }), /has charm, which is not one of/)
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
  // The current call form reaches the same v1 checks.
  texts = []
  assert.equal((await tool.execute({ op: 'act', action: 'pool', params: { size: 3 }, reason: 'r' }, exec)).id, '#1')
  // A regenerated reply keeps the rulings of the version it replaces: status still reads, a new act or choice is refused.
  const rewriting = createCheckTool({ activeTurnOf: e => e.agent.phase.turn, chatForSession: async () => ({ mode: 'story', regenInProgress: true }), isBackground: () => false,
    readCard: async () => card, results: async () => [] })
  assert.equal((await rewriting.execute({ op: 'status' }, exec)).rules, 'fixture')
  for (const args of [{ op: 'act', action: 'pool', params: { size: 3 }, reason: 'r' }, { op: 'choose', choice: {} }, { action: 'roll', check: 'pool', params: { size: 3 } }])
    await assert.rejects(rewriting.execute(args, exec), error => error.message === REGENERATING)
  card = {}
  await assert.rejects(tool.execute({ action: 'status' }, exec), /declares no rules/)
  assert.equal(JSON.stringify(defineTool(tool)), schema)
  console.log('tavern_check schema bytes', Buffer.byteLength(schema))
})
