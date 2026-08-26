function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(function (item) { return item && item.type === 'text' ? str(item.text) : '' }).join('')
}

function finishReason(value) {
  if (value === 'stop') return { kind: 'stop' }
  if (value === 'length') return { kind: 'max-tokens' }
  return {
    kind: 'error',
    failure: { code: 'PROVIDER_RESPONSE', message: '非流式模型响应缺少可识别的 finish_reason: ' + str(value || '空') }
  }
}

export function createCompatibilityNonStreamingTransport(options = {}) {
  const request = options.fetch
  const baseURL = str(options.baseURL).replace(/\/$/, '')
  const apiKey = typeof options.apiKey === 'function' ? options.apiKey : function () { return '' }
  if (typeof request !== 'function') throw new TypeError('非流式兼容传输缺少 fetch')
  if (baseURL === '') throw new TypeError('非流式兼容传输缺少 baseURL')

  return async function * stream(modelRequest) {
    const key = str(apiKey()).trim()
    if (key === '') throw new Error('非流式兼容请求缺少 API Key')
    const body = {
      model: str(modelRequest && modelRequest.model),
      messages: (Array.isArray(modelRequest && modelRequest.messages) ? modelRequest.messages : []).map(function (message) {
        return { role: str(message && message.role), content: messageText(message && message.content) }
      }),
      stream: false
    }
    if (Number.isInteger(modelRequest && modelRequest.maxTokens) && modelRequest.maxTokens > 0) {
      body.max_completion_tokens = modelRequest.maxTokens
    }
    const response = await request(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: modelRequest && modelRequest.signal
    })
    let result
    try { result = await response.json() } catch { result = null }
    if (!response.ok) {
      const detail = str(result && result.error && result.error.message) || str(response.statusText) || '未知错误'
      throw new Error('非流式模型请求失败 (' + response.status + '): ' + detail)
    }
    const choice = result && Array.isArray(result.choices) ? result.choices[0] : null
    const text = str(choice && choice.message && choice.message.content)
    if (text === '') throw new Error('非流式模型响应没有正文')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    if (result && result.usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: Number(result.usage.prompt_tokens) || 0,
          outputTokens: Number(result.usage.completion_tokens) || 0
        }
      }
    }
    yield { type: 'finish', reason: finishReason(choice && choice.finish_reason) }
  }
}
