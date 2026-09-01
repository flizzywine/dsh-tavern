import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { createProfileDataStore } from './profile-data-store.js'

const STATUS_FILE = 'update-status.json'
const RELEASE_FILE = '.dsh-tavern-release.json'
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000
const VERSION_URL = 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/package.json'
const COMMIT_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/commits/main'
const COMPARE_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/compare'
const execFileAsync = promisify(execFile)
const UPDATE_CHECK_POLICY = 3
const CDN_METADATA_URL = 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/dsh-tavern-runtime.json'
const RUNTIME_FILES = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh'])
const RUNTIME_DIRECTORIES = ['bin/', 'config/', 'presets/', 'tavern-plugin/', 'patches/']

async function localCommitRelation(root, current, latest) {
  const ancestor = async (base, head) => {
    try {
      await execFileAsync('git', ['-C', root, 'merge-base', '--is-ancestor', base, head], { timeout: 3000, windowsHide: true })
      return true
    } catch (error) {
      if (error.code === 1) return false
      throw error
    }
  }
  try {
    if (await ancestor(current, latest)) return 'ahead'
    if (await ancestor(latest, current)) return 'behind'
    // Shallow repositories cannot prove divergence. Let GitHub resolve it.
  } catch { /* Git or either commit may be absent in an archive installation. */ }
  return null
}

function runtimePath(value) {
  const normalized = String(value || '').replace(/^\/+/, '').replaceAll('\\', '/')
  if (normalized === '' || normalized.includes('../') || path.posix.isAbsolute(normalized)) return ''
  return RUNTIME_FILES.has(normalized) || RUNTIME_DIRECTORIES.some((prefix) => normalized.startsWith(prefix)) ? normalized : ''
}

async function compareCdnRuntime(sourceRoot, metadata) {
  if (!/^[0-9a-f]{40}$/i.test(String(metadata?.revision || ''))) throw new Error('jsDelivr 运行清单缺少有效提交号')
  const files = Array.isArray(metadata?.files) ? metadata.files.map((file) => ({ path: runtimePath(file?.path), hash: String(file?.sha256 || '').toLowerCase() })).filter((file) => file.path && /^[0-9a-f]{64}$/.test(file.hash)) : []
  if (files.length === 0) throw new Error('jsDelivr 未返回运行文件清单')
  files.sort((left, right) => left.path.localeCompare(right.path))
  const remoteDigest = createHash('sha256')
  const localDigest = createHash('sha256')
  let matches = true
  for (const file of files) {
    remoteDigest.update(`${file.path}\0${file.hash}\n`)
    let localHash = ''
    try { localHash = createHash('sha256').update(await readFile(path.join(sourceRoot, ...file.path.split('/')))).digest('hex') } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    localDigest.update(`${file.path}\0${localHash}\n`)
    if (localHash !== file.hash) matches = false
  }
  const version = String(metadata?.version || '')
  const releaseSequence = Number(metadata?.releaseSequence)
  return {
    matches,
    revision: metadata.revision,
    version,
    releaseSequence: Number.isSafeInteger(releaseSequence) && releaseSequence > 0 ? releaseSequence : null,
    currentFingerprint: localDigest.digest('hex'),
    latestFingerprint: remoteDigest.digest('hex'),
    fileCount: files.length,
  }
}

async function readVerifiedRuntimeMetadata(sourceRoot) {
  try {
    const metadata = JSON.parse(await readFile(path.join(sourceRoot, 'dsh-tavern-runtime.json'), 'utf8'))
    const compared = await compareCdnRuntime(sourceRoot, metadata)
    return compared.matches ? compared : null
  } catch {
    return null
  }
}

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

function runtimeCommitIdentityOf(value) {
  if (typeof value === 'string') return { publishedCommit: value, runtimeCommit: value }
  const publishedCommit = String(value?.sha || '')
  const parent = String(value?.parents?.[0]?.sha || '')
  const files = Array.isArray(value?.files) ? value.files : []
  const runtimeCommit = files.length === 1 && files[0]?.filename === 'dsh-tavern-runtime.json' && /^[0-9a-f]{40}$/i.test(parent)
    ? parent
    : publishedCommit
  return { publishedCommit, runtimeCommit }
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
  const runtimeMetadata = await readVerifiedRuntimeMetadata(sourceRoot)
  if (runtimeMetadata) return runtimeMetadata.revision
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
    return response.json()
  }
  const fetchCdnMetadata = options.fetchCdnMetadata || async function () {
    const response = await fetch(options.cdnMetadataUrl || process.env.DSH_TAVERN_CDN_METADATA_URL || CDN_METADATA_URL, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const compareCommits = options.compareCommits || async function (current, latest) {
    for (const root of [sourceRoot, path.join(dshHome, 'source-cache', 'dsh-tavern.git')]) {
      const relation = await localCommitRelation(root, current, latest)
      if (relation) return relation
    }
    const response = await fetch(`${options.compareUrl || COMPARE_URL}/${current}...${latest}`, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`无法确认提交先后（GitHub HTTP ${response.status}），请稍后重试`)
    const comparison = await response.json()
    if (String(comparison?.base_commit?.sha).toLowerCase() !== current) throw new Error('GitHub 提交比较返回的基准不符')
    return comparison.status
  }
  async function isNewerCommit(current, latest) {
    current = String(current || '').toLowerCase()
    latest = String(latest || '').toLowerCase()
    if (!/^[0-9a-f]{40}$/.test(current) || !/^[0-9a-f]{40}$/.test(latest)) throw new Error('无法确认当前构建或提交先后，请稍后重试或手动重新安装')
    if (current === latest) return false
    const relation = await compareCommits(current, latest)
    if (relation === 'ahead') return true
    if (relation === 'behind' || relation === 'identical') return false
    throw new Error('无法确认远端是当前构建的后续更新（历史分叉或比较信息不完整），请稍后重试或手动重新安装')
  }
  const store = createProfileDataStore({ dataRoot })

  const loadLocalIdentity = typeof options.readLocalIdentity === 'function' ? options.readLocalIdentity : async function () {
    let local
    try {
      local = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return { currentVersion: 'unknown', currentCommit: '' }
      throw error
    }
    const runtimeMetadata = await readVerifiedRuntimeMetadata(sourceRoot)
    return {
      currentVersion: String(local?.version || '') || 'unknown',
      currentCommit: runtimeMetadata?.revision || await readRecordedCommit(sourceRoot, dshHome),
      ...(runtimeMetadata?.releaseSequence ? { currentReleaseSequence: runtimeMetadata.releaseSequence } : {}),
    }
  }
  let identitySnapshot = null
  let identityLoad = null

  async function localIdentity(refresh = false) {
    if (!refresh && identitySnapshot !== null) return identitySnapshot
    if (identityLoad === null) {
      identityLoad = Promise.resolve().then(loadLocalIdentity).then(function (identity) {
        identitySnapshot = identity
        return identity
      }).finally(function () { identityLoad = null })
    }
    return await identityLoad
  }

  async function versions(identity) {
    const { currentVersion, currentCommit, currentReleaseSequence } = identity
    if (currentVersion === 'unknown') throw new Error('无法确认当前构建，请手动重新安装')
    try {
      const compared = await compareCdnRuntime(sourceRoot, await fetchCdnMetadata())
      let updateAvailable = false
      if (!compared.matches && currentCommit.toLowerCase() !== String(compared.revision).toLowerCase()) {
        if (currentReleaseSequence && compared.releaseSequence) {
          updateAvailable = compared.releaseSequence > currentReleaseSequence
        } else if (compared.version && compareVersions(compared.version, currentVersion) !== 0) {
          updateAvailable = compareVersions(compared.version, currentVersion) > 0
        } else {
          throw new Error('jsDelivr 清单缺少可比较的发布序号，需使用 GitHub 确认提交先后')
        }
      }
      return {
        currentVersion,
        latestVersion: compared.version || currentVersion,
        currentCommit,
        latestCommit: compared.revision,
        checkSource: 'jsdelivr',
        updateAvailable,
      }
    } catch (cdnError) {
      try {
        const [remote, latestCommitResult] = await Promise.all([fetchManifest(), fetchLatestCommit()])
        const { publishedCommit, runtimeCommit: latestCommit } = runtimeCommitIdentityOf(latestCommitResult)
        const latestVersion = String(remote?.version || '')
        if (currentVersion === '' || latestVersion === '') throw new Error('版本信息不完整')
        if (!/^[0-9a-f]{40}$/i.test(latestCommit)) throw new Error('GitHub 返回的提交号无效')
        const normalizedCurrentCommit = currentCommit.toLowerCase() === publishedCommit.toLowerCase()
          ? latestCommit
          : currentCommit
        return {
          currentVersion, latestVersion, currentCommit: normalizedCurrentCommit, latestCommit, checkSource: 'github',
          updateAvailable: compareVersions(latestVersion, currentVersion) >= 0 && await isNewerCommit(normalizedCurrentCommit, latestCommit),
          checkWarning: undefined,
        }
      } catch (githubError) {
        throw new Error(`jsDelivr 不可用（${sanitizeUpdateError(cdnError?.message || cdnError)}）；GitHub 备用源也不可用（${sanitizeUpdateError(githubError?.message || githubError)}）`)
      }
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

  async function statusWithIdentity(identity) {
    const current = await store.readJson(STATUS_FILE)
    if (current !== undefined) {
      if (current.phase === 'update-available' && (current.checkPolicy !== UPDATE_CHECK_POLICY || current.checkedForCommit !== identity.currentCommit)) {
        const invalidated = { phase: 'idle', host: await host(), ...identity }
        await store.writeJson(STATUS_FILE, invalidated)
        return invalidated
      }
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
        return { ...interrupted, ...identity }
      }
      if (current.phase === 'installed-restart-required' && current.host !== 'desktop') {
        const completed = {
          phase: 'completed', host: current.host, completedAt: checkedAt,
          targetCommit: current.targetCommit, recoveredByRestart: true,
        }
        await store.writeJson(STATUS_FILE, completed)
        return { ...completed, ...identity }
      }
      if (current.phase === 'failed') {
        const error = sanitizeUpdateError(current.error)
        if (error !== current.error) {
          const readable = { ...current, error }
          await store.writeJson(STATUS_FILE, readable)
          return { ...readable, ...identity }
        }
      }
      return { ...current, ...identity }
    }
    return { phase: 'idle', host: await host(), ...identity }
  }

  async function status() {
    return await statusWithIdentity(await localIdentity())
  }

  async function check() {
    const identity = await localIdentity(true)
    const current = await statusWithIdentity(identity)
    if (current.phase === 'running' && now() - Number(current.startedAt || 0) < RUNNING_TIMEOUT_MS) {
      throw new Error('更新正在进行，暂时无法重新检查')
    }
    const installHost = await host()
    let version
    try {
      version = await versions(identity)
    } catch (error) {
      const failed = {
        phase: 'check-failed', host: installHost, checkedAt: now(),
        currentVersion: current.currentVersion, currentCommit: current.currentCommit,
        error: `无法检查更新：${sanitizeUpdateError(error?.message || error)}`,
      }
      await store.writeJson(STATUS_FILE, failed)
      return failed
    }
    const checked = {
      checkPolicy: UPDATE_CHECK_POLICY,
      checkedForCommit: identity.currentCommit,
      phase: version.updateAvailable ? 'update-available' : 'up-to-date',
      host: installHost, checkedAt: now(),
      currentVersion: version.currentVersion, latestVersion: version.latestVersion,
      currentCommit: version.currentCommit, latestCommit: version.latestCommit,
      checkSource: version.checkSource, checkWarning: version.checkWarning,
    }
    await store.writeJson(STATUS_FILE, checked)
    return checked
  }

  async function start() {
    const identity = await localIdentity(true)
    const current = await statusWithIdentity(identity)
    if (current.phase === 'running' && now() - Number(current.startedAt || 0) < RUNNING_TIMEOUT_MS) {
      throw new Error('更新正在进行，请勿重复启动')
    }
    const installHost = await host()
    let version
    try {
      version = await versions(identity)
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
        checkSource: version.checkSource, checkWarning: version.checkWarning,
      }
      await store.writeJson(STATUS_FILE, upToDate)
      return upToDate
    }
    const running = {
      phase: 'running', host: installHost, startedAt: now(),
      ...(version.currentVersion === 'unknown' ? {} : {
        currentVersion: version.currentVersion, latestVersion: version.latestVersion,
        currentCommit: version.currentCommit, latestCommit: version.latestCommit,
        checkSource: version.checkSource, checkWarning: version.checkWarning,
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

  return { check, start, status }
}
