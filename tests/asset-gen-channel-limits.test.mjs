// 素材生图 on a channel that cannot do everything (a text-only one such as NovelAI, a relay answering in JPEG): what it
// can draw it draws, and what fails says why in plain words instead of 「请稍后再试」.
import test from 'node:test'
import {randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createAssetGeneration } from '../tavern-plugin/lib/domain/asset-generation.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {encodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import publication from '../tavern-plugin/shared/asset-image-publication.cjs'
import sprites from '../tavern-plugin/shared/sprite-emotions.cjs'

const require = createRequire(import.meta.url)
async function jpeg() {
  const codec = await import('@jsquash/jpeg/encode.js')
  await codec.init(await WebAssembly.compile(await readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))))
  return Buffer.from(await codec.default({width:6, height:4, data:new Uint8ClampedArray(6 * 4 * 4).fill(200), colorSpace:'srgb'}))
}

// A transparent 200x600 full-body figure: a round head (crown y 30, chin y 110, centre x 120) on a body to y 590.
function figurePng() {
  const width = 200, height = 600, data = new Uint8ClampedArray(width*height*4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const head = (x-120)**2 + (y-70)**2 <= 40**2, body = y > 110 && y < 590 && Math.abs(x-120) < 45
    if (head || body) data.set([200, 160, 140, 255], (y*width+x)*4)
  }
  return encodeAssetRgba({width, height, data})
}
async function fixture(t) {
  const base = fileURLToPath(new URL('../.preview/asset-gen-channel-tests/', import.meta.url)); await mkdir(base, {recursive:true})
  const root = await mkdtemp(base + 'case-'), store = createProfileDataStore({dataRoot:root + '/data'}), library = createAssetPackService({assetRoot:root + '/packs'})
  const channel = {maxReferences:0, sent:[], reply:async () => ({data:await jpeg(), mediaType:'image/jpeg'})}
  const provider = {label:'配图', status:async () => ({ready:true, model:'nai-diffusion-4-5-full', maxReferences:channel.maxReferences}),
    generate:async request => { channel.sent.push(request); return channel.reply(request) }}
  // Which pictures the generation read from the pack: a reference left out for the channel is never read.
  const reads = [], reading = {readMedia:input => { reads.push(input.hash); return library.readMedia(input) }}
  const service = createAssetGeneration({store, getLibrary:() => ({...Object.fromEntries(Object.keys(library).map(k => [k, typeof library[k] === 'function' ? library[k].bind(library) : library[k]])), ...reading}), imageProvider:() => provider})
  t.after(async () => { await service.dispose(); await library.dispose() })
  const pack = (await library.createPack({name:'Limits', expectedRevision:null})).snapshot
  const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:'Mio', appearance:'sprite',
    emotions:[{id:'calm', label:'平和'}], outfits:[{key:'daily', label:'Daily', enabled:true, defaultEmotion:'calm', recall:{mode:'keyword', keywords:['校服']}}]}})
  const revision = async () => (await library.getPackSnapshot({packId:pack.manifest.id})).revision
  const at = kind => kind === 'identity-settei' ? {packId:pack.manifest.id, figureId:created.figureId, kind} : {packId:pack.manifest.id, figureId:created.figureId, outfitKey:'daily', kind}
  const prepare = async (kind, {emotionId, ...extra} = {}) => service.prepare({target:{...at(kind), ...(emotionId ? {emotionId} : {})}, expectedRevision:await revision(), ...extra})
  async function draw(kind, extra) {
    const plan = await prepare(kind, extra), [job] = (await service.generate({planId:plan.planId, consentToken:plan.consentToken})).jobs
    for (;;) { const now = await service.get({jobId:job.jobId}); if (now.status !== 'running') return {plan, job:now}; await new Promise(r => setTimeout(r, 10)) }
  }
  // The calm 立绘, published as the editor publishes an uploaded one.
  async function addSprite() {
    const bytes = figurePng(), image = {bytes, descriptor:{ext:'png', mime:'image/png', size:bytes.length}, width:200, height:600}
    const publisher = publication.create({newResourceKey:prefix => prefix + '-' + Math.random().toString(36).slice(2), emotionState:(_o, manifest, id) => sprites.spriteEmotionState(manifest, id)})
    const snapshot = await library.getPackSnapshot({packId:pack.manifest.id})
    await library.patchPack(await publisher.figure({snapshot, image, media:await publication.closure(image), figureId:created.figureId, outfitKey:'daily', emotion:'calm', kind:'sprite'}))
  }
  // An outfit settei of two sheets (four views, then eye and pieces over the colour card), registered as pack install does.
  async function addSettei(partsPng) {
    const sheet = (n, bytes = encodeAssetRgba({width:16, height:9, data:new Uint8ClampedArray(16 * 9 * 4).fill(n)})) => publication.closure({bytes, descriptor:{ext:'png', mime:'image/png', size:bytes.length}})
    const [views, parts] = [await sheet(90), await sheet(180, partsPng)], snapshot = await library.getPackSnapshot({packId:pack.manifest.id}), figure = snapshot.figures[created.figureId]
    const files = new Map([...views.files, ...parts.files, ['figures/' + created.figureId + '.json', publication.jsonBytes({...figure, outfits:figure.outfits.map(o => ({...o, settei:views.hash, setteiParts:parts.hash}))})]])
    await library.patchPack(publication.publish(snapshot, {blobs:{...views.blobs, ...parts.blobs}, files}))
    return {views:views.hash, parts:parts.hash}
  }
  const outfit = async () => (await library.getPackSnapshot({packId:pack.manifest.id})).figures[created.figureId].outfits[0]
  return {service, channel, provider, revision, prepare, draw, addSprite, addSettei, reads, outfit}
}

test('a text-only channel draws the 设定图 from text, and a JPEG answer is stored as PNG', async t => {
  const f = await fixture(t)
  // 画风 goes to the image plugin as its preset id and this kind's use; a preset the plugin no longer has is refused before sending.
  f.provider.presets = () => [{id:'galgame-clean', name:'干净低细节'}, {id:'no-style', name:'不加画风'}]
  await assert.rejects(f.prepare('identity-settei', {userPrompt:'silver hair', style:'galgame-anime'}), e => e.code === 'INVALID_ARGUMENT' && /galgame-anime/.test(e.message))
  const figure = await f.draw('identity-settei', {userPrompt:'silver hair'})
  assert.equal(f.channel.sent[0].promptPreset, 'galgame-clean'); assert.equal(f.channel.sent[0].usage, 'sheet')
  assert.equal(figure.job.status, 'candidate'); assert.equal(figure.job.candidate.mediaType, 'image/png')
  assert.deepEqual([figure.job.candidate.width, figure.job.candidate.height], [6, 4])
  await f.service.accept({jobId:figure.job.jobId, expectedRevision:await f.revision()})

  // The identity board is a reference the outfit 设定图 uses when the channel takes one, never a prerequisite.
  f.channel.maxReferences = 4
  assert.equal((await f.prepare('settei', {userPrompt:'school uniform'})).references.length, 1)
  f.channel.maxReferences = 0
  const outfit = await f.draw('settei', {userPrompt:'school uniform'})
  assert.equal(outfit.plan.references.length, 0); assert.equal(f.channel.sent.at(-1).references.length, 0)
  assert.doesNotMatch(f.channel.sent.at(-1).prompt, /Image 1/)
  assert.equal(outfit.job.status, 'candidate')
  // Nothing to draw from at all: it says the channel only draws from text, and what to write.
  await assert.rejects(f.prepare('settei'), e => e.code === 'INVALID_ARGUMENT' && /不能带参考图.*外貌或服装描述/.test(e.message))
})

test('a 头像 is drawn from its 立绘 where the channel takes it, from the text where it does not (NovelAI), never refused for it', async t => {
  const f = await fixture(t)
  await f.addSprite()
  // a text-only channel: the 立绘 is left out and the 设定文字 draws it; nothing to draw from says what to write
  await assert.rejects(f.prepare('avatar', {emotionId:'calm'}), e => e.code === 'INVALID_ARGUMENT' && /不能带参考图.*外貌或服装描述/.test(e.message))
  const text = await f.draw('avatar', {emotionId:'calm', userPrompt:'silver hair'})
  assert.equal(text.job.status, 'candidate'); assert.equal(f.channel.sent.at(-1).references.length, 0); assert.equal(text.plan.references.length, 0)
  f.channel.maxReferences = 4
  const drawn = await f.draw('avatar', {emotionId:'calm'})
  assert.equal(f.channel.sent.at(-1).references.length, 1); assert.equal(drawn.plan.references[0].purpose, 'emotion-sprite')
})

test('a 立绘 takes both settei sheets, four views first, where the channel takes several, and the four views alone where it takes one', async t => {
  const f = await fixture(t)
  await f.addSprite()
  const sheets = await f.addSettei()
  f.channel.maxReferences = 4
  const both = await f.prepare('sprite', {emotionId:'calm'})
  assert.deepEqual(both.references.filter(r => [sheets.views, sheets.parts].includes(r.hash)).map(r => r.hash), [sheets.views, sheets.parts])
  f.channel.maxReferences = 1
  const one = await f.prepare('sprite', {emotionId:'calm'})
  assert.deepEqual(one.references.map(r => r.hash), [sheets.views])
})
test('single-picture sprites and two-picture avatar sheets skip an installed accessory sheet over 8 MiB', async t => {
  const f = await fixture(t)
  await f.addSprite()
  const width = 2048, height = 1024, png = encodeAssetRgba({width,height,data:randomBytes(width * height * 4)})
  assert.ok(png.length > 8 * 1024 ** 2)
  const sheets = await f.addSettei(png)
  f.channel.maxReferences = 1
  f.reads.length = 0
  assert.deepEqual((await f.prepare('sprite', {emotionId:'calm'})).references.map(r => r.hash), [sheets.views])
  assert.ok(!f.reads.includes(sheets.parts), 'the parts sheet left out is not read')
  // four views and the calm 立绘 fit a channel of two; the parts sheet gives way instead of refusing the sheet.
  f.channel.maxReferences = 2
  const avatars = await f.draw('avatar-sheet')
  assert.equal(avatars.job.status, 'candidate')
  assert.equal(f.channel.sent.at(-1).references.length, 2)
  const [views, sprite] = avatars.plan.references
  assert.equal(views.hash, sheets.views)
  assert.equal(sprite.purpose, 'default-sprite')
  assert.ok(!f.reads.includes(sheets.parts))
})

test('adopting a drawn outfit settei over two sheets leaves one sheet: the old parts sheet is not used again', async t => {
  const f = await fixture(t)
  await f.addSprite()
  const sheets = await f.addSettei()
  f.channel.maxReferences = 4
  const drawn = await f.draw('settei', {userPrompt:'school uniform'})
  await f.service.accept({jobId:drawn.job.jobId, expectedRevision:await f.revision(), replace:true})
  const outfit = await f.outfit()
  assert.notEqual(outfit.settei, sheets.views)
  assert.equal(outfit.setteiParts, undefined)
  assert.deepEqual((await f.prepare('sprite', {emotionId:'calm'})).references.map(r => r.hash), [outfit.settei])
})