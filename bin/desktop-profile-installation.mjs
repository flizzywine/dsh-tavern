// Offline profile publication. Every rename is journaled; old directories are retained.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import installationLocation from './installation-location.cjs'
import { beginOriginalBridgeUpdate } from './original-bridge-update.mjs'
import { copyTreeSync, renameWithRetrySync } from './portable-fs.mjs'
import { assertDesktopStopped } from './import-user-home.mjs'

const present = file => { try { lstatSync(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const read = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
const isTavern = doc => doc?.dsh?.profile?.bundles?.includes('dsh-tavern-plugin') || doc?.name === 'dsh-profile-tavern'
const save = (file, value) => { writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file) }
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
function installBridge(dir, sourceRoot) {
  const source = path.join(sourceRoot, 'tavern-plugin/packages/dsh-profile-bridge')
  for (const target of ['vendor/dsh-profile-bridge', 'node_modules/dsh-profile-bridge']) {
    const destination = path.join(dir, target)
    if (present(destination)) renameSync(destination, destination + '.previous-' + randomUUID())
    mkdirSync(path.dirname(destination), { recursive: true })
    copyTreeSync(source, destination)
  }
  const doc = read(dir)
  doc.dependencies = { ...doc.dependencies, 'dsh-profile-bridge': 'file:./vendor/dsh-profile-bridge' }
  doc.dsh.profile.bundles = [...new Set([...doc.dsh.profile.bundles, 'dsh-profile-bridge'])]
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
export function beginDesktopProfileInstallation({ home, sourceRoot, checkStopped = () => assertDesktopStopped([home], { requireGuiClosed: true }), rename = renameSync, retry = {} }) {
  const moveDirectory = (from, to) => renameWithRetrySync(from, to, { ...retry, rename })
  const profiles = path.join(home, 'profiles'), live = path.join(profiles, 'desktop'), tavern = path.join(profiles, 'tavern')
  const interrupted = (() => { try { return JSON.parse(readFileSync(path.join(home, 'profile-bridge', 'install.json'), 'utf8')).phase === 'preparing' } catch { return false } })()
  const linkedToTavern = present(live) && lstatSync(live).isSymbolicLink() && present(tavern) && realpathSync(live) === realpathSync(tavern)
  if (!interrupted && existsSync(path.join(home, 'profile-bridge', 'installation.json'))) {
    const operationFile = path.join(home, 'profile-bridge', 'installation-operation.json')
    if (existsSync(operationFile) && JSON.parse(readFileSync(operationFile, 'utf8')).phase === 'preparing') throw Error('上次安装管理未完成，请先恢复事务与备份。')
    installationLocation.resolveInstallationApp({ dshHome: home })
    // A registered relocation already owns its profile. Rebuilding it through
    // the first-install staging flow would replace its compatibility junction.
    if (!linkedToTavern && (!present(live) || !read(live)?.dsh?.profile?.bundles?.includes('dsh-profile-bridge'))) throw Error('已迁移安装的原版 desktop 配置缺少切换组件，请先恢复备份。')
    return beginOriginalBridgeUpdate({ home, sourceRoot, checkStopped })
  }
  if (!interrupted && (linkedToTavern || (present(live) && !lstatSync(live).isSymbolicLink() && !isTavern(read(live)) && read(live)?.dsh?.profile?.bundles?.includes('dsh-profile-bridge')))) return beginOriginalBridgeUpdate({ home, sourceRoot, checkStopped })
  checkStopped()
  const state = path.join(home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  if (existsSync(path.join(state, 'pending'))) throw Error('有未完成的 profile 切换，请先检查 profile-bridge/pending。')
  const journalFile = path.join(state, 'install.json')
  if (existsSync(journalFile)) {
    const old = JSON.parse(readFileSync(journalFile, 'utf8'))
    if (old.phase === 'preparing') recover(journalFile, old, moveDirectory)
  }
  if (!present(live)) throw Error('请先启动一次官方桌面，再完整退出后安装。')
  const linked = lstatSync(live).isSymbolicLink()
  if (linked && realpathSync(live) !== realpathSync(tavern)) throw Error('desktop 当前链接到其他 profile，请先还原原版 desktop 再安装。')
  if (present(tavern) && lstatSync(tavern).isSymbolicLink()) throw Error('tavern 必须是独立目录，不能是符号链接。')
  const original = originalProfile(home, live, linked)
  const stamp = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID()
  const backup = path.join(home, 'backups', 'profile-bridge-install-' + stamp)
  mkdirSync(backup, { recursive: true })
  const journal = { phase: 'preparing', backup, actions: [] }
  save(journalFile, journal)
  const move = (from, to) => {
    journal.actions.push({ from, to }); save(journalFile, journal)
    moveDirectory(from, to)
  }
  let done = false
  try {
    const desktopStage = path.join(backup, 'prepared-desktop')
    copyTreeSync(original.directory, desktopStage)
    if (original.suffix) for (const file of ['package.json', 'cordis.patch.yml']) writeFileSync(path.join(desktopStage, file), readFileSync(path.join(original.directory, file + original.suffix)))
    installBridge(desktopStage, sourceRoot)
    const legacyDesktop = !linked && isTavern(read(live))
    if (present(tavern)) move(tavern, path.join(backup, 'previous-tavern'))
    const tavernStage = path.join(backup, 'prepared-tavern')
    const seed = legacyDesktop ? live : path.join(backup, 'previous-tavern')
    if (present(seed)) copyTreeSync(seed, tavernStage)
    else mkdirSync(tavernStage)
    move(tavernStage, tavern)
    return {
      backup,
      desktopStage,
      finish() {
        checkStopped()
        // Keep the original profile available for the settings page's restore action.
        const originalDir = path.join(profiles, 'desktop.fresh-' + stamp)
        move(desktopStage, originalDir)
        const link = path.join(profiles, 'desktop.switch-stage-' + stamp)
        journal.actions.push({ type: 'symlink', path: link, target: tavern }); save(journalFile, journal)
        symlinkSync(tavern, link, process.platform === 'win32' ? 'junction' : 'dir')
        move(live, path.join(backup, 'previous-desktop'))
        move(link, live)
      },
      commit() { journal.phase = 'completed'; save(journalFile, journal); done = true },
      rollback() { if (!done) { recover(journalFile, journal, moveDirectory); done = true } },
    }
  } catch (error) { recover(journalFile, journal, moveDirectory); throw error }
}
