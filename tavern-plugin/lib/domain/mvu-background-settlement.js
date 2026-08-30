import { createBackgroundTaskFrame } from './agent-input-frame.js'

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
  description: '提交本轮正文已经确认发生的全部变量变化。必须且只能调用一次；没有变化时提交空 operations 数组。',
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
        message: '操作执行后未生效，可能被人物卡变量结构校验拒绝'
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
    outputContract: { tool: MVU_SUBMIT_UPDATE_TOOL_NAME, required: true, exactlyOnce: true }
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
      '必须且只能调用一次 mvu_submit_update。',
      '有变化时提交完整 operations；没有变化时也必须提交 operations: []。',
      '工具调用成功后只输出一行姿势 JSON：{"posture":"本轮结束时可见的人物姿势"}。'
    ].join('\n'),
    tools: [MVU_SUBMIT_UPDATE_TOOL]
  }
}

/** Own model/tool/runtime details behind one variable-settlement action. */
export function createMvuSettlementModule(options = {}) {
  if (!options.model || typeof options.model.run !== 'function') throw new Error('MVU Settlement 缺少后台模型 adapter')
  if (!options.runtime || typeof options.runtime.settleMvuUpdate !== 'function') throw new Error('MVU Settlement 缺少官方 Runtime adapter')
  const maxAttempts = Math.max(1, Math.min(2, Number(options.maxAttempts) || 2))

  async function settleVariables(input = {}) {
    const frame = createMvuBackgroundTaskFrame(input)
    const request = projectMvuBackgroundRequest(frame)
    let lastError = null
    let traceSessionId = str(input.persistentSessionId)
    let traceBoundary = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const submissions = []
      let attemptedCalls = 0
      try {
        const run = await options.model.run({
          task: 'settlement',
          persistent: true,
          persistentSessionId: traceSessionId,
          rewindTo: -1,
          selection: input.selection,
          messages: request.messages,
          turnContext: request.turnContext,
          system: [str(input.system).trim(), request.system].filter(Boolean).join('\n\n'),
          tools: request.tools,
          maxToolCalls: 2,
          temperature: 0.1,
          sessionId: input.sessionId,
          turn: Math.max(0, Number(input.turn) || 0),
          async onToolCall(call) {
            attemptedCalls++
            if (!call || call.name !== MVU_SUBMIT_UPDATE_TOOL_NAME) throw new Error('后台 Agent 调用了未授权的变量工具')
            if (submissions.length > 0) throw new Error('mvu_submit_update 每轮只能调用一次')
            const submission = normalizeMvuToolSubmission(call.arguments)
            submissions.push(submission)
            return JSON.stringify({
              received: true,
              operationCount: submission.operations.length,
              note: '仅表示已接收；是否生效将在官方 MVU Runtime 执行后逐项核验'
            })
          }
        })
        traceSessionId = str(run.traceSessionId)
        traceBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
        if (attemptedCalls !== 1 || submissions.length !== 1) {
          throw new Error(attemptedCalls === 0 ? '后台 Agent 未调用 mvu_submit_update' : 'mvu_submit_update 每轮只能调用一次')
        }
        const submission = submissions[0]
        const applied = await options.runtime.settleMvuUpdate({
          sessionId: input.sessionId,
          messageId: input.messageId,
          swipeId: input.swipeId,
          expectedLifecycleRevision: input.expectedLifecycleRevision,
          storyText: frame.foregroundOutput.storyText,
          command: formatMvuUpdateCommand(submission)
        })
        if (applied.stale === true) {
          return {
            frame,
            text: str(run.text),
            traceSessionId,
            traceBoundary,
            receipt: {
              version: 1, status: 'stale', summary: '变量结算目标已经变化，迟到结果未写入。',
              changes: [], sideEffects: [], failures: []
            }
          }
        }
        const projected = applied.context && Array.isArray(applied.context.messages)
          ? applied.context.messages[input.messageId]
          : null
        const after = clone(projected && projected.variables || {})
        const audit = auditMvuSettlement(input.currentVariables, after, submission.operations)
        const status = audit.failures.length > 0
          ? (audit.changes.length > 0 ? 'partial' : 'error')
          : (audit.changes.length > 0 ? 'updated' : 'unchanged')
        return {
          frame,
          text: str(run.text),
          traceSessionId,
          traceBoundary,
          variables: after,
          submission,
          receipt: {
            version: 1,
            status,
            summary: submission.analysis,
            changes: audit.changes,
            sideEffects: audit.sideEffects,
            failures: audit.failures
          }
        }
      } catch (error) {
        if (traceSessionId === '') traceSessionId = str(error && error.traceSessionId)
        lastError = error
      }
    }
    const failure = new Error(str(lastError && lastError.message || lastError) || 'MVU 后台变量结算失败', { cause: lastError })
    failure.traceSessionId = traceSessionId
    failure.traceBoundary = traceBoundary
    throw failure
  }

  return Object.freeze({ settleVariables })
}
