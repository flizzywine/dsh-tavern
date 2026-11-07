import { effectiveNarrator } from './card-stage-settings.js'
import { figureTtsVoice, catalogueTtsVoice } from './figure-voice.js'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

// 台词朗读 (the 🔊 on a reply, and plugins' synthesizeSpeech): every line is spoken by the voice service (tts). Tavern keeps
// no speech channels or audio cache of its own; plugin speech providers join the voice service as its providers.

const MAX_TEXT = 1000
const PRINCIPAL = 'dsh-browser', SCOPE = 'dsh-browser'
// Events after which a registered reading voice may name a provider that changed or is gone.
const RESET_EVENTS = ['disposed', 'providerChanged', 'providerRemoved', 'cacheInvalidated']
const failure = code => Object.assign(new Error(code), { code })
// The card speech's narrator key and voice digest (asset-pack-speech.js NARRATOR_VOICE / assetPackDigest), restated because the core
// loads without the stage package; a reading voice registers the same source as the stage's narrator.
export const NARRATOR_ALIAS = '\u0000narrator'
const voiceDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex')

/** Text worth saying: markup and decoration out, at most MAX_TEXT characters. */
export function speechText(value) {
  const text = String(value || '').replace(/<[^>]*>/g, '').replace(/[*_~`#>|]/g, '').replace(/\s+/g, ' ').trim()
  return [...text].slice(0, MAX_TEXT).join('')
}

/** No voice service: the line stays silent and the caller shows it as a diagnostic. */
export const TTS_UNAVAILABLE = Object.freeze({ skip: true, reason: 'TTS_UNAVAILABLE' })

/**
 * One line in its voice. A speaker with a figure voice on this card speaks through the card's asset-pack speech (`figures`,
 * from the stage); other dialogue uses tts.reading().dialogueVoice. Narration speaks only when the narrator is enabled
 * (effectiveNarrator: the card layer over tts.reading().narrator).
 * Answers { url, mediaType, loudness } (a voice-service audio ticket), { browser: true, voice, text } for the browser's own
 * voices, or { skip: true, reason }.
 * @param {object} input
 * @param {() => object|undefined} input.getTts the voice service (ctx 'tts')
 */
export function createLineSpeech({ getTts, getLibrary }) {
  const voices = new Map()
  let bound, offTts, active = 0
  function serviceOf() {
    const tts = getTts()
    if (tts !== bound) { reset(); bound = tts; offTts = tts?.apiVersion === 1 ? tts.subscribe(event => { if (RESET_EVENTS.includes(event.type)) reset() }) : undefined }
    return tts?.apiVersion === 1 ? tts : null
  }
  function reset() {
    offTts?.(); offTts = undefined
    for (const entry of voices.values()) entry.then(value => { value.grant.dispose(); value.source?.dispose() }, () => {})
    voices.clear()
  }
  const url = (tts, ticket, loudness) => ({ url: tts.audioUrl(ticket), mediaType: 'audio/wav', ...(loudness ? { loudness } : {}) })
  const mood = emotion => !emotion || emotion === 'neutral' ? 'default' : emotion

  // A browser system voice or a configured service's voice ({serviceId, voice}, the voice picker's shapes); null = the
  // browser's default voice. A preset service voice registers as the one-source voice the stage's narrator uses (same
  // source id, so their audio is shared); a catalogue voice of a 'service' provider (a plugin's channel) speaks by its id.
  function openBinding(tts, { serviceId, voice: name }) {
    const key = JSON.stringify([serviceId, name])
    if (!voices.has(key)) {
      const opening = (async () => {
        const kind = (await tts.listServices()).find(row => row.id === serviceId)?.kind
        if (!kind) throw failure('SERVICE_OFFLINE')
        if (kind === 'service') return { voiceId: name, grant: tts.grantServiceConsumer({ principal: PRINCIPAL, scope: SCOPE }) }
        const spec = { name: '旁白', language: 'zh', defaultSource: 'narrator',
          sources: { narrator: kind === 'fish-audio' ? { kind: 'voice-id', provider: kind, voiceId: name } : { kind: 'preset', provider: kind, voiceName: name } } }
        const voice = figureTtsVoice({ voice: 'narrator' }, spec, 'narrator'), binding = { serviceId }
        const revision = voiceDigest({ voice, readings: [], binding, id: name, language: 'zh' }), sourceId = `narrator:${revision}`
        const source = tts.registerVoiceSource({ owner: 'dsh-tavern', sourceId, revision, voices: [voice], bindings: { voice: serviceId },
          readReference: async () => { throw failure('MISSING_REFERENCE') } })
        try { return { ref: { source: sourceId, id: 'voice' }, source, grant: tts.grantConsumer({ principal: PRINCIPAL, source: sourceId, scope: SCOPE }) } }
        catch (error) { source.dispose(); throw error }
      })()
      voices.set(key, opening)
      opening.catch(() => { if (voices.get(key) === opening) voices.delete(key) })
    }
    return voices.get(key)
  }
  async function bindingLine(tts, binding, text, emotion) {
    if (binding?.silent) return {skip:true, reason:'silent'}
    if (binding?.templateId || binding?.voiceId) {
      const selected = await catalogueTtsVoice(getLibrary(),tts,binding)
      if (selected.browser !== undefined) return {browser:true,voice:selected.browser,text}
      const revision = voiceDigest({voice:selected.voice,binding:selected.binding,revision:selected.revision})
      const sourceId = 'reading:' + revision
      if (!voices.has(sourceId)) {
        const source = tts.registerVoiceSource({owner:'dsh-tavern',sourceId,revision,voices:[selected.voice],bindings:{voice:selected.binding.serviceId},readReference:selected.readReference})
        try { voices.set(sourceId,Promise.resolve({source,grant:tts.grantConsumer({principal:PRINCIPAL,source:sourceId,scope:SCOPE})})) }
        catch (error) { source.dispose(); throw error }
      }
      const {grant} = await voices.get(sourceId)
      const result = await tts.synthesize({voice:{source:sourceId,id:'voice'},text,mood:mood(emotion),language:'zh'},{grant:grant.grant,scope:SCOPE})
      return url(tts,await tts.createAudioTicket({key:result.key,grant:grant.grant}),result.loudness)
    }
    if (!binding || binding.browser !== undefined) return { browser: true, voice: binding?.browser || '', text }
    const opened = await openBinding(tts, binding)
    const input = opened.voiceId ? { voiceId: opened.voiceId, text, language: 'zh' } : { voice: opened.ref, mood: mood(emotion), text, language: 'zh' }
    const result = await tts.synthesize(input, { grant: opened.grant.grant, scope: SCOPE })
    return url(tts, await tts.createAudioTicket({ key: result.key, grant: opened.grant.grant }), result.loudness)
  }
  // A figure's (or the card's narrator's) voice through the card's asset-pack speech; null when she has none here.
  async function figureLine(tts, figures, alias, text, emotion) {
    let opened = await figures.open(alias)
    // A fresh runtime's first open can race its own revision check; it asks to be opened again.
    if (opened.diagnostics?.[0] === 'TTS_STALE') opened = await figures.open(alias)
    if (!opened.available) return null
    if (opened.browser) return { browser: true, voice: opened.browser.voice || '', text }
    const { requestId } = tts.jobs.submit({ voice: opened.voice, text, mood: mood(emotion), language: opened.language }, { principal: PRINCIPAL, scope: opened.scope })
    for (;;) {
      const status = await tts.jobs.wait(requestId, PRINCIPAL)
      if (status.state === 'ready') return url(tts, status.result.ticket, status.result.loudness)
      if (status.state !== 'running') throw failure(status.error || 'SERVICE_OFFLINE')
    }
  }

  /**
   * @param {object} line
   * @param {object|null} [line.figures] the card's asset-pack speech (createAssetPackSpeech), when the stage has it
   * @param {object} [line.extension] the card's asset extension (its stage.narrator layer)
   */
  async function speak({ text: raw, speaker = '', emotion = 'neutral', narration = false, figures = null, extension } = {}) {
    const tts = serviceOf()
    if (!tts) return TTS_UNAVAILABLE
    const text = speechText(raw)
    if (!text) return { skip: true, reason: 'empty' }
    if (narration) {
      if (figures) return await figureLine(tts, figures, NARRATOR_ALIAS, text, emotion) || { skip: true, reason: 'narration' }
      const narrator = effectiveNarrator(extension, tts.reading().narrator, tts.reading().dialogueVoice)
      // A figure narrator ({packId, figureId}) speaks only where the stage resolves her.
      if (!narrator.enabled || narrator.voice && !narrator.voice.silent && narrator.voice.browser === undefined && !narrator.voice.serviceId && !narrator.voice.voiceId && !narrator.voice.templateId) return { skip: true, reason: 'narration' }
      return bindingLine(tts, narrator.voice, text, emotion)
    }
    const name = String(speaker || '').trim()
    if (figures && name && await figures.voiced(name)) {
      const spoken = await figureLine(tts, figures, name, text, emotion)
      if (spoken) return spoken
    }
    return bindingLine(tts, tts.reading().dialogueVoice, text, emotion)
  }
  return Object.freeze({
    async speak(line) { active++; try { return await speak(line) } finally { active-- } },
    async read({text: raw} = {}) {
      active++
      try {
        const tts = serviceOf()
        if (!tts) return TTS_UNAVAILABLE
        const text = speechText(raw)
        return text ? await bindingLine(tts, tts.reading().readAloud.voice, text) : {skip:true, reason:'empty'}
      } finally { active-- }
    },
    pendingCount: () => active,
    dispose: reset
  })
}

/**
 * Plugin speech providers (tavern.speechProvider with synthesize) as voice-service providers 'tavern-plugin:<owner>:<id>':
 * kind 'service' with their own engine, the plugin's voices as its catalogue, the plugin's version as its revision.
 * Recognition-only providers are not voice-service providers.
 * @param {object} input
 * @param {() => Array} input.providers synthesize-capable plugin speech providers ({ id: 'owner/id', owner, label, voices, version, synthesize })
 * @param {(bytes: Uint8Array, mediaType: string) => Promise<Uint8Array>} input.toWav the audio as WAV
 * @param {(error: Error) => void} [input.warn]
 */
export function createSpeechProviderBridge({ providers, toWav, warn = () => {} }) {
  const registered = new Map()
  let tts
  const serviceIdOf = entry => 'tavern-plugin:' + entry.id.replace('/', ':')
  function adapter(entry) {
    const serviceId = serviceIdOf(entry), revision = entry.version || '0'
    const catalogue = entry.voices.filter(voice => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(voice))
      .map(voice => ({ id: voice, label: voice, engine: serviceId, languages: ['zh', 'ja', 'en'], state: 'ready', revision }))
    return { id: serviceId, kind: 'service', revision, capabilities: { serviceVoiceEngines: [serviceId] },
      health: async () => ({ state: 'ready' }),
      catalog: async () => structuredClone(catalogue),
      async synthesize(input, { signal }) {
        const result = await entry.synthesize({ text: input.text, voice: input.voiceId, emotion: !input.mood || input.mood === 'default' ? 'neutral' : input.mood, signal })
        if (!result?.data?.length) throw failure('SERVICE_OFFLINE')
        return toWav(result.data, String(result.mediaType || ''))
      } }
  }
  function sync() {
    const wanted = new Map(tts ? providers().map(entry => [serviceIdOf(entry), entry]) : [])
    for (const [serviceId, row] of registered) if (wanted.get(serviceId) !== row.entry) { row.off(); registered.delete(serviceId) }
    for (const [serviceId, entry] of wanted) {
      if (registered.has(serviceId)) continue
      try { registered.set(serviceId, { entry, off: tts.registerProvider(entry.owner, adapter(entry)) }) }
      catch (error) { warn(error) }
    }
  }
  return Object.freeze({
    sync,
    /** The voice service the bridge registers into; returns the detach. */
    attach(service) {
      tts = service?.apiVersion === 1 ? service : undefined
      sync()
      return () => { if (tts === service) { tts = undefined; sync() } }
    }
  })
}
