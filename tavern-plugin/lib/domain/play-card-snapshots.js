import { constantWorldBookContext } from './worldbook-recall.js'
import { sanitizeAgentProjectionText } from './runtime-content-projection.js'

const VERSION = 7
function str(value) { return value === undefined || value === null ? '' : String(value) }
function isPlay(chat) { return chat && (!chat.mode || chat.mode === 'story' || chat.mode === 'script') }

/** Owns snapshot preparation, migration, persistence and concurrent build sharing. */
export function createPlayCardSnapshots({ worldBooks, planner, readCard, writeChat, captureSceneWorldbook, userPreferenceProfile, logger = console }) {
  const pending = new Map()

  async function constantContext(chat, card) {
    try { return constantWorldBookContext({ worldBook: await worldBooks.bound(chat.cardPath, card) }).context }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    return ''
  }

  async function build(chat, card) {
    let worldBook = null
    try { worldBook = await worldBooks.bound(chat.cardPath, card) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    const worldBookContext = constantWorldBookContext({ worldBook }).context
    const planned = sanitizeAgentProjectionText((await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext, worldBookLabel: '常驻世界书' })).text)
    const preference = chat.userProfileEnabled === true && userPreferenceProfile
      ? await userPreferenceProfile.stableContext()
      : null
    const text = preference === null ? planned : sanitizeAgentProjectionText([preference.text, planned].filter(Boolean).join('\n\n'))
    const patch = {
      cardContextSnapshot: text,
      cardContextSnapshotVersion: VERSION,
      userProfileRevision: preference === null ? 0 : preference.revision,
      userProfileContextSnapshot: preference === null ? '' : preference.text
    }
    // Only new, unpublished openings: migration cannot manufacture their past.
    if (!(chat.messages || []).length && typeof captureSceneWorldbook === 'function') {
      patch.sceneOpeningWorldbook = await captureSceneWorldbook(chat, card, worldBook)
    }
    return patch
  }

  // A new chat is not published yet; preparation must not create a partial save.
  async function prepare(chat, card) {
    if (!isPlay(chat)) return ''
    const patch = await build(chat, card === undefined ? await readCard(chat) : card)
    Object.assign(chat, patch)
    return patch.cardContextSnapshot
  }

  async function ensure(chat, card) {
    if (!isPlay(chat)) return ''
    const key = chat.id || chat
    if (pending.has(key)) {
      const patch = await pending.get(key)
      // Other readers keep their own storage revision for optimistic merging.
      Object.assign(chat, patch)
      return patch.cardContextSnapshot
    }
    const operation = (async function () {
      const existing = str(chat.cardContextSnapshot)
      let patch, source
      if (existing !== '' && Number(chat.cardContextSnapshotVersion) >= VERSION) {
        const sanitized = sanitizeAgentProjectionText(existing)
        patch = { cardContextSnapshot: sanitized, cardContextSnapshotVersion: chat.cardContextSnapshotVersion }
        if (sanitized === existing) return patch
        source = 'card-context.sanitize'
      } else {
        patch = await build(chat, card === undefined ? await readCard(chat) : card)
        source = 'card-context.snapshot'
      }
      const draft = Object.assign({}, chat, patch)
      const saved = await writeChat(draft, { source })
      // Persistence may merge unrelated concurrent edits. The owner must adopt
      // that committed record before adopting its revision; waiters do not.
      const committed = saved && typeof saved === 'object' ? saved : draft
      for (const field of Object.keys(chat)) if (!Object.hasOwn(committed, field)) delete chat[field]
      Object.assign(chat, committed)
      return patch
    })()
    pending.set(key, operation)
    try { return (await operation).cardContextSnapshot }
    finally { if (pending.get(key) === operation) pending.delete(key) }
  }

  return Object.freeze({ prepare, ensure, constantContext })
}
