import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { recordUpdateDiagnostic, readUpdateDiagnostics } from '../../bin/update-diagnostics.mjs'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { createUpdateState } from '../../bin/update-state.mjs'
import { verifyInstallationProcessesStopped } from '../../bin/installation-process.mjs'
import { readInstallationReceipt } from '../../bin/installation-receipt.mjs'
import installationState from '../../bin/installation-state.cjs'

const STATUS_FILE = 'update-status.json'
const RELEASE_FILE = '.dsh-tavern-release.json'
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000
// Matches the installation lock's stale-idle limit.
const ORPHAN_RECORD_MS = 60 * 60 * 1000
const VERSION_URL = 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/0.2.1%E7%89%88%E6%9C%AC/package.json'
const COMMIT_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/commits/0.2.1%E7%89%88%E6%9C%AC'
const COMPARE_URL = 'https://api.github.com/repos/flizzywine/dsh-tavern/compare'
const execFileAsync = promisify(execFile)
const UPDATE_CHECK_POLICY = 5
const BUSY_PHASES = new Set(['running', 'cancelling', 'blocked'])
const CDN_METADATA_URL = 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@0.2.1%E7%89%88%E6%9C%AC/dsh-tavern-runtime.json'
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

async function readRuntimeMetadata(sourceRoot) {
  try {
    const metadata = JSON.parse(await readFile(path.join(sourceRoot, 'dsh-tavern-runtime.json'), 'utf8'))
    return await compareCdnRuntime(sourceRoot, metadata)
  } catch {
    return null
  }
}

async function readVerifiedRuntimeMetadata(sourceRoot) {
  const compared = await readRuntimeMetadata(sourceRoot)
  return compared?.matches ? compared : null
}

export function sanitizeUpdateError(value) {
  const message = String(value || '').trim()
  if (/PostQueuedCompletionStatus:\s*\(6\)/.test(message)) return '更新失败：Windows 安装子进程退出异常（PostQueuedCompletionStatus: 6，句柄无效）。请使用修复后的更新程序重试；原始详情见更新诊断日志。'
  const replacements = (message.match(/\uFFFD/g) || []).length
  if (replacements >= 2) return '更新失败：安装程序输出编码异常。建议重新安装一次。'
  return message || '更新失败，请重新安装一次。'
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
    let gitRoot = path.join(sourceRoot, '.git')
    if ((await stat(gitRoot)).isFile()) {
      const target = (await readFile(gitRoot, 'utf8')).trim().match(/^gitdir:\s+(.+)$/)?.[1]
      if (!target) throw new Error('无法识别 Git 工作区元数据')
      gitRoot = path.resolve(sourceRoot, target)
    }
    const commonDir = await readFile(path.join(gitRoot, 'commondir'), 'utf8').catch(error => error?.code === 'ENOENT' ? '' : Promise.reject(error))
    const referenceRoot = commonDir.trim() ? path.resolve(gitRoot, commonDir.trim()) : gitRoot
    const head = (await readFile(path.join(gitRoot, 'HEAD'), 'utf8')).trim()
    if (/^[0-9a-f]{40}$/i.test(head)) return head
    const reference = head.match(/^ref:\s+(.+)$/)?.[1]
    if (reference) {
      try {
        const commit = (await readFile(path.join(referenceRoot, reference), 'utf8')).trim()
        if (/^[0-9a-f]{40}$/i.test(commit)) return commit
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const packed = await readFile(path.join(referenceRoot, 'packed-refs'), 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error))
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
  const execPath = options.execPath || process.execPath
  const hostDependencyAnchor = options.hostDependencyAnchor || ''
  const platform = options.platform || process.platform
  const runtimeHost = options.runtimeHost || process.env.DSH_TAVERN_RUNTIME_HOST
  const profileManifest = path.join(dshHome, 'profiles', (runtimeHost || (process.versions.electron ? 'desktop' : 'cli')) === 'desktop' ? 'desktop' : 'tavern', 'package.json')
  const spawnProcess = options.spawnProcess || spawn
  const now = typeof options.now === 'function' ? options.now : Date.now
  const isProcessAlive = typeof options.isProcessAlive === 'function' ? options.isProcessAlive : processIsAlive
  const diagnosticContext = new AsyncLocalStorage()
  const record = (event, details = {}) => recordUpdateDiagnostic(dataRoot, { attemptId: diagnosticContext.getStore(), event, ...details })
  async function stage(name, operation) {
    const startedAt = now()
    record(name + '.started')
    try {
      const result = await operation()
      record(name + (['failed', 'check-failed'].includes(result?.phase) ? '.failed' : '.succeeded'), { durationMs: now() - startedAt })
      return result
    } catch (error) {
      record(name + '.failed', { durationMs: now() - startedAt, error: String(error?.message || error), errorName: error?.name, code: error?.code, cause: error?.cause ? { message: String(error.cause.message || error.cause), code: error.cause.code } : undefined })
      throw error
    }
  }
  async function diagnosticFetch(url, init, timeoutMs = 5000) {
    record('request', { url, timeoutMs })
    const startedAt = now()
    try {
      const response = await fetch(url, init)
      record('response', { url, status: response.status, durationMs: now() - startedAt })
      return response
    } catch (error) {
      record('request.failed', { url, durationMs: now() - startedAt, error: String(error?.message || error), code: error?.code,
        cause: error?.cause ? { message: String(error.cause.message || error.cause), code: error.cause.code } : undefined })
      throw error
    }
  }
  const fetchManifest = options.fetchManifest || async function () {
    const response = await diagnosticFetch(options.versionUrl || process.env.DSH_TAVERN_VERSION_URL || VERSION_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const fetchLatestCommit = options.fetchLatestCommit || async function () {
    const response = await diagnosticFetch(options.commitUrl || process.env.DSH_TAVERN_COMMIT_URL || COMMIT_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const fetchCdnMetadata = options.fetchCdnMetadata || async function () {
    const response = await diagnosticFetch(options.cdnMetadataUrl || process.env.DSH_TAVERN_CDN_METADATA_URL || CDN_METADATA_URL, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    }, 8000)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const compareCommits = options.compareCommits || async function (current, latest) {
    for (const root of [sourceRoot, path.join(dshHome, 'source-cache', 'dsh-tavern.git')]) {
      const relation = await localCommitRelation(root, current, latest)
      if (relation) return relation
    }
    const response = await diagnosticFetch(`${options.compareUrl || COMPARE_URL}/${current}...${latest}`, {
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
    const relation = await stage('commit.compare', () => compareCommits(current, latest))
    if (relation === 'ahead') return true
    if (relation === 'behind' || relation === 'identical') return false
    throw new Error('无法确认远端是当前构建的后续更新（历史分叉或比较信息不完整），请稍后重试或手动重新安装')
  }
  const statusState = createUpdateState(path.join(dataRoot, STATUS_FILE), dshHome)
  const writeStatus = (value, guard) => statusState.write(value, guard)
  const loadLocalIdentity = typeof options.readLocalIdentity === 'function' ? options.readLocalIdentity : async function () {
    let local
    try {
      local = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return { currentVersion: 'unknown', currentCommit: '' }
      throw error
    }
    const runtimeMetadata = await readRuntimeMetadata(sourceRoot)
    const verified = runtimeMetadata?.matches ? runtimeMetadata : null
    return {
      currentVersion: String(local?.version || '') || 'unknown',
      currentCommit: verified?.revision || await readRecordedCommit(sourceRoot, dshHome),
      ...(verified?.releaseSequence ? { currentReleaseSequence: verified.releaseSequence } : {}),
      // The manifest is published by a later commit, so a build installed before
      // its own publish carries the previous manifest. That sequence is still a
      // lower bound: any other published revision with a larger sequence is newer.
      ...(!verified && runtimeMetadata?.releaseSequence ? { releaseSequenceFloor: runtimeMetadata.releaseSequence } : {}),
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

  // Every remote source is optional. GitHub API is authoritative for the latest
  // commit; jsDelivr is the fallback; raw package.json only supplies a label.
  // Order is proven by release sequence, local Git or GitHub compare.
  async function relationTo(identity, latest, latestSequence, { sequenceFirst = false } = {}) {
    const { currentCommit, currentReleaseSequence, releaseSequenceFloor } = identity
    if (currentCommit.toLowerCase() === latest.toLowerCase()) return false
    if (sequenceFirst && currentReleaseSequence) {
      const sequence = await latestSequence()
      if (sequence) return sequence > currentReleaseSequence
    }
    try {
      return await isNewerCommit(currentCommit, latest)
    } catch (error) {
      const sequence = currentReleaseSequence || releaseSequenceFloor ? await latestSequence() : null
      if (sequence) {
        record('commit.compare.sequence', { currentReleaseSequence, releaseSequenceFloor, latestSequence: sequence })
        if (currentReleaseSequence) return sequence > currentReleaseSequence
        // A floor only proves "newer"; an equal or lower sequence may be this very build.
        if (sequence > releaseSequenceFloor) return true
      }
      throw error
    }
  }

  async function versions(identity) {
    const { currentVersion, currentCommit } = identity
    if (currentVersion === 'unknown') throw new Error('无法确认当前构建，请手动重新安装')
    if (currentVersion === '') throw new Error('版本信息不完整')
    const settle = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))
    // Start the CDN request in parallel, but only wait for it when GitHub cannot decide.
    const cdn = settle(stage('cdn.fetch', fetchCdnMetadata))
    const [manifest, commit] = await Promise.all([settle(stage('github.version', fetchManifest)), settle(stage('github.commit', fetchLatestCommit))])
    const manifestVersion = manifest.status === 'fulfilled' ? String(manifest.value?.version || '') : ''
    const cdnSequenceFor = async revision => {
      const result = await cdn
      const sequence = Number(result.value?.releaseSequence)
      return result.status === 'fulfilled' && String(result.value?.revision || '').toLowerCase() === revision.toLowerCase()
        && Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null
    }

    const github = commit.status === 'fulfilled' ? runtimeCommitIdentityOf(commit.value) : null
    if (github && /^[0-9a-f]{40}$/i.test(github.runtimeCommit)) {
      const { publishedCommit, runtimeCommit: latestCommit } = github
      const normalizedCurrentCommit = currentCommit.toLowerCase() === publishedCommit.toLowerCase() ? latestCommit : currentCommit
      const updateAvailable = await relationTo({ ...identity, currentCommit: normalizedCurrentCommit }, latestCommit, () => cdnSequenceFor(latestCommit))
      const latestVersion = manifestVersion || (await cdn).value?.version || 'unknown'
      return { currentVersion, latestVersion: String(latestVersion), currentCommit: normalizedCurrentCommit, latestCommit, checkSource: 'github', updateAvailable, checkWarning: undefined }
    }
    const githubError = github ? new Error('GitHub 返回的提交号无效') : commit.reason
    record('fallback.cdn', { reason: sanitizeUpdateError(githubError?.message || githubError) })
    try {
      const metadata = await cdn
      if (metadata.status === 'rejected') throw metadata.reason
      const compared = await compareCdnRuntime(sourceRoot, metadata.value)
      record('cdn.comparison', { ...identity, latestVersion: compared.version, latestCommit: compared.revision, latestReleaseSequence: compared.releaseSequence, matches: compared.matches })
      const updateAvailable = !compared.matches && await relationTo(identity, compared.revision, async () => compared.releaseSequence, { sequenceFirst: true })
      return {
        currentVersion, latestVersion: manifestVersion || compared.version || 'unknown', currentCommit, latestCommit: compared.revision, checkSource: 'jsdelivr', updateAvailable,
        // jsDelivr caches @main, so it can lag behind GitHub but never invent a newer build.
        checkWarning: updateAvailable
          ? 'GitHub 暂不可达；已发现 CDN 上的较新构建，但无法确认它是最新构建。'
          : 'GitHub 暂不可达；CDN 清单未显示更新构建，CDN 可能有数小时缓存延迟。',
      }
    } catch (cdnError) {
      throw new Error(`暂时无法确认最新版本：GitHub 核实失败（${sanitizeUpdateError(githubError?.message || githubError)}）；CDN 备用检查（${sanitizeUpdateError(cdnError?.message || cdnError)}）`)
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
    const saved = await statusState.read()
    const current = saved === undefined ? undefined : { ...saved, host: await host() }
    let owner = installationState.readInstallation(dshHome)
    if (owner?.supervised && owner.pid > 0 && !isProcessAlive(owner.pid)) {
      const proof = await verifyInstallationProcessesStopped(path.join(owner.lockDir, 'processes'))
      if (proof.safe) {
        installationState.releaseStoppedInstallation({ dshHome, attemptId: owner.attemptId, generation: owner.generation, processesVerifiedStopped: true })
        if (current?.phase === 'completed' && current.attemptId === owner.attemptId) return { ...current, ...identity }
        const interrupted = { phase: 'failed', attemptId: owner.attemptId, repairRequired: true, repairSince: now(), host: await host(), failedAt: now(), error: '更新已中断，已确认安装执行链停止，可以修复安装。' }
        await writeStatus(interrupted, { expectedAttemptId: current?.attemptId })
        return { ...interrupted, ...identity }
      }
    }
    // Status must apply the same stale-lock rule as a new install would; otherwise a
    // lock the installer would reclaim keeps the update button disabled forever.
    if (owner && installationState.reclaimStaleInstallation(dshHome, owner)) {
      if (current?.phase === 'completed' && current.attemptId === owner.attemptId) return { ...current, ...identity }
      const interrupted = { phase: 'failed', attemptId: owner.attemptId, repairRequired: true, repairSince: now(), host: await host(), failedAt: now(), error: '上次更新已中断（安装进程均已退出或超过 1 小时无进展），已解除安装锁，可以修复安装。' }
      await writeStatus(interrupted, { expectedAttemptId: current?.attemptId })
      return { ...interrupted, ...identity }
    }
    if (owner) {
      const active = current?.attemptId === owner.attemptId ? current : {}
      const elapsed = now() - (Number(owner.startedAt) || Date.parse(owner.startedAt) || Number(active.startedAt) || now())
      const stale = elapsed >= RUNNING_TIMEOUT_MS || (owner.pid > 0 && !isProcessAlive(owner.pid))
      const blocked = owner.unsafeToRetry || owner.uncertain || (owner.pid > 0 && !isProcessAlive(owner.pid))
      const cancelling = installationState.cancellationRequested(dshHome, owner.attemptId)
      return { ...active, ...identity, attemptId: owner.attemptId, host: await host(),
        phase: blocked ? 'blocked' : cancelling ? 'cancelling' : 'running',
        startedAt: owner.startedAt, pid: owner.pid, stage: owner.stage || active.stage,
        progressAt: owner.progressAt || active.progressAt,
        cancellable: !!owner.supervised && !blocked, stalled: stale,
        ...(blocked ? { error: '上次安装的执行链尚未确认停止，已阻止重复安装。请先确认旧安装进程全部退出，再恢复安装。' }
          : stale ? { error: '更新超过预期时间；尚未确认执行链停止，请勿同时重新安装。' } : {}),
      }
    }
    if (current !== undefined) {
      const checkedAt = now()
      // A verified installation after this record (e.g. a terminal reinstall) supersedes it.
      async function reconcile(after) {
        const receipt = await readInstallationReceipt({ sourceRoot, dshHome, host: await host(), after })
        if (!receipt) return null
        const completed = { phase: 'completed', host: await host(), attemptId: receipt.attemptId, completedAt: receipt.verifiedAt, requiresRestart: await host() === 'desktop', reconciled: true }
        return { ...await writeStatus(completed, { expectedAttemptId: current.attemptId }), ...identity }
      }
      if (current.repairRequired) {
        const reconciled = await reconcile(Number(current.repairSince || current.failedAt || current.startedAt || 0))
        if (reconciled) return reconciled
      }
      if (['update-available', 'repair-required', 'up-to-date'].includes(current.phase) && (current.checkPolicy !== UPDATE_CHECK_POLICY || current.checkedForCommit !== identity.currentCommit)) {
        const invalidated = { phase: current.repairRequired ? 'repair-required' : 'idle', host: await host(), ...identity,
          ...(current.repairRequired ? { repairRequired: true, repairSince: current.repairSince || current.failedAt, attemptId: current.attemptId } : {}) }
        await writeStatus(invalidated, { expectedAttemptId: current.attemptId })
        return invalidated
      }
      // Legacy updaters did not register their children. A missing parent PID or
      // an elapsed deadline cannot prove that an orphaned writer is stopped.
      if (BUSY_PHASES.has(current.phase)) {
        // No lock is held, so this record is left over: the lock rule already
        // covers live writers. Without these exits a record whose lock was
        // reclaimed by another installer kept the update button disabled forever.
        const since = Number(current.startedAt) || Date.parse(current.startedAt) || 0
        const reconciled = await reconcile(since)
        if (reconciled) return reconciled
        if (checkedAt - (Number(current.progressAt) || since) > ORPHAN_RECORD_MS) {
          const interrupted = { phase: 'failed', attemptId: current.attemptId, repairRequired: true, repairSince: checkedAt, host: await host(), failedAt: checkedAt, error: '上次更新已中断（超过 1 小时无进展且未持有安装锁），可以修复安装。' }
          await writeStatus(interrupted, { expectedAttemptId: current.attemptId })
          return { ...interrupted, ...identity }
        }
        return { ...current, ...identity, phase: 'blocked', repairRequired: true, cancellable: false,
          error: '旧更新器未记录完整执行链，无法安全确认已停止。请先确认旧安装进程全部退出，再从终端恢复安装；请勿同时启动第二次安装。' }
      }
      if (current.phase === 'installed-restart-required') {
        // Older installers inferred success from copied source files, which
        // does not prove dependency installation or profile setup succeeded.
        const recovered = {
          phase: 'failed', repairRequired: true, host: current.host, failedAt: checkedAt,
          targetCommit: current.targetCommit,
          error: '上次更新未确认安装完成，请重新检查并重试更新。',
        }
        await writeStatus(recovered, { expectedAttemptId: current.attemptId })
        return { ...recovered, ...identity }
      }
      if (current.phase === 'failed') {
        const error = sanitizeUpdateError(current.error)
        if (error !== current.error) {
          const readable = { ...current, error }
          await writeStatus(readable, { expectedAttemptId: current.attemptId })
          return { ...readable, ...identity }
        }
      }
      return { ...current, ...identity }
    }
    return { phase: 'idle', host: await host(), ...identity }
  }

  async function status() {
    const managed = await packageManagedStatus()
    if (managed) return managed
    return await statusWithIdentity(await localIdentity())
  }

  async function check() {
    const managed = await packageManagedStatus()
    if (managed) return managed
    const identity = await localIdentity(true)
    record('identity', identity)
    const current = await statusWithIdentity(identity)
    if (BUSY_PHASES.has(current.phase)) {
      throw new Error('更新正在进行，暂时无法重新检查')
    }
    const installHost = await host()
    let version
    try {
      version = await versions(identity)
    } catch (error) {
      const failed = {
        phase: 'check-failed', host: installHost, checkedAt: now(),
        ...(current.repairRequired ? { repairRequired: true, repairSince: current.repairSince || current.failedAt, attemptId: current.attemptId } : {}),
        currentVersion: current.currentVersion, currentCommit: current.currentCommit,
        error: `无法检查更新：${sanitizeUpdateError(error?.message || error)}`,
      }
      return await writeStatus(failed, { expectedAttemptId: current.attemptId })
    }
    const checked = {
      checkPolicy: UPDATE_CHECK_POLICY,
      checkedForCommit: identity.currentCommit,
      phase: version.updateAvailable ? 'update-available' : current.repairRequired ? 'repair-required' : 'up-to-date',
      ...(current.repairRequired ? { repairRequired: true, repairSince: current.repairSince || current.failedAt, attemptId: current.attemptId } : {}),
      host: installHost, checkedAt: now(),
      currentVersion: version.currentVersion, latestVersion: version.latestVersion,
      currentCommit: version.currentCommit, latestCommit: version.latestCommit,
      checkSource: version.checkSource, checkWarning: version.checkWarning,
    }
    return await writeStatus(checked, { expectedAttemptId: current.attemptId })
  }

  async function packageManagedStatus() {
    // pnpm owns packages installed through `dsh plugin add`. The legacy updater
    // replaces a source checkout and rewrites Profile dependencies to link: paths;
    // running it here would corrupt the package store and change install channels.
    try {
      const manifest = JSON.parse(await readFile(profileManifest, 'utf8'))
      if (manifest.dsh?.profile?.bundles?.includes('dsh-profile-tavern')) {
        return {
          phase: 'package-managed', host: await host(), ...await localIdentity(),
          updateCommand: 'dsh plugin --profile tavern add github:flizzywine/dsh-tavern',
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return null
  }

  async function start() {
    const managed = await packageManagedStatus()
    if (managed) throw new Error(`此酒馆由 DSH 插件管理器安装。请关闭酒馆后在终端运行：${managed.updateCommand}，然后重新启动 tavern Profile。`)
    const identity = await localIdentity(true)
    record('identity', identity)
    const current = await statusWithIdentity(identity)
    if (BUSY_PHASES.has(current.phase)) {
      throw new Error('更新正在进行，请勿重复启动')
    }
    const installHost = await host()
    let version
    try {
      version = await versions(identity)
    } catch (error) {
      const failed = { phase: 'failed', ...(current.repairRequired ? { repairRequired: true, repairSince: current.repairSince || current.failedAt, attemptId: current.attemptId } : {}), host: installHost, failedAt: now(), error: `无法检查最新版，尚未开始下载：${sanitizeUpdateError(error?.message || error)}` }
      await writeStatus(failed, { expectedAttemptId: current.attemptId })
      throw new Error(failed.error)
    }
    const refreshed = await statusWithIdentity(await localIdentity(true))
    if (BUSY_PHASES.has(refreshed.phase)) throw new Error('更新正在进行，请勿重复启动')
    if (refreshed.attemptId !== current.attemptId || refreshed.currentCommit !== identity.currentCommit) return refreshed
    if (!version.updateAvailable && !current.repairRequired) {
      const upToDate = {
        phase: 'up-to-date', host: installHost, checkedAt: now(),
        currentVersion: version.currentVersion, latestVersion: version.latestVersion,
        currentCommit: version.currentCommit, latestCommit: version.latestCommit,
        checkSource: version.checkSource, checkWarning: version.checkWarning,
      }
      return await writeStatus(upToDate, { expectedAttemptId: current.attemptId })
    }
    const attemptId = randomUUID()
    const lease = installationState.acquireInstallation({ dshHome, sourceRoot, statusFile: path.join(dataRoot, STATUS_FILE), attemptId, pid: 0, state: 'reserved' })
    const reservationGeneration = lease.owner.generation
    const running = {
      phase: 'running', attemptId, host: installHost, startedAt: now(), cancellable: false,
      ...(version.currentVersion === 'unknown' ? {} : {
        currentVersion: version.currentVersion, latestVersion: version.latestVersion,
        currentCommit: version.currentCommit, latestCommit: version.latestCommit,
        checkSource: version.checkSource, checkWarning: version.checkWarning,
      }),
    }
    try { await writeStatus(running, { attemptId }) } catch (error) {
      // No launch has been attempted; release this exact reservation even when
      // status persistence fails, rather than leaving an unadoptable pid:0 lock.
      lease.release()
      throw error
    }
    const statusFile = path.join(dataRoot, STATUS_FILE)
    const updaterArgs = [
      path.join(sourceRoot, 'bin', 'dsh-tavern.mjs'),
      'update',
      '--host', installHost,
      '--status-file', statusFile,
      '--attempt-id', attemptId,
      '--delay=800',
      ...(version.latestCommit ? ['--target-commit', version.latestCommit] : []),
    ]
    const args = platform === 'win32'
      ? [path.join(sourceRoot, 'bin', 'dsh-tavern-update-helper.mjs'), execPath, ...updaterArgs]
      : updaterArgs
    const launchEnvironment = { ...process.env }
    for (const key of Object.keys(launchEnvironment)) {
      if (/^DSH_TAVERN_INSTALL_/i.test(key) || key === 'DSH_TAVERN_UPDATE_ATTEMPT') delete launchEnvironment[key]
    }
    let launchObserved = false
    try {
      const child = spawnProcess(execPath, args, {
        // Never start the update chain inside the app it replaces: on Windows a process
        // whose working directory is in there makes the final directory swap fail (EBUSY).
        cwd: dshHome,
        detached: true,
        windowsHide: true,
        stdio: platform === 'win32' ? ['ignore', 'ignore', 'pipe'] : 'ignore',
        env: process.versions.electron
          ? {
              ...launchEnvironment, DSH_HOME: dshHome, ...(installHost === 'cli' ? { DSH_TAVERN_CLI_HOME: dshHome } : {}),
              ...(hostDependencyAnchor ? { DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: hostDependencyAnchor } : {}),
              ELECTRON_RUN_AS_NODE: '1',
            }
          : {
              ...launchEnvironment, DSH_HOME: dshHome, ...(installHost === 'cli' ? { DSH_TAVERN_CLI_HOME: dshHome } : {}),
              ...(hostDependencyAnchor ? { DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: hostDependencyAnchor } : {}),
            },
      })
      if (typeof child.once === 'function') {
        await new Promise(function (resolve, reject) {
          child.once('spawn', () => { launchObserved = true })
          if (platform === 'win32') {
            let launchError = ''
            child.stderr?.on('data', chunk => { launchError = (launchError + chunk.toString('utf8')).slice(-6000) })
            child.once('close', code => code === 0 ? resolve() : reject(new Error(sanitizeUpdateError(launchError.trim() || `Windows 更新器启动失败（退出码 ${code}）`))))
          } else child.once('spawn', resolve)
          child.once('error', reject)
        })
      }
      launchObserved = true
      child.unref()
      const childPid = Number(child.pid)
      // On Windows this PID belongs to the short-lived WMI launch helper.
      // The real updater writes its own PID before beginning the delayed update.
      if (platform !== 'win32' && Number.isInteger(childPid) && childPid > 0) {
        running.pid = childPid
        await writeStatus(value => ({ ...value, pid: childPid }), { attemptId, expectedAttemptId: attemptId, onlyIf: value => value?.phase === 'running' && !value?.supervisorReady })
      }
    } catch (error) {
      if (!launchObserved) {
        const failed = { ...running, phase: 'failed', error: String(error?.message || error) }
        await writeStatus(failed, { attemptId, expectedAttemptId: attemptId })
        lease.release()
        throw error
      }
      // WMI may have created the updater even when its helper lost the reply.
      // Keep the reservation fenced on ambiguous launch failures.
      const blocked = { ...running, phase: 'blocked', error: String(error?.message || error), repairRequired: true, repairSince: now() }
      const owner = installationState.readInstallation(dshHome)
      if (owner?.attemptId !== attemptId || owner.generation !== reservationGeneration) return await status()
      lease.update({ unsafeToRetry: true, state: 'blocked' })
      await writeStatus(blocked, { attemptId, expectedAttemptId: attemptId })
      throw error
    }
    return await status()
  }

  async function cancel() {
    const current = await status()
    if (!current.cancellable || !['running', 'cancelling'].includes(current.phase)) throw new Error('当前安装无法安全自动中止，请查看更新状态')
    installationState.requestCancellation(dshHome, current.attemptId)
    return { ...current, phase: 'cancelling' }
  }

  // Reserve the operation before its first await. Two simultaneous clicks can
  // otherwise both read idle before either persists its running status.
  let actionInFlight = false
  function traced(action, operation) {
    return async () => {
      if (actionInFlight) throw new Error('检查或更新正在进行，请稍后重试')
      actionInFlight = true
      try {
        return await diagnosticContext.run(randomUUID(), () => stage(action, async () => {
          record('environment', { platform, arch: process.arch, nodeVersion: process.version, host: await host() })
          return operation()
        }))
      } finally { actionInFlight = false }
    }
  }
  return { check: traced('check', check), start: traced('start', start), cancel: traced('cancel', cancel), status, diagnostics: () => readUpdateDiagnostics(dataRoot) }
}
