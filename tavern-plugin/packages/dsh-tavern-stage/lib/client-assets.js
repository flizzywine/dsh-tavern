import {readFile} from 'node:fs/promises'

// Executable stage chunks are first-party client assets of the stage's own lifetime (same origin,
// registered only while the stage runtime is installed). The core imports `stage-client.mjs` on
// demand for a session that needs the stage; `skin-overlay.mjs` is the stage's own lazy chunk, and
// `live2d-client.mjs` the Live2D module (dsh-tavern-live2d) the stage imports when Live2D is needed.
export const STAGE_CLIENT_ASSET = 'stage-client.mjs'
const STAGE_CLIENT_CHUNKS = Object.freeze({
  'skin-overlay.mjs': new URL('./client/skin-overlay.mjs', import.meta.url),
  'live2d-client.mjs': new URL('./client/live2d-client.mjs', import.meta.url)
})
const JAVASCRIPT = 'text/javascript; charset=utf-8'

const STAGE_CLIENT_EXPORT = 'export default stageClientPlugin;'
// lib/client.js is an ES module (strict, `export default`). Script tags and vm contexts evaluate the same
// text as a strict classic script whose completion value is the plugin (`stageClientPlugin` stays bound).
export function stageClientModuleAsScript(source) {
  const at = source.lastIndexOf(STAGE_CLIENT_EXPORT)
  if (at < 0) throw new Error('Stage client module has no default export')
  return '"use strict";\n' + source.slice(0, at) + 'stageClientPlugin;' + source.slice(at + STAGE_CLIENT_EXPORT.length)
}

// One lazy chunk by its asset name, or undefined for any other name. The registry below serves the chunks
// through it; a page that serves its own assets (an isolated export page) can read them the same way.
export async function readStageClientChunk(name) {
  const file = Object.hasOwn(STAGE_CLIENT_CHUNKS, name) ? STAGE_CLIENT_CHUNKS[name] : undefined
  return file && Object.freeze({body: await readFile(file), mediaType: JAVASCRIPT})
}

export function registerStageClientAssets(registry) {
  const stops = [
    ...Object.keys(STAGE_CLIENT_CHUNKS).map(name => registry.register(name, {mediaType: JAVASCRIPT, read: async () => (await readStageClientChunk(name)).body})),
    registry.register(STAGE_CLIENT_ASSET, {
      mediaType: JAVASCRIPT,
      read:() => readFile(new URL('./client.js', import.meta.url))
    })
  ]
  return () => { for (const stop of stops.reverse()) stop() }
}
