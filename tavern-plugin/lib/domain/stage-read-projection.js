// Read-only coordinates remain those of the complete archive. This tag is never persisted.
const scopes = new WeakMap()
export const stageReadScope = chat => scopes.get(chat)
export function markStageRead(chat, scope) { scopes.set(chat, scope); return chat }

export const stageReadHeaderFields = [
  'id','sessionId','_storageRevision','mode','cardPath','cardName','cardContextRevision',
  'backgroundConfigVersion','conversationFeaturesVersion','requestMode','macroState',
  'timeline.branchId','timeline.revision','timeline.operations','regenInProgress',
  'cardDefinitionSnapshot','runtimePresetSnapshot','openingWorldbookSnapshot','openingText',
  'presentation','foregroundCapabilities','variables','promptTemplateInitialVariables','ledger','mvu.enabled',
  'tavernHelperLifecycleRevision','updatedAt'
]
export const stageReadIdentityFields = ['id','role','turn','greeting','swipeId','swipes','sourceText','text','polishedFrom']
export const stageReadDisplayFields = ['projectionText','tavernPluginData.template_display']
export const stageReadRecordFields = ['stageDirectionAssetPacks']
// Small per-floor stage state (a few KB per archive): every prefix floor carries it, so one turn view also answers the
// countdown, item and mod history readers of any earlier turn.
export const stageReadFloorFields = ['stageDirectionGeneration','stageTimerV1','modCorrections','stageItems']
export const stageReadCurrentFields = ['stageDirectionAssetPacksFailure','stagePlaybackV1','openingId']
// A chain-only turn view: an earlier floor carries its hashed source and the
// identity of its record (digest, binding target, performance boundary), not the record. The state of round N is
// local to record N, which only the target floor carries in full.
export const stageReadChainFields = ['role','turn','sourceText','polishedFrom','stageDirectionAssetPacks.digest',
  'stageDirectionAssetPacks.binding.target.sourceKey','stageDirectionAssetPacks.binding.target.predecessorDigest',
  'stageDirectionAssetPacks.baseline.performance']
// An earlier round's record as its consumers read it (phone, widget windows, mod history, the page's predecessor chain):
// without the judge's per-asset probabilities of that round's generation (~75 KB, most of a record's blocks), which only
// generation and the latest round's capabilities read, from the complete floor.
export const stageReadEarlierOmitted = ['stageDirectionAssetPacks.stats.judge.probabilities']
// Each earlier round's beats as the phone and widget windows look for their marks: the record digest, its bound source
// views and each beat's paragraph and ops, never its state (a few KB a round).
export const stageReadOpsFields = ['stageDirectionAssetPacks.digest','stageDirectionAssetPacks.binding.mods.sourceViews',
  'stageDirectionAssetPacks.entries.*.at','stageDirectionAssetPacks.entries.*.ops']
// A consumer of earlier rounds (phone, widget windows, mod history) names them: their floors carry the full fields too.
export const stageReadIdentityOnly = (chat, index) => {
  const scope = scopes.get(chat)
  return !!scope?.chainOnly && index !== scope.index && !scope.full.includes(index)
}
const turnOf = row => Number(row.turn || (row.greeting ? 1 : 0))
// Whether a stage view carries round `turn` in full (a complete chat carries every round; a missing round reads as missing).
export function stageReadCarries(chat, turn) {
  const index = chat.messages.findIndex(row => row.role === 'assistant' && turnOf(row) === Number(turn))
  return index < 0 || !stageReadIdentityOnly(chat, index)
}
// Of the latest `count` assistant turns through `turn`, those whose floor carries a stage record (or its identity): the
// rounds a history consumer may find director operations in. An earlier floor without a record has no direction token.
export function stageRecordRounds(chat, turn, count = Infinity) {
  const rows = chat.messages.filter(row => row.role === 'assistant' && turnOf(row) <= turn)
  return [...new Set(rows.map(turnOf))].sort((a, b) => a - b).slice(-count)
    .filter(number => rows.some(row => turnOf(row) === number && row.stageDirectionAssetPacks))
}

// The stage's reads of a save, on storage's pinned snapshots (open: chatId, {revision} → snapshot or null; whole: the
// complete chat, for storage without snapshots). Storage knows no stage field; these field lists are the stage's own.
export function createStageReads({open, whole}) {
  // One pinned head supplies identity headers and the requested prefix, not historical payloads.
  // chainOnly: earlier floors carry the record identity, not the record (stageReadChainFields); readFloors reads
  // the earlier floors a history consumer names.
  async function readView(id, {turn, configOnly = false, stateOnly = false, sourceOnly = false, chainOnly = false} = {}) {
    const snapshot = await open(id)
    if (!snapshot) return whole(id)
    const chat = await snapshot.header(sourceOnly ? ['id','sessionId','_storageRevision','timeline.branchId','timeline.revision'] : stageReadHeaderFields)
    const summaries = await snapshot.summaries()
    chat.messages = structuredClone(summaries)
    if (stateOnly) {
      for (let position = chat.messages.length - 1; position >= 0; position--) {
        if (chat.messages[position].role !== 'assistant') continue
        const record = await snapshot.get((await snapshot.refs([position])).get(position), 'stageDirectionAssetPacks')
        if (record) { chat.messages[position].stageDirectionAssetPacks = record; break }
      }
      return markStageRead(chat, {stateOnly: true})
    }
    const requested = Number(turn) || Math.max(0, ...summaries.filter(row => row.role === 'assistant').map(turnOf))
    const target = row => row.role === 'assistant' && turnOf(row) === requested
    const index = sourceOnly ? summaries.findLastIndex(target) : summaries.findIndex(target)
    const latestAssistant = summaries.findLastIndex(row => row.role === 'assistant'), latestUser = summaries.findLastIndex(row => row.role === 'user')
    const indices = configOnly ? [latestAssistant, latestUser].filter(i => i >= 0).sort((a, b) => a - b) : Array.from({length: index + 1}, (_, i) => i)
    // Page metadata is small and already contains original coordinates; payload reads stop at the target.
    const references = await snapshot.refs(indices)
    const values = await snapshot.map(indices, async position => {
      const ref = references.get(position)
      if (sourceOnly) {
        // Prefix hashing consumes the preferred source, not duplicate display text or inactive swipes.
        const row = await snapshot.fields(ref, position === index ? ['id','role','turn','greeting','swipeId','stageDirectionGeneration','sourceText'] : ['role','turn','sourceText'])
        if (row.sourceText == null) { const text = await snapshot.get(ref, 'text'); if (text !== undefined) row.text = text }
        if (position === index) {
          const swipe = Math.max(0, Number(row.swipeId) || 0), selected = await snapshot.selectedSwipe(ref, swipe)
          if (selected !== undefined) row.swipes = {[swipe]: selected}
        }
        return row
      }
      if (chainOnly && position !== index) {
        const row = await snapshot.fields(ref, [...stageReadChainFields, ...stageReadFloorFields])
        if (row.sourceText == null) { const text = await snapshot.get(ref, 'text'); if (text !== undefined) row.text = text }
        return row
      }
      return snapshot.fields(ref, configOnly ? [...stageReadIdentityFields, 'stageDirectionAssetPacks.stats.judge.probabilities']
        : [...stageReadIdentityFields, ...stageReadDisplayFields, ...stageReadRecordFields, ...stageReadFloorFields, ...(position === index ? stageReadCurrentFields : [])])
    })
    indices.forEach((position, i) => { chat.messages[position] = {...chat.messages[position], ...values[i]} })
    return markStageRead(chat, {turn: requested, index, configOnly, ...(sourceOnly ? {sourceOnly: true} : {}), ...(chainOnly ? {chainOnly: true, full: []} : {})})
  }
  // The earlier floors (indices) a chain-only view's consumer names, at `revision`: by default each as a stage view
  // reads an earlier floor in full, its record without the judge probabilities (stageReadEarlierOmitted); `fields`
  // selects others (the record alone, or each beat's ops).
  async function readFloors(id, indices, {revision, fields = [...stageReadIdentityFields, ...stageReadDisplayFields, ...stageReadRecordFields, ...stageReadFloorFields]} = {}) {
    const snapshot = await open(id, {revision: revision ?? Infinity})
    if (!snapshot) return null
    const references = await snapshot.refs(indices)
    return snapshot.map(indices, position => references.has(position) ? snapshot.fields(references.get(position), fields, stageReadEarlierOmitted) : undefined, true)
  }
  // The stage record of each named floor at `revision`: a chain-only turn view resolves the earlier records it needs by
  // index once its chain is known. Floors without a record give undefined.
  async function readRecords(id, indices, {revision} = {}) {
    return ((await readFloors(id, indices, {revision, fields: ['stageDirectionAssetPacks']})) || []).map(row => row?.stageDirectionAssetPacks)
  }
  return Object.freeze({readView, readFloors, readRecords})
}
