import { normalizeResourcePath } from './file-resources.js'

export function createCardDeletion(options = {}) {
  const resources = options.resources
  if (resources === undefined || typeof resources.remove !== 'function' || typeof resources.unbindMaterial !== 'function') {
    throw new Error('缺少人物卡资源存储')
  }

  async function remove(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    await resources.remove(normalized)
    await resources.unbindMaterial(normalized)
    return { deleted: true, cardPath: normalized }
  }

  return Object.freeze({ remove })
}
