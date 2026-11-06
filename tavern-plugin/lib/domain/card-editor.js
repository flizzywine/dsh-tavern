import { normalizeResourcePath } from './file-resources.js'

export const CARD_PROJECTION_REVISIONS = 'card-projection-revisions.json'

/** The card's projection revision (the updateCard expectedRevision). */
export function cardProjectionRevisionOf(state, cardPath) {
  return Math.max(0, Number(state && state.cards && state.cards[String(cardPath || '')]) || 0)
}

/** Next card-projection-revisions.json after a saved edit of one card. */
export function bumpCardProjectionState(value, normalizedPath) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const cards = state.cards && typeof state.cards === 'object' && !Array.isArray(state.cards) ? state.cards : {}
  const version = Math.max(0, Number(state.version) || 0) + 1
  return { version, cards: Object.assign({}, cards, { [normalizedPath]: version }) }
}

/** Serialize a card edit through persistence and its dependent projections. */
export function createCardEditor({ readCardWorkspace, cardPreparation, fileResources, bumpCardProjectionRevision, syncCardName, cardRevision, withCardLock, cardAssetWorkspaceRevision }) {
  const pending = new Map()
  async function edit(cardPath, patch, revision, rawOperations, options = {}) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    // Checked inside the card's queue: an edit made since the caller read the card wins.
    if (options.expectedRevision !== undefined && typeof cardRevision === 'function' && await cardRevision(cardPath) !== options.expectedRevision) {
      throw Object.assign(new Error('人物卡在读取之后已被修改，请重新读取后再改'), { code: 'REVISION_CONFLICT' })
    }
    if (options.expectedAssetRevision !== undefined && cardAssetWorkspaceRevision(workspace) !== options.expectedAssetRevision) throw Object.assign(new Error('Card changed'), { code: 'REVISION_CONFLICT' })
    const change = cardPreparation.update({ kind: 'card', card: workspace, patch: patch, revision: revision, rawOperations: rawOperations })
    const savedWorkspace = change.card
    if (!change.changed) {
      const unchangedCard = change.view
      unchangedCard.path = cardPath
      unchangedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
      return Object.assign({}, change, { card: unchangedCard })
    }
    await fileResources.writeWorking(normalizeResourcePath(cardPath, 'card'), JSON.stringify(savedWorkspace, null, 2))
    await bumpCardProjectionRevision(cardPath)
    const savedCard = change.view
    savedCard.path = cardPath
    savedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
    if (change.nameChanged) await syncCardName(cardPath, savedCard.name)
    return Object.assign({}, change, { card: savedCard })
  }
  return function updateCard(cardPath, patch, revision, rawOperations, options) {
    const key = normalizeResourcePath(cardPath, 'card')
    const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      // Asset bindings and ordinary card edits share the same owner lock.
      if (!withCardLock) return edit(key, patch, revision, rawOperations, options)
      const workspace = await readCardWorkspace(key)
      if (workspace === undefined) throw new Error('人物卡不存在: ' + key)
      return withCardLock(workspace.meta.id, () => edit(key, patch, revision, rawOperations, options))
    })
    pending.set(key, operation)
    const release = () => { if (pending.get(key) === operation) pending.delete(key) }
    operation.then(release, release)
    return operation
  }
}
