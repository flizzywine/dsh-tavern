// Some gateways echo the entire request inside their validation error. This
// boundary keeps that payload out of turn/end and the visible conversation.
export function presentModelError(error) {
  const message = String(error?.message ?? error ?? '')
  const status = message.match(/^\s*(?:HTTP\s*)?([45]\d\d)\b/i)?.[1]
  const prefix = status ? `模型接口错误（HTTP ${status}）：` : '模型接口错误：'
  let summary
  if (/message content cannot be empty/i.test(message)) summary = prefix + '消息内容不能为空。请重试；若仍失败，请导出诊断信息。'
  else if (/validation error/i.test(message) && /\bvalue\b|\bmessages\b|\binput\b/.test(message)) summary = prefix + '请求参数校验失败。请检查模型接口配置，或导出诊断信息。'
  else if (message.length > 1000) summary = prefix + '接口返回了过长的错误信息，已省略其附带内容。请检查模型接口配置。'
  if (!summary) return error
  // Do not keep cause: hosts may serialize it together with the public error.
  const result = new Error(summary)
  if (status) result.status = Number(status)
  return result
}
