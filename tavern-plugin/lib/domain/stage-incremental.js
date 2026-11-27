import { createHash } from 'node:crypto'
import { sceneSourceDigest } from './scene-illustration.js'
export { normalizeStageBudget } from '../../packages/dsh-presentation-protocol/src/config-budget.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const stageDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
// byte stream used by the revision-bound prefix index, including JSON nulls.
export const stageTargetPrefixBytes = message => JSON.stringify(canonical([message.role, message.turn, message.sourceText ?? message.text]))

/** Capture the real target once; commit re-derives it from the authoritative Chat.
 * Matches sceneTarget's selected-source/prefix semantics without importing its model adapter.
 * The host may use sceneTarget as its extra presentation identity, but cannot supply a
 * free-form sourceKey in place of this commit binding.
 */
export function captureStageTarget(chat, messageId, prefixDigest) {
  for (const field of ['id', 'sessionId']) if (typeof chat?.[field] !== 'string' || !chat[field]) throw new Error('Missing stage Chat identity')
  if (typeof chat.timeline?.branchId !== 'string' || !chat.timeline.branchId || !Number.isSafeInteger(chat.timeline?.revision) || chat.timeline.revision < 0) throw new Error('Missing stage timeline identity')
  if (!Number.isSafeInteger(messageId) || messageId < 0) throw new Error('Invalid stage message index')
  const message = chat.messages?.[messageId]
  if (!message || message.role !== 'assistant') throw new Error('Stage target message missing')
  const swipeId = Math.max(0, Number(message.swipeId) || 0)
  const source = String(message.swipes?.[swipeId] ?? message.sourceText ?? message.text ?? '')
  // Automatic polish preserves the scene identity of the original prose.
  const sourceDigest = message.polishedFrom || sceneSourceDigest(source)
  // the revision-bound history reader supplies the identical JSON prefix hash.
  prefixDigest ??= stageDigest(chat.messages.slice(0, messageId).map(item => [item.role, item.turn, item.sourceText ?? item.text]))
  const identity = { chatId: chat.id, sessionId: chat.sessionId, messageId, messageIdentity: message.id ?? null,
    turn: Number(message.turn || (message.greeting ? 1 : 0)), swipeId, sourceDigest, prefixDigest }
  return { ...identity, branchId: chat.timeline?.branchId, revision: chat.timeline?.revision, sourceKey: stageDigest(identity) }
}
