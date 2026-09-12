import { exportSillyTavernWorldBook } from './worldbook-resource.js'

/** An isolated playable copy: primary metadata/IDs win; content is never deduplicated. */
export function mergeWorldBooks(records) {
  if (!Array.isArray(records) || records.length === 0) return null
  const documents = records.map(record => exportSillyTavernWorldBook(record.document ?? record.view.raw))
  for (const document of documents) {
    for (const [key, entry] of Object.entries(document.entries)) entry.uid = Number(entry.uid ?? key)
  }
  const merged = structuredClone(documents[0])
  merged.name = records[0].view?.displayName || merged.name || '世界书'
  delete merged.originalData
  merged.entries = {}
  const used = new Set()
  // Reserve every original ID before assigning replacements, including later books.
  const reserved = new Set(documents.flatMap(document => Object.values(document.entries).map(entry => entry.uid)))
  let next = 0
  let displayIndex = 0
  const sources = []
  documents.forEach((document, bookIndex) => {
    const mapping = []
    // Keep each book's display order, then place supplementary books after it.
    const ordered = Object.values(document.entries).map((entry, index) => ({ entry, index }))
      .sort((a, b) => (Number(a.entry.displayIndex ?? a.index) - Number(b.entry.displayIndex ?? b.index)) || a.index - b.index)
    for (const { entry: original } of ordered) {
      if (!Number.isSafeInteger(original.uid) || original.uid < 0) throw new Error('世界书条目编号无效')
      let uid = original.uid
      if (used.has(uid)) {
        while (reserved.has(next) || used.has(next)) next++
        uid = next++
      }
      used.add(uid)
      merged.entries[uid] = { ...structuredClone(original), uid, displayIndex: displayIndex++ }
      mapping.push({ originalUid: original.uid, uid })
    }
    sources.push({ source: structuredClone(records[bookIndex].source), name: document.name || records[bookIndex].view?.displayName || '', entries: mapping })
  })
  return { document: merged, sources }
}
