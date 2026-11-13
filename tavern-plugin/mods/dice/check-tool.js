import { randomInt } from 'node:crypto'
import { compileRules, describeChecks, describeState, initialState, rollCheck, settleCheck, withVariables } from './check-engine.js'
import { chooseRulesAction, compileRulesV2, describeActions, describeRulesState, foldRecords, readRulesState, RULES_FORMAT, runRulesAction } from './rules-engine.js'

// A card's rules sit in its data under extensions["dsh.rules"] (format dsh-rules v2, README.md); the older check rules
// (dsh-check-rules v1) under extensions["dsh.dice"].rules are still read. A game reads them from the card it plays with
// (frozen at its opening), so a game's records always replay against the same rules.
export const RULES_KEY = 'dsh.rules'
export const CHECK_RULES_KEY = 'dsh.dice'
// The rulings one reply may make: more is a model going in circles, not a story.
export const RULINGS_PER_REPLY = 16

export const CHECK_TOOL = {
  name: 'tavern_check',
  description: "The rules of a card that declares them: its actions and the variables they own. The engine checks, rolls with a recorded seed and does every sum; never roll, count or do arithmetic yourself, and never restate these numbers for the variables: the host writes them when the reply settles. op=status: the actions available now with their parameters, and the current values. op=act: when the story reaches what an action describes (a roll the player's character attempts, something the rules count happening, the game moving on), submit it with its parameters and one sentence of reason; several acts may go in one step, each sees the ones before it. Write on from the short result: its text and changes, and end the reply where its stop says. A refusal says why and what the story can do instead: write that, do not resubmit the same act. If the result is awaiting, tell the player its choices in plain words and stop; when they answer, op=choose with their choice ({} keeps the defaults), never choose for them. Regenerating a reply rewrites only its text: the rulings of the version it replaces stand and new acts are refused; to redo the rulings the player rolls the round back.",
  parameters: {
    op: { type: 'string', enum: ['status', 'act', 'choose'] },
    action: { type: 'string', description: 'act: the action id from status, e.g. chaos' },
    params: { type: 'object', additionalProperties: true, description: 'act: its parameters from status, e.g. {"effect":"显现"}' },
    reason: { type: 'string', description: 'act: one sentence, what happens in the story' },
    choice: { type: 'object', additionalProperties: true, description: 'choose: the player\'s answer by choice id, e.g. {"threes":2}' },
    id: { type: 'string', description: 'choose: the awaiting record id' },
    check: { type: 'string', description: 'older calls: the check id' },
    stakes: { type: 'string', description: 'older calls: what success and failure change' }
  }
}

const compiled = new Map()
function rulesOf(card) {
  const source = card?.extensions?.[RULES_KEY] ?? card?.extensions?.[CHECK_RULES_KEY]?.rules
  if (!source) return null
  const key = JSON.stringify(source)
  if (!compiled.has(key)) {
    if (compiled.size > 16) compiled.delete(compiled.keys().next().value)
    compiled.set(key, source.format === RULES_FORMAT ? compileRulesV2(source) : compileRules(source))
  }
  return compiled.get(key)
}

/**
 * The card check (tools.js `checkCard`): a card's rules compile when it is checked, so an author sees every error with
 * its path then, not mid-game; and a variable the v2 rules own keeps its range in the rules alone. `limits` are the
 * card's $meta.limits as the core reads them (paths under stat_data, "*" for every entry).
 */
export function checkRulesCard(data, { prefix = '', limits = [] } = {}) {
  const extensions = data?.extensions && typeof data.extensions === 'object' ? data.extensions : {}
  const source = extensions[RULES_KEY] ?? extensions[CHECK_RULES_KEY]?.rules
  if (source === undefined) return []
  const at = prefix + '/extensions/' + (extensions[RULES_KEY] !== undefined ? RULES_KEY : CHECK_RULES_KEY + '/rules')
  let rules
  try { rules = source?.format === RULES_FORMAT ? compileRulesV2(source) : compileRules(source) } catch (error) { return [{ path: at, message: error.message }] }
  if (rules.format !== RULES_FORMAT) return []
  const owned = [...Object.values(rules.state), ...Object.values(rules.derived)]
  const errors = []
  for (const limit of limits) {
    const row = owned.find(item => limit.path === item.path || limit.path.startsWith(item.path + '/'))
    if (row) errors.push({ path: at, message: limit.path + ' 归规则管（' + row.label + '），范围只写在规则里：删掉初值 $meta.limits 里的这一条' })
  }
  return errors
}
const requireText = (args, field) => {
  if (typeof args[field] !== 'string' || !args[field].trim()) throw new Error(field + ' must be one non-empty sentence')
  return args[field].trim()
}

/**
 * The game's check records on its current branch, oldest first: the latest one carries the resources (state);
 * an awaiting one is the open check. `records` are the parsed result texts of this tool (core reader).
 * `variables` ({snapshot, turn}: the game's last settled MVU stat_data and the turn it belongs to) hold the resources a
 * card keeps there: they are the truth up to that turn, while a record of a later turn already follows from them (its
 * values are written when that reply settles).
 * A card updated mid-game may declare resources its earlier records never had: those start at their initial value.
 */
export function checkLedger(rules, records, { variables } = {}) {
  const rows = records.filter(row => row && typeof row === 'object' && row.state)
  const numbered = rows.filter(row => row.id), last = numbered.at(-1), latest = rows.at(-1)
  const state = latest ? { resources: { ...initialState(rules).resources, ...latest.state.resources } } : initialState(rules)
  return { state: variables?.snapshot && !(latest && latest.turn > variables.turn) ? withVariables(rules, state, variables.snapshot) : state,
    awaiting: last?.status === 'awaiting' ? last : null, count: numbered.length }
}

// Each record carries its turn and the resource labels, so the player's card can show the resources after it; `secret`
// lists the resources the rules keep from the player (the model reads them in the record, the card leaves them out).
export function runCheckAction(rules, records, args, seed, context = {}) {
  const record = runAction(rules, records, args, seed, context)
  const secret = Object.values(rules.resources).filter(row => row.secret).map(row => row.id)
  return { ...record, ...(context.turn !== undefined ? { turn: context.turn } : {}), labels: Object.fromEntries(Object.values(rules.resources).filter(row => !row.hidden).map(row => [row.id, row.label])),
    ...(secret.length ? { secret } : {}) }
}
/**
 * What the host writes for the records the reply's variables do not hold yet (tools.js `settlement`): one operation per
 * card variable they changed, with the value after the last record that changed it (a new entry is inserted, a removed
 * one removed). Absolute values, so the settlement never adds up several rulings, and a settlement run again writes the same.
 */
export function checkSettlement(results) {
  const rows = new Map(), ids = []
  for (const text of results) {
    let record
    try { record = JSON.parse(text) } catch { continue }
    const changes = (Array.isArray(record?.changes) ? record.changes : []).filter(row => typeof row?.path === 'string')
    if (!changes.length) continue
    ids.push(record.id)
    for (const row of changes) {
      const first = rows.get(row.path)
      rows.set(row.path, { existed: first ? first.existed : Object.hasOwn(row, 'from'), row })
    }
  }
  if (!rows.size) return null
  return { note: '检定 ' + ids.join('、') + ' 改到的变量。',
    operations: [...rows].map(([path, { existed, row }]) => !Object.hasOwn(row, 'to') ? { op: 'remove', path: '/stat_data' + path }
      : { op: existed ? 'replace' : 'insert', path: '/stat_data' + path, value: row.to }) }
}

function runAction(rules, records, args, seed, context) {
  const ledger = checkLedger(rules, records, context)
  const id = '#' + (ledger.count + 1)
  switch (args.action) {
    case 'status':
      return { status: 'sheet', rules: rules.name, ...(rules.guide ? { guide: rules.guide } : {}), checks: describeChecks(rules), resources: describeState(rules, ledger.state),
        ...(ledger.awaiting ? { awaiting: { id: ledger.awaiting.id, title: ledger.awaiting.title, choices: ledger.awaiting.choices } } : {}), state: ledger.state }
    case 'roll': {
      if (ledger.awaiting) throw new Error('check ' + ledger.awaiting.id + ' still waits for the player\'s choice: settle it first (an empty choice keeps the defaults)')
      const reason = requireText(args, 'reason'), stakes = typeof args.stakes === 'string' && args.stakes.trim() ? args.stakes.trim() : undefined
      return { id, ...rollCheck(rules, ledger.state, { check: requireText(args, 'check'), params: args.params || {} }, seed), reason, ...(stakes ? { stakes } : {}) }
    }
    case 'settle': {
      if (!ledger.awaiting) throw new Error('no check waits for a choice; roll a new one')
      if (args.id !== undefined && args.id !== ledger.awaiting.id) throw new Error('the awaiting check is ' + ledger.awaiting.id)
      const settled = settleCheck(rules, ledger.state, ledger.awaiting, args.choice || {})
      return { id, of: ledger.awaiting.id, ...settled, reason: ledger.awaiting.reason, stakes: ledger.awaiting.stakes }
    }
  }
  throw new Error('op must be status, act or choose')
}

// The call in the current form ({op, action, params, reason, choice}). Calls from before it ({action: status|roll|settle,
// check, ...}) sit in games' histories and the model copies them, so they still mean the same.
function requestOf(args) {
  if (args.op !== undefined) return args
  if (args.action === 'roll') return { ...args, op: 'act', action: args.check }
  if (args.action === 'settle') return { ...args, op: 'choose' }
  if (args.action === 'status') return { ...args, op: 'status' }
  return args
}

/**
 * Run one call on v2 rules. The state is the variables (`variables`: {snapshot, turn}, the last settled ones) with this
 * branch's records of later turns folded on; the open choice is the latest record if it waits. Record ids are
 * "turn-n", so they stay unique after the history is compacted.
 */
export function runRulesCall(rules, records, args, seed, { variables, turn } = {}) {
  const rows = records.filter(row => row && typeof row === 'object' && row.id)
  const settledTurn = Number(variables?.turn) || 0
  const state = foldRecords(rules, readRulesState(rules, variables?.snapshot), rows.filter(row => Number(row.turn) > settledTurn))
  const last = rows.at(-1), awaiting = last?.status === 'awaiting' && last.action ? last : null
  const request = requestOf(args)
  const id = () => {
    const mine = rows.filter(row => Number(row.turn) === Number(turn))
    if (mine.length >= RULINGS_PER_REPLY) throw new Error('this reply has made ' + mine.length + ' rulings already: finish the story text now, more can follow next turn')
    return turn + '-' + (mine.length + 1)
  }
  switch (request.op) {
    case 'status':
      return { status: 'sheet', rules: rules.name, ...(rules.guide ? { guide: rules.guide } : {}), actions: describeActions(rules, state), values: describeRulesState(rules, state),
        ...(awaiting ? { awaiting: { id: awaiting.id, label: awaiting.label, choices: awaiting.choices } } : {}) }
    case 'act': {
      if (awaiting) throw new Error(awaiting.label + ' ' + awaiting.id + ' still waits for the player\'s choice: op=choose first (an empty choice keeps the defaults)')
      const reason = requireText(request, 'reason')
      return { id: id(), turn, ...runRulesAction(rules, state, { action: request.action, params: request.params }, seed), reason }
    }
    case 'choose': {
      if (!awaiting) throw new Error('nothing waits for a choice: submit the action again')
      if (request.id !== undefined && request.id !== awaiting.id) throw new Error('the awaiting record is ' + awaiting.id)
      return { id: id(), of: awaiting.id, turn, ...chooseRulesAction(rules, state, awaiting, request.choice || {}), ...(awaiting.reason ? { reason: awaiting.reason } : {}) }
    }
  }
  throw new Error('op must be status, act or choose')
}

// core: the turn readers, authorize/markUsed (this mod on for the card), readCard(chat) (the card this game plays
// with), results(exec) (this tool's earlier result texts on the game's current branch, oldest first) and
// variables(chat) (the game's last settled MVU stat_data and its turn, {snapshot, turn}).
// The same tool in the reply's variable settlement (lib/mod-tools.js backfill): the background model records an action the
// story shows happening that the reply did not submit. Only acts without dice and without the player's choice: a roll is the
// player's and an open choice waits for them, so neither is made up after the fact.
export const CHECK_BACKFILL = {
  name: CHECK_TOOL.name,
  description: "The card's rules, in backfill mode. The reply's text shows something an action describes happening (the game moving on, a commendation, loose ends, leaving a place) but its tool results above hold no such ruling: submit it with op=act, its parameters and one sentence quoting what the text shows; the host writes what it settles with this reply. Rolls and actions that wait for the player's choice are not backfilled. A refusal means the text and the rules disagree: leave it, the host notes it. op=status lists the actions and current values.",
  // A background tool takes a JSON schema (the foreground one goes through defineTool).
  parameters: { type: 'object', additionalProperties: false, required: ['op'], properties: { op: { type: 'string', enum: ['status', 'act'] },
    action: CHECK_TOOL.parameters.action, params: CHECK_TOOL.parameters.params, reason: CHECK_TOOL.parameters.reason } }
}

export const backfillOffered = card => rulesOf(card)?.format === RULES_FORMAT
// The stat_data paths the rules own (state and derived): only their actions write them, the background's writes are dropped.
export const rulesPaths = card => [...Object.values(rulesOf(card).state), ...Object.values(rulesOf(card).derived)].map(row => '/stat_data' + row.path)

/** One backfill call: `results` are this reply's records so far (its own and earlier backfills), as text. */
export function backfillRulesCall(args, { card, results, variables, turn }) {
  const rules = rulesOf(card)
  const request = requestOf(args)
  if (request.op !== 'status' && request.op !== 'act') throw new Error('backfill takes op=act (or op=status)')
  const action = request.op === 'act' ? rules.actions[request.action] : null
  if (action && Object.keys(action.dice).length) throw new Error(action.label + ' rolls dice: a roll is not backfilled')
  const record = runRulesCall(rules, results.map(text => { try { return JSON.parse(text) } catch { return null } }), args, randomInt(0, 2 ** 32), { variables, turn })
  if (record.status === 'awaiting') throw new Error(record.label + ' waits for the player\'s choice: it is not backfilled')
  return record.status === 'sheet' ? record : { ...record, backfill: true }
}

export const REGENERATING = '这一轮是重写正文：上一版的裁定照旧有效（见上面的工具结果），照它们写。上一版没有的检定或花费，这一轮不要写成已经发生，可以留到下一轮。'

export function createCheckTool({ activeTurnOf, chatForSession, isBackground, authorize = async () => true, markUsed = async () => {}, readCard, results, variables = () => undefined }) {
  return {
    ...CHECK_TOOL,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id
      const turn = activeTurnOf(exec)
      if (!sessionId || !turn || isBackground(sessionId)) throw new Error('tavern_check requires an active foreground story/script turn')
      const chat = await chatForSession(sessionId)
      if (!chat || !['story', 'script'].includes(chat.mode || 'story') || activeTurnOf(exec) !== turn || exec.signal?.aborted) {
        throw new Error('tavern_check requires an active foreground story/script turn')
      }
      if (!await authorize(chat)) throw new Error('Dice mod is disabled for this card')
      const rules = rulesOf(await readCard(chat))
      if (!rules) throw new Error('This card declares no rules; use tavern_roll for a plain roll')
      if (!(chat.usedModTools || []).includes(CHECK_TOOL.name)) await markUsed(chat)
      // Regenerating rewrites only the text (round-history.js): the replaced version's tool results stay on the surface and the
      // rewrite's own leave it, so a ruling made now would be shown and never kept.
      if (chat.regenInProgress === true && requestOf(args).op !== 'status') throw new Error(REGENERATING)
      const records = (await results(exec)).map(text => { try { return JSON.parse(text) } catch { return null } })
      const context = { variables: variables(chat), turn }
      if (rules.format === RULES_FORMAT) return runRulesCall(rules, records, args, randomInt(0, 2 ** 32), context)
      const request = requestOf(args)
      return runCheckAction(rules, records, { ...request, action: { status: 'status', act: 'roll', choose: 'settle' }[request.op] ?? request.action, check: request.op === 'act' ? request.action : request.check }, randomInt(0, 2 ** 32), context)
    }
  }
}
