import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { createProfileDataStore } from './profile-data-store.js'

const STATUS_FILE = 'update-status.json'
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000

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
  const store = createProfileDataStore({ dataRoot })

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
    const running = { phase: 'running', host: installHost, startedAt: now() }
    await store.writeJson(STATUS_FILE, running)
    const statusFile = path.join(dataRoot, STATUS_FILE)
    const updaterArgs = [
      path.join(sourceRoot, 'bin', 'dsh-tavern.mjs'),
      'update',
      '--host', installHost,
      '--status-file', statusFile,
      '--delay=800',
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
