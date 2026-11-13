import { randomInt } from 'node:crypto'
import { compileRules, describeChecks, describeState, initialState, rollCheck, settleCheck, withVariables } from './check-engine.js'

// The card's check rules sit in its data under extensions["dsh.dice"].rules (README.md). A game reads them from the
// card it plays with (frozen at its opening), so a game's records always replay against the same rules.
export const CHECK_RULES_KEY = 'dsh.dice'

export const CHECK_TOOL = {
  name: 'tavern_check',
  description: "Rule check for cards that declare check rules: the engine rolls with a recorded seed and settles every number and resource; never roll, count or do arithmetic yourself. action=status: this card's checks and current resources. action=roll: propose one declared check when the player's character attempts what the card's rules roll for. If the result is awaiting, show the player its choices in plain words and stop; when the player answers, action=settle with the record id and their choice, never choose for them. Changes without dice (spending a pool, awarding points, moving the game on) are not checks: the card's variable rules handle them. Resources the card keeps in its variables are read from them; a change row with a path is that variable's change; the turn's variable settlement is shown the values after it, so the story need not repeat the numbers.",
  parameters: {
    action: { type: 'string', enum: ['status', 'roll', 'settle'], required: true },
    check: { type: 'string', description: 'roll: the check id from status, e.g. roll' },
    params: { type: 'object', additionalProperties: true, description: 'roll: the check\'s parameters from status, e.g. {"quality":"气质","kind":"agency"}' },
    reason: { type: 'string', description: 'roll: one sentence, what the character attempts' },
    stakes: { type: 'string', description: 'roll: what success and failure each change in the story' },
    id: { type: 'string', description: 'settle: the awaiting record id, e.g. #3' },
    choice: { type: 'object', additionalProperties: true, description: 'settle: the player\'s choice by choice id, e.g. {"threes":3}; omit a choice to keep its default' }
  }
}

const compiled = new Map()
function rulesOf(card) {
  const source = card?.extensions?.[CHECK_RULES_KEY]?.rules
  if (!source) return null
  const key = JSON.stringify(source)
  if (!compiled.has(key)) {
    if (compiled.size > 16) compiled.delete(compiled.keys().next().value)
    compiled.set(key, compileRules(source))
  }
  return compiled.get(key)
}

const requireText = (args, field) => {
  if (typeof args[field] !== 'string' || !args[field].trim()) throw new Error(field + ' must be one non-empty sentence')
  return args[field].trim()
}

/**
 * The game's check records on its current branch, oldest first: the latest one carries the resources (state);
 * an awaiting one is the open check. `records` are the parsed result texts of this tool (core reader).
 * `variables` (the game's settled MVU stat_data) hold the resources a card keeps there: they are the truth between
 * turns, while within the running `turn` the latest record already follows from them (variables settle after it).
 * A card updated mid-game may declare resources its earlier records never had: those start at their initial value.
 */
export function checkLedger(rules, records, { variables, turn } = {}) {
  const rows = records.filter(row => row && typeof row === 'object' && row.state)
  const numbered = rows.filter(row => row.id), last = numbered.at(-1), latest = rows.at(-1)
  const state = latest ? { resources: { ...initialState(rules).resources, ...latest.state.resources } } : initialState(rules)
  return { state: variables && !(latest && latest.turn === turn) ? withVariables(rules, state, variables) : state,
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
 * What the reply's variable settlement sees of its checks (tools.js `settlement`): every card variable they changed, with
 * the value after the reply's last check that changed it, to write as is. One line per variable, so the settlement never
 * adds up several rolls, and a settlement run again writes the same values.
 */
export function checkSettlement(results) {
  const values = new Map(), ids = []
  for (const text of results) {
    let record
    try { record = JSON.parse(text) } catch { continue }
    const rows = (Array.isArray(record?.changes) ? record.changes : []).filter(row => typeof row?.path === 'string' && Number.isFinite(row.to))
    if (!rows.length) continue
    ids.push(record.id)
    for (const row of rows) values.set(row.path, row.to)
  }
  if (!values.size) return ''
  return '检定 ' + ids.join('、') + ' 结算后的变量值。用 replace 把每一项写成这个值，放在这一轮其他操作之前；同一变量在检定以外还有变化时（如主持人花掉的资源），再另用 delta 提交。\n'
    + [...values].map(([path, value]) => '/stat_data' + path + ' = ' + value).join('\n')
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
      const reason = requireText(args, 'reason'), stakes = requireText(args, 'stakes')
      return { id, ...rollCheck(rules, ledger.state, { check: requireText(args, 'check'), params: args.params || {} }, seed), reason, stakes }
    }
    case 'settle': {
      if (!ledger.awaiting) throw new Error('no check waits for a choice; roll a new one')
      if (args.id !== ledger.awaiting.id) throw new Error('the awaiting check is ' + ledger.awaiting.id)
      const settled = settleCheck(rules, ledger.state, ledger.awaiting, args.choice || {})
      return { id, of: ledger.awaiting.id, ...settled, reason: ledger.awaiting.reason, stakes: ledger.awaiting.stakes }
    }
  }
  throw new Error('action must be status, roll or settle')
}

// core: the turn readers, authorize/markUsed (this mod on for the card), readCard(chat) (the card this game plays
// with), results(exec) (this tool's earlier result texts on the game's current branch, oldest first) and
// variables(chat) (the game's latest saved MVU stat_data, if any).
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
      if (!rules) throw new Error('This card declares no check rules; use tavern_roll for a plain roll')
      if (!(chat.usedModTools || []).includes(CHECK_TOOL.name)) await markUsed(chat)
      const records = (await results(exec)).map(text => { try { return JSON.parse(text) } catch { return null } })
      return runCheckAction(rules, records, args, randomInt(0, 2 ** 32), { variables: variables(chat), turn })
    }
  }
}
