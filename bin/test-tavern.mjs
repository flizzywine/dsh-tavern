import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { findDshCommand, SOURCE_ROOT } from './launcher-environment.mjs'
import { resolveDshBootModule } from './plugin-dependencies.mjs'

function bootModule() {
  if (process.env.DSH_BOOT_MODULE) return path.resolve(process.env.DSH_BOOT_MODULE)
  const dsh = findDshCommand()
  return resolveDshBootModule({ dsh })
}

let boot
try {
  boot = bootModule()
} catch (error) {
  console.error(`无法运行真实 DSH 集成测试：${error.message}`)
  console.error('请先安装 DSH，或通过 DSH_BOOT_MODULE 指向 dsh-app-boot/lib/index.js。')
  process.exit(1)
}

// Optional file arguments run a focused subset; no arguments runs the full suite (release only).
const selected = process.argv.slice(2).map(file => path.resolve(file))
const tests = selected.length ? selected : ['tests', 'testsets/tests'].flatMap(directory =>
  readdirSync(path.join(SOURCE_ROOT, directory))
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(SOURCE_ROOT, directory, name)))
const result = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(SOURCE_ROOT, 'tests/fixtures/host-session-patch-preload.mjs')).href, '--test', ...tests], {
  cwd: SOURCE_ROOT,
  env: { ...process.env, DSH_BOOT_MODULE: boot },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
