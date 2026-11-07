#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import officialDesktop from './official-desktop-runtime.cjs'
import { fileURLToPath } from 'node:url'
import { SCRIPT_PATH, RUNTIME_HOST, DSH_ROOT } from './launcher-environment.mjs'
import { installProfile, parseInstallHost } from './profile-installation.mjs'
import { startService, stopService, statusService, openService, bootstrapFrontendOnce } from './service-lifecycle.mjs'
import { updateApplication, parseUpdateOptions } from './application-update.mjs'
import { openTavernWindow } from './tavern-window.mjs'
import { recordUpdateDiagnostic } from './update-diagnostics.mjs'

// Keep the existing import surface while the executable only dispatches commands.
export { resolveServicePort, resolveDshInvocation } from './launcher-environment.mjs'
export { applySidebarDefaults, ensureSidebarDefaults } from './launcher-settings.mjs'
export { extractDshVersion, parseInstallHost, renderWindowsLauncher, recordInstalledRelease } from './profile-installation.mjs'
export { webUrlFromLogChunk, resolveServiceWebUrl, restartBrowserTarget, browserOpenCommand, needsFrontendBootstrap, isPortOpen, isServiceReady } from './service-lifecycle.mjs'
export { encodeWindowsPowerShellScript, decodeUpdateOutput, parseUpdateOptions, updateApplication, resolveUpdateProgram } from './application-update.mjs'

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function usage() {
  console.log('用法：dsh-tavern install [--host cli|desktop|next|android] | {update|start|open|window|stop|restart|status}')
}

// A detached in-app update has no console; keep its trail next to its status file.
function updateDiagnostic(event, details = {}) {
  if (process.argv[2] !== 'update') return
  // Read the two flags leniently: invalid arguments are themselves worth recording.
  const flag = name => { const args = process.argv.slice(3), at = args.indexOf(name); return at >= 0 ? args[at + 1] : args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1) }
  const statusFile = flag('--status-file')
  if (statusFile && path.isAbsolute(statusFile)) recordUpdateDiagnostic(path.dirname(statusFile), { attemptId: flag('--attempt-id'), event, ...details })
}

async function main() {
  const action = process.argv[2] || 'status'
  if (RUNTIME_HOST === 'next' && action !== 'install' && !['help', '-h', '--help'].includes(action)) {
    throw new Error('Next 由应用管理启动与切换。更新源码后重新运行 install --host next。')
  }
  updateDiagnostic('updater.started', { execPath: process.execPath, electron: process.versions.electron || '', runtimeHost: RUNTIME_HOST, cwd: process.cwd() })
  // Desktop hosts run DSH through the app's own runtime; every command that touches the service needs it.
  if ((RUNTIME_HOST === 'next' && action === 'install') || (RUNTIME_HOST === 'desktop' && ['install', 'update', 'start', 'stop', 'restart', 'status', 'open', 'window'].includes(action))) {
    const executable = RUNTIME_HOST === 'next' ? officialDesktop.discoverNext() : officialDesktop.discover()
    // Run installation and updates under the official app's Electron in Node mode.
    const runner = officialDesktop.runner(executable)
    if (path.resolve(process.execPath) !== path.resolve(runner)) {
      updateDiagnostic('updater.relaunch', { executable, runner })
      const setup = spawnSync(runner, ['--expose-internals', fileURLToPath(new URL('./official-desktop-runtime.cjs', import.meta.url)), DSH_ROOT, ...(RUNTIME_HOST === 'next' ? ['--next'] : [])],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_APP_EXECUTABLE: executable }, encoding: 'utf8' })
      if (setup.error || setup.status !== 0) throw new Error(setup.error?.message || setup.stderr || '桌面环境准备失败')
      const result = spawnSync(runner, ['--expose-internals', SCRIPT_PATH, ...process.argv.slice(2)],
        { env: { ...process.env, ...JSON.parse(setup.stdout), ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' })
      if (result.error) throw result.error
      process.exitCode = result.status ?? 1
      return
    }
    Object.assign(process.env, officialDesktop.prepare({ executable, home: DSH_ROOT, host: RUNTIME_HOST }))
  }
  switch (action) {
    case 'install':
      await installProfile(parseInstallHost(process.argv.slice(3)))
      break
    case 'update':
      await updateApplication(parseUpdateOptions(process.argv.slice(3)))
      break
    case 'start':
      {
        const state = await startService()
        await bootstrapFrontendOnce(state)
      }
      break
    case 'stop':
      await stopService()
      break
    case 'restart':
      await stopService()
      {
        const state = await startService()
        if (!await bootstrapFrontendOnce(state)) console.log('如页面未恢复连接，请运行 dsh-tavern open，或使用上方完整地址重新进入。')
      }
      break
    case 'status':
      await statusService()
      break
    case 'open':
      await openService()
      break
    case 'window':
      await openTavernWindow()
      break
    case '-h':
    case '--help':
    case 'help':
      usage()
      break
    default:
      usage()
      process.exitCode = 2
  }
}

const isEntrypoint = process.argv[1] && realpathSync(SCRIPT_PATH) === realpathSync(path.resolve(process.argv[1]))
if (isEntrypoint) {
  process.once('exit', code => updateDiagnostic('updater.exit', { code }))
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    updateDiagnostic('updater.failed', { error: message })
    fail(message)
  })
}
