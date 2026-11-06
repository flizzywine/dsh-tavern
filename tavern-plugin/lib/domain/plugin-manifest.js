// The host's package-inventory request extension reads package.json for every
// registered plugin, even if its guarded entry failed to load. Reject incomplete
// identities before registration rather than breaking unrelated model requests.
export function pluginManifestProblem(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return 'package.json 必须是 JSON 对象'
  for (const field of ['name', 'version']) {
    if (typeof pkg[field] !== 'string' || !pkg[field].trim()) return 'package.json 的 ' + field + ' 必须是非空字符串'
  }
  return ''
}
