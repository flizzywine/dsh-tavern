import { resolveBindHost } from './service-address.mjs'
import { readFileSync } from 'node:fs'

export function processStartToken(pid, read = readFileSync) {
  try {
    const stat = read(`/proc/${pid}/stat`, 'utf8')
    // comm may contain spaces and parentheses; starttime is field 22.
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19] || null
  } catch { return null }
}

/**
 * A PID record is only usable while the PID still names the process this
 * installation started. `kill(pid, 0)` alone cannot prove that: it also succeeds
 * for a same-user process that reused the PID, and fails with EPERM for a foreign
 * one. A record written inside a sandbox's temporary PID namespace becomes that
 * second case once the sandbox is gone: the PID then belongs to an unrelated
 * process outside it, often a root-owned one.
 *
 * Linux /proc carries the command line, the startup environment and the start
 * token, so ownership is decided from those once a denied signal (or Android's
 * proot reuse) makes the bare probe doubtful. Without /proc a live but
 * unsignalable PID stays "owned", so callers refuse to force-stop it instead of
 * forgetting the service.
 */
export function inspectRecordedProcess(record, { platform = process.platform, host, home,
  kill = process.kill.bind(process), read = readFileSync } = {}) {
  let denied = false
  try { kill(record.pid, 0) } catch (error) {
    if (error?.code === 'ESRCH') return 'gone'
    if (error?.code !== 'EPERM') return 'unknown'
    denied = true
  }
  if (platform !== 'linux') return 'owned'
  // Android/proot can hand out an unrelated, accessible PID after reuse, so it always
  // compares /proc. Other Linux hosts only need a second opinion when the probe is
  // denied: that is where the PID belongs to another user or to a record left behind
  // by a process that ran in its own PID namespace (a sandbox).
  if (!denied && host !== 'android') return 'owned'
  try {
    const args = read(`/proc/${record.pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    const option = name => {
      const index = args.indexOf(name)
      return index >= 0 ? args[index + 1] : args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1)
    }
    if (option('--profile') !== (record.profile || 'tavern')) return 'foreign'
    if (record.port && option('--port') !== String(record.port)) return 'foreign'
    if (record.bindHost) {
      try { if (resolveBindHost(option('--host')) !== resolveBindHost(record.bindHost)) return 'foreign' } catch { return 'foreign' }
    }
    const env = read(`/proc/${record.pid}/environ`, 'utf8').split('\0')
    const dshHome = env.find(entry => entry.startsWith('DSH_HOME='))?.slice(9)
    if (!dshHome) return 'unknown'
    if (dshHome !== home) return 'foreign'
    if (record.startToken) {
      const current = processStartToken(record.pid, read)
      if (!current) return 'unknown'
      if (current !== record.startToken) return 'foreign'
    }
    return 'owned'
  } catch (error) {
    // A process can exit between kill(0) and reading proc; permission failures
    // are unknown, not proof that the process has exited.
    return error?.code === 'ENOENT' && !denied ? 'gone' : 'unknown'
  }
}
