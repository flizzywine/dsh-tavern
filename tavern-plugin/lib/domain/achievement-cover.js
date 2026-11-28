import { createRequire } from 'node:module'
import { createFileResourceStore } from './file-resources.js'

const require = createRequire(import.meta.url)
const MAX_COVER_BYTES = 150_000

/** The same bounded thumbnail is used for unlock notifications and the library. */
export function createAchievementCoverReader(dataRoot) {
  const resources = createFileResourceStore({ dataRoot })
  return async cardPath => {
    if (!cardPath) return undefined
    try {
      const cover = await resources.cardImagePreview(cardPath)
      if (!cover) return undefined
      const sharp = require('sharp')
      const bytes = await sharp(await cover.read(), { limitInputPixels: 40_000_000 })
        .resize({ width: 480, height: 720, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer()
      if (bytes.length <= MAX_COVER_BYTES) return 'data:image/webp;base64,' + bytes.toString('base64')
    } catch {
      return undefined
    }
  }
}
