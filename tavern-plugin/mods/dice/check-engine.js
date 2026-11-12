// The rule check engine: a card declares its checks and resources as data (format dsh-check-rules, README.md),
// the engine rolls with a recorded seed and settles every number. The model only proposes a check and narrates its
// result; the player's choices after a roll (e.g. spending a resource to change dice) come back through settle.
// Pure functions: the same rules, state, request, seed and choice give the same record, byte for byte.
import { evaluate, formulaNames, FORMULA_FUNCTIONS, parseFormula } from './check-expr.js'

export const CHECK_RULES_FORMAT = 'dsh-check-rules'
// The stage performances an outcome may ask for (outcomes[].show; the dice mod's client/show.js draws them). converge: the
// roll's marked dice leave the others and meet in one large marked figure carrying the outcome's label.
export const CHECK_SHOWS = Object.freeze(['converge'])
const NAME = /^[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*$/

function fail(path, message) { throw new Error(path + ': ' + message) }
function formula(path, source) {
  try { return parseFormula(source) } catch (error) { fail(path, error.message) }
}
function text(path, value, optional) {
  if (optional && value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be non-empty text')
  return value
}
function plain(path, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  return value
}

/** Validate a card's rules once and compile their formulas. Errors name the path the author has to fix. */
export function compileRules(source) {
  plain('rules', source)
  if (source.format !== CHECK_RULES_FORMAT || source.version !== 1) fail('rules', 'format must be "' + CHECK_RULES_FORMAT + '" with version 1')
  const sets = {}
  for (const [id, values] of Object.entries(source.sets || {})) {
    if (!NAME.test(id)) fail('sets.' + id, 'is not a usable name')
    if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value) || new Set(values).size !== values.length) fail('sets.' + id, 'must list distinct names')
    sets[id] = Object.freeze([...values])
  }
  const resources = {}
  for (const [id, row] of Object.entries(plain('resources', source.resources))) {
    const path = 'resources.' + id
    if (!NAME.test(id)) fail(path, 'is not a usable name')
    plain(path, row)
    const keys = row.keys === undefined ? null : sets[row.keys] || fail(path + '.keys', 'names no set')
    const initial = row.initial ?? 0
    if (keys) {
      plain(path + '.initial', initial)
      for (const key of Object.keys(initial)) if (!keys.includes(key)) fail(path + '.initial.' + key, 'is not in set ' + row.keys)
    } else if (typeof initial !== 'number') fail(path + '.initial', 'must be a number')
    resources[id] = { id, label: text(path + '.label', row.label), keys, keySet: row.keys ?? null, initial,
      min: row.min === undefined || row.min === null ? null : formula(path + '.min', row.min),
      max: row.max === undefined || row.max === null ? null : formula(path + '.max', row.max),
      gm: row.gm === true, hidden: row.hidden === true, secret: row.secret === true, note: text(path + '.note', row.note, true),
      mvu: row.mvu === undefined ? null : typeof row.mvu === 'string' && /^(\/[^/~]+)+$/.test(row.mvu) ? row.mvu : fail(path + '.mvu', 'must be a variable path under stat_data, e.g. "/agent/hp"') }
  }
  const checks = {}
  for (const [id, row] of Object.entries(plain('checks', source.checks))) checks[id] = compileCheck('checks.' + id, id, plain('checks.' + id, row), { sets, resources })
  if (!Object.keys(checks).length) fail('checks', 'declare at least one check')
  return Object.freeze({ name: text('rules.name', source.name), sets, resources, checks, guide: text('rules.guide', source.guide, true) })
}

function compileCheck(path, id, row, { sets, resources }) {
  const known = new Set([...Object.keys(resources), ...Object.keys(sets), 'outcome'])
  // A check's own names (parameters, dice, steps, choices) would hide a resource or set of the same name.
  const own = new Set()
  const claim = (at, name) => {
    if (known.has(name) || own.has(name)) fail(at, name + ' is already a resource, set or name of this check; pick another name')
    own.add(name)
  }
  for (const name of [...Object.keys(row.params || {}), ...Object.keys(row.dice || {}), ...[...(row.let || []), ...(row.then || [])].map(step => Array.isArray(step) ? step[0] : ''), ...(row.choices || []).map(choice => choice?.id)]) claim(path, name)
  const params = {}
  for (const [name, param] of Object.entries(row.params || {})) params[name] = compileChoice(path + '.params.' + name, name, plain(path + '.params.' + name, param), sets, false)
  for (const name of Object.keys(params)) known.add(name)
  const dice = {}
  for (const [name, spec] of Object.entries(row.dice || {})) {
    plain(path + '.dice.' + name, spec)
    // mark: faces the game singles out (Triangle Agency's 3s), markColor the colour they are drawn in (else the theme accent). Display only.
    if (spec.mark !== undefined && (!Array.isArray(spec.mark) || !spec.mark.length || !spec.mark.every(face => Number.isInteger(face) && face >= 1 && face <= 1000))) fail(path + '.dice.' + name + '.mark', 'must be a list of faces, e.g. [3]')
    if (spec.markColor !== undefined && (spec.mark === undefined || typeof spec.markColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(spec.markColor))) fail(path + '.dice.' + name + '.markColor', 'must be a #rrggbb colour next to mark')
    dice[name] = { count: formula(path + '.dice.' + name + '.count', spec.count), sides: formula(path + '.dice.' + name + '.sides', spec.sides), ...(spec.mark ? { mark: [...spec.mark] } : {}), ...(spec.markColor ? { markColor: spec.markColor } : {}) }
    known.add(name)
  }
  const require = (row.require || []).map((rule, index) => ({ when: formula(path + '.require.' + index + '.when', rule.when), message: text(path + '.require.' + index + '.message', rule.message) }))
  const steps = list => (list || []).map((step, index) => {
    if (!Array.isArray(step) || step.length !== 2 || !NAME.test(step[0])) fail(path + '.let', 'each step is ["name", "formula"]')
    const compiled = { name: step[0], value: formula(path + '.let.' + step[0], step[1]) }
    known.add(step[0])
    return compiled
  })
  const before = steps(row.let)
  // What is known before the player chooses: an outcome reading only these is decided as the dice land.
  const preChoice = new Set([...known, ...FORMULA_FUNCTIONS].filter(name => name !== 'outcome'))
  const choices = (row.choices || []).map(choice => compileChoice(path + '.choices.' + choice.id, choice.id, plain(path + '.choices', choice), sets, true))
  for (const choice of choices) known.add(choice.id)
  const after = steps(row.then)
  const outcomes = (row.outcomes || []).map((outcome, index) => {
    const when = outcome.when === undefined ? null : formula(path + '.outcomes.' + outcome.id + '.when', outcome.when)
    if (outcome.show !== undefined && !CHECK_SHOWS.includes(outcome.show)) fail(path + '.outcomes.' + outcome.id + '.show', 'must be one of ' + CHECK_SHOWS.join(', '))
    return { id: text(path + '.outcomes.' + index + '.id', outcome.id), label: text(path + '.outcomes.' + index + '.label', outcome.label), when,
      early: !when || [...formulaNames(when)].every(name => preChoice.has(name)), ...(outcome.show ? { show: outcome.show } : {}) }
  })
  if (outcomes.length && outcomes.at(-1).when !== null) fail(path + '.outcomes', 'the last outcome is the default and has no when')
  const effects = (row.effects || []).map((effect, index) => {
    const at = path + '.effects.' + index
    plain(at, effect)
    const resource = resources[effect.resource] || fail(at + '.resource', 'names no resource')
    if (resource.keys && effect.key === undefined && effect.each === undefined) fail(at, resource.id + ' is keyed: give key or each')
    return { resource: resource.id, key: effect.key === undefined ? null : formula(at + '.key', effect.key), each: effect.each === undefined ? null : formula(at + '.each', effect.each),
      add: formula(at + '.add', effect.add), when: effect.when === undefined ? null : formula(at + '.when', effect.when), strict: effect.strict === true }
  })
  const report = (row.report || []).map((entry, index) => ({ id: text(path + '.report.' + index + '.id', entry.id), label: text(path + '.report.' + index + '.label', entry.label),
    value: formula(path + '.report.' + entry.id, entry.value), when: entry.when === undefined ? null : formula(path + '.report.' + entry.id + '.when', entry.when) }))
  const check = { id, path, label: text(path + '.label', row.label), title: text(path + '.title', row.title, true), summary: text(path + '.summary', row.summary, true),
    params, dice, require, before, choices, after, outcomes, effects, report }
  // Every name a formula reads must be declared; a typo is the author's to fix, found at load, not mid-game.
  const names = new Set([...known, 'key', ...FORMULA_FUNCTIONS])
  const walk = (at, tree) => { for (const name of formulaNames(tree)) if (!names.has(name)) fail(at, 'reads unknown name ' + name) }
  for (const step of [...before, ...after]) walk(path + '.let.' + step.name, step.value)
  for (const rule of require) walk(path + '.require', rule.when)
  for (const choice of [...Object.values(params), ...choices]) for (const tree of [choice.when, choice.min, choice.max, choice.default].filter(Boolean)) walk(choice.path, tree)
  for (const effect of effects) for (const tree of [effect.key, effect.each, effect.add, effect.when].filter(Boolean)) walk(path + '.effects', tree)
  for (const tree of [...outcomes.map(row => row.when), ...report.flatMap(row => [row.value, row.when])].filter(Boolean)) walk(path, tree)
  for (const spec of Object.values(dice)) { walk(path + '.dice', spec.count); walk(path + '.dice', spec.sides) }
  return Object.freeze(check)
}

// A parameter (given by the model when it proposes the check) or a choice (made by the player after the roll):
// int {min,max,default}, options {id: label | {label, ...attributes}}, set (one name of a set), pick (names of a set,
// repeats allowed, min..max of them) or boolean.
function compileChoice(path, id, row, sets, isChoice) {
  if (!NAME.test(id || '')) fail(path, 'needs an id that is a usable name')
  const base = { id, path, label: text(path + '.label', row.label ?? id), hint: text(path + '.hint', row.hint, true), when: row.when === undefined ? null : formula(path + '.when', row.when) }
  if (row.int) return { ...base, kind: 'int', min: formula(path + '.int.min', row.int.min), max: formula(path + '.int.max', row.int.max), default: row.int.default === undefined ? null : formula(path + '.int.default', row.int.default) }
  if (row.options) {
    const options = {}
    for (const [value, option] of Object.entries(plain(path + '.options', row.options))) options[value] = typeof option === 'string' ? { label: option } : { ...plain(path + '.options.' + value, option), label: text(path + '.options.' + value + '.label', option.label) }
    if (!Object.keys(options).length) fail(path + '.options', 'list at least one option')
    if (row.default !== undefined && !Object.hasOwn(options, row.default)) fail(path + '.default', 'is not an option')
    return { ...base, kind: 'options', options, defaultValue: row.default ?? null }
  }
  if (row.set) return { ...base, kind: 'set', set: sets[row.set] ? row.set : fail(path + '.set', 'names no set'), defaultValue: row.default ?? null }
  if (row.pick) return { ...base, kind: 'pick', set: sets[row.pick.set] ? row.pick.set : fail(path + '.pick.set', 'names no set'), min: formula(path + '.pick.min', row.pick.min ?? 0), max: formula(path + '.pick.max', row.pick.max) }
  if (row.type === 'boolean') return { ...base, kind: 'boolean', defaultValue: row.default === true }
  return fail(path, isChoice ? 'a choice is int, options, set, pick or type boolean' : 'a parameter is int, options, set, pick or type boolean')
}

/**
 * The resources a card keeps in its MVU variables (resource.mvu, a path under stat_data), read over `state`. A path
 * the variables don't have yet keeps the state's value; a value of the wrong shape is refused, naming its path.
 */
export function withVariables(rules, state, variables) {
  const next = { resources: { ...state.resources } }
  for (const resource of Object.values(rules.resources)) {
    if (!resource.mvu) continue
    let value = variables
    for (const part of resource.mvu.slice(1).split('/')) value = value && typeof value === 'object' && Object.hasOwn(value, part) ? value[part] : undefined
    if (value === undefined) continue
    const wrong = what => { throw new Error('card variable ' + resource.mvu + ' (' + resource.label + ') ' + what) }
    if (!resource.keys) { next.resources[resource.id] = Number.isInteger(value) ? value : wrong('must be a whole number'); continue }
    if (!value || typeof value !== 'object' || Array.isArray(value)) wrong('must be an object of whole numbers keyed by ' + resource.keySet)
    for (const key of Object.keys(value)) if (!resource.keys.includes(key)) wrong('has ' + key + ', which is not one of ' + resource.keys.join(', '))
    next.resources[resource.id] = Object.fromEntries(resource.keys.map(key => [key, Number.isInteger(value[key] ?? 0) ? value[key] ?? 0 : wrong('/' + key + ' must be a whole number')]))
  }
  return next
}

/** The starting resources the rules declare. */
export function initialState(rules) {
  const resources = {}
  for (const resource of Object.values(rules.resources)) {
    resources[resource.id] = resource.keys ? Object.fromEntries(resource.keys.map(key => [key, resource.initial[key] ?? 0])) : resource.initial
  }
  return { resources }
}

// Seeded dice: mulberry32 over a 32-bit seed, so a recorded seed replays the same faces everywhere.
export function seededDraw(seed) {
  let a = seed >>> 0
  return function draw(sides) {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return 1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * sides)
  }
}

function makeScope(rules, check, state, values, params) {
  return {
    get(name) {
      if (Object.hasOwn(values, name)) return values[name]
      if (Object.hasOwn(state.resources, name)) return state.resources[name]
      if (Object.hasOwn(rules.sets, name)) return rules.sets[name]
      throw new Error(name + ' is not known yet here')
    },
    attr(name, key) {
      const choice = params[name] || check.choices.find(row => row.id === name)
      const option = choice?.kind === 'options' ? choice.options[values[name]] : null
      if (!option || !Object.hasOwn(option, key)) throw new Error(name + '.' + key + ' is not declared')
      return option[key]
    }
  }
}

function boundOf(rules, state, resource, which, key) {
  const tree = resource[which]
  if (!tree) return null
  return evaluate(tree, { get: name => name === 'key' ? key : Object.hasOwn(state.resources, name) ? state.resources[name] : (() => { throw new Error(name + ' is not a resource') })(), attr() { throw new Error('bounds read resources only') } })
}

function readResource(state, resource, key) {
  return resource.keys ? state.resources[resource.id][key] : state.resources[resource.id]
}
function writeResource(state, resource, key, value) {
  if (resource.keys) state.resources[resource.id] = { ...state.resources[resource.id], [key]: value }
  else state.resources[resource.id] = value
}

// Apply one change: check effects clamp into the bounds unless strict; strict (and every GM adjustment) refuses
// to leave them. Returns the row of what changed, or null when nothing moved.
function change(rules, state, resource, key, add, strict, why) {
  if (resource.keys && !resource.keys.includes(key)) throw new Error(resource.label + ' has no entry ' + JSON.stringify(key) + '; entries: ' + resource.keys.join(', '))
  if (typeof add !== 'number' || !Number.isFinite(add)) throw new Error(resource.label + ': the change must be a number')
  const from = readResource(state, resource, key), min = boundOf(rules, state, resource, 'min', key), max = boundOf(rules, state, resource, 'max', key)
  let to = from + add
  if (min !== null && to < min) { if (strict) throw new Error(why(resource, key, from, min, max)); to = min }
  if (max !== null && to > max) { if (strict) throw new Error(why(resource, key, from, min, max)); to = max }
  if (to === from) return null
  writeResource(state, resource, key, to)
  return { resource: resource.id, ...(resource.keys ? { key } : {}), label: resource.label, from, to,
    ...(resource.mvu ? { path: resource.mvu + (resource.keys ? '/' + key : '') } : {}) }
}
const outOfBounds = (resource, key, from, min, max) => resource.label + (key ? '·' + key : '') + ' is ' + from + ' and must stay within ' + (min ?? '−∞') + '..' + (max ?? '∞')

function readParam(param, given, scope) {
  const value = given
  const where = param.label + ' (' + param.id + ')'
  switch (param.kind) {
    case 'int': {
      const min = evaluate(param.min, scope), max = evaluate(param.max, scope)
      const chosen = value === undefined ? (param.default ? evaluate(param.default, scope) : undefined) : value
      if (!Number.isInteger(chosen) || chosen < min || chosen > max) throw new Error(where + ' must be a whole number from ' + min + ' to ' + max)
      return chosen
    }
    case 'options': {
      const chosen = value ?? param.defaultValue
      if (!Object.hasOwn(param.options, chosen ?? '')) throw new Error(where + ' must be one of: ' + Object.entries(param.options).map(([id, option]) => id + ' (' + option.label + ')').join(', '))
      return chosen
    }
    case 'set': {
      const chosen = value ?? param.defaultValue, names = scope.get(param.set)
      if (!names.includes(chosen)) throw new Error(where + ' must be one of: ' + names.join(', '))
      return chosen
    }
    case 'pick': {
      const chosen = value ?? [], names = scope.get(param.set), min = evaluate(param.min, scope), max = evaluate(param.max, scope)
      if (!Array.isArray(chosen) || chosen.length < min || chosen.length > max || chosen.some(name => !names.includes(name))) throw new Error(where + ' must list ' + (min === max ? min : min + ' to ' + max) + ' of: ' + names.join(', '))
      return [...chosen]
    }
    case 'boolean': {
      const chosen = value ?? param.defaultValue
      if (typeof chosen !== 'boolean') throw new Error(where + ' must be true or false')
      return chosen
    }
  }
}

// The open choices of a rolled check, as the player sees them: an int choice whose range has one value is no choice.
function openChoices(check, scope) {
  const open = []
  for (const choice of check.choices) {
    if (choice.when && !evaluate(choice.when, scope)) continue
    if (choice.kind === 'int') {
      const min = evaluate(choice.min, scope), max = evaluate(choice.max, scope)
      if (min === max) continue
      open.push({ id: choice.id, label: choice.label, ...(choice.hint ? { hint: choice.hint } : {}), kind: 'int', min, max, default: choice.default ? evaluate(choice.default, scope) : min })
    } else if (choice.kind === 'options') open.push({ id: choice.id, label: choice.label, ...(choice.hint ? { hint: choice.hint } : {}), kind: 'options', options: Object.fromEntries(Object.entries(choice.options).map(([id, option]) => [id, option.label])), default: choice.defaultValue ?? Object.keys(choice.options)[0] })
    else if (choice.kind === 'set') open.push({ id: choice.id, label: choice.label, kind: 'set', options: scope.get(choice.set), default: choice.defaultValue ?? scope.get(choice.set)[0] })
    else if (choice.kind === 'pick') open.push({ id: choice.id, label: choice.label, ...(choice.hint ? { hint: choice.hint } : {}), kind: 'pick', options: scope.get(choice.set), min: evaluate(choice.min, scope), max: evaluate(choice.max, scope) })
    else open.push({ id: choice.id, label: choice.label, kind: 'boolean', default: choice.defaultValue })
  }
  return open
}

// Roll and the steps before the player's choice. Deterministic in (rules, state, check, params, seed).
function prepare(rules, state, request, seed) {
  const check = rules.checks[request.check]
  if (!check) throw new Error('check must be one of: ' + Object.entries(rules.checks).map(([id, row]) => id + ' (' + row.label + ')').join(', '))
  const values = {}, scope = makeScope(rules, check, state, values, check.params)
  const given = request.params || {}
  for (const name of Object.keys(given)) if (!check.params[name]) throw new Error(check.label + ' takes no parameter ' + name + '; parameters: ' + (Object.keys(check.params).join(', ') || 'none'))
  for (const param of Object.values(check.params)) values[param.id] = readParam(param, given[param.id], scope)
  const draw = seededDraw(seed), dice = {}, faces = {}
  for (const [name, spec] of Object.entries(check.dice)) {
    const count = evaluate(spec.count, scope), sides = evaluate(spec.sides, scope)
    if (!Number.isInteger(count) || count < 0 || count > 100 || !Number.isInteger(sides) || sides < 2 || sides > 1000) throw new Error(check.label + ': dice ' + name + ' must be 0-100 dice of 2-1000 sides')
    dice[name] = Array.from({ length: count }, () => draw(sides))
    faces[name] = { sides, ...(spec.mark ? { mark: spec.mark } : {}), ...(spec.markColor ? { markColor: spec.markColor } : {}) }
    values[name] = dice[name]
  }
  for (const step of check.before) values[step.name] = evaluate(step.value, scope)
  // A requirement reads the steps before the choice; failing it refuses the check, so nothing is recorded.
  for (const rule of check.require) if (!evaluate(rule.when, scope)) throw new Error(rule.message)
  return { check, values, scope, dice, faces, params: Object.fromEntries(Object.keys(check.params).map(name => [name, values[name]])) }
}

// The steps after the choice: outcome, effects, report. Returns the record's settled part and the next state.
function finish(rules, state, prepared, choice) {
  const { check, values, scope } = prepared
  const open = openChoices(check, scope)
  for (const name of Object.keys(choice)) if (!open.some(row => row.id === name)) throw new Error('nothing to choose for ' + name + (open.length ? '; open choices: ' + open.map(row => row.id).join(', ') : '; this check has no open choice'))
  for (const row of check.choices) {
    const listed = open.find(item => item.id === row.id)
    values[row.id] = listed ? readParam(row, choice[row.id] ?? (row.kind === 'pick' ? undefined : listed.default), scope) : row.kind === 'int' ? (row.when && !evaluate(row.when, scope) ? 0 : evaluate(row.min, scope)) : row.kind === 'pick' ? [] : row.kind === 'boolean' ? false : null
  }
  for (const step of check.after) values[step.name] = evaluate(step.value, scope)
  const outcome = check.outcomes.find(row => row.when === null || evaluate(row.when, scope))
  values.outcome = outcome ? outcome.id : null
  const next = { resources: { ...state.resources } }, changes = []
  for (const effect of check.effects) {
    if (effect.when && !evaluate(effect.when, scope)) continue
    const resource = rules.resources[effect.resource]
    const keys = effect.each ? evaluate(effect.each, scope) : [effect.key ? evaluate(effect.key, scope) : null]
    for (const key of keys) {
      // `key` names the entry being changed, so an each-effect can read it (e.g. refill to qaMax[key]).
      values.key = key
      const row = change(rules, next, resource, key, evaluate(effect.add, makeScope(rules, check, next, values, check.params)), effect.strict, outOfBounds)
      if (row) changes.push(row)
    }
  }
  const report = {}
  for (const row of check.report) if (!row.when || evaluate(row.when, scope)) report[row.id] = { label: row.label, value: evaluate(row.value, scope) }
  return { outcome: outcome ? { id: outcome.id, label: outcome.label } : null, show: showOf(outcome), report, changes: mergeChanges(changes), state: next, chosen: Object.fromEntries(check.choices.filter(row => open.some(item => item.id === row.id)).map(row => [row.id, values[row.id]])) }
}

// One row per resource entry: from its first value to its last.
function mergeChanges(changes) {
  const rows = new Map()
  for (const row of changes) {
    const id = row.resource + '\u0000' + (row.key ?? '')
    rows.set(id, rows.has(id) ? { ...rows.get(id), to: row.to } : row)
  }
  return [...rows.values()].filter(row => row.from !== row.to)
}

// The performance a record carries: the effect its outcome asks for and the words it shows (the outcome's label).
function showOf(outcome) { return outcome?.show ? { show: { effect: outcome.show, label: outcome.label } } : {} }

// The outcome already fixed before the player's choice: the first one that holds, if every outcome up to it reads only
// what is known as the dice land (outcomes[].early); else null.
function decidedOutcome(check, scope) {
  for (const row of check.outcomes) {
    if (!row.early) return null
    if (row.when === null || evaluate(row.when, scope)) return row
  }
  return null
}

function titleOf(check, params) {
  return check.title ? check.title.replace(/\{(\w+)\}/g, (all, name) => Object.hasOwn(params, name) ? String(params[name]) : all) : check.label
}

/**
 * Roll a check. With no open choice it settles at once; otherwise the record waits for the player (status
 * 'awaiting', state unchanged) and lists each choice with what each value of a one-number choice would do.
 */
export function rollCheck(rules, state, request, seed) {
  const prepared = prepare(rules, state, request, seed)
  const head = { check: prepared.check.id, label: prepared.check.label, title: titleOf(prepared.check, prepared.params), params: prepared.params, seed, dice: prepared.dice, faces: prepared.faces }
  const open = openChoices(prepared.check, prepared.scope)
  if (!open.length) {
    const done = finish(rules, state, prepared, {})
    return { ...head, status: 'settled', outcome: done.outcome, ...done.show, report: done.report, changes: done.changes, state: done.state }
  }
  // An outcome decided as the dice land (Triangle Agency's triscendence, before its bonus is chosen) performs now.
  const decided = showOf(decidedOutcome(prepared.check, prepared.scope))
  for (const choice of open) {
    if (choice.kind !== 'int' || choice.max - choice.min > 12) continue
    choice.preview = []
    for (let value = choice.min; value <= choice.max; value++) {
      const done = finish(rules, state, prepare(rules, state, request, seed), { [choice.id]: value })
      choice.preview.push({ value, outcome: done.outcome?.label ?? null, changes: done.changes.map(row => ({ resource: row.resource, label: row.label + (row.key ? '·' + row.key : ''), add: row.to - row.from })) })
    }
  }
  return { ...head, status: 'awaiting', ...decided, choices: open, state }
}

/** Settle an awaiting record with the player's choice. The roll is replayed from the record's own seed. */
export function settleCheck(rules, state, record, choice = {}) {
  if (record.status !== 'awaiting') throw new Error('check ' + (record.id || '') + ' is already settled')
  const prepared = prepare(rules, state, { check: record.check, params: record.params }, record.seed)
  const done = finish(rules, state, prepared, choice || {})
  return { check: record.check, label: record.label, title: record.title, params: record.params, seed: record.seed, dice: record.dice, faces: prepared.faces, status: 'settled', choice: done.chosen,
    outcome: done.outcome, ...done.show, report: done.report, changes: done.changes, state: done.state }
}

/** A game-master change to resources the rules mark gm: true (e.g. spending the pool, awarding points). */
export function adjustResources(rules, state, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('changes must list at least one {resource, key?, add}')
  const next = { resources: { ...state.resources } }, rows = []
  for (const row of changes) {
    const resource = rules.resources[row?.resource]
    if (!resource) throw new Error('resource must be one of: ' + Object.values(rules.resources).filter(item => item.gm).map(item => item.id + ' (' + item.label + ')').join(', '))
    if (!resource.gm) throw new Error(resource.label + ' changes only through checks')
    const moved = change(rules, next, resource, resource.keys ? row.key : null, row.add, true, outOfBounds)
    if (moved) rows.push(moved)
  }
  return { status: 'adjusted', changes: mergeChanges(rows), state: next }
}

/** The resources as labelled rows, for the model's status read and the player's sheet. */
export function describeState(rules, state) {
  return Object.values(rules.resources).filter(resource => !resource.hidden).map(resource => ({ resource: resource.id, label: resource.label,
    value: state.resources[resource.id], ...(resource.gm ? { gm: true } : {}), ...(resource.note ? { note: resource.note } : {}) }))
}

/** The checks the rules declare, for the model: id, label, summary and parameters. */
export function describeChecks(rules) {
  return Object.values(rules.checks).map(check => ({ check: check.id, label: check.label, ...(check.summary ? { summary: check.summary } : {}),
    params: Object.fromEntries(Object.values(check.params).map(param => [param.id, param.kind === 'set' ? { label: param.label, oneOf: rules.sets[param.set] }
      : param.kind === 'options' ? { label: param.label, oneOf: Object.fromEntries(Object.entries(param.options).map(([id, option]) => [id, option.label])) }
      : param.kind === 'boolean' ? { label: param.label, boolean: true, ...(param.hint ? { hint: param.hint } : {}) } : { label: param.label, kind: param.kind, ...(param.hint ? { hint: param.hint } : {}) }])) }))
}
