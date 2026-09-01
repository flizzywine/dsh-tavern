export const POSTURE_SUBMIT_TOOL_NAME = 'posture_submit'

export const POSTURE_SUBMIT_TOOL = Object.freeze({
  name: POSTURE_SUBMIT_TOOL_NAME,
  description: '提交本轮结束时正文中可见的主要人物姿势、站位、衣着与持物状态。只写正文已经发生的状态，不解释原因。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      posture: { type: 'string', minLength: 1, description: '本轮结束时可见的人物状态摘要。' }
    },
    required: ['posture']
  })
})

export function normalizePostureSubmission(value) {
  const posture = typeof value?.posture === 'string' ? value.posture.trim() : ''
  if (posture === '') throw new Error('posture_submit 缺少非空 posture')
  return Object.freeze({ posture })
}
