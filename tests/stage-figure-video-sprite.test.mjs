import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const packAvatar = require('../tavern-plugin/lib/domain/pack-avatar.cjs')
const { createAssetPackPresentation } = await import('../tavern-plugin/packages/dsh-tavern-stage/lib/domain/asset-pack-presentation.js')
const { createStageVideo } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/video.cjs')
const { createStageScene } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs')
const { createStageSceneMath } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-math.cjs')
const figureScale = require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
const colorMath = require('../tavern-plugin/shared/color-math.cjs')
const { spriteRenderManifest } = require('../tavern-plugin/shared/sprite-emotions.cjs')
const { layeredSpriteManifest, layeredSpriteMapAssets } = require('../tavern-plugin/src/client/layered-sprite.cjs')
const { packFigureRenderInputs } = require('../tavern-plugin/src/client/pack-playback.cjs')

test('static-sprites with video keeps avatar fallback on still src and projects videos entry from host', async () => {
  const packId = '11111111-1111-4111-8111-111111111111'
  const figId = '22222222-2222-4222-8222-222222222222'
  const stillHash = 'a'.repeat(64)
  const videoHash = 'b'.repeat(64)
  let videoEnabled = true

  const packSnapshot = () => ({
    revision: videoEnabled ? 'rev-1' : 'rev-2',
    manifest: {
      id: packId,
      format: 'dsh-asset-pack',
      schemaVersion: 1,
      name: 'Test Pack',
      figures: [figId],
      sprites: { hero: 'sprites/hero/manifest.json' },
      assets: [
        {
          kind: 'videos', id: 'calm-motion', name: 'Calm Motion', enabled: videoEnabled,
          recall: { mode: 'constant', keywords: [] }, directorNote: '',
          bundleKey: 'calm-video', entry: 'loop.webm', poster: 'poster.png',
          durationMs: 3000, loop: true, audio: 'none', size: [512, 768]
        }
      ],
      bundles: { 'calm-video': { kind: 'video', entry: 'loop.webm', contentHash: videoHash } },
      blobs: { [stillHash]: { ext: 'png', mime: 'image/png', size: 68 } },
      files: []
    },
    figures: {
      [figId]: {
        schemaVersion: 1, id: figId, name: 'Hero', enabled: true,
        recall: { mode: 'constant', keywords: [] }, appearance: 'sprite',
        emotions: [{ id: 'calm', label: 'Calm' }],
        outfits: [{
          key: 'default', label: 'Default', enabled: true,
          recall: { mode: 'constant', keywords: [] },
          sprite: { manifestKey: 'hero', assets: { 'calm.png': stillHash } }
        }]
      }
    },
    sprites: {
      hero: { version: 1, kind: 'static-sprites', emotions: { calm: { src: 'calm.png', video: 'calm-motion' } } }
    }
  })

  const avatar = packAvatar.selectFigureAvatar(packSnapshot().figures[figId], packSnapshot().sprites, { emotion: 'calm' })
  assert.equal(avatar.hash, stillHash, 'avatar fallback must keep using the still PNG/WebP')

  let onServiceChange = null
  const service = {
    apiVersion: 2,
    subscribe: fn => { onServiceChange = fn; return () => { onServiceChange = null } },
    getPackSnapshot: async () => packSnapshot(),
    resolveFigures: async ({ refs }) => refs.map(ref => {
      const snap = packSnapshot()
      return { status: 'resolved', revision: snap.revision, value: snap.figures[ref.figureId], diagnostics: [] }
    }),
    leaseMedia: async ({ hash }) => ({ ticket: 't-' + hash, url: '/media/' + hash })
  }
  const presentation = createAssetPackPresentation({
    raw: { spec: 'chara_card_v3', data: { extensions: { dsh_tavern: { schemaVersion: 1, assetBindings: { boundPackIds: [packId] } } } } },
    getService: () => service,
    origin: 'http://127.0.0.1:3080',
    scope: 'test'
  })

  const figureRows = [{ ref: { packId, figureId: figId }, name: 'Hero', aliases: [], enabled: true }]
  const projected = await presentation.character('Hero', { emotion: 'calm', figureRows })
  const materialized = await presentation.materialize(projected, { stage: true, portrait: true, descriptors: true })
  assert.equal(materialized.spriteVideo.assetId, 'calm-motion')
  assert.equal(materialized.spriteVideo.bundleKey, 'calm-video')
  assert.equal(materialized.spriteVideo.hash, videoHash)

  const renderInputs = packFigureRenderInputs(materialized, {}, { spriteRenderManifest, layeredSpriteManifest, layeredSpriteMapAssets })
  assert.equal(renderInputs.stage.video.assetId, 'calm-motion')
  assert.equal(renderInputs.face.src.hash, stillHash)

  videoEnabled = false
  onServiceChange?.({ packId, revision: 'rev-2' })
  const projectedDisabled = await presentation.character('Hero', { emotion: 'calm', figureRows })
  const materializedDisabled = await presentation.materialize(projectedDisabled, { stage: true, portrait: true, descriptors: true })
  assert.equal(materializedDisabled.spriteVideo, undefined)
  const disabledInputs = packFigureRenderInputs(materializedDisabled, {}, { spriteRenderManifest, layeredSpriteManifest, layeredSpriteMapAssets })
  assert.equal(disabledInputs.stage.video, undefined)
  assert.notEqual(renderInputs.stage.identity, disabledInputs.stage.identity)
})

function sceneFixture({ userAgent = 'Mozilla/5.0 Chrome/130.0.0.0', failVideo = false } = {}) {
  const math = createStageSceneMath({ colorMath, figureScale })
  const images = [], videos = [], baseTextures = [], textures = [], released = []
  let hidden = false

  class FakeImage {
    constructor() { images.push(this) }
    decode() {
      return new Promise(resolve => {
        this.width = 512; this.height = 768
        this.naturalWidth = 512; this.naturalHeight = 768
        this.finish = resolve
      })
    }
  }
  const makeNode = type => {
    const listeners = new Map()
    const node = {
      type, ownerDocument: doc, dataset: {}, style: { setProperty() {} }, hidden: false, paused: true,
      readyState: 0, currentTime: 0,
      setAttribute() {}, getAttribute() {}, removeAttribute(k) { if (k === 'src') node.src = '' },
      closest: () => null, querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }),
      append(...children) { node.children.push(...children) },
      appendChild(child) { node.children.push(child) },
      children: [],
      remove() { node.removed = true },
      addEventListener(t, fn) { listeners.set(t, fn) },
      removeEventListener(t) { listeners.delete(t) },
      emit(t) { listeners.get(t)?.() },
      pause() { node.paused = true },
      load() {},
      play: async () => { node.paused = false },
      getContext: () => new Proxy({}, { get: (_, prop) => prop === 'createRadialGradient' || prop === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} })
    }
    if (type === 'video') videos.push(node)
    return node
  }
  const doc = {
    get hidden() { return hidden },
    createElement: makeNode,
    querySelectorAll: () => []
  }
  class Container {
    constructor() { this.children = []; this.position = { set() {} }; this.pivot = { set() {} }; this.scale = { x: 1, y: 1, set() {} }; this.visible = true }
    toGlobal(p) { return { x: p?.x || 0, y: p?.y || 0 } }
    toLocal(p) { return { x: p?.x || 0, y: p?.y || 0 } }
    addChild(c) { this.children.push(c) }
    addChildAt(c, i) { this.children.splice(i, 0, c) }
    removeChild(c) { const idx = this.children.indexOf(c); if (idx >= 0) this.children.splice(idx, 1) }
    destroy() { this.destroyed = true }
  }
  class Sprite {
    constructor(texture) { this.texture = texture; this.anchor = { set() {} }; this.position = { set() {} }; this.scale = { x: 1, y: 1, set() {} }; this.alpha = 1 }
    toGlobal(p) { return { x: p?.x || 0, y: p?.y || 0 } }
    toLocal(p) { return { x: p?.x || 0, y: p?.y || 0 } }
    destroy() { this.destroyed = true }
  }
  class BaseTexture {
    constructor(source, opts) {
      this.source = source; this.opts = opts
      this.realWidth = 512; this.realHeight = 768
      this.updates = 0; this.destroyed = 0
      this.resource = { source }
      baseTextures.push(this)
    }
    update() { this.updates++ }
    destroy() { this.destroyed++ }
  }
  class Texture {
    constructor(base) { this.baseTexture = base; this.width = 512; this.height = 768; this.destroyed = 0; textures.push(this) }
    static from(source) { return new Texture(new BaseTexture(source)) }
    destroy(destroyBase) { this.destroyed++; if (destroyBase) this.baseTexture.destroy() }
  }
  Texture.WHITE = Texture.from({})
  class Graphics extends Container { clear() {} beginFill() {} drawRect() {} endFill() {} }
  let tickerFrame = null
  const PIXI = {
    Application: class {
      constructor() {
        this.view = { style: {} }
        this.renderer = { on() {}, gl: {}, plugins: { interaction: {} }, resize() {}, resolution: 1 }
        this.ticker = { deltaMS: 16, started: true, start() { this.started = true }, stop() { this.started = false }, add(fn) { tickerFrame = fn }, remove() { tickerFrame = null }, update() {} }
        this.stage = new Container()
        this.screen = { width: 1280, height: 720 }
      }
      render() {}
      destroy() {}
    },
    Container, Sprite, Graphics, BaseTexture, Texture,
    MSAA_QUALITY: { NONE: 0, MEDIUM: 2 },
    filters: { GlowFilter: class { constructor() {} destroy() {} }, BlurFilter: class { constructor() {} destroy() {} } },
    Filter: class { constructor(_v, _f, uniforms) { this.uniforms = uniforms || {} } destroy() {} },
    ColorMatrixFilter: class { constructor() { this.matrix = [] } destroy() {} }
  }
  const foregroundListeners = new Set()
  const foreground = {
    isForeground: () => true,
    isAudible: () => true,
    subscribe: fn => { foregroundListeners.add(fn); return () => foregroundListeners.delete(fn) },
    application: () => () => {},
    media: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  }
  const videoApi = createStageVideo({
    getService: () => ({ leaseBundle: async () => ({ ticket: 't-v', url: '/lease/t-v/' }), releaseLease: async ticket => released.push(ticket) }),
    fetch: async () => ({ ok: !failVideo, status: failVideo ? 500 : 200, blob: async () => ({}) }),
    URL: { createObjectURL: () => 'blob:video', revokeObjectURL() {} },
    foreground,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
  })
  const { createStageSceneTextures } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-textures.cjs')
  const { createStageFigureAssets } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-assets.cjs')
  const { createStageFigureAppearance } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-appearance.cjs')
  const { createStageFigurePose } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-pose.cjs')
  const { createStageFigureBlink } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-blink.cjs')
  const { createStageCast } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast.cjs')
  const { createStageCastLayout } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast-layout.cjs')
  const { createStageFigureIdle } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-idle.cjs')
  const { createStageFigureTap } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-tap.cjs')
  const { createStageSceneCamera } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-camera.cjs')
  const { createStageEffects } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/effects.cjs')
  const { createStageBackgrounds } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/backgrounds.cjs')
  const { createStageBackgroundLayers } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/background-layers.cjs')
  const { createStageFigureLight } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/figure-light.cjs')
  const { createStageSceneGraphics } = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-graphics.cjs')

  const sceneGraphics = createStageSceneGraphics({ window: { PIXI }, document: doc, paintEmpty: () => {}, emptyPalette: () => ({}) })
  const sceneTextures = createStageSceneTextures({ Image: FakeImage, now: () => 10 })
  const figureAssets = createStageFigureAssets({
    spineFigures: { prepare: async () => null },
    metrics: { headTop: () => 0.1, bodyX: () => 256 }
  })
  const visualMath = { matrix: math.galMatrix, ease: math.galEase, clamp: math.galClamp01 }
  const figureLight = createStageFigureLight({ document: doc })
  const identityMatrix = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0]
  const backgrounds = createStageBackgrounds({
    ...visualMath,
    correction: () => identityMatrix,
    timeGrade: () => ({ matrix: identityMatrix }),
    transition: math.galBackgroundTransition,
    layers: createStageBackgroundLayers({ ...visualMath, cover: math.galCover, transitionFrame: math.galTransitionFrame, wipeRect: math.galWipeRect, irisSize: math.galIrisSize }),
    light: figureLight
  })
  const scene = createStageScene({
    window: {
      PIXI,
      navigator: { userAgent, maxTouchPoints: 0 },
      performance,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      MessageChannel: class { constructor() { this.port1 = { onmessage: null, close() {} }; this.port2 = { postMessage() {}, close() {} } } },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id)
    },
    document: doc,
    math,
    reading: { get: () => ({}) },
    services: { foreground, resolution: () => 1, subscribeResolution: () => () => {}, layered: { urls: () => [] }, canvas: { palette: () => ({ skyTop: '#000', skyMid: '#111', skyLow: '#222', floor: '#333', mist: '#444' }), paint() {} } },
    figureScale,
    lookMath: { GAL_LOOKS_EMPTY: {}, galLookRegistry: () => ({}), galLookResolve: () => ({}) },
    modules: {
      video: videoApi,
      sceneTextures,
      figureAssets,
      sceneGraphics,
      figureLight,
      backgrounds,
      sceneCamera: createStageSceneCamera(visualMath),
      effects: { loadFilters: async () => {}, create: () => ({ shakeOffset: () => ({ x: 0, y: 0 }), trigger: () => false, zoomKick: () => ({ scale: 1, x: 0, y: 0 }), tick() {}, ui: () => null, looks: { plan: () => ({}), stats: () => ({}) }, stats: () => ({}), destroy() {} }) },
      cast: createStageCast(),
      castLayout: createStageCastLayout({ calculate: math.galFigureLayout, mix: math.galFrameMix }),
      figureAppearance: createStageFigureAppearance({ graphics: sceneGraphics, spring: math.galSpring, springValue: math.galSpringValue, light: figureLight }),
      figurePose: createStageFigurePose({ resolve: () => ({ mode: 'flat' }), flatLayout: math.galFlatLayout, actionAt: math.galFlatActAt, ease: math.galEase }),
      figureBlink: createStageFigureBlink({ clock: foreground, clockwork: { blinkUrls: () => [], blinkPlacement: () => null, blinkTimingFor: () => ({}), createBlinkScheduler: () => ({ phase: () => 0, update() {}, dispose() {} }) } }),
      figureIdle: createStageFigureIdle({ spring: math.galSpring, springValue: math.galSpringValue }),
      figureGeometry: { galStaticWarps: () => false },
      figureTap: createStageFigureTap({ document: doc, geometry: {} }),
      bust: { create: () => ({ sprite: new Sprite(Texture.WHITE), tick() {}, update() {}, dispose() {} }) },
      monologue: { create: () => ({ sprite: new Sprite(Texture.WHITE), tick() {}, update() {}, dispose() {} }) },
      callViews: { create: () => ({ container: new Container(), tick() {}, snapshot: () => ({}), update() {}, dispose() {} }) }
    }
  })

  const host = makeNode('div')
  const instance = scene.create(host, { width: 1280, height: 720 })
  return {
    scene, videoApi, instance, images, videos, baseTextures, textures, released,
    step() { tickerFrame?.() },
    setHidden(v) { hidden = v }
  }
}

const figureDesc = {
  key: 'hero', alias: 'Hero', kind: 'static', identity: 'hero-calm-v1',
  src: '/media/calm.png', enter: 'none',
  video: { packId: 'p', assetId: 'calm-motion', bundleKey: 'calm-video', hash: 'h', entry: 'loop.webm', poster: 'poster.png', durationMs: 3000, loop: true }
}

test('scene shows still until video is playable, drives single-pass PIXI VideoResource without tick update, and pauses when leaving or hidden', async () => {
  const f = sceneFixture()
  f.instance.set({
    width: 1280, height: 720, backgroundUrl: null,
    figures: [figureDesc]
  })
  f.step()
  assert.equal(f.images.length, 1)
  f.images[0].finish()
  await new Promise(r => setImmediate(r))
  f.step()

  assert.equal(f.videos.length, 1, 'video player mounted once still image is ready')
  const stillBase = f.baseTextures[0]
  assert.equal(stillBase.updates, 0)

  // Before playable, still texture is shown
  assert.equal(f.videos[0].paused, true)
  f.videos[0].readyState = 4
  f.videos[0].emit('canplaythrough')
  await new Promise(r => setImmediate(r))
  f.step()

  assert.equal(f.videos[0].paused, false, 'video starts playing once playable')
  const videoBase = f.baseTextures.find(b => b.source === f.videos[0])
  assert.ok(videoBase, 'PIXI BaseTexture wraps the player <video>')
  assert.equal(videoBase.opts?.resourceOptions?.autoPlay, false)
  assert.equal(videoBase.updates, 0, 'scene.tick() must not double-upload VideoResource')

  // Hidden page pauses the video
  f.setHidden(true)
  f.step()
  assert.equal(f.videos[0].paused, true)
  f.setHidden(false)
  f.step()
  assert.equal(f.videos[0].paused, false)

  // Leaving the stage pauses the video immediately
  f.instance.set({ width: 1280, height: 720, backgroundUrl: null, figures: [] })
  f.step()
  assert.equal(f.videos[0].paused, true, 'leaving figure pauses video immediately')

  f.instance.destroy()
  f.scene.dispose()
  f.videoApi.dispose()
  assert.ok(videoBase.destroyed >= 1)
  assert.deepEqual(f.released, ['t-v'])
})

test('scene stays on still texture when video fails or on Safari without WebM alpha', async () => {
  // Safari / iPadOS UA skips .webm video sprite and keeps still
  const safari = sceneFixture({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
  safari.instance.set({ width: 1280, height: 720, backgroundUrl: null, figures: [figureDesc] })
  safari.step()
  safari.images[0].finish()
  await new Promise(r => setImmediate(r))
  safari.step()
  assert.equal(safari.videos.length, 0, 'Safari/iOS must not play .webm video sprite without alpha')
  safari.instance.destroy(); safari.scene.dispose(); safari.videoApi.dispose()

  // Playback/fetch failure falls back to still cleanly
  const broken = sceneFixture({ failVideo: true })
  broken.instance.set({ width: 1280, height: 720, backgroundUrl: null, figures: [figureDesc] })
  broken.step()
  broken.images[0].finish()
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
  broken.step()
  assert.equal(broken.baseTextures.filter(b => b.source.type === 'video').length, 0)
  broken.instance.destroy(); broken.scene.dispose(); broken.videoApi.dispose()
})
