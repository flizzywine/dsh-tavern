import {readFile} from 'node:fs/promises'

export function registerStageClientAssets(registry) {
  return registry.register('skin-overlay.mjs', {
    mediaType:'text/javascript; charset=utf-8',
    read:() => readFile(new URL('./client/skin-overlay.mjs', import.meta.url))
  })
}
