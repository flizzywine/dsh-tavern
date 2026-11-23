import { normalizeResourcePath } from './file-resources.js'

export function createCardDeletion({ resources, cardStorage } = {}) {
  if (resources === undefined || typeof resources.remove !== 'function' || typeof resources.unbindMaterial !== 'function') {
    throw new Error('缺少人物卡资源存储')
  }

  async function remove(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const cardId = await cardStorage.findId(normalized)
    async function removeFiles() {
      await resources.remove(normalized)
      await resources.unbindMaterial(normalized)
    }
    // A retry after the working file is gone can still finish the path-based cleanup.
    if (cardId === undefined) await removeFiles()
    else await cardStorage.withCardLock(cardId, removeFiles)
    return { deleted: true, cardPath: normalized }
  }

  return Object.freeze({ remove })
}
