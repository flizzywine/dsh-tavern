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
