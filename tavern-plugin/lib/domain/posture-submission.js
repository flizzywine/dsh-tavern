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
