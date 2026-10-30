import {randomUUID} from 'node:crypto'
import {mkdir,open,rename} from 'node:fs/promises'
import path from 'node:path'
import {checkedPath} from './storage.js'
import {check,validateUuid,validateShortId} from '../asset-packs/common.js'
import {validateVoiceBinding,voiceReferences} from '../shared/voice-schema.js'
import {jsonBytes,readDocument} from './validation.js'


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
  return {
    savePackVoiceVariant:input => variantEdit(input,false),
    deletePackVoiceVariant:input => variantEdit(input,true),
    listVoiceTemplates() { return run([],async () => ({templates:Object.values((await index()).templates).map(publicTemplate)})) },
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
