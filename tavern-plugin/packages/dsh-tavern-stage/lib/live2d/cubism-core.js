// The machine-local Live2D runtime: never shipped with the app. After the player agrees to the Live2D licences, one
// download fetches both pieces from their publishers into <dataRoot>/live2d/core; later sessions use them offline.
// A file the player drops in (the official downloads, when the download failed) goes through the same validation.
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { validateRuntimeImport, publishRuntimeFile } from '../../../../lib/runtime-import.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, LIVE2D_RUNTIME_FILES } from '../../../../lib/domain/tavern-runtime-assets.js'

export const LIVE2D_DISPLAY_ROUTE = TAVERN_RUNTIME_ASSET_PREFIX + LIVE2D_RUNTIME_FILES.display
export const LIVE2D_CORE_ROUTE = TAVERN_RUNTIME_ASSET_PREFIX + LIVE2D_RUNTIME_FILES.core
export const CUBISM_CORE_DOWNLOAD = 'https://www.live2d.com/en/sdk/download/web/'
export const CUBISM_CORE_LICENSE = 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'
export const LIVE2D_DISPLAY_DOWNLOAD = 'https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0'
export const LIVE2D_DISPLAY_LICENSE = 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'
// The files the download fetches: Live2D's hosted Cubism Core and the publisher's npm build of pixi-live2d-display.
export const LIVE2D_RUNTIME_SOURCES = Object.freeze({
  core: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
  display: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js'
})
const PIECES = Object.freeze({
  core: { file: 'live2dcubismcore.min.js', label: 'Cubism Core', names: ['live2dcubismcore.min.js', 'live2dcubismcore.js'],
    markers: ['Live2DCubismCore', 'Moc', 'Model', 'Version', 'csmGetVersion', 'csmReviveMocInPlace'] },
  display: { file: 'pixi-live2d-display-cubism4.min.js', label: 'pixi-live2d-display Cubism4', names: ['cubism4.min.js', 'cubism4.js', 'pixi-live2d-display-cubism4.min.js'],
    markers: ['Live2DCubismCore', 'Live2DModel', 'CubismModel', 'PIXI'] }
})
const DOWNLOAD_TIMEOUT_MS = 30000
const exists = target => stat(target).then(info => info.isFile(), () => false)

export function createCubismCore(root, { fetch = globalThis.fetch, sources = LIVE2D_RUNTIME_SOURCES } = {}) {
  const directory = path.join(root, 'core'), target = kind => path.join(directory, PIECES[kind].file)
  const hasCore = () => exists(target('core'))
  const hasDisplay = () => exists(target('display'))
  const available = async () => await hasCore() && await hasDisplay()
  async function status() {
    const coreInstalled = await hasCore(), displayInstalled = await hasDisplay()
    return { installed: coreInstalled && displayInstalled, coreInstalled, displayInstalled,
      core: coreInstalled ? LIVE2D_CORE_ROUTE : '',
      display: displayInstalled ? LIVE2D_DISPLAY_ROUTE : '',
      missing: [...(coreInstalled ? [] : ['core']), ...(displayInstalled ? [] : ['display'])],
      licenseUrl: CUBISM_CORE_LICENSE, downloadUrl: CUBISM_CORE_DOWNLOAD,
      displayDownloadUrl: LIVE2D_DISPLAY_DOWNLOAD, displayLicenseUrl: LIVE2D_DISPLAY_LICENSE }
  }
  // Validate (parse only, never run) before publishing; an installed piece is never replaced.
  async function publish(kind, input) {
    const piece = PIECES[kind], body = validateRuntimeImport(input, piece)
    if (!await exists(target(kind))) await publishRuntimeFile(target(kind), body)
  }
  async function fetchPiece(kind) {
    const piece = PIECES[kind]
    try {
      const response = await fetch(sources[kind], { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      await publish(kind, { name: piece.names[0], base64: Buffer.from(await response.arrayBuffer()).toString('base64'), consent: true })
    } catch (error) {
      throw new Error('下载 ' + piece.label + ' 失败（' + (error?.name === 'TimeoutError' ? '连接超时' : String(error?.message || error)) + '）')
    }
  }
  // The player agreed to both licences in the dialog; fetch whatever is still missing.
  async function download({ consent } = {}) {
    if (consent !== true) throw new Error('请先同意 Live2D 许可条款')
    const missing = (await status()).missing
    const results = await Promise.allSettled(missing.map(fetchPiece))
    const failed = results.filter(result => result.status === 'rejected').map(result => result.reason.message)
    if (failed.length) throw new Error(failed.join('；'))
    return status()
  }
  // One dropped official file: the piece follows from its published name.
  async function importFile(input = {}) {
    const kind = Object.keys(PIECES).find(key => PIECES[key].names.includes(input.name))
    if (!kind) throw new Error('请拖入 live2dcubismcore.min.js 或 cubism4.min.js')
    await publish(kind, input)
    return status()
  }
  return Object.freeze({ hasCore, hasDisplay, available, status, download, importFile })
}
