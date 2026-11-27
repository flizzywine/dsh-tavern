import { hasCardAssetBindings } from '../card-asset-bindings.js'
import { withModHidden } from '../mod-tools.js'
import { readCardAssetExtension } from './card-asset-bindings.js'
import { withGlobalRegexScripts } from './card-extension-reading.js'
import { projectCardStage } from './card-stage.js'
import { copyJsonTree } from './copy-json-tree.js'
import { normalizeResourcePath } from './file-resources.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createCardWorkspaceReader({ fileResources, cardStorage, cardPreparation, cardScripts, tavernExtensionSettings }) {
  // A card's stage extension (null without stage settings): the card layer of its narrator.
  async function cardStageExtension(cardPath) {
    const raw = (await readCardWorkspace(cardPath))?.raw
    return raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null
  }
  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    if (cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(normalized, function (working, payload) {
      return cardPreparation.migrate({ working, payload })
    })
  }
  // Readers that only look at a card share the card storage's frozen copy of its current file version (a hit costs a
  // stat, not a read and parse of the whole card); a card not yet in the workspace shape is migrated first.
  async function readSharedCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const shared = await cardStorage.readWorkspace(normalized)
    if (shared === undefined || cardPreparation.isWorkspace(shared)) return shared
    await readCardWorkspace(normalized)
    return cardStorage.readWorkspace(normalized)
  }

  async function readCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const workspace = await readCardWorkspace(normalized)
    const card = workspace === undefined ? undefined : cardPreparation.project(workspace)
    if (card !== undefined) {
      card.path = normalized
      const raw = workspace.raw?.data || workspace.raw || {}
      card.extensions = structuredClone(raw.extensions || {})
    }
    return card
  }
  async function readLiveCardStage(cardPath) {
    try {
      const workspace = await readCardWorkspace(cardPath)
      const raw = workspace && (workspace.raw?.data || workspace.raw)
      return projectCardStage(raw && raw.extensions)
    } catch (_error) { return null }
  }
  // The card on disk for update checks on every read of a playing game: read again only when its
  // file changed (any way of editing a card writes that file). Shared and read-only.
  const latestCards = new Map()
  async function readLatestCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    const stamp = normalized ? (await fileResources.metadata(normalized).catch(() => null))?.updatedAt : 0
    const cached = latestCards.get(normalized)
    if (stamp && cached?.stamp === stamp) return cached.card
    const card = await readCard(normalized)
    latestCards.delete(normalized)
    if (stamp && card) {
      latestCards.set(normalized, { stamp, card })
      while (latestCards.size > 8) latestCards.delete(latestCards.keys().next().value)
    }
    return card
  }
  async function readCardExtensionSources(cardPath, chat) {
    const workspace = chat?.cardDefinitionSnapshot || await readSharedCardWorkspace(cardPath)
    if (workspace === undefined) return undefined
    const extensions = cardPreparation.present({ card: workspace, as: 'card-extensions' })
    // A workspace holds the card under raw; a game's definition snapshot is the card itself.
    return { ...extensions, mvuVisibility: withModHidden(extensions.mvuVisibility, workspace.raw?.data || workspace.raw || workspace) }
  }
  async function readCardExtensions(cardPath, chat, includeMuted = false, settings) {
    let extensions = await readCardExtensionSources(cardPath, chat)
    if (extensions === undefined) return undefined
    // shared by views, opening previews and script-work eligibility; no snapshot writes.
    if (!includeMuted) extensions = { ...extensions, helperScripts: await cardScripts.filter(extensions.helperScripts, cardPath) }
    return withGlobalRegexScripts(extensions, settings ?? await tavernExtensionSettings.read(), chat && chat.regexOverrides)
  }

  async function readChatCard(chat) {
    if (chat.mode !== 'card' && chat.cardDefinitionSnapshot) return copyJsonTree(chat.cardDefinitionSnapshot)
    if (chat.mode === 'card' && str(chat.cardPath) === '') return null
    const card = await readCard(chat.cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + chat.cardPath)
    return card
  }

  return { readCardWorkspace, readSharedCardWorkspace, readCard, readChatCard, readLatestCard,
    cardStageExtension, readLiveCardStage, readCardExtensionSources, readCardExtensions }
}
