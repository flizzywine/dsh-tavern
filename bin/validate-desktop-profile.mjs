// The official CLI reserves "desktop" for Electron; use the host's own profile
// loader to validate installation without starting a second server or UI.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { installedProfile } from './launcher-environment.mjs'
const anchor = process.env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR
if (!anchor || !process.env.DSH_HOME) throw new Error('缺少官方 Desktop 运行环境')
const require = createRequire(anchor)
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const original = Boolean(process.argv[2])
const profile = boot.loadProfileDirectory('dsh-tavern', process.argv[2] || path.join(process.env.DSH_HOME, 'profiles', installedProfile('desktop', process.env.DSH_HOME)), anchor)
// Bundles Tavern does not own may not resolve: the original desktop profile can come from the other
// desktop app sharing ~/.dsh (official DeepSeek Harness vs community DSH NEXT), and a user plugin kept
// in the tavern profile can point into an app since uninstalled (e.g. dshmarket from the old DSH
// Desktop). DSH skips them at runtime too. Only Tavern's own bundles and the host's must load.
const ours = new Set(['dsh-profile-bridge', 'dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-dream-skin'])
const fatal = profile.skippedBundles.filter(item => ours.has(item.packageName) || item.packageName.startsWith('@deepseek-ai/'))
for (const item of profile.skippedBundles.filter(item => !fatal.includes(item))) {
  console.log(original
    ? `原版配置里的 ${item.packageName} 由另一个桌面应用提供，当前桌面加载时会跳过，不影响切换回原版。`
    : `酒馆配置里的插件 ${item.packageName} 找不到安装文件，启动时会跳过，不影响酒馆；不再需要可在插件页删除。`)
}
if (fatal.length) throw new Error(fatal.map(item => `${item.packageName}: ${item.reason}`).join('\n'))
const homePatch = boot.loadOptionalPatches('dsh-tavern', path.join(process.env.DSH_HOME, 'cordis.patch.yml')) || []
const entries = boot.composeEntries([...profile.layers.map(layer => layer.patches), profile.patches, homePatch], message => console.error(message))
if (!profile.layers.some(layer => layer.packageName === (original ? 'dsh-profile-bridge' : 'dsh-tavern-plugin'))) throw new Error('Desktop 配置没有加载酒馆插件')
console.log(`桌面版配置验证通过：${profile.layers.length} 个插件包，${entries.length} 个配置条目`)
