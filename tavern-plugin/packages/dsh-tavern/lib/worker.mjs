import { existsSync, readFileSync, writeFileSync, appendFileSync, rmSync, rmdirSync, lstatSync, realpathSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { installPublishGate, nextUpdateRestartMarker, processAlive, stagesNextUpdate, waitForExit, switchProfile, relaunchApp } from './helper.mjs'
import { cleanupOwnedProcesses, waitForOwnedExit } from './processes.mjs'
import { hasNextTavern } from './state.mjs'
import { downloadInstaller } from './installer-download.mjs'
import { recordProfileContinuation } from './startup-profile.mjs'

async function installTavern(request, { log, waitForDesktop }) {
  const windows = process.platform === 'win32'
  const next = request.host === 'next'
  const replacesNext = hasNextTavern(request.home)
  const name = windows ? 'install.ps1' : 'install.sh'
  const script = join(request.stateDir, 'install-pending', 'runtime', name)
  const gate = installPublishGate(request.stateDir)
  const transcriptPath = join(request.stateDir, 'last-run.log.out')
  writeFileSync(transcriptPath, '')
  writeFileSync(gate + '.progress', '正在下载安装脚本…')
  const { content, proxyEnv } = await downloadInstaller(name, { log, preparingUpdate: Boolean(waitForDesktop), next, replacesNext })
  writeFileSync(script, windows ? '\uFEFF' + content : content, { flag: 'wx', mode: 0o600 })
  const env = { ...process.env, ...proxyEnv, DSH_HOME: request.home, DSH_TAVERN_HOST: next ? 'next' : 'desktop',
    DSH_DESKTOP_APP_EXECUTABLE: request.relaunch, DSH_TAVERN_LAUNCHER_INSTALL: '1', DSH_TAVERN_PUBLISH_GATE: gate }
  if (next) {
    env.DSH_TAVERN_NEXT_EXECUTABLE = request.relaunch
    if (!waitForDesktop) writeFileSync(gate, 'publish', { flag: 'wx' })
  } else {
    env.DSH_TAVERN_LATE_PUBLISH = '1'
    env.DSH_TAVERN_INSTALL_INACTIVE = '1'
    env.DSH_TAVERN_PREPARING_DESKTOP_PID = String(request.pids[1])
  }
  if (request.appDir) env.DSH_TAVERN_APP_DIR = request.appDir
  writeFileSync(gate + '.progress', '正在下载酒馆文件…')
  if (replacesNext) env.DSH_TAVERN_REQUIRE_NEXT_MIGRATION = '1'
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DSH_PROFILE', 'DSH_PROFILE_DIR']) delete env[key]
  const command = windows ? 'powershell.exe' : '/bin/bash'
  const args = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script] : [script]
  const transcript = openSync(transcriptPath, 'w', 0o600)
  try {
    const child = spawn(command, args, { env, stdio: ['ignore', transcript, transcript], windowsHide: true })
    let finished = false
    // Keep the outcome handled even if the installer exits while waiting for NEXT.
    const completion = new Promise(resolve => {
      child.once('error', resolve)
      child.once('exit', (code, signal) => resolve(code === 0 ? undefined
        : new Error(`酒馆安装失败（${signal ?? code}），请查看「说明与日志」。`)))
    }).then(error => { finished = true; return error })
    if (waitForDesktop) {
      try {
        const restart = nextUpdateRestartMarker(request.stateDir, request.stamp)
        while (!finished && !existsSync(restart)) {
          if (!request.pids.every(processAlive)) throw new Error('NEXT 在确认更新前退出，已取消本次准备。')
          await delay(250)
        }
        if (!finished) {
          writeFileSync(gate + '.progress', '正在等待 NEXT 退出并应用更新…')
          await waitForDesktop()
          if (!finished) writeFileSync(gate, 'publish', { flag: 'wx' })
        }
      } catch (error) {
        if (!finished) writeFileSync(gate, 'cancel', { flag: 'wx' })
        await completion
        throw error
      }
    }
    const error = await completion
    if (error) throw error
  } finally {
    closeSync(transcript)
  }
  return { installed: true }
}

async function performJob(request, options) {
  if (request.mode === 'install') return installTavern(request, options)
  if (!['relocate', 'uninstall'].includes(request.mode)) return switchProfile(request, options)
  const require = createRequire(import.meta.url)
  const { acquireInstallation } = require('./installation-state.cjs')
  const lease = acquireInstallation({ dshHome: request.home, sourceRoot: request.installation.appDir })
  try {
    const { performInstallation, validateInstallationRequest } = await import('./installation.mjs')
    const fresh = validateInstallationRequest({ home: request.home, stateDir: request.stateDir, activeDir: request.liveDir }, request.mode, { confirmed: true, destination: request.destination })
    if (JSON.stringify(fresh.installation.entries) !== JSON.stringify(request.installation.entries)) throw new Error('安装目录已改变，请刷新后重试。')
    const { assertInstallationIdle } = await import('./installation-processes.mjs')
    await assertInstallationIdle(request)
    if (request.mode === 'uninstall' && lstatSync(request.liveDir).isSymbolicLink()) {
      if (realpathSync(request.liveDir) !== realpathSync(fresh.installation.profileDir)) throw new Error('desktop 入口不是当前酒馆，未修改其他 profile。')
      // Record intent before the two-step desktop restore: a crash here must
      // also fence standalone installers, not only the bridge pending queue.
      const journalFile = join(request.stateDir, 'installation-operation.json')
      const writeRestore = phase => lease.withOwnership(() => {
        const temporary = journalFile + '.restore-' + process.pid + '.tmp'
        const fd = openSync(temporary, 'wx', 0o600)
        try { writeFileSync(fd, JSON.stringify({ schemaVersion: 1, mode: 'uninstall-restore', phase, stamp: request.stamp })); fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(temporary, journalFile)
      })
      writeRestore('preparing')
      try {
        await switchProfile({ ...request, mode: 'unlink' }, { ...options, rename: (from, to) => lease.withOwnership(() => renameSync(from, to)) })
        writeRestore('completed')
      } catch (error) {
        if (!error.recoveryRequired) {
          try { writeRestore('rolled-back') } catch (journalError) {
            error = Object.assign(new Error(`原版恢复结果需要检查：${journalFile}；${journalError.message}`, { cause: error }), { recoveryRequired: true, code: 'recovery-required' })
          }
        }
        throw error
      }
    }
    return await performInstallation(request, { ...options, ownership: lease, afterCopy: () => assertInstallationIdle(request) })
  } catch (error) {
    if (error.recoveryRequired) {
      try { lease.retain(error.message, { ownerDone: true }) } catch { /* Never alter a replacement owner. */ }
    }
    throw error
  } finally {
    // Unsafe transactions retain the install fence until explicit recovery.
    for (let retry = 0; ; retry++) {
      try {
        if (!lease.owner.unsafeToRetry) lease.release()
        break
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || retry >= 5) {
          options.log(`安装锁清理未完成：${error.message}`)
          break
        }
        await delay(50 * (retry + 1))
      }
    }
  }
}

/** Run outside the profiles tree; never relaunch an app after failed recovery. */
export async function runSwitchJob(job, {
  wait = waitForExit, waitOwned = waitForOwnedExit, perform = performJob, cleanup = cleanupOwnedProcesses,
  relaunch = relaunchApp,
} = {}) {
  const lock = dirname(job)
  try { writeFileSync(join(lock, 'worker.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 }) } catch {}
  let request
  let exited = false
  let recoveryRequired = false
  let failed = false
  let log = () => {}
  try {
    request = JSON.parse(readFileSync(job, 'utf8'))
    log = message => appendFileSync(join(request.stateDir, 'last-run.log'), new Date().toISOString() + ' ' + message + '\n')
    const persist = result => writeFileSync(join(request.stateDir, 'last-result.json'), JSON.stringify({
      mode: request.mode, stamp: request.stamp, finishedAt: new Date().toISOString(),
      logPath: join(request.stateDir, 'last-run.log'), ...result,
    }), { mode: 0o600 })
    log(`已排队 ${request.stamp} (${request.mode})。`)
    try {
      const stagedUpdate = stagesNextUpdate(request)
      const waitForDesktop = async () => {
        if (request.ownership) await waitOwned(request.ownership)
        else await wait(request.pids)
        exited = true
        // NEXT terminals can outlive the GUI. The installer independently checks
        // for other desktops and rolls back if an open handle blocks publication.
        if (!stagedUpdate && ['install', 'relocate', 'uninstall'].includes(request.mode) && request.ownership?.descendants?.length) {
          await waitOwned({ roots: request.ownership.descendants }, { timeout: 15000 })
        }
      }
      if (!stagedUpdate && (request.mode !== 'install' || request.host === 'next')) await waitForDesktop()
      let cleaned = false
      const result = await perform(request, { log, waitForDesktop: stagedUpdate ? waitForDesktop : undefined, retry: { onRetry: async ({ from, to, code, attempt }) => {
        log(`目录占用重试 ${attempt}: ${code} ${from} → ${to}`)
        if (!cleaned) {
          cleaned = true
          // Only identities captured while Desktop was still alive are eligible.
          // Unrelated sessions and unknown occupiers are never force-closed.
          if (request.ownership && !['relocate', 'uninstall'].includes(request.mode)) await cleanup(request.ownership, { log })
          else log('无可验证的桌面子进程记录；仅等待目录锁释放，不结束任何进程。')
        }
      } } })
      log(JSON.stringify(result))
      if (request.host !== 'next' && ['link', 'unlink'].includes(request.mode)) {
        try { recordProfileContinuation(request.home || dirname(resolve(request.stateDir)), request.mode === 'link' ? 'tavern' : 'desktop') } catch {}
      }
      const message = stagedUpdate ? '酒馆更新完成。' : request.mode === 'install' ? '酒馆安装完成。' : '切换完成。'
      persist({ status: 'succeeded', message, updated: stagedUpdate })
      log(message)
    } catch (error) {
      failed = true
      recoveryRequired = error.recoveryRequired === true
      log('ERROR: ' + error.message)
      persist({ status: 'failed', message: error.message, code: error.code, recoveryRequired })
    }
  } catch (error) {
    failed = true
    log('ERROR: ' + error.message)
  } finally {
    if (exited && !recoveryRequired && request?.relaunch) {
      try { relaunch(request.relaunch, { continueProfile: request.host !== 'next' }); log('已重新打开桌面。') } catch (error) { log('ERROR: 无法重新打开桌面：' + error.message) }
    }
    if (recoveryRequired) log('入口需要手动恢复，未重新打开桌面；请保留备份和日志。')
    try {
      rmSync(job, { force: true })
      rmSync(join(lock, 'worker.json'), { force: true })
      rmSync(join(lock, 'runtime'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      rmdirSync(lock)
    } catch (error) { log('助手临时文件保留，操作结果不变：' + error.message) }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSwitchJob(process.argv[2])
}
