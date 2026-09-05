import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

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

const tests = readdirSync(path.join(SOURCE_ROOT, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join(SOURCE_ROOT, 'tests', name))
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: SOURCE_ROOT,
  env: { ...process.env, DSH_BOOT_MODULE: boot },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
