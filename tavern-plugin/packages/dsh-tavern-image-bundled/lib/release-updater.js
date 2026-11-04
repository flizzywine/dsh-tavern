import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const API = 'https://api.github.com/repos/weixinlll/dsh-tavern-image/releases/latest'
const REPOSITORY_URL = 'https://github.com/weixinlll/dsh-tavern-image'
const ZIP = 'dsh-tavern-image-source.zip'
const PACKAGE_NAMES = new Set(['dsh-tavern-comfy', 'dsh-tavern-image'])
const MAX_ZIP = 64 * 1024 * 1024
const ALLOWED = /^(card-worldbook\.default\.json|skills\/(?:image-prompt\/SKILL\.md|character-authoring\/(?:SKILL\.md|references\/design-rules\.md))|package\.json|client\.js|console\.html|cordis\.patch\.yml|design-rules\.md|README\.md|LICENSE|世界书-(通用生图规则|角色与服装库)\.json|lib\/.+|scripts\/(install-plugin\.ps1|Install-DshTavernImage\.cmd|Package-DshTavernImage\.ps1)|workflows\/\.gitkeep)$/
const PRIVATE = /^(card-worldbook\.json|card-enabled\.json|workflows-card|skills\/image-prompt\/references|config(\.json)?|definitions(\.json)?|worldbook(-outfits)?(\.json)?|jobs(-store)?\.json|plans(-store)?\.json|cache|backups|node_modules|\.git)(\/|$)/i

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function unpackZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_ZIP) throw Error('ZIP size is invalid')
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw Error('ZIP directory is missing')
  const count = buffer.readUInt16LE(end + 10)
  const centralSize = buffer.readUInt32LE(end + 12)
  const centralAt = buffer.readUInt32LE(end + 16)
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8) || count > 4096 || centralAt + centralSize !== end) throw Error('Unsupported ZIP layout')
  const result = new Map(), names = new Set(), pathCases = new Map()
  let pos = centralAt, total = 0
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw Error('Corrupt ZIP central directory')
    const madeBy = buffer.readUInt16LE(pos + 4), flags = buffer.readUInt16LE(pos + 8), method = buffer.readUInt16LE(pos + 10)
    const crc = buffer.readUInt32LE(pos + 16), compressed = buffer.readUInt32LE(pos + 20), size = buffer.readUInt32LE(pos + 24)
    const nameLength = buffer.readUInt16LE(pos + 28), extraLength = buffer.readUInt16LE(pos + 30), commentLength = buffer.readUInt16LE(pos + 32)
    const external = buffer.readUInt32LE(pos + 38), localAt = buffer.readUInt32LE(pos + 42)
    if (pos + 46 + nameLength + extraLength + commentLength > end || (flags & 0x41) || ![0, 8].includes(method) || size > 32 * 1024 * 1024 || compressed > MAX_ZIP) throw Error('Encrypted or oversized ZIP entry')
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8')
    const directory = name.endsWith('/'), clean = directory ? name.slice(0, -1) : name
    const parts = clean.split('/')
    if (!name || name.includes('\\') || name.includes(String.fromCharCode(0)) || name.startsWith('/') || parts.some(x => !x || x === '.' || x === '..' || x.includes(':') || x.endsWith('.') || x.endsWith(' ') || ['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9'].includes(x.split('.')[0].toUpperCase())) || parts[0] !== 'dsh-tavern-image') throw Error('Unsafe ZIP path')
    const relative = parts.slice(1).join('/'), folded = clean.toLowerCase()
    for (let i = 1; i <= parts.length; i++) { const original = parts.slice(0, i).join('/'), lower = original.toLowerCase(), prior = pathCases.get(lower); if (prior && prior !== original) throw Error('Case-conflicting ZIP parent path'); pathCases.set(lower, original) }
    if (names.has(folded)) throw Error('Duplicate ZIP path')
    names.add(folded)
    if ((madeBy >> 8) === 3 && ((external >>> 16) & 0xf000) === 0xa000) throw Error('ZIP symlinks are forbidden')
    if (!directory && (!relative || !ALLOWED.test(relative) || PRIVATE.test(relative))) throw Error('ZIP contains a protected path')
    total += size
    if (total > 128 * 1024 * 1024 || (compressed === 0 ? size !== 0 : size / compressed > 500)) throw Error('ZIP expansion limit exceeded')
    if (!directory) {
      if (localAt + 30 > centralAt || buffer.readUInt32LE(localAt) !== 0x04034b50) throw Error('Corrupt ZIP local header')
      const localFlags = buffer.readUInt16LE(localAt + 6), localMethod = buffer.readUInt16LE(localAt + 8)
      const localCrc = buffer.readUInt32LE(localAt + 14), localCompressed = buffer.readUInt32LE(localAt + 18), localSize = buffer.readUInt32LE(localAt + 22)
      const localNameLength = buffer.readUInt16LE(localAt + 26), localExtraLength = buffer.readUInt16LE(localAt + 28)
      const dataAt = localAt + 30 + localNameLength + localExtraLength, dataEnd = dataAt + compressed
      const localName = buffer.subarray(localAt + 30, localAt + 30 + localNameLength).toString('utf8')
      if (localFlags !== flags || localMethod !== method || localName !== name || dataEnd > centralAt || (flags & 8 ? ![0, crc].includes(localCrc) || ![0, compressed].includes(localCompressed) || ![0, size].includes(localSize) : localCrc !== crc || localCompressed !== compressed || localSize !== size)) throw Error('ZIP headers disagree')
      let data
      try { data = method === 0 ? Buffer.from(buffer.subarray(dataAt, dataEnd)) : inflateRawSync(buffer.subarray(dataAt, dataEnd), { maxOutputLength: 32 * 1024 * 1024 }) } catch { throw Error('ZIP decompression failed') }
      if (data.length !== size || crc32(data) !== crc) throw Error('ZIP CRC check failed')
      // With bit 3 set, .NET writes CRC and sizes after the data. Validate the descriptor when present.
      if (flags & 8) {
        let descriptor = dataEnd
        if (buffer.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4
        if (descriptor + 12 > centralAt || buffer.readUInt32LE(descriptor) !== crc || buffer.readUInt32LE(descriptor + 4) !== compressed || buffer.readUInt32LE(descriptor + 8) !== size) throw Error('Invalid ZIP data descriptor')
      }
      result.set(relative, data)
    }
    pos += 46 + nameLength + extraLength + commentLength
  }
  if (pos !== end || !result.has('package.json')) throw Error('ZIP is missing package.json or has trailing directory data')
  return result
}

function compareVersions(a, b) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null
  const left = parse(a), right = parse(b)
  if (!left || !right) return 0
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0, y = right[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'string') return -1
    if (typeof x === 'string' && typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

function expectedHash(text) {
  const rows = text.split(/\r?\n/).filter(row => row.trim().endsWith(`  ${ZIP}`) || row.trim().endsWith(` *${ZIP}`))
  if (rows.length !== 1) throw Error('SHA256SUMS must contain exactly one matching asset entry')
  const match = rows[0].trim().match(/^([a-f\d]{64})\s+\*?dsh-tavern-image-source\.zip$/i)
  if (!match) throw Error('Invalid SHA256SUMS entry')
  return match[1].toLowerCase()
}

function assetUrl(value, tag, name) {
  let url
  try { url = new URL(value) } catch { throw Error('Invalid release asset URL') }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) throw Error('Release assets must use clean HTTPS URLs on port 443')
  if (url.hostname === 'github.com') {
    if (url.pathname !== `/weixinlll/dsh-tavern-image/releases/download/${tag}/${name}`) throw Error('Unexpected GitHub asset path')
  } else throw Error('Release asset metadata must point to the official GitHub repository URL')
  return url.href
}
export function createReleaseUpdater({ root, fetchImpl = globalThis.fetch, now = Date.now, checkCompatibility = async pkg => ({ compatible: true }) }) {
  const base = resolve(root)
  let checked = null, packageFiles = null, busy = false, restartRequired = false, applied = null
  async function status() {
    let currentVersion = '未知'
    try { currentVersion = String(JSON.parse(await readFile(join(base, 'package.json'), 'utf8')).version || currentVersion) } catch {}
    return { ok: true, repositoryUrl: REPOSITORY_URL, supported: true, canUpdate: !!(checked?.available && checked.compatible && !restartRequired), currentVersion, latestVersion: checked?.version, available: !!checked?.available && !restartRequired, target: checked?.target, reason: restartRequired ? '更新已安装，请完整重启 DSH。' : checked?.reason || '', restartRequired }
  }
  async function exclusive(action) {
    if (busy) throw Error('正在检查或更新，请稍后再试')
    busy = true
    try { return await action() } finally { busy = false }
  }
  async function request(url, max = 1024 * 1024) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'dsh-tavern-image-updater', Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw Error('GitHub 更新请求失败')
      const finalUrl = new URL(response.url || url)
      const originalUrl = new URL(url)
      const cdnHosts = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com']
      if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password || (originalUrl.hostname === 'api.github.com' ? finalUrl.hostname !== 'api.github.com' : finalUrl.hostname !== originalUrl.hostname && !cdnHosts.includes(finalUrl.hostname)) || (finalUrl.hostname === 'github.com' && finalUrl.pathname !== originalUrl.pathname)) throw Error('Release 重定向目标不受信任')
      const declared = Number(response.headers?.get?.('content-length'))
      if (Number.isFinite(declared) && declared > max) throw Error('下载文件超过大小限制')
      let data
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw Error('下载文件超过大小限制') } chunks.push(Buffer.from(value)) }
        data = Buffer.concat(chunks, size)
      } else { data = Buffer.from(await response.arrayBuffer()); if (data.length > max) throw Error('下载文件超过大小限制') }
      return data
    } catch (error) { throw Error(error.name === 'AbortError' ? '更新请求超时' : error.message || '更新请求失败') }
    finally { clearTimeout(timer) }
  }
  async function check() {
    return exclusive(async () => {
      checked = null; packageFiles = null
      const local = await status()
      try {
        const rootInfo = await lstat(base)
        if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw Error('安装根目录是符号链接或非目录')
        const release = JSON.parse((await request(API, 1024 * 1024)).toString('utf8')), tag = release?.tag_name
        if (release?.draft || release?.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag || '')) throw Error('最新 Release 信息无效')
        const assets = Array.isArray(release.assets) ? release.assets : []
        const zips = assets.filter(asset => asset.name === ZIP), sums = assets.filter(asset => asset.name === 'SHA256SUMS')
        if (zips.length !== 1 || sums.length !== 1) throw Error('Release 缺少唯一更新 ZIP 或 SHA256SUMS')
        const zipUrl = assetUrl(zips[0].browser_download_url, tag, ZIP), sumsUrl = assetUrl(sums[0].browser_download_url, tag, 'SHA256SUMS')
        const [archive, sumsData] = await Promise.all([request(zipUrl, MAX_ZIP), request(sumsUrl, 65536)])
        const digest = createHash('sha256').update(archive).digest('hex')
        if (digest !== expectedHash(sumsData.toString('utf8'))) throw Error('更新 ZIP SHA256 校验失败')
        const files = unpackZip(archive)
        let pkg
        try { pkg = JSON.parse(files.get('package.json').toString('utf8')) } catch { throw Error('更新 package.json 无效') }
        const version = String(pkg.version || '')
        if (!PACKAGE_NAMES.has(pkg.name) || version !== tag.slice(1)) throw Error('包名、版本与 Release tag 不匹配')
        const minimumApi = pkg.dsh?.compatibility?.tavernApiVersion
        if (!Number.isSafeInteger(minimumApi) || minimumApi < 1) throw Error('Release 缺少有效的 tavernApiVersion 元数据')
        const compatibility = await checkCompatibility(pkg, minimumApi)
        if (compareVersions(version, local.currentVersion) <= 0) {
          checked = { available: false, compatible: false, version, baseVersion: local.currentVersion, target: `${tag}:${digest}`, reason: '当前已是最新版本' }
          return status()
        }
        checked = { available: true, compatible: !!compatibility?.compatible, version, baseVersion: local.currentVersion, target: `${tag}:${digest}`, reason: compatibility?.compatible ? '' : String(compatibility?.reason || '当前 DSH 环境不兼容') }
        packageFiles = files
        return { ...await status(), checkedAt: now() }
      } catch (error) {
        checked = { available: false, compatible: false, reason: error.message || '检查更新失败' }
        return status()
      }
    })
  }
  async function checkedPath(relative) {
    if (!ALLOWED.test(relative) || PRIVATE.test(relative)) throw Error('更新路径不在允许范围内')
    let current = base
    for (const segment of relative.split('/').slice(0, -1)) {
      current = join(current, segment)
      try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw Error('安装路径包含符号链接或异常目录') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const target = resolve(base, relative)
    if (!target.startsWith(base + sep)) throw Error('更新路径越界')
    try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw Error('更新目标是符号链接或非普通文件') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    return target
  }
  async function apply(target) {
    return exclusive(async () => {
      if (applied && target === applied.target) return applied
      if (!checked?.available || !checked.compatible || !packageFiles || target !== checked.target) throw Error('请先检查可用且兼容的 Release 更新')
      const rootInfo = await lstat(base)
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw Error('安装根目录是符号链接或非目录')
      const currentVersion = JSON.parse(await readFile(join(base, 'package.json'), 'utf8')).version
      if (currentVersion !== checked.baseVersion || compareVersions(checked.version, currentVersion) <= 0) throw Error('本地版本已变化，请重新检查更新')
      const pkg = JSON.parse(packageFiles.get('package.json').toString('utf8'))
      const minimumApi = pkg.dsh?.compatibility?.tavernApiVersion
      const compatibility = await checkCompatibility(pkg, minimumApi)
      if (!Number.isSafeInteger(minimumApi) || minimumApi < 1 || !compatibility?.compatible) throw Error(compatibility?.reason || '当前 DSH 环境不兼容')
      const stage = await mkdtemp(join(base, '.dsh-release-stage-'))
      let backup = null
      const changed = []
      try {
        backup = await mkdtemp(join(base, '.dsh-release-backup-'))
        for (const [path, data] of packageFiles) { const staged = join(stage, path); await mkdir(dirname(staged), { recursive: true }); await writeFile(staged, data, { flag: 'wx' }) }
        for (const path of packageFiles.keys()) {
          const destination = await checkedPath(path), staged = join(stage, path), saved = join(backup, path)
          await mkdir(dirname(destination), { recursive: true })
          let existed = false
          try { await lstat(destination); await mkdir(dirname(saved), { recursive: true }); await rename(destination, saved); existed = true }
          catch (error) { if (error.code !== 'ENOENT') throw error }
          const item = { destination, saved, existed }; changed.push(item)
          await rename(staged, destination)
          if (!(await readFile(destination)).equals(packageFiles.get(path))) throw Error('更新文件写入校验失败')
        }
        restartRequired = true
        applied = { ...await status(), available: false, canUpdate: false, restartRequired: true, target, message: '更新已安装，请完整关闭并重启 DSH 后使用新版。' }
        await rm(stage, { recursive: true, force: true }).catch(() => {})
        await rm(backup, { recursive: true, force: true }).catch(() => {})
        return applied
      } catch (error) {
        const failures = []
        for (const item of changed.reverse()) {
          try { await rm(item.destination, { force: true }); if (item.existed) await rename(item.saved, item.destination) }
          catch (failure) { failures.push(`${item.destination}: ${failure.message}`) }
        }
        await rm(stage, { recursive: true, force: true }).catch(() => {})
        if (failures.length) throw Error(`更新失败且回滚不完整；唯一旧文件备份保留于 ${backup}。${failures.join('; ')}`)
        if (backup) await rm(backup, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    })
  }
  return { status, check, apply }
}
