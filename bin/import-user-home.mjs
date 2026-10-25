// Offline, explicit import. Never execute code or reuse dependencies from the old home.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import path from 'node:path'
import { copyTreeSync } from './portable-fs.mjs'

const entries = ['profile-data/tavern', 'attachments', '.agent-presets', 'settings.yaml', '.credentials.yaml', '.openai-codex-auth.json', 'profiles/tavern/package.json', 'profiles/tavern/cordis.patch.yml']
const configuration = new Set(['settings.yaml', '.credentials.yaml', '.openai-codex-auth.json', 'profiles/tavern/package.json', 'profiles/tavern/cordis.patch.yml'])
const inside = (a, b) => a === b || b.startsWith(a + path.sep)
function canonicalFuture(file) {
  if (existsSync(file)) return realpathSync(file)
  return path.join(canonicalFuture(path.dirname(file)), path.basename(file))
}
function save(file, value) {
  const temporary = file + '.tmp'
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  const fd = openSync(temporary, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, file)
}
// Tree layout with each file's size and mtime. The same tree listed twice must give
// the same fingerprint (did it change meanwhile?); a fresh copy must give the same
// layout. Contents are compared only where two different trees meet under one name.
function inventory(root, relative = '', result = {}) {
  const file = path.join(root, relative)
  let stat
  try { stat = lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return result; throw error }
  if (stat.isSymbolicLink()) throw Error(`迁移不跟随符号链接，请先整理为普通文件：${file}`)
  if (stat.isDirectory()) {
    result[relative] = 'directory'
    for (const name of readdirSync(file).sort()) inventory(root, path.join(relative, name), result)
  } else if (stat.isFile()) result[relative] = [stat.size, stat.mtimeMs]
  else throw Error(`无法迁移特殊文件：${file}`)
  return result
}
const fingerprint = tree => JSON.stringify(tree)
const layout = tree => JSON.stringify(Object.entries(tree).map(([name, value]) => [name, value === 'directory' ? value : value[0]]))
// Returns the source fingerprint taken before copying, unchanged after it.
function copyVerified(from, to) {
  const before = inventory(from)
  copyTreeSync(from, to)
  if (fingerprint(before) !== fingerprint(inventory(from)) || layout(before) !== layout(inventory(to))) throw Error(`迁移校验失败或源数据正在变化：${from}`)
  return fingerprint(before)
}
function sameContent(from, to) {
  const tree = inventory(from)
  if (layout(tree) !== layout(inventory(to))) return false
  return Object.keys(tree).every(name => tree[name] === 'directory' || readFileSync(path.join(from, name)).equals(readFileSync(path.join(to, name))))
}
function merge(from, to) {
  if (!existsSync(to)) { copyVerified(from, to); return }
  if (lstatSync(from).isDirectory() && lstatSync(to).isDirectory()) {
    for (const name of readdirSync(from)) merge(path.join(from, name), path.join(to, name))
    return
  }
  if (!sameContent(from, to)) throw Error(`存在不同内容的同名存档或附件，已停止迁移：${to}`)
}
export function assertDesktopStopped(homes, { requireGuiClosed = false } = {}) {
  let commands
  try {
    commands = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      : execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', timeout: 15000 })
  } catch { throw Error('无法确认桌面宿主已退出，尚未迁移数据。请关闭宿主后重试。') }
  const normalize = value => value.replaceAll('\\', '/').toLowerCase()
  for (const line of commands.split('\n')) {
    const command = normalize(line)
    if (requireGuiClosed && /(?:deepseek harness|dsh next|dsh desktop)(?:\.exe)?[\"]?\s*$/.test(command.trim())) throw Error('请完整退出 DeepSeek Harness 后再安装或迁移数据。')
    if (!command.includes('dsh-desktop-host')) continue
    if (homes.some(home => command.includes(normalize(path.join(home, 'profiles'))))) throw Error('请完整退出使用源目录或目标目录的官方桌面，再迁移用户数据。')
  }
}
function assertStopped(home) {
  const file = path.join(home, 'logs/tavern.pid.json')
  if (!existsSync(file)) return
  const value = JSON.parse(readFileSync(file, 'utf8'))
  const pid = Number(value.pid)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error(`无法确认旧服务已停止：${file}`)
  try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') return; throw error }
  throw Error('请先停止旧命令行酒馆并退出官方桌面，再迁移用户数据。')
}
function recover(file, journal) {
  // Preserve a partially published tree as well, so recovery never erases new data.
  for (const item of [...journal.items].reverse()) {
    if (!item.started) continue
    const destination = path.join(journal.target, item.entry)
    const previous = path.join(journal.backup, 'previous', item.entry)
    if (existsSync(previous)) {
      if (existsSync(destination)) {
        const interrupted = path.join(journal.backup, 'interrupted-' + randomUUID(), item.entry)
        mkdirSync(path.dirname(interrupted), { recursive: true }); renameSync(destination, interrupted)
      }
      mkdirSync(path.dirname(destination), { recursive: true }); renameSync(previous, destination)
    } else if (!item.existed && existsSync(destination)) {
      const interrupted = path.join(journal.backup, 'interrupted-' + randomUUID(), item.entry)
      mkdirSync(path.dirname(interrupted), { recursive: true }); renameSync(destination, interrupted)
    }
    item.started = false; save(file, journal)
  }
  journal.phase = 'rolled-back'; save(file, journal)
}

export function importUserHome({ source, target, beforePublish = () => {} }) {
  if (!source || !path.isAbsolute(source)) throw Error('DSH_TAVERN_IMPORT_HOME 必须是旧 DSH 数据主目录的绝对路径。')
  source = realpathSync(source)
  target = canonicalFuture(path.resolve(target))
  if (inside(source, target) || inside(target, source)) throw Error('源目录与目标目录不能相同或互相包含。')
  mkdirSync(target, { recursive: true })
  assertStopped(source); assertStopped(target)
  assertDesktopStopped([source, target])
  const reportRoot = path.join(target, 'backups', 'tavern-home-import')
  mkdirSync(reportRoot, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(source).digest('hex').slice(0, 24)
  const journalFile = path.join(reportRoot, key + '.json')
  if (existsSync(journalFile)) {
    const old = JSON.parse(readFileSync(journalFile, 'utf8'))
    if (old.source !== source || old.target !== target) throw Error('迁移记录目录不匹配。')
    if (old.phase === 'completed') return { ...old, alreadyImported: true }
    if (old.phase === 'publishing') recover(journalFile, old)
  }
  const profile = path.join(source, 'profiles/tavern/package.json')
  if (!existsSync(profile) && !existsSync(path.join(source, 'profile-data/tavern'))) throw Error('没有找到旧酒馆配置或数据；请选择包含 profiles / profile-data 的旧 DSH 主目录。')
  const backup = path.join(reportRoot, Date.now() + '-' + randomUUID())
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  const journal = { source, target, backup, phase: 'preparing', items: [] }
  save(journalFile, journal)
  // Snapshot both sides before preparing or replacing anything.
  const sources = new Map(entries.filter(entry => existsSync(path.join(source, entry))).map(entry => [entry, path.join(source, entry)]))
  const witnesses = new Map(), targets = new Map()
  for (const [entry, from] of sources) witnesses.set(from, copyVerified(from, path.join(backup, 'source', entry)))
  for (const entry of entries) if (existsSync(path.join(target, entry))) targets.set(entry, copyVerified(path.join(target, entry), path.join(backup, 'target', entry)))
  // Older installs kept Tavern data beside their source checkout or at dataRoot.
  if (existsSync(profile)) {
    const old = JSON.parse(readFileSync(profile, 'utf8')).dshTavern || {}
    const legacy = old.dataRoot || (old.source && path.join(old.source, 'data'))
    if (legacy && existsSync(legacy) && realpathSync(legacy) !== path.join(source, 'profile-data/tavern/data')) {
      const resolved = realpathSync(legacy)
      if (inside(resolved, backup) || inside(backup, resolved) || inside(resolved, source)) throw Error('旧 dataRoot 指向主目录或备份目录，无法安全迁移。')
      const extra = path.join(backup, 'legacy-data')
      witnesses.set(legacy, copyVerified(legacy, extra))
      merge(extra, path.join(backup, 'source/profile-data/tavern/data'))
      sources.set('profile-data/tavern', path.join(source, 'profile-data/tavern'))
    }
  }
  for (const entry of sources.keys()) {
    const from = path.join(backup, 'source', entry), staged = path.join(backup, 'staged', entry)
    const existed = existsSync(path.join(target, entry))
    if (existed && !configuration.has(entry)) {
      copyVerified(path.join(backup, 'target', entry), staged)
      merge(from, staged)
    } else copyVerified(from, staged)
    journal.items.push({ entry, existed, started: false })
  }
  // No source files are modified; configuration from the selected old home wins.
  beforePublish(journal)
  for (const [from, witness] of witnesses) {
    if (fingerprint(inventory(from)) !== witness) throw Error('源数据发生变化，请退出旧酒馆后重试。')
  }
  journal.phase = 'publishing'; save(journalFile, journal)
  try {
    for (const item of journal.items) {
      const destination = path.join(target, item.entry), previous = path.join(backup, 'previous', item.entry)
      if (fingerprint(inventory(destination)) !== (targets.get(item.entry) ?? fingerprint({}))) throw Error('目标数据发生变化，请退出官方桌面后重试。')
      item.started = true; save(journalFile, journal)
      mkdirSync(path.dirname(destination), { recursive: true })
      if (item.existed) { mkdirSync(path.dirname(previous), { recursive: true }); renameSync(destination, previous) }
      renameSync(path.join(backup, 'staged', item.entry), destination)
    }
    journal.phase = 'completed'; save(journalFile, journal)
    return journal
  } catch (error) { recover(journalFile, journal); throw error }
}
