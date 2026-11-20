import { TAVERN_PLUGIN_API_VERSION } from './plugin-manifest.js'

export const BUNDLED_PLUGIN_RUNTIME_FILES = Object.freeze(['package.json', 'lib/index.js', 'client.js'])

// The Tavern distribution chooses which bundled packages can follow an independent release.
const releaseSources = new Map([
  ['dsh-tavern-fate-dice', Object.freeze({ owner: 'bigmalove', repo: 'dsh-tavern-fate-dice', assetPrefix: 'fate-dice' })],
])

export function bundledPluginRelease(folder, packageName) {
  return folder === packageName ? releaseSources.get(folder) : undefined
}

export function bundledReleaseCompatibilityProblem(pkg) {
  const minimum = pkg?.dsh?.compatibility?.tavernApiVersion
  if (!Number.isSafeInteger(minimum) || minimum < 1) return '发布包缺少有效的 Tavern 插件 API 版本声明'
  if (minimum > TAVERN_PLUGIN_API_VERSION) return `新版需要 Tavern 插件 API v${minimum}，请先更新酒馆`
  return ''
}
