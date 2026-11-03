import { worldbookContentDigest } from './worldbook-version.js'
import { createHash } from 'node:crypto'
import { constantWorldBookContext } from './worldbook-recall.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'
import { sanitizeAgentProjectionText } from './runtime-content-projection.js'
import { defaultUserPreferenceProfile } from './user-preference-profile.js'

export function cardContentDigest(card) { return createHash('sha256').update(JSON.stringify(withoutPresentationOnly(card ?? null))).digest('hex') }
// The card's status panel (dsh_tavern.statusPanel) is read live from the library card, never from the game's frozen
// card: editing it must not offer a save migration or reload the game. Cards without it hash unchanged.
function withoutPresentationOnly(card) {
  const tavern = card?.extensions?.dsh_tavern
  if (!tavern || typeof tavern !== 'object' || !('statusPanel' in tavern)) return card
  const { statusPanel: _panel, ...rest } = tavern
  return { ...card, extensions: { ...card.extensions, dsh_tavern: rest } }
}
// The constant entries are baked into the fixed prefix, so a game that keeps no
// world-book copy still needs to know when that text went stale.
export function constantWorldbookDigest(text) { return createHash('sha256').update(str(text)).digest('hex') }

const VERSION = 7
function str(value) { return value === undefined || value === null ? '' : String(value) }
function usesFixedContext(chat) { return chat && (!chat.mode || ['story', 'script', 'card'].includes(chat.mode)) }
function cardAgent(chat) { return chat.mode === 'card' && chat.cardEditContext?.version !== 1 }
function preferenceOnly(chat) { return cardAgent(chat) && chat.cardReferenceContext?.version !== 1 }

/** Owns snapshot preparation, migration, persistence and concurrent build sharing. */
// `readCard(chat)` is the card the game plays with (frozen at opening, replaced by an explicit reload);
// `readLatestCard(cardPath)` is the card on disk. Update detection and the reload digest compare the two.
export function createPlayCardSnapshots({ worldBooks, planner, readCard, readLatestCard, writeChat, updateChat, userPreferenceProfile, logger = console }) {
  const pending = new Map()
  const syncing = new Set()
  const lastSyncWarning = new Map()

  async function constantContext(chat, card) {
    try { return constantWorldBookContext({ worldBook: await worldBooks.bound(chat.cardPath, card, chat) }).context }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    return ''
  }

  async function build(chat, card, preservePreferences = false, resolvedWorldBook) {
    let worldBook = resolvedWorldBook ?? null
    try { if (!preferenceOnly(chat) && resolvedWorldBook === undefined) worldBook = await worldBooks.bound(chat.cardPath, card, chat) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    const worldBookContext = constantWorldBookContext({ worldBook }).context
    const planned = preferenceOnly(chat) ? '' : sanitizeAgentProjectionText((await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext, worldBookLabel: '常驻世界书' })).text)
    let preference = null
    if (preservePreferences) {
      if (chat.userProfileContextSnapshot) preference = { text: chat.userProfileContextSnapshot, revision: chat.userProfileRevision, profileId: chat.userProfileId }
    } else if (chat.userProfileEnabled === true && userPreferenceProfile) {
      preference = await userPreferenceProfile.stableContext(chat.userProfileId || 'default')
    }
    const text = preference === null ? planned : sanitizeAgentProjectionText([preference.text, planned].filter(Boolean).join('\n\n'))
    const patch = {
      cardContextSnapshot: text,
      cardContextSnapshotVersion: VERSION,
      cardContextConstants: constantWorldbookDigest(worldBookContext),
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference === null ? 0 : preference.revision,
      userProfileContextSnapshot: preference === null ? '' : preference.text
    }
    // Card Agents edit the card itself: keep only the reference text, never a
    // definition snapshot that later reads would prefer over the live card.
    if (cardAgent(chat)) return patch
    Object.assign(patch, {
      cardDefinitionSnapshot: structuredClone(card),
      cardContentDigest: cardContentDigest(card),
      worldbookLibraryDigest: chat.openingWorldbookSnapshot ? chat.openingWorldbookSnapshot.libraryDigest : worldbookContentDigest(worldBook)
    })
    return patch
  }

  // A new chat is not published yet; preparation must not create a partial save.
  // `preparedBook` is the opening draft's own projection: the start path just
  // read and inspected that document, so it must not be resolved a second time.
  async function prepare(chat, card, preparedBook) {
    if (!usesFixedContext(chat)) return ''
    const patch = await build(chat, preferenceOnly(chat) ? null : card === undefined ? await readCard(chat) : card, false, preparedBook)
    Object.assign(chat, patch)
    return patch.cardContextSnapshot
  }

  /** A game that follows the library has no world book to update or synchronize. */
  function libraryBoundStatus(chat, card) {
    const base = cardStatusBase(chat, card)
    // The card itself is still frozen: its explicit reload needs a digest, which
    // guards the card alone because the game reads the live book every turn.
    const digest = keepsCopy(chat) ? '' : cardOnlyDigest(card)
    return { ...base, available: base.cardChanged, worldbookChanged: false, worldbookSyncRequired: false, digest }
  }

  /** The stored snapshot when ensure() would neither rebuild nor rewrite it. */
  function settled(header) {
    if (!usesFixedContext(header)) return ''
    const existing = str(header.cardContextSnapshot)
    if ((existing !== '' || preferenceOnly(header)) && Number(header.cardContextSnapshotVersion) >= VERSION
      && sanitizeAgentProjectionText(existing) === existing && !pending.has(header.id)) return existing
    return undefined
  }

  async function ensure(chat, card) {
    if (!usesFixedContext(chat)) return ''
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
      if ((existing !== '' || preferenceOnly(chat)) && Number(chat.cardContextSnapshotVersion) >= VERSION) {
        const sanitized = sanitizeAgentProjectionText(existing)
        patch = { cardContextSnapshot: sanitized, cardContextSnapshotVersion: chat.cardContextSnapshotVersion }
        if (sanitized === existing) return patch
        source = 'card-context.sanitize'
      } else {
        let preparation = chat
        if (preferenceOnly(chat)) {
          // Old card workspaces had no preference snapshot. Freeze the current
          // default once, including disabled state, without changing their tool target.
          const profile = await defaultUserPreferenceProfile(userPreferenceProfile)
          preparation = { ...chat, userProfileEnabled: profile?.hasConfirmed === true && profile.defaultEnabled === true,
            userProfileId: profile?.profileId || 'default', userProfileManagementId: chat.userProfileManagementId || chat.userProfileId || 'default' }
        }
        patch = await build(preparation, preferenceOnly(chat) ? null : card === undefined ? await readCard(chat) : card)
        if (preferenceOnly(chat)) Object.assign(patch, { userProfileEnabled: preparation.userProfileEnabled, userProfileManagementId: preparation.userProfileManagementId })
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

  function bookSnapshot(record) {
    return { version: 1, libraryDigest: worldbookContentDigest(record), source: structuredClone(record?.source ?? null), document: structuredClone(record?.document ?? null) }
  }

  async function liveBook(chat, card) {
    const liveChat = { ...chat }
    delete liveChat.openingWorldbookSnapshot
    return worldBooks.bound(chat.cardPath, card, liveChat)
  }

  function updateDigest(card, snapshot) {
    return cardContentDigest({ card: digestOfCard(card), worldbook: worldbookContentDigest(snapshot) })
  }

  // A status check runs on every read of a game with the same shared latest card: hash it once.
  const cardDigests = new WeakMap()
  function digestOfCard(card) {
    if (!card || typeof card !== 'object') return cardContentDigest(card)
    if (!cardDigests.has(card)) cardDigests.set(card, cardContentDigest(card))
    return cardDigests.get(card)
  }
  function cardOnlyDigest(card) { return cardContentDigest({ card: digestOfCard(card), worldbook: null }) }
  // Any stored copy, even a legacy one, is replaced as a whole by an explicit reload.
  function keepsCopy(chat) { return chat.openingWorldbookSnapshot !== undefined && chat.openingWorldbookSnapshot !== null }

  // One library observation serves both the badge and the automatic refresh.
  async function observe(chat, card) {
    const snapshot = bookSnapshot(await liveBook(chat, card))
    return { snapshot, digest: updateDigest(card, snapshot) }
  }

  function compare(chat, observed) {
    const previous = chat.worldbookLibraryDigest ?? chat.openingWorldbookSnapshot?.libraryDigest
    // Legacy snapshots may already contain local script writes. Without the
    // original resource version, request explicit synchronization instead of
    // silently adopting the current library as the historical baseline.
    const worldbookChanged = previous ? previous !== observed.snapshot.libraryDigest
      : worldbookContentDigest({ source: chat.openingWorldbookSnapshot?.source }) !== worldbookContentDigest({ source: observed.snapshot.source })
    const worldbookSyncRequired = !previous && !!(observed.snapshot.source || observed.snapshot.document || chat.openingWorldbookSnapshot?.source || chat.openingWorldbookSnapshot?.document)
    return { previous, worldbookChanged, worldbookSyncRequired }
  }

  function cardStatusBase(chat, card) {
    const cardChanged = !chat.cardContentDigest || chat.cardContentDigest !== digestOfCard(card)
    const migrations = (card?.extensions?.dsh_tavern?.stateMigrations || []).filter(plan => !chat.cardStateMigrationIds?.includes(plan.id)).flatMap(plan => plan.operations || []).map(op => op.op === 'move' ? op.from + ' → ' + op.path : op.op === 'convert' ? op.path + ' → ' + op.type : '删除 ' + op.path)
    return { legacy: !chat.cardContentDigest, cardChanged, migrations }
  }

  async function updateStatus(chat, card, observed) {
    const base = cardStatusBase(chat, card)
    try {
      const current = observed ?? await observe(chat, card)
      const { worldbookChanged, worldbookSyncRequired } = compare(chat, current)
      const available = base.cardChanged || worldbookChanged || worldbookSyncRequired
      return { ...base, available, worldbookChanged, worldbookSyncRequired, digest: current.digest }
    } catch (error) {
      // Missing/corrupt library resources must not prevent reading a saved game.
      return { ...base, available: true, worldbookChanged: true, digest: '', error: str(error?.message || error) }
    }
  }

  /** Constant entries live in the card prefix; a changed set must rebuild it. */
  function constantText(document) {
    try { return constantWorldBookContext({ worldBook: document ? { view: inspectWorldBookDocument(document) } : null }).context }
    catch { return '' }
  }

  // An edited library replaces this game's frozen copy on the next read, without touching the card definition, its initvars or the MVU state.
  // A game that keeps no copy only needs the same treatment for its fixed prefix.
  // Explicit reload still owns those, so a card edit keeps its own button.
  async function autoSync(chat, card, options = {}) {
    if (typeof updateChat !== 'function') return null
    if (!usesFixedContext(chat) || cardAgent(chat) || preferenceOnly(chat)) return null
    if (chat.regenInProgress === true || options.busy === true) return null
    const key = chat.id || chat
    if (syncing.has(key)) return null
    syncing.add(key)
    try {
      const definition = card ?? await readCard(chat)
      // A game that keeps no copy already reads the library every turn; only its
      // fixed prefix can be stale, and it is the same "next read" promise.
      if (chat.openingWorldbookSnapshot?.version !== 1) return await refreshConstantPrefix(chat, definition)
      let observed
      try { observed = await observe(chat, definition) }
      catch (error) {
        // Views retry every refresh: repeat the same failure only once.
        const message = str(error && error.message || error)
        if (lastSyncWarning.get(key) !== message) {
          lastSyncWarning.set(key, message)
          if (lastSyncWarning.size > 64) lastSyncWarning.delete(lastSyncWarning.keys().next().value)
          logger.warn('dsh-tavern: 世界书自动更新读取失败，保留本局快照：', message)
        }
        return null
      }
      lastSyncWarning.delete(key)
      const change = compare(chat, observed)
      // A legacy save has no recorded baseline: its copy may already contain
      // script writes, so only an explicit reload may replace it.
      if (!change.worldbookChanged) return { observed, applied: false }
      const next = observed.snapshot
      const patch = { openingWorldbookSnapshot: next, worldbookLibraryDigest: next.libraryDigest,
        preparedWorldBook: null, preparedWorldBookContext: '' }
      if (constantText(chat.openingWorldbookSnapshot.document) !== constantText(next.document)) {
        // Constant entries live in the fixed prefix. Rebuild it from the card this
        // save was opened with, so an automatic update cannot pull a newer card
        // definition into the game behind the explicit reload's back.
        try {
          Object.assign(patch, await build({ ...chat, openingWorldbookSnapshot: next },
            chat.cardDefinitionSnapshot || definition, true))
          patch.openingWorldbookSnapshot = next
          patch.cardContextRevision = (Number(chat.cardContextRevision) || 0) + 1
        } catch (error) {
          // Keep the old copy instead of a prefix that disagrees with recall.
          logger.warn('dsh-tavern: 常驻世界书已变化但人物卡前缀重建失败，稍后重试：', str(error && error.message || error))
          return null
        }
      }
      // A save applied while this read was running already re-baselined the
      // snapshot; keep its version instead of writing a stale one.
      let applied = false
      const saved = await updateChat(chat.id, current => {
        const latest = current.worldbookLibraryDigest ?? current.openingWorldbookSnapshot?.libraryDigest
        if (latest !== change.previous) return current
        applied = true
        return Object.assign({}, current, patch)
      }, { source: 'card-context.worldbook-auto' })
      if (!applied || !saved) return { observed, applied: false }
      // Callers keep using this object for the rest of the read; adopt the
      // committed values the same way ensure() adopts its own write.
      try { Object.assign(chat, patch) } catch { /* a projection may be frozen; the save above is authoritative */ }
      return { observed, applied: true, patch, saved }
    } finally { syncing.delete(key) }
  }

  async function refreshConstantPrefix(chat, definition) {
    if (!chat.cardContextConstants) return { applied: false }
    let record = null
    try { record = await worldBooks.bound(chat.cardPath, definition, chat) } catch { return { applied: false } }
    const digest = constantWorldbookDigest(constantWorldBookContext({ worldBook: record }).context)
    if (chat.cardContextConstants === digest) return { applied: false }
    const patch = await build({ ...chat, cardContextConstants: digest }, chat.cardDefinitionSnapshot || definition, true, record)
    patch.cardContextRevision = (Number(chat.cardContextRevision) || 0) + 1
    // The recall prepared for the next turn was built against the old prefix.
    patch.preparedWorldBook = null
    patch.preparedWorldBookContext = ''
    let applied = false
    // Another read may already have refreshed the prefix while this one ran.
    const saved = await updateChat(chat.id, current => {
      if (current.cardContextConstants !== chat.cardContextConstants || current.openingWorldbookSnapshot?.version === 1) return current
      applied = true
      return Object.assign({}, current, patch)
    }, { source: 'card-context.constants' })
    if (!applied || !saved) return { applied: false }
    try { Object.assign(chat, patch) } catch { /* a projection may be frozen; the save above is authoritative */ }
    return { applied: true, patch, saved }
  }

  async function replacement(chat, card, expectedDigest) {
    // Explicit user consent replaces the live book snapshot as well as the card
    // prefix. Resolve without the old snapshot, and fail before publishing if
    // a binding is missing; never mark a partial refresh as successfully applied.
    const worldBook = await liveBook(chat, card)
    // A game that keeps no copy follows the library: reload only the card, and
    // never start a copy behind its back.
    if (!keepsCopy(chat)) {
      if (expectedDigest !== undefined && expectedDigest !== cardOnlyDigest(card)) throw new Error('人物卡已再次修改，请刷新后确认')
      const patch = await build(chat, card, true, worldBook)
      return { ...patch, cardName: card.name || chat.cardName, cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1 }
    }
    const openingWorldbookSnapshot = bookSnapshot(worldBook)
    if (expectedDigest !== undefined && expectedDigest !== updateDigest(card, openingWorldbookSnapshot)) {
      throw new Error('人物卡或世界书已再次修改，请刷新后确认')
    }
    const patch = await build({ ...chat, openingWorldbookSnapshot }, card, true, worldBook)
    return { ...patch, cardName: card.name || chat.cardName, openingWorldbookSnapshot, cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1 }
  }

  async function preferenceReplacement(chat, enabled, profileId) {
    if (!usesFixedContext(chat) || chat.mode === 'card') throw new Error('仅支持游玩会话')
    if (typeof enabled !== 'boolean') throw new Error('画像开关必须为布尔值')
    if ((chat.userProfileEnabled === true) === enabled && !profileId) return {}
    const preference = enabled ? await userPreferenceProfile?.stableContext(profileId || chat.userProfileId) : null
    if (enabled && !preference) throw new Error('请先建立并确认用户画像')
    let base = str(chat.cardContextSnapshot)
    if (!base) throw new Error('当前游戏缺少人物卡快照，请先恢复会话后重试')
    const previous = sanitizeAgentProjectionText(str(chat.userProfileContextSnapshot))
    if (previous) {
      if (base === previous) base = ''
      else if (base.startsWith(previous + '\n\n')) base = base.slice(previous.length + 2)
      else throw new Error('当前画像与提示词快照不一致，未修改游戏')
    }
    return {
      userProfileEnabled: enabled,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference?.revision || 0,
      userProfileContextSnapshot: preference?.text || '',
      cardContextSnapshot: sanitizeAgentProjectionText([preference?.text, base].filter(Boolean).join('\n\n')),
      cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1
    }
  }

  /**
   * The reload badge and digest of a game, always against the card on disk: comparing the game's
   * own frozen card with itself never sees an edit, and the digest must match what replacement()
   * checks. A game with its own book copy refreshes that copy from the latest card as before; a game
   * following the library refreshes its fixed prefix with the card it plays with (a card edit keeps
   * its explicit reload).
   */
  async function currentStatus(chat, { busy = false } = {}) {
    const latest = await readLatestCard(chat.cardPath)
    if (!keepsCopy(chat)) {
      if (!busy) await autoSync(chat, undefined)
      return libraryBoundStatus(chat, latest)
    }
    const synced = busy ? null : await autoSync(chat, latest)
    return await updateStatus(chat, latest, synced?.observed)
  }

  return Object.freeze({ prepare, ensure, settled, constantContext, updateStatus, libraryBoundStatus, autoSync, currentStatus, replacement, preferenceReplacement })
}
