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

export function createForegroundFrameBuilder(options = {}) {
  const dispatcher = options.dispatcher
  if (!dispatcher || typeof dispatcher.dispatch !== 'function') throw new Error('ForegroundFrameBuilder 缺少 TavernInstructionDispatcher')

  function build(input = {}) {
    const chatId = requiredText(input.chatId, 'Frame chatId')
    const branchId = requiredText(input.branchId, 'Frame branchId')
    const operationId = requiredText(input.operationId, 'Frame operationId')
    const turn = Math.max(0, Number(input.turn) || 0)
    if (!turn) throw new Error('ForegroundFrame turn 无效')
    const basedOnRevision = revision(input.basedOnRevision)
    const dispatched = dispatcher.dispatch(input.instructions)
    if (dispatched.userInput === null) throw new Error('ForegroundFrame 缺少玩家输入指令')
    const context = {}
    for (const [slot, values] of Object.entries(dispatched.context)) context[slot] = joined(values)
    const frame = {
      frameId: 'foreground:' + chatId + ':' + branchId + ':' + operationId,
      kind: 'foreground',
      chatId,
      branchId,
      basedOnRevision,
      operationId,
      turn,
      userInput: clone(dispatched.userInput),
      context,
      contributions: clone(dispatched.contributions),
      source: clone(input.source && typeof input.source === 'object' ? input.source : {}),
      diagnostics: clone(dispatched.diagnostics),
      ignored: clone(dispatched.ignored)
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

