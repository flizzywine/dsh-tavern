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
import {copyFigureAssets} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-figure.js'
import {copyPackItems} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/copy-items.js'

const require = createRequire(import.meta.url)
const {createStageFigureVideos, videoCadence} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-video.cjs')

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

test('an image may name transitions into the outfit\'s other images that have their own videos', async () => {
  const pack = await packWithVideo(), figure = pack.figures[FIGURE_ID], sprite = figure.outfits[0].sprite
  pack.manifest.assets.push(videoEntry({id: 'calm-to-crying', name: 'Calm to crying', bundleKey: 'video-calm-to-crying', loop: false, size: [800, 1536]}))
  pack.manifest.bundles['video-calm-to-crying'] = {kind: 'video', entry: 'loop.mp4', contentHash: 'a'.repeat(64)}
  sprite.videos.crying = {video: 'calm-loop', rect: [100, 40, 320, 768]}
  sprite.videos.calm.into = {crying: {video: 'calm-to-crying', rect: [0, 40, 400, 768]}}
  validateFigure(figure); validateFigureClosure(pack.manifest, pack.figures, pack.sprites)
  for (const edge of [{video: 'calm-to-crying'}, {video: 'calm-to-crying', rect: [0, 0, 1.5, 10]}, {video: 'calm-to-crying', rect: [0, 40, 400, 768], loop: false}]) {
    sprite.videos.calm.into = {crying: edge}
    assert.throws(() => validateFigure(figure), error => error.path.includes('.videos.calm.into.crying'))
  }
  const closure = (into, pattern) => { sprite.videos.calm.into = into; assert.throws(() => validateFigureClosure(pack.manifest, pack.figures, pack.sprites), pattern) }
  closure({calm: {video: 'calm-to-crying', rect: [0, 40, 400, 768]}}, /another image of the outfit that has its own videos/)
  closure({crying: {video: 'nothing', rect: [0, 40, 400, 768]}}, error => /Missing video entry: nothing/.test(error.message) && error.path.endsWith('.calm.into.crying.video'))
  closure({crying: {video: 'calm-to-crying', rect: [0, 0, 320, 768]}}, /aspect ratio/)
  delete sprite.videos.crying
  closure({crying: {video: 'calm-to-crying', rect: [0, 40, 400, 768]}}, /another image of the outfit that has its own videos/)
  // Projected with the image it leaves and its outfit; a transition entry turned off is no transition.
  sprite.videos.crying = {video: 'calm-loop', rect: [100, 40, 320, 768]}
  sprite.videos.calm.into = {crying: {video: 'calm-to-crying', rect: [0, 40, 400, 768]}}
  const calm = selectPackFigure(figure, pack.sprites, {outfitKey: 'school', emotion: 'calm', appearance: 'sprite'}), snapshot = {manifest: pack.manifest}
  const projected = packFigureVideo(snapshot, calm)
  assert.deepEqual([projected.outfit, projected.image, Object.keys(projected.into)], ['school', 'calm', ['crying']])
  assert.deepEqual([projected.into.crying.source.assetId, projected.into.crying.source.hash, projected.into.crying.rect], ['calm-to-crying', 'a'.repeat(64), [0, 40, 400, 768]])
  assert.equal(packFigureVideo(snapshot, selectPackFigure(figure, pack.sprites, {outfitKey: 'school', emotion: 'crying', appearance: 'sprite'})).image, 'crying')
  pack.manifest.assets.find(row => row.id === 'calm-to-crying').enabled = false
  assert.deepEqual(packFigureVideo(snapshot, calm).into, {})
  // Copied along with the figure.
  pack.manifest.assets.find(row => row.id === 'calm-to-crying').enabled = true
  for (const name of ['video-calm-loop', 'video-calm-talk', 'video-calm-to-crying']) pack.files.set('bundles/' + name + '/loop.mp4', Buffer.from(name))
  const target = () => ({id: '33333333-3333-4333-8333-333333333333', figures: [], sprites: {}, blobs: {}, files: [], assets: [], bundles: {}})
  const check = (manifest, files, figureId) => {
    const copied = JSON.parse(files.get('figures/' + figureId + '.json'))
    assert.deepEqual(copied.outfits[0].sprite.videos.calm.into, {crying: {video: 'calm-to-crying', rect: [0, 40, 400, 768]}})
    assert.equal(String(files.get('bundles/video-calm-to-crying/loop.mp4')), 'video-calm-to-crying')
    assert.equal(manifest.assets.filter(row => row.id === 'calm-to-crying').length, 1)
  }
  const one = target(), oneFiles = new Map()
  check(one, oneFiles, copyFigureAssets(pack, FIGURE_ID, one, oneFiles).figureId)
  const many = target(), manyFiles = new Map()
  const copied = copyPackItems(pack, [{kind: 'figures', id: FIGURE_ID}, {kind: 'videos', id: 'calm-to-crying'}], many, manyFiles, new Set())
  check(many, manyFiles, copied.find(row => row.kind === 'figures').toId)
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
    // the cadence sampler while blending
    if (tag === 'canvas') return {getContext: () => ({drawImage() {}, getImageData: (x, y, w, h) => ({data: new Uint8ClampedArray(w * h * 4)})})}
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
  const PIXI = {MIPMAP_MODES: {OFF: 0, ON: 1}, VideoResource: class { constructor(source, options) { this.source = source; this.options = options; this.autoUpdate = true; this.updates = 0 } update() { this.updates++ } },
    BaseTexture: class { constructor(resource, options) { this.resource = resource; this.options = options } destroy() { this.destroyed = true } },
    Texture: class { constructor(base) { this.baseTexture = base } }, Program: {from: () => ({})},
    MeshMaterial: class { constructor(texture, options) { this.texture = texture; this.options = options; this.uniforms = options.uniforms } }, PlaneGeometry: class {}, Mesh: class extends Node { constructor(geometry, material) { super(); this.material = material } }}
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
  assert.equal(mesh.material.texture.baseTexture.options.mipmap, PIXI.MIPMAP_MODES.ON, 'mipmapped: the downscaled figure does not shimmer')
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

test('a loop drawn on twos is told from one that changes every frame', () => {
  const intervals = (diff, from = 1) => Array.from({length: 40}, (_, i) => [from + i, diff(from + i)])
  assert.deepEqual(videoCadence(intervals(() => 1)), {step: 1, phase: 0})
  assert.deepEqual(videoCadence(intervals(i => i % 2 ? 0.6 + (i % 3) * 0.1 : 1.3)), {step: 1, phase: 0}, 'an uneven but every-frame loop')
  assert.deepEqual(videoCadence(intervals(i => i % 2 ? 4 : 0.6)), {step: 2, phase: 1}, 'the measured joy loop: a fifth of the change between drawings')
  assert.deepEqual(videoCadence(intervals(i => i % 3 === 2 ? 3 : 0.1)), {step: 3, phase: 2})
})

test('every decoded frame reaches the texture; blending keeps the frame before and crossfades on a steady clock', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  let share = 0, clock = 0
  const scope = createStageFigureVideos({document, acquire: () => ({video: Promise.resolve('blob:x'), release() {}}), foreground: null}).create({PIXI, blend: () => share, now: () => clock})
  const handle = scope.attach(sprite, {source: {hash: 'h'}, rect: [0, 0, 10, 10]})
  await flush()
  const [video] = videos
  let callback = null
  video.requestVideoFrameCallback = fn => { callback = fn }
  video.fire('loadeddata')
  const material = sprite.children[0].material, first = material.texture
  assert.equal(first.baseTexture.resource.options.updateFPS, 0, 'no throttle of PIXI\'s own: it counts its ticker, not the frames')
  assert.equal(first.baseTexture.resource.autoUpdate, false)
  const frame = (index, at) => { clock = at; callback(at, {mediaTime: index / 24, presentedFrames: index}) }
  for (let i = 0; i < 3; i++) frame(i, i * 1000 / 24)
  assert.equal(first.baseTexture.resource.updates, 3, 'one upload per frame')
  assert.equal(material.texture, first, 'not blending: one texture')
  // Blending: each frame goes into the texture of the frame before last, which becomes the latest.
  share = 1
  frame(3, 125)
  const second = material.texture
  assert.notEqual(second, first); assert.equal(material.uniforms.uPrev, first)
  frame(4, 125 + 1000 / 24)
  assert.equal(material.texture, first); assert.equal(material.uniforms.uPrev, second)
  // At a new frame the clock stands on the one before and reaches it as the next arrives: an even pace in between.
  handle.update({on: true})
  const mixAt = at => { clock = at; handle.tick(16); return Math.round(material.uniforms.uMix * 100) / 100 }
  const arrived = 125 + 1000 / 24
  assert.deepEqual([mixAt(arrived), mixAt(arrived + 1000 / 48), mixAt(arrived + 1000 / 24), mixAt(arrived + 100)], [0, 0.5, 1, 1])
  // Half: the frame holds for the first half, then crossfades.
  share = 0.5
  assert.deepEqual([mixAt(arrived + 1000 / 48), mixAt(arrived + 1000 / 32)], [0, 0.5])
  // A start from the first frame shows the new frame alone.
  share = 1; handle.tick(16); video.ended = true; handle.update({on: true}); handle.tick(16)
  video.ended = false; video.currentTime = 0
  frame(0, 1000)
  assert.equal(mixAt(1000), 1)
  handle.destroy()
  assert.ok(first.baseTexture.destroyed && second.baseTexture.destroyed, 'both textures released')
  scope.dispose()
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

test('a heard voice plays the talking loop from its first frame, loops it across short gaps, and plays it out to the still before the idle loop', async () => {
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
  // The hand-off: the talking loop fades in on top while the idle loop stays whole underneath, so the still never shows.
  assert.ok(sprite.children.indexOf(talkMesh) > sprite.children.indexOf(idleMesh), 'the incoming clip draws over the outgoing one')
  assert.ok(talkMesh.alpha > 0 && talkMesh.alpha < 1); assert.equal(idleMesh.alpha, 1)
  let draws = sprite.draws; sprite._render(); assert.equal(sprite.draws, draws, 'no still between the clips')
  handle.tick(200); assert.equal(talkMesh.alpha, 1); assert.equal(idleMesh.alpha, 1, 'the outgoing clip drops only once covered')
  handle.tick(200); assert.equal(idleMesh.visible, false); assert.equal(idle.paused, true, 'the idle loop pauses once faded out')
  // A gap between words at the clip's end is still speech: it starts over.
  handle.update({on: true, talking: false}); handle.tick(200)
  talk.currentTime = 2.9; talk.paused = true; talk.ended = true; handle.tick(16)
  assert.equal(talk.plays, 2); assert.equal(talk.currentTime, 0); assert.equal(talkMesh.alpha, 1)
  // The voice stops mid-clip: it plays on, then the idle loop takes over from its first frame.
  talk.currentTime = 1.2; handle.tick(16); handle.tick(400)
  assert.equal(handle.state().phase, 'talk'); assert.equal(talkMesh.alpha, 1)
  talk.paused = true; talk.ended = true; handle.tick(16)
  assert.equal(handle.state().phase, 'idle'); assert.equal(idle.currentTime, 0); assert.equal(idle.paused, false)
  assert.ok(sprite.children.indexOf(idleMesh) > sprite.children.indexOf(talkMesh), 'back to idle: the idle loop draws on top')
  draws = sprite.draws; sprite._render(); assert.equal(sprite.draws, draws, 'the ended talking loop holds its last frame under the idle loop')
  handle.tick(100); assert.ok(idleMesh.alpha > 0 && idleMesh.alpha < 1); assert.equal(talkMesh.alpha, 1)
  handle.tick(200); assert.equal(talkMesh.visible, false, 'the ended clip held its last frame until the idle loop covered it')
  sprite._render(); assert.equal(sprite.draws, draws, 'a full idle loop hides the still')
  // A talking loop that fails: the stage is told to speak through the still, the idle loop stays.
  const warn = console.warn; console.warn = () => {}
  try { talk.error = {code: 3}; talk.fire('error') } finally { console.warn = warn }
  assert.equal(handle.talks(), false); handle.update({on: true, talking: true}); handle.tick(16); assert.equal(handle.state().phase, 'idle')
  scope.dispose()
  assert.equal(sprite.children.length, 0)
})

test('a change of picture enters through its transition: the still waits, the transition shows whole, plays once, then the idle loop takes over', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  const scope = createStageFigureVideos({document, acquire: source => ({video: Promise.resolve('blob:' + source.id), release() {}}), foreground: null}).create({PIXI})
  const handle = scope.attach(sprite, {source: {id: 'idle'}, talk: {id: 'talk'}, rect: [0, 0, 10, 10], enter: {source: {id: 'enter'}, rect: [0, 0, 20, 10]}})
  await flush()
  const [idle, talk, enter] = videos
  assert.equal(enter.loop, false)
  handle.update({on: true})
  // Awaited: the still does not draw (the previous picture on top is what shows) and the handle claims the figure.
  assert.equal(handle.tick(16), true); assert.equal(handle.entering(), 'pending')
  sprite._render(); assert.equal(sprite.draws, 0)
  idle.fire('loadeddata'); talk.fire('loadeddata'); enter.fire('loadeddata')
  const enterMesh = sprite.children[0], idleMesh = sprite.children.find(c => c !== enterMesh && c.material.texture.baseTexture.resource.source === idle)
  assert.deepEqual([enterMesh.sx, enterMesh.sy], [20, 10], 'the transition over its own rect')
  handle.tick(16)
  assert.equal(enter.plays, 1); assert.equal(enter.currentTime, 0); assert.equal(handle.entering(), 'on'); assert.equal(enterMesh.alpha, 1, 'whole at once, under the previous picture\'s fade')
  assert.equal(idle.plays, 0)
  handle.tick(400); assert.equal(enter.plays, 1, 'played once'); sprite._render(); assert.equal(sprite.draws, 0)
  // Played out: the idle loop takes over from its first frame over the transition's held last frame.
  enter.paused = true; enter.ended = true; idle.currentTime = 1.3
  handle.tick(16)
  assert.equal(handle.entering(), null); assert.equal(handle.state().phase, 'idle'); assert.equal(idle.plays, 1); assert.equal(idle.currentTime, 0)
  assert.ok(sprite.children.indexOf(idleMesh) > sprite.children.indexOf(enterMesh))
  handle.tick(100); assert.ok(idleMesh.alpha > 0 && idleMesh.alpha < 1); assert.equal(enterMesh.alpha, 1)
  handle.tick(200); assert.equal(idleMesh.alpha, 1); handle.tick(200); assert.equal(enterMesh.visible, false)
  sprite._render(); assert.equal(sprite.draws, 0)
  scope.dispose()
})

test('a transition that ends while the voice is heard hands over to the talking loop; one that does not come in time is dropped', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  const scope = createStageFigureVideos({document, acquire: source => ({video: Promise.resolve('blob:' + source.id), release() {}}), foreground: null}).create({PIXI})
  const handle = scope.attach(sprite, {source: {id: 'idle'}, talk: {id: 'talk'}, rect: [0, 0, 10, 10], enter: {source: {id: 'enter'}, rect: [0, 0, 10, 10]}})
  await flush()
  const [idle, talk, enter] = videos
  for (const video of videos) video.fire('loadeddata')
  handle.update({on: true, talking: true}); handle.tick(16)
  assert.equal(handle.state().phase, 'enter'); assert.equal(talk.plays, 0, 'the transition plays out with its own mouth')
  enter.paused = true; enter.ended = true; handle.tick(16)
  assert.equal(handle.state().phase, 'talk'); assert.equal(talk.plays, 1); assert.equal(talk.currentTime, 0); assert.equal(idle.plays, 0)
  scope.dispose()
  // Not loaded in time: the still is back and the pictures crossfade as without one.
  const late = fakeDom()
  const lateScope = createStageFigureVideos({document: late.document, acquire: source => ({video: Promise.resolve('blob:' + source.id), release() {}}), foreground: null}).create({PIXI: late.PIXI})
  const waiting = lateScope.attach(late.sprite, {source: {id: 'idle'}, rect: [0, 0, 10, 10], enter: {source: {id: 'enter'}, rect: [0, 0, 10, 10]}})
  await flush()
  waiting.update({on: true}); waiting.tick(300); assert.equal(waiting.entering(), 'pending')
  waiting.tick(400); assert.equal(waiting.entering(), null); assert.equal(waiting.state().phase, 'idle')
  late.sprite._render(); assert.equal(late.sprite.draws, 1, 'the still draws again')
  late.videos[1].fire('loadeddata'); waiting.tick(16); assert.equal(late.videos[1].plays, 0, 'a dropped transition never plays')
  // Motion turned off (a skip) drops it too.
  const off = lateScope.attach(late.sprite, {source: {id: 'idle'}, rect: [0, 0, 10, 10], enter: {source: {id: 'enter'}, rect: [0, 0, 10, 10]}})
  off.update({on: false}); off.tick(16); assert.equal(off.entering(), null)
  lateScope.dispose()
})

test('the shown picture loads its transitions out ahead and hands the loaded one to the picture that enters through it', async () => {
  const {document, PIXI, sprite, videos} = fakeDom()
  let released = 0
  const scope = createStageFigureVideos({document, acquire: source => ({video: Promise.resolve('blob:' + source.id), release() { released++ }}), foreground: null}).create({PIXI})
  const shown = scope.attach(sprite, {source: {id: 'calm'}, rect: [0, 0, 10, 10], into: {joy: {source: {id: 'calm-joy'}, rect: [0, 0, 10, 10]}, sad: {source: {id: 'calm-sad'}, rect: [0, 0, 10, 10]}}})
  await flush()
  const [, ahead, other] = videos
  assert.equal(ahead.src, 'blob:calm-joy'); assert.equal(ahead.loop, false); assert.equal(other.src, 'blob:calm-sad')
  ahead.fire('loadeddata'); other.fire('loadeddata')
  assert.equal(sprite.children.length, 0, 'loaded ahead without a figure: nothing draws')
  // The change: the next picture takes the loaded clip, which shows at once.
  const next = fakeDom().sprite
  const entering = scope.attach(next, {source: {id: 'joy'}, rect: [0, 0, 10, 10], enter: {source: {id: 'calm-joy'}, rect: [0, 0, 20, 10], clip: shown.lend('joy')}})
  await flush()
  assert.equal(shown.lend('joy'), null, 'lent once')
  assert.equal(videos.length, 4, 'no second element for the transition')
  assert.equal(next.children.length, 1); assert.deepEqual([next.children[0].sx, next.children[0].sy], [20, 10])
  entering.update({on: true}); entering.tick(16)
  assert.equal(ahead.plays, 1); assert.equal(entering.entering(), 'on')
  // The old picture goes with the transitions it kept, not the lent one.
  shown.destroy()
  assert.equal(released, 2); assert.equal(other.src, ''); assert.equal(ahead.src, 'blob:calm-joy')
  scope.dispose()
})

test('copying a figure takes its still loops along as entries of the target, renamed where the target has the id', async () => {
  const pack = await packWithVideo()
  pack.files.set('bundles/video-calm-loop/loop.mp4', Buffer.from('idle')); pack.files.set('bundles/video-calm-talk/loop.mp4', Buffer.from('talk'))
  const target = () => ({id: '33333333-3333-4333-8333-333333333333', figures: [], sprites: {}, blobs: {}, files: [],
    assets: [videoEntry({name: 'Other'})], bundles: {'video-calm-loop': {kind: 'video', entry: 'loop.mp4', contentHash: 'f'.repeat(64)}}})
  const check = (manifest, files, figureId) => {
    const figure = JSON.parse(files.get('figures/' + figureId + '.json'))
    assert.deepEqual(figure.outfits[0].sprite.videos.calm, {video: 'calm-loop-2', talk: 'calm-talk', rect: [100, 40, 320, 768]})
    const idle = manifest.assets.find(a => a.id === 'calm-loop-2'), talk = manifest.assets.find(a => a.id === 'calm-talk')
    assert.deepEqual([idle.bundleKey, talk.bundleKey], ['video-calm-loop-2', 'video-calm-talk'])
    assert.equal(String(files.get('bundles/video-calm-loop-2/loop.mp4')), 'idle'); assert.equal(String(files.get('bundles/video-calm-talk/loop.mp4')), 'talk')
    assert.deepEqual(idle.extensions.dsh_tavern.copiedFrom, {packId: pack.manifest.id, kind: 'videos', assetId: 'calm-loop'})
    assert.equal(manifest.assets.filter(a => a.kind === 'videos').length, 3, 'each loop once, beside the target\'s own')
  }
  const one = target(), oneFiles = new Map()
  check(one, oneFiles, copyFigureAssets(pack, FIGURE_ID, one, oneFiles).figureId)
  // Named together with the figure, a loop is still copied once.
  const many = target(), manyFiles = new Map()
  const copied = copyPackItems(pack, [{kind: 'figures', id: FIGURE_ID}, {kind: 'videos', id: 'calm-talk'}], many, manyFiles, new Set())
  check(many, manyFiles, copied.find(row => row.kind === 'figures').toId)
})