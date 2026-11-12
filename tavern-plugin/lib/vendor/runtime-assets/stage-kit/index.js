// dsh stage-kit entry. Auto-loaded when a stage uses <stage-*> tags;
// scripts can also `const kit = await dshStage.kit()`.
// three.js is NOT loaded here; use `kit.three()` only when a stage needs 3D.
import { defineAll } from './components.js'
// Drop markup meant for other regions before any component starts its loop.
const region = window.dshStage.region
for (const node of document.querySelectorAll('[data-region]')) {
  if (!node.getAttribute('data-region').split(/\s+/).includes(region)) node.remove()
}
defineAll()
export * from './core.js'
export { createParticles, presetForWeather, intensityForWeather, PRESETS } from './particles.js'
export { COMPONENTS, StageElement } from './components.js'
export const three = options => import('./three.js').then(module => module.createThreeStage(options))
