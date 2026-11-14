import assert from 'node:assert/strict'
import test from 'node:test'

import { compileRulesV2, readRulesState } from '../tavern-plugin/mods/dice/rules-engine.js'
import { checkRulesCard, checkSettlement, runRulesCall, RULINGS_PER_REPLY } from '../tavern-plugin/mods/dice/check-tool.js'
import { seededDraw } from '../tavern-plugin/mods/dice/check-engine.js'
import { withModHidden } from '../tavern-plugin/lib/mod-tools.js'
import { evaluate, parseFormula } from '../tavern-plugin/mods/dice/check-expr.js'

// A small invented detective game: phases, money and a price table, clue entries that are not fixed, a roll with a
// choice, a secret counter and a derived ending.
const RULES = {
  format: 'dsh-rules', version: 2, name: 'fixture',
  sets: { stats: ['力量', '机敏'] },
  tables: { tools: { 撬棍: { cost: 2 }, 望远镜: { cost: 5 } } },
  state: {
    phase: { path: '/阶段', label: '阶段', values: [0, 1, 2] },
    hp: { path: '/角色/体力', label: '体力', min: 0, max: 'hpMax' },
    hpMax: { path: '/角色/体力上限', label: '体力上限' },
    money: { path: '/角色/钱', label: '钱', min: 0 },
    attrs: { path: '/角色/属性', label: '属性', keys: 'stats', min: 0, max: 5 },
    clues: { path: '/线索', label: '线索', keys: '*', min: 0, max: 9 },
    heat: { path: '/幕后/热度', label: '热度', min: 0, secret: true },
    verdict: { path: '/案件/结局', label: '结局', values: ['', '破案', '失败'] }
  },
  read: { started: '/开场/完成' },
  derived: { ending: { path: '/终局', label: '终局', value: "phase == 2 ? verdict : ''" } },
  actions: {
    start: { label: '开始调查', when: 'started == true and phase == 0', effects: [{ var: 'phase', set: '1' }], text: '调查开始。', stop: '写到侦探到达现场为止。' },
    buy: { label: '买工具', by: 'player', params: { item: { label: '工具', table: 'tools' } },
      require: [{ when: 'money >= item.cost', message: '钱只有 {money}，「{item}」要 {item.cost}：在戏里婉拒。' }],
      effects: [{ var: 'money', add: '-item.cost' }], text: '买下「{item}」，还剩 {money - item.cost}。' },
    note: { label: '记线索', when: 'phase == 1', params: { who: { label: '关于谁', text: { max: 10 } }, n: { label: '几条', int: { min: 1, max: 3, default: 1 } } },
      effects: [{ var: 'clues', key: 'who', add: 'n' }], text: '关于{who}的线索 +{n}。' },
    forget: { label: '划掉线索', params: { who: { label: '关于谁', keyOf: 'clues' } }, effects: [{ var: 'clues', key: 'who', remove: true }] },
    search: { label: '搜查', title: '{stat}', by: 'player', when: 'phase == 1', params: { stat: { label: '属性', set: 'stats' } },
      dice: { d: { count: 2, sides: 6 } }, let: [['total', 'sum(d) + attrs[stat]']],
      choices: [{ id: 'push', label: '咬牙多花几点体力', when: 'total < 9', int: { min: 0, max: 'min(hp - 1, 2)', default: 0 } }],
      then: [['final', 'total + push * 2']],
      outcomes: [{ id: 'hit', label: '找到了', when: 'final >= 9', text: '找到了（{final}）。' }, { id: 'miss', label: '没找到', text: '没找到（{final}）。' }],
      effects: [{ var: 'hp', add: '-push', strict: true }, { var: 'heat', add: '1', when: "outcome == 'miss'" }],
      report: [{ id: 'total', label: '点数', value: 'total' }] },
    hurt: { label: '受伤', params: { points: { label: '点数', int: { min: 1, max: 3 } } },
      choices: [{ id: 'absorb', label: '用哪些属性抵消', hint: '选满 {points} 项才算抵消', pick: { set: 'stats', min: 0, max: 'points' } }],
      then: [['blocked', 'len(absorb) == points']],
      ensure: [{ when: 'len(absorb) == 0 or blocked', message: '要么选满 {points} 项，要么一项都不选。' }],
      effects: [{ var: 'attrs', each: 'absorb', add: '-1', strict: true, when: 'blocked' }, { var: 'hp', add: '-points', when: 'not blocked' }] },
    close: { label: '结案', when: 'phase == 1', params: { result: { label: '结局', options: { 破案: '破案', 失败: '失败' } } },
      effects: [{ var: 'phase', set: '2' }, { var: 'verdict', set: 'result' }], text: '结案：{result}。', stop: '写到侦探离开警局为止。' }
  }
}

const opening = () => ({ 开场: { 完成: true }, 阶段: 0, 角色: { 体力: 5, 体力上限: 5, 钱: 6, 属性: { 力量: 2, 机敏: 1 } }, 线索: { $meta: { extensible: true } }, 幕后: { 热度: 0 }, 案件: { 结局: '' }, 终局: '' })

// The host around the engine: the state reads the settled variables plus this branch's later records; a reply's settlement
// writes the operations the tool declares (tools.js settlement) and the variables then belong to that turn.
// Die by die through a table: as many dice as the loose ends allow, each face reads its table row, and a face that comes up
// again reads that row's next tier (range, slice and count); the sum goes into one effect.
test('a roll reads a table row per die, by how many times the face came up, and sums the rows', () => {
  const tier = "count(slice(w, 0, key + 1), w[key])"
  const rules = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'weather',
    state: { loose: { path: '/目击者', label: '目击者', min: 0 } },
    tables: { events: { 1: { a: -1, b: -2, c: -3, clear: 1 }, 2: { a: 3, b: 2, c: 1, clear: 0 }, 3: { a: 0, b: 0, c: 0, clear: 0 } } },
    actions: { weather: { label: '天气事件', dice: { w: { count: 'min(floor(loose / 11), 5)', sides: 3 }, e: { count: 'min(floor(loose / 11), 5)', sides: 6 } },
      let: [{ name: 'delta', each: 'range(len(w))',
        sum: `(${tier} == 1 ? events[w[key]]['a'] : ${tier} == 2 ? events[w[key]]['b'] : events[w[key]]['c']) - events[w[key]]['clear'] * e[key]` }],
      effects: [{ var: 'loose', add: 'delta' }], text: '{len(w)} 个天气事件，目击者变化 {delta}。' } } })
  const table = { 1: [-1, -2, -3, 1], 2: [3, 2, 1, 0], 3: [0, 0, 0, 0] }
  for (const [loose, count] of [[40, 3], [70, 5], [5, 0]]) {
    const play = game(rules)
    play.variables.目击者 = loose
    const record = play.call(2, { op: 'act', action: 'weather', reason: 'r' }, 7)
    const { w = [], e = [] } = record.dice || {}
    assert.equal(w.length, count)
    const delta = w.reduce((total, face, index) => { const row = table[face], seen = w.slice(0, index + 1).filter(value => value === face).length
      return total + row[Math.min(seen, 3) - 1] - row[3] * e[index] }, 0)
    assert.equal(record.text, count + ' 个天气事件，目击者变化 ' + delta + '。')
    assert.deepEqual(play.settle(2).map(row => row.value), delta ? [Math.max(0, loose + delta)] : [])
  }
})

function game(rules) {
  const records = [], variables = opening()
  let settled = 1
  const write = (path, op, value) => {
    const keys = path.split('/').slice(2), parent = keys.slice(0, -1).reduce((node, key) => node[key] ??= {}, variables)
    if (op === 'remove') delete parent[keys.at(-1)]
    else parent[keys.at(-1)] = value
  }
  return {
    variables, records,
    call(turn, args, seed = 1) {
      try {
        const record = runRulesCall(rules, records, args, seed, { variables: { snapshot: variables, turn: settled }, turn })
        records.push(JSON.parse(JSON.stringify(record)))
        return record
      } catch (error) { return { refused: error.message } }
    },
    settle(turn) {
      const declared = checkSettlement(records.filter(row => row.id && row.turn > settled && row.turn <= turn).map(row => JSON.stringify(row)))
      for (const operation of declared?.operations || []) write(operation.path, operation.op, operation.value)
      settled = turn
      return declared?.operations || []
    }
  }
}
function seedWhere(rules, accept) {
  for (let seed = 1; seed < 5000; seed++) {
    const draw = seededDraw(seed), faces = [draw(6), draw(6)]
    if (accept(faces)) return seed
  }
  throw new Error('no seed')
}

test('v2 rules load once with the author\'s path in every error', () => {
  const bad = (patch, pattern) => assert.throws(() => compileRulesV2({ ...RULES, ...patch }), pattern)
  bad({ actions: { x: { label: 'x', effects: [{ var: 'money', add: 'cash' }] } } }, /actions\.x\.effects: reads unknown name cash/)
  bad({ state: { ...RULES.state, other: { path: '/角色' } } }, /state\.other\.path: \/角色 overlaps \/角色\/体力/)
  bad({ state: { bad: { path: '/a/$meta/b' } } }, /state\.bad\.path: may not name MVU metadata/)
  bad({ derived: { a: { path: '/x', value: 'b' }, b: { path: '/y', value: 'a' } } }, /derived\.a: depends on itself through a → b → a/)
  bad({ actions: { x: { label: 'x', effects: [{ var: 'money', remove: true }] } } }, /actions\.x\.effects\.0\.remove: removes an entry/)
  bad({ actions: { x: { label: 'x', params: { money: { int: { min: 0, max: 1 } } } } } }, /actions\.x\.params\.money: money is already a name of these rules/)
  bad({ actions: { x: { label: 'x', effects: [{ var: 'ending', set: "'a'" }] } } }, /actions\.x\.effects\.0\.var: names no state variable/)
  assert.throws(() => parseFormula('('.repeat(60) + '1' + ')'.repeat(60)), /nests at most 40 levels/)
  assert.equal(evaluate(parseFormula("join(get(m, 'a', 0), '-', len(keys(m)))"), { get: () => ({ a: 2, b: 3 }) }), '2-2')
})

test('a full case: actions with and without dice, refusals, a choice across turns, entries, the derived ending', () => {
  const rules = compileRulesV2(RULES), play = game(rules)
  // Turn 2: the case starts, and the stop says where the reply ends.
  const started = play.call(2, { op: 'act', action: 'start', reason: '侦探出发' })
  assert.deepEqual([started.id, started.status, started.text, started.stop], ['2-1', 'settled', '调查开始。', '写到侦探到达现场为止。'])
  assert.deepEqual(started.changes, [{ path: '/阶段', label: '阶段', from: 0, to: 1 }])
  assert.match(play.call(2, { op: 'act', action: 'start', reason: '再出发' }).refused, /开始调查 \(start\) is not available now; available now: buy \(买工具\), note \(记线索\)/)
  // Within the turn each ruling reads the ones before it: 6 → 1, then the telescope is refused with the card's words.
  play.call(2, { op: 'act', action: 'buy', params: { item: '望远镜' }, reason: '买望远镜' })
  assert.equal(play.call(2, { op: 'act', action: 'buy', params: { item: '撬棍' }, reason: '再买撬棍' }).refused, '钱只有 1，「撬棍」要 2：在戏里婉拒。')
  const noted = play.call(2, { op: 'act', action: 'note', params: { who: '管家', n: 2 }, reason: '记下管家' })
  assert.deepEqual(noted.changes, [{ path: '/线索/管家', label: '线索·管家', to: 2 }])
  assert.match(play.call(2, { op: 'act', action: 'note', params: { who: 'a/b' }, reason: 'r' }).refused, /without \/ or ~/)
  const ops = play.settle(2)
  assert.deepEqual(ops, [{ op: 'replace', path: '/stat_data/阶段', value: 1 }, { op: 'replace', path: '/stat_data/角色/钱', value: 1 }, { op: 'insert', path: '/stat_data/线索/管家', value: 2 }])
  // Turn 3: a search that falls short waits for the player; the int choice previews what each value would do.
  const seed = seedWhere(rules, faces => faces[0] + faces[1] + 1 === 6)
  const waiting = play.call(3, { op: 'act', action: 'search', params: { stat: '机敏' }, reason: '翻抽屉' }, seed)
  assert.equal(waiting.status, 'awaiting')
  assert.deepEqual(waiting.report, { total: { label: '点数', value: 6 } }, 'what is decided before the choice is told')
  assert.deepEqual(waiting.choices[0].preview.map(row => [row.value, row.outcome, row.changes]), [
    [0, '没找到', [{ label: '热度', add: 1, secret: true }]], [1, '没找到', [{ label: '体力', add: -1 }, { label: '热度', add: 1, secret: true }]], [2, '找到了', [{ label: '体力', add: -2 }]]])
  assert.match(play.call(3, { op: 'act', action: 'note', params: { who: '园丁' }, reason: 'r' }).refused, /搜查 3-1 still waits for the player's choice/)
  assert.deepEqual(play.settle(3), [], 'an awaiting record changes nothing')
  // Turn 4: the player answers; the dice replay from the seed.
  const found = play.call(4, { op: 'choose', choice: { push: 2 } })
  assert.deepEqual([found.id, found.of, found.outcome.label, found.text, found.dice], ['4-1', '3-1', '找到了', '找到了（10）。', waiting.dice])
  assert.match(play.call(4, { op: 'choose', choice: {} }).refused, /nothing waits for a choice/)
  // A pick choice the ensure refuses goes back; the record keeps waiting.
  play.call(4, { op: 'act', action: 'hurt', params: { points: 2 }, reason: '被狗咬' })
  assert.equal(play.call(4, { op: 'choose', choice: { absorb: ['力量'] } }).refused, '要么选满 2 项，要么一项都不选。')
  const absorbed = play.call(4, { op: 'choose', choice: { absorb: ['力量', '机敏'] } })
  assert.deepEqual(absorbed.changes.map(row => row.label + ' ' + row.from + '→' + row.to), ['属性·力量 2→1', '属性·机敏 1→0'])
  assert.match(play.call(4, { op: 'act', action: 'hurt', params: { points: 1 }, reason: 'r' }, 1).status, /awaiting/)
  assert.match(play.call(4, { op: 'choose', choice: { absorb: ['机敏'] } }).refused, /属性·机敏 is 0 and must stay within 0\.\.5/, 'a strict effect refuses to leave its range')
  play.call(4, { op: 'choose', choice: {} })
  play.call(4, { op: 'act', action: 'forget', params: { who: '管家' }, reason: '排除管家' })
  play.call(4, { op: 'act', action: 'close', params: { result: '破案' }, reason: '抓到了园丁' })
  const written = play.settle(4)
  assert.deepEqual(written.map(row => row.op + ' ' + row.path.replace('/stat_data', '') + ('value' in row ? '=' + row.value : '')),
    ['replace /角色/体力=2', 'replace /角色/属性/力量=1', 'replace /角色/属性/机敏=0', 'remove /线索/管家', 'replace /阶段=2', 'replace /案件/结局=破案', 'replace /终局=破案'])
  assert.deepEqual(readRulesState(rules, play.variables).clues, {}, 'MVU metadata in the entries is not an entry')
  // Status lists only what is available now and the values; the reply's rulings are bounded.
  const sheet = play.call(5, { op: 'status' })
  assert.deepEqual(sheet.actions.map(row => row.action), ['buy', 'forget', 'hurt'])
  assert.equal(sheet.values.终局, '破案')
})

test('one reply makes a bounded number of rulings', () => {
  const play = game(compileRulesV2(RULES))
  play.call(2, { op: 'act', action: 'start', reason: 'r' })
  for (let n = 1; n < RULINGS_PER_REPLY; n++) assert.equal(play.call(2, { op: 'act', action: 'note', params: { who: '管家' }, reason: 'r' }).status, 'settled')
  assert.match(play.call(2, { op: 'act', action: 'note', params: { who: '管家' }, reason: 'r' }).refused, /this reply has made 16 rulings already/)
  assert.equal(play.call(3, { op: 'act', action: 'note', params: { who: '管家' }, reason: 'r' }).id, '3-1')
})

test('a reply whose settlement never saved: the next reply still counts its records, and writes them with its own', () => {
  const rules = compileRulesV2(RULES), play = game(rules)
  play.call(2, { op: 'act', action: 'start', reason: 'r' })
  // Turn 2 never settled: turn 3 reads phase 1 from its record, and turn 3's settlement writes both.
  assert.equal(play.call(3, { op: 'act', action: 'note', params: { who: '管家' }, reason: 'r' }).status, 'settled')
  assert.deepEqual(play.settle(3).map(row => row.path), ['/stat_data/阶段', '/stat_data/线索/管家'])
})

test('entries with fields and a sum over entries (a management game: staff, products, revenue)', () => {
  const rules = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'shop',
    tables: { tiers: { 新人: { skill: 3, pay: 10 }, 老手: { skill: 8, pay: 30 } } },
    state: {
      cash: { path: '/公司/现金', label: '现金' },
      staff: { path: '/员工', label: '员工', keys: '*', fields: { skill: { label: '能力', min: 0, max: 20 }, pay: { label: '季薪', min: 0 } } },
      goods: { path: '/产品', label: '产品', keys: '*', fields: { units: { label: '销量', min: 0 }, price: { label: '单价', min: 0 }, onSale: { label: '在售', initial: false } } }
    },
    actions: {
      hire: { label: '招人', params: { name: { label: '名字', text: { max: 8 } }, tier: { label: '档次', table: 'tiers' } },
        effects: [{ var: 'staff', key: 'name', field: 'skill', set: 'tier.skill' }, { var: 'staff', key: 'name', field: 'pay', set: 'tier.pay' }] },
      train: { label: '培训', params: { who: { label: '谁', keyOf: 'staff' } }, effects: [{ var: 'staff', key: 'who', field: 'skill', add: '15' }] },
      list: { label: '上架', params: { name: { label: '产品', text: { max: 8 } } },
        effects: [{ var: 'goods', key: 'name', field: 'units', set: '10' }, { var: 'goods', key: 'name', field: 'price', set: '3' }, { var: 'goods', key: 'name', field: 'onSale', set: 'true' }] },
      quarter: { label: '季度结算',
        let: [{ name: 'revenue', each: 'goods', sum: "goods[key]['units'] * goods[key]['price']", when: "goods[key]['onSale']" }, { name: 'wages', each: 'keys(staff)', sum: "staff[key]['pay']" }],
        effects: [{ var: 'cash', add: 'revenue - wages' }], text: '营收 {revenue}，工资 {wages}。' },
      fire: { label: '解雇', params: { who: { label: '谁', keyOf: 'staff' } }, effects: [{ var: 'staff', key: 'who', remove: true }] }
    } })
  assert.throws(() => compileRulesV2({ format: 'dsh-rules', version: 2, name: 'x', state: { s: { path: '/s', keys: '*', fields: { a: {} } } }, actions: { x: { label: 'x', effects: [{ var: 's', key: "'k'", set: '1' }] } } }), /actions\.x\.effects\.0\.field: s has fields: name one of a/)
  const state0 = readRulesState(rules, { 公司: { 现金: 100 }, 员工: { $meta: { extensible: true }, 老周: { 能力: 8, 季薪: 30 } } })
  assert.deepEqual(state0.staff, { 老周: { skill: 0, pay: 0 } }, 'fields are named by their ids; a field the entry lacks starts at its initial value')
  const play = game(rules)
  Object.assign(play.variables, { 公司: { 现金: 100 }, 员工: {}, 产品: {} })
  const hired = play.call(2, { op: 'act', action: 'hire', params: { name: '老周', tier: '老手' }, reason: 'r' })
  assert.deepEqual(hired.changes, [{ path: '/员工/老周', label: '员工·老周', to: { skill: 8, pay: 30 } }])
  play.call(2, { op: 'act', action: 'hire', params: { name: '小李', tier: '新人' }, reason: 'r' })
  assert.deepEqual(play.call(2, { op: 'act', action: 'train', params: { who: '老周' }, reason: 'r' }).changes[0], { path: '/员工/老周', label: '员工·老周', from: { skill: 8, pay: 30 }, to: { skill: 20, pay: 30 } }, 'a field keeps its own range')
  play.call(2, { op: 'act', action: 'list', params: { name: '青鸟' }, reason: 'r' })
  play.call(2, { op: 'act', action: 'list', params: { name: '红雀' }, reason: 'r' })
  assert.equal(play.call(2, { op: 'act', action: 'quarter', reason: 'r' }).text, '营收 60，工资 40。')
  play.call(2, { op: 'act', action: 'fire', params: { who: '小李' }, reason: 'r' })
  assert.deepEqual(play.settle(2).map(row => row.op + ' ' + row.path.replace('/stat_data', '') + ' ' + JSON.stringify(row.value)), [
    'insert /员工/老周 {"skill":20,"pay":30}', 'remove /员工/小李 undefined', 'insert /产品/青鸟 {"units":10,"price":3,"onSale":true}', 'insert /产品/红雀 {"units":10,"price":3,"onSale":true}', 'replace /公司/现金 120'])
  assert.equal(play.call(3, { op: 'act', action: 'quarter', reason: 'r' }).text, '营收 60，工资 30。', 'the next turn reads the entries from the variables')
})

test('one action with fields per item: a parameter whose when is false is absent and an each over it writes nothing', () => {
  const rules = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'enrol', sets: { q: ['a', 'b', 'c'] },
    state: { pool: { path: '/pool', label: 'pool', keys: 'q', min: 0 }, bond: { path: '/bond', label: 'bond', keys: '*' } },
    actions: { enrol: { label: 'enrol', params: { item: { label: 'item', options: { bonds: 'bonds', pool: 'pool' } },
      who: { label: 'who', text: { max: 8 }, when: "item == 'bonds'" }, picks: { label: 'picks', pick: { set: 'q', min: '2', max: '2' }, when: "item == 'pool'" } },
      effects: [{ var: 'bond', key: 'who', set: '6', when: "item == 'bonds'" }, { var: 'pool', each: 'picks', add: '3', when: "item == 'pool'" }] } } })
  const play = game(rules)
  Object.assign(play.variables, { pool: { a: 0, b: 0, c: 0 }, bond: {} })
  assert.deepEqual(play.call(2, { op: 'act', action: 'enrol', params: { item: 'bonds', who: 'x' }, reason: 'r' }).changes, [{ path: '/bond/x', label: 'bond·x', to: 6 }])
  assert.deepEqual(play.call(2, { op: 'act', action: 'enrol', params: { item: 'pool', picks: ['a', 'c'] }, reason: 'r' }).changes.map(row => row.path + '=' + row.to), ['/pool/a=3', '/pool/c=3'])
})

test('older calls keep their meaning; the card check compiles the rules and keeps rule-owned ranges out of $meta.limits', () => {
  const rules = compileRulesV2(RULES), play = game(rules)
  assert.equal(play.call(2, { action: 'status' }).status, 'sheet')
  // Options are listed id -> label, so the model passes the id alone.
  play.variables.阶段 = 1
  assert.deepEqual(play.call(2, { op: 'status' }).actions.find(row => row.action === 'close').params.result.oneOf, { 破案: '破案', 失败: '失败' })
  play.variables.阶段 = 0
  assert.equal(play.call(2, { action: 'roll', check: 'start', reason: 'r', stakes: 's' }).text, '调查开始。')
  const card = limits => checkRulesCard({ extensions: { 'dsh.rules': RULES } }, { prefix: '/data', limits })
  assert.deepEqual(card([{ path: '/好感' }]), [])
  assert.deepEqual(card([{ path: '/线索/*' }, { path: '/阶段' }]).map(row => row.path + ' ' + row.message), [
    '/data/extensions/dsh.rules /线索/* 归规则管（线索），范围只写在规则里：删掉初值 $meta.limits 里的这一条',
    '/data/extensions/dsh.rules /阶段 归规则管（阶段），范围只写在规则里：删掉初值 $meta.limits 里的这一条'])
  assert.match(checkRulesCard({ extensions: { 'dsh.rules': { ...RULES, actions: {} } } })[0].message, /declare at least one action/)
})

// Dice expressions: NdS terms joined by the formula language; the name reads as the value and the record keeps each die
// with its sides, the expression and its total.
test('a dice expression rolls dice of different sides with a modifier, and its name reads as the total', () => {
  const rules = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'expr',
    tables: { weapons: { 长剑: { n: 1, sides: 8 } } }, state: { bonus: { path: '/加值', initial: 3 } },
    actions: {
      mixed: { label: 'mixed', dice: { r: { roll: '1d6 + 4d100 + 3' } }, text: '{r}' },
      plain: { label: 'plain', dice: { r: { roll: '2d6+bonus', mark: [6] } }, text: '{r}' },
      weapon: { label: 'weapon', params: { w: { table: 'weapons' } }, dice: { hit: { roll: 'd20' }, dmg: { roll: '(w.n)d(w.sides) + bonus' } }, text: '{hit} {dmg}' } } })
  const mixed = runRulesCall(rules, [], { op: 'act', action: 'mixed', reason: 'r' }, 7, { turn: 1 })
  assert.equal(mixed.dice.r.length, 5)
  assert.deepEqual(mixed.faces.r.sides, [6, 100, 100, 100, 100], 'dice of different sides keep each die\'s sides')
  assert.equal(mixed.faces.r.roll, '1d6 + 4d100 + 3')
  assert.equal(mixed.faces.r.total, mixed.dice.r.reduce((a, b) => a + b, 0) + 3)
  assert.equal(mixed.text, String(mixed.faces.r.total))
  const plain = runRulesCall(rules, [], { op: 'act', action: 'plain', reason: 'r' }, 7, { turn: 1 })
  assert.deepEqual([plain.faces.r.sides, plain.faces.r.mark, plain.faces.r.total], [6, [6], plain.dice.r[0] + plain.dice.r[1] + 3])
  const weapon = runRulesCall(rules, [], { op: 'act', action: 'weapon', params: { w: '长剑' }, reason: 'r' }, 7, { turn: 1 })
  assert.deepEqual([weapon.faces.hit.sides, weapon.faces.dmg.sides, weapon.faces.dmg.roll, weapon.text], [20, 8, '1d8 + 3', weapon.dice.hit[0] + ' ' + (weapon.dice.dmg[0] + 3)], 'the expression is shown resolved')
  const best = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'adv', actions: { x: { label: 'x', dice: { r: { roll: 'max(1d20, 1d20) - 1' } } } } })
  assert.equal(runRulesCall(best, [], { op: 'act', action: 'x', reason: 'r' }, 7, { turn: 1 }).faces.r.roll, 'max(1d20, 1d20) - 1', 'anything but a sum stays as written')
  const bad = (dice, pattern) => assert.throws(() => compileRulesV2({ format: 'dsh-rules', version: 2, name: 'x', actions: { x: { label: 'x', dice } } }), pattern)
  bad({ r: { roll: '3 + 4' } }, /actions\.x\.dice\.r\.roll: has no dice/)
  bad({ r: { roll: '1d6 + cash' } }, /reads unknown name cash/)
  bad({ r: { roll: '1d6', count: 1, sides: 6 } }, /give either roll or count and sides/)
})

// Choices in a sequence: a step among them reads the choices before it; a choice that reads one still open is asked
// next time; the manager reports a condition (by gm) himself, with the player's answer.
const SPONSORED = { format: 'dsh-rules', version: 2, name: 'sponsor', state: { gift: { path: '/奖', label: '奖' } },
  tables: { tribute: { 1: { text: '提到蓝色' }, 2: { text: '提到背叛' } } },
  actions: { roll: { label: '掷骰', params: { extra: { type: 'boolean', default: true } },
    dice: { d: { count: 3, sides: 2, mark: [2] }, s: { count: "extra ? 1 : 0", sides: 4, mark: [2] } },
    let: [['raw', 'count(d, 2)'], ['s2', 'count(s, 2)'], ['due', 'len(s) == 1 and s[0] != 2']],
    choices: [
      { id: 'use', label: '额外骰的 2', when: 's2 > 0', options: { add: '计入', sub: '扣除', skip: '忽略' }, default: 'skip' },
      ['n', "raw + (use == 'add' ? s2 : use == 'sub' ? -s2 : 0)"],
      ['top', 'n == 2'],
      { id: 'bonus', label: '奖励', when: 'top', int: { min: 0, max: 2, default: 0 } },
      { id: 'paid', label: '进贡了吗', by: 'gm', when: 'due', hint: "{tribute[s[0] == 1 ? 1 : 2]['text']}", type: 'boolean', default: true }],
    outcomes: [{ id: 'top', label: '顶', when: 'top and (not due or paid)' }, { id: 'ok', label: '成', when: 'n >= 1 and (not due or paid)' }, { id: 'no', label: '败' }],
    effects: [{ var: 'gift', add: 'bonus' }],
    report: [{ id: 'raw', label: '原始', value: 'raw' }, { id: 'n', label: '计数', value: 'n' }] } } }

function seedFor(rules, accept) {
  for (let seed = 1; seed < 5000; seed++) {
    const draw = seededDraw(seed), d = [draw(2), draw(2), draw(2)], s = draw(4)
    if (accept(d, s)) return seed
  }
  throw new Error('no seed')
}

test('choices in a sequence: what reads an open choice is asked next, and the steps between them see the answers', () => {
  const rules = compileRulesV2(SPONSORED), play = game(rules)
  // One 2 on the main dice and a 2 on the extra die: how it counts decides whether the top bonus opens.
  const seed = seedFor(rules, (d, s) => d.filter(f => f === 2).length === 1 && s === 2)
  const first = play.call(2, { op: 'act', action: 'roll', reason: 'r' }, seed)
  assert.deepEqual([first.status, first.choices.map(row => row.id), first.report], ['awaiting', ['use'], { raw: { label: '原始', value: 1 } }], 'the bonus waits for how the die counts')
  assert.equal(first.show, undefined)
  const second = play.call(3, { op: 'choose', choice: { use: 'add' } })
  assert.deepEqual([second.status, second.of, second.choice, second.choices.map(row => row.id)], ['awaiting', first.id, { use: 'add' }, ['bonus']])
  assert.deepEqual(second.report.n.value, 2, 'a step after the answered choice is known now')
  const done = play.call(4, { op: 'choose', choice: { bonus: 2 } })
  assert.deepEqual([done.status, done.of, done.choice, done.outcome.id, done.report.n.value, done.changes[0].to], ['settled', second.id, { use: 'add', bonus: 2 }, 'top', 2, 2])
  // Answered at once, it settles in one go; ignoring the die leaves no bonus to ask.
  play.call(5, { op: 'act', action: 'roll', reason: 'r' }, seed)
  assert.deepEqual(play.call(5, { op: 'choose', choice: { use: 'add', bonus: 1 } }).choice, { use: 'add', bonus: 1 })
  play.call(6, { op: 'act', action: 'roll', reason: 'r' }, seed)
  const skipped = play.call(6, { op: 'choose', choice: {} })
  assert.deepEqual([skipped.status, skipped.outcome.id], ['settled', 'ok'], 'the default answer opens nothing further')
  assert.match(play.call(7, { op: 'act', action: 'roll', reason: 'r' }, seed).status, /awaiting/)
  assert.match(play.call(7, { op: 'choose', choice: { bonus: 1 } }).refused, /nothing to choose for bonus/, 'with the die ignored by default the bonus never opens')
  play.call(7, { op: 'choose', choice: {} })
  // Without the extra die the step runs before any ask, so the outcome fixed by the dice is told while waiting.
  const plain = seedFor(rules, d => d.filter(f => f === 2).length === 2)
  const top = play.call(8, { op: 'act', action: 'roll', params: { extra: false }, reason: 'r' }, plain)
  assert.deepEqual([top.choices.map(row => row.id), top.report.n.value, top.dice.s, top.faces.s], [['bonus'], 2, undefined, undefined], 'a group with no die this time is not in the record')
})

test('a condition the manager reports: listed to the player, required from the model when it answers', () => {
  const rules = compileRulesV2(SPONSORED), play = game(rules)
  const seed = seedFor(rules, (d, s) => d.filter(f => f === 2).length === 1 && s === 1)
  const waiting = play.call(2, { op: 'act', action: 'roll', reason: 'r' }, seed)
  assert.deepEqual(waiting.choices, [{ id: 'paid', label: '进贡了吗', kind: 'boolean', by: 'gm', hint: '提到蓝色', default: true }])
  assert.match(waiting.stop, /by gm 的条件由你/)
  assert.match(play.call(3, { op: 'choose', choice: {} }).refused, /进贡了吗 \(paid\) is yours to report \(by gm\)/)
  assert.deepEqual(play.call(3, { op: 'choose', choice: { paid: false } }).outcome.id, 'no')
  assert.throws(() => compileRulesV2({ ...SPONSORED, actions: { x: { label: 'x', choices: [{ id: 'a', by: 'dm', type: 'boolean' }] } } }), /actions\.x\.choices\.a\.by: must be player or gm/)
})

test('a range with only one bound still holds: a cooldown with a floor never goes below it, a cap with no floor never above it', () => {
  const rules = compileRulesV2({ format: 'dsh-rules', version: 2, name: 'bounds',
    state: { cool: { path: '/冷却', label: '冷却', min: 0 }, cap: { path: '/上限', label: '上限', max: 3 } },
    actions: { tick: { label: '过一季', effects: [{ var: 'cool', add: '-1' }, { var: 'cap', add: '2' }] } } })
  const play = game(rules)
  Object.assign(play.variables, { 冷却: 0, 上限: 2 })
  assert.deepEqual(play.call(2, { op: 'act', action: 'tick', reason: 'r' }).changes, [{ path: '/上限', label: '上限', from: 2, to: 3 }])
})
test('secret for the player only: a report line, a derived value, and the panel, receipts and pages of the card', () => {
  const source = { format: 'dsh-rules', version: 2, name: 'quiet',
    state: { trust: { path: '/信任', label: '信任', min: 0 }, notice: { path: '/幕后/察觉', label: '察觉', min: 0, secret: true } },
    derived: { stage: { path: '/幕后/阶段', label: '阶段', value: 'notice >= 2 ? 1 : 0', secret: true } },
    actions: { push: { label: '推回捷径', effects: [{ var: 'trust', add: '1' }, { var: 'notice', add: '1' }],
      report: [{ id: 'trust', label: '信任', value: 'trust + 1' }, { id: 'next', label: '下一季的捷径', value: "'流片'", secret: true }] } } }
  const play = game(compileRulesV2(source))
  Object.assign(play.variables, { 信任: 0, 幕后: { 察觉: 1, 阶段: 0 } })
  const record = play.call(2, { op: 'act', action: 'push', reason: 'r' })
  assert.deepEqual(record.report, { trust: { label: '信任', value: 1 }, next: { label: '下一季的捷径', value: '流片', secret: true } })
  assert.deepEqual(record.changes.filter(row => row.secret).map(row => row.label), ['察觉', '阶段'])
  // The variable panel, receipts and the card's pages mask them; the card's own rule for a path (here a reveal) wins.
  const card = { extensions: { 'dsh.rules': source } }
  assert.deepEqual(Object.keys(withModHidden(null, card)), ['/幕后/察觉', '/幕后/阶段'])
  const own = { '/幕后/阶段': { mode: 'masked', trend: false, placeholder: '？？？', largeDelta: 10, revealWhen: { path: '/幕后/看见', equals: true } } }
  assert.deepEqual(withModHidden(own, card)['/幕后/阶段'], own['/幕后/阶段'])
  assert.equal(withModHidden(own, { extensions: {} }), own)
})
