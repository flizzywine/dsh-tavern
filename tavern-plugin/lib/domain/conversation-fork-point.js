import { assistantResultForTurn } from './session-turn-result.js'
import { sessionEvents } from './session-events.js'
import { assertConversationForkable } from './conversation-fork.js'

// How far back from the live head an unanchored snapshot search reads. A save keeps a
// bounded number of revisions for its own history, so this bounds the fallback scan
// instead of letting a fork read every revision a long game ever wrote.
const MAX_HISTORY_SCAN = 64
// A branch that can only take the story rows must not inherit the values of a later
// turn: variables, ledger, MVU state, world-book reads and native context all belong to
// the save this message was cut from. They are dropped, and the branch keeps the card's
// own setup and its text, so it continues from nothing instead of from a made-up state.
const TEXT_ONLY_STATE_KEYS = [
  'variables', 'mvu', 'ledger', 'posture', 'scriptState', 'regenRecovery', 'regenInProgress',
  'replacingDshTurns', 'failedRegenerationTarget', 'candidates', 'candidateAgent', 'foregroundError',
  'preparedWorldBook', 'preparedWorldBookContext', 'lastWorldBookRecall', 'worldBookRandomState',
  'worldBookReads', 'worldBookVirtualState', 'worldBookError', 'lastSettle', 'settleError',
  'nativeCommits', 'nativeSync', 'nativeOpeningAppended', 'runtimeInputs', 'foregroundFrames',
  'suppressedDshTurns', 'regeneratedDshTurns', 'pendingCardChanges', 'cardAutoReload',
  'promptTemplateInitialVariables', 'messageDeletion', 'importedSave', 'lastOpenedAt'
]

const turnOf = message => Number(message?.turn || (message?.greeting ? 1 : 0))
const lastAssistant = chat => (chat.messages || []).findLast(message => message?.role === 'assistant')

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function rowsOf(state) {
  return Array.isArray(state?.messages) ? state.messages : []
}

// The branch a save can still cut when its snapshot of that row is gone: the story rows
// of the chosen message and the card's own setup, with nothing carried over from the
// turns that came after them.
function textOnlyBranch(source, rows) {
  const state = { ...source, messages: rows, settleStatus: 'done' }
  for (const key of TEXT_ONLY_STATE_KEYS) delete state[key]
  state.mvu = { enabled: false }
  return state
}

// A snapshot is usable only when it holds exactly the story prefix the chosen
// message ends: same absolute row count, same roles, same narrative text.
// Turn numbers are deliberately ignored here: duplicated, missing or out-of-order
// turns are a projection detail, not the identity of a Chat state.
function holdsStoryPrefix(state, sourceMessages, messageIndex) {
  const rows = rowsOf(state)
  if (rows.length !== messageIndex + 1) return false
  for (let index = 0; index <= messageIndex; index++) {
    const old = rows[index]
    const now = sourceMessages[index]
    if (!old || !now || old.role !== now.role) return false
    if ((old.sourceText ?? old.text) !== (now.sourceText ?? now.text)) return false
  }
  return true
}

// Revisions reachable from a Chat: its own bounded checkpoints, then the parent
// branch it was forked from. The caller walks the queue until one snapshot holds the
// requested prefix, harvesting deeper snapshots from every state it manages to read.
function harvestSnapshots(state, queue, claimed) {
  if (!state || typeof state !== 'object') return
  const identity = str(state.id) + ':' + str(state._storageRevision)
  if (claimed.has(identity)) return
  claimed.add(identity)
  const push = (chatId, revision, scanUntil = null) => {
    if (!chatId || !Number.isSafeInteger(revision) || revision < 0) return
    const key = chatId + '\u0000' + revision
    if (claimed.has(key)) return
    claimed.add(key)
    queue.push({ chatId, revision, scanUntil })
  }
  const checkpoints = (Array.isArray(state.timeline?.checkpoints) ? state.timeline.checkpoints : [])
    .map((checkpoint, order) => ({ checkpoint, order, before: Number(checkpoint?.beforeRevision) }))
    .sort((left, right) => left.before - right.before || left.order - right.order)
  // Newest checkpoints are usually closest to the selected row. New checkpoints
  // name their completed revision directly; legacy ones may scan only as far as
  // the next checkpoint, never through an unbounded future history.
  for (let at = checkpoints.length - 1; at >= 0; at--) {
    const { checkpoint, before } = checkpoints[at]
    const next = at + 1 < checkpoints.length ? checkpoints[at + 1].before : Number(state._storageRevision)
    const scanUntil = Number.isSafeInteger(next) && next > before ? next - 1 : null
    const round = state.timeline?.operations?.[str(checkpoint?.operationId)]
    const settled = Number(round?.settledRevision)
    const after = Number.isSafeInteger(settled) && settled > 0 ? settled : Number(checkpoint?.afterRevision)
    // Prefer the post-settlement revision. Both it and the older foreground
    // afterRevision may scan forward inside their own interval: early saves only
    // retained the foreground pending snapshot before settlement finished.
    push(str(state.id), after, scanUntil)
    push(str(state.id), before, scanUntil)
  }
  const parent = state.forkedFrom
  push(str(parent?.stateChatId || parent?.chatId), Number(parent?.stateRevision ?? parent?.storageRevision))
}

function holdsAvailablePrefix(state, sourceMessages) {
  const rows = rowsOf(state)
  for (let index = 0; index < rows.length; index++) {
    const old = rows[index], now = sourceMessages[index]
    if (!old || !now || old.role !== now.role) return false
    if ((old.sourceText ?? old.text) !== (now.sourceText ?? now.text)) return false
  }
  return true
}

/**
 * Resolve the Chat state a story message ends at, addressed by absolute message index.
 * The chosen prefix is `[0..messageIndex]`; no turn is consulted to find it.
 *
 * A fork never asks the player to wait for history: the live head resolves to the source
 * itself, a retained snapshot of that row is used with its own values, and when the save
 * no longer holds one the branch is cut from the story rows alone (`textOnly`).
 * @returns `{ messageIndex, state, turn, textOnly }` — `turn` is informational, for legacy receipts.
 */
export async function conversationStateAtMessage(source, messageIndex, readRevision) {
  if (!source) throw new Error('找不到要分叉的对话')
  const messages = Array.isArray(source.messages) ? source.messages : []
  const index = Number(messageIndex)
  if (!Number.isSafeInteger(index) || index < 0 || index >= messages.length) throw new Error('找不到指定分叉消息')
  if (messages[index]?.role !== 'assistant') throw new Error('分叉点必须是正文消息')
  if (messages.length === index + 1) {
    assertConversationForkable(source)
    return { messageIndex: index, state: source, turn: turnOf(lastAssistant(source)) }
  }
  const exact = async state => {
    try {
      assertConversationForkable(state, { historical: true })
      return { messageIndex: index, state, turn: turnOf(lastAssistant(state)) }
    } catch (error) {
      // A snapshot caught mid-settlement still names the row; its values are the only
      // thing missing, so it falls through to the story-only branch like any other.
      if (error?.forkTransient === true) return null
      throw error
    }
  }
  const queue = [], claimed = new Set()
  harvestSnapshots(source, queue, claimed)
  const visited = new Set()
  const MAX_FORWARD_PROBES = 64
  let forwardProbes = 0
  const queueForward = candidate => {
    if (!Number.isSafeInteger(candidate.scanUntil) || candidate.revision >= candidate.scanUntil || forwardProbes >= MAX_FORWARD_PROBES) return false
    const next = { chatId: candidate.chatId, revision: candidate.revision + 1, scanUntil: candidate.scanUntil, probe: true }
    const key = next.chatId + '\u0000' + next.revision
    if (claimed.has(key)) return false
    claimed.add(key)
    forwardProbes++
    queue.push(next)
    return true
  }
  while (queue.length) {
    const candidate = queue.shift()
    const key = candidate.chatId + '\u0000' + candidate.revision
    if (visited.has(key)) continue
    visited.add(key)
    let state
    try {
      state = await readRevision(candidate.chatId, candidate.revision)
    } catch (error) {
      if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') {
        // Sparse revisions and compaction holes do not end a bounded probe.
        if (candidate.probe) queueForward(candidate)
        continue
      }
      throw error
    }
    if (!state || state._storageRevision !== candidate.revision) {
      if (candidate.probe) queueForward(candidate)
      continue
    }
    if (holdsStoryPrefix(state, messages, index)) {
      const resolved = await exact(state)
      if (resolved) return resolved
    }
    // Legacy checkpoints point at the pre-reply row; early afterRevision values
    // point at the exact but still-settling row. Walk forward only inside this
    // checkpoint interval and only while every available row matches the branch.
    if (rowsOf(state).length <= index + 1 && holdsAvailablePrefix(state, messages)) queueForward(candidate)
    // A later snapshot can still hold this prefix through its own parent chain.
    harvestSnapshots(state, queue, claimed)
  }
  // A save can stop naming its own history: a rollback drops the checkpoint it
  // consumed, a story edit or import rewrites the timeline, and maintenance only keeps
  // the revisions some feature still points at. The rows are what identifies a state,
  // so when no anchor reaches the chosen message, walk the Chat's own revisions back
  // from the head and take the newest one that ends exactly at it. The anchors above
  // stay first: they name settled revisions without scanning.
  const chatId = str(source.id)
  const head = Number(source._storageRevision)
  let missing = 0
  for (let revision = head - 1, probes = 0; Number.isSafeInteger(revision) && revision >= 1 && probes < MAX_HISTORY_SCAN; revision--, probes++) {
    const key = chatId + '\u0000' + revision
    if (visited.has(key)) continue
    visited.add(key)
    let state
    try {
      state = await readRevision(chatId, revision)
    } catch (error) {
      if (error?.code !== 'DSH_TAVERN_REVISION_NOT_FOUND') throw error
      // Two holes in a row mean the retained history ends here.
      if (++missing >= 2) break
      continue
    }
    missing = 0
    if (!state || state._storageRevision !== revision) continue
    if (!holdsStoryPrefix(state, messages, index)) continue
    const resolved = await exact(state)
    if (resolved) return resolved
  }
  const rows = messages.slice(0, index + 1)
  return { messageIndex: index, state: textOnlyBranch(source, rows), turn: turnOf(rows[index]), textOnly: true }
}

// Legacy entry point: locate the story message by its turn, then select the state by
// absolute message index. The turn only picks the row; it never picks the state.
export async function conversationStateAtTurn(source, requestedTurn, readRevision) {
  const turn = requestedTurn === undefined || requestedTurn === 0 ? turnOf(lastAssistant(source)) : Number(requestedTurn)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('找不到指定分叉回合')
  const index = (source.messages || []).findIndex(message => message?.role === 'assistant' && turnOf(message) === turn)
  if (index < 0) throw new Error('找不到指定分叉回合')
  const { state } = await conversationStateAtMessage(source, index, readRevision)
  return { turn, state, messageIndex: index }
}

// A boundary the log cannot offer any more: the caller falls back to a story fork,
// which rebuilds native context from the message prefix instead of copying the log.
// The codes let that fallback stay exact without reading error text.
export const FORK_BOUNDARY_MISSING = 'DSH_TAVERN_FORK_BOUNDARY_MISSING'
export const FORK_BOUNDARY_UNSAFE = 'DSH_TAVERN_FORK_BOUNDARY_UNSAFE'

function boundaryError(code, message) {
  return Object.assign(new Error(message), { code })
}

// Native fork boundary: the host copies its event log up to one `turn/end`, so the
// downstream native fork still needs this. Story Chat state selection never reads it.
export function conversationForkBoundary(session, state, turn) {
  const events = sessionEvents(session)
  const nativeTurn = Number(state.regeneratedDshTurns?.[turn]) || turn
  const end = events.findLast(event => event.type === 'turn/end' && Number(event.data?.turn) === nativeTurn)
  if (!end || end.data?.reason?.kind !== 'completed') throw boundaryError(FORK_BOUNDARY_MISSING, '该回合缺少已完成的原生上下文边界')
  const result = assistantResultForTurn(session, turn)
  const following = events.find(event => event.type === 'turn/start' && event.seq > end.seq)
  if (!result || (following && result.event.seq >= following.seq)) throw boundaryError(FORK_BOUNDARY_UNSAFE, '该回合正文曾在后续上下文中修改，无法按旧边界安全分叉')
  return end.seq
}
