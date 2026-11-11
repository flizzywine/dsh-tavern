// One-time move of 通用声音 / 旁白's voices off the library's retired reading-voice store (owner
// 2026-11-11): they now only point at a figure (tts.reading general / narrator .figure). A reading that was its own voice
// becomes a plain voice-only figure in a new, unlit pack 「专用声音」 (its voice, binding and reference clips as they were,
// so it sounds the same), and the pointer names it; a reading that followed a figure (link) points at that figure. 旁白 that
// was never set keeps sounding like 通用声音 by pointing at the same figure. A pointer already set is kept. Then the store
// is dropped; afterwards this does nothing. Runs when the asset library and TTS are both up.
const NAMES = {general:'通用声音', narrator:'旁白'}

export async function migrateReadingVoices({library, tts}) {
  const rows = await library.legacyReadingVoices?.()
  if (!rows) return null
  if (!rows.length) return (await library.dropLegacyReadingVoices()).dropped ? {pointers:{}} : null
  const byId = new Map(rows.map(row => [row.id, row])), pointers = {}
  let pack = null
  for (const id of ['general', 'narrator']) {
    const row = byId.get(id)
    if (!row) continue
    if (row.link) { pointers[id] = {packId:row.link.packId, figureId:row.link.figureId}; continue }
    pack ||= (await library.createPack({name:'专用声音', description:'通用声音 / 旁白原来自己的声音（迁移时建的，不对卡启用；可以改名或删除）', expectedRevision:null})).snapshot
    const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:NAMES[id], aliases:[], enabled:true, outfits:[]}})
    pack = (await library.assignLegacyReadingVoice({packId:pack.manifest.id, expectedRevision:created.snapshot.revision, readingId:id, figureId:created.figureId})).snapshot
    pointers[id] = {packId:pack.manifest.id, figureId:created.figureId}
  }
  pointers.narrator ||= pointers.general
  const reading = tts.reading(), patch = {}
  if (pointers.general && !reading.general.figure) patch.general = {figure:pointers.general}
  if (pointers.narrator && !reading.narrator.figure) patch.narrator = {figure:pointers.narrator}
  if (Object.keys(patch).length) await tts.setReading(patch)
  await library.dropLegacyReadingVoices()
  return {pack:pack?.manifest.id ?? null, pointers}
}
