import {randomUUID} from 'node:crypto'
import {mkdir,open,rename} from 'node:fs/promises'
import path from 'node:path'
import {checkedPath} from './storage.js'
import {check,validateUuid,validateShortId} from '../asset-packs/common.js'
import {createHash} from 'node:crypto'
import {validateVoiceBinding,validateVoiceSpec,voiceReferences} from '../shared/voice-schema.js'
import {jsonBytes,readDocument} from './validation.js'
import {audioKind,MEDIA_PURPOSE_LIMITS} from './media.js'

// 朗读声音 (reading voices: 通用声音 `general`, 旁白 `narrator`, a card's own 旁白 `narrator:<cardId>`): one voice each, the
// shape of a pack voice (voiceSpec) with a figure's binding (voice is always 'voice'). They live beside the templates
// (voice-templates/index.json `readings`, reference clips in the same immutable media directory) and are edited in place.
const READING_ID = /^(?:general|narrator(?::[A-Za-z0-9_-]{1,120})?)$/
const READING_AUDIO = {wav:'audio/wav',mp3:'audio/mpeg'}
// a bad reading voice is the voice schema's repairable INVALID_INPUT.
const invalid = (ok, path, message = 'Invalid reading voice') => check(ok, path, message, 'INVALID_INPUT')
function readingId(id) { invalid(typeof id === 'string' && READING_ID.test(id),'$.id','Invalid reading voice id') }
function readingDocument(voiceSpec,binding) {
  validateVoiceSpec(voiceSpec,'$.voiceSpec')
  invalid(binding?.voice === 'voice','$.binding.voice')
  validateVoiceBinding(binding,{version:1,voices:{voice:voiceSpec}},'$.binding')
}


// A changed voice cannot retain pointers into a different voice's options.
export function retainVoiceEmotionPointers(figure,manifest) {
  const options=manifest.voiceLibrary?.voices[figure.voice?.voice]?.emotions || {};
  for(const row of figure.emotions || [])if(row.voiceEmotion && !Object.hasOwn(options,row.voiceEmotion))delete row.voiceEmotion;
}

// The pack owner's root gate serializes template index CAS with pack publication.
// Blobs are immutable; publish the index last. Deleting a template never deletes pack data.
export function createVoiceAuthoring({assetRoot,storage,run,load,edit,cas,limits}) {
  const root = path.join(assetRoot,'voice-templates')
  async function write(relative,bytes) {
    const target = await checkedPath(root,relative), temp = await checkedPath(root,relative + '.' + randomUUID() + '.tmp')
    await mkdir(path.dirname(target),{recursive:true})
    const file = await open(temp,'wx')
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await rename(temp,target)
  }
  async function index() { const bytes = await storage.read('voice-templates/index.json'); return bytes ? readDocument(bytes) : {version:1,templates:{}} }
  async function publish(value) {
    const bytes = jsonBytes(value)
    check(bytes.length <= limits.entrySize,'$.templates','Template index budget exceeded','LIMIT_EXCEEDED')
    await write('index.json',bytes)
  }
  const publicTemplate = item => { const {blobs,...result} = item; return structuredClone(result) }
  function templateCas(item,revision) { check((item?.revision ?? null) === revision,'$.expectedRevision','Template revision changed','REVISION_CONFLICT') }
  function variantEdit(input,remove) {
    validateShortId(input.voiceId,'$.voiceId'); validateShortId(input.variantId,'$.variantId')
    return edit(input,async (manifest,files) => {
      const voice = manifest.voiceLibrary?.voices[input.voiceId]
      check(voice,'$.voiceId','Voice missing','VOICE_NOT_FOUND')
      const users = [...files].filter(([p]) => p.startsWith('figures/')).map(([,b]) => readDocument(b)).filter(f => f.voice?.voice === input.voiceId)
      check(!users.some(f => f.id !== input.figureId) || input.confirmShared === true,'$.confirmShared','Confirm shared voice users','SHARED_VOICE_CONFIRMATION_REQUIRED')
      if (remove) {
        check(Object.hasOwn(voice.variants || {},input.variantId),'$.variantId','Variant missing','VOICE_NOT_FOUND')
        check(!users.some(f => f.voice.variant === input.variantId || Object.values(f.voice.emotionVariants || {}).includes(input.variantId)),'$.variantId','Variant is in use','VOICE_VARIANT_IN_USE')
        delete voice.variants[input.variantId]
      } else (voice.variants ||= {})[input.variantId] = structuredClone(input.variant)
      return {affectedFigures:users.map(f => ({id:f.id,name:f.name}))}
    })
  }
  const publicReading = item => item ? structuredClone(item.link ? {id:item.id,revision:item.revision,link:item.link,...(item.language ? {language:item.language} : {})}
    : {id:item.id,revision:item.revision,voiceSpec:item.voiceSpec,binding:item.binding}) : null
  // A reading voice is written whole (CAS on its own revision); its clips are named by hash and must already be stored.
  async function publishReading(data,id,voiceSpec,binding,copied = {}) {
    const blobs = {}
    for (const hash of new Set(voiceReferences(voiceSpec).map(r => r.media))) {
      const descriptor = copied[hash] || data.readingMedia?.[hash] || data.readings?.[id]?.blobs?.[hash]
      check(descriptor,'$.voiceSpec','Missing reference','MISSING_REFERENCE')
      blobs[hash] = structuredClone(descriptor)
    }
    const item = {id,revision:randomUUID(),voiceSpec:structuredClone(voiceSpec),binding:structuredClone(binding),blobs}
    ;(data.readings ||= {})[id] = item
    // staged clips now owned by a voice leave the staging list.
    if (data.readingMedia) for (const hash of Object.keys(blobs)) delete data.readingMedia[hash]
    await publish(data)
    return publicReading(item)
  }
  const readingListeners = new Set()
  const changed = id => result => { for (const fn of readingListeners) { try { fn({id}) } catch { /* observers cannot undo a write */ } } return result }
  function readingCas(data,id,revision) { check((data.readings?.[id]?.revision ?? null) === revision,'$.expectedRevision','Reading voice revision changed','REVISION_CONFLICT') }
  return {
    listReadingVoices() { return run([],async () => ({readings:Object.values((await index()).readings || {}).map(publicReading)})) },
    // async: a bad input is a rejected call like a CAS conflict.
    async getReadingVoice({id}) { readingId(id); return run([],async () => ({reading:publicReading((await index()).readings?.[id])})) },
    // voiceSpec null removes the voice (it then speaks as the browser's default voice). `link` {packId, figureId} instead
    // makes it follow that figure's voice (「人物的声音」), spoken in `language` (absent = 中文).
    async saveReadingVoice(input) {
      readingId(input.id)
      if (input.link !== undefined) {
        invalid(input.link && Object.keys(input.link).sort().join() === 'figureId,packId','$.link'); validateUuid(input.link.packId); validateShortId(input.link.figureId,'$.link.figureId')
        if (input.language !== undefined) invalid(typeof input.language === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.language),'$.language')
      } else if (input.voiceSpec !== null) readingDocument(input.voiceSpec,input.binding)
      return run([],async () => {
        const data = await index(); readingCas(data,input.id,input.expectedRevision)
        if (input.link !== undefined) {
          const item = {id:input.id,revision:randomUUID(),link:{packId:input.link.packId,figureId:input.link.figureId},...(input.language ? {language:input.language} : {})}
          ;(data.readings ||= {})[input.id] = item; await publish(data); return {reading:publicReading(item)}
        }
        if (input.voiceSpec === null) { if (data.readings) delete data.readings[input.id]; await publish(data); return {reading:null} }
        return {reading:await publishReading(data,input.id,input.voiceSpec,input.binding)}
      }).then(changed(input.id))
    },
    // The host hears each saved reading voice (speech and the cards' bubble projection open it again).
    subscribeReadings(fn) { readingListeners.add(fn); return () => readingListeners.delete(fn) },
    // A reference clip for a reading voice (WAV / MP3, checked once here): stored by hash, then named by saveReadingVoice.
    async putReadingVoiceBlob(input) {
      const bytes = Buffer.from(input.bytes), ext = audioKind(bytes)
      invalid(READING_AUDIO[ext] && input.descriptor?.ext === ext,'$.descriptor','Reference clips are WAV or MP3')
      check(bytes.length > 0 && bytes.length <= MEDIA_PURPOSE_LIMITS.audio,'$.bytes','Reference clip too large','LIMIT_EXCEEDED')
      const hash = createHash('sha256').update(bytes).digest('hex'), descriptor = {ext,mime:READING_AUDIO[ext],size:bytes.length}
      return run([],async () => {
        const relative = 'media/' + hash + '.' + ext
        if (!await storage.exists('voice-templates/' + relative)) await write(relative,bytes)
        const data = await index()
        ;(data.readingMedia ||= {})[hash] = descriptor; await publish(data)
        return {hash,descriptor:structuredClone(descriptor)}
      })
    },
    // Copies a pack voice ({packId, voiceId}), a template ({templateId}) or another reading voice ({readingId}: 旁白's
    // 「本卡单独指定」 starts as the global one) into a reading voice, clips included.
    async copyReadingVoice(input) {
      readingId(input.id)
      const from = input.from || {}
      if (from.readingId !== undefined) readingId(from.readingId)
      else if (from.templateId !== undefined) validateUuid(from.templateId); else { validateUuid(from.packId); validateShortId(from.voiceId,'$.from.voiceId') }
      return run(from.packId ? [from.packId] : [],async () => {
        const data = await index(); readingCas(data,input.id,input.expectedRevision)
        let voiceSpec, binding, copied = {}
        if (from.readingId !== undefined) {
          const item = data.readings?.[from.readingId]
          check(item,'$.from.readingId','Reading voice missing','VOICE_NOT_FOUND')
          if (item.link) {
            const copy = {id:input.id,revision:randomUUID(),link:structuredClone(item.link),...(item.language ? {language:item.language} : {})}
            ;(data.readings ||= {})[input.id] = copy; await publish(data); return {reading:publicReading(copy)}
          }
          voiceSpec = item.voiceSpec; binding = structuredClone(item.binding); copied = item.blobs
        } else if (from.templateId !== undefined) {
          const item = data.templates[from.templateId]
          check(item,'$.from.templateId','Template missing','VOICE_NOT_FOUND')
          voiceSpec = item.voiceSpec; binding = {...item.binding,voice:'voice'}; copied = item.blobs
        } else {
          const pack = await load(from.packId), voice = pack?.manifest.voiceLibrary?.voices[from.voiceId]
          check(voice,'$.from.voiceId','Voice missing','VOICE_NOT_FOUND')
          voiceSpec = voice; binding = {voice:'voice'}
          for (const hash of new Set(voiceReferences(voice).map(r => r.media))) {
            const descriptor = pack.manifest.blobs[hash], bytes = descriptor && pack.files.get('media/' + hash + '.' + descriptor.ext)
            check(bytes,'$.media','Missing reference','MISSING_REFERENCE')
            const relative = 'media/' + hash + '.' + descriptor.ext
            if (!await storage.exists('voice-templates/' + relative)) await write(relative,bytes)
            copied[hash] = descriptor
          }
        }
        if (input.language !== undefined) binding.language = input.language
        readingDocument(voiceSpec,binding)
        return {reading:await publishReading(data,input.id,voiceSpec,binding,copied)}
      }).then(changed(input.id))
    },
    // Host-only: a reading voice's own reference clip (or one just staged for it).
    async readReadingVoiceMedia({id, hash}) {
      readingId(id)
      return run([],async () => {
        const data = await index(), descriptor = data.readings?.[id]?.blobs?.[hash] || data.readingMedia?.[hash]
        check(descriptor,'$.hash','Missing reference','MISSING_REFERENCE')
        const bytes = await storage.read('voice-templates/media/' + hash + '.' + descriptor.ext)
        check(bytes,'$.hash','Missing reference','MISSING_REFERENCE')
        return {bytes,descriptor:structuredClone(descriptor)}
      })
    },
    savePackVoiceVariant:input => variantEdit(input,false),
    deletePackVoiceVariant:input => variantEdit(input,true),
    listVoiceTemplates() { return run([],async () => ({templates:Object.values((await index()).templates).map(publicTemplate)})) },
    // Host-only: a template can authorize only the reference clips copied with it.
    readVoiceTemplateMedia({templateId, expectedRevision, hash}) {
      return run([],async () => {
        const item = (await index()).templates[templateId]
        check(item,'$.templateId','Template missing','VOICE_NOT_FOUND'); templateCas(item,expectedRevision)
        const descriptor = item.blobs[hash]
        check(descriptor,'$.hash','Missing reference','MISSING_REFERENCE')
        const bytes = await storage.read('voice-templates/media/' + hash + '.' + descriptor.ext)
        check(bytes,'$.hash','Missing reference','MISSING_REFERENCE')
        return {bytes,descriptor:structuredClone(descriptor)}
      })
    },
    saveVoiceTemplate(input) {
      const templateId = input.templateId ?? randomUUID(); validateUuid(templateId); validateUuid(input.packId); validateShortId(input.voiceId,'$.voiceId')
      return run([input.packId],async () => {
        const data = await index(); templateCas(data.templates[templateId],input.expectedRevision)
        const pack = await load(input.packId); cas(pack,input.packRevision)
        const voice = pack?.manifest.voiceLibrary?.voices[input.voiceId]
        check(voice,'$.voiceId','Voice missing','VOICE_NOT_FOUND')
        const voiceSpec = structuredClone(voice), binding = structuredClone(input.binding ?? {voice:input.voiceId})
        check(binding.voice === input.voiceId,'$.binding.voice')
        validateVoiceBinding(binding,pack.manifest.voiceLibrary)
        const blobs = {}; let total = 0
        for (const hash of new Set(voiceReferences(voiceSpec).map(r => r.media))) {
          const descriptor = pack.manifest.blobs[hash], bytes = descriptor && pack.files.get('media/' + hash + '.' + descriptor.ext)
          check(bytes,'$.media','Missing reference','MISSING_REFERENCE')
          total += bytes.length; check(total <= limits.totalSize,'$.media','Template budget exceeded','LIMIT_EXCEEDED')
          const relative = 'media/' + hash + '.' + descriptor.ext
          // Installed blobs were verified at ingress; immutable template copies share that identity.
          if (!await storage.exists('voice-templates/' + relative)) await write(relative,bytes)
          blobs[hash] = structuredClone(descriptor)
        }
        const item = {templateId,revision:randomUUID(),name:voiceSpec.name,voiceSpec,binding,blobs}
        data.templates[templateId] = item; await publish(data)
        return publicTemplate(item)
      })
    },
    deleteVoiceTemplate(input) {
      validateUuid(input.templateId)
      return run([],async () => {
        const data = await index(), item = data.templates[input.templateId]
        check(item,'$.templateId','Template missing','VOICE_NOT_FOUND'); templateCas(item,input.expectedRevision)
        delete data.templates[input.templateId]; await publish(data); return {deleted:true}
      })
    },
    assignVoiceTemplate(input) {
      validateUuid(input.templateId)
      return edit(input,async (manifest,files) => {
        const item = (await index()).templates[input.templateId]
        check(item,'$.templateId','Template missing','VOICE_NOT_FOUND'); templateCas(item,input.templateRevision)
        check(manifest.figures.includes(input.figureId),'$.figureId','Figure missing','ASSET_UNAVAILABLE')
        const voiceId = 'v-' + randomUUID(), voiceSpec = structuredClone(item.voiceSpec)
        for (const hash of new Set(voiceReferences(voiceSpec).map(r => r.media))) {
          const descriptor = item.blobs[hash]
          check(descriptor,'$.media','Missing reference','MISSING_REFERENCE')
          const relative = 'media/' + hash + '.' + descriptor.ext
          if (manifest.blobs[hash]) check(manifest.blobs[hash].ext === descriptor.ext && manifest.blobs[hash].size === descriptor.size,'$.media','Blob conflict','INVALID_INPUT')
          // Reuse installed bytes; new copies receive their write-time identity in sealPack.
          if (!files.has(relative)) {
            const bytes = await storage.read('voice-templates/' + relative)
            check(bytes,'$.media','Missing reference','MISSING_REFERENCE')
            files.set(relative,bytes)
          }
          manifest.blobs[hash] = structuredClone(descriptor)
        }
        ;(manifest.voiceLibrary ||= {version:1,voices:{}}).voices[voiceId] = voiceSpec
        const name = 'figures/' + input.figureId + '.json', figure = readDocument(files.get(name))
        figure.voice = {...structuredClone(item.binding),voice:voiceId}; retainVoiceEmotionPointers(figure,manifest); files.set(name,jsonBytes(figure))
        return {voiceId}
      })
    },
  }
}
