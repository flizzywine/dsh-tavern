import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { findDshCommand, readInstallationFile, SOURCE_ROOT } from './launcher-environment.mjs'
import { resolveDshBootModule } from './plugin-dependencies.mjs'
import { selectTestRuntime, probeTestRuntime } from './test-runtime.mjs'

let runtime
try {
  const installation = readInstallationFile()
  runtime = probeTestRuntime(selectTestRuntime({ installation,
    cliBoot: () => resolveDshBootModule({ dsh: findDshCommand() }) }))
  if (installation.testPlaywrightBrowsersPath) {
    runtime.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(SOURCE_ROOT, installation.testPlaywrightBrowsersPath)
  }
} catch (error) {
  console.error(`无法运行真实 DSH 集成测试：${error.message}`)
  console.error('可用 DSH_DESKTOP_APP_EXECUTABLE 或 .dsh-tavern-local.json 的 testDesktopExecutable 指定官方桌面程序；也支持 DSH_BOOT_MODULE 指定独立运行时。不会自动安装 DSH。')
  process.exit(1)
}
console.log(`测试使用 DSH ${runtime.version}：${runtime.boot}`)
const runtimePreload = pathToFileURL(path.join(SOURCE_ROOT, 'tests/fixtures/host-runtime-preload.mjs')).href
// Fixtures spawn their own Node/Electron processes. Keep their package lookup on
// this installation too; the session patch remains an explicit test-runner hook.
runtime.env.NODE_OPTIONS = [runtime.env.NODE_OPTIONS, '--import=' + runtimePreload].filter(Boolean).join(' ')
runtime.env.DSH_TEST_NODE_EXECUTABLE = process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath

// Optional file arguments run a focused subset; no arguments runs the full suite (release only).
const selected = process.argv.slice(2).map(file => path.resolve(file))
const tests = selected.length ? selected : ['tests', 'testsets/tests'].flatMap(directory =>
  readdirSync(path.join(SOURCE_ROOT, directory))
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(SOURCE_ROOT, directory, name)))
const result = spawnSync(runtime.command, [...runtime.args,
  '--import', pathToFileURL(path.join(SOURCE_ROOT, 'tests/fixtures/host-session-patch-preload.mjs')).href, '--test', ...tests], {
  cwd: SOURCE_ROOT,
  env: runtime.env,
  windowsHide: true,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
