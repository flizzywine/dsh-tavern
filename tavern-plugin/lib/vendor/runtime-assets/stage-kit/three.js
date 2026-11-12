// three.js scaffold for Card Stages: renderer, camera, resize, capped pixel
// ratio, optional bloom, and rendering on the shared (pausable) loop.
//   const { THREE, scene, camera, onFrame } = await createThreeStage({ bloom: true })
import { loop, pixelRatio, quality } from './core.js'

const base = new URL('../three/', import.meta.url).href

export async function createThreeStage(options = {}) {
  const THREE = await import(base + 'build/three.module.js')
  const container = options.container || document.body
  const renderer = new THREE.WebGLRenderer({ antialias: quality() !== 'low', alpha: options.transparent !== false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(pixelRatio(options.maxPixelRatio || 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' })
  container.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(options.fov || 40, innerWidth / Math.max(1, innerHeight), 0.1, 200)
  camera.position.set(0, 0, options.distance || 10)

  let composer = null, bloom = null
  if (options.bloom && quality() !== 'low') {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import(base + 'addons/postprocessing/EffectComposer.js'), import(base + 'addons/postprocessing/RenderPass.js'),
      import(base + 'addons/postprocessing/UnrealBloomPass.js'), import(base + 'addons/postprocessing/OutputPass.js')])
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const cfg = typeof options.bloom === 'object' ? options.bloom : {}
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), cfg.strength ?? 0.8, cfg.radius ?? 0.5, cfg.threshold ?? 0.6)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
  }
  function resize() {
    const w = innerWidth, h = Math.max(1, innerHeight)
    renderer.setSize(w, h, false)
    if (composer) composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  const handlers = new Set()
  const stop = loop((dt, t) => {
    for (const fn of handlers) fn(dt, t)
    if (composer) composer.render(dt); else renderer.render(scene, camera)
  })
  return {
    THREE, renderer, scene, camera, composer, bloom,
    /** Load an addon, e.g. addon('loaders/GLTFLoader.js'). */
    addon: path => import(base + 'addons/' + String(path).replace(/^\/+/, '')),
    onFrame(fn) { handlers.add(fn); return () => handlers.delete(fn) },
    dispose() {
      stop(); removeEventListener('resize', resize)
      scene.traverse(node => { node.geometry?.dispose?.(); const m = node.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()) })
      composer?.dispose?.(); renderer.dispose(); renderer.domElement.remove()
    }
  }
}
