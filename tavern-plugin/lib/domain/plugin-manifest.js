export const TAVERN_PLUGIN_API_VERSION = 8

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

/**
 * Compare plugin versions, including prereleases. Return null if either version is unrecognized.
 */
export function comparePluginVersions(left, right) {
  const parse = value => {
    const text = String(value || '').trim().replace(/^v(?=\d)/i, '').split('+')[0]
    const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
    if (!match) return null
    return { core: match[1].split('.').map(Number), pre: match[2] ? match[2].split('.') : [] }
  }
  const a = parse(left), b = parse(right)
  if (!a || !b) return null
  const length = Math.max(a.core.length, b.core.length)
  for (let index = 0; index < length; index++) {
    const x = a.core[index] || 0, y = b.core[index] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  const prereleaseLength = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < prereleaseLength; index++) {
    const x = a.pre[index], y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numeric = /^\d+$/.test(x), otherNumeric = /^\d+$/.test(y)
    if (numeric && otherNumeric) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
    } else if (numeric !== otherNumeric) return numeric ? -1 : 1
    else if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
