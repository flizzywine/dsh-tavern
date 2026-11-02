import {readFile} from 'node:fs/promises'

// Executable stage chunks are first-party client assets of the stage's own lifetime (same origin,
// registered only while the stage runtime is installed). The core imports `stage-client.mjs` on
// demand for a session that needs the stage; `skin-overlay.mjs` is the stage's own lazy chunk.
export const STAGE_CLIENT_ASSET = 'stage-client.mjs'

const STAGE_CLIENT_EXPORT = 'export default stageClientPlugin;'
// lib/client.js is an ES module (strict, `export default`). Script tags and vm contexts evaluate the same
// text as a strict classic script whose completion value is the plugin (`stageClientPlugin` stays bound).
export function stageClientModuleAsScript(source) {
  const at = source.lastIndexOf(STAGE_CLIENT_EXPORT)
  if (at < 0) throw new Error('Stage client module has no default export')
  return '"use strict";\n' + source.slice(0, at) + 'stageClientPlugin;' + source.slice(at + STAGE_CLIENT_EXPORT.length)
}

export function registerStageClientAssets(registry) {
  const stops = [
    registry.register('skin-overlay.mjs', {
      mediaType:'text/javascript; charset=utf-8',
      read:() => readFile(new URL('./client/skin-overlay.mjs', import.meta.url))
    }),
    registry.register(STAGE_CLIENT_ASSET, {
      mediaType:'text/javascript; charset=utf-8',
      read:() => readFile(new URL('./client.js', import.meta.url))
    })
  ]
  return () => { for (const stop of stops.reverse()) stop() }
}
