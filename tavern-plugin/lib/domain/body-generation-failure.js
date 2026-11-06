// Public failure boundary: never copy cause, response bodies, requests or arbitrary metadata.
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value) ? value : ''
const categories = [
  ['content-filter', /CONTENT_FILTER|SAFETY|MODERATION|BLOCKED|审核|拦截/i, '正文生成被服务商审核拦截，请调整内容后再试'],
  ['context-overflow', /CONTEXT[_-](OVERFLOW|LENGTH|LIMIT)|上下文.*(超|容量)/i, '正文生成超过模型上下文容量，请减少上下文'],
  ['output-limit', /MAX_TOKENS|OUTPUT.*(LIMIT|LENGTH)|输出.*(长度|上限)/i, '正文生成达到输出长度限制，请调整输出额度'],
  ['reasoning-only', /REASONING_ONLY|THINKING_ONLY|只有思考|仅.*思考/i, '模型只返回了思考，没有生成正文'],
  ['empty-response', /EMPTY|空响应|正文非空/i, '模型没有返回正文'],
  ['timeout', /TIMEOUT|TIMEDOUT|超时/i, '插件正文生成超时，请检查服务连接和超时设置'],
  ['network', /NETWORK|FETCH|ECONN|ENOTFOUND|网络|连接失败/i, '正文生成网络请求失败，请检查服务连接'],
  ['preset', /PRESET|预设/i, '正文生成预设处理失败，请检查预设配置'],
]
function summary(value) {
  return String(value || '').slice(0, 4000)
    .replace(/https?:\/\/[^\s）)]+/gi, '（地址已隐藏）')
    .replace(/(?:Bearer\s+|sk-)[a-zA-Z0-9._-]+/gi, '（凭据已隐藏）')
    .replace(/(?:api[_-]?key|token|authorization|password|secret)\s*[=:：]\s*[^\s,;，；]+/gi, '（凭据已隐藏）')
    .split(/\r?\n|\{\s*"|\[\s*\{|(?:response|request|prompt|剧情|思考内容)\s*[:：]/i)[0].trim().slice(0, 500)
}
export function bodyGenerationFailure(cause, stage = 'generate') {
  const source = cause?.failure && typeof cause.failure === 'object' ? cause.failure : cause
  const code = identifier(source?.code) || 'TAVERN_PLUGIN_BODY_GENERATION_FAILED'
  const raw = typeof source === 'string' ? source : source?.message
  const details = {}
  if (Number.isInteger(source?.details?.httpStatus) && source.details.httpStatus >= 100 && source.details.httpStatus <= 599) details.httpStatus = source.details.httpStatus
  for (const key of ['providerCode', 'finishReason', 'blockReason']) {
    const value = identifier(source?.details?.[key])
    if (value) details[key] = value
  }
  const category = [code, raw, ...Object.values(details)].map(value => categories.find(([, pattern]) => pattern.test(String(value || '')))).find(Boolean)
  return { code, stage: identifier(source?.stage) || stage,
    message: summary(raw) || category?.[2] || '插件正文生成失败，请检查生成设置',
    ...(category ? { category: category[0] } : {}), details }
}
export function bodyGenerationError(cause, stage) {
  const failure = bodyGenerationFailure(cause, stage)
  return Object.assign(new Error(failure.message), { code: 'TAVERN_PLUGIN_BODY_GENERATION_FAILED', failure })
}
