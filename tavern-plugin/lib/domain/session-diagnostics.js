import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseSessionLog } from './session-log-codec.js'
import { findSessionDirectory } from './session-log-repair.js'

// A player who hits a session log the upgrader refuses can send its structure without the
// story: text, reasoning, tool arguments, prompts and paths become their length; event types,
// seqs, turn/step, surface operations, references, ids, roles and sources stay, because those
// are what a migration validates. The redacted log runs through the upgrader as is.
const TEXT = new Set(['text', 'rendered', 'fixedSystemText', 'newText', 'oldText', 'description', 'system', 'persona',
  'title', 'texts', 'error', 'message', 'path', 'args', 'label', 'disabledWritingSkills'])
const generationName = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

export function redactSessionValue(value, key = '') {
  if (typeof value === 'string') {
    if (key === 'arguments') return JSON.stringify({ redacted: value.length })
    if (key === 'cwd') return '/redacted'
    if (!TEXT.has(key)) return value
    // A long text keeps a short fingerprint, so a replay can tell which rows carry the same
    // body (bin/replay-transcript.mjs). Short ones could be guessed from it and get none.
    return value.length < 64 ? `«${value.length} chars»` : `«${value.length} chars #${createHash('sha256').update(value).digest('hex').slice(0, 8)}»`
  }
  if (Array.isArray(value)) return value.map(item => redactSessionValue(item, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSessionValue(item, name)]))
  return value
}

export function redactSessionLog(parsed) {
  return { header: redactSessionValue(parsed.header), events: parsed.events.map(event => redactSessionValue(event)) }
}

// Every stored generation of each session of one game, redacted. A log that cannot be read
// is reported by its reason instead of failing the whole export.
// The save fields the conversation page's visibility reads, with every text redacted the
// same way as the log: enough to replay what the player saw, none of the story.
export function redactChatStructure(chat) {
  const header = {}
  for (const key of ['mode', 'sessionId', 'suppressedDshTurns', 'regeneratedDshTurns', 'replacingDshTurns', 'hiddenDshErrorTurns', 'regenInProgress', 'nativeCommits'])
    if (chat?.[key] !== undefined) header[key] = structuredClone(chat[key])
  if (chat?.regenRecovery) header.regenRecovery = { temporaryReplacingTurn: chat.regenRecovery.temporaryReplacingTurn ?? null }
  const messages = (Array.isArray(chat?.messages) ? chat.messages : []).map(message => redactSessionValue({
    role: message?.role, turn: message?.turn, greeting: message?.greeting === true, text: String(message?.text ?? ''),
    ...(message?.nativeAnchor ? { nativeAnchor: message.nativeAnchor } : {}), ...(message?.bodyEdit ? { bodyEdit: true } : {}),
  }))
  return { ...header, messages }
}

export async function exportSessionDiagnostics({ sessionsRoot, sessionIds, errorOf = () => undefined, tavernVersion, chat }) {
  const sessions = []
  for (const id of sessionIds) {
    const entry = { id, ...(errorOf(id) ? { upgradeError: errorOf(id) } : {}), generations: [] }
    sessions.push(entry)
    const found = await findSessionDirectory(sessionsRoot, id)
    if (!found.ok) { entry.missing = found.reason; continue }
    for (const name of (await readdir(found.path)).filter(name => generationName.test(name)).sort()) {
      try { entry.generations.push({ file: name, ...redactSessionLog(parseSessionLog(await readFile(path.join(found.path, name)))) }) }
      catch (error) { entry.generations.push({ file: name, unreadable: error.message || String(error) }) }
    }
  }
  return { kind: 'dsh-tavern-session-diagnostics', version: 1, tavernVersion, exportedAt: new Date().toISOString(),
    ...(chat ? { chat: redactChatStructure(chat) } : {}), sessions }
}
