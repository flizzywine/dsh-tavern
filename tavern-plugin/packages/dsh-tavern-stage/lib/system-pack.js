// The 系统设置包 (dsh-presentation-protocol/src/system-pack.cjs): the host keeps it whole. A missing pack or system figure is
// created again from its default (fixed ids, so 通用声音 / 旁白声音's pointers at them stay valid); what exists is never
// rewritten, so the owner's edits stay. Runs at startup only: what the owner deleted comes back at the next start.
import systemPack from '../../dsh-presentation-protocol/src/system-pack.cjs'
import { migrateReadingVoices } from './reading-voice-migration.js'

const {SYSTEM_PACK, SYSTEM_FIGURES, systemFigureDefault} = systemPack

// → the roles whose figure it created (empty when the pack was whole).
export async function ensureSystemPack(library) {
  let pack = await library.getPackSnapshot({packId:SYSTEM_PACK.id})
  if (!pack) pack = (await library.createPack({id:SYSTEM_PACK.id, name:SYSTEM_PACK.name, description:SYSTEM_PACK.description, expectedRevision:null})).snapshot
  const created = []
  for (const [role, {id}] of Object.entries(SYSTEM_FIGURES)) {
    if (pack.figures[id]) continue
    const {figure, voiceSpec} = systemFigureDefault(role)
    const made = await library.createFigure({packId:SYSTEM_PACK.id, expectedRevision:pack.revision, id, figure})
    pack = (await library.createAndAssignPackVoice({packId:SYSTEM_PACK.id, figureId:id, expectedRevision:made.snapshot.revision, voiceSpec})).snapshot
    created.push(role)
  }
  return created
}

// Startup: the pack is made whole, the retired reading voices move onto its figures (reading-voice-migration.js), and a role
// pointing at nothing points at its system figure when that figure was just made.
export async function setupSystemVoices({library, tts, ensure = () => ensureSystemPack(library)}) {
  const created = await ensure()
  const migrated = await migrateReadingVoices({library, tts})
  const reading = tts.reading(), patch = {}
  for (const role of created) if (!reading[role].figure) patch[role] = {figure:{packId:SYSTEM_PACK.id, figureId:SYSTEM_FIGURES[role].id}}
  if (Object.keys(patch).length) await tts.setReading(patch)
  return created.length || migrated || Object.keys(patch).length ? {created, migrated, pointed:Object.keys(patch)} : null
}
