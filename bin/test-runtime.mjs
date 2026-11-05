import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import desktop from './official-desktop-runtime.cjs'
import { isAsarPath } from './desktop-host-paths.mjs'
import { assertCompatibleDshVersion } from './dsh-compatibility.mjs'

// Select one installation for the whole test process, including its children.
// Never install, extract or silently replace the selected runtime.
export function selectTestRuntime({ env = process.env, installation = {}, execPath = process.execPath,
  platform = process.platform, discover = desktop.discover, cliBoot } = {}) {
  if (env.DSH_BOOT_MODULE && !isAsarPath(env.DSH_BOOT_MODULE)) {
    return { command: execPath, args: [], env: { ...env }, boot: path.resolve(env.DSH_BOOT_MODULE) }
  }
  let executable = env.DSH_DESKTOP_APP_EXECUTABLE || env.DSH_DESKTOP_NODE_EXECUTABLE || installation.testDesktopExecutable
  if (!executable) { try { executable = discover(env, platform) } catch {} }
  if (executable) {
    executable = path.resolve(executable)
    if (!existsSync(executable)) throw new Error('测试所选桌面程序不存在：' + executable)
    const layout = desktop.layout(executable, platform)
    if (layout.name !== '@deepseek-ai/dsh-desktop') throw new Error('测试需要官方 DeepSeek Harness：' + executable)
    return { command: executable, args: ['--expose-internals'], anchor: path.join(layout.host, 'package.json'),
      boot: env.DSH_BOOT_MODULE ? path.resolve(env.DSH_BOOT_MODULE) : undefined,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_APP_EXECUTABLE: executable } }
  }
  if (env.DSH_BOOT_MODULE) throw new Error('ASAR 运行时需要指定 DSH_DESKTOP_APP_EXECUTABLE')
  return { command: execPath, args: [], env: { ...env }, boot: cliBoot() }
}

export function probeTestRuntime(runtime, run = spawnSync) {
  const script = `const {createRequire}=require('node:module');
const r=createRequire(${JSON.stringify(runtime.anchor || runtime.boot)});
const boot=${JSON.stringify(runtime.boot)} || r.resolve('@deepseek-ai/dsh-app-boot');
const br=createRequire(boot);
console.log(JSON.stringify({boot,nodeVersion:process.versions.node,version:br('@deepseek-ai/dsh-app-boot/package.json').version}));`
  const result = run(runtime.command, [...runtime.args, '-e', script], {
    env: runtime.env, encoding: 'utf8', timeout: 30000, windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error('无法读取所选 DSH 运行时：' + (result.error?.message || result.stderr || result.status))
  let report
  try { report = JSON.parse(result.stdout.trim()) } catch { throw new Error('DSH 运行时没有返回有效版本信息') }
  if (!report.boot || !report.version) throw new Error('DSH 运行时缺少入口或版本信息')
  assertCompatibleDshVersion(report.version, 'desktop', report.nodeVersion || '')
  return { ...runtime, boot: report.boot, version: report.version, env: { ...runtime.env, DSH_BOOT_MODULE: report.boot } }
}
