/** Public failures contain bounded metadata, never provider payloads or causes. */
export function generationError(code, message, stage, details = {}) {
  return Object.assign(new Error(message), { code: 'STCONTEXT_' + code, stage, details });
}

const filtered = new Set(['content_filter', 'content_policy_violation', 'safety', 'recitation', 'blocklist',
  'prohibited_content', 'spii', 'image_safety', 'image_prohibited_content']);
const contextCodes = new Set(['context_length_exceeded', 'context_window_exceeded', 'input_too_long', 'prompt_too_long']);
const outputCodes = new Set(['length', 'max_tokens', 'max-tokens']);
const knownReasons = new Set([...filtered, ...outputCodes, 'stop', 'tool_calls', 'tool-calls', 'error', 'aborted',
  'other', 'malformed_function_call', 'unexpected_tool_call', 'no_image', 'image_other', 'image_recitation']);
const knownCodes = new Set([...filtered, ...contextCodes, 'insufficient_quota', 'rate_limit_exceeded',
  'invalid_api_key', 'authentication_error', 'permission_denied', 'invalid_argument', 'invalid_request_error',
  'resource_exhausted', 'unavailable', 'internal', 'pi_ai_error']);
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';

// Only explicit structured signals or short error messages classify a failure.
// Arbitrary provider prose (which can echo credentials/prompts) is not public.
export function modelFailure(value, { status, finishReason, refusal = false, stage = 'response', fallback = 'PROVIDER_ERROR' } = {}) {
  const code = lower(value?.code), type = lower(value?.type ?? value?.status), reason = lower(finishReason);
  status = Number.isInteger(status) ? status : Number.isInteger(value?.status) ? value.status
    : Number.isInteger(value?.code) ? value.code : undefined;
  const raw = typeof value === 'string' ? value : value?.message;
  const explicit = refusal || [reason, code, type].some(v => filtered.has(v) || contextCodes.has(v))
    || outputCodes.has(reason) || ['aborted', 'malformed_function_call', 'unexpected_tool_call'].includes(reason)
    || [code, type].some(v => ['insufficient_quota', 'invalid_api_key', 'authentication_error', 'rate_limit_exceeded'].includes(v));
  const message = !explicit && typeof raw === 'string' && raw.length <= 2048 && !/[\[\]{}]/.test(raw) ? raw : '';
  const details = {};
  if (status >= 100 && status <= 599) details.httpStatus = status;
  if (knownReasons.has(reason)) details.finishReason = finishReason;
  if (knownCodes.has(code)) details.providerCode = value.code;
  if (knownCodes.has(type)) details.providerType = value.type ?? value.status;
  const fail = (name, text) => generationError(name, text + (details.httpStatus ? `（HTTP ${status}）` : ''), stage, details);
  if (filtered.has(reason) || filtered.has(code) || filtered.has(type)
    || /content[_ -]?(?:filter|policy)|safety[_ -]?(?:filter|policy|violation)|内容审核(?:未通过|失败)/i.test(message)) {
    return fail('CONTENT_FILTERED', '服务商因内容审核或输出限制拦截了本次生成，未返回可用正文');
  }
  if (refusal) return fail('MODEL_REFUSAL', '模型明确拒绝了本次请求，未返回可用正文');
  if (contextCodes.has(code) || contextCodes.has(type)
    || /context[_ -](?:length|window)[_ -]exceeded|maximum context length|(?:input|prompt).{0,40}(?:too long|exceeds?.{0,30}(?:token|limit))|上下文.{0,12}(?:超限|超过)/i.test(message)) {
    return fail('CONTEXT_OVERFLOW', '服务商报告请求超过模型上下文容量；请检查上下文上限和输出预留');
  }
  if (outputCodes.has(reason)) return fail('OUTPUT_LIMIT', '模型输出达到长度上限，未采用不完整正文；请增加输出预算');
  if ([code, type].includes('insufficient_quota')) return fail('QUOTA_EXCEEDED', '服务商报告可用额度不足，本次生成失败');
  if (status === 401 || [code, type].some(v => ['invalid_api_key', 'authentication_error'].includes(v))) return fail('AUTH_FAILED', '模型接口认证失败，请检查服务商凭据');
  if (status === 429 || [code, type].includes('rate_limit_exceeded')) return fail('RATE_LIMITED', '模型接口请求受限，请稍后重试或检查服务商额度');
  if ([408, 504].includes(status) || value?.name === 'TimeoutError' || /^(?:ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT)$/.test(value?.code || value?.cause?.code || '')) return fail('REQUEST_TIMEOUT', '模型请求超时，未取得完整正文');
  if (reason === 'aborted' || value?.name === 'AbortError') return fail('REQUEST_ABORTED', '模型请求被中止，未取得完整正文');
  if (reason === 'malformed_function_call' || reason === 'unexpected_tool_call') return fail('TOOL_PROTOCOL', '服务商报告工具调用格式异常，未返回可用正文');
  if (status >= 500) return fail('PROVIDER_UNAVAILABLE', '模型服务暂时不可用，请稍后重试');
  if (status >= 400) return fail('REQUEST_REJECTED', '模型请求被服务商拒绝，未获得可识别的具体原因');
  if (/^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET)$/.test(value?.code || value?.cause?.code || '') || /fetch failed|network error/i.test(message)) return fail('NETWORK_ERROR', '模型请求连接失败或连接中断，未取得完整正文');
  return fail(fallback, fallback === 'NETWORK_ERROR' ? '模型请求连接失败，未取得完整正文'
    : '模型生成失败，服务商未提供可识别的具体原因');
}

export function outputStage(stage, label, callback) {
  try { return callback(); }
  catch (error) {
    if (error?.code?.startsWith?.('STCONTEXT_')) throw error;
    // Preset errors already have script diagnostics; retain them with their stage.
    throw generationError('OUTPUT_PROCESSING', label + '失败：' + String(error?.message || error).slice(0, 500), stage);
  }
}
