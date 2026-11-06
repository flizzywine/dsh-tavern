// The machine-local Live2D runtime the player downloaded (or dropped in); pack models use asset leases.
// Core and display are served from the runtime-asset route (lib/domain/tavern-runtime-assets.js), like Spine.
import { createCubismCore } from './cubism-core.js'
import path from 'node:path'

export function createLive2dFiles(root, options) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Live2D 目录必须是绝对路径')
  const base = path.resolve(root)
  const core = createCubismCore(base, options)
  return Object.freeze({
    root: base,
    hasCore: core.hasCore,
    available: core.available,
    coreStatus: core.status,
    importCore: core.importFile,
    downloadCore: core.download
  })
}

// The stage's figure runtime for kind 'live2d' (figure-runtimes.js): status, download and the dropped-file import, under
// the names the asset library, the stage and the settings page call.
export function live2dFigureRuntime(files) {
  return {files, routes:{
    getLive2dRuntime:(_args, _authority, _template, owner) => owner.coreStatus(),
    importLive2dRuntime:(args, _authority, _template, owner) => owner.importCore(args),
    downloadLive2dRuntime:(args, _authority, _template, owner) => owner.downloadCore(args)}}
}
