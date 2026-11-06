import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { producerSource } from './message-source.js'

// Story prose is the one thing a turn contributes to the transcript: the model's
// reply and the player's own input. Replayed as plain text they read as "this was
// already written"; replaying them as the submission tool's own arguments keeps
// the same characters and tokens while the model treats them as structured
// parameters instead of prose in the narration channel.
// Measured on Gemini 4: the identical body is refused as assistant text and
// accepted as tool arguments, so this projection is a containment measure, not a
// cosmetic one. The identifier is derived from the message id so repeated
// requests produce byte-identical history and keep provider caches warm.
//
// The id must also survive transport: OpenAI-compatible gateways cap call ids at
// 40 characters and many only pass `[A-Za-z0-9_-]`, silently turning anything else
// into an unmatched call or a 400. `tvh_` plus 32 hex digits is 36 characters of
// that alphabet, so the pair stays legal on every backend this plugin talks to.
export const HISTORY_CALL_PREFIX = 'tvh_'
export const HISTORY_RECEIPT_TEXT = '已收到。'
// Gemini accepts a function call only right after a user turn or a function response.
// A history made only of bodies (an imported save opens on the greeting) would start
// on a call; this fixed turn goes in front of such a call and nowhere else.
export const HISTORY_ANCHOR_TEXT = '（以下是此前已经发生的剧情。）'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/**
 * Story prose worth replaying: a model reply, or the player's own message.
 *
 * Plugin injections (world book, rules, frames, snapshots) are instructions, not
 * story, and keep their native shape. So does anything carrying reasoning, an
 * image or an existing tool call: only a message that is nothing but visible text
 * can become arguments without loss.
 */
function isProse(message) {
  if (message === null || typeof message !== 'object') return false
  const source = message.source
  if (source === null || typeof source !== 'object') return false
  const author = message.role === 'assistant' ? 'model' : message.role === 'user' ? 'user' : ''
  if (author === '' || source.kind !== author) return false
  return isTextOnly(message)
}

function isTextOnly(message) {
  const content = message.content
  if (!Array.isArray(content) || content.length === 0) return false
  return content.every(function (block) {
    return block !== null && typeof block === 'object' && block.type === 'text' && str(block.text).trim() !== ''
  })
}

function callIdOf(message, text) {
  const identity = str(message.id) !== '' ? str(message.id) : text
  return HISTORY_CALL_PREFIX + createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/**
 * Replay every past body as a submission call with a matching receipt.
 *
 * @param messages - provider-bound messages for this request.
 * @param options - `toolName` names the submission tool; `receipt` overrides the
 *   tool output text; `preserve(message, index)` opts a message out (the input of
 *   the turn being requested must stay the prompt). All optional, but without a
 *   tool name nothing changes.
 *   `layout` selects which messages qualify (see `storyHistoryLayout`): the
 *   default replays model replies and player messages, and leaves instructions
 *   (plugin, world book, rules) in their native shape.
 * @returns the same array when no body qualifies, otherwise a new array.
 */
export function projectHistoryAsToolCalls(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages
  const toolName = str(options.toolName)
  if (toolName === '') return messages
  const receiptText = str(options.receipt) || HISTORY_RECEIPT_TEXT
  const preserve = typeof options.preserve === 'function' ? options.preserve : null
  const layout = historyLayoutOf(options.layout)
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index] && messages[index].role === 'user') { lastUserIndex = index; break }
  }
  let changed = false
  const projected = []
  messages.forEach(function (message, index) {
    const input = index === lastUserIndex
    // Without `input` the newest player message stays the prompt this request is
    // answering; converting it leaves a transcript whose last word is a receipt.
    if ((input && !layout.input) || !qualifies(message, layout) || (preserve !== null && preserve(message, index))) {
      projected.push(message)
      return
    }
    const text = message.content.map(function (block) { return str(block.text) }).join('')
    const callId = callIdOf(message, text)
    const role = layout.text ? 'user' : 'assistant'
    // A tool call is emitted by the assistant, so a replayed player message is
    // carried under that role while keeping its id (and therefore its call id).
    projected.push({
      ...message,
      role,
      content: layout.text
        ? [{ type: 'text', text: JSON.stringify({ content: text }) }]
        : [{ type: 'tool-call', id: callId, name: toolName, arguments: JSON.stringify({ content: text }) }]
    })
    // The receipt is what makes the pair legal for providers that require every
    // call to be answered; it carries no body so the text appears exactly once.
    // DSH 0.2 (session v4) sends tool results as first-class tool messages.
    if (layout.text) { changed = true; return }
    projected.push({
      id: callId + ':receipt',
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text: layout.echo ? text : receiptText }],
      isError: false
    })
    changed = true
  })
  return changed ? anchorCalls(projected) : messages
}

function isCall(message) {
  return message && message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(block => block && block.type === 'tool-call')
}

/** Put the anchor turn before every call whose previous turn is neither a user turn nor a tool result. */
function anchorCalls(messages) {
  const anchored = []
  let previous = null
  for (const message of messages) {
    if (isCall(message) && !(previous && (previous.role === 'user' || previous.role === 'tool'))) {
      const call = message.content.find(block => block && block.type === 'tool-call')
      anchored.push({ id: str(call.id) + ':anchor', role: 'user', source: producerSource('dsh-tavern'), content: [{ type: 'text', text: HISTORY_ANCHOR_TEXT }] })
    }
    anchored.push(message)
    if (message && message.role !== 'system') previous = message
  }
  return anchored
}

/**
 * Which past messages a layout replays as submission arguments.
 *
 * `story` — model replies and player messages (the shipped behaviour).
 * `bodies` — model replies only; player messages stay user turns, so the
 *   transcript keeps a question/answer alternation.
 * `all` — every text-only message except the system prompt and the input,
 *   instructions included.
 * `everything` — `all` plus the input itself; the transcript ends on a receipt.
 * `echo` — `story`, but the receipt repeats the body instead of acknowledging it.
 * `json` — `story`, but emitted as user text holding the same JSON. Control arm
 *   for "is it the tool channel or just JSON-looking text".
 */
export function historyLayoutOf(value) {
  const name = str(value).trim()
  return {
    name: name === '' ? 'story' : name,
    bodies: name === 'bodies',
    all: name === 'all' || name === 'everything',
    input: name === 'everything',
    echo: name === 'echo',
    text: name === 'json'
  }
}

/** The experiment switch: a plain word in a file, so one restart covers every arm. */
export function readHistoryLayoutFile(file) {
  if (str(file) === '') return 'story'
  try {
    return historyLayoutOf(readFileSync(file, 'utf8')).name
  } catch {
    return 'story'
  }
}

function qualifies(message, layout) {
  if (isProse(message)) {
    // A player message is prose by author; `bodies` keeps it a user turn.
    if (layout.bodies && message.role === 'user') return false
    return true
  }
  if (!layout.all || message === null || typeof message !== 'object') return false
  if (message.role !== 'user' && message.role !== 'assistant') return false
  const source = message.source
  if (source === null || typeof source !== 'object') return false
  return isTextOnly(message)
}
