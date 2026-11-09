// A play save freezes its preset, and the frozen copy used to carry the whole
// preset twice: the normalised compatibility preset and the raw SillyTavern
// document. Both are only read by the `generate` helper; every play turn renders
// from the compiled front/middle/back. Stored per save, those documents were
// ~780 KB of identical JSON in every game, split into ~160 native blocks each,
// which dominated chat creation and deletion.
//
// A snapshot therefore keeps the compiled phases plus a digest reference, and the
// two documents live once in this content-addressed pool (the digest already
// hashes both, so an edited preset keys a new entry and old saves keep reading
// their own copy).
const DOCUMENT_FIELDS = ['compatibilityPreset', 'compatibilityPresetDocument']

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function snapshotHasDocuments(snapshot) {
  return object(snapshot) && DOCUMENT_FIELDS.some(field => object(snapshot[field]))
}

// A stored snapshot that was shortened still names the pool entry holding its documents.
export function snapshotNeedsDocuments(snapshot) {
  return object(snapshot) && !snapshotHasDocuments(snapshot)
    && typeof snapshot.presetSnapshotRef === 'string' && snapshot.presetSnapshotRef !== ''
}

export function snapshotDocuments(snapshot) {
  const documents = {}
  for (const field of DOCUMENT_FIELDS) if (object(snapshot[field])) documents[field] = snapshot[field]
  return documents
}

export function withSnapshotDocuments(snapshot, documents) {
  if (!object(snapshot) || !object(documents)) return snapshot
  const merged = { ...snapshot, ...snapshotDocuments(documents) }
  return merged
}

/** Reattach the documents a stored snapshot only references.
 * `load` reads the pool by reference; `readPreset`/`readDocument` are the preset
 * library, used when the pool entry is gone (imported saves, pruned profiles) and the
 * game still names an installed preset. Anything unresolvable stays a reference: the
 * `generate` helper then reports an unreadable preset instead of failing a play turn.
 */
export async function materializeSnapshotDocuments(snapshot, { load, readPreset, readDocument } = {}) {
  if (!snapshotNeedsDocuments(snapshot)) return snapshot
  const stored = typeof load === 'function' ? await load(snapshot.presetSnapshotRef).catch(() => null) : null
  if (object(stored) && Object.keys(snapshotDocuments(stored)).length) return withSnapshotDocuments(snapshot, stored)
  const presetPath = String(snapshot.presetPath || '')
  if (presetPath === '' || typeof readPreset !== 'function') return snapshot
  try {
    const preset = await readPreset(presetPath)
    const document = typeof readDocument === 'function' ? await readDocument(presetPath) : null
    if (preset && document) return withSnapshotDocuments(snapshot, { compatibilityPreset: preset, compatibilityPresetDocument: document })
  } catch { /* the caller reports the unreadable preset */ }
  return snapshot
}

/** Drop the pooled documents; the snapshot keeps everything a play turn renders plus the reference.
 * `text` is the join of the three phase texts and is rebuilt on read, so it is not stored either.
 * A snapshot without a digest cannot resolve its documents later, so it keeps them.
 */
export function thinPresetSnapshot(snapshot, digest = '') {
  if (!object(snapshot)) return snapshot
  let thin = snapshot
  if (typeof snapshot.text === 'string' && hasPhaseEntries(snapshot)) {
    thin = { ...snapshot }
    delete thin.text
  }
  if (!snapshotHasDocuments(thin)) return thin
  const ref = String(digest || thin.digest || '')
  if (ref === '') return thin
  thin = { ...thin, presetSnapshotRef: ref }
  for (const field of DOCUMENT_FIELDS) delete thin[field]
  return thin
}

function hasPhaseEntries(snapshot) {
  return ['front', 'middle', 'back'].every(phase => object(snapshot[phase]) && Array.isArray(snapshot[phase].entries))
}

/** Documents behind one reference; `read`/`write`/`exists` address the pool storage.
 * Without storage adapters (unit tests, read-only callers) the pool still works in memory.
 */
export function createPresetSnapshotPool({ read, write, exists, limit = 4 } = {}) {
  const cache = new Map()
  function remember(key, documents) {
    cache.delete(key)
    cache.set(key, documents)
    while (cache.size > Math.max(1, limit)) cache.delete(cache.keys().next().value)
  }
  async function save(key, documents) {
    if (!key || !object(documents) || Object.keys(documents).length === 0) return
    remember(key, documents)
    if (typeof write !== 'function') return
    if (typeof exists === 'function' && await exists(key)) return
    await write(key, documents)
  }
  async function load(key) {
    if (!key) return null
    const cached = cache.get(key)
    if (cached) {
      remember(key, cached)
      return cached
    }
    if (typeof read !== 'function') return null
    const value = await read(key).catch(() => null)
    if (!object(value)) return null
    const documents = snapshotDocuments(value)
    if (Object.keys(documents).length === 0) return null
    remember(key, documents)
    return documents
  }
  return Object.freeze({ save, load })
}
