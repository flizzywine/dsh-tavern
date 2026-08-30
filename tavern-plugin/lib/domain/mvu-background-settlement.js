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
