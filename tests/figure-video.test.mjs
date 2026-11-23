// 动态立绘: a still's looping video (outfit sprite.videos -> a 视频 entry with alpha 'right'), from the pack contract through
// the host projection to the stage's figure-video layer.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {syntheticPack, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {entranceDoc} from './fixtures/stage-entrance.mjs'
import {validateFigure, validateFigureClosure} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/figure.js'
import {validatePackManifest} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
import {selectPackFigure, packFigureVideo} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/asset-pack-presentation.js'

const require = createRequire(import.meta.url)
const {createStageFigureVideos} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-video.cjs')

const videoEntry = (fields = {}) => ({kind: 'videos', id: 'calm-loop', name: 'Calm loop', enabled: true, recall: {mode: 'constant', keywords: []}, directorNote: '',
  bundleKey: 'video-calm-loop', entry: 'loop.mp4', poster: 'poster.png', durationMs: 3000, loop: true, size: [640, 1536], alpha: 'right', ...fields})
async function packWithVideo(fields, rect = [100, 40, 320, 768]) {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  pack.manifest.assets.push(videoEntry(fields), videoEntry({id: 'calm-talk', name: 'Calm talk', bundleKey: 'video-calm-talk', loop: false}))
  pack.manifest.bundles['video-calm-loop'] = {kind: 'video', entry: 'loop.mp4', contentHash: 'c'.repeat(64)}
  pack.manifest.bundles['video-calm-talk'] = {kind: 'video', entry: 'loop.mp4', contentHash: 'e'.repeat(64)}
  figure.outfits[0].sprite.videos = {calm: {video: 'calm-loop', talk: 'calm-talk', rect}}
  return pack
}

test('a direct image may carry a figure video of its own pack; the closure names what is wrong', async () => {
  const pack = await packWithVideo()
  validateFigure(pack.figures[FIGURE_ID])
  validateFigureClosure(pack.manifest, pack.figures, pack.sprites)
  const sprite = pack.figures[FIGURE_ID].outfits[0].sprite
  for (const rect of [[0, 0, 0, 10], [-1, 0, 10, 10], [0, 0, 1.5, 10], [0, 0, 10]]) {
    sprite.videos.calm.rect = rect
    assert.throws(() => validateFigure(pack.figures[FIGURE_ID]), error => error.path.endsWith('.videos.calm.rect'))
  }
  sprite.videos.calm = {video: 'calm-loop', rect: [100, 40, 320, 768], loop: true}
  assert.throws(() => validateFigure(pack.figures[FIGURE_ID]))
  sprite.videos = {missing: {video: 'calm-loop', rect: [100, 40, 320, 768]}}
  assert.throws(() => validateFigureClosure(pack.manifest, pack.figures, pack.sprites), /Measurements belong to a direct image/)
  sprite.videos = {calm: {video: 'nothing', rect: [100, 40, 320, 768]}}
  assert.throws(() => validateFigureClosure(pack.manifest, pack.figures, pack.sprites), /Missing video entry: nothing/)
  sprite.videos = {calm: {video: 'calm-loop', talk: 'nothing', rect: [100, 40, 320, 768]}}
  assert.throws(() => validateFigureClosure(pack.manifest, pack.figures, pack.sprites), error => /Missing video entry: nothing/.test(error.message) && error.path.endsWith('.calm.talk'))
  sprite.videos = {calm: {video: 'calm-loop', rect: [100, 40, 320, 768]}}
  validateFigureClosure(pack.manifest, pack.figures, pack.sprites)
  await assert.rejects(async () => { const opaque = await packWithVideo({alpha: 'none'}); validateFigureClosure(opaque.manifest, opaque.figures, opaque.sprites) }, /alpha: right/)
  await assert.rejects(async () => { const wide = await packWithVideo({}, [0, 0, 768, 768]); validateFigureClosure(wide.manifest, wide.figures, wide.sprites) }, /aspect ratio/)
})

test('an entrance never plays a figure video: the page player would show its matte', async () => {
  const pack = await syntheticPack()
  const manifest = structuredClone(pack.manifest)
  manifest.assets.push(videoEntry())
  manifest.bundles['video-calm-loop'] = {kind: 'video', entry: 'loop.mp4', contentHash: 'c'.repeat(64)}
  for (const name of ['loop.mp4', 'poster.png']) manifest.files.push({path: 'bundles/video-calm-loop/' + name, size: 1, sha256: 'd'.repeat(64)})
  const doc = entranceDoc(); doc.layers.video = {asset: 'calm-loop'}
  manifest.assets.push({kind: 'entrances', id: 'intro', name: 'Intro', enabled: true, recall: {mode: 'constant', keywords: []}, directorNote: '', entrance: doc})
  assert.throws(() => validatePackManifest(manifest), /not a figure video \(alpha: right\): calm-loop/)
  manifest.assets.find(row => row.id === 'calm-loop').alpha = 'none'
  validatePackManifest(manifest)
})

test('the host projects the shown still\'s video once: off, opaque or another image is the still alone', async () => {
  const pack = await packWithVideo()
  const figure = pack.figures[FIGURE_ID]
  const snapshot = {manifest: pack.manifest}
  const calm = selectPackFigure(figure, pack.sprites, {outfitKey: 'school', emotion: 'calm', appearance: 'sprite'})
  const projected = packFigureVideo(snapshot, calm)
  assert.deepEqual(projected.rect, [100, 40, 320, 768])
  assert.deepEqual(projected.source, {packId: pack.manifest.id, assetId: 'calm-loop', bundleKey: 'video-calm-loop', hash: 'c'.repeat(64),
    entry: 'loop.mp4', poster: 'poster.png', durationMs: 3000, loop: true, audio: 'none', size: [640, 1536], fit: 'cover', volume: 1, alpha: 'right'})
  assert.deepEqual([projected.talk.assetId, projected.talk.hash, projected.talk.loop], ['calm-talk', 'e'.repeat(64), false])
  // A talking loop off leaves speech to the still's mouths; the idle loop stays.
  pack.manifest.assets.find(row => row.id === 'calm-talk').enabled = false
  assert.equal(packFigureVideo(snapshot, calm).talk, null)
  const crying = selectPackFigure(figure, pack.sprites, {outfitKey: 'school', emotion: 'crying', appearance: 'sprite'})
  assert.equal(packFigureVideo(snapshot, crying), null)
  pack.manifest.assets.find(row => row.id === 'calm-loop').enabled = false
  assert.equal(packFigureVideo(snapshot, calm), null)
  pack.manifest.assets.find(row => row.id === 'calm-loop').enabled = true
  pack.manifest.assets.find(row => row.id === 'calm-loop').alpha = 'none'
  assert.equal(packFigureVideo(snapshot, calm), null)
})

// A browser stand-in: a video element whose events the test fires, and the PIXI surface the layer uses.
function fakeDom() {
  const videos = []
  const document = {createElement(tag) {
    assert.equal(tag, 'video')
    const listeners = {}
    const video = {tag, attributes: {}, paused: true, ended: false, currentTime: 0, readyState: 0, videoWidth: 1280, videoHeight: 1536, src: '', loads: 0, plays: 0,
      setAttribute(name, value) { this.attributes[name] = value }, removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = '' },
      addEventListener(name, fn) { (listeners[name] ||= []).push(fn) }, fire(name) { for (const fn of listeners[name] || []) fn() },
      load() { this.loads++ }, play() { this.plays++; this.paused = false; this.ended = false; this.readyState = 4; return Promise.resolve() }, pause() { this.paused = true }}
    videos.push(video)
    return video
  }}
  class Node { constructor() { this.children = []; this.position = {set: (x, y) => { this.x = x; this.y = y }}; this.scale = {set: (x, y) => { this.sx = x; this.sy = y }}; this.visible = true; this.alpha = 1 }
    addChildAt(child, index) { child.parent = this; this.children.splice(index, 0, child) } removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null }
    destroy() { this.destroyed = true } }
  const PIXI = {MIPMAP_MODES: {OFF: 0}, VideoResource: class { constructor(source, options) { this.source = source; this.options = options; this.autoUpdate = true; this.updates = 0 } update() { this.updates++ } },
    BaseTexture: class { constructor(resource) { this.resource = resource } destroy() { this.destroyed = true } },
    Texture: class { constructor(base) { this.baseTexture = base } }, Program: {from: () => ({})},
    MeshMaterial: class { constructor(texture, options) { this.texture = texture; this.options = options } }, PlaneGeometry: class {}, Mesh: class extends Node { constructor(geometry, material) { super(); this.material = material } }}
  const sprite = new Node()
  sprite.anchor = {x: 0.5, y: 1}; sprite.texture = {width: 1440, height: 2160}
  sprite.draws = 0; sprite._render = function () { this.draws++ }
  return {document, PIXI, sprite, videos}
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('the figure video plays over the still only while it is wanted, crossfades, and releases everything', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  let released = 0, media = 0
  const owner = createStageFigureVideos({document, acquire: (source, options) => { assert.deepEqual(options, {poster: false}); return {video: Promise.resolve('blob:loop'), release() { released++ }} }, foreground: {media() { media++ }}})
  const scope = owner.create({PIXI})
  const handle = scope.attach(sprite, {source: {packId: 'p'}, rect: [351, 254, 757, 1817]})
  await flush()
  const [video] = videos
  assert.equal(video.src, 'blob:loop'); assert.equal(video.muted, true); assert.equal(video.loop, true); assert.equal(video.playsInline, true); assert.equal(media, 1)
  // Until the video has a frame, the still draws and nothing plays.
  handle.update({on: true}); assert.equal(handle.tick(16), false); sprite._render(); assert.equal(sprite.draws, 1)
  video.fire('loadeddata')
  const mesh = sprite.children[0]
  assert.ok(mesh instanceof PIXI.Mesh); assert.deepEqual([mesh.x, mesh.y, mesh.sx, mesh.sy], [351 - 720, 254 - 2160, 757, 1817])
  handle.tick(16); assert.equal(video.plays, 1); assert.equal(video.currentTime, 0)
  handle.tick(120); assert.ok(mesh.alpha > 0 && mesh.alpha < 1); sprite._render(); assert.equal(sprite.draws, 2, 'the still stays under a fading video')
  handle.tick(200); assert.equal(mesh.alpha, 1); sprite._render(); assert.equal(sprite.draws, 2, 'a full video hides the still')
  // Off (a skip, a tap still, speech on the still): it fades out, then pauses.
  handle.update({on: false}); handle.tick(120); assert.equal(video.paused, false); sprite._render(); assert.equal(sprite.draws, 3)
  handle.tick(200); assert.equal(mesh.visible, false); assert.equal(video.paused, true)
  handle.destroy()
  assert.equal(released, 1); assert.equal(video.src, ''); assert.equal(mesh.destroyed, true); assert.equal(sprite.children.length, 0)
  sprite._render(); assert.equal(sprite.draws, 4, 'the still draws itself again')
  scope.dispose(); owner.dispose()
})

test('a video that cannot play leaves the still for good', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  const scope = createStageFigureVideos({document, acquire: () => ({video: Promise.resolve('blob:x'), release() {}}), foreground: null}).create({PIXI})
  const handle = scope.attach(sprite, {source: {}, rect: [0, 0, 10, 10]})
  await flush()
  const warn = console.warn; console.warn = () => {}
  try { videos[0].error = {code: 4}; videos[0].fire('error') } finally { console.warn = warn }
  videos[0].fire('loadeddata')
  handle.update({on: true})
  assert.equal(handle.tick(500), false); assert.equal(handle.state().status, 'failed'); assert.equal(videos[0].plays, 0)
  sprite._render(); assert.equal(sprite.draws, 1)
  scope.dispose()
  assert.equal(handle.state().status, 'released')
})

test('speech plays the talking loop from its first frame, loops it, and plays it out to the still before the idle loop', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  const scope = createStageFigureVideos({document, acquire: source => ({video: Promise.resolve('blob:' + source.id), release() {}}), foreground: null}).create({PIXI})
  const handle = scope.attach(sprite, {source: {id: 'idle'}, talk: {id: 'talk'}, rect: [0, 0, 10, 10]})
  await flush()
  const [idle, talk] = videos
  assert.equal(idle.loop, true); assert.equal(talk.loop, false, 'the talking loop ends on the still, so the handle restarts it')
  assert.equal(handle.talks(), false, 'not loaded yet: the stage speaks through the still')
  idle.fire('loadeddata'); talk.fire('loadeddata')
  const [talkMesh, idleMesh] = sprite.children
  assert.equal(handle.talks(), true)
  handle.update({on: true}); handle.tick(16); handle.tick(400); assert.equal(idleMesh.alpha, 1)
  idle.currentTime = 1.7
  handle.update({on: true, talking: true}); handle.tick(16)
  assert.equal(handle.state().phase, 'talk'); assert.equal(talk.plays, 1); assert.equal(talk.currentTime, 0)
  handle.tick(200); assert.equal(talkMesh.alpha, 1); assert.equal(idleMesh.visible, false); assert.equal(idle.paused, true, 'the idle loop pauses once faded out')
  // Still speaking at the clip's end: it starts over.
  talk.currentTime = 2.9; talk.paused = true; talk.ended = true; handle.tick(16)
  assert.equal(talk.plays, 2); assert.equal(talk.currentTime, 0); assert.equal(talkMesh.alpha, 1)
  // The line ends mid-clip: it plays on, then the idle loop takes over from its first frame.
  talk.currentTime = 1.2; handle.update({on: true, talking: false}); handle.tick(16)
  assert.equal(handle.state().phase, 'talk'); assert.equal(talkMesh.alpha, 1)
  talk.paused = true; talk.ended = true; handle.tick(16)
  assert.equal(handle.state().phase, 'idle'); assert.equal(idle.currentTime, 0); assert.equal(idle.paused, false)
  sprite._render(); const draws = sprite.draws
  handle.tick(200); assert.equal(idleMesh.alpha, 1); assert.equal(talkMesh.visible, false, 'the ended clip held its last frame while the idle loop faded in')
  sprite._render(); assert.equal(sprite.draws, draws, 'a full idle loop hides the still')
  // A talking loop that fails: the stage is told to speak through the still, the idle loop stays.
  const warn = console.warn; console.warn = () => {}
  try { talk.error = {code: 3}; talk.fire('error') } finally { console.warn = warn }
  assert.equal(handle.talks(), false); handle.update({on: true, talking: true}); handle.tick(16); assert.equal(handle.state().phase, 'idle')
  scope.dispose()
  assert.equal(sprite.children.length, 0)
})
