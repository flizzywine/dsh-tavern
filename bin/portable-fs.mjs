// Recursive copy/remove built only on libuv primitives. Node's native fs.cpSync
// and recursive fs.rmSync mishandle non-ASCII Windows paths (e.g. a Chinese user
// name): cpSync fails or crashes, rmSync silently deletes nothing. Fixed upstream
// only in late Node 24 releases (nodejs/node#61878, #56049); installers must not
// depend on the user's Node being new enough.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

// Windows scanners and closing applications can briefly retain directory handles.
// Each move (including rollback) gets its own bounded retry budget.
export function renameWithRetrySync(from, to, {
  rename = renameSync, platform = process.platform, timeout = 10000,
  interval = 100, now = Date.now, delay = sleep,
} = {}) {
  const deadline = now() + timeout
  for (;;) {
    try { return rename(from, to) } catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      if (now() >= deadline) {
        error.message = `无法移动配置目录 ${from} → ${to}（${error.code}）：目录可能被占用或没有访问权限。请完整退出 DeepSeek Harness（含托盘），关闭使用该目录的终端、资源管理器或编辑器，检查目录权限后重新运行安装；请勿手动删除配置或备份。原始错误：${error.message}`
        throw error
      }
      delay(Math.min(interval, Math.max(0, deadline - now())))
    }
  }
}

export function copyTreeSync(from, to, { dereference = false } = {}) {
  const stat = dereference ? statSync(from) : lstatSync(from)
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(from)
    if (process.platform !== 'win32') symlinkSync(target, to)
    // Windows links carry a file/directory type. Never infer it from whether the target exists
    // now: a relative link copied out of a moved tree dangles at copy time, Node then makes a
    // *file* symlink, and once the tree is back in place Windows refuses to traverse it (realpath
    // EPERM; the desktop host dies at startup). Only an existing file target makes a file link.
    else if (targetStat(path.resolve(path.dirname(from), target))?.isFile()) symlinkSync(target, to, 'file')
    // Absolute directory links become junctions: a directory symlink needs admin or Developer Mode.
    else if (path.isAbsolute(target)) symlinkSync(target, to, 'junction')
    else {
      // A relative directory symlink only exists where symlinks are allowed; keep it relative.
      try { symlinkSync(target, to, 'dir') } catch (error) {
        if (error.code !== 'EPERM') throw error
        symlinkSync(path.resolve(path.dirname(to), target), to, 'junction')
      }
    }
  } else if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copyTreeSync(path.join(from, name), path.join(to, name), { dereference })
  } else {
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
}

const targetStat = file => { try { return statSync(file) } catch { return undefined } }

// Heals node_modules links that point at a directory but cannot be traversed: Windows file
// symlinks written by the old copyTreeSync above. Each is replaced by a junction to the same
// directory. Scans one node_modules level plus its @scope folders; returns the repaired links.
export function repairDirectoryLinksSync(nodeModules, { platform = process.platform } = {}) {
  const repaired = []
  if (platform !== 'win32') return repaired
  const visit = directory => {
    let names
    try { names = readdirSync(directory) } catch { return }
    for (const name of names) {
      const link = path.join(directory, name)
      let stat
      try { stat = lstatSync(link) } catch { continue }
      if (name.startsWith('@') && stat.isDirectory()) { visit(link); continue }
      if (!stat.isSymbolicLink()) continue
      const target = path.resolve(directory, readlinkSync(link))
      if (!targetStat(target)?.isDirectory()) continue
      try { realpathSync(link); readdirSync(link); continue } catch {}
      try { unlinkSync(link) } catch { rmdirSync(link) }
      symlinkSync(target, link, 'junction')
      repaired.push(link)
    }
  }
  visit(nodeModules)
  return repaired
}

// Like rmSync(target, { recursive: true, force: true }); links are removed, never followed.
// Windows may briefly hold handles (antivirus, indexer), so busy entries are retried.
export function removeTreeSync(target, { retries = 0, retryDelay = 100 } = {}) {
  let stat
  try { stat = lstatSync(target) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (stat.isDirectory()) for (const name of readdirSync(target)) removeTreeSync(path.join(target, name), { retries, retryDelay })
  for (let attempt = 0; ; attempt++) {
    try {
      if (!stat.isDirectory()) unlinkSync(target)
      else rmdirSync(target)
      return
    } catch (error) {
      if (error.code === 'ENOENT') return
      // Windows directory symlinks and junctions are unlinked with rmdir.
      if (stat.isSymbolicLink() && ['EPERM', 'EISDIR'].includes(error.code)) { try { rmdirSync(target); return } catch {} }
      if (attempt >= retries || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
      sleep(retryDelay)
    }
  }
}
