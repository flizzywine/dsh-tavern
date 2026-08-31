#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import path from 'node:path'
import { SCRIPT_PATH } from './launcher-environment.mjs'
import { installProfile, parseInstallHost } from './profile-installation.mjs'
import { startService, stopService, statusService, openService, bootstrapFrontendOnce } from './service-lifecycle.mjs'
import { updateApplication, parseUpdateOptions } from './application-update.mjs'

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
  console.log('用法：dsh-tavern install [--host cli|desktop|android] | {update|start|open|stop|restart|status}')
}

async function main() {
  const action = process.argv[2] || 'status'
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
        bootstrapFrontendOnce(state)
      }
      break
    case 'stop':
      await stopService()
      break
    case 'restart':
      await stopService()
      {
        const state = await startService()
        if (!bootstrapFrontendOnce(state)) console.log('如页面未恢复连接，请运行 dsh-tavern open，或使用上方完整地址重新进入。')
      }
      break
    case 'status':
      await statusService()
      break
    case 'open':
      await openService()
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
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
}
