import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

function parseVersion(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  return match && { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] }
}

// Semver precedence: core numbers, then a prerelease sorts before its release.
export function compareDshVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b)
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1
    if (p === q) continue
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

export function dshRangeLabel(policy) {
  return `${policy.minDshVersion} ≤ 版本 < ${policy.belowDshVersion}`
}

// Range plus blocklist: any version in [minDshVersion, belowDshVersion) runs unless
// listed in blockedDshVersions. The upper bound ignores prereleases so 0.3.0-rc.1
// counts as the 0.3 line. Unreadable versions are blocked.
// Maintained by hand in config/dsh-compatibility.json.
export function classifyDshVersion(version, policy) {
  const base = { version: version || '', allowedRange: dshRangeLabel(policy) }
  if (!parseVersion(version)) return { ...base, status: 'blocked', reason: version ? `无法识别 DSH 版本 ${version}` : '无法识别当前 DSH 版本' }
  if ((policy.blockedDshVersions || []).includes(version)) return { ...base, status: 'blocked', reason: `DSH ${version} 已知与酒馆不兼容` }
  if (compareDshVersions(version, policy.minDshVersion) < 0 || compareDshVersions(version.replace(/-.*/, ''), policy.belowDshVersion) >= 0) {
    return { ...base, status: 'blocked', reason: `DSH ${version} 不在支持范围内` }
  }
  return { ...base, status: 'allowed', reason: '' }
}

export function classifyHostVersion(version, policy) {
  const result = classifyDshVersion(version, policy)
  const message = result.status === 'allowed' ? ''
    : `${result.reason}，酒馆可能无法正常使用。支持的版本：${result.allowedRange}。`
  return Object.freeze({ ...result, packageName: '@deepseek-ai/dsh-session', message })
}
// Resolve from the actual host dependency, not PATH or another installed CLI.
// Called once during plugin startup; the returned immutable value is reused.
export function readHostCompatibility({ resolveHost, read = readFileSync } = {}) {
  const policy = JSON.parse(read(new URL('../../../config/dsh-compatibility.json', import.meta.url), 'utf8'))
  let version = ''
  try {
    const resolve = resolveHost || (() => {
      const plugin = createRequire(new URL('../../package.json', import.meta.url))
      return createRequire(plugin.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-session')
    })
    let dir = dirname(resolve())
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(read(join(dir, 'package.json'), 'utf8'))
        if (pkg.name === '@deepseek-ai/dsh-session') { version = String(pkg.version || ''); break }
      } catch { /* Entry points may be nested below the package root. */ }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* Unknown must not prevent starting the user's game. */ }
  return classifyHostVersion(version, policy)
}
