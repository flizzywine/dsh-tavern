import { withCardCover } from '../../../lib/domain/card-cover.js'
import { CARD_ID } from '../../../lib/card-storage.js'

// Reservations contain identities only; the existing bundle publication writes all data.
export function createCardZipTargets({id, listCards, readWorkspace, importCard}) {
  const reservations = new Map()
  async function assertUnused(cardId, path) {
    for (const existing of await listCards()) {
      const workspace = await readWorkspace(existing)
      if (existing === path || workspace?.meta.id === cardId) {
        throw Object.assign(new Error('Card ID or path already exists: ' + cardId), {code:'DUPLICATE_ID'})
      }
    }
  }
  return {
    async reserve() {
      const cardId = id()
      if (!CARD_ID.test(cardId)) throw new Error('Invalid cardId')
      const path = 'cards/' + cardId + '.json'
      if (reservations.has(path)) throw Object.assign(new Error('Card ID already reserved: ' + cardId), {code:'DUPLICATE_ID'})
      await assertUnused(cardId, path)
      reservations.set(path, cardId)
      return {path}
    },
    release(path) { reservations.delete(path); return {status:'released'} },
    get(path) { const cardId = reservations.get(path); return cardId ? {cardId} : null },
    async commit(path, workspace, cover) {
      const cardId = reservations.get(path)
      if (!cardId || workspace.meta.id !== cardId) throw Object.assign(new Error('Card reservation unavailable'), {code:'NOT_FOUND'})
      await assertUnused(cardId, path)
      await importCard({name:path.slice('cards/'.length), text:JSON.stringify(workspace.raw, null, 2), ...(cover ? {kind:'png', fileB64:withCardCover(cover, workspace.raw).toString('base64')} : {})}, workspace)
      reservations.delete(path)
    }
  }
}
