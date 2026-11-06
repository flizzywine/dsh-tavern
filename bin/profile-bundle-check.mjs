import { pathToFileURL } from 'node:url'
import { resolveDshBootModule, resolveHostAnchor } from './plugin-dependencies.mjs'

// DSH quietly skips a profile bundle it cannot load (unmet @deepseek-ai/* peers, missing
// package…) and only says so on stderr at boot; `--dump-config` stays silent. The page then
// hangs on "waiting for service: …". Ask the host's own loader which bundles it would skip,
// instead of re-implementing its rules.
export function skippedBundleFailure(skippedBundles, managedBundles) {
  const managed = new Set(managedBundles)
  const fatal = skippedBundles.filter(item => managed.has(item.packageName))
  const ignored = skippedBundles.filter(item => !managed.has(item.packageName))
  const error = fatal.length === 0 ? null : new Error([
    "当前 DSH 加载时会跳过酒馆的插件包，装上后酒馆无法启动（页面停在 waiting for service）：",
    ...fatal.map(item => `- ${item.packageName}：${item.reason}`),
    '请把 DSH 换到酒馆支持的版本，或更新酒馆后重试。',
  ].join('\n'))
  return { error, ignored }
}

export async function assertProfileBundlesLoad({ dsh, host, profileDir, managedBundles, log = console.warn }) {
  const { loadProfileDirectory } = await import(pathToFileURL(resolveDshBootModule({ dsh, host })).href)
  if (typeof loadProfileDirectory !== 'function') throw new Error('当前 DSH 的 @deepseek-ai/dsh-app-boot 缺少 loadProfileDirectory，无法确认酒馆插件包能否加载。')
  const profile = loadProfileDirectory('dsh-tavern', profileDir, resolveHostAnchor({ dsh, host }), { userLayer: false })
  const { error, ignored } = skippedBundleFailure(profile.skippedBundles, managedBundles)
  for (const item of ignored) log(`DSH 会跳过你自行添加的插件包 ${item.packageName}：${item.reason}`)
  if (error) throw error
}
