import { createHash } from 'node:crypto'
import { isProducerSource } from './message-source.js'

const digest = text => createHash('sha256').update(text).digest('hex')

// Only replace the newly appended script window, never prior messages or prompts.
export function projectCandidateScriptContext(session, input) {
  const window = input.candidateScriptWindow
  if (input.task !== 'candidate' || typeof window?.text !== 'string' ||
      typeof window.heading !== 'string' || !window.text.startsWith(window.heading + '\n') ||
      !Array.isArray(window.positions) || !window.positions.length ||
      !window.positions.every(n => Number.isSafeInteger(n) && n > 0) ||
      typeof input.turnContext !== 'string' || !input.turnContext.endsWith(window.text) ||
      Buffer.byteLength(window.text, 'utf8') < 1024 ||
      !input.tools?.some(tool => tool.name === 'tavern_read_script')) return null
  const version = digest(window.text)
  let known = false
  try {
    for (const message of session.deriveMessages()) {
      const span = message.source?.candidateScriptWindow
      if (!isProducerSource(message.source, 'dsh-tavern') || span?.version !== 1 || span.digest !== version) continue
      if (message.content?.length !== 1 || message.content[0]?.type !== 'text') continue
      const text = message.content[0].text
      if (typeof text !== 'string' || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) ||
          span.start < 0 || span.length !== window.text.length || span.start + span.length > text.length) continue
      if (text.slice(span.start, span.start + span.length) === window.text) { known = true; break }
    }
  } catch { /* No proven visible body: send the full window. */ }
  if (!known) return { turnContext: input.turnContext + '\n【剧本窗口版本 ' + version + '】', body: window.text, digest: version }
  const reference = window.heading + '\n' +
    '本轮剧本窗口与此前完整正文完全相同，请复用标有【剧本窗口版本 ' + version + '】的全文。' +
    '只使用本轮列出的剧本块；不要把旧游标当作当前状态。若全文已被压缩或无法找到，必须先调用 tavern_read_script，按 position 分别读取：' + window.positions.join('、') + '。'
  return { turnContext: input.turnContext.slice(0, -window.text.length) + reference }
}
