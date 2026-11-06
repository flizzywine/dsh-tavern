import { isUnrecognizedOverflow } from './provider-overflow.js'
/** Explain known compaction failures without exposing nested provider payloads. */
export function compactionFailureMessage(error) {
  const seen = new Set()
  let cause = error
  for (let depth = 0; cause && depth < 12 && !seen.has(cause); depth++) {
    seen.add(cause)
    const message = String(cause.message || cause || '')
    if (/summary is not smaller than the shadowed content/i.test(message)) {
      return '摘要未缩短内容，已保留原始记录。本次未节省上下文，无需立即重复压缩；可继续对话，积累更多内容后再压缩。'
    }
    const idleTimeout = message.match(/stream idle timeout after (\d+)ms/i)
    if (idleTimeout) {
      const milliseconds = Number(idleTimeout[1])
      const duration = milliseconds % 60000 === 0 ? `${milliseconds / 60000} 分钟` : `${milliseconds / 1000} 秒`
      return `压缩超时：连续 ${duration}未收到模型响应。本次压缩未完成，原始聊天记录仍保留。可能是模型长时间思考或渠道无响应；可稍后重试，或换模型发送一条消息后再压缩。技术信息：stream idle timeout after ${idleTimeout[1]}ms。`
    }
    if (cause.code === 'CONTEXT_WINDOW_EXCEEDED' || isUnrecognizedOverflow(cause) || /context (?:window|length).*(?:exceed|overflow)|context overflow|maximum context length|上下文.*超限/i.test(String(cause.message || ''))) {
      return '压缩输入超出模型上下文窗口。请检查模型设置中的真实 contextWindow，或改用更大窗口的摘要模型后重试。'
    }
    if (!cause.cause || seen.has(cause.cause)) break
    cause = cause.cause
  }
  // DSH wraps every manual failure in a generic summary message; the real reason
  // is the innermost cause (issue #148 surfaced only the misleading wrapper).
  const outer = String(error?.message || error || '上下文压缩失败')
  const root = cause && cause !== error ? String(cause.message || cause).replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  return (root && !outer.includes(root) ? outer + '（原因：' + root + '）' : outer).slice(0, 500)
}
