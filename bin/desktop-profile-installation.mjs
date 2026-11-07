// Offline profile publication. Every rename is journaled; old directories are retained.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import installationLocation from './installation-location.cjs'
import { beginOriginalBridgeUpdate } from './original-bridge-update.mjs'
import { copyTreeSync, renameWithRetrySync } from './portable-fs.mjs'
import { assertDesktopStopped } from './import-user-home.mjs'
import { assertLauncherSlotAvailable, hasBridge, hasNextTavern, LAUNCHER_BUNDLE, launcherBundles } from '../tavern-plugin/packages/dsh-tavern/lib/state.mjs'

const present = file => { try { lstatSync(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const read = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
const isTavern = doc => doc?.dsh?.profile?.bundles?.includes('dsh-tavern-plugin') || doc?.name === 'dsh-profile-tavern'
const save = (file, value) => { writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file) }
// A completed removal leaves an "uninstalled" marker so the desktop still reports
// the app as removed. Once a new install publishes its profile, clear that marker
// from every commit path; the record's retained directories stay on disk.
export function clearUninstalledInstallationRecord(home) {
  const registryFile = path.join(home, 'profile-bridge', 'installation.json')
  try {
    if (!present(registryFile)) return true
    const record = JSON.parse(readFileSync(registryFile, 'utf8'))
    if (record?.phase !== 'uninstalled') return true
    // Check the management journal and data alias before clearing the removal
    // marker. Keep ownership of external data after the app/profile are rebuilt.
    installationLocation.resolveInstallationApp({ dshHome: home })
    const data = installationLocation.resolveInstallationData({ dshHome: home, dataDir: record.dataDir })
    if (data) {
      const temporary = registryFile + '.' + randomUUID() + '.tmp'
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, phase: 'completed', layout: 'retained-data', entries: [data], retained: record.retained || [] }), { flag: 'wx' })
      renameSync(temporary, registryFile)
    } else unlinkSync(registryFile)
    return true
  } catch { return false }
}
function originalProfile(home, live, linked) {
  if (!linked && !isTavern(read(live))) return { directory: live }
  const profiles = path.join(home, 'profiles')
  const candidates = readdirSync(profiles).filter(n => n.startsWith('desktop.fresh-')).sort().reverse().map(n => path.join(profiles, n))
  const backups = path.join(home, 'backups')
  if (existsSync(backups)) for (const n of readdirSync(backups).sort().reverse()) candidates.push(path.join(backups, n, 'profiles', 'desktop'))
  for (const directory of candidates) {
    try { if (!isTavern(read(directory)) && Array.isArray(read(directory).dsh?.profile?.bundles)) return { directory } } catch {}
  }
  // Older installers preserved individual configuration files next to desktop.
  if (!linked) for (const name of readdirSync(live).filter(n => n.startsWith('package.json.backup.')).sort()) {
    const doc = JSON.parse(readFileSync(path.join(live, name), 'utf8'))
    const suffix = name.slice('package.json'.length)
    if (!isTavern(doc) && Array.isArray(doc.dsh?.profile?.bundles) && existsSync(path.join(live, 'cordis.patch.yml' + suffix))) return { directory: live, suffix }
  }
  throw Error('找不到可恢复的原版 desktop 配置，未修改 profile。请先恢复原版 desktop 备份后重试；现有酒馆和存档保持不变。')
}
function installBridge(dir, sourceRoot, replaceNext) {
  const doc = read(dir)
  assertLauncherSlotAvailable(doc, dir, { replaceNext })
  const previousLaunchers = new Set([...launcherBundles(doc, dir, 'desktop'), ...launcherBundles(doc, dir, 'next')])
  const source = path.join(sourceRoot, 'tavern-plugin/packages/dsh-tavern')
  for (const target of [`vendor/${LAUNCHER_BUNDLE}`, `node_modules/${LAUNCHER_BUNDLE}`]) {
    const destination = path.join(dir, target)
    if (present(destination)) renameSync(destination, destination + '.previous-' + randomUUID())
    mkdirSync(path.dirname(destination), { recursive: true })
    copyTreeSync(source, destination)
  }
  doc.dependencies = { ...doc.dependencies }
  for (const name of previousLaunchers) delete doc.dependencies[name]
  doc.dependencies[LAUNCHER_BUNDLE] = `file:./vendor/${LAUNCHER_BUNDLE}`
  doc.dsh.profile.bundles = [...new Set([...doc.dsh.profile.bundles.filter(name => !previousLaunchers.has(name)), LAUNCHER_BUNDLE])]
  save(path.join(dir, 'package.json'), doc)
}
function recover(journalFile, journal, rename) {
  for (const action of [...journal.actions].reverse()) {
    if (action.reverted) continue
    if (action.type === 'symlink') {
      if (present(action.path)) {
        // Inspect the link itself: its target may already be absent. Never remove
        // a replacement directory or a link that belongs to another operation.
        if (!lstatSync(action.path).isSymbolicLink()
          || path.toNamespacedPath(path.resolve(path.dirname(action.path), readlinkSync(action.path))) !== path.toNamespacedPath(path.resolve(action.target))) throw Error(`恢复路径冲突，请保留备份并人工检查：${journalFile}`)
        unlinkSync(action.path)
      }
    } else if (present(action.to)) {
      if (present(action.from)) throw Error(`恢复路径冲突，请保留备份并人工检查：${journalFile}`)
      rename(action.to, action.from)
    }
    action.reverted = true; save(journalFile, journal)
  }
  journal.phase = 'rolled-back'; save(journalFile, journal)
}
// Existing installs retain their independent original profile and refresh only its
// bridge. Tavern-active updates need no Desktop shutdown or profile replacement.
export function beginDesktopProfileInstallation({ home, sourceRoot, host = 'desktop', guiRoot, preparingForPid, launcherGate, checkStopped = (allowedPid) => assertDesktopStopped([home], { requireGuiClosed: true, guiRoot, preparingForPid: allowedPid }), rename = renameSync, retry = {} }) {
  const moveDirectory = (from, to) => renameWithRetrySync(from, to, { ...retry, rename })
  const profiles = path.join(home, 'profiles'), live = path.join(profiles, 'desktop'), tavern = path.join(profiles, 'tavern')
  let replacesNext = hasNextTavern(home)
  const interrupted = (() => { try { return JSON.parse(readFileSync(path.join(home, 'profile-bridge', 'install.json'), 'utf8')).phase === 'preparing' } catch { return false } })()
  const linkedToTavern = present(live) && lstatSync(live).isSymbolicLink() && present(tavern) && realpathSync(live) === realpathSync(tavern)
  const registryFile = path.join(home, 'profile-bridge', 'installation.json')
  const hasInstallationRecord = present(registryFile)
  const installationRecord = (() => {
    try {
      return JSON.parse(readFileSync(registryFile, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw Error(`安装位置记录不可读，请先恢复安装管理记录与备份：${error.message}`)
    }
  })()
  const uninstalled = installationRecord?.schemaVersion === 1 && installationRecord.phase === 'uninstalled'
  const completed = installationRecord?.schemaVersion === 1 && installationRecord.phase === 'completed' && Array.isArray(installationRecord.entries)
  const retainedData = completed && installationRecord.layout === 'retained-data'
  const relocated = completed && installationRecord.layout === undefined
  if (preparingForPid && (interrupted || relocated || !present(live) || !lstatSync(live).isDirectory()
      || !hasBridge(read(live), live) || isTavern(read(live)) || (present(tavern) && !replacesNext))) {
    throw Error('当前配置无法在桌面打开时准备安装，请先退出桌面再运行安装器。')
  }
  // Only a completed relocation may own the profile. An uninstalled marker means
  // this is a fresh install; any other or damaged registry must not silently fall
  // through and overwrite an installation whose state has not been recovered.
  if (!interrupted && hasInstallationRecord && !uninstalled && !relocated && !retainedData) throw Error('安装位置记录状态异常，请先恢复安装管理记录与备份。')
  if (!interrupted && relocated) {
    const operationFile = path.join(home, 'profile-bridge', 'installation-operation.json')
    if (existsSync(operationFile) && JSON.parse(readFileSync(operationFile, 'utf8')).phase === 'preparing') throw Error('上次安装管理未完成，请先恢复事务与备份。')
    installationLocation.resolveInstallationApp({ dshHome: home })
    // A registered relocation already owns its profile. Rebuilding it through
    // the first-install staging flow would replace its compatibility junction.
    if (!linkedToTavern && (!present(live) || !hasBridge(read(live), live))) throw Error('已迁移安装的原版 desktop 配置缺少切换组件，请先恢复备份。')
    return beginOriginalBridgeUpdate({ home, sourceRoot, checkStopped, launcherGate })
  }
  const originalReady = !interrupted && !replacesNext && !linkedToTavern && present(tavern) && present(live)
    && lstatSync(live).isDirectory() && !isTavern(read(live)) && hasBridge(read(live), live)
  const replaceOldLauncher = host === 'next' && originalReady && (
    !launcherBundles(read(live), live, 'desktop').includes(LAUNCHER_BUNDLE)
    || launcherBundles(read(live), live, 'next').length > 0
  )
  if (!interrupted && !replacesNext && !replaceOldLauncher && (linkedToTavern || originalReady)) return beginOriginalBridgeUpdate({ home, sourceRoot, checkStopped, launcherGate })
  // Direct reinstalls must keep unfinished removal/relocation transactions fenced.
  installationLocation.resolveInstallationApp({ dshHome: home })
  checkStopped(preparingForPid)
  const state = path.join(home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  if (existsSync(path.join(state, 'pending'))) throw Error('有未完成的 profile 切换，请先检查 profile-bridge/pending。')
  const journalFile = path.join(state, 'install.json')
  if (existsSync(journalFile)) {
    const old = JSON.parse(readFileSync(journalFile, 'utf8'))
    if (old.phase === 'preparing') {
      recover(journalFile, old, moveDirectory)
      replacesNext = hasNextTavern(home)
    }
  }
  if (!present(live)) throw Error('请先启动一次官方桌面，再完整退出后安装。')
  const linked = lstatSync(live).isSymbolicLink()
  if (linked && realpathSync(live) !== realpathSync(tavern)) throw Error('desktop 当前链接到其他 profile，请先还原原版 desktop 再安装。')
  if (present(tavern) && lstatSync(tavern).isSymbolicLink()) throw Error('tavern 必须是独立目录，不能是符号链接。')
  const original = originalProfile(home, live, linked)
  const stamp = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID()
  const backup = path.join(home, 'backups', 'profile-bridge-install-' + stamp)
  mkdirSync(backup, { recursive: true })
  const receipt = path.join(home, 'logs/tavern-installation.json')
  if (replacesNext && present(receipt)) copyFileSync(receipt, path.join(backup, 'previous-tavern-installation.json'))
  const journal = { phase: 'preparing', backup, actions: [] }
  save(journalFile, journal)
  const move = (from, to) => {
    journal.actions.push({ from, to }); save(journalFile, journal)
    moveDirectory(from, to)
  }
  let done = false
  try {
    const desktopStage = preparingForPid ? live : path.join(backup, 'prepared-desktop')
    if (!preparingForPid) {
      copyTreeSync(original.directory, desktopStage)
      if (original.suffix) for (const file of ['package.json', 'cordis.patch.yml']) writeFileSync(path.join(desktopStage, file), readFileSync(path.join(original.directory, file + original.suffix)))
      installBridge(desktopStage, sourceRoot, replacesNext || host === 'next')
    }
    const legacyDesktop = !linked && isTavern(read(live))
    if (present(tavern)) move(tavern, path.join(backup, 'previous-tavern'))
    const tavernStage = path.join(backup, 'prepared-tavern')
    const seed = legacyDesktop ? live : path.join(backup, 'previous-tavern')
    if (seed && present(seed)) copyTreeSync(seed, tavernStage)
    else mkdirSync(tavernStage)
    move(tavernStage, tavern)
    return {
      backup,
      desktopStage,
      finish() {
        // Windows can briefly retain Desktop processes after closing the window.
        for (let attempt = 0; ; attempt++) {
          try {
            checkStopped()
            break
          } catch (error) {
            if (error.code !== 'DSH_DESKTOP_RUNNING' || attempt >= 4) throw error
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
          }
        }
        // Installing Tavern never selects it as the default. The in-app path
        // already uses the live original profile; preserve edits made while
        // downloading. Offline installs publish the prepared original instead.
        if (!preparingForPid) {
          move(live, path.join(backup, 'previous-desktop'))
          move(desktopStage, live)
        }
      },
      commit() {
        journal.phase = 'completed'; save(journalFile, journal); done = true
        clearUninstalledInstallationRecord(home)
      },
      rollback() { if (!done) { recover(journalFile, journal, moveDirectory); done = true } },
    }
  } catch (error) { recover(journalFile, journal, moveDirectory); throw error }
}
