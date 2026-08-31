import { createBackgroundTaskFrame } from './agent-input-frame.js'
import { variableDiagnosticSummary } from './mvu-diagnostics.js'

export const MVU_SUBMIT_UPDATE_TOOL_NAME = 'mvu_submit_update'

const jsonValueSchema = {
  anyOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'array', items: {} },
    { type: 'object', additionalProperties: true }
  ]
}

const operationSchemas = [
  {
    type: 'object', additionalProperties: false,
    properties: { op: { enum: ['replace', 'insert', 'add'] }, path: { type: 'string' }, value: jsonValueSchema },
    required: ['op', 'path', 'value']
  },
  {
    type: 'object', additionalProperties: false,
    properties: { op: { const: 'delta' }, path: { type: 'string' }, value: { type: 'number' } },
    required: ['op', 'path', 'value']
  },
  {
    type: 'object', additionalProperties: false,
    properties: { op: { const: 'remove' }, path: { type: 'string' } },
    required: ['op', 'path']
  },
  {
    type: 'object', additionalProperties: false,
    properties: { op: { const: 'move' }, from: { type: 'string' }, path: { type: 'string' } },
    required: ['op', 'from', 'path']
  }
]

export const MVU_SUBMIT_UPDATE_TOOL = Object.freeze({
  name: MVU_SUBMIT_UPDATE_TOOL_NAME,
  description: '提交本轮正文确认的变量变化并等待实际执行校验。失败且 retryable 为 true 时根据错误修正完整 operations 后重试，最多提交三次；成功后停止调用。没有变化时提交空数组。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      analysis: {
        type: 'string',
        description: '简短说明为什么需要或不需要更新；不得虚构正文未发生的事实。'
      },
      operations: {
        type: 'array',
        description: '官方 MVU JSON Patch 方言；没有变量变化时必须为空数组。',
        items: { oneOf: operationSchemas }
      }
    },
    required: ['analysis', 'operations']
  })
})

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function pointerSegment(value) {
  return str(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function displayValue(value) {
  if (value === undefined) return '（不存在）'
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return text === undefined ? str(value) : text
}

function diffValues(before, after, path = '', result = []) {
  if (sameValue(before, after) || result.length >= 200) return result
  const beforeObject = before !== null && typeof before === 'object'
  const afterObject = after !== null && typeof after === 'object'
  if (beforeObject && afterObject && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set(Array.isArray(before)
      ? Array.from({ length: Math.max(before.length, after.length) }, function (_value, index) { return String(index) })
      : Object.keys(before).concat(Object.keys(after)))
    for (const key of keys) diffValues(before[key], after[key], path + '/' + pointerSegment(key), result)
    return result
  }
  result.push({
    operation: before === undefined ? 'insert' : (after === undefined ? 'delete' : 'set'),
    path: path || '/',
    before: displayValue(before),
    after: displayValue(after)
  })
  return result
}

function pointerSegments(pointer) {
  return str(pointer).split('/').slice(1).map(function (segment) {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~')
  })
}

function variablesPointer(pointer) {
  const segments = pointerSegments(pointer)
  if (segments[0] === 'stat_data') return '/' + segments.map(pointerSegment).join('/')
  return '/stat_data/' + segments.map(pointerSegment).join('/')
}

function valueAtPointer(value, pointer) {
  let current = value
  for (const segment of pointerSegments(pointer)) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), segment)) {
      return { exists: false, value: undefined }
    }
    current = current[segment]
  }
  return { exists: true, value: current }
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(right + '/') || right.startsWith(left + '/')
}

function operationPointers(operation) {
  if (operation.op === 'move') return [variablesPointer(operation.from), variablesPointer(operation.path)]
  const target = variablesPointer(operation.path)
  if ((operation.op === 'insert' || operation.op === 'add') && target.endsWith('/-')) {
    return [target.slice(0, -2)]
  }
  return [target]
}

function operationNeedsMutation(operation, before) {
  const target = valueAtPointer(before, variablesPointer(operation.path))
  if (operation.op === 'remove') return target.exists
  if (operation.op === 'move') return valueAtPointer(before, variablesPointer(operation.from)).exists
  if (operation.op === 'delta') return operation.value !== 0
  return !target.exists || !sameValue(target.value, operation.value)
}

/** Attribute final state changes to submitted operations and expose silent runtime rejection. */
function auditMvuSettlement(before, after, operations) {
  const allChanges = diffValues(before, after)
  const claimed = new Set()
  const failures = []
  for (const operation of operations) {
    const pointers = operationPointers(operation)
    const matches = []
    for (let index = 0; index < allChanges.length; index++) {
      if (pointers.some(function (pointer) { return pathsOverlap(allChanges[index].path, pointer) })) {
        matches.push(index)
        claimed.add(index)
      }
    }
    if (matches.length === 0 && operationNeedsMutation(operation, before)) {
      failures.push({
        operation: operation.op,
        path: operation.path,
        message: '未观察到对应变量变化；请通过“日志”导出执行记录'
      })
    }
  }
  return {
    changes: allChanges.filter(function (_change, index) { return claimed.has(index) }),
    sideEffects: allChanges.filter(function (_change, index) { return !claimed.has(index) }),
    failures
  }
}

function assertPointer(value, label) {
  const pointer = str(value)
  if (pointer === '' || pointer[0] !== '/') throw new Error(label + ' 必须是 JSON Pointer')
  return pointer
}

function stripTaggedBlock(value, name) {
  return value.replace(new RegExp('<' + name + '\\b[^>]*>[\\s\\S]*?<\\/' + name + '\\s*>', 'gi'), '')
}

function stripHtmlFences(value) {
  return value.replace(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(?:html?|xhtml)(?:[ \t][^\r\n]*)?\r?\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gim, '')
}

/** Extract only confirmed story prose from one final foreground response. */
export function extractMvuStoryText(value) {
  let text = str(value)
  text = stripTaggedBlock(text, 'UpdateVariable')
  text = stripTaggedBlock(text, 'visual_cards')
  text = stripHtmlFences(text)
  text = text.replace(/<StatusPlaceHolderImpl\s*\/?>/gi, '')
  text = text.replace(/<StatusPlaceholder\s*\/?>/gi, '')
  text = text.replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n').trim()
  if (text === '') throw new Error('本轮最终回复剔除控制协议后没有可用于变量结算的剧情正文')
  return text
}

function normalizeOperation(raw, index) {
  const operation = object(raw)
  const op = str(operation.op).trim().toLowerCase()
  const label = '变量操作 #' + (index + 1)
  if (!['replace', 'insert', 'add', 'delta', 'remove', 'move'].includes(op)) throw new Error(label + ' 的 op 不受支持')
  const normalized = { op, path: assertPointer(operation.path, label + ' path') }
  if (op === 'move') {
    normalized.from = assertPointer(operation.from, label + ' from')
    return normalized
  }
  if (op === 'remove') return normalized
  if (!Object.prototype.hasOwnProperty.call(operation, 'value')) throw new Error(label + ' 缺少 value')
  if (op === 'delta' && (typeof operation.value !== 'number' || !Number.isFinite(operation.value))) {
    throw new Error(label + ' 的 delta value 必须是有限数字')
  }
  normalized.value = clone(operation.value)
  return normalized
}

/** Validate and normalize the single tool submission before any runtime effect. */
export function normalizeMvuToolSubmission(value) {
  const input = object(value)
  if (!Array.isArray(input.operations)) throw new Error('mvu_submit_update 缺少 operations 数组')
  return {
    analysis: str(input.analysis).trim(),
    operations: input.operations.map(normalizeOperation)
  }
}

/** Convert a validated tool call into the canonical protocol understood by official MVU. */
export function formatMvuUpdateCommand(value) {
  const submission = normalizeMvuToolSubmission(value)
  return [
    '<UpdateVariable>',
    '<Analyze>',
    submission.analysis,
    '</Analyze>',
    '<JSONPatch>',
    JSON.stringify(submission.operations, null, 2),
    '</JSONPatch>',
    '</UpdateVariable>'
  ].join('\n')
}

export function createMvuBackgroundTaskFrame(input = {}) {
  const currentVariables = clone(object(input.currentVariables))
  const variableSchema = clone(object(input.variableSchema || currentVariables.schema))
  const storyText = extractMvuStoryText(input.storyText)
  const messageId = Number(input.messageId)
  const swipeId = Number(input.swipeId)
  if (!Number.isInteger(messageId) || messageId < 0) throw new Error('变量结算 messageId 无效')
  if (!Number.isInteger(swipeId) || swipeId < 0) throw new Error('变量结算 swipeId 无效')
  return createBackgroundTaskFrame({
    frameId: str(input.operationId),
    chatId: input.chatId,
    branchId: input.branchId,
    basedOnRevision: input.basedOnRevision,
    taskType: 'mvu-variable-settlement',
    trigger: {
      operationId: str(input.operationId),
      messageId,
      swipeId,
      storyDigest: str(input.storyDigest)
    },
    foregroundOutput: { storyText },
    authoritativeState: { currentVariables, variableSchema },
    taskRules: {
      updateRules: Array.isArray(input.updateRules) ? input.updateRules.map(str).filter(Boolean) : [],
      updateOnlyFromStory: true
    },
    outputContract: { tool: MVU_SUBMIT_UPDATE_TOOL_NAME, required: true, singleCommit: true, maxToolCalls: 3 }
  })
}

/** Stable, isolated input for one background provider request. */
export function projectMvuBackgroundRequest(frame) {
  if (!frame || frame.taskType !== 'mvu-variable-settlement') throw new Error('不是 MVU 变量结算 Frame')
  const state = object(frame.authoritativeState)
  const output = object(frame.foregroundOutput)
  const rules = object(frame.taskRules)
  const updateRules = Array.isArray(rules.updateRules) ? rules.updateRules : []
  return {
    messages: [{
      id: frame.frameId + ':story',
      role: 'assistant',
      regexPlacement: 2,
      content: [{ type: 'text', text: str(output.storyText) }],
      source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'mvu-final-story' }
    }],
    turnContext: [
      '【当前变量快照】',
      JSON.stringify(state.currentVariables || {}, null, 2),
      '【变量结构】',
      JSON.stringify(state.variableSchema || {}, null, 2),
      ...(updateRules.length === 0 ? [] : ['【人物卡变量更新规则】', updateRules.join('\n\n')])
    ].join('\n'),
    system: [
      '只根据【正文】中已经确认发生的事实结算变量，不得读取或推断玩家意图。',
      '不得根据旧轮剧情、隐藏思考、候选项或未发生事件更新变量。',
      '必须调用 mvu_submit_update，以工具返回的实际执行校验结果为准。最多提交三次。',
      '有变化时提交完整 operations；没有变化时也必须提交 operations: []。',
      '若 ok=false 且 retryable=true，读取 error、failures 和 runtimeDiagnostics，根据 currentVariables 与变量结构修正完整 operations 后再次调用；不要原样反复提交。',
      'rolledBack=true 表示整批变量修改未保存，可以基于原快照重新提交完整更新；不得用空 operations 掩盖尚未修复的失败。',
      'ok=true 或 retryable=false 后停止调用，不能重复执行已成功的更新，也不能绕过人物卡校验。',
      '工具调用成功后只输出一行姿势 JSON：{"posture":"本轮结束时可见的人物姿势"}。'
    ].join('\n'),
    tools: [MVU_SUBMIT_UPDATE_TOOL]
  }
}

/** Own model/tool/runtime details behind one variable-settlement action. */
export function createMvuSettlementModule(options = {}) {
  if (!options.model || typeof options.model.run !== 'function') throw new Error('MVU Settlement 缺少后台模型 adapter')
  if (!options.runtime || typeof options.runtime.settleMvuUpdate !== 'function') throw new Error('MVU Settlement 缺少官方 Runtime adapter')
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(Number(options.maxAttempts) || 3)))

  async function settleVariables(input = {}) {
    const frame = createMvuBackgroundTaskFrame(input)
    const request = projectMvuBackgroundRequest(frame)
    let attempt = 0
    let result = null
    let feedback = null
    let traceSessionId = str(input.persistentSessionId)
    let traceBoundary = null
    let diagnosticId = frame.frameId + ':attempt-1'
    let toolTail = Promise.resolve()
    let retryNotBefore = 0
    async function record(stage, details = {}) {
      try { await options.diagnostics?.record(input.sessionId, { diagnosticId, operationId: input.operationId, chatId: input.chatId, branchId: input.branchId, basedOnRevision: input.basedOnRevision, messageId: input.messageId, swipeId: input.swipeId, attempt, traceSessionId, stage, ...details }) } catch { /* Diagnostics must not change settlement behaviour. */ }
    }
    async function executeTool(call) {
      // Serialize parallel calls too. Success or an unsafe-to-retry failure is terminal.
      if (feedback && (feedback.ok || !feedback.retryable)) return JSON.stringify(feedback)
      if (attempt >= maxAttempts) return JSON.stringify({ ...feedback, ok: false, retryable: false })
      attempt++
      diagnosticId = frame.frameId + ':attempt-' + attempt
      await record('start', { variables: variableDiagnosticSummary(input.currentVariables) })
      let submission
      try {
        if (!call || call.name !== MVU_SUBMIT_UPDATE_TOOL_NAME) throw new Error('后台 Agent 调用了未授权的变量工具')
        submission = normalizeMvuToolSubmission(call.arguments)
        if (feedback && submission.operations.length === 0) throw new Error('上一批更新未通过校验，请修正完整 operations，不能用空数组跳过失败')
      } catch (error) {
        await record('submission-rejected', { error: error.message, argumentKeys: Object.keys(object(call?.arguments)), operations: object(call?.arguments).operations })
        feedback = { ok: false, retryable: attempt < maxAttempts, rolledBack: true, error: error.message, currentVariables: clone(input.currentVariables), attemptsRemaining: maxAttempts - attempt }
        result = { variables: clone(input.currentVariables), receipt: { version: 1, status: 'error',
          summary: feedback.error, diagnosticId, changes: [], sideEffects: [], failures: [{ message: feedback.error }] } }
        return JSON.stringify(feedback)
      }
      await record('submitted', { operations: submission.operations })
      let applied
      try {
        const waitMs = retryNotBefore - Date.now()
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
        applied = await options.runtime.settleMvuUpdate({
          sessionId: input.sessionId, messageId: input.messageId, swipeId: input.swipeId,
          expectedLifecycleRevision: input.expectedLifecycleRevision, diagnosticId,
          storyText: frame.foregroundOutput.storyText,
          command: formatMvuUpdateCommand(submission),
          validate: ({ before, after }) => auditMvuSettlement(before, after, submission.operations)
        })
      } catch (error) {
        // A timeout or disk error may have an uncertain outcome; do not replay a delta.
        await record('failed', { error: str(error.message || error) })
        feedback = { ok: false, retryable: false, error: str(error.message || error), note: '执行或保存结果无法确认，停止自动重试以避免重复更新。' }
        result = { submission, receipt: { version: 1, status: 'error', summary: feedback.error, diagnosticId, changes: [], sideEffects: [], failures: [{ message: feedback.error }] } }
        return JSON.stringify(feedback)
      }
      if (applied.stale === true) {
        await record('stale')
        feedback = { ok: false, retryable: false, error: '变量结算目标已经变化，迟到结果未写入。' }
        result = { receipt: { version: 1, status: 'stale', summary: feedback.error, changes: [], sideEffects: [], failures: [] } }
        return JSON.stringify(feedback)
      }
      const projected = applied.context?.messages?.[input.messageId]
      const after = clone(projected?.variables || {})
      const audit = applied.validation || auditMvuSettlement(input.currentVariables, after, submission.operations)
      const rolledBack = applied.rejected === true
      retryNotBefore = rolledBack ? Date.now() + Math.max(0, Math.min(3100, Number(applied.retryAfterMs) || 0)) : 0
      const changes = rolledBack ? [] : audit.changes
      const sideEffects = rolledBack ? [] : audit.sideEffects
      const status = audit.failures.length > 0
        ? (changes.length > 0 ? 'partial' : 'error')
        : (changes.length > 0 ? 'updated' : 'unchanged')
      result = {
        variables: after, submission,
        receipt: { version: 1, status, summary: submission.analysis, diagnosticId,
          runtimeDiagnostics: applied.diagnostics || [], changes, sideEffects, failures: audit.failures }
      }
      feedback = {
        ok: audit.failures.length === 0,
        retryable: rolledBack && applied.retryable === true && attempt < maxAttempts,
        rolledBack, status, changes, failures: audit.failures,
        runtimeDiagnostics: applied.diagnostics || [],
        ...(audit.failures.length === 0 ? {} : { error: '变量更新未通过校验；请根据具体错误修正。', currentVariables: after }),
        attemptsRemaining: maxAttempts - attempt
      }
      await record('result', { status, rolledBack, retryable: feedback.retryable, variables: variableDiagnosticSummary(after), changes, sideEffects, failures: audit.failures, runtimeDiagnostics: applied.diagnostics || [] })
      return JSON.stringify(feedback)
    }
    let run = {}
    try {
      run = await options.model.run({
        task: 'settlement', persistent: true, persistentSessionId: traceSessionId, rewindTo: -1,
        selection: input.selection, messages: request.messages, turnContext: request.turnContext,
        system: [str(input.system).trim(), request.system].filter(Boolean).join('\n\n'),
        tools: request.tools, maxToolCalls: maxAttempts,
        toolLimitMessage: '变量更新已达到三次提交上限，停止调用并结束本轮；不得跳过校验。',
        stopToolsWhen: () => feedback !== null && (feedback.ok || !feedback.retryable),
        temperature: 0.1, sessionId: input.sessionId, turn: Math.max(0, Number(input.turn) || 0),
        onToolCall(call) {
          const pending = toolTail.then(() => executeTool(call))
          toolTail = pending.catch(() => {})
          return pending
        }
      })
      traceSessionId = str(run.traceSessionId) || traceSessionId
      traceBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
    } catch (error) {
      traceSessionId = str(error.traceSessionId) || traceSessionId
      await record('model-failed', { error: str(error.message || error) })
      // Never re-run the entire model task after a possible commit.
      if (!result) {
        error.traceSessionId = traceSessionId
        throw error
      }
    }
    await toolTail
    if (!result) {
      const error = new Error(feedback?.error || '后台 Agent 未调用 mvu_submit_update')
      error.traceSessionId = traceSessionId
      error.traceBoundary = traceBoundary
      throw error
    }
    await record('finished', { status: result.receipt.status })
    return { frame, text: str(run.text) || '{}', traceSessionId, traceBoundary, ...result }
  }

  return Object.freeze({ settleVariables })
}
