// Offline, recoverable Tavern-only installation management. Never moves DSH_HOME.
import * as fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { renameWithRetry } from './helper.mjs'
import { trustedHome, withinPath } from './trusted-home.mjs'

const present = p => { try { fs.lstatSync(p); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const same = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
const within = withinPath
const fail = message => { throw Object.assign(new Error(message), { code: 'installation-unsafe' }) }
const save = (file, value) => {
  const temp = file + '.' + randomUUID() + '.tmp'
  const fd = fs.openSync(temp, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  // A Windows reader or scanner can briefly lock the previous record.
  for (let retry = 0; ; retry++) {
    try { fs.renameSync(temp, file); break } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || retry >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (retry + 1))
    }
  }
  // Directory fsync is not supported by every Windows/filesystem combination.
  let directory
  try { directory = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(directory) } catch { /* best-effort directory durability */ } finally { if (directory !== undefined) { try { fs.closeSync(directory) } catch { /* best-effort directory handle cleanup */ } } }
}
const tavern = p => json(path.join(p, 'package.json'))?.name === 'dsh-profile-tavern'
function ordinaryAncestors(p, includeLeaf = true) {
  let current = includeLeaf ? path.resolve(p) : path.dirname(path.resolve(p))
  for (;;) {
    if (present(current) && fs.lstatSync(current).isSymbolicLink()) fail(`不支持经过未登记链接的路径：${current}`)
    const parent = path.dirname(current); if (parent === current) break; current = parent
  }
}
function canonicalAbsolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && same(path.resolve(value), value) && !/[\0\r\n]/u.test(value)
}
function registered(paths, trust) {
  const file = path.join(paths.stateDir, 'installation.json')
  if (!present(file)) return null
  ordinaryAncestors(file)
  const value = json(file)
  if (!value || typeof value !== 'object') fail('安装位置记录不完整，请先恢复安装记录。')
  // Preserve old logical records on disk; use trusted physical identity in memory.
  if (canonicalAbsolute(value.appDir)) value.appDir = trust.map(value.appDir)
  if (canonicalAbsolute(value.destination)) value.destination = trust.map(value.destination)
  if (Array.isArray(value.entries)) value.entries = value.entries.map(entry => ({ ...entry, from: canonicalAbsolute(entry.from) ? trust.map(entry.from) : entry.from, to: canonicalAbsolute(entry.to) ? trust.map(entry.to) : entry.to }))
  if (value.phase === 'uninstalled') fail('酒馆已移除；数据与备份仍保留。')
  const retainedData = value.layout === 'retained-data'
  if (value.schemaVersion !== 1 || value.phase !== 'completed' || !Array.isArray(value.entries)
    || value.entries.length !== (retainedData ? 1 : 3) || (value.layout !== undefined && !retainedData)) fail('安装位置记录不完整，请先恢复安装记录。')
  if (!retainedData && (!canonicalAbsolute(value.destination) || !canonicalAbsolute(value.appDir))) fail('安装位置登记必须是规范绝对路径。')
  const expected = retainedData ? { data: path.join(paths.home, 'profile-data/tavern') }
    : { app: value.appDir, profile: path.join(paths.home, 'profiles/tavern'), data: path.join(paths.home, 'profile-data/tavern') }
  if (!retainedData) for (const root of [paths.home, ...Object.values(expected)]) {
    if (within(value.destination, root) || within(root, value.destination)) fail('登记的迁移目标与 DSH 或原安装目录重叠。')
  }
  for (const kind of Object.keys(expected)) {
    const entry = value.entries.find(e => e?.kind === kind)
    if (!entry || !canonicalAbsolute(entry.from) || !canonicalAbsolute(entry.to) || !same(entry.from, expected[kind])) fail('安装位置登记不一致。')
    if (retainedData) {
      if (within(entry.to, paths.home) || within(paths.home, entry.to)) fail('保留的数据位置与 DSH 目录重叠。')
    } else if (!same(entry.to, path.join(value.destination, kind))) fail('安装位置登记不一致。')
    ordinaryAncestors(entry.from, false); ordinaryAncestors(entry.to)
    if (!fs.lstatSync(entry.from).isSymbolicLink() || !same(trust.map(path.resolve(path.dirname(entry.from), fs.readlinkSync(entry.from))), entry.to) || !same(fs.realpathSync(entry.from), entry.to)) fail(`安装位置链接已改变：${entry.from}`)
  }
  return value
}
function discover(paths) {
  const trust = trustedHome(paths.home)
  const home = trust.home, stateDir = trust.map(paths.stateDir)
  ordinaryAncestors(home); ordinaryAncestors(stateDir)
  const journalFile = path.join(stateDir, 'installation-operation.json')
  if (present(journalFile)) {
    let journal
    try { ordinaryAncestors(journalFile); journal = json(journalFile) } catch { /* malformed journals are never treated as permission to retry */ }
    if (journal?.schemaVersion !== 1 || !['completed', 'rolled-back'].includes(journal?.phase)) throw Object.assign(new Error(`上次安装管理记录不完整或尚未安全结束，请保留目录与日志并恢复：${journalFile}`), { code: 'recovery-required', recoveryRequired: true })
  }
  const record = registered({ ...paths, home, stateDir }, trust)
  const receipt = json(path.join(home, 'logs/tavern-installation.json'))
  if (!['desktop', 'next'].includes(receipt.host) || !same(trust.map(receipt.dshHome || ''), home) || !path.isAbsolute(receipt.sourceRoot || '')) fail('仅支持具有桌面安装记录的酒馆。')
  const appDir = record?.appDir || trust.map(receipt.sourceRoot)
  if (appDir === path.join(home, 'apps') || (within(appDir, home) && !within(appDir, path.join(home, 'apps')))) fail('DSH 目录内仅支持 apps 下的酒馆程序。')
  for (const reserved of ['profiles', 'profile-data', 'profile-bridge', 'logs', 'backups', 'credentials']) {
    const protectedRoot = path.join(home, reserved)
    if (within(appDir, protectedRoot) || within(protectedRoot, appDir)) fail('酒馆程序目录与 DSH 保留目录重叠。')
  }
  const retainedData = record?.layout === 'retained-data'
  const entries = (record && !retainedData) ? record.entries : [
    { kind: 'app', from: appDir, to: appDir },
    { kind: 'profile', from: path.join(home, 'profiles/tavern'), to: path.join(home, 'profiles/tavern') },
    retainedData ? record.entries[0] : { kind: 'data', from: path.join(home, 'profile-data/tavern'), to: path.join(home, 'profile-data/tavern') },
  ]
  if (record && ![appDir, entries.find(e => e.kind === 'app').to].some(p => same(p, trust.map(receipt.sourceRoot)))) fail('安装回执与迁移位置不匹配。')
  for (const entry of entries) {
    ordinaryAncestors(entry.to)
    if (!fs.lstatSync(entry.to).isDirectory()) fail(`安装目录不是独立文件夹：${entry.to}`)
  }
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) if (within(entries[i].to, entries[j].to) || within(entries[j].to, entries[i].to)) fail('酒馆目录相互重叠。')
  const app = entries.find(e => e.kind === 'app').to
  if (app === home || within(home, app) || present(path.join(app, '.git')) || !tavern(app) || !tavern(entries.find(e => e.kind === 'profile').to)) fail('仅支持已安装的酒馆，不支持源码目录或其他 profile。')
  const local = json(path.join(app, '.dsh-tavern-local.json'))
  if (local.host !== receipt.host || !same(trust.map(local.dshHome || ''), home)) fail('酒馆安装归属与 DSH 目录不匹配。')
  return { appDir: app, logicalAppDir: appDir, profileDir: entries.find(e => e.kind === 'profile').to, dataDir: entries.find(e => e.kind === 'data').to, sharedHome: home, available: true, relocated: !!record && !retainedData, destination: record?.destination, entries, home, stateDir }
}
export function inspectInstallation(paths) {
  try { return discover(paths) } catch (error) { return { available: false, sharedHome: paths.home, reason: error.message, recoveryRequired: error.recoveryRequired === true } }
}
function destinationCheck(destination, installation, identity) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || destination.trim() !== destination || destination === path.parse(destination).root) fail('请选择绝对路径的空文件夹，不能选择磁盘根目录。')
  destination = identity.map(destination)
  ordinaryAncestors(destination)
  if (present(destination)) destination = fs.realpathSync(destination)
  else if (present(path.dirname(destination))) destination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination))
  for (const root of [installation.home, ...installation.entries.flatMap(e => [e.from, e.to])]) if (within(destination, root) || within(root, destination)) fail('目标不能与 DSH 或现有酒馆目录重叠。')
  if (!present(path.dirname(destination)) || !fs.statSync(path.dirname(destination)).isDirectory()) fail('目标的父文件夹必须已存在。')
  if (present(destination) && (!fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length)) fail('目标必须是空文件夹。')
  return destination
}
export function validateInstallationRequest(paths, mode, payload) {
  if (!['relocate', 'uninstall'].includes(mode) || payload?.confirmed !== true) fail('请先确认安装管理操作。')
  const installation = discover(paths)
  const identity = trustedHome(paths.home)
  const profilesRoot = path.join(installation.home, 'profiles')
  const liveDir = path.join(profilesRoot, 'desktop')
  const activeDir = paths.activeDir ? identity.map(paths.activeDir) : liveDir
  const removingFromNextTavern = paths.host === 'next' && mode === 'uninstall' && same(activeDir, path.join(profilesRoot, 'tavern'))
  if (!same(activeDir, liveDir) && !removingFromNextTavern) fail('请从原版桌面或 NEXT 的酒馆配置管理安装。')
  const destination = mode === 'relocate' ? destinationCheck(payload.destination, installation, identity) : undefined
  return { mode, host: paths.host, home: paths.home, stateDir: installation.stateDir, profilesRoot, liveDir, installation, destination }
}
function mapTarget(target, entries) {
  for (const e of entries) for (const base of [e.source, e.from]) if (within(target, base)) return path.join(e.to, path.relative(base, target))
  return target
}
function hashFile(file, heartbeat) {
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024), fd = fs.openSync(file, 'r')
  try { for (;;) { heartbeat(); const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break; digest.update(buffer.subarray(0, count)) } } finally { fs.closeSync(fd) }
  return digest.digest('hex')
}
function sourceInventory(entries, heartbeat) {
  const digest = createHash('sha256')
  const visit = p => {
    heartbeat()
    const stat = fs.lstatSync(p)
    digest.update(JSON.stringify([p, stat.mode, stat.size, stat.ino, stat.dev, stat.mtimeMs, stat.ctimeMs]))
    if (stat.isSymbolicLink()) digest.update(fs.readlinkSync(p))
    else if (stat.isDirectory()) for (const child of fs.readdirSync(p).sort()) visit(path.join(p, child))
  }
  for (const entry of entries) visit(entry.source)
  return digest.digest('hex')
}
function copyVerified(source, target, entry, entries, heartbeat, identity) {
  heartbeat()
  const info = fs.lstatSync(source)
  if (info.isSymbolicLink()) {
    const original = identity(path.resolve(path.dirname(source), fs.readlinkSync(source)))
    const mapped = mapTarget(original, entries)
    const internal = entries.some(e => within(original, e.source) || within(original, e.from))
    if (!internal && (entry.kind === 'data' || !source.split(path.sep).includes('node_modules'))) fail(`未迁移不明外部链接：${source}`)
    // Never dereference links. External dependency links still use original DSH.
    const targetInfo = fs.statSync(source)
    fs.symlinkSync(mapped, target, process.platform === 'win32' ? (targetInfo.isDirectory() ? 'junction' : 'file') : undefined)
    return
  }
  if (info.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 })
    for (const name of fs.readdirSync(source)) copyVerified(path.join(source, name), path.join(target, name), entry, entries, heartbeat, identity)
    fs.chmodSync(target, info.mode)
  } else if (info.isFile()) {
    const input = fs.openSync(source, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024)
    let output
    try {
      output = fs.openSync(target, 'wx', 0o600)
      for (;;) {
        heartbeat()
        const count = fs.readSync(input, buffer, 0, buffer.length, null)
        if (!count) break
        let offset = 0
        while (offset < count) { heartbeat(); offset += fs.writeSync(output, buffer, offset, count - offset) }
      }
      fs.fsyncSync(output)
    } finally { fs.closeSync(input); if (output !== undefined) fs.closeSync(output) }
    if (hashFile(source, heartbeat) !== hashFile(target, heartbeat)) fail(`复制校验失败：${source}`)
    fs.chmodSync(target, info.mode)
  } else fail(`不支持的特殊文件：${source}`)
}
export async function performInstallation(request, { retry = {}, rename = fs.renameSync, link = fs.symlinkSync, afterCopy = () => {}, persist: write = save, ownership, now = Date.now } = {}) {
  const guard = callback => ownership ? ownership.withOwnership(callback) : callback()
  let lastHeartbeat = -Infinity
  const heartbeat = (force = false) => {
    if (ownership && (force || now() - lastHeartbeat >= 5000)) {
      ownership.assertOwnership()
      ownership.update({ state: 'running', stage: 'installation-management' })
      lastHeartbeat = now()
    }
  }
  const persist = (file, value) => { heartbeat(); return guard(() => write(file, value)) }
  const ownedRename = (from, to) => { heartbeat(); return guard(() => rename(from, to)) }
  heartbeat(true)
  const paths = { home: request.home, stateDir: request.stateDir, activeDir: request.liveDir }
  const fresh = validateInstallationRequest(paths, request.mode, { confirmed: true, destination: request.destination })
  const identity = trustedHome(request.home)
  if (!same(identity.home, fresh.installation.home)) fail('DSH 目录入口已改变，请刷新后重试。')
  if (JSON.stringify(fresh.installation.entries) !== JSON.stringify(request.installation.entries)) fail('安装目录已改变，请刷新后重试。')
  if (request.mode === 'uninstall') {
    if (fs.lstatSync(request.liveDir).isSymbolicLink() || tavern(request.liveDir)) fail('请先恢复原版 DSH，再移除酒馆。')
  }
  const registryFile = path.join(request.stateDir, 'installation.json')
  const previousRegistry = present(registryFile) ? fs.readFileSync(registryFile, 'utf8') : null
  // NEXT remembers the selected Profile separately and would reopen Tavern after a restart.
  const nextProfileFile = path.join(fresh.installation.home, 'desktop-next.json')
  let previousNextProfile
  if (request.mode === 'uninstall' && request.host === 'next') {
    identity.ordinary(nextProfileFile)
    if (present(nextProfileFile)) {
      const selection = json(nextProfileFile)
      if (selection?.active === 'tavern') previousNextProfile = selection
    }
  }
  let nextProfileWritten = false
  let registryWritten = false
  const stamp = randomUUID(), journalFile = path.join(request.stateDir, 'installation-operation.json')
  const journal = { schemaVersion: 1, mode: request.mode, phase: 'preparing', stamp, actions: [], retained: [] }
  if (previousNextProfile) journal.nextProfile = { file: nextProfileFile, previous: previousNextProfile }
  guard(() => fs.mkdirSync(request.stateDir, { recursive: true })); persist(journalFile, journal)
  const move = async (from, to) => {
    if (present(to)) fail(`备份路径已存在：${to}`)
    const action = { type: 'move', from, to, done: false }
    journal.actions.push(action); persist(journalFile, journal)
    await renameWithRetry(from, to, { ...retry, rename: ownedRename }); action.done = true; persist(journalFile, journal)
  }
  const alias = (from, to) => {
    if (present(from)) fail(`链接入口已存在：${from}`)
    const action = { type: 'link', from, to, done: false }
    journal.actions.push(action); persist(journalFile, journal)
    guard(() => link(to, from, process.platform === 'win32' ? 'junction' : 'dir')); action.done = true; persist(journalFile, journal)
  }
  const entries = fresh.installation.entries.map(e => ({ ...e, source: e.to, to: request.mode === 'relocate' ? path.join(request.destination, e.kind) : e.to }))
  try {
    if (request.mode === 'relocate') {
      if (!present(request.destination)) guard(() => fs.mkdirSync(request.destination))
      // All copies and hashes finish before any old registration changes.
      const inventory = sourceInventory(entries, heartbeat)
      for (const e of entries) copyVerified(e.source, e.to, e, entries, heartbeat, identity.map)
      await afterCopy()
      heartbeat(true)
      if (sourceInventory(entries, heartbeat) !== inventory) fail('复制期间源目录发生变化，未切换位置；请关闭其他使用酒馆的程序后重试。')
      for (const e of entries) {
        const backup = e.from + '.switch-backup-' + stamp
        await move(e.from, backup); journal.retained.push(backup); if (e.source !== e.from) journal.retained.push(e.source); persist(journalFile, journal)
        alias(e.from, e.to)
      }
      const record = { schemaVersion: 1, phase: 'completed', appDir: fresh.installation.logicalAppDir, destination: request.destination, entries: entries.map(({ kind, from, to }) => ({ kind, from, to })), retained: journal.retained }
      persist(registryFile, record); registryWritten = true
    } else {
      // Quarantine both code and profile; never delete user data or backups.
      for (const e of entries.filter(e => e.kind !== 'data')) {
        const backup = e.source + '.switch-removed-' + stamp
        await move(e.source, backup); journal.retained.push(backup); persist(journalFile, journal)
        if (e.from !== e.source) { const aliasBackup = e.from + '.switch-removed-' + stamp; await move(e.from, aliasBackup); journal.retained.push(aliasBackup); persist(journalFile, journal) }
      }
      if (previousNextProfile) {
        persist(nextProfileFile, { ...previousNextProfile, active: 'desktop' })
        nextProfileWritten = true
      }
      persist(registryFile, { schemaVersion: 1, phase: 'uninstalled', retained: journal.retained, dataDir: fresh.installation.dataDir }); registryWritten = true
    }
    journal.phase = 'completed'; persist(journalFile, journal)
    return { changed: true, mode: request.mode, destination: request.destination, retained: journal.retained, dataDir: request.mode === 'relocate' ? path.join(request.destination, 'data') : fresh.installation.dataDir }
  } catch (error) {
    try {
      ownership?.assertOwnership()
      for (const action of [...journal.actions].reverse()) {
        if (!action.done) continue
        if (action.type === 'link' && present(action.from)) {
          if (!fs.lstatSync(action.from).isSymbolicLink() || !same(path.resolve(path.dirname(action.from), fs.readlinkSync(action.from)), action.to)) fail(`恢复时发现链接改变：${action.from}`)
          guard(() => { try { fs.unlinkSync(action.from) } catch (unlinkError) {
            if (process.platform !== 'win32' || !['EPERM', 'EISDIR'].includes(unlinkError.code)) throw unlinkError
            fs.rmdirSync(action.from) // Windows junction itself only; never recursive.
          } })
        } else if (action.type === 'move' && present(action.to)) {
          if (present(action.from)) fail(`恢复路径冲突：${action.from}`)
          await renameWithRetry(action.to, action.from, { ...retry, rename: ownedRename })
        }
      }
      if (registryWritten) {
        if (previousRegistry === null) guard(() => fs.unlinkSync(registryFile))
        else persist(registryFile, JSON.parse(previousRegistry))
      }
      if (nextProfileWritten) persist(nextProfileFile, previousNextProfile)
      journal.phase = 'rolled-back'; journal.error = error.message; persist(journalFile, journal)
    } catch (rollback) { throw Object.assign(new Error(`操作失败且需人工恢复；请保留所有目录和日志 ${journalFile}：${rollback.message}`, { cause: error }), { code: 'recovery-required', recoveryRequired: true }) }
    throw error
  }
}
