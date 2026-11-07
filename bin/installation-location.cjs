// Dependency-free: embedded in standalone installers before downloaded code exists.
// A relocated installation keeps logical aliases for old shortcuts and profile links.
// Installers MUST write the physical app directory, never replace those aliases.
const fs = require('node:fs')
const path = require('node:path')
const fail = message => { throw Object.assign(new Error(`酒馆安装目录记录不安全，未修改安装：${message}`), { code: 'INSTALLATION_LOCATION_UNSAFE' }) }
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const inside = (child, root) => { const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? child.toLowerCase() : child); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) }
const overlaps = (left, right) => same(left, right) || inside(left, right) || inside(right, left)
function ordinaryAncestors(directory) {
  let current = path.resolve(directory)
  for (;;) {
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`目录祖先不能是链接或文件：${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证目录祖先：${current} (${error.code || error.name})`)
      }
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}
// Only the configured home's parent chain is trusted to contain user-profile
// redirects. Never realpath a managed child: that would hide a replaced .dsh,
// state directory, or installation alias before it can be validated.
function trustedHome(dshHome) {
  const logical = path.resolve(dshHome)
  let ancestor = path.dirname(logical)
  const missing = []
  for (;;) {
    try {
      const physicalParent = fs.realpathSync(ancestor)
      if (!fs.statSync(physicalParent).isDirectory()) fail('用户目录祖先不是目录')
      const logicalParent = path.dirname(logical)
      const canonicalParent = path.join(physicalParent, ...missing.reverse())
      const physical = path.join(canonicalParent, path.basename(logical))
      ordinaryAncestors(physical)
      return { logical, physical, map(value) {
        const resolved = path.resolve(value)
        return same(resolved, logicalParent) || inside(resolved, logicalParent) ? path.join(canonicalParent, path.relative(logicalParent, resolved)) : resolved
      } }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
        fail(`无法验证用户目录祖先：${ancestor} (${error.code || 'UNKNOWN'})`)
      }
      // An existing dangling redirect is not a missing ordinary directory.
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) fail(`用户目录链接不可用：${ancestor}`) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) fail('无法解析用户目录')
      missing.push(path.basename(ancestor)); ancestor = parent
    }
  }
}
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/u.test(value) || !same(path.resolve(value), value)) fail('路径不是规范的绝对路径')
  return value
}
// Reinstalling code does not move data that was retained on another disk.
// Only an exact, registered data alias may cross the managed-home boundary.
function resolveInstallationData({ dshHome, dataDir } = {}) {
  const trusted = trustedHome(dshHome), home = trusted.physical
  const from = path.join(home, 'profile-data', 'tavern')
  ordinaryAncestors(path.dirname(from))
  const to = dataDir === undefined ? from : trusted.map(absolute(dataDir))
  let stat
  try { stat = fs.lstatSync(from) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!stat?.isSymbolicLink()) {
    if (!same(from, to)) fail('保留的数据入口已改变')
    ordinaryAncestors(from)
    return null
  }
  if (same(from, to) || overlaps(to, home)) fail('外部数据位置未登记或与 DSH 目录重叠')
  ordinaryAncestors(to)
  if (!fs.lstatSync(to).isDirectory() || !same(fs.realpathSync(to), to)
    || !same(trusted.map(path.resolve(path.dirname(from), fs.readlinkSync(from))), to)
    || !same(fs.realpathSync(from), to)) fail('保留的数据链接已改变')
  return { kind: 'data', from, to }
}
function resolveInstallationApp({ dshHome, appDir } = {}) {
  const trusted = trustedHome(dshHome), home = trusted.physical
  ordinaryAncestors(path.join(home, 'profile-bridge'))
  const requested = appDir ? path.resolve(appDir) : path.join(trusted.logical, 'apps', 'dsh-tavern')
  const journal = path.join(home, 'profile-bridge', 'installation-operation.json')
  try {
    if (fs.lstatSync(journal).isSymbolicLink()) fail('安装管理事务记录不能是链接')
    const operation = JSON.parse(fs.readFileSync(journal, 'utf8'))
    if (operation?.schemaVersion !== 1 || !['completed', 'rolled-back'].includes(operation.phase)) fail('上次安装管理尚未安全结束，请先恢复事务与备份')
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`无法读取安装管理事务记录：${journal} (${error.code || error.name})`)
    }
  }
  const filename = path.join(home, 'profile-bridge', 'installation.json')
  let record
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) fail('安装记录不能是链接')
    record = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return requested
    if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
    fail(`无法读取 ${filename} (${error.code || error.name})`)
  }
  if (record?.schemaVersion === 1 && record.phase === 'uninstalled') {
    const data = resolveInstallationData({ dshHome, dataDir: record.dataDir })
    if (data && overlaps(data.to, trusted.map(requested))) fail('程序目录不能与保留的数据重叠')
    return requested
  }
  if (record?.schemaVersion !== 1 || record.phase !== 'completed' || !Array.isArray(record.entries)) fail('迁移尚未完成或记录格式不受支持')
  if (record.layout === 'retained-data') {
    const entry = record.entries[0]
    if (record.entries.length !== 1 || entry?.kind !== 'data') fail('保留的数据登记不完整')
    const data = resolveInstallationData({ dshHome, dataDir: absolute(entry.to) })
    if (!data || !same(trusted.map(absolute(entry.from)), data.from)) fail('保留的数据入口不匹配')
    if (overlaps(data.to, trusted.map(requested))) fail('程序目录不能与保留的数据重叠')
    return requested
  }
  if (record.layout !== undefined) fail('不支持的安装位置布局')
  const destination = trusted.map(absolute(record.destination))
  const logicalApp = trusted.map(absolute(record.appDir))
  if (overlaps(destination, home) || overlaps(destination, logicalApp)) fail('迁移目标不能与共享 DSH 或原安装目录重叠')
  ordinaryAncestors(destination)
  const entries = record.entries
  if (entries.length !== 3 || new Set(entries.map(e => e?.kind)).size !== 3 || entries.some(e => !['app', 'profile', 'data'].includes(e?.kind))) fail('迁移目录清单不完整')
  const seen = new Set()
  for (const entry of entries) {
    const from = trusted.map(absolute(entry.from)), to = trusted.map(absolute(entry.to))
    if (overlaps(destination, from)) fail('迁移目标不能与原目录重叠')
    ordinaryAncestors(path.dirname(from))
    const expected = entry.kind === 'app' ? logicalApp : entry.kind === 'profile' ? path.join(home, 'profiles', 'tavern') : path.join(home, 'profile-data', 'tavern')
    if (!same(from, expected) || !inside(to, destination) || !same(to, path.join(destination, entry.kind)) || seen.has(to)) fail('迁移目录不匹配')
    seen.add(to)
    try {
      // No aliased destination ancestors: copied trees must remain on the chosen volume.
      if (!same(fs.realpathSync(destination), destination) || !same(fs.realpathSync(to), to) || !fs.lstatSync(to).isDirectory()) fail('迁移目标包含链接或不是目录')
      if (!fs.lstatSync(from).isSymbolicLink() || !same(trusted.map(path.resolve(path.dirname(from), fs.readlinkSync(from))), to) || !same(fs.realpathSync(from), to)) fail('原目录入口已被更改')
    } catch (error) {
      if (error.code === 'INSTALLATION_LOCATION_UNSAFE') throw error
      fail(`目录不可用：${from} → ${to}`)
    }
  }
  const physicalApp = trusted.map(entries.find(entry => entry.kind === 'app').to)
  if (appDir && !same(trusted.map(requested), logicalApp) && !same(trusted.map(requested), physicalApp)) fail('指定目录与已迁移的酒馆冲突')
  return physicalApp
}
module.exports = { resolveInstallationApp, resolveInstallationData, trustedHome }
if (require.main === module) {
  try { console.log(resolveInstallationApp({ dshHome: process.argv[2], appDir: process.argv[3] || undefined })) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
