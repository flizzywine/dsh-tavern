import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

// Importing the very same card file again opens the card already in the library instead of
// adding "鱼 (1)" next to it (the way asset packs and presets are reused by content). A card
// counts as the same only while it is still as imported: once edited, the file brings a fresh
// copy, which is what someone re-importing an edited card wants.

const sha256 = text => createHash('sha256').update(text).digest('hex')

export function createCardImportIdentity({ cardPaths, castAssets, readCardText }) {
  async function fileSha256(file) {
    const handle = await open(file, 'r')
    try {
      const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024)
      for (;;) {
        const { bytesRead } = await handle.read(buffer)
        if (!bytesRead) return hash.digest('hex')
        hash.update(buffer.subarray(0, bytesRead))
      }
    } finally { await handle.close() }
  }

  /** The library card imported from a file with this digest and not changed since, or null. */
  async function find(archiveSha256) {
    for (const cardPath of await cardPaths()) {
      const source = (await castAssets.read(cardPath).catch(() => null))?.source
      if (!source || source.archiveSha256 !== archiveSha256) continue
      const text = await readCardText(cardPath).catch(() => undefined)
      if (text !== undefined && sha256(text) === source.cardSha256) return cardPath
    }
    return null
  }

  /** Note where a freshly imported card came from. */
  async function remember(cardPath, archiveSha256) {
    const text = await readCardText(cardPath)
    if (text === undefined) return
    await castAssets.setSource(cardPath, { archiveSha256, cardSha256: sha256(text) })
  }

  return Object.freeze({ fileSha256, find, remember })
}
