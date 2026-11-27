import { activateWorldBook, estimateWorldBookTokens, promptOrder } from './worldbook-activation.js'
import { isStaticWorldbookSkillEntry } from './worldbook-entry-classification.js'
import { worldbookEntryTitle } from './worldbook-entry-title.js'
import { promptSection } from './prompt-section.js'
import { toolResultsOf } from './tool-result-message.js'
import { GREP_LOREBOOK_TOOL, READ_LOREBOOK_TOOL, lorebookToolName } from './foreground-tools.js'
import { readLorebookReceipt } from './worldbook-files.js'

const RECENT_STORY_ROUNDS = 10
const TITLE_HINT_TOKEN_BUDGET = 256
const TITLE_HINT_LABEL = '可能用到的世界书条目：'

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

/** Recent successful model-visible lookups. Native turn numbers may have gaps,
 * so count completed story replies, and use their turns only to identify results. */
export function recentWorldbookLookups(session, messages) {
  const paths = new Set(), ids = new Set()
  const lookups = { paths, ids }
  if (!session?.surface?.nodes || typeof session.eventAt !== 'function') return lookups
  const turns = new Set()
  for (let i = (messages?.length || 0) - 1; i >= 0 && turns.size < RECENT_STORY_ROUNDS; i--) {
    const message = messages[i]
    if (message?.role === 'assistant' && Number.isSafeInteger(message.turn)) turns.add(message.turn)
  }
  if (!turns.size) return lookups

  const oldest = Math.min(...turns), results = new Map()
  const nodes = session.surface.nodes
  for (let i = nodes.length - 1; i >= 0; i--) {
    const event = session.eventAt(nodes[i])
    if (!['assistant/message', 'tool/result'].includes(event?.type)) continue
    const { turn, message, error, meta } = event.data || {}
    if (turn < oldest) break
    if (!turns.has(turn)) continue
    if (event.type === 'tool/result' && !error) {
      for (const result of toolResultsOf(message)) {
        if (!result.isError) results.set(turn + ':' + result.toolCallId, { content: result.content, meta })
      }
    }
    if (event.type !== 'assistant/message' || message?.source?.kind !== 'model') continue
    for (const call of message.content || []) {
      if (call?.type !== 'tool-call') continue
      const name = lorebookToolName(call.name)
      if (!['read', GREP_LOREBOOK_TOOL, READ_LOREBOOK_TOOL].includes(name)) continue
      const result = results.get(turn + ':' + call.id)
      if (!result) continue
      const body = result.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
      if (!body.trim()) continue
      if (name === 'read') {
        const file = parseJson(call.arguments)?.file_path
        if (typeof file === 'string' && file) paths.add(file)
      } else if (name === READ_LOREBOOK_TOOL) {
        const receipt = readLorebookReceipt(body, result.meta)
        if (receipt) ids.add(receipt.id)
      } else if (Array.isArray(result.meta?.lorebookGrepIds)) {
        for (const id of result.meta.lorebookGrepIds) if (typeof id === 'string') ids.add(id)
      } else {
        const matches = parseJson(body)?.matches
        if (!Array.isArray(matches)) continue
        for (const match of matches) {
          // The generated heading is line 1. A title by itself carries no lore.
          if (match?.line > 2 && typeof match.path === 'string' && typeof match.text === 'string' && match.text.trim()) paths.add(match.path)
        }
      }
    }
  }
  return lookups
}

/** Advisory only: reuse keyword/history/secondary-key matching without recording
 * reads or restricting the searchable file set. Body token budgets do not apply
 * to titles. Runtime preprocessing has already established visibility. */
export function worldbookTitleHints(input) {
  const entries = (input.worldBook?.view?.entries || []).filter(isStaticWorldbookSkillEntry)
  const recentRefs = new Set(input.recentlyReadRefs)
  const matched = activateWorldBook({ ...input, entries, isCoolingDown: entry => recentRefs.has(entry.ref), ignoreBudget: true })
  return formatWorldbookTitleHints(promptOrder(matched.entries))
}

export function formatWorldbookTitleHints(entries) {
  const seen = new Set()
  const shown = []
  let remaining = TITLE_HINT_TOKEN_BUDGET - estimateWorldBookTokens(promptSection('lorebook_title_hints', TITLE_HINT_LABEL))
  for (const entry of entries) {
    const title = [...worldbookEntryTitle(entry)].slice(0, 80).join('')
    if (seen.has(title)) continue
    const cost = estimateWorldBookTokens((shown.length ? '、' : '') + title)
    if (cost > remaining) continue
    shown.push(title)
    seen.add(title)
    remaining -= cost
    if (remaining === 0) break
  }
  return shown.length ? promptSection('lorebook_title_hints', TITLE_HINT_LABEL + shown.join('、')) : ''
}
