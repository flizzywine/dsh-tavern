import { normalizeResourcePath } from './file-resources.js'

/** Serialize a card edit through persistence and its dependent projections. */
export function createCardEditor({ readCardWorkspace, cardPreparation, fileResources, bumpCardProjectionRevision, syncCardName }) {
  const pending = new Map()
  async function edit(cardPath, patch, revision, rawOperations) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
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
  return function updateCard(cardPath, patch, revision, rawOperations) {
    const key = normalizeResourcePath(cardPath, 'card')
    const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => edit(key, patch, revision, rawOperations))
    pending.set(key, operation)
    const release = () => { if (pending.get(key) === operation) pending.delete(key) }
    operation.then(release, release)
    return operation
  }
}
