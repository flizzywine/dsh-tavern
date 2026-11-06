import { stat } from 'node:fs/promises'

// Keep only detached catalog summaries, never a mutable card workspace.
// Each cached value is revalidated against the backing file's stat fingerprint.
export function createCardSummaryCache({ absolute, read, limit = 512 }) {
  const entries = new Map()
  async function fingerprint(path) {
    let value
    try { value = await stat(absolute(path), { bigint: true }) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
  }
  return {
    async read(path) {
      try {
        const before = await fingerprint(path)
        const cached = entries.get(path)
        if (before !== null && cached?.revision === before) return { ...cached.summary }
        const summary = await read(path)
        // Migration or an external edit during reading must not cache stale data.
        if (before !== null && before === await fingerprint(path)) {
          entries.delete(path)
          entries.set(path, { revision: before, summary: { ...summary } })
          if (entries.size > limit) entries.delete(entries.keys().next().value)
        } else entries.delete(path)
        return { ...summary }
      } catch (error) {
        entries.delete(path)
        throw error
      }
    }
  }
}
