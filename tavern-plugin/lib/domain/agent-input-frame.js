function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}

function requiredText(value, label) {
  const text = str(value).trim()
  if (text === '') throw new Error(label + '不能为空')
  return text
}

function revision(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Frame basedOnRevision 无效')
  return number
}

function joined(items) {
  return items.map(function (item) { return str(item && item.text).trim() }).filter(Boolean).join('\n\n')
}

function inputSource(input) {
  const source = input && input.source
  return source !== null && typeof source === 'object' && !Array.isArray(source) ? clone(source) : {}
}

const FOREGROUND_SLOTS = Object.freeze({
  'foreground.card-context': 'cardContext',
  'foreground.active-worldbook': 'activeWorldbook',
  'foreground.current-state': 'currentStateProjection',
  'foreground.script-reference': 'scriptReference',
  'foreground.guide': 'guide',
  'foreground.writing-rules': 'writingRules'
})

function collectForegroundInputs(inputs) {
  const result = {
    userInput: null,
    contributions: [],
    context: Object.fromEntries(Object.values(FOREGROUND_SLOTS).map(function (slot) { return [slot, []] })),
    ignored: [],
    diagnostics: []
  }
  for (const [index, raw] of (Array.isArray(inputs) ? inputs : []).entries()) {
    const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const kind = str(input.kind)
    if (kind === 'foreground.user-input') {
      result.userInput = {
        sourceText: str(input.sourceText),
        projectedText: str(input.projectedText),
        source: inputSource(input)
      }
      continue
    }
    const slot = FOREGROUND_SLOTS[kind]
    if (slot !== undefined) {
      const text = str(input.text).trim()
      if (text === '') continue
      const contribution = {
        kind,
        slot,
        text,
        required: input.required === true,
        source: inputSource(input)
      }
      result.context[slot].push(contribution)
      result.contributions.push(contribution)
      continue
    }
    const ignored = {
      index,
      kind: kind || 'unknown',
      source: inputSource(input),
      reason: str(input.reason) || 'unsupported-foreground-input'
    }
    result.ignored.push(ignored)
    result.diagnostics.push({ code: 'FOREGROUND_FRAME_INPUT_IGNORED', severity: 'warning', input: ignored })
  }
  return result
}

export function createForegroundFrameBuilder() {
  function build(input = {}) {
    const chatId = requiredText(input.chatId, 'Frame chatId')
    const branchId = requiredText(input.branchId, 'Frame branchId')
    const operationId = requiredText(input.operationId, 'Frame operationId')
    const turn = Math.max(0, Number(input.turn) || 0)
    if (!turn) throw new Error('ForegroundFrame turn 无效')
    const basedOnRevision = revision(input.basedOnRevision)
    const collected = collectForegroundInputs(input.inputs)
    if (collected.userInput === null) throw new Error('ForegroundFrame 缺少玩家输入')
    const context = {}
    for (const [slot, values] of Object.entries(collected.context)) context[slot] = joined(values)
    const frame = {
      frameId: 'foreground:' + chatId + ':' + branchId + ':' + operationId,
      kind: 'foreground',
      chatId,
      branchId,
      basedOnRevision,
      operationId,
      turn,
      userInput: clone(collected.userInput),
      context,
      contributions: clone(collected.contributions),
      source: clone(input.source && typeof input.source === 'object' ? input.source : {}),
      diagnostics: clone(collected.diagnostics),
      ignored: clone(collected.ignored)
    }
    return deepFreeze(frame)
  }

  return Object.freeze({ build })
}

export function createBackgroundTaskFrame(input = {}) {
  const chatId = requiredText(input.chatId, 'Frame chatId')
  const branchId = requiredText(input.branchId, 'Frame branchId')
  const taskType = requiredText(input.taskType, 'BackgroundTaskFrame taskType')
  const trigger = requiredText(input.trigger, 'BackgroundTaskFrame trigger')
  const basedOnRevision = revision(input.basedOnRevision)
  return deepFreeze({
    frameId: requiredText(input.frameId, 'Frame frameId'),
    kind: 'background-task',
    chatId,
    branchId,
    basedOnRevision,
    taskType,
    trigger,
    foregroundOutput: str(input.foregroundOutput),
    authoritativeState: clone(input.authoritativeState || {}),
    taskRules: clone(input.taskRules || {}),
    outputContract: clone(input.outputContract || {}),
    source: clone(input.source || {})
  })
}

export function foregroundFrameText(frame) {
  return (Array.isArray(frame && frame.contributions) ? frame.contributions : [])
    .map(function (item) { return str(item && item.text).trim() })
    .filter(Boolean)
    .join('\n\n')
}
