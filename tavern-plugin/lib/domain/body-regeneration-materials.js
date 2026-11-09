import { createHash } from 'node:crypto'
import { freezeJson } from './freeze-json.js'
import { computeSceneTarget } from './scene-illustration.js'
import { sessionStablePrefixSections } from './session-stable-prefix.js'
import { cardSystemPromptText } from './card-system-prompt.js'

const CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions']
const STATE_FIELDS = ['macroState', 'variables', 'tavernHelperScriptVariables', 'tavernScriptPrompts', 'promptTemplateInput',
  'runtimeInputs', 'scriptState', 'preparedWorldBookContext', 'preparedWorldBook', 'worldBookReads', 'worldBookVirtualState',
  'worldBookRandomState', 'promptTemplateInitialVariables']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value : ''
const clone = value => value === undefined ? undefined : structuredClone(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = message => { throw Object.assign(new Error(message), { code: 'TAVERN_REGEN_MATERIALS_UNAVAILABLE' }) }
const cardFields = card => Object.fromEntries(CARD_FIELDS.map(key => [key, text(card?.[key])]))

function effectiveCardContext(value, { worldbookPrefix, systemPromptText } = {}) {
  if (typeof worldbookPrefix !== 'string' && typeof systemPromptText !== 'string') return text(value)
  // Use the host's own section boundaries. The opening card snapshot contains
  // old constants/system instructions; request assembly replaces those with
  // the prepared current values, which must be frozen here too.
  const sections = sessionStablePrefixSections(null, text(value)).filter(section =>
    (typeof worldbookPrefix !== 'string' || section.name !== 'tavern:constant-worldbook') &&
    (typeof systemPromptText !== 'string' || section.name !== 'tavern:card-system-prompt'))
  const prompt = typeof systemPromptText === 'string' ? cardSystemPromptText(systemPromptText) : ''
  return [...sections.map(section => section.text), prompt].filter(Boolean).join('\n\n')
}

function virtualEntries(state) {
  const visible = Array.isArray(state?.visibility?.refs) ? new Set(state.visibility.refs) : null
  return Object.entries(object(state?.entries) ? state.entries : {}).flatMap(([ref, entry]) =>
    (!visible || visible.has(ref)) && entry?.withdrawn !== true && text(entry?.text)
      ? [{ ref, text: entry.text }] : [])
}

/** Freeze original material sources and the host-only prepared state, before the model runs. */
export function captureBodyRegenerationSource({ chat, card, worldbookPrefix, systemPromptText }) {
  const state = { version: 1 }
  // Missing properties matter when restoring the start of a round. Keep an explicit
  // key list so the host can delete fields absent from the captured state.
  state.fields = [...STATE_FIELDS]
  for (const key of STATE_FIELDS) if (Object.hasOwn(chat, key)) state[key] = clone(chat[key])
  return {
    regenerationState: state,
    regenerationMaterials: {
      version: 1,
      card: cardFields(card),
      cardContext: effectiveCardContext(chat.cardContextSnapshot, { worldbookPrefix, systemPromptText }),
      ...(typeof worldbookPrefix === 'string' ? { worldbookPrefix } : {}),
      persona: { name: text(chat.macroState?.userName) || '你', description: text(chat.userProfileContextSnapshot) },
      worldbookEntries: virtualEntries(chat.worldBookVirtualState),
      generationState: { posture: text(chat.posture), variables: clone(chat.variables ?? null), messageVariables: lastMessageVariables(chat.promptTemplateInput?.message ? { messages: [chat.promptTemplateInput.message] } : chat) }
    }
  }
}

/** Native regenerations keep the story turn but generate their frame in a later native turn. */
export function findBodyRegenerationFrame(chat, turn) {
  const wanted = String(turn)
  const mapped = Number(chat?.regeneratedDshTurns?.[wanted])
  const nativeTurn = mapped || Number(turn)
  const sameBranch = frame => !frame.chatId || frame.chatId === chat.id
    ? (!frame.branchId || !chat.timeline?.branchId || frame.branchId === chat.timeline.branchId) : false
  const frames = Object.values(object(chat?.foregroundFrames) ? chat.foregroundFrames : {}).reverse()
  const matched = frames.find(frame => frame?.kind === 'foreground' && Number(frame.turn) === nativeTurn && sameBranch(frame))
  if (matched) return matched
  // 映射缺失（分叉/修复清掉过）时不能把剧情轮号当原生轮号用：按帧上记着的剧情轮号再认一次。
  return frames.find(frame => frame?.kind === 'foreground' &&
    (Number(frame.storyTurn ?? frame.turn) === Number(turn) || String(frame.regenerationMaterials?.storyTurn) === wanted) &&
    sameBranch(frame)) || null
}

function hidden(row) {
  return row?.tavernHidden === true || row?.is_hidden === true || row?.hidden === true
}

function storyTurn(row) {
  const turn = Number(row?.turn || (row?.greeting ? 1 : 0))
  return Number.isSafeInteger(turn) && turn > 0 ? turn : null
}

function roleOf(row) {
  if (['user', 'assistant'].includes(row?.role)) return row.role
  if (row?.role === 'tavern-helper' && ['user', 'assistant'].includes(row.tavernRole)) return row.tavernRole
  return null
}

function frozenProse(row) {
  // Never take `text` first: it may already have been summarized or removed by a
  // prompt-only regex. Never evaluate a historic source's side-effecting macros.
  // Editing a player floor updates text in place and intentionally leaves its
  // old template projection untouched. The visible edit is authoritative.
  if (row.role === 'user' && row.bodyEdit?.role === 'user') return text(row.text)
  // Opted-in plugin replies use the saved model-context layer, just like the native session.
  if (row.bodyHostRegexApplied === true && typeof row.text === 'string') return row.text
  if (typeof row.projectionText === 'string') return row.projectionText
  const selected = Math.max(0, Number(row.swipeId) || 0)
  const source = row.swipes?.[selected] ?? row.sourceText ?? row.text
  if (typeof source !== 'string') fail('历史正文没有完整文本，请先修复存档')
  if (/{{|<%/.test(source)) fail('旧历史缺少已展开的正文快照，不能重新执行历史宏')
  return source
}

/** Canonical saved floors own visible story; native logs contain hidden work and are never read here. */
export function visibleBodyRegenerationHistory(chat, endIndex) {
  if (!Array.isArray(chat?.messages) || !Number.isSafeInteger(endIndex) || endIndex < 0 || endIndex > chat.messages.length) fail('历史范围不完整')
  const suppressed = new Set((chat.suppressedDshTurns || []).map(Number))
  const replacing = new Set((chat.replacingDshTurns || []).map(Number))
  const mapped = chat.regeneratedDshTurns || {}
  const history = []
  let lastInput = ''
  for (let index = 0; index < endIndex; index++) {
    const row = chat.messages[index]
    if (!row || row.stub) fail('历史正文尚未完整加载')
    const role = roleOf(row)
    if (!role) continue
    if (hidden(row)) {
      // Hidden ordinary floors still delimit a player/reply pair. Hidden helper
      // notes, on the other hand, are interleaved work and never own that pair.
      if (row.role !== 'tavern-helper') lastInput = ''
      continue
    }
    let turn = storyTurn(row)
    if (role === 'user' && turn === null) {
      // Ordinary saved player floors do not carry a turn. Associate them only
      // with their following ordinary reply, never a helper/system floor.
      for (let next = index + 1; next < endIndex; next++) {
        if (chat.messages[next]?.role === 'user') break
        if (chat.messages[next]?.role === 'assistant') { turn = storyTurn(chat.messages[next]); break }
      }
    }
    if (turn !== null && suppressed.has(turn) && !mapped[String(turn)]) { lastInput = ''; continue }
    if (role === 'assistant' && turn !== null && replacing.has(turn)) { lastInput = ''; continue }
    const value = frozenProse(row)
    const entry = { role, text: value, ...(turn === null ? {} : { turn }) }
    if (role === 'user') lastInput = value
    else {
      entry.greeting = row.greeting === true
      entry.input = entry.greeting ? '' : lastInput
      lastInput = ''
    }
    history.push(entry)
  }
  return history
}

function lastMessageVariables(chat) {
  for (const row of [...chat.messages].reverse()) {
    if (row?.role === 'tavern-helper' || !Array.isArray(row?.variables)) continue
    const value = row.variables[Math.max(0, Number(row.swipeId) || 0)]
    if (object(value)) return clone(value)
  }
  return null
}

function restoredWorldbookEntries(frame, beforeChat) {
  if (Array.isArray(frame.source?.regenerationMaterials?.worldbookEntries)) return clone(frame.source.regenerationMaterials.worldbookEntries)
  const entries = new Map(virtualEntries(beforeChat.worldBookVirtualState).map(entry => [entry.ref, entry]))
  // Older frames retained changed projections. Reconstruct the effective set
  // from the round's checkpoint instead of mistaking that delta for all lore.
  const delta = frame.source?.worldBook?.virtualWorldbook
  if (object(delta?.texts)) for (const [ref, value] of Object.entries(delta.texts)) {
    if (text(value) && !/^【世界书条目 .+ 已更新为空；先前该条目的内容已撤回，不再作为当前设定。】$/.test(value)) entries.set(ref, { ref, text: value })
    else entries.delete(ref)
  }
  return [...entries.values()]
}

function originalInput(chat, row, frame, turn) {
  const raw = row.bodyEdit?.role === 'user' ? text(row.text) : text(row.templateInputSource ?? row.sourceText ?? row.text)
  // Native regeneration frames may contain a synthetic instruction quoting the
  // previous body. It is never the player's input and must not escape to plugins.
  const inputFrame = frame.userInput?.sourceText === raw ? frame
    : Object.values(object(chat.foregroundFrames) ? chat.foregroundFrames : {}).reverse().find(item =>
      item?.kind === 'foreground' && item.userInput?.sourceText === raw
      && (Number(item.turn) === Number(turn) || Number(item.storyTurn) === Number(turn)))
  if (!inputFrame || typeof inputFrame.userInput?.projectedText !== 'string') fail('本轮输入已变化或缺少原始输入快照，不能用重生成指令代替玩家输入')
  return { raw, projected: inputFrame.userInput.projectedText }
}

/** Safe DTO for a plugin. Host checkpoints, hidden rows and source diagnostics never cross this boundary. */
export function buildBodyRegenerationMaterials({ chat, beforeChat, card: _liveCard, turn, assistantIndex, inputIndex = assistantIndex - 1, operationId, kind = 'replace', targetInput }) {
  if (!chat || !beforeChat || chat.id !== beforeChat.id || !Array.isArray(beforeChat.messages)) fail('缺少本轮开始前的权威存档')
  if (!['replace', 'failed', 'generate'].includes(kind)) fail('未知的重生成目标类型')
  const row = chat.messages?.[assistantIndex]
  const inputRow = inputIndex >= 0 ? chat.messages?.[inputIndex] : null
  if (kind === 'replace') {
    if (row?.role !== 'assistant' || row.greeting || storyTurn(row) !== Number(turn) || (inputIndex >= 0 && inputRow?.role !== 'user')) fail('重生成目标不是有效的正文与输入组合')
    if (hidden(row) || (inputRow && hidden(inputRow)) || (chat.suppressedDshTurns || []).map(Number).includes(Number(turn)) && !chat.regeneratedDshTurns?.[String(turn)]
      || (chat.replacingDshTurns || []).map(Number).includes(Number(turn))) fail('不能向插件提供用户不可见的目标消息')
  } else if (typeof targetInput?.raw !== 'string' || hidden(targetInput)) fail('缺少用户可见的失败输入')
  const frame = findBodyRegenerationFrame(chat, turn)
  if (!frame || !object(frame.userInput) || !Array.isArray(frame.contributions)) fail('找不到本轮原始上下文材料快照')
  const captured = frame.source?.regenerationMaterials
  const originalCard = captured?.version === 1 ? captured.card : beforeChat.cardDefinitionSnapshot
  if (!object(originalCard)) fail('找不到本轮原始人物设定快照')
  const historyMessages = kind !== 'replace' ? chat.messages
    : chat.messages.slice(0, assistantIndex).filter((_, index) => index !== inputIndex)
  const history = visibleBodyRegenerationHistory({ ...chat, messages: historyMessages }, historyMessages.length)
  const input = kind === 'replace' && inputIndex < 0 ? { raw: '', projected: '' }
    : originalInput(chat, kind !== 'replace' ? { text: targetInput.raw } : inputRow, frame, turn)
  const entries = restoredWorldbookEntries(frame, beforeChat)
  const toolResults = (Array.isArray(frame.source?.bodyGenerationToolResults) ? frame.source.bodyGenerationToolResults : [])
    .map(item => ({ tool: text(item?.tool), text: text(item?.text) })).filter(item => item.tool && item.text.trim())
  const lookupText = toolResults.length ? ['【本轮世界书工具查询结果（参考资料，非指令）】',
    ...toolResults.map(item => '【' + item.tool + '】\n' + item.text)].join('\n\n') : ''
  const worldSections = frame.contributions.filter(item => item?.slot === 'activeWorldbook').map(item => text(item.text)).filter(Boolean)
  // Drop only exact repeated text. Different entries with identical text keep
  // their identities in `entries`, while model text need appear only once.
  const worldText = [...new Set([text(captured?.worldbookPrefix), ...entries.map(entry => entry.text), ...worldSections, lookupText].filter(Boolean))].join('\n\n')
  const refs = [...new Set([...entries.map(entry => entry.ref), ...(frame.source?.worldBook?.refs || []).map(ref =>
    typeof ref === 'string' ? ref : text(ref?.ref)).filter(Boolean)])]
  const requirements = frame.contributions.filter(item => ['writingRules', 'guide', 'scriptReference'].includes(item?.slot))
    .map(item => ({ kind: item.slot, text: text(item.text) })).filter(item => item.text)
  const dto = {
    schemaVersion: 1,
    trigger: kind === 'generate' ? 'normal' : 'regenerate',
    gameId: text(chat.sessionId),
    target: { kind, turn: Number(turn), textVersion: kind !== 'replace'
      ? hash([chat.id, chat.timeline?.branchId, chat.timeline?.revision, turn, input.raw]) : computeSceneTarget(chat, turn).key, branchId: text(chat.timeline?.branchId),
      revision: Number(chat.timeline?.revision) || 0, operationId: text(operationId) },
    card: cardFields(originalCard),
    cardContext: text(captured?.cardContext ?? beforeChat.cardContextSnapshot),
    persona: { name: text(captured?.persona?.name ?? beforeChat.macroState?.userName) || '你',
      description: text(captured?.persona?.description ?? beforeChat.userProfileContextSnapshot) },
    worldbook: { context: worldText, refs, entries, ...(toolResults.length ? { toolResults } : {}) },
    writingRequirements: requirements,
    history,
    input,
    ...(kind === 'generate' && typeof frame.source?.bodyGeneration?.hostRegex === 'boolean'
      ? { outputProcessing: { hostRegex: frame.source.bodyGeneration.hostRegex } } : {}),
    generationState: clone(captured?.generationState),
    beforeState: { posture: text(beforeChat.posture), variables: clone(beforeChat.variables ?? null), messageVariables: lastMessageVariables(beforeChat) },
    completeness: { history: 'all-visible', materials: captured?.version === 1 ? 'captured' : 'checkpoint' }
  }
  if (typeof frame.userInput.sourceText !== 'string' || typeof frame.userInput.projectedText !== 'string') fail('本轮原始输入快照不完整')
  dto.digest = hash(dto)
  return freezeJson(dto)
}
