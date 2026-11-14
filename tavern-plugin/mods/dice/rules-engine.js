// The rules engine of format dsh-rules v2 (README.md): a card declares the variables its rules own, its tables and
// the actions the story can take, as data. The model only says which action happened and with what parameters; the
// engine checks it may happen, rolls with a recorded seed, does every sum and returns a short result. It keeps no
// numbers of its own: the state is the game's variables plus this branch's records newer than them, and a reply's
// records are written into its variables when it settles (check-tool.js checkSettlement).
// Pure functions: the same rules, state, request, seed and choice give the same record, byte for byte.
import { evaluate, formulaNames, FORMULA_FUNCTIONS, parseFormula } from './check-expr.js'
import { CHECK_SHOWS, seededDraw } from './check-engine.js'

export const RULES_FORMAT = 'dsh-rules'
// What the model is told on an awaiting record (fixed, the same for every card).
export const AWAITING_STOP = '把这些选项用平常的话告诉玩家，然后停笔等他选；不要替他选。'
// …when one of them is a condition the manager reports (a choice by gm): the player hears what it asks of him first.
export const AWAITING_STOP_GM = '把这些选项和标着 by gm 的条件用平常的话告诉玩家，然后停笔等他选；不要替他选。他回复后用 op=choose 交上他的选择，by gm 的条件由你照他的回复和故事判断后一起交上。'
const NAME = /^[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*$/
const MAX_RULES_BYTES = 256 * 1024
// Variable path segments the rules may not name: MVU's own data and prototype names.
const FORBIDDEN_SEGMENTS = new Set(['schema', 'display_data', 'delta_data', '__proto__', 'prototype', 'constructor'])
const ITEM_KINDS = 'int, options, table, set, pick, keyOf, text or type boolean'

function fail(path, message) { throw new Error(path + ': ' + message) }
function formula(path, source) {
  try { return parseFormula(source) } catch (error) { fail(path, error.message) }
}
const optionalFormula = (path, source) => source === undefined || source === null ? null : formula(path, source)
function text(path, value, optional) {
  if (optional && value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be non-empty text')
  return value
}
function plain(path, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  return value
}
// "text with {formula} parts" -> [text | tree], rendered with the action's values.
function template(path, value) {
  if (value === undefined) return null
  return text(path, value).split(/(\{[^{}]*\})/).filter(Boolean).map(part => part.startsWith('{') ? formula(path, part.slice(1, -1)) : part)
}
function render(parts, scope) {
  return parts ? parts.map(part => typeof part === 'string' ? part : String(evaluate(part, scope))).join('') : undefined
}
const templateTrees = parts => (parts || []).filter(part => typeof part !== 'string')
function variablePath(path, value) {
  if (typeof value !== 'string' || !/^(\/[^/~]+)+$/.test(value)) fail(path, 'must be a variable path under stat_data, e.g. "/agent/hp" (no ~ in names)')
  if (value.slice(1).split('/').some(segment => segment.startsWith('$') || FORBIDDEN_SEGMENTS.has(segment))) fail(path, 'may not name MVU metadata ($…, schema) or prototype names')
  return value
}
const primitive = value => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

// The values one variable (or one field of its entries) may take: values, initial, min and max (formulas). Entries of a
// set may each start differently: initial is then one value per entry name.
function valueSpec(at, row, label, entries = null) {
  if (row.values !== undefined && (!Array.isArray(row.values) || !row.values.length || !row.values.every(primitive))) fail(at + '.values', 'must list the values it may take')
  const initial = row.initial ?? (row.values ? row.values[0] : 0)
  if (!(primitive(initial) || (entries && initial && typeof initial === 'object' && Object.entries(initial).every(([key, value]) => entries.includes(key) && primitive(value))))) fail(at + '.initial', 'must be a value' + (entries ? ', or one per entry' : ''))
  return { label, values: row.values ? [...row.values] : null, initial, min: optionalFormula(at + '.min', row.min), max: optionalFormula(at + '.max', row.max) }
}

/** Validate a card's v2 rules once and compile their formulas. Errors name the path the author has to fix. */
export function compileRulesV2(source) {
  plain('rules', source)
  if (source.format !== RULES_FORMAT || source.version !== 2) fail('rules', 'format must be "' + RULES_FORMAT + '" with version 2')
  if (JSON.stringify(source).length > MAX_RULES_BYTES) fail('rules', 'is larger than ' + MAX_RULES_BYTES / 1024 + ' KB')
  const names = new Map()
  const claim = (path, id) => {
    if (!NAME.test(id) || FORMULA_FUNCTIONS.includes(id) || id === 'key' || id === 'outcome') fail(path, 'is not a usable name')
    if (names.has(id)) fail(path, id + ' is already declared at ' + names.get(id))
    names.set(id, path)
  }
  const sets = {}
  for (const [id, values] of Object.entries(source.sets || {})) {
    claim('sets.' + id, id)
    if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value) || new Set(values).size !== values.length) fail('sets.' + id, 'must list distinct names')
    sets[id] = Object.freeze([...values])
  }
  const tables = {}
  for (const [id, rows] of Object.entries(source.tables || {})) {
    claim('tables.' + id, id)
    plain('tables.' + id, rows)
    if (!Object.keys(rows).length) fail('tables.' + id, 'list at least one row')
    for (const [row, columns] of Object.entries(rows)) {
      for (const [column, value] of Object.entries(plain('tables.' + id + '.' + row, columns))) if (!primitive(value)) fail('tables.' + id + '.' + row + '.' + column, 'must be a number, text or true/false')
    }
    tables[id] = rows
  }
  const paths = []
  const ownPath = (path, value) => {
    variablePath(path, value)
    const clash = paths.find(([other]) => other === value || other.startsWith(value + '/') || value.startsWith(other + '/'))
    if (clash) fail(path, value + ' overlaps ' + clash[0] + ' (' + clash[1] + ')')
    paths.push([value, path])
    return value
  }
  const bound = new Set(['key'])
  const state = {}
  for (const [id, row] of Object.entries(plain('state', source.state || {}))) {
    const at = 'state.' + id
    claim(at, id)
    plain(at, row)
    const keys = row.keys === undefined ? null : row.keys === '*' ? '*' : sets[row.keys] ? row.keys : fail(at + '.keys', 'names no set (or "*" for entries that are not fixed)')
    const label = row.label === undefined ? id : text(at + '.label', row.label)
    // An entry with fields (a staff member's skill and pay) is one object per entry: /staff/<name>/<field>.
    let fields = null
    if (row.fields !== undefined) {
      if (!keys) fail(at + '.fields', 'fields belong to a variable with entries (keys)')
      if (row.initial !== undefined || row.values !== undefined || row.min !== undefined || row.max !== undefined) fail(at, 'with fields, initial, values, min and max are written per field')
      fields = {}
      for (const [field, spec] of Object.entries(plain(at + '.fields', row.fields))) {
        if (!NAME.test(field)) fail(at + '.fields.' + field, 'is not a usable name')
        fields[field] = valueSpec(at + '.fields.' + field, plain(at + '.fields.' + field, spec), spec.label === undefined ? field : text(at + '.fields.' + field + '.label', spec.label))
      }
      if (!Object.keys(fields).length) fail(at + '.fields', 'list at least one field')
    }
    const spec = fields ? { values: null, initial: null, min: null, max: null } : valueSpec(at, row, label, keys && keys !== '*' ? sets[keys] : null)
    state[id] = { id, path: ownPath(at + '.path', row.path), label, keys, entries: keys && keys !== '*' ? sets[keys] : null, fields, ...spec, secret: row.secret === true }
  }
  const read = {}
  for (const [id, path] of Object.entries(source.read || {})) { claim('read.' + id, id); read[id] = { id, path: ownPath('read.' + id, path) } }
  const derived = {}
  for (const [id, row] of Object.entries(source.derived || {})) {
    const at = 'derived.' + id
    claim(at, id)
    plain(at, row)
    derived[id] = { id, path: ownPath(at + '.path', row.path), label: row.label === undefined ? id : text(at + '.label', row.label), value: formula(at + '.value', row.value) }
  }
  const global = new Set([...Object.keys(state), ...Object.keys(read), ...Object.keys(derived), ...Object.keys(sets), ...Object.keys(tables)])
  const check = (at, tree, known) => { for (const name of formulaNames(tree)) if (!known.has(name) && !FORMULA_FUNCTIONS.includes(name)) fail(at, 'reads unknown name ' + name) }
  for (const row of Object.values(state)) for (const spec of [row, ...Object.values(row.fields || {})]) for (const tree of [spec.min, spec.max].filter(Boolean)) check('state.' + row.id, tree, new Set([...global, ...bound]))
  for (const row of Object.values(derived)) check('derived.' + row.id, row.value, global)
  const order = derivedOrder(derived)
  const actions = {}
  for (const [id, row] of Object.entries(plain('actions', source.actions || {}))) {
    if (!NAME.test(id)) fail('actions.' + id, 'is not a usable name')
    actions[id] = compileAction('actions.' + id, id, plain('actions.' + id, row), { sets, tables, state, global, check })
  }
  if (!Object.keys(actions).length) fail('actions', 'declare at least one action')
  return Object.freeze({ format: RULES_FORMAT, name: text('rules.name', source.name), guide: text('rules.guide', source.guide, true), sets, tables, state, read, derived, order, actions })
}

// A dice expression: dice written NdS (N and S whole numbers, or a formula in brackets: (n)d(weapon.sides); a lone dS is
// one die), joined by the formula language ("1d6 + 4d100 + 3", "max(2d6, 2d6)", "2d6 + rating[stat]"). Each NdS reads
// as the sum of its dice; the group's name reads as the expression's value and the record keeps every die.
const ROLL_TERM = '#'
const DICE_TERM = /(?<![\w\u4e00-\u9fff.)\]'])(\d+|\([^()]*\))?d(\d+|\([^()]*\))(?![\w\u4e00-\u9fff(])/g
const unwrap = source => source.startsWith('(') ? source.slice(1, -1) : source
function renameIds(tree, rename) {
  if (!tree || typeof tree !== 'object') return tree
  if (Array.isArray(tree)) return tree.map(item => renameIds(item, rename))
  const next = Object.fromEntries(Object.entries(tree).map(([key, value]) => [key, renameIds(value, rename)]))
  if (next.n === 'id') next.v = rename(next.v)
  return next
}
// The expression as the player reads it: a sum of dice and numbers resolved ("1d8 + 3" for "(w.n)d(w.sides) + mod");
// anything else as written.
function rollText(spec, scope, termScope) {
  const parts = []
  const walk = (tree, sign) => {
    if (tree.n === 'bin' && (tree.op === '+' || tree.op === '-')) return walk(tree.a, sign) && walk(tree.b, tree.op === '-' ? -sign : sign)
    if (tree.n === 'id' && tree.v.startsWith(ROLL_TERM)) {
      const term = spec.terms[Number(tree.v.slice(1))], count = evaluate(term.count, scope)
      parts.push([sign, count + 'd' + evaluate(term.sides, scope)])
      return true
    }
    if ([...formulaNames(tree)].some(name => name.startsWith(ROLL_TERM))) return false
    const value = evaluate(tree, termScope)
    if (typeof value !== 'number') return false
    if (value !== 0) parts.push([value < 0 ? -sign : sign, String(Math.abs(value))])
    return true
  }
  if (!walk(spec.roll, 1)) return spec.source
  return parts.map(([sign, text], index) => (index ? (sign < 0 ? ' - ' : ' + ') : sign < 0 ? '-' : '') + text).join('')
}
function compileRoll(at, source) {
  if (typeof source !== 'string' || !source.trim()) fail(at, 'must be a dice expression, e.g. "1d6 + 4d100 + 3"')
  const terms = []
  const replaced = source.replace(DICE_TERM, (_, count, sides) => {
    terms.push({ count: formula(at, unwrap(count ?? '1')), sides: formula(at, unwrap(sides)) })
    return ' __roll' + (terms.length - 1) + '__ '
  })
  if (!terms.length) fail(at, 'has no dice: write them as NdS, e.g. 2d6, d8 or (n)d(sides)')
  return { roll: renameIds(formula(at, replaced), name => /^__roll\d+__$/.test(name) ? ROLL_TERM + name.slice(6, -2) : name), terms, source }
}

// Derived values in the order they can be computed: one reading another follows it; a cycle is the author's to break.
function derivedOrder(derived) {
  const order = [], state = new Map()
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'open') fail('derived.' + id, 'depends on itself through ' + [...trail, id].join(' → '))
    state.set(id, 'open')
    for (const name of formulaNames(derived[id].value)) if (derived[name]) visit(name, [...trail, id])
    state.set(id, 'done')
    order.push(id)
  }
  for (const id of Object.keys(derived)) visit(id, [])
  return order
}

function compileAction(path, id, row, { sets, tables, state, global, check }) {
  const own = new Set()
  const claim = (at, name) => {
    if (!NAME.test(name || '')) fail(at, 'needs an id that is a usable name')
    if (global.has(name) || own.has(name) || FORMULA_FUNCTIONS.includes(name) || name === 'key' || name === 'outcome') fail(at, name + ' is already a name of these rules; pick another name')
    own.add(name)
  }
  const params = Object.entries(row.params || {}).map(([name, spec]) => { claim(path + '.params.' + name, name); return compileItem(path + '.params.' + name, name, plain(path + '.params.' + name, spec), { sets, tables, state }) })
  const dice = {}
  for (const [name, spec] of Object.entries(row.dice || {})) {
    const at = path + '.dice.' + name
    claim(at, name)
    plain(at, spec)
    if (spec.mark !== undefined && (!Array.isArray(spec.mark) || !spec.mark.length || !spec.mark.every(face => Number.isInteger(face) && face >= 1 && face <= 1000))) fail(at + '.mark', 'must be a list of faces, e.g. [3]')
    if (spec.markColor !== undefined && (spec.mark === undefined || typeof spec.markColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(spec.markColor))) fail(at + '.markColor', 'must be a #rrggbb colour next to mark')
    const look = { ...(spec.mark ? { mark: [...spec.mark] } : {}), ...(spec.markColor ? { markColor: spec.markColor } : {}) }
    if (spec.roll !== undefined) {
      if (spec.count !== undefined || spec.sides !== undefined) fail(at, 'give either roll or count and sides')
      dice[name] = { ...compileRoll(at + '.roll', spec.roll), ...look }
    } else dice[name] = { count: formula(at + '.count', spec.count), sides: formula(at + '.sides', spec.sides), ...look }
  }
  // A step is ["name", "formula"], or a sum over entries: {name, each, sum, when?} adds `sum` up for each entry name of
  // `each` (read as `key`) for which `when` holds - e.g. revenue = the sales times the price of every product on sale.
  const compileStep = (key, step) => {
    if (step && typeof step === 'object' && !Array.isArray(step)) {
      const at = path + '.' + key + '.' + step.name
      claim(at, step.name)
      return { name: step.name, each: formula(at + '.each', step.each), sum: formula(at + '.sum', step.sum), when: optionalFormula(at + '.when', step.when) }
    }
    if (!Array.isArray(step) || step.length !== 2) fail(path + '.' + key, 'each step is ["name", "formula"] or {name, each, sum, when}')
    claim(path + '.' + key + '.' + step[0], step[0])
    return { name: step[0], value: formula(path + '.' + key + '.' + step[0], step[1]) }
  }
  const steps = (key, list) => (list || []).map(step => compileStep(key, step))
  const before = steps('let', row.let)
  const rules = (key, list) => (list || []).map((rule, index) => ({ when: formula(path + '.' + key + '.' + index + '.when', plain(path + '.' + key + '.' + index, rule).when), message: template(path + '.' + key + '.' + index + '.message', rule.message) }))
  const require = rules('require', row.require)
  // The choices are a sequence: a step among them is worked out from the choices before it, and a choice that reads a
  // choice still open waits for a later ask (a roll's bonus decided only after the player said how a die counts).
  const sequence = (row.choices || []).map((spec, index) => {
    if (Array.isArray(spec) || (spec && typeof spec === 'object' && spec.id === undefined && spec.name !== undefined)) {
      const step = compileStep('choices', spec)
      return { ...step, reads: [...[step.value, step.each, step.sum, step.when].filter(Boolean).reduce((names, tree) => formulaNames(tree, names), new Set())] }
    }
    plain(path + '.choices.' + index, spec)
    claim(path + '.choices.' + index, spec.id)
    const choice = compileItem(path + '.choices.' + spec.id, spec.id, spec, { sets, tables, state })
    if (choice.kind === 'text') fail(choice.path, 'a choice is not free text; give it options')
    if (spec.by !== undefined && !['player', 'gm'].includes(spec.by)) fail(choice.path + '.by', 'must be player or gm')
    const trees = [choice.when, choice.min, choice.max, choice.default, ...templateTrees(choice.hint)].filter(tree => tree && typeof tree === 'object')
    return { ...choice, by: spec.by || 'player', reads: [...trees.reduce((names, tree) => formulaNames(tree, names), new Set())] }
  })
  const choices = sequence.filter(item => item.kind)
  const after = steps('then', row.then)
  const ensure = rules('ensure', row.ensure)
  const outcomes = (row.outcomes || []).map((outcome, index) => {
    const at = path + '.outcomes.' + index
    plain(at, outcome)
    if (outcome.show !== undefined && !CHECK_SHOWS.includes(outcome.show)) fail(at + '.show', 'must be one of ' + CHECK_SHOWS.join(', '))
    const when = optionalFormula(at + '.when', outcome.when)
    return { id: text(at + '.id', outcome.id), label: text(at + '.label', outcome.label), when, reads: when ? [...formulaNames(when)] : [],
      text: template(at + '.text', outcome.text), stop: template(at + '.stop', outcome.stop), ...(outcome.show ? { show: outcome.show } : {}) }
  })
  if (outcomes.length && outcomes.at(-1).when !== null) fail(path + '.outcomes', 'the last outcome is the default and has no when')
  const effects = (row.effects || []).map((effect, index) => {
    const at = path + '.effects.' + index
    plain(at, effect)
    const target = state[effect.var] || fail(at + '.var', 'names no state variable' + (Object.keys(state).length ? '; state: ' + Object.keys(state).join(', ') : ''))
    if (target.keys && effect.key === undefined && effect.each === undefined) fail(at, effect.var + ' has entries: give key or each')
    if (!target.keys && (effect.key !== undefined || effect.each !== undefined)) fail(at, effect.var + ' has no entries: no key or each')
    const how = ['add', 'set', 'remove'].filter(name => effect[name] !== undefined && effect[name] !== false)
    if (how.length !== 1) fail(at, 'give exactly one of add, set or remove')
    if (effect.remove !== undefined && !(effect.remove === true && target.keys === '*')) fail(at + '.remove', 'removes an entry of a variable whose entries are not fixed (keys "*")')
    if (target.fields && !effect.remove && !Object.hasOwn(target.fields, effect.field ?? '')) fail(at + '.field', effect.var + ' has fields: name one of ' + Object.keys(target.fields).join(', '))
    if ((!target.fields || effect.remove) && effect.field !== undefined) fail(at + '.field', target.fields ? 'remove takes the whole entry, no field' : effect.var + ' has no fields')
    return { var: target.id, field: effect.field ?? null, key: optionalFormula(at + '.key', effect.key), each: optionalFormula(at + '.each', effect.each), add: optionalFormula(at + '.add', effect.add),
      set: optionalFormula(at + '.set', effect.set), remove: effect.remove === true, when: optionalFormula(at + '.when', effect.when), strict: effect.strict === true }
  })
  const report = (row.report || []).map((entry, index) => {
    const at = path + '.report.' + index
    plain(at, entry)
    const value = formula(at + '.value', entry.value), when = optionalFormula(at + '.when', entry.when)
    return { id: text(at + '.id', entry.id), label: text(at + '.label', entry.label), value, when, reads: [...[value, when].filter(Boolean).reduce((names, tree) => formulaNames(tree, names), new Set())] }
  })
  if (row.by !== undefined && !['player', 'gm'].includes(row.by)) fail(path + '.by', 'must be player or gm')
  const action = { id, path, label: text(path + '.label', row.label), title: template(path + '.title', row.title), summary: text(path + '.summary', row.summary, true), by: row.by || 'gm',
    when: optionalFormula(path + '.when', row.when), params, dice, before, require, sequence, choices, after, ensure, outcomes, effects, report,
    text: template(path + '.text', row.text), stop: template(path + '.stop', row.stop) }
  // Every name a formula reads must be declared; a typo is the author's to fix, found when the card is checked.
  const known = new Set([...global, ...own, 'key', 'outcome'])
  if (action.when) check(path + '.when', action.when, global)
  for (const [at, tree] of [
    ...[...before, ...sequence.filter(item => !item.kind), ...after].flatMap(step => [step.value, step.each, step.sum, step.when].filter(Boolean).map(tree => [path + '.' + step.name, tree])),
    ...[...require, ...ensure].flatMap(rule => [[path + '.require', rule.when], ...templateTrees(rule.message).map(tree => [path + '.message', tree])]),
    ...outcomes.flatMap(outcome => [outcome.when, ...templateTrees(outcome.text), ...templateTrees(outcome.stop)].filter(Boolean).map(tree => [path + '.outcomes.' + outcome.id, tree])),
    ...effects.flatMap(effect => [effect.key, effect.each, effect.add, effect.set, effect.when].filter(Boolean).map(tree => [path + '.effects', tree])),
    ...report.flatMap(entry => [entry.value, entry.when].filter(Boolean).map(tree => [path + '.report.' + entry.id, tree])),
    ...[...templateTrees(action.text), ...templateTrees(action.stop), ...templateTrees(action.title)].map(tree => [path, tree]),
    ...[...params, ...choices].flatMap(item => [item.when, item.min, item.max, item.default, ...templateTrees(item.hint)].filter(tree => tree && typeof tree === 'object').map(tree => [item.path, tree])),
    ...Object.values(dice).flatMap(spec => spec.terms ? [[path + '.dice', spec.roll], ...spec.terms.flatMap(term => [[path + '.dice', term.count], [path + '.dice', term.sides]])] : [[path + '.dice', spec.count], [path + '.dice', spec.sides]])
  ]) check(at, tree, new Set([...known, ...Object.values(dice).flatMap(spec => (spec.terms || []).map((_, index) => ROLL_TERM + index))]))
  return Object.freeze(action)
}

// A parameter (given by the model with the action) or a choice (made by the player after it): int {min,max,default},
// options {id: label | {label, ...attributes}}, table (a row of a table; its columns are attributes), set (one name of
// a set), pick (names of a set, repeats allowed), keyOf (an entry a variable has now), text {max} (a short name, e.g.
// a new entry) or type boolean. Any of them may carry when: given only when it holds.
function compileItem(path, id, row, { sets, tables, state }) {
  const base = { id, path, label: row.label === undefined ? id : text(path + '.label', row.label), hint: template(path + '.hint', row.hint), when: optionalFormula(path + '.when', row.when) }
  if (row.int) {
    plain(path + '.int', row.int)
    return { ...base, kind: 'int', min: formula(path + '.int.min', row.int.min), max: formula(path + '.int.max', row.int.max), default: optionalFormula(path + '.int.default', row.int.default) }
  }
  if (row.options || row.table) {
    let options
    if (row.table) options = Object.fromEntries(Object.entries(tables[row.table] || fail(path + '.table', 'names no table')).map(([value, columns]) => [value, { ...columns, label: typeof columns.label === 'string' ? columns.label : value }]))
    else {
      options = {}
      for (const [value, option] of Object.entries(plain(path + '.options', row.options))) options[value] = typeof option === 'string' ? { label: option } : { ...plain(path + '.options.' + value, option), label: text(path + '.options.' + value + '.label', option.label) }
      if (!Object.keys(options).length) fail(path + '.options', 'list at least one option')
    }
    if (row.default !== undefined && !Object.hasOwn(options, row.default)) fail(path + '.default', 'is not an option')
    return { ...base, kind: 'options', options, defaultValue: row.default ?? null }
  }
  if (row.set) return { ...base, kind: 'set', set: sets[row.set] ? row.set : fail(path + '.set', 'names no set'), defaultValue: row.default ?? null }
  if (row.pick) {
    plain(path + '.pick', row.pick)
    return { ...base, kind: 'pick', set: sets[row.pick.set] ? row.pick.set : fail(path + '.pick.set', 'names no set'), min: formula(path + '.pick.min', row.pick.min ?? 0), max: formula(path + '.pick.max', row.pick.max) }
  }
  if (row.keyOf) return { ...base, kind: 'keyOf', of: state[row.keyOf]?.keys ? row.keyOf : fail(path + '.keyOf', 'names no state variable with entries') }
  if (row.text) {
    const max = plain(path + '.text', row.text).max ?? 40
    if (!Number.isInteger(max) || max < 1 || max > 200) fail(path + '.text.max', 'must be a whole number from 1 to 200')
    return { ...base, kind: 'text', max }
  }
  if (row.type === 'boolean') return { ...base, kind: 'boolean', defaultValue: row.default === true }
  return fail(path, 'is one of ' + ITEM_KINDS)
}

function at(node, path) {
  for (const part of path.slice(1).split('/')) node = node && typeof node === 'object' && Object.hasOwn(node, part) ? node[part] : undefined
  return node
}
const entryInitial = (row, key) => row.initial && typeof row.initial === 'object' ? row.initial[key] ?? 0 : row.initial
const fieldDefaults = row => Object.fromEntries(Object.entries(row.fields).map(([field, spec]) => [field, spec.initial]))

/**
 * The rules' state read from the game's settled variables (stat_data): a variable the save does not have yet starts at
 * its initial value (a derived one is computed), entries of a "*" variable are the object's own keys ($-keys are MVU's
 * metadata, not entries), and a read-only variable the save lacks is null.
 */
export function readRulesState(rules, variables) {
  const values = {}
  for (const row of Object.values(rules.state)) {
    const value = at(variables, row.path)
    if (!row.keys) values[row.id] = value === undefined ? row.initial : value
    else {
      const names = row.keys === '*' ? Object.keys(value && typeof value === 'object' ? value : {}).filter(key => !key.startsWith('$')) : rules.sets[row.keys]
      const entry = key => value && typeof value === 'object' && value[key] !== undefined ? value[key] : undefined
      values[row.id] = Object.fromEntries(names.map(key => [key, row.fields ? { ...fieldDefaults(row), ...Object.fromEntries(Object.entries(entry(key) ?? {}).filter(([field]) => Object.hasOwn(row.fields, field))) }
        : entry(key) ?? entryInitial(row, key)]))
    }
  }
  for (const row of Object.values(rules.read)) values[row.id] = at(variables, row.path) ?? null
  for (const id of rules.order) {
    const value = at(variables, rules.derived[id].path)
    values[id] = value === undefined ? evaluate(rules.derived[id].value, scopeOf(rules, null, values, {})) : value
  }
  return values
}

/** The state after `records` (newer than the variables it was read from): each change row's final value by its path. */
export function foldRecords(rules, state, records) {
  const next = structuredClone(state)
  const rows = [...Object.values(rules.state), ...Object.values(rules.derived)]
  for (const record of records) for (const change of Array.isArray(record?.changes) ? record.changes : []) {
    if (typeof change?.path !== 'string') continue
    const row = rows.find(item => change.path === item.path || (item.keys && change.path.startsWith(item.path + '/')))
    if (!row) continue
    if (change.path === row.path) { if (Object.hasOwn(change, 'to')) next[row.id] = change.to; continue }
    const key = change.path.slice(row.path.length + 1)
    if (Object.hasOwn(change, 'to')) next[row.id] = { ...next[row.id], [key]: change.to }
    else { next[row.id] = { ...next[row.id] }; delete next[row.id][key] }
  }
  return next
}

function scopeOf(rules, action, state, values) {
  const items = action ? [...action.params, ...action.choices] : []
  return {
    get(name) {
      if (Object.hasOwn(values, name)) return values[name]
      if (Object.hasOwn(state, name)) return state[name]
      if (Object.hasOwn(rules.sets, name)) return rules.sets[name]
      if (Object.hasOwn(rules.tables, name)) return rules.tables[name]
      throw new Error(name + ' is not known yet here')
    },
    attr(name, key) {
      const item = items.find(row => row.id === name), option = item?.kind === 'options' ? item.options[values[name]] : null
      if (!option || !Object.hasOwn(option, key)) throw new Error(name + '.' + key + ' is not declared')
      return option[key]
    }
  }
}

// An entry name that comes from the story (a new relation, a bought item) becomes a variable path segment: it must stay one.
function entryName(row, key) {
  if (row.entries) {
    if (!row.entries.includes(key)) throw new Error(row.label + ' has no entry ' + JSON.stringify(key) + '; entries: ' + row.entries.join(', '))
    return key
  }
  if (typeof key !== 'string' || !key.trim() || key.length > 80 || /[/~]/.test(key) || key.startsWith('$') || FORBIDDEN_SEGMENTS.has(key)) throw new Error(row.label + ': ' + JSON.stringify(key) + ' cannot name an entry (1–80 characters, no / or ~)')
  return key
}

function readItem(item, given, scope, state) {
  const where = item.label + ' (' + item.id + ')'
  const bad = what => { throw new Error(where + ' ' + what) }
  switch (item.kind) {
    case 'int': {
      const min = evaluate(item.min, scope), max = evaluate(item.max, scope), value = given ?? (item.default ? evaluate(item.default, scope) : undefined)
      return Number.isInteger(value) && value >= min && value <= max ? value : bad('must be a whole number from ' + min + ' to ' + max)
    }
    case 'options': {
      const value = given ?? item.defaultValue
      return Object.hasOwn(item.options, value ?? '') ? value : bad('must be one of: ' + Object.entries(item.options).map(([id, option]) => id === option.label ? id : id + ' (' + option.label + ')').join(', '))
    }
    case 'set': { const names = scope.get(item.set), value = given ?? item.defaultValue; return names.includes(value) ? value : bad('must be one of: ' + names.join(', ')) }
    case 'pick': {
      const names = scope.get(item.set), min = evaluate(item.min, scope), max = evaluate(item.max, scope), value = given ?? []
      return Array.isArray(value) && value.length >= min && value.length <= max && value.every(name => names.includes(name)) ? [...value] : bad('must list ' + (min === max ? min : min + ' to ' + max) + ' of: ' + names.join(', '))
    }
    case 'keyOf': { const names = Object.keys(state[item.of]); return names.includes(given) ? given : bad(names.length ? 'must be one of: ' + names.join(', ') : 'has no entries to pick from yet') }
    case 'text': return typeof given === 'string' && given.trim() && given.trim().length <= item.max && !/[/~\u0000-\u001f]/.test(given) ? given.trim() : bad('must be a name of at most ' + item.max + ' characters, without / or ~')
    case 'boolean': { const value = given ?? item.defaultValue; return typeof value === 'boolean' ? value : bad('must be true or false') }
  }
}

function runStep(step, scope, values) {
  if (step.value) return evaluate(step.value, scope)
  const keys = evaluate(step.each, scope)
  let total = 0
  for (const key of Array.isArray(keys) ? keys : Object.keys(keys ?? {})) {
    values.key = key
    if (step.when && !evaluate(step.when, scope)) continue
    const value = evaluate(step.sum, scope)
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(step.name + ': each entry adds a number, got ' + JSON.stringify(value) + ' for ' + key)
    total += value
  }
  delete values.key
  return total
}

function available(rules, state) {
  const scope = scopeOf(rules, null, state, {})
  return Object.values(rules.actions).filter(row => !row.when || evaluate(row.when, scope))
}

// Parameters, dice and the steps before the player's choice. Deterministic in (rules, state, request, seed).
function prepare(rules, state, request, seed) {
  const action = rules.actions[request.action]
  const now = () => available(rules, state).map(row => row.id + ' (' + row.label + ')').join(', ') || 'none'
  if (!action) throw new Error('no action ' + JSON.stringify(request.action) + '; available now: ' + now())
  if (action.when && !evaluate(action.when, scopeOf(rules, null, state, {}))) throw new Error(action.label + ' (' + action.id + ') is not available now; available now: ' + now())
  const values = {}, scope = scopeOf(rules, action, state, values), given = request.params && typeof request.params === 'object' ? request.params : {}
  for (const name of Object.keys(given)) if (!action.params.some(row => row.id === name)) throw new Error(action.label + ' takes no parameter ' + name + '; parameters: ' + (action.params.map(row => row.id).join(', ') || 'none'))
  for (const param of action.params) {
    if (param.when && !evaluate(param.when, scope)) { values[param.id] = null; continue }
    values[param.id] = readItem(param, given[param.id], scope, state)
  }
  const draw = seededDraw(seed), dice = {}, faces = {}
  const roll = (name, count, sides) => {
    if (!Number.isInteger(count) || count < 0 || count > 100 || !Number.isInteger(sides) || sides < 2 || sides > 1000) throw new Error(action.label + ': dice ' + name + ' must be 0-100 dice of 2-1000 sides')
    return Array.from({ length: count }, () => draw(sides))
  }
  for (const [name, spec] of Object.entries(action.dice)) {
    const look = { ...(spec.mark ? { mark: spec.mark } : {}), ...(spec.markColor ? { markColor: spec.markColor } : {}) }
    if (!spec.terms) {
      const sides = evaluate(spec.sides, scope)
      values[name] = roll(name, evaluate(spec.count, scope), sides)
      // A group that rolls no die this time (an extra die only some rolls get) leaves the record.
      if (values[name].length) { dice[name] = values[name]; faces[name] = { sides, ...look } }
      continue
    }
    // A dice expression: its name is its value; the record keeps the dice and, when they differ, each die's sides.
    const sums = [], all = [], sidesOf = []
    for (const term of spec.terms) {
      const sides = evaluate(term.sides, scope), rolled = roll(name, evaluate(term.count, scope), sides)
      sums.push(rolled.reduce((total, face) => total + face, 0)); all.push(...rolled); sidesOf.push(...rolled.map(() => sides))
    }
    if (all.length > 100) throw new Error(action.label + ': dice ' + name + ' rolls more than 100 dice')
    const termScope = { get: id => id.startsWith(ROLL_TERM) ? sums[Number(id.slice(1))] : scope.get(id), attr: scope.attr }
    const total = evaluate(spec.roll, termScope)
    if (typeof total !== 'number' || !Number.isFinite(total)) throw new Error(action.label + ': dice ' + name + ' gives ' + JSON.stringify(total) + ', not a number')
    values[name] = total
    dice[name] = all
    faces[name] = { sides: sidesOf.every(sides => sides === sidesOf[0]) ? sidesOf[0] ?? evaluate(spec.terms[0].sides, scope) : sidesOf, roll: rollText(spec, scope, termScope), total, ...look }
  }
  for (const step of action.before) values[step.name] = runStep(step, scope, values)
  // A requirement refuses the action: nothing is recorded, and the card's message tells the story its way out.
  for (const rule of action.require) if (!evaluate(rule.when, scope)) throw new Error(render(rule.message, scope))
  return { action, values, scope, dice, faces, params: Object.fromEntries(action.params.filter(row => values[row.id] !== null).map(row => [row.id, values[row.id]])) }
}

// A choice as the player sees it once the dice are down, or null when it is no choice now (its when is false, an int
// range has one value, a keyOf variable has no entries).
function listChoice(choice, scope, state) {
  if (choice.when && !evaluate(choice.when, scope)) return null
  const row = { id: choice.id, label: choice.label, kind: choice.kind, ...(choice.by === 'gm' ? { by: 'gm' } : {}), ...(choice.hint ? { hint: render(choice.hint, scope) } : {}) }
  if (choice.kind === 'int') {
    row.min = evaluate(choice.min, scope); row.max = evaluate(choice.max, scope); row.default = choice.default ? evaluate(choice.default, scope) : row.min
    if (row.min === row.max) return null
  } else if (choice.kind === 'options') { row.options = Object.fromEntries(Object.entries(choice.options).map(([id, option]) => [id, option.label])); row.default = choice.defaultValue ?? Object.keys(choice.options)[0] }
  else if (choice.kind === 'set') { row.options = scope.get(choice.set); row.default = choice.defaultValue ?? row.options[0] }
  else if (choice.kind === 'pick') { row.options = scope.get(choice.set); row.min = evaluate(choice.min, scope); row.max = evaluate(choice.max, scope) }
  else if (choice.kind === 'keyOf') { row.options = Object.keys(state[choice.of]); if (!row.options.length) return null; row.default = row.options[0] }
  else row.default = choice.defaultValue
  return row
}
// The value of a choice that is not asked: an int's only value (0 when its when is false), nothing for the others.
function closedValue(choice, scope) {
  if (choice.kind === 'int') return choice.when && !evaluate(choice.when, scope) ? 0 : evaluate(choice.min, scope)
  return choice.kind === 'pick' ? [] : choice.kind === 'boolean' ? false : null
}

/**
 * Walk the choice sequence with the answers so far. A choice is answered from `answers`, else takes its default when
 * `fill(choice)` says so, else it is open: asked now, and whatever reads it (a later step or choice) waits for the next
 * ask. Returns the choices answered (`asked`, as listed), the ones open now and the names not known yet.
 */
function walkChoices(action, scope, state, values, answers, fill) {
  const asked = [], open = [], unknown = new Set()
  for (const item of action.sequence) {
    if (item.reads.some(name => unknown.has(name))) { unknown.add(item.kind ? item.id : item.name); continue }
    if (!item.kind) { values[item.name] = runStep(item, scope, values); continue }
    const row = listChoice(item, scope, state)
    if (!row) { values[item.id] = closedValue(item, scope); continue }
    if (Object.hasOwn(answers, item.id) || fill(item)) {
      values[item.id] = readItem(item, answers[item.id] ?? (item.kind === 'pick' ? undefined : row.default), scope, state)
      asked.push(row)
      continue
    }
    open.push(row)
    unknown.add(item.id)
  }
  return { asked, open, unknown }
}

function boundOf(rules, state, row, which, key) {
  if (!row[which]) return null
  return evaluate(row[which], { get: name => name === 'key' ? key : scopeOf(rules, null, state, {}).get(name), attr() { throw new Error('bounds read variables only') } })
}

// The steps after the choice, the outcome, the effects and the derived values. Text and report read the values before
// the effects ("还剩 {chaos - cost} 点"); each effect reads the state as the earlier ones left it.
// Answer the choices (`answers`, defaults where `fill` says) and, when none is left open, settle: { waiting } or { done }.
function resolve(rules, state, prepared, answers, fill) {
  const { action, values, scope } = prepared
  const walk = walkChoices(action, scope, state, values, answers, fill)
  for (const name of Object.keys(answers)) {
    if (walk.asked.some(row => row.id === name)) continue
    const open = walk.open.map(row => row.id)
    throw new Error('nothing to choose for ' + name + (open.length ? ' now; open choices: ' + open.join(', ') : '; this action has no open choice'))
  }
  if (walk.open.length) {
    for (const step of action.after) walk.unknown.add(step.name)
    return { waiting: walk }
  }
  return { done: finish(rules, state, prepared, walk.asked) }
}

function finish(rules, state, prepared, asked) {
  const { action, values, scope } = prepared
  for (const step of action.after) values[step.name] = runStep(step, scope, values)
  for (const rule of action.ensure) if (!evaluate(rule.when, scope)) throw new Error(render(rule.message, scope))
  const outcome = action.outcomes.find(row => row.when === null || evaluate(row.when, scope)) || null
  values.outcome = outcome ? outcome.id : null
  const shown = { text: render(outcome?.text || action.text, scope), stop: render(outcome?.stop || action.stop, scope), report: reportOf(action.report, scope) }
  const next = structuredClone(state), changes = []
  // One value written: clamped into its range unless strict (strict refuses to leave it). A field is written into its
  // entry, and the change row is the whole entry (an entry with fields is one object in the variables).
  const write = (row, key, field, to, strict) => {
    const spec = field ? row.fields[field] : row, name = row.label + (key === null ? '' : '·' + key) + (field ? '·' + spec.label : '')
    const old = field ? next[row.id][key]?.[field] : key === null ? next[row.id] : next[row.id][key]
    if (to !== undefined && !primitive(to)) throw new Error(name + ': a value is a number, text or true/false, got ' + JSON.stringify(to))
    if (typeof to === 'number') {
      const min = boundOf(rules, next, spec, 'min', key), max = boundOf(rules, next, spec, 'max', key)
      if ((min !== null && to < min) || (max !== null && to > max)) {
        if (strict) throw new Error(name + ' is ' + old + ' and must stay within ' + (min ?? '−∞') + '..' + (max ?? '∞'))
        to = Math.min(max ?? to, Math.max(min ?? to, to))
      }
    }
    if (to !== undefined && spec.values && !spec.values.includes(to)) throw new Error(name + ' must be one of ' + spec.values.map(value => JSON.stringify(value)).join(', ') + ', not ' + JSON.stringify(to))
    if (old === to && !(field && next[row.id][key] === undefined)) return
    const from = key === null ? next[row.id] : next[row.id][key]
    if (field) to = { ...(from ?? fieldDefaults(row)), [field]: to }
    if (key === null) next[row.id] = to
    else { next[row.id] = { ...next[row.id] }; if (to === undefined) delete next[row.id][key]; else next[row.id][key] = to }
    changes.push({ path: row.path + (key === null ? '' : '/' + key), label: row.label + (key === null ? '' : '·' + key), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(row.secret ? { secret: true } : {}) })
  }
  for (const effect of action.effects) {
    const row = rules.state[effect.var], live = scopeOf(rules, action, next, values)
    const apply = key => {
      values.key = key
      if (effect.when && !evaluate(effect.when, live)) return
      if (key !== null) key = entryName(row, key)
      const from = effect.field ? (next[row.id][key] ?? fieldDefaults(row))[effect.field] : key === null ? next[row.id] : next[row.id][key]
      write(row, key, effect.field, effect.remove ? undefined : effect.set ? evaluate(effect.set, live) : (from ?? 0) + evaluate(effect.add, live), effect.strict)
    }
    // A parameter whose own when is false is absent (null): an each over it has no entries.
    if (effect.each) { const keys = evaluate(effect.each, live) ?? []; for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) apply(key) }
    else apply(effect.key ? evaluate(effect.key, live) : null)
  }
  delete values.key
  // Derived values follow at once: formulas over the state, so they need no trigger and cannot loop.
  for (const id of rules.order) {
    const row = rules.derived[id], to = evaluate(row.value, scopeOf(rules, null, next, {}))
    if (!primitive(to)) throw new Error(row.label + ': a value is a number, text or true/false, got ' + JSON.stringify(to))
    if (next[id] !== to) { changes.push({ path: row.path, label: row.label, ...(next[id] === undefined ? {} : { from: next[id] }), to }); next[id] = to }
  }
  return { outcome: outcome ? { id: outcome.id, label: outcome.label } : null, show: showOf(outcome), ...shown, changes: mergeChanges(changes),
    chosen: Object.fromEntries(asked.map(row => [row.id, values[row.id]])) }
}

// The report; while choices are open, only the entries that read nothing still unknown.
function reportOf(entries, scope, unknown = null) {
  const report = {}
  for (const row of entries) {
    if (unknown && row.reads.some(name => unknown.has(name))) continue
    if (!row.when || evaluate(row.when, scope)) report[row.id] = { label: row.label, value: evaluate(row.value, scope) }
  }
  return report
}

// One row per variable path: from its first value to its last (a row without from is a new entry, without to a removed one).
function mergeChanges(changes) {
  const rows = new Map()
  for (const row of changes) {
    const first = rows.get(row.path)
    if (!first) { rows.set(row.path, { ...row }); continue }
    if (Object.hasOwn(row, 'to')) first.to = row.to
    else delete first.to
  }
  return [...rows.values()].filter(row => JSON.stringify(row.from) !== JSON.stringify(row.to))
}

const showOf = outcome => outcome?.show ? { show: { effect: outcome.show, label: outcome.label } } : {}
// The outcome already fixed while choices are open: it and every outcome before it read nothing still unknown.
function decidedOutcome(action, scope, unknown) {
  for (const row of action.outcomes) {
    if (row.reads.some(name => unknown.has(name) || name === 'outcome')) return null
    if (row.when === null || evaluate(row.when, scope)) return row
  }
  return null
}

function headOf(prepared, seed) {
  const { action, params, dice, faces, scope } = prepared
  return { action: action.id, label: action.label, ...(action.title ? { title: render(action.title, scope) } : {}), ...(Object.keys(params).length ? { params } : {}),
    ...(Object.keys(dice).length ? { seed, dice, faces } : {}) }
}
const compact = record => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null && !(typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)))

// What an int choice's values would each do, so the player chooses knowing it and the model need not work it out.
// The choices after it take their defaults (a condition the manager reports is taken as its default too).
function previews(rules, state, request, seed, made, choice) {
  if (choice.kind !== 'int' || choice.max - choice.min > 12) return
  choice.preview = []
  for (let value = choice.min; value <= choice.max; value++) {
    let done
    try { done = resolve(rules, state, prepare(rules, state, request, seed), { ...made, [choice.id]: value }, () => true).done } catch { continue }
    choice.preview.push({ value, outcome: done.outcome?.label ?? null, changes: done.changes.map(row => ({ label: row.label, ...(typeof row.from === 'number' && typeof row.to === 'number' ? { add: row.to - row.from } : { to: row.to }), ...(row.secret ? { secret: true } : {}) })) })
  }
}

// Settle, or wait for the choices open now. `asking` is the set of choice ids the record being answered listed: those the
// answer leaves out take their defaults, except a condition the manager reports (by gm), which has to be given. An answer
// that already reaches past them (a choice the record did not list yet) answers the later asks too, with defaults.
function settleOrWait(rules, state, prepared, request, seed, answers, asking, ahead = false) {
  const head = headOf(prepared, seed), { action, scope, values } = prepared
  const result = resolve(rules, state, prepared, answers, item => Boolean(asking?.has(item.id) || ahead) && item.by !== 'gm')
  if (result.done) {
    const done = result.done
    return compact({ ...head, status: 'settled', ...(asking ? { choice: done.chosen } : {}), outcome: done.outcome, ...done.show, text: done.text, report: done.report, changes: done.changes, stop: done.stop })
  }
  const { open, asked, unknown } = result.waiting
  const unreported = open.filter(row => asking?.has(row.id))
  if (unreported.length) throw new Error(unreported.map(row => row.label + ' (' + row.id + ')').join(', ') + ' is yours to report (by gm): judge it from the story and give it in choice, with the player\'s answers')
  const made = Object.fromEntries(asked.map(row => [row.id, values[row.id]]))
  for (const choice of open) previews(rules, state, request, seed, made, choice)
  return compact({ ...head, status: 'awaiting', choice: made, ...showOf(decidedOutcome(action, scope, unknown)), report: reportOf(action.report, scope, unknown), choices: open,
    stop: open.some(row => row.by === 'gm') ? AWAITING_STOP_GM : AWAITING_STOP })
}

/**
 * Run one action. With no open choice it settles at once; otherwise the record waits for the player (status
 * 'awaiting', nothing changed), listing each choice (an int one with what each value would do) and what is already decided.
 */
export function runRulesAction(rules, state, request, seed) {
  return settleOrWait(rules, state, prepare(rules, state, request, seed), request, seed, {}, null)
}

/**
 * Answer an awaiting record. The dice replay from the record's own seed with the choices it already holds; a choice that
 * reads one answered now opens a further ask (another awaiting record), else the record settles.
 */
export function chooseRulesAction(rules, state, record, choice = {}) {
  const request = { action: record.action, params: record.params }, seed = record.seed ?? 0
  const given = choice && typeof choice === 'object' ? choice : {}, asking = new Set((record.choices || []).map(row => row.id))
  return settleOrWait(rules, state, prepare(rules, state, request, seed), request, seed, { ...(record.choice || {}), ...given }, asking, Object.keys(given).some(id => !asking.has(id)))
}

/** The actions available now, for the model: id, label, who starts it, when to use it and its parameters. */
export function describeActions(rules, state) {
  const scope = scopeOf(rules, null, state, {})
  return available(rules, state).map(action => compact({ action: action.id, label: action.label, by: action.by, summary: action.summary,
    params: Object.fromEntries(action.params.map(param => [param.id, describeItem(rules, param, state, scope)])) }))
}
function describeItem(rules, item, state, scope) {
  const when = item.when ? { onlyWhen: true } : {}
  if (item.kind === 'set') return { label: item.label, oneOf: rules.sets[item.set], ...when }
  // id -> label, as the v1 sheet gives them: a joined "id（label）" string got copied whole as the value.
  if (item.kind === 'options') return { label: item.label, oneOf: Object.fromEntries(Object.entries(item.options).map(([id, option]) => [id, option.label])), ...when }
  if (item.kind === 'keyOf') return { label: item.label, oneOf: Object.keys(state[item.of]), ...when }
  if (item.kind === 'boolean') return { label: item.label, boolean: true, ...when }
  if (item.kind === 'text') return { label: item.label, text: item.max, ...when }
  if (item.kind === 'pick') return { label: item.label, pickFrom: rules.sets[item.set], ...when }
  let range = {}
  try { range = { min: evaluate(item.min, scope), max: evaluate(item.max, scope) } } catch { /* reads parameters: given with the action */ }
  return { label: item.label, int: true, ...range, ...when }
}

/** The rule-owned values by label, for the model's status read. */
export function describeRulesState(rules, state) {
  return Object.fromEntries([...Object.values(rules.state), ...Object.values(rules.derived)].map(row => [row.label, state[row.id]]))
}
