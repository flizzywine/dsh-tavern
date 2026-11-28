import { worldbookContentDigest } from './worldbook-version.js'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { constantWorldBookContext } from './worldbook-recall.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'
import { defaultUserPreferenceProfile } from './user-preference-profile.js'

export function cardContentDigest(card) { return createHash('sha256').update(JSON.stringify(withoutPresentationOnly(card ?? null))).digest('hex') }
// the Card Stage (extensions.dsh_stage), the stage skin (dsh_tavern.stage defaultSkin 「使用皮肤」, CONFIG 本卡皮肤) and the
// card's mod choices and settings (dsh_tavern.modSystem: 本卡开启/关闭, the phone's 仅此角色卡 settings) are read live from the
// card on disk, never from the game's frozen card; editing them must not offer a save migration or auto-reload the game (a
// reload restarts the card scripts and the stage: skin, background and phone dropped for seconds, the reader thrown back to
// the round's first page). The card's status panel (dsh_tavern.pages) is read live from the library card the same way.
// Cards without them hash unchanged.
function withoutPresentationOnly(card) {
  if (!card || typeof card !== 'object' || !card.extensions || typeof card.extensions !== 'object') return card
  const { dsh_stage: _stage, ...extensions } = card.extensions, tavern = extensions.dsh_tavern, stage = tavern?.stage
  const skin = stage && typeof stage === 'object' && 'defaultSkin' in stage, mods = !!tavern && typeof tavern === 'object' && 'modSystem' in tavern
  const panel = !!tavern && typeof tavern === 'object' && 'pages' in tavern
  if (!('dsh_stage' in card.extensions) && !skin && !mods && !panel) return card
  if (skin || mods || panel) {
    const { modSystem: _mods, pages: _panel, ...rest } = tavern
    if (skin) { const { defaultSkin: _skin, ...stageRest } = stage; rest.stage = stageRest }
    extensions.dsh_tavern = rest
  }
  return { ...card, extensions }
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
    try { return prefixText(await worldBooks.bound(chat.cardPath, card, chat)) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    return ''
  }

  // The one projection of the constant text a prefix bakes in and digests: the card's bound book only,
  // the same before and after the first floor. Foreground capabilities keep their own snapshot
  // (foreground-capabilities.js), which replaces this section in every real request.
  function prefixText(worldBook) { return constantWorldBookContext({ worldBook }).context }

  async function build(chat, card, preservePreferences = false, resolvedWorldBook) {
    let worldBook = resolvedWorldBook ?? null
    try { if (!preferenceOnly(chat) && resolvedWorldBook === undefined) worldBook = await worldBooks.bound(chat.cardPath, card, chat) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    const worldBookContext = prefixText(worldBook)
    const planned = preferenceOnly(chat) ? '' : (await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext })).text
    let preference = null
    if (preservePreferences) {
      if (chat.userProfileContextSnapshot) preference = { text: chat.userProfileContextSnapshot, revision: chat.userProfileRevision, profileId: chat.userProfileId }
    } else if (chat.userProfileEnabled === true && userPreferenceProfile) {
      preference = await userPreferenceProfile.stableContext(chat.userProfileId || 'default')
    }
    const text = preference === null ? planned : [preference.text, planned].filter(Boolean).join('\n\n')
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

  /** A game that follows the library adopts embedded book edits without reloading its card. */
  function libraryBoundStatus(chat, card) {
    const base = cardStatusBase(chat, card)
    const cardChanged = base.cardChanged && !sameCardDefinition(chat, card)
    const digest = keepsCopy(chat) ? '' : cardOnlyDigest(card)
    return { ...base, cardChanged, available: cardChanged, worldbookChanged: false, worldbookSyncRequired: false, digest }
  }

  /** The stored snapshot when ensure() would neither rebuild nor rewrite it. */
  function settled(header) {
    if (!usesFixedContext(header)) return ''
    const existing = str(header.cardContextSnapshot)
    if ((existing !== '' || preferenceOnly(header)) && Number(header.cardContextSnapshotVersion) >= VERSION
      && !pending.has(header.id)) return existing
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
      if ((existing !== '' || preferenceOnly(chat)) && Number(chat.cardContextSnapshotVersion) >= VERSION) {
        return { cardContextSnapshot: existing, cardContextSnapshotVersion: chat.cardContextSnapshotVersion }
      }
      let preparation = chat
      if (preferenceOnly(chat)) {
        // Old card workspaces had no preference snapshot. Freeze the current
        // default once, including disabled state, without changing their tool target.
        const profile = await defaultUserPreferenceProfile(userPreferenceProfile)
        preparation = { ...chat, userProfileEnabled: profile?.hasConfirmed === true && profile.defaultEnabled === true,
          userProfileId: profile?.profileId || 'default', userProfileManagementId: chat.userProfileManagementId || chat.userProfileId || 'default' }
      }
      const patch = await build(preparation, preferenceOnly(chat) ? null : card === undefined ? await readCard(chat) : card)
      if (preferenceOnly(chat)) Object.assign(patch, { userProfileEnabled: preparation.userProfileEnabled, userProfileManagementId: preparation.userProfileManagementId })
      const draft = Object.assign({}, chat, patch)
      const saved = await writeChat(draft, { source: 'card-context.snapshot' })
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
    const migrations = (card?.extensions?.dsh_tavern?.stateMigrations || []).filter(plan => !chat.cardStateMigrationIds?.includes(plan.id)).flatMap(plan => plan.operations || []).map(op => op.op === 'move' ? op.from + ' → ' + op.path : op.op === 'map' ? op.path + ' 取值 ' + Object.entries(op.values || {}).map(([from, to]) => from + ' → ' + to).join('、') : op.op === 'convert' ? op.path + ' → ' + op.type : '删除 ' + op.path)
    return { legacy: !chat.cardContentDigest, cardChanged, migrations }
  }

  function sameCardDefinition(chat, card) {
    if (!chat.cardContentDigest || !chat.cardDefinitionSnapshot || !card) return false
    const { character_book: _frozenBook, ...frozen } = chat.cardDefinitionSnapshot
    const { character_book: _libraryBook, ...library } = card
    return isDeepStrictEqual(withoutPresentationOnly(frozen), withoutPresentationOnly(library))
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
      if (chat.openingWorldbookSnapshot?.version !== 1) {
        if (keepsCopy(chat)) return await refreshConstantPrefix(chat, card ?? await readCard(chat))
        const definition = chat.cardDefinitionSnapshot ?? await readCard(chat)
        const latest = card ?? await readLatestCard?.(chat.cardPath)
        // Only adopt the book here. Other card changes still go through the
        // reload path, which owns script restarts and variable migrations.
        const syncEmbeddedBook = latest && definition
          && !isDeepStrictEqual(definition.character_book, latest.character_book) && sameCardDefinition(chat, latest)
        return await refreshConstantPrefix(chat, syncEmbeddedBook
          ? { ...definition, character_book: latest.character_book } : definition, syncEmbeddedBook)
      }
      const definition = card ?? await readCard(chat)
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

  async function refreshConstantPrefix(chat, definition, syncEmbeddedBook) {
    if (!chat.cardContextConstants && !syncEmbeddedBook) return { applied: false }
    let record = null
    try { record = await worldBooks.bound(chat.cardPath, definition, chat) } catch { return { applied: false } }
    // Digest exactly what build() bakes in; a different projection rewrites the save on every read.
    const digest = constantWorldbookDigest(prefixText(record))
    const prefixChanged = chat.cardContextConstants !== digest
    if (!prefixChanged && !syncEmbeddedBook) return { applied: false }
    const patch = prefixChanged
      ? { ...(await build(chat, syncEmbeddedBook ? definition : chat.cardDefinitionSnapshot || definition, true, record)),
          cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1 }
      : { cardDefinitionSnapshot: structuredClone(definition), cardContentDigest: cardContentDigest(definition),
          worldbookLibraryDigest: worldbookContentDigest(record) }
    // The recall prepared for the next turn was built against the old prefix.
    patch.preparedWorldBook = null
    patch.preparedWorldBookContext = ''
    let applied = false
    // Another read may already have refreshed the prefix while this one ran.
    const saved = await updateChat(chat.id, current => {
      if (current.cardContextConstants !== chat.cardContextConstants || current.cardContentDigest !== chat.cardContentDigest
        || current.cardContextRevision !== chat.cardContextRevision || current.openingWorldbookSnapshot?.version === 1) return undefined
      applied = true
      return Object.assign({}, current, patch)
    }, { source: prefixChanged ? 'card-context.constants' : 'card-context.embedded-worldbook' })
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
    const previous = str(chat.userProfileContextSnapshot)
    if (previous) {
      // Older snapshots stripped braces from the assembled prefix.
      const prefix = [previous, previous.replace(/\{\{([^{}]*)\}\}|\{\{/g, (_match, body) => body ?? ''),
        previous.replaceAll('{{', '').replaceAll('}}', '')].find(text => base === text || base.startsWith(text + '\n\n'))
      if (prefix === undefined) throw new Error('当前画像与提示词快照不一致，未修改游戏')
      base = base.slice(prefix.length + 2)
    }
    return {
      userProfileEnabled: enabled,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference?.revision || 0,
      userProfileContextSnapshot: preference?.text || '',
      cardContextSnapshot: [preference?.text, base].filter(Boolean).join('\n\n'),
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
      if (!busy) await autoSync(chat, latest)
      return libraryBoundStatus(chat, latest)
    }
    const synced = busy ? null : await autoSync(chat, latest)
    return await updateStatus(chat, latest, synced?.observed)
  }

  return Object.freeze({ prepare, ensure, settled, constantContext, updateStatus, libraryBoundStatus, autoSync, currentStatus, replacement, preferenceReplacement })
}
