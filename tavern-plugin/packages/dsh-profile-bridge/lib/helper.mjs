// Tavern compatibility fork of 2NF/dsh-profile-bridge (MIT).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, lstatSync, renameSync, symlinkSync, unlinkSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function manifest(dir) {
  const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (!Array.isArray(doc?.dsh?.profile?.bundles)) throw new Error('目标 profile 缺少有效的 bundle 列表')
}
const present = path => { try { lstatSync(path); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }

// The caller must own the operation lock and have waited for Desktop and its Host to exit.
export function switchProfile({ mode, profilesRoot, liveDir, targetDir, stamp }, { rename = renameSync, link = symlinkSync } = {}) {
  const root = realpathSync(profilesRoot)
  if (resolve(liveDir) !== join(resolve(profilesRoot), 'desktop')) throw new Error('只允许切换 desktop 入口')
  const linked = present(liveDir) && lstatSync(liveDir).isSymbolicLink()
  let destination
  if (mode === 'link') {
    destination = realpathSync(targetDir)
    if (dirname(destination) !== root || destination === join(root, 'desktop') || /\.fresh-|\.switch-/.test(destination.slice(root.length))) throw new Error('目标必须是 profiles 下的独立 profile')
    manifest(destination)
    if (present(liveDir) && realpathSync(liveDir) === destination) return { changed: false }
  } else if (mode === 'unlink') {
    if (!linked) throw new Error('desktop 不是链接，无需还原')
    destination = readdirSync(profilesRoot).filter(name => name.startsWith('desktop.fresh-')).sort().reverse()
      .map(name => join(profilesRoot, name)).find(dir => { try { return lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() && (manifest(dir), true) } catch { return false } })
    if (!destination) throw new Error('找不到可用的原版 desktop 备份，未修改目录')
  } else throw new Error('未知切换操作')
  if (!present(liveDir)) throw new Error('desktop 入口不存在，未执行切换')
  const previous = join(profilesRoot, linked ? `desktop.switch-${stamp}` : `desktop.fresh-${stamp}`)
  const staged = join(profilesRoot, `desktop.switch-stage-${stamp}`)
  if (present(previous) || present(staged)) throw new Error('备份路径已存在')
  if (mode === 'link') link(destination, staged, process.platform === 'win32' ? 'junction' : 'dir')
  let moved = false
  try {
    rename(liveDir, previous)
    moved = true
    rename(mode === 'link' ? staged : destination, liveDir)
  } catch (error) {
    if (moved) {
      try { rename(previous, liveDir) } catch (rollback) { throw new Error(`切换失败且自动恢复失败；原入口保存在 ${previous}：${rollback.message}`, { cause: error }) }
    }
    throw error
  } finally {
    if (present(staged) && lstatSync(staged).isSymbolicLink()) unlinkSync(staged)
  }
  if (linked) unlinkSync(previous) // remove only the saved link, never its target
  return { changed: true, target: realpathSync(liveDir), backup: linked ? undefined : previous }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' }
}
export async function waitForExit(pids, { timeout = 120000, alive = processAlive, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeout
  while (pids.some(alive)) {
    if (Date.now() >= deadline) throw new Error('等待桌面退出超时，未修改 profile；请正常退出后重试')
    await delay(250)
  }
}

// Lock is acquired before responding, so repeated clicks cannot schedule competing switches.
export function scheduleSwitch(request) {
  mkdirSync(request.stateDir, { recursive: true })
  const lock = join(request.stateDir, 'pending')
  mkdirSync(lock)
  const job = join(lock, 'request.json')
  const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
  try {
    writeFileSync(job, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
    const child = spawn(process.execPath, [worker, job], { detached: true, stdio: 'ignore', cwd: request.stateDir, env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } })
    child.on('error', () => { /* request stays on disk for diagnosis; no profile was changed */ })
    child.unref()
    return { pid: child.pid, logPath: join(request.stateDir, 'last-run.log') }
  } catch (error) {
    throw new Error(`无法启动切换助手，待处理记录位于 ${lock}：${error.message}`)
  }
}
