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

export function createApplicationUpdater(options) {
  const dataRoot = path.resolve(options.dataRoot)
  const sourceRoot = path.resolve(options.sourceRoot)
  const dshHome = path.resolve(options.dshHome || path.join(dataRoot, '../../..'))
  const profileManifest = path.join(dshHome, 'profiles', 'tavern', 'package.json')
  const execPath = options.execPath || process.execPath
  const runtimeHost = options.runtimeHost || process.env.DSH_TAVERN_RUNTIME_HOST
  const spawnProcess = options.spawnProcess || spawn
  const now = typeof options.now === 'function' ? options.now : Date.now
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
    if (current !== undefined) return current
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
    const args = [
      path.join(sourceRoot, 'bin', 'dsh-tavern.mjs'),
      'update',
      '--host', installHost,
      '--status-file', statusFile,
      '--delay=800',
    ]
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
    } catch (error) {
      const failed = { phase: 'failed', host: installHost, failedAt: now(), error: String(error?.message || error) }
      await store.writeJson(STATUS_FILE, failed)
      throw error
    }
    return running
  }

  return { start, status }
}
