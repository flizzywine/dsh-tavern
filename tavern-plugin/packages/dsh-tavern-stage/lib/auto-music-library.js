import {createHash} from 'node:crypto'
import {automaticMusicPrompt, chooseAutomaticMusic, automaticMusicOrigin as provenance} from './domain/auto-music.js'

const digest = value => createHash('sha256').update(value).digest('hex')

export function createAutomaticMusic({library, generation, store, warn}) {
  const inFlight = new Map(), receiptPath = 'auto-music/installed.json'
  async function produce(input, prompt, key) {
    const service = library(), generator = generation()
    if (!service || !generator) return null
    const target = await service.cardAutomaticPack({path:input.cardPath, create:false})
    const pack = target && await service.getPackSnapshot({packId:target.packId})
    const existing = pack?.manifest.assets.find(asset => asset.kind === 'music' && asset.extensions?.[provenance]?.prompt === prompt)
    if (existing) return {packId:target.packId, kind:'music', assetId:existing.id}
    // Keep the receipt after removal from the editable pack.
    if ((await store.readJson(receiptPath))?.[key]) return null
    const audio = await generator.generate({prompt, signal:input.signal})
    if (!audio || input.signal?.aborted) return null
    const ref = await installAutomaticMusic(service, {...input, prompt, audio})
    if (ref) await store.updateJson(receiptPath, records => ({...records, [key]:ref}))
    return ref
  }
  return input => {
    const selection = chooseAutomaticMusic(input)
    if (!selection.generate) return selection
    const prompt = automaticMusicPrompt(input), key = digest(JSON.stringify([input.cardPath, prompt]))
    if (!inFlight.has(key)) {
      const completion = produce(input, prompt, key).catch(error => {
        warn?.(error.message)
        return null
      }).finally(() => inFlight.delete(key))
      inFlight.set(key, completion)
    }
    return {...selection, completion:inFlight.get(key)}
  }
}

export async function installAutomaticMusic(library, {cardPath, name, mood, keywords, directorNote, prompt, audio}) {
  const target = await library.cardAutomaticPack({path:cardPath, create:true})
  if (!target) return null
  const {packId} = target
  const pack = await library.getPackSnapshot({packId})
  const manifest = pack.manifest
  const existing = manifest.assets.find(asset => asset.kind === 'music' && asset.extensions?.[provenance]?.prompt === prompt)
  if (existing) return {packId, kind:'music', assetId:existing.id}

  const media = digest(audio.bytes), id = 'ai-' + digest(prompt).slice(0, 24)
  const content = {media, ...(audio.loopStart === undefined ? {} : {loopStart:audio.loopStart, loopEnd:audio.loopEnd})}
  const title = name.endsWith('（AI 生成）') ? name : `${name}（AI 生成）`
  const asset = {kind:'music', id, name:title, enabled:true, recall:{mode:'keyword', keywords}, directorNote,
    variants:{default:'main', entries:[{id:'main', name, content}]},
    extensions:{[provenance]:{generated:true, model:'lyria-3.5', mood, prompt}}}
  await library.patchPack({packId, expectedRevision:pack.revision,
    fileUpdates:new Map([[`media/${media}.ogg`, audio.bytes]]),
    patch:{assets:[...manifest.assets, asset], blobs:{...manifest.blobs, [media]:{ext:'ogg', mime:'audio/ogg', size:audio.bytes.length}}}})
  const readBack = await library.getPackSnapshot({packId})
  if (!readBack.manifest.assets.some(row => row.kind === 'music' && row.id === id && row.variants.entries[0].content.media === media)) {
    throw new Error('Automatic music installation could not be read back')
  }
  return {packId, kind:'music', assetId:id}
}
