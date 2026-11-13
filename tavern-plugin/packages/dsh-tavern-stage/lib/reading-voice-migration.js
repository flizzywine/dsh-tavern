// 通用声音 / 旁白 point at a figure each (tts.reading general / narrator .figure). Once, at startup, a role that points at
// nothing gets the figure 「通用声音」 / 「旁白声音」 in a new ordinary pack 「系统设置（请勿删除）」 (owner 11-12), and is
// pointed at it: carrying its voice from the library's retired reading-voice store when it had one there (旁白 never set
// takes 通用声音's, a copy of its own), else the browser's voice. A role that followed a figure (link) points at that figure.
// Runs only while both roles point at nothing or the retired store still holds something; afterwards the pack is an
// ordinary pack (deleting it leaves the roles pointing at a figure that is gone).
const PACK = {name:'系统设置（请勿删除）', description:'通用声音和旁白声音用的是这个包里的人物。'}
const NAMES = {general:'通用声音', narrator:'旁白声音'}
const browserVoice = name => ({name, language:'zh', defaultSource:'main', sources:{main:{kind:'preset', provider:'browser'}}})

export async function migrateReadingVoices({library, tts}) {
  const rows = await library.legacyReadingVoices?.(), reading = tts.reading()
  if (!rows) return null
  if (!rows.length && (reading.general.figure || reading.narrator.figure)) return (await library.dropLegacyReadingVoices()).dropped ? {pointers:{}} : null
  const byId = new Map(rows.map(row => [row.id, row])), pointers = {}
  let pack = null
  for (const id of ['general', 'narrator']) {
    if (reading[id].figure) continue
    const row = byId.get(id) || byId.get('general')
    if (row?.link) { pointers[id] = {packId:row.link.packId, figureId:row.link.figureId}; continue }
    pack ||= (await library.createPack({...PACK, expectedRevision:null})).snapshot
    const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:NAMES[id], aliases:[], enabled:true, outfits:[]}})
    const input = {packId:pack.manifest.id, expectedRevision:created.snapshot.revision, figureId:created.figureId}
    pack = (row ? await library.assignLegacyReadingVoice({...input, readingId:row.id}) : await library.createAndAssignPackVoice({...input, voiceSpec:browserVoice(NAMES[id])})).snapshot
    pointers[id] = {packId:pack.manifest.id, figureId:created.figureId}
  }
  if (Object.keys(pointers).length) await tts.setReading(Object.fromEntries(Object.entries(pointers).map(([id, figure]) => [id, {figure}])))
  if (rows.length) await library.dropLegacyReadingVoices()
  return {pack:pack?.manifest.id ?? null, pointers}
}
