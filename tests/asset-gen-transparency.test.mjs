// 素材生图's transparent pictures end to end: a 立绘 that only touches the canvas edge is adopted (it has no background); a
// channel that answers with a background is remembered and its next pictures are drawn on a key colour and keyed out here;
// a picture that still has a background says why and what to do, and can always be looked at, downloaded and dropped.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { createAssetGeneration } from '../tavern-plugin/lib/domain/asset-generation.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {encodeAssetRgba, decodeAssetRgba, alignAssetSprite, checkSpriteCutout, checkAssetImage} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import publication from '../tavern-plugin/shared/asset-image-publication.cjs'
import sprites from '../tavern-plugin/shared/sprite-emotions.cjs'

const W = 240, H = 360
// A full-body figure 120 wide; `top`/`bottom` its first and last rows; `ground` paints everything else (null = transparent).
// `haze` rows of translucent white fog along the top.
function figure({top = 30, bottom = 340, left = 60, width = 120, ground = null, cornerNoise = false, haze = 0} = {}) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = y >= top && y <= bottom && x >= left && x < left + width
    if (inside) data.set([180, 120, 90, 255], (y * W + x) * 4)
    else if (ground) data.set([...ground, 255], (y * W + x) * 4)
    else if (y < haze) data.set([250, 250, 250, 120], (y * W + x) * 4)
  }
  if (cornerNoise) data[3] = 1
  return encodeAssetRgba({width:W, height:H, data})
}
const visible = png => { const {data} = decodeAssetRgba(png); let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++; return n }

async function fixture(t, {transparent, emotions = [{id:'calm'}]} = {}) {
  const base = fileURLToPath(new URL('../.preview/asset-gen-transparency-tests/', import.meta.url)); await mkdir(base, {recursive:true})
  const root = await mkdtemp(base + 'case-'), store = createProfileDataStore({dataRoot:root + '/data'}), library = createAssetPackService({assetRoot:root + '/packs'})
  const channel = {sent:[], next:() => figure()}
  const provider = {label:'配图', status:async () => ({ready:true, model:'relay-image', maxReferences:4, ...(transparent === undefined ? {} : {transparent})}),
    generate:async request => { channel.sent.push(request); return {data:channel.next(request), mediaType:'image/png'} }}
  const service = createAssetGeneration({store, getLibrary:() => library, imageProvider:() => provider})
  t.after(async () => { await service.dispose(); await library.dispose() })
  const pack = (await library.createPack({name:'Alpha', expectedRevision:null})).snapshot
  const created = await library.createFigure({packId:pack.manifest.id, expectedRevision:pack.revision, figure:{schemaVersion:1, name:'白瑾', appearance:'sprite',
    emotions, outfits:[{key:'default', label:'默认', enabled:true, defaultEmotion:'calm', recall:{mode:'keyword', keywords:['白瑾']}}]}})
  const target = {packId:pack.manifest.id, figureId:created.figureId, outfitKey:'default', kind:'sprite', emotionId:'calm'}
  const revision = async () => (await library.getPackSnapshot({packId:pack.manifest.id})).revision
  // A picture put on a 差分 as the editor's upload puts it (no check: an upload may be any picture).
  async function upload(emotion, bytes) {
    const {width, height} = decodeAssetRgba(bytes), image = {bytes, descriptor:{ext:'png', mime:'image/png', size:bytes.length}, width, height}
    const publisher = publication.create({newResourceKey:prefix => prefix + '-' + Math.random().toString(36).slice(2), emotionState:(_o, manifest, id) => sprites.spriteEmotionState(manifest, id)})
    const snapshot = await library.getPackSnapshot({packId:pack.manifest.id})
    await library.patchPack(await publisher.figure({snapshot, image, media:await publication.closure(image), figureId:created.figureId, outfitKey:'default', emotion, kind:'sprite'}))
  }
  async function draw(emotionId = 'calm') {
    const plan = await service.prepare({target:{...target, emotionId}, expectedRevision:await revision(), userPrompt:'黑色外套，短裙，抱臂'})
    const [job] = (await service.generate({planId:plan.planId, consentToken:plan.consentToken})).jobs
    for (;;) { const now = await service.get({jobId:job.jobId}); if (now.status !== 'running') return {plan, job:now}; await new Promise(r => setTimeout(r, 10)) }
  }
  return {service, channel, draw, store, upload}
}
const codes = job => job.candidate.checks.warnings.map(w => w.code)

test('a channel that answers with a background: the candidate says why and what to do, can be read, downloaded and dropped; the model is keyed from then on', async t => {
  const f = await fixture(t)
  f.channel.next = () => figure({ground:[240, 240, 240]})
  const first = await f.draw()
  assert.equal(f.channel.sent[0].background, 'transparent')
  const warning = first.job.candidate.checks.warnings.find(w => w.code === 'NO_TRANSPARENCY')
  assert.match(warning.message, /没有画出透明底.*重画/)
  await assert.rejects(f.service.read({jobId:first.job.jobId, forImport:true}), e => e.code === 'SPRITE_BACKGROUND' && e.message.startsWith('不能采用为立绘：生图渠道没有画出透明底'))
  assert.ok((await f.service.read({jobId:first.job.jobId})).base64, 'the picture itself can still be viewed and downloaded')
  assert.equal((await f.service.reject({jobId:first.job.jobId})).status, 'rejected')

  // The next request of this model is drawn on a key colour and keyed out: a transparent candidate that is adopted.
  f.channel.next = request => figure({ground:request.prompt.includes('#00FF00') ? [0, 255, 0] : [240, 240, 240]})
  const second = await f.draw()
  const sent = f.channel.sent[1]
  assert.equal(sent.background, 'opaque')
  assert.match(sent.prompt, /^Background: one flat solid #00FF00 colour/m)
  assert.doesNotMatch(sent.prompt, /Background: fully transparent/)
  assert.ok(!codes(second.job).includes('NO_TRANSPARENCY'))
  const png = Buffer.from((await f.service.read({jobId:second.job.jobId, forImport:true})).base64, 'base64')
  assert.equal(checkSpriteCutout(png).valid, true)
})

test('placing an adopted 立绘 never crops: moved back onto the canvas, and shrunk to fit the ruler when too wide', () => {
  const tall = figure({top:2, bottom:H - 1})
  const placed = alignAssetSprite(tall)
  assert.equal(visible(placed), visible(tall))
  const ruler = figure({top:60, bottom:340, left:100, width:40})
  const wide = figure({top:150, bottom:300, left:10, width:220})
  const fitted = alignAssetSprite(wide, ruler), box = checkAssetImage(fitted, 'sprite').bbox
  assert.ok(box.x >= 0 && box.x + box.w <= W && box.y + box.h <= H, 'inside the ruler canvas')
  assert.ok(Math.abs(box.y + box.h - 341) <= 2, 'feet on the ruler line')
})
