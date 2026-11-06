import { copyFileSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { adaptedDshVersion } from './dsh-compatibility.mjs'
import { copyTreeSync, removeTreeSync } from './portable-fs.mjs'

export function cliRuntimeCommand(root, platform = process.platform) {
  return platform === 'win32' ? path.join(root, 'dsh.cmd') : path.join(root, 'bin', 'dsh')
}

// Validate the private CLI before reuse; never search PATH for a global DSH.
export function healthyCliRuntime(root, platform = process.platform) {
  try {
    const packageFile = path.join(root, platform === 'win32' ? 'node_modules/@deepseek-ai/dsh/package.json' : 'lib/node_modules/@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
    if (pkg.version !== adaptedDshVersion || !bin || !existsSync(cliRuntimeCommand(root, platform))) return false
    const result = spawnSync(process.execPath, [path.resolve(path.dirname(packageFile), bin), '--version'], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    })
    return !result.error && result.status === 0 && result.stdout.trim() === adaptedDshVersion
  } catch { return false }
}

export async function installCliRuntime({ root, run, platform = process.platform, force = process.env.DSH_TAVERN_REINSTALL_RUNTIME === '1' }) {
  if (!force && healthyCliRuntime(root, platform)) {
    return { command: cliRuntimeCommand(root, platform), reused: true, commit() {}, rollback() {} }
  }
  mkdirSync(path.dirname(root), { recursive: true })
  const staging = mkdtempSync(`${root}.install-`)
  const backup = `${staging}.previous`
  let promoted = false
  let backedUp = false
  let settled = false
  try {
    // npm's global install ignores a project's lock and resolves prerelease ranges
    // again. Install the reviewed dependency graph locally inside the private root.
    const installRoot = platform === 'win32' ? staging : path.join(staging, 'lib')
    mkdirSync(installRoot, { recursive: true })
    const manifest = JSON.parse(readFileSync(new URL('../config/cli-runtime/package.json', import.meta.url), 'utf8'))
    if (manifest.dependencies['@deepseek-ai/dsh'] !== adaptedDshVersion) throw new Error('独立 DSH 依赖锁与适配版本不一致。')
    for (const name of ['package.json', 'package-lock.json']) copyFileSync(new URL('../config/cli-runtime/' + name, import.meta.url), path.join(installRoot, name))
    await run('npm', ['ci', '--prefix', installRoot, '--no-audit', '--no-fund', '--registry', process.env.DSH_TAVERN_NPM_REGISTRY || 'https://registry.npmmirror.com'])
    const installedPackage = path.join(installRoot, 'node_modules/@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(installedPackage, 'utf8'))
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
    if (!bin) throw new Error('下载的独立 DSH 缺少命令入口。')
    const entry = path.resolve(path.dirname(installedPackage), bin)
    const command = cliRuntimeCommand(staging, platform)
    mkdirSync(path.dirname(command), { recursive: true })
    if (platform === 'win32') {
      const relative = path.relative(staging, entry).split(path.sep).join('\\')
      writeFileSync(command, '@echo off\r\nnode "%~dp0' + relative + '" %*\r\n')
    } else symlinkSync(path.relative(path.dirname(command), entry), command)
    const packageFile = platform === 'win32'
      ? path.join(staging, 'node_modules/@deepseek-ai/dsh/package.json')
      : path.join(staging, 'lib/node_modules/@deepseek-ai/dsh/package.json')
    if (JSON.parse(readFileSync(packageFile, 'utf8')).version !== adaptedDshVersion || !healthyCliRuntime(staging, platform)) {
      throw new Error('下载的独立 DSH 版本或入口不正确。')
    }
    if (existsSync(root)) { renameSync(root, backup); backedUp = true }
    renameSync(staging, root)
    promoted = true
    return {
      command: cliRuntimeCommand(root, platform),
      commit() { settled = true; if (backedUp) removeTreeSync(backup) },
      rollback() {
        if (settled) return
        settled = true
        removeTreeSync(root)
        if (backedUp) renameSync(backup, root)
      },
    }
  } catch (error) {
    if (error.unsafeToRetry) throw error
    if (!promoted && backedUp) renameSync(backup, root)
    removeTreeSync(staging)
    throw error
  }
}

// Copy only a previous CLI installation, never adopt Desktop/DSHA data.
// Originals remain intact; a completed snapshot is never recopied on repair.
export function migrateCliHome({ source, target }) {
  if (path.resolve(source) === path.resolve(target)) return false
  const marker = path.join(target, '.cli-home-migrated.json')
  if (existsSync(marker)) return false
  const manifestFile = path.join(source, 'profiles/tavern/package.json')
  if (!existsSync(manifestFile)) return false
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.dshTavern?.host !== 'cli') return false
  if (existsSync(path.join(source, 'logs/tavern.pid.json'))) {
    const launcher = path.join(manifest.dshTavern.source || '', 'bin/dsh-tavern.mjs')
    if (!existsSync(launcher)) throw new Error('请先停止旧 CLI 酒馆，再迁移数据；找不到旧启动器。')
    const stopped = spawnSync(process.execPath, [launcher, 'stop'], {
      stdio: 'inherit', env: { ...process.env, DSH_HOME: source, DSH_TAVERN_CLI_HOME: source, DSH_TAVERN_RUNTIME_HOST: 'cli' },
    })
    if (stopped.error || stopped.status !== 0) throw new Error('停止旧 CLI 失败，尚未复制数据。请先停止旧酒馆后重试。')
  }
  mkdirSync(target, { recursive: true })
  const entries = ['profile-data/tavern', 'settings.yaml', '.credentials.yaml', '.openai-codex-auth.json', '.agent-presets', 'attachments']
  // Only copy configuration files, not host dependency links/node_modules.
  entries.push('profiles/tavern/package.json', 'profiles/tavern/cordis.patch.yml')
  for (const entry of entries) {
    const from = path.join(source, entry), to = path.join(target, entry)
    if (!existsSync(from) || existsSync(to)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    const staging = `${to}.migration-${process.pid}`
    try {
      copyTreeSync(from, staging, { dereference: true })
      renameSync(staging, to)
    } finally { removeTreeSync(staging) }
  }
  writeFileSync(marker, JSON.stringify({ source, migratedAt: new Date().toISOString() }) + '\n')
  return true
}
