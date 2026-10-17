// The official CLI reserves "desktop" for Electron; use the host's own profile
// loader to validate installation without starting a second server or UI.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const anchor = process.env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR
if (!anchor || !process.env.DSH_HOME) throw new Error('缺少官方 Desktop 运行环境')
const require = createRequire(anchor)
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const profile = boot.loadProfileDirectory('dsh-tavern', path.join(process.env.DSH_HOME, 'profiles', 'desktop'), anchor)
if (profile.skippedBundles.length) throw new Error(profile.skippedBundles.map(item => `${item.packageName}: ${item.reason}`).join('\n'))
const homePatch = boot.loadOptionalPatches('dsh-tavern', path.join(process.env.DSH_HOME, 'cordis.patch.yml')) || []
const entries = boot.composeEntries([...profile.layers.map(layer => layer.patches), profile.patches, homePatch], message => console.error(message))
if (!profile.layers.some(layer => layer.packageName === 'dsh-tavern-plugin')) throw new Error('Desktop 配置没有加载酒馆插件')
console.log(`官方 Desktop 配置验证通过：${profile.layers.length} 个插件包，${entries.length} 个配置条目`)
