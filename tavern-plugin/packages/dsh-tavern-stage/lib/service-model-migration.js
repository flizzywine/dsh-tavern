// One-time move of the Fish / MiniMax model from 配音后端 to the figure (配音后端 keeps only the connection; each figure's
// source picks its own `model`). When the saved TTS settings still give such a service a model (tts.legacyServiceModels),
// every source of that kind that speaks through that service — by the same choice synthesis makes (tts.chooseService) —
// and has no model of its own takes it; then the model leaves the service (tts.dropLegacyServiceModels). Every figure keeps
// the voice and model it spoke with, and once the field is gone this does nothing. Runs when the asset library and TTS are both up.
export async function migrateServiceSourceModels({library, tts}) {
  const legacy = tts.legacyServiceModels?.() || []
  if (!legacy.length) return null
  const models = new Map(legacy.map(row => [row.serviceId, row])), services = await tts.listServices()
  let packs = 0, sources = 0
  for (const pack of await library.listPacks()) {
    const voices = pack.manifest?.voiceLibrary?.voices
    if (!voices) continue
    const voiceLibrary = structuredClone(pack.manifest.voiceLibrary)
    let changed = 0
    for (const voice of Object.values(voiceLibrary.voices)) for (const source of Object.values(voice.sources || {})) {
      if (source.model) continue
      const row = models.get(tts.chooseService(source, services)?.id)
      if (row?.kind === source.provider) { source.model = row.model; changed++ }
    }
    if (!changed) continue
    await library.patchPack({packId:pack.manifest.id, expectedRevision:pack.revision, patch:{voiceLibrary}})
    packs++; sources += changed
  }
  const {dropped} = await tts.dropLegacyServiceModels()
  return {packs, sources, services:dropped}
}
