import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createProfileDataStore } from './profile-data-store.js'

const STATUS_FILE = 'update-status.json'
const RELEASE_FILE = '.dsh-tavern-release.json'
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000
const VERSION_URL = 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/package.json'
const COMMIT_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/commits/main'

export function sanitizeUpdateError(value) {
  const message = String(value || '').trim()
  const replacements = (message.match(/\uFFFD/g) || []).length
  if (replacements >= 2) return '更新失败：安装程序输出编码异常。建议重新安装一次。'
  return message || '更新失败，请重新安装一次。'
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '').split('-', 1)[0].split('.').map(Number)
  const a = parse(left)
  const b = parse(right)
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return String(left) === String(right) ? 0 : 1
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function installHostOf(manifest) {
  const host = manifest?.dshTavern?.host
  return host === 'desktop' || host === 'android' ? host : 'cli'
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readRecordedCommit(sourceRoot, dshHome) {
  try {
    const content = await readFile(path.join(sourceRoot, RELEASE_FILE), 'utf8')
    const commit = String(JSON.parse(content.replace(/^\uFEFF/, ''))?.commit || '')
    if (/^[0-9a-f]{40}$/i.test(commit)) return commit
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const gitRoot = path.join(sourceRoot, '.git')
    const head = (await readFile(path.join(gitRoot, 'HEAD'), 'utf8')).trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const reference = head.match(/^ref:\s+(.+)$/)?.[1]
    if (reference) {
      try {
        const commit = (await readFile(path.join(gitRoot, reference), 'utf8')).trim()
        if (/^[0-9a-f]{40}$/i.test(commit)) return commit
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const packed = await readFile(path.join(gitRoot, 'packed-refs'), 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error))
      const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const commit = packed.match(new RegExp(`^([0-9a-f]{40}) ${escaped}$`, 'mi'))?.[1] || ''
      if (commit) return commit
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const content = await readFile(path.join(dshHome, 'source-cache', 'dsh-tavern.git', 'FETCH_HEAD'), 'utf8')
    const commit = String(content.match(/^[0-9a-f]{40}/i)?.[0] || '')
    if (commit) return commit
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return ''
}

export function createApplicationUpdater(options) {
  const dataRoot = path.resolve(options.dataRoot)
  const sourceRoot = path.resolve(options.sourceRoot)
  const dshHome = path.resolve(options.dshHome || path.join(dataRoot, '../../..'))
  const profileManifest = path.join(dshHome, 'profiles', 'tavern', 'package.json')
  const execPath = options.execPath || process.execPath
  const platform = options.platform || process.platform
  const runtimeHost = options.runtimeHost || process.env.DSH_TAVERN_RUNTIME_HOST
  const spawnProcess = options.spawnProcess || spawn
  const now = typeof options.now === 'function' ? options.now : Date.now
  const isProcessAlive = typeof options.isProcessAlive === 'function' ? options.isProcessAlive : processIsAlive
  const fetchManifest = options.fetchManifest || async function () {
    const response = await fetch(options.versionUrl || process.env.DSH_TAVERN_VERSION_URL || VERSION_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const fetchLatestCommit = options.fetchLatestCommit || async function () {
    const response = await fetch(options.commitUrl || process.env.DSH_TAVERN_COMMIT_URL || COMMIT_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return String((await response.json())?.sha || '')
  }
  const store = createProfileDataStore({ dataRoot })

  async function versions() {
    let local
    try {
      local = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return { currentVersion: 'unknown', latestVersion: 'unknown', currentCommit: '', latestCommit: '', updateAvailable: true }
      throw error
    }
    const [remote, latestCommit] = await Promise.all([fetchManifest(), fetchLatestCommit()])
    const currentVersion = String(local?.version || '')
    const latestVersion = String(remote?.version || '')
    if (currentVersion === '' || latestVersion === '') throw new Error('版本信息不完整')
    if (!/^[0-9a-f]{40}$/i.test(latestCommit)) throw new Error('GitHub 返回的提交号无效')
    const currentCommit = await readRecordedCommit(sourceRoot, dshHome)
    const versionAhead = compareVersions(latestVersion, currentVersion) > 0
    return {
      currentVersion,
      latestVersion,
      currentCommit,
      latestCommit,
      // An installation without commit metadata updates once to establish its baseline.
      updateAvailable: versionAhead || currentCommit.toLowerCase() !== latestCommit.toLowerCase(),
    }
  }

  async function host() {
    if (runtimeHost === 'cli' || runtimeHost === 'desktop' || runtimeHost === 'android') return runtimeHost
    try {
      return installHostOf(JSON.parse(await readFile(profileManifest, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return process.versions.electron ? 'desktop' : 'cli'
      throw error
    }
  }

  async function status() {
    const current = await store.readJson(STATUS_FILE)
    if (current !== undefined) {
      const checkedAt = now()
      const updatePid = Number(current.pid)
      const stopped = Number.isInteger(updatePid) && updatePid > 0 && !isProcessAlive(updatePid)
      if (current.phase === 'running' && (stopped || checkedAt - Number(current.startedAt || 0) >= RUNNING_TIMEOUT_MS)) {
        const interrupted = {
          phase: 'failed',
          host: installHostOf({ dshTavern: { host: current.host } }),
          failedAt: checkedAt,
          error: '上次更新已中断',
        }
        await store.writeJson(STATUS_FILE, interrupted)
        return interrupted
      }
      if (current.phase === 'failed') {
        const error = sanitizeUpdateError(current.error)
        if (error !== current.error) {
          const readable = { ...current, error }
          await store.writeJson(STATUS_FILE, readable)
          return readable
        }
      }
      return current
    }
    return { phase: 'idle', host: await host() }
  }

  async function start() {
    const current = await status()
    if (current.phase === 'running' && now() - Number(current.startedAt || 0) < RUNNING_TIMEOUT_MS) {
      throw new Error('更新正在进行，请勿重复启动')
    }
    const installHost = await host()
    let version
    try {
      version = await versions()
    } catch (error) {
      const failed = { phase: 'failed', host: installHost, failedAt: now(), error: `无法检查最新版，尚未开始下载：${sanitizeUpdateError(error?.message || error)}` }
      await store.writeJson(STATUS_FILE, failed)
      throw new Error(failed.error)
    }
    if (!version.updateAvailable) {
      const upToDate = {
        phase: 'up-to-date', host: installHost, checkedAt: now(),
        currentVersion: version.currentVersion, latestVersion: version.latestVersion,
        currentCommit: version.currentCommit, latestCommit: version.latestCommit,
      }
      await store.writeJson(STATUS_FILE, upToDate)
      return upToDate
    }
    const running = {
      phase: 'running', host: installHost, startedAt: now(),
      ...(version.currentVersion === 'unknown' ? {} : {
        currentVersion: version.currentVersion, latestVersion: version.latestVersion,
        currentCommit: version.currentCommit, latestCommit: version.latestCommit,
      }),
    }
    await store.writeJson(STATUS_FILE, running)
    const statusFile = path.join(dataRoot, STATUS_FILE)
    const updaterArgs = [
      path.join(sourceRoot, 'bin', 'dsh-tavern.mjs'),
      'update',
      '--host', installHost,
      '--status-file', statusFile,
      '--delay=800',
      ...(version.latestCommit ? ['--target-commit', version.latestCommit] : []),
    ]
    const args = platform === 'win32'
      ? [path.join(sourceRoot, 'bin', 'dsh-tavern-update-helper.mjs'), execPath, ...updaterArgs]
      : updaterArgs
    try {
      const child = spawnProcess(execPath, args, {
        cwd: sourceRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: process.versions.electron
          ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          : process.env,
      })
      if (typeof child.once === 'function') {
        await new Promise(function (resolve, reject) {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
      }
      child.unref()
      const childPid = Number(child.pid)
      // On Windows this PID belongs to the short-lived double-detach helper.
      // The real updater writes its own PID before beginning the delayed update.
      if (platform !== 'win32' && Number.isInteger(childPid) && childPid > 0) {
        running.pid = childPid
        await store.writeJson(STATUS_FILE, running)
      }
    } catch (error) {
      const failed = { phase: 'failed', host: installHost, failedAt: now(), error: String(error?.message || error) }
      await store.writeJson(STATUS_FILE, failed)
      throw error
    }
    return running
  }

  return { start, status }
}
