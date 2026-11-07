// Update only the independent bridge owned by the original Desktop profile.
// The install lease is held by profile-installation; the pending slot also fences
// profile switches for the entire staging/validation/receipt transaction.
import { lstatSync, realpathSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyTreeSync } from './portable-fs.mjs'
import installationLocation from './installation-location.cjs'
import { assertDesktopStopped } from './import-user-home.mjs'
import { acquirePendingLock, installPublishGate, processAlive, readLastResult } from '../tavern-plugin/packages/dsh-tavern/lib/helper.mjs'
import { launcherBundle, LAUNCHER_BUNDLE } from '../tavern-plugin/packages/dsh-tavern/lib/state.mjs'

const present = file => { try { lstatSync(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
const read = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const unsafe = message => Object.assign(Error(message), { unsafeToRetry: true })
function ordinary(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    if (present(current) && (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())) throw Error(`切换组件目录不能经过链接：${current}`)
    if (current === path.dirname(current)) break
  }
}
function plainTree(directory) {
  const stat = lstatSync(directory)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error(`切换组件源包含非独立文件：${directory}`)
  if (stat.isDirectory()) for (const name of readdirSync(directory)) plainTree(path.join(directory, name))
}
function moveWithRetry(from, to, rename) {
  const deadline = Date.now() + 10000
  for (;;) {
    try { rename(from, to); return } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || Date.now() >= deadline) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}
function holdProfileSwitches(state, launcherGate, trusted) {
  const gate = installPublishGate(state)
  if (launcherGate && same(trusted.map(launcherGate), gate)) {
    // The launcher keeps this lock until the installer exits, including rollback.
    // Borrow its fence once it has explicitly allowed publication.
    const lock = path.dirname(path.dirname(gate))
    const jobFile = path.join(lock, 'request.json')
    const workerFile = path.join(lock, 'worker.json')
    for (const file of [gate, jobFile, workerFile, path.join(state, 'last-result.json')]) {
      ordinary(path.dirname(file))
      if (!lstatSync(file).isFile()) throw Error(`NEXT 更新记录不是普通文件：${file}`)
    }
    const request = JSON.parse(readFileSync(jobFile, 'utf8'))
    const worker = JSON.parse(readFileSync(workerFile, 'utf8'))
    const result = readLastResult(state)
    if (request.mode !== 'install' || request.host !== 'next' || request.stamp !== result?.stamp
        || result?.status !== 'pending' || result.mode !== 'install' || !processAlive(worker.pid) || readFileSync(gate, 'utf8') !== 'publish'
        || present(path.join(state, 'pending'))) throw Error('NEXT 更新尚未获得发布许可，请刷新后重试。')
    return () => {}
  }
  const { lock } = acquirePendingLock(state)
  // A live PID prevents the switch helper from reclaiming a long-running install.
  try { writeFileSync(path.join(lock, 'worker.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx' }) }
  catch (error) { rmdirSync(lock); throw error }
  return () => { unlinkSync(path.join(lock, 'worker.json')); rmdirSync(lock) }
}
export function beginOriginalBridgeUpdate({ home, sourceRoot, launcherGate, checkStopped = () => assertDesktopStopped([home], { requireGuiClosed: true }), copy = copyTreeSync, rename = renameSync }) {
  // Trust only configured-home ancestors, never a redirect inside managed DSH.
  // Pin filesystem work to that physical identity for the whole transaction.
  const trusted = installationLocation.trustedHome(home)
  home = trusted.physical
  sourceRoot = trusted.map(path.resolve(sourceRoot))
  const profiles = path.join(home, 'profiles'), live = path.join(profiles, 'desktop')
  const state = path.join(home, 'profile-bridge'), journalFile = path.join(state, 'bridge-update.json')
  ordinary(profiles); ordinary(state)
  if (present(journalFile)) {
    if (lstatSync(journalFile).isSymbolicLink()) throw unsafe('切换组件事务记录不能是链接。')
    const previous = JSON.parse(readFileSync(journalFile, 'utf8'))
    if (previous.schemaVersion !== 1 || !['completed', 'rolled-back'].includes(previous.phase)) throw unsafe(`切换组件更新尚未恢复，请保留备份并检查：${journalFile}`)
  }
  installationLocation.resolveInstallationApp({ dshHome: trusted.logical })
  // A completed relocation legitimately links profiles/tavern outside the tree.
  // An "uninstalled" marker is not a relocation: keep the ordinary-path check so
  // a leftover link cannot qualify as an already bridged installation.
  const relocated = (() => {
    try {
      const record = JSON.parse(readFileSync(path.join(state, 'installation.json'), 'utf8'))
      return record?.schemaVersion === 1 && record.phase === 'completed' && record.layout === undefined && Array.isArray(record.entries)
    } catch { return false }
  })()
  if (!relocated) ordinary(path.join(profiles, 'tavern'))
  const managementFile = path.join(state, 'installation-operation.json')
  const previousManagement = present(managementFile) ? readFileSync(managementFile, 'utf8') : null
  const release = holdProfileSwitches(state, launcherGate, trusted)
  let journal, done = false, managementFenced = false
  const writeManagement = value => {
    const temporary = managementFile + '.' + randomUUID() + '.tmp'
    writeFileSync(temporary, value, { flag: 'wx' }); renameSync(temporary, managementFile)
  }
  const restoreManagement = () => {
    if (!managementFenced) return
    const current = JSON.parse(readFileSync(managementFile, 'utf8'))
    if (current.bridgeUpdateId !== path.basename(journal.backup)) throw Error('安装管理事务所有者已改变，未覆盖记录。')
    if (previousManagement === null) unlinkSync(managementFile)
    else writeManagement(previousManagement)
    managementFenced = false
  }
  const save = () => {
    const temporary = journalFile + '.' + randomUUID() + '.tmp'
    writeFileSync(temporary, JSON.stringify(journal, null, 2), { flag: 'wx' }); renameSync(temporary, journalFile)
  }
  const rollback = () => {
    if (done) return
    try {
      if (journal) {
        // commit cleanup can fail after writing completed. Re-fence before any
        // reverse move so a crash can never expose a half-rolled-back pair as
        // a successful receipt (including to an older in-memory helper).
        journal.phase = 'preparing'; save()
        if (journal.actions.length && !managementFenced) {
          const current = present(managementFile) ? readFileSync(managementFile, 'utf8') : null
          if (current !== previousManagement) throw Error('安装管理事务所有者已改变，未覆盖记录。')
          writeManagement(JSON.stringify({ schemaVersion: 1, phase: 'preparing', mode: 'bridge-update', bridgeUpdateId: path.basename(journal.backup) }))
          managementFenced = true
        }
      }
      for (const action of [...(journal?.actions || [])].reverse()) {
        if (action.reverted) continue
        if (present(action.to)) {
          if (present(action.from)) throw Error(`恢复路径冲突：${action.from}`)
          moveWithRetry(action.to, action.from, rename)
        }
        action.reverted = true; save()
      }
      for (const parent of [...(journal?.createdParents || [])].reverse()) {
        if (present(parent)) rmdirSync(parent)
      }
      restoreManagement()
      if (journal) { journal.phase = 'rolled-back'; save() }
      release(); done = true
    } catch (error) { throw unsafe(`切换组件自动恢复失败，请勿启动桌面或切换；保留 ${journalFile} 与备份：${error.message}`) }
  }
  try {
    const linked = lstatSync(live).isSymbolicLink()
    let original = live
    if (linked) {
      if (!same(realpathSync(live), realpathSync(path.join(profiles, 'tavern')))) throw Error('desktop 当前链接到其他 profile，未更新切换组件。')
      // Match switchProfile(unlink) exactly: never update historical backups or
      // a different candidate from the one the restore button will actually use.
      original = readdirSync(profiles).filter(name => name.startsWith('desktop.fresh-')).sort().reverse()
        .map(name => path.join(profiles, name)).find(dir => {
          try { return lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() && Array.isArray(read(dir)?.dsh?.profile?.bundles) } catch { return false }
        })
      if (!original) throw Error('找不到可恢复的原版 desktop 配置，未更新切换组件。')
    } else checkStopped()
    ordinary(original)
    const manifest = read(original)
    const bundle = launcherBundle(manifest, original)
    if (!bundle || manifest.dsh.profile.bundles.includes('dsh-tavern-plugin') || manifest.name === 'dsh-profile-tavern') throw Error('原版 desktop 配置缺少切换组件，请先恢复备份。')
    const source = path.join(sourceRoot, 'tavern-plugin/packages/dsh-tavern')
    plainTree(source)
    if (read(source).name !== LAUNCHER_BUNDLE) throw Error('切换组件源不完整。')
    const backup = path.join(state, 'bridge-update-' + randomUUID())
    mkdirSync(backup)
    const targets = ['vendor', 'node_modules'].map(name => {
      const parent = path.join(original, name)
      ordinary(parent)
      return path.join(parent, bundle)
    })
    journal = { schemaVersion: 1, phase: 'preparing', original, backup, actions: [], createdParents: [], previousManagement }; save()
    for (let i = 0; i < targets.length; i++) {
      const prepared = path.join(backup, 'prepared-' + i)
      copy(source, prepared)
      // Keep the original manifest and pnpm lockfile valid on older installs.
      // Refresh their launcher under the name the profile already resolves.
      if (bundle !== LAUNCHER_BUNDLE) {
        for (const [file, entry] of [
          ['package.json', `"name": "${LAUNCHER_BUNDLE}"`],
          ['cordis.patch.yml', `name: '${LAUNCHER_BUNDLE}'`],
          ['client.js', `id: '${LAUNCHER_BUNDLE}'`],
        ]) {
          const target = path.join(prepared, file)
          const contents = readFileSync(target, 'utf8')
          if (!contents.includes(entry)) throw Error(`切换组件源缺少入口：${file}`)
          writeFileSync(target, contents.replace(entry, entry.replace(LAUNCHER_BUNDLE, bundle)))
        }
      }
    }
    const move = (from, to) => {
      journal.actions.push({ from, to }); save()
      moveWithRetry(from, to, rename)
    }
    let finished = false
    return {
      refreshOnly: true, bridgeUpdateId: path.basename(backup), backup, desktopStage: original,
      finish() {
        if (done || finished) return
        try {
          if (!linked) checkStopped()
          // The already-running Host may still have the previous helper loaded.
          // Fence crashes through its existing management-journal check too.
          writeManagement(JSON.stringify({ schemaVersion: 1, phase: 'preparing', mode: 'bridge-update', bridgeUpdateId: path.basename(backup) }))
          managementFenced = true
          for (let i = 0; i < targets.length; i++) {
            const parent = path.dirname(targets[i])
            if (!present(parent)) { journal.createdParents.push(parent); save(); mkdirSync(parent) }
            if (present(targets[i])) move(targets[i], path.join(backup, 'previous-' + i))
            move(path.join(backup, 'prepared-' + i), targets[i])
          }
          finished = true
        } catch (error) { rollback(); throw error }
      },
      commit() {
        if (done) return
        if (!finished) throw Error('切换组件尚未发布，不能确认安装。')
        journal.phase = 'completed'; save(); restoreManagement(); release(); done = true
      },
      rollback,
    }
  } catch (error) { rollback(); throw error }
}
