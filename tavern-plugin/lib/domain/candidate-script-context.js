import { promptSection } from './prompt-section.js'
import { createHash } from 'node:crypto'
import { isProducerSource } from './message-source.js'

// Prompt prose source: task-specific additions, unchanged in phase 1.
const TASK_PROMPT_PROSE = Object.freeze({
  p001: "This turn's script window matches the full text sent earlier; reuse the text marked 【剧本窗口版本 ",
  p002: "】. ",
  p003: "Use only the script chunks listed this turn; old cursors aren't the current state. If that text was compacted or can't be found, first call tavern_read_script for each position: "
})


// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "【剧本窗口版本 "
})


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
  if (!known) return { turnContext: input.turnContext + '\n' + promptSection('script_version', PROMPT_PROSE.p001 + version + '】'), body: window.text, digest: version }
  const reference = window.heading + '\n' +
    TASK_PROMPT_PROSE.p001 + version + TASK_PROMPT_PROSE.p002 +
    TASK_PROMPT_PROSE.p003 + window.positions.join('、') + '。' + (window.text.startsWith('<script_window>\n') ? '\n</script_window>' : '')
  return { turnContext: input.turnContext.slice(0, -window.text.length) + reference }
}
