import { resolveRuntimeMacroText } from './runtime-content-projection.js'

export const POSTURE_SUBMIT_TOOL_NAME = 'posture_submit'

export const POSTURE_SUBMIT_TOOL = Object.freeze({
  name: POSTURE_SUBMIT_TOOL_NAME,
  description: '提交本轮结束时正文中可见的主要人物姿势、站位、衣着与持物状态。只写正文已经发生的状态，不解释原因。失败且 retryable=true 时根据错误修正 posture 后重试；返回 ok=true 后不再重复提交。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      posture: { type: 'string', minLength: 1, description: '本轮结束时可见的人物状态摘要。' }
    },
    required: ['posture']
  })
})

export function normalizePostureSubmission(value, context = {}) {
  const source = typeof value?.posture === 'string' ? value.posture.trim() : ''
  const posture = source === '' ? '' : resolveRuntimeMacroText(source, {
    charName: context.charName,
    macroState: context.macroState
  }).text.trim()
  if (posture === '') throw new Error('posture_submit 缺少非空 posture')
  return Object.freeze({ posture })
}

/** The posture the latest visible posture_submit call wrote, or '' when the history has none. */
export function lastSubmittedPosture(session) {
  const nodes = session?.surface?.nodes || []
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(nodes[index])
    if (event?.type !== 'assistant/message') continue
    const calls = (event.data?.message?.content || []).filter(block => block?.type === 'tool-call' && block.name === POSTURE_SUBMIT_TOOL_NAME)
    for (let at = calls.length - 1; at >= 0; at--) {
      let args = calls[at].arguments
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch { continue } }
      if (typeof args?.posture === 'string' && args.posture.trim() !== '') return args.posture.trim()
    }
  }
  return ''
}
