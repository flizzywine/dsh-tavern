// One-time move of 通用声音 / 旁白's voices from the TTS settings into the asset library's reading voices (owner 11-09).
// When the saved settings still name one (tts.legacyReadingVoices: the old dialogueVoice and
// narrator.voice), it becomes the reading voice general / narrator, spoken as before (中文) — unless that reading voice is
// already saved — and then the old keys leave the settings (tts.dropLegacyReadingVoices). A card's old narrator voice is
// dropped when the card is next written (card-stage-settings.js). Once the keys are gone this does nothing. Runs when the
// asset library and TTS are both up.
const preset = (source, name) => ({name, language:'zh', defaultSource:'main', sources:{main:source}})

// What an old reference becomes: {copy} (a pack voice or template, clips included), {save} (its own one-source voice), or
// {drop} (a voice the library cannot hold: a plugin channel, a service that is gone).
export function readingWrite(ref, services, name) {
  if (ref.silent) return {save:{voiceSpec:preset({kind:'preset', provider:'browser'}, name), binding:{voice:'voice', source:null}}}
  if (ref.browser !== undefined) return {save:{voiceSpec:preset({kind:'preset', provider:'browser', ...(ref.browser ? {voiceName:ref.browser} : {})}, name), binding:{voice:'voice'}}}
  if (ref.templateId) return {copy:{from:{templateId:ref.templateId}, language:'zh'}}
  if (ref.voiceId) return {copy:{from:{packId:ref.packId, voiceId:ref.voiceId}, language:'zh'}}
  if (ref.serviceId) {
    const kind = services.find(row => row.id === ref.serviceId)?.kind
    if (!kind || kind === 'service') return {drop:ref.serviceId}
    const source = kind === 'fish-audio' ? {kind:'voice-id', provider:kind, voiceId:ref.voice, serviceId:ref.serviceId} : {kind:'preset', provider:kind, voiceName:ref.voice, serviceId:ref.serviceId}
    return {save:{voiceSpec:preset(source, name), binding:{voice:'voice'}}}
  }
  return {drop:'unknown'}
}

export async function migrateReadingVoices({library, tts}) {
  const legacy = tts.legacyReadingVoices?.()
  if (!legacy || !legacy.general && !legacy.narrator && !(await tts.dropLegacyReadingVoices()).dropped) return null
  const services = await tts.listServices(), saved = [], dropped = []
  for (const [id, name] of [['general', '通用声音'], ['narrator', '旁白']]) {
    const ref = legacy[id]
    if (!ref || (await library.getReadingVoice({id})).reading) continue
    const write = readingWrite(ref, services, name)
    if (write.drop) { dropped.push(id); continue }
    if (write.copy) await library.copyReadingVoice({id, expectedRevision:null, ...write.copy})
    else await library.saveReadingVoice({id, expectedRevision:null, ...write.save})
    saved.push(id)
  }
  await tts.dropLegacyReadingVoices()
  return {saved, dropped}
}
