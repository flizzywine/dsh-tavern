import { normalizeResourcePath } from '../domain/file-resources.js'
import { validateCardFile } from '../domain/card-validation.js'

/** Validate a saved card on disk and record the outcome in card memory. */
export function createCardValidationCheck({ cardMemory, fileResources }) {
  return async function checkCard(chat, cardPath) {
    const normalized = cardPath ? normalizeResourcePath(cardPath, 'card') : ''
    const result = await validateCardFile({ path: normalized, readText: fileResources.readText })
    try { await cardMemory.recordValidation(chat, normalized, result) }
    catch (error) { console.warn('[Tavern card memory] validation record unavailable:', error.message) }
    return result
  }
}

export const VALIDATION_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    valid: { type: 'boolean', required: true },
    errors: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, message: { type: 'string', required: true } } } },
    warnings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, message: { type: 'string', required: true } } } }
  }
})

/** Save results carry the validation so the Agent needs no separate check step. */
export function validationText(validation) {
  if (!validation) return ''
  const lines = ['格式校验：' + (validation.valid ? '通过' : '未通过，' + validation.errors.length + ' 个错误') + (validation.warnings.length ? '，' + validation.warnings.length + ' 个提醒' : '')]
  for (const item of validation.errors) lines.push('- 错误 ' + item.path + '：' + item.message)
  for (const item of validation.warnings) lines.push('- 提醒 ' + item.path + '：' + item.message)
  return lines.join('\n')
}
