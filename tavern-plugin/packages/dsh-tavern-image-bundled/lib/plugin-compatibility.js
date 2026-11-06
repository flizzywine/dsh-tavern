const TAVERN_API_VERSION_PATH = ['dsh', 'compatibility', 'tavernApiVersion']

/** Compare a plugin's minimum integer Tavern API version with the live host API. */
export function checkPluginCompatibility(pkg, apiVersion) {
  let metadata = pkg
  for (const key of TAVERN_API_VERSION_PATH) metadata = metadata?.[key]

  // Packages published before this metadata existed remain usable by the Git updater.
  if (metadata === undefined) {
    return { compatible: true, reason: '', requiredApiVersion: null, hostApiVersion: apiVersion ?? null }
  }

  if (!Number.isSafeInteger(metadata) || metadata < 1) {
    return {
      compatible: false,
      reason: '插件声明的 Tavern API 最低版本无效，无法安全安装。',
      requiredApiVersion: null,
      hostApiVersion: Number.isSafeInteger(apiVersion) ? apiVersion : null,
    }
  }

  const requiredApiVersion = metadata
  const validHostVersion = Number.isSafeInteger(apiVersion) && apiVersion >= 0
  const hostApiVersion = validHostVersion ? apiVersion : null
  if (!validHostVersion || apiVersion < requiredApiVersion) {
    return {
      compatible: false,
      reason: `此插件要求 Tavern 插件 API v${requiredApiVersion} 或更新版本；当前宿主 API ${validHostVersion ? `为 v${apiVersion}` : '未知或无效'}。请先更新 Tavern，再更新插件。`,
      requiredApiVersion,
      hostApiVersion,
    }
  }

  return { compatible: true, reason: '', requiredApiVersion, hostApiVersion }
}
