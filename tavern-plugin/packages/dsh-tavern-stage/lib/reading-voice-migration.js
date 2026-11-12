// One-time move of 通用声音 / 旁白's voices off the library's retired reading-voice store: they now only
// point at a figure (tts.reading general / narrator .figure). A reading that was its own voice goes onto its figure in the
// 系统设置包 (「通用声音」 / 「旁白声音」, dsh-presentation-protocol/src/system-pack.cjs; ensureSystemPack made them) with its voice, binding and
// reference clips as they were (so it sounds the same), the voice named after the figure. 旁白 that was never set gets a copy
// of 通用声音's own voice on 旁白声音, so it sounds the same and is edited on its own; when 通用声音 followed a figure (link),
// 旁白 points at that figure too. A reading that followed a figure points at it. A pointer already set is kept. Then the store
// is dropped; afterwards this does nothing.
import systemPack from '../../dsh-presentation-protocol/src/system-pack.cjs'

const {SYSTEM_PACK, SYSTEM_FIGURES} = systemPack

export async function migrateReadingVoices({library, tts}) {
  const rows = await library.legacyReadingVoices?.()
  if (!rows) return null
  if (!rows.length) return (await library.dropLegacyReadingVoices()).dropped ? {pointers:{}} : null
  const byId = new Map(rows.map(row => [row.id, row])), pointers = {}
  for (const id of ['general', 'narrator']) {
    // 旁白 never set starts from 通用声音's own voice (a link is followed by pointing below).
    const row = byId.get(id) || (byId.get('general')?.link ? null : byId.get('general'))
    if (!row) continue
    if (row.link) { pointers[id] = {packId:row.link.packId, figureId:row.link.figureId}; continue }
    const pack = await library.getPackSnapshot({packId:SYSTEM_PACK.id}), figureId = SYSTEM_FIGURES[id].id
    await library.assignLegacyReadingVoice({packId:SYSTEM_PACK.id, expectedRevision:pack.revision, readingId:row.id, figureId})
    pointers[id] = {packId:SYSTEM_PACK.id, figureId}
  }
  pointers.narrator ||= pointers.general
  const reading = tts.reading(), patch = {}
  if (pointers.general && !reading.general.figure) patch.general = {figure:pointers.general}
  if (pointers.narrator && !reading.narrator.figure) patch.narrator = {figure:pointers.narrator}
  if (Object.keys(patch).length) await tts.setReading(patch)
  await library.dropLegacyReadingVoices()
  return {pointers}
}
