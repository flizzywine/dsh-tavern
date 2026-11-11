import { createHash } from 'node:crypto'

// Fields written after a reply exists. They describe the save or the attempt,
// not the next request, so a new body or a failed retry must not invalidate a
// frame that still describes the same request materials.
const VOLATILE_CHAT_FIELDS = new Set([
  '_storageRevision', 'createdAt', 'updatedAt',
  'messages', 'timeline', 'foregroundFrames', 'cardDefinitionSnapshot',
  'regenInProgress', 'regenRecovery', 'failedRegenerationTarget',
  'replacingDshTurns', 'suppressedDshTurns', 'regeneratedDshTurns',
  'nativeCommits', 'foregroundError', 'presentationWarnings',
  'settleStatus', 'settleError', 'candidates', 'taskMailbox', 'candidateAgent',
  'rollbackUndo', 'importHistory', 'tavernHelperLifecycleRevision',
  'userInputEdits', 'hiddenDshErrorTurns', 'lastWorldBookRecall', 'worldBookError',
  'bodyGenerationCandidate', 'pendingMvuSettlement'
])

const DYNAMIC_CONTENT = /\{\{\s*(?:random|roll)\b|Math\s*(?:\.\s*random|\[\s*['"]random['"]\s*\])|<%/i

function stringify(value) {
  try { return JSON.stringify(value) ?? 'null' } catch { return '' }
}

function requestChat(chat) {
  const result = {}
  for (const key of Object.keys(chat || {}).sort()) {
    if (!VOLATILE_CHAT_FIELDS.has(key)) result[key] = chat[key]
  }
  return result
}

// The old prose is intentionally absent, but its variables, swipe and plugin
// data still feed the template message scope of the next request.
function targetFingerprint(message) {
  if (!message || typeof message !== 'object') return null
  const result = {}
  for (const key of Object.keys(message).sort()) {
    if (['text', 'sourceText', 'projectionText', 'swipes', 'content'].includes(key)) continue
    result[key] = message[key]
  }
  return result
}

/**
 * The key for one native regeneration request. The target reply is omitted by
 * the caller: the provider projection removes that body, so a new sample of the
 * same round may reuse the frame while every other message stays identical.
 * A null key means the request has per-attempt randomness or a template that
 * cannot be fingerprinted safely; the caller must rebuild it.
 */
export function regenerationFrameKey(input = {}) {
  const payload = {
    version: 1,
    chat: requestChat(input.chat),
    history: Array.isArray(input.history) ? input.history : [],
    target: targetFingerprint(input.target),
    card: input.card ?? null,
    preset: input.preset ?? null,
    worldBook: input.worldBook ?? null,
    pluginSections: Array.isArray(input.pluginSections) ? input.pluginSections : [],
    globals: input.globals ?? null,
    settings: input.settings ?? null,
    extensions: input.extensions ?? null,
    prompts: Array.isArray(input.prompts) ? input.prompts : [],
    input: typeof input.userText === 'string' ? input.userText : '',
    turn: Number(input.turn) || 0,
    branchId: input.branchId ?? null,
    targetAssistantIndex: Number.isSafeInteger(input.targetAssistantIndex) ? input.targetAssistantIndex : -1
  }
  const serialized = stringify(payload)
  if (serialized === '' || DYNAMIC_CONTENT.test(serialized)) return null
  return createHash('sha256').update(serialized).digest('hex')
}
