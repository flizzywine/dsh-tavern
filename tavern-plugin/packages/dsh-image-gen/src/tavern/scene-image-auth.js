// Only documented read-only routes are used. Never probe a generation endpoint.
// xAI: https://api.x.ai/api-docs/openapi.json (/v1/api-key)
// OpenAI: https://platform.openai.com/docs/api-reference/models/list
// Gemini: https://ai.google.dev/api/models#method:-models.list
export function sceneImageAuthProbe(provider, baseURL, canListModels) {
  if (provider === 'grok' && baseURL === 'https://api.x.ai/v1') return { path: '/api-key', kind: 'xai-key', trusted: true }
  if (!canListModels) return null
  const trusted = provider === 'openai' && baseURL === 'https://api.openai.com/v1'
    || provider === 'gemini' && baseURL === 'https://generativelanguage.googleapis.com/v1beta'
  return { path: '/models', kind: provider === 'gemini' ? 'gemini-models' : 'models', trusted }
}

export async function verifySceneImageKey({ probe, baseURL, headers, fetchImpl, signal, readJson }) {
  const url = baseURL + probe.path
  let httpStatus
  const unknown = message => ({ status: 'reachable', apiKeyStatus: 'unverified', httpStatus, probePath: probe.path, message })
  let response
  try {
    response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal })
    httpStatus = response.status
    if ([401, 403].includes(httpStatus) || httpStatus === 400 && (probe.kind === 'xai-key' || probe.trusted && probe.kind === 'gemini-models')) {
      return { status: 'auth_failed', apiKeyStatus: 'rejected', httpStatus, probePath: probe.path, message: '连接成功，但 Key 验证请求被拒绝。请检查 API Key、访问权限或服务地址。' }
    }
    if (!response.ok) return unknown('连接成功，但服务暂时无法完成 Key 验证。可展开连接诊断查看状态。')
    const payload = await readJson(response)
    if (probe.kind === 'xai-key') {
      const flags = ['api_key_disabled', 'api_key_blocked', 'team_blocked']
      if (flags.some(field => payload?.[field] === true)) return {
        status: 'auth_failed', apiKeyStatus: 'rejected', httpStatus, probePath: probe.path,
        message: '连接成功，但 API Key 已被禁用、封锁，或所属团队被封锁。'
      }
      if (!flags.every(field => payload?.[field] === false)) return unknown('连接成功，但 Key 状态返回不完整，无法确认有效性。')
    } else {
      const models = probe.kind === 'gemini-models' ? payload?.models : payload?.data
      if (!Array.isArray(models) || !models.every(item => typeof (probe.kind === 'gemini-models' ? item?.name : item?.id) === 'string')) {
        return unknown('连接成功，但验证接口没有返回有效模型列表，无法确认 Key 有效性。')
      }
    }
    if (!probe.trusted) {
      // A public gateway catalog cannot establish credential validity. Require
      // that the same route explicitly refuses an anonymous read as a control.
      const control = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', signal })
      try {
        if (![401, 403].includes(control.status)) return unknown('连接成功，但此中转的只读接口未明确要求鉴权，无法确认 API Key 有效性。')
      } finally { await control.body?.cancel().catch(() => {}) }
    }
    return { status: 'connected', apiKeyStatus: 'verified', httpStatus, probePath: probe.path,
      message: '连接成功，API Key 验证通过。未进行生图，不保证余额或图片模型权限。' }
  } catch (error) {
    if (signal.aborted || !response) throw error
    return unknown('连接成功，但验证响应无法读取，未确认 API Key 有效性。')
  } finally { await response?.body?.cancel().catch(() => {}) }
}
