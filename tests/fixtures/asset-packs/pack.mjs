// widgets declare content rectangles; the host owns presentation state.
// Synthetic, in-memory pack: no real media, models, profiles or network inputs.
import { deflateSync } from 'node:zlib'
import {migratePackVoices} from '../../../tavern-plugin/packages/dsh-asset-library/src/asset-packs/voice-migration.js'
import {importFigureVariants} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/import-figure-variants.js'
import {sealPack} from '../../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import { createHash } from 'node:crypto'
import { canonicalJson, computeContentHash, computeBundleHash } from '../../../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
export const PACK_ID = '11111111-1111-4111-8111-111111111111'
export const FIGURE_ID = '22222222-2222-4222-8222-222222222222'
export const OTHER_PACK_ID = '33333333-3333-4333-8333-333333333333'
export const OTHER_FIGURE_ID = '44444444-4444-4444-8444-444444444444'
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
// Metadata-only runtime fixtures that represent different art must have different media identities.
export const distinctMedia = (value, salt) => JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{64}/g, hash => digest(salt + hash)))
export function png(color) {
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([header, body, tail]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 6
  const pixels = Buffer.alloc(8 * 33)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set([...color, 255], y * 33 + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
function wav() {
  const bytes = Buffer.alloc(60)
  bytes.write('RIFF'); bytes.writeUInt32LE(52, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16, 40)
  return bytes
}
export async function syntheticPack({legacyVoice = false} = {}) {
  const files = new Map(), blobs = {}
  const addBlob = (bytes, ext, mime) => { const hash = digest(bytes); blobs[hash] = { ext, mime, size: bytes.length }; files.set(`media/${hash}.${ext}`, bytes); return hash }
  const day = addBlob(png([160, 200, 240]), 'png', 'image/png'), night = addBlob(png([20, 30, 60]), 'png', 'image/png')
  const face = addBlob(png([240, 160, 180]), 'png', 'image/png'), audio = addBlob(wav(), 'wav', 'audio/wav')
  const atlas = src => ({ src, width: 8, height: 8, frames: { open: { x: 0, y: 0, w: 1, h: 1 }, closed: { x: 1, y: 0, w: 1, h: 1 } }, defaultFrames: {closed:'closed', small:'open', mid:'open', open:'open'} })
  const view = src => ({ src, width: 8, height: 8, mouth: { x: 2.25, y: 3.25, w: 1.5, h: 1.5 }, mouthByFrame: { open: { x: 3, y: 3, w: 1, h: 1 } }, mouthOcclusionMask: 'assets/mask.png' })
  const layered = {
    // canonical emotions own render definitions; no unused atlas is installed.
    version: 2, kind: 'layered-static-sprites', character: { id: 'synthetic', name: 'Synthetic figure' }, closedBehavior: 'restore-base',
    mouthAtlas: atlas('assets/atlas.png'), mouthSets: { special: atlas('assets/special-atlas.png') },
    emotions: {
      calm: { mouthFrames: {closed:'closed', small:'open', mid:'open', open:'open'}, stage: view('assets/stage.png'), portrait: view('assets/portrait.png') },
      crying: { initialPhoneme: 'open', mouthSet: 'special', mouthFrames: {closed:'closed', small:'open', mid:'open', open:'open'}, closedMouthFrame: 'closed', stage: view('assets/stage-special.png'), portrait: view('assets/portrait-special.png') }
    }
  }
  const still = { version: 1, kind: 'static-sprites', emotions: {calm: {src: 'assets/still.png'}} }
  const assets = Object.fromEntries(['atlas', 'special-atlas', 'mask', 'stage', 'portrait', 'stage-special', 'portrait-special'].map(name => [`assets/${name}.png`, face]))
  const figure = {
    schemaVersion: 1, id: FIGURE_ID, name: 'Synthetic figure', aliases: ['Fixture', 'actor', 'Speaker'], enabled: true, heightCm: 158,
    // shared fixtures offer blue figures; dedicated lamp tests cover the green default.
    appearance: 'live2d', recall: {mode:'constant'},
    // new figure-owned portable preset; reference transcripts are inline.
    voice: {id:'fixture/voice',language:'ja',preset:{kind:'reference',label:'Synthetic clone',languages:['ja'],params:{},
      model:{id:'fixture-model',engine:'gpt-sovits',modelVersion:'v2ProPlus',gpt:{sha256:digest('synthetic-gpt-requirement')},sovits:{sha256:digest('synthetic-sovits-requirement')},sv:{sha256:digest('synthetic-sv-requirement')}},
      references:[{media:audio,text:'Synthetic reference text.\nPreserve this line.',language:'ja'},{media:audio,text:'Synthetic reference text, not a recording of a real person.',language:'ja'}]}},
    outfits: [
      // common protocol fixtures deliberately offer both outfits; recall gating has its own tests.
      {key:'school', recall:{mode:'constant',keywords:['校服']}, label: 'School', enabled: true, sprite: { manifestKey: 'school', assets }, avatars: { calm: face, joy: day, crying: night } },
      {key:'casual', recall:{mode:'constant',keywords:['私服']}, label: 'Casual', enabled: true, live2d: { bundleKey: 'casual', emotionMap: { joy: { expression: 'smile' } } }, sprite: { manifestKey: 'casual', assets: { 'assets/still.png': face } }, avatars: { calm: night } }
    ]
  }
  const json = (path, value) => files.set(path, Buffer.from(canonicalJson(value)))
  json(`figures/${FIGURE_ID}.json`, figure); json('sprites/school/manifest.json', layered); json('sprites/casual/manifest.json', still)
  files.set('credits/reference.txt', Buffer.from('Synthetic reference text, not a recording of a real person.'))
  files.set('credits/license.txt', Buffer.from('Synthetic test data. CC0.'))
  files.set('bundles/widget/index.html', Buffer.from('<!doctype html><p>Synthetic widget</p>'))
  const stateSchema = {type:'object',properties:{label:{type:'string',maxLength:80}},required:['label'],additionalProperties:false}
  const widget = {format:'dsh.widget/2',namespace:'clock',view:{entry:'index.html'},presentation:{open:{"width":280,"height":180,"minWidth":200,"minHeight":100,"anchor":"corner-right"}},stateSchema,commands:[
    {name:'set',summary:'Set the label.',params:stateSchema,effect:'state.set'},
    {name:'update',summary:'Patch the label.',params:{...stateSchema,required:[]},effect:'state.patch'},
    {name:'clear',summary:'Clear the clock.',params:{type:'object',properties:{},required:[],additionalProperties:false},effect:'state.clear'}
  ],caps:{active:1,bytes:256},samples:[{command:'set',params:{label:'fixture'}}]}
  json('bundles/widget/widget.json',widget)
  // Declarative model3 fixture only: not a compiled/usable Cubism model.
  json('bundles/casual/model.model3.json', { Version: 3, FileReferences: { Moc: 'model.moc3', Textures: ['textures/face.png'], Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }] } })
  files.set('bundles/casual/model.moc3', Buffer.from('synthetic-uncompiled-moc'))
  files.set('bundles/casual/textures/face.png', png([240, 160, 180])); json('bundles/casual/smile.exp3.json', { Type: 'Live2D Expression', Parameters: [] })
  const entries = [...files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes) }))
  const bundle = async (key, kind, entry) => ({ kind, entry, contentHash: await computeBundleHash(entries.filter(f => f.path.startsWith(`bundles/${key}/`)).map(f => ({ ...f, path: f.path.slice(`bundles/${key}/`.length) }))) })
  const base = (kind, id) => ({ kind, id, name: 'Synthetic ' + kind, enabled: true, recall: { mode: 'keyword', keywords: ['synthetic','fixture','sample'], synonyms: { synthetic: ['fixture'] } }, directorNote: '' })
  const manifest = {
    format: 'dsh-asset-pack', schemaVersion: 1, id: PACK_ID, name: 'Synthetic pack', description: 'P0 structural fixture', credits: ['credits/license.txt'], contentHash: '0'.repeat(64),
    assets: [
      { ...base('backgrounds', 'classroom'), variants:{default:'day',entries:[{id:'day',name:'Day',content:{media:day}},{id:'dusk',name:'Dusk',content:{media:night}},{id:'night',name:'Night',content:{media:night}}]}, category: ['school'] },
      { ...base('backgrounds', 'pending'), media: null, pendingMedia: true },
      { ...base('music', 'classroom'), media: audio, usage: 'fixture', tags: ['quiet'] },
      { ...base('sfx', 'bell'), media: audio, loop: false, durationMs: 1 },
      { ...base('ambience', 'rain'), media: audio, loop: true },
      { ...base('looks', 'dusk'), recall: { mode: 'constant', keywords: ['夕阳','黄昏','暮色'] }, layer: 'mood', params: { grade: { brightness: 0.9 }, texture: face } },
      { ...base('widgets', 'clock'), bundleKey: 'widget', entry: 'widget.json' }
    ], figures: [FIGURE_ID], sprites: { school: 'sprites/school/manifest.json', casual: 'sprites/casual/manifest.json' }, bundles: { casual: await bundle('casual', 'live2d', 'model.model3.json'), widget: await bundle('widget', 'widget', 'widget.json') }, blobs, files: entries
  }
  manifest.contentHash = await computeContentHash(manifest)
  if (!legacyVoice) {
    const migrated = migratePackVoices(manifest,{[FIGURE_ID]:figure})
    manifest.voiceLibrary = migrated.manifest.voiceLibrary
    figure.voice = migrated.figures[FIGURE_ID].voice
    // current fixtures declare their vocabulary; legacy ingress fixtures remain untouched.
    const variants=importFigureVariants(manifest,{[FIGURE_ID]:figure},{school:layered,casual:still})
    manifest.voiceLibrary=variants.manifest.voiceLibrary
    Object.assign(figure,variants.figures[FIGURE_ID])
    files.set(`figures/${FIGURE_ID}.json`,Buffer.from(canonicalJson(figure)))
    await sealPack(manifest,files)
  }
  return { manifest, figures: { [FIGURE_ID]: figure }, sprites: { school: layered, casual: still }, widgets:{clock:widget}, files }
}
// only migration/retired-schema tests may author the old card tables.
export function legacyCardExtension() {
  // cast entries carry no figure-owned overrides.
  // widget execution scenarios explicitly opt in; unspecified production cards default off.
  return { schemaVersion: 1, stage:{widgets:true}, assetBindings: { boundPackIds: [PACK_ID, OTHER_PACK_ID], characters: { actor: { figure: { packId: PACK_ID, figureId: FIGURE_ID } } } }, characters: { actor: { name: 'Actor', speakerNames: ['Speaker'], appearance: 'live2d' } } }
}

// cards choose packs, not individual people.
export function cardExtension() {
  return {schemaVersion:1,assetBindings:{boundPackIds:[PACK_ID,OTHER_PACK_ID]}}
}

// Small synthetic fixtures deliberately inspect/corrupt archive bytes; production exports stay on disk.
export async function readSmallArchive(archive) {
  if (!archive.file || archive.size > 8 * 1024 ** 2) throw Error('Expected a small disk archive fixture')
  const {createReadStream} = await import('node:fs')
  const chunks = []
  for await (const chunk of createReadStream(archive.file)) chunks.push(chunk)
  return Buffer.concat(chunks)
}
