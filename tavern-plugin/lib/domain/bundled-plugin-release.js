import { TAVERN_PLUGIN_API_VERSION } from './plugin-manifest.js'

const standardRuntimeFiles = Object.freeze(['package.json', 'lib/index.js', 'client.js'])
const vendorManifest = 'lib/vendor/manifest.json'
const vendorFiles = ['quickjs.mjs', 'quickjs.wasm', 'parser.mjs', 'LICENSES.txt']

// Only the Tavern distribution chooses the repository and attachment for a bundled plugin.
const releaseSources = new Map([
  ['dsh-tavern-fate-dice', Object.freeze({
    owner: 'bigmalove', repo: 'dsh-tavern-fate-dice',
    assetName: version => `fate-dice-${version}.zip`,
  })],
  ['dsh-tavern-STcontext', Object.freeze({
    owner: 'koabop', repo: 'dsh-tavern-STcontext',
    assetName: version => `dsh-tavern-STcontext-v${version}.zip`,
    vendorManifest,
    runtimeFiles: Object.freeze([
      'package.json', 'index.mjs', 'client.js', 'lib/worker-client.mjs', 'lib/worker.mjs',
      vendorManifest, ...vendorFiles.map(name => 'lib/vendor/' + name),
    ]),
  })],
])

export function bundledPluginRelease(folder, packageName) {
  return folder === packageName ? releaseSources.get(folder) : undefined
}

export function bundledPluginRuntimeFiles(packageName) {
  return releaseSources.get(packageName)?.runtimeFiles || standardRuntimeFiles
}

// Validate names before the installer resolves any of them on disk or in an archive.
export function bundledPluginVendorHashes(manifestBytes) {
  let hashes
  try { hashes = JSON.parse(manifestBytes.toString('utf8'))?.hashes } catch {}
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes) || !vendorFiles.every(name => Object.hasOwn(hashes, name))) {
    throw new Error('插件运行文件摘要清单无效或不完整')
  }
  return Object.entries(hashes).map(([name, digest]) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('插件运行文件摘要清单含有无效的文件名或 SHA-256')
    }
    return ['lib/vendor/' + name, digest]
  })
}

export function bundledReleaseCompatibilityProblem(pkg) {
  const minimum = pkg?.dsh?.compatibility?.tavernApiVersion
  if (!Number.isSafeInteger(minimum) || minimum < 1) return '发布包缺少有效的 Tavern 插件 API 版本声明'
  if (minimum > TAVERN_PLUGIN_API_VERSION) return `新版需要 Tavern 插件 API v${minimum}，请先更新酒馆`
  return ''
}
