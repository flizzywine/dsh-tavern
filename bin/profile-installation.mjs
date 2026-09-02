import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dshCompatibilityNotice } from './dsh-compatibility.mjs'
import { installPluginDependencies } from './plugin-dependencies.mjs'
import { installBundledImagePlugin } from './bundled-image-plugin.mjs'
import { migrateLegacyTavernData, resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'
import { beginProfileConfigurationUpdate, loadProfileManifest, mergeProfileManifest, prepareProfilePatch, syncProfileDependencyPatches } from './profile-configuration.mjs'
import { ensureSidebarDefaults } from './launcher-settings.mjs'
import { INSTALL_HOSTS, SOURCE_ROOT, DSH_ROOT, PROFILE_DIR, LOG_DIR, SCRIPT_PATH, PROFILE, RELEASE_FILE, DEFAULT_COMMIT_URL, REQUIRED_SOURCE_FILES, findDshCommand, requireCommand, run, runDsh } from './launcher-environment.mjs'

// Own installation transaction and legacy-source discovery. Desktop never installs a CLI shim.
export function extractDshVersion(output) {
  const match = String(output || '').match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  if (!match) throw new Error('无法识别当前 DSH 版本。')
  return match[1]
}

export function parseInstallHost(args = []) {
  let host = 'cli'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--host') {
      host = args[index + 1]
      index += 1
    } else if (argument.startsWith('--host=')) {
      host = argument.slice('--host='.length)
    } else {
      throw new Error(`无法识别的安装参数：${argument}`)
    }
  }
  if (!INSTALL_HOSTS.has(host)) throw new Error(`不支持的安装宿主：${host || '空值'}`)
  return host
}

function verifySource() {
  for (const relativePath of REQUIRED_SOURCE_FILES) {
    const absolutePath = path.join(SOURCE_ROOT, relativePath)
    if (!existsSync(absolutePath)) {
      throw new Error(`安装源不完整，缺少：${absolutePath}`)
    }
  }
}

function prepareProfileConfiguration(host, dshVersion) {
  const source = JSON.parse(readFileSync(path.join(SOURCE_ROOT, 'package.json'), 'utf8'))
  const current = loadProfileManifest({ profileDir: PROFILE_DIR })
  if (current.name && current.name !== 'dsh-profile-tavern') {
    throw new Error(`目标 profile 已属于其他项目：${current.name}`)
  }

  const pluginPath = path.join(SOURCE_ROOT, 'tavern-plugin')
  const manifest = mergeProfileManifest({
    source,
    current,
    pluginPath,
    dataRoot: resolveTavernDataRoot({ dshHome: DSH_ROOT }),
    host,
    dshVersion,
  })
  const patchText = prepareProfilePatch({
    profileDir: PROFILE_DIR,
    templateText: readFileSync(path.join(SOURCE_ROOT, 'cordis.patch.yml'), 'utf8'),
    legacyManagedText: readFileSync(path.join(SOURCE_ROOT, 'config', 'legacy-profile-patch-v0.6.yml'), 'utf8'),
    profileConfigurationVersion: current.dshTavern && current.dshTavern.profileConfigurationVersion,
  })
  return { manifest, patchText }
}

export function renderWindowsLauncher(scriptPath) {
  return `@echo off\r\nnode "${scriptPath.replaceAll('"', '""')}" %*\r\n`
}

function pathEntries() {
  return (process.env.PATH || '').split(path.delimiter).map((entry) => path.resolve(entry).toLowerCase())
}

function pathExistsNoFollow(targetPath) {
  try {
    lstatSync(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function installCommand() {
  if (process.platform === 'win32') {
    let binDir = process.env.DSH_TAVERN_BIN_DIR || process.env.PNPM_HOME
    if (!binDir) {
      try {
        binDir = run('pnpm', ['bin', '--global'], { capture: true })
      } catch {
        binDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'pnpm')
      }
    }
    mkdirSync(binDir, { recursive: true })
    const commandPath = path.join(binDir, 'dsh-tavern.cmd')
    if (pathExistsNoFollow(commandPath)) {
      if (readFileSync(commandPath, 'utf8') === renderWindowsLauncher(SCRIPT_PATH)) return
      const backupPath = `${commandPath}.backup.${timestamp()}`
      renameSync(commandPath, backupPath)
      console.log(`已备份原命令：${backupPath}`)
    }
    writeFileSync(commandPath, renderWindowsLauncher(SCRIPT_PATH), 'utf8')
    console.log(`已安装命令：${commandPath}`)
    if (!pathEntries().includes(path.resolve(binDir).toLowerCase())) {
      console.log(`提示：请把 ${binDir} 加入 PATH，然后重新打开 PowerShell。`)
    }
    return
  }

  const binDir = process.env.DSH_TAVERN_BIN_DIR || path.join(os.homedir(), '.local', 'bin')
  const commandPath = path.join(binDir, 'dsh-tavern')
  mkdirSync(binDir, { recursive: true })

  if (pathExistsNoFollow(commandPath)) {
    try {
      if (readlinkSync(commandPath) === SCRIPT_PATH) return
    } catch {
      // Existing regular file, handled by the backup below.
    }
    const backupPath = `${commandPath}.backup.${timestamp()}`
    renameSync(commandPath, backupPath)
    console.log(`已备份原命令：${backupPath}`)
  }
  symlinkSync(SCRIPT_PATH, commandPath)
  console.log(`已安装命令：${commandPath}`)
  if (!pathEntries().includes(path.resolve(binDir).toLowerCase())) {
    console.log(`提示：请把 ${binDir} 加入 PATH，然后重新打开终端。`)
  }
}

function timestamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function installedCommandSource() {
  if (process.platform === 'win32') return null
  const commandPath = path.join(process.env.DSH_TAVERN_BIN_DIR || path.join(os.homedir(), '.local', 'bin'), 'dsh-tavern')
  try {
    const target = readlinkSync(commandPath)
    const script = path.resolve(path.dirname(commandPath), target)
    return path.resolve(path.dirname(script), '..')
  } catch {
    return null
  }
}

function existingProfileSource() {
  const manifest = path.join(PROFILE_DIR, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    const source = JSON.parse(readFileSync(manifest, 'utf8'))?.dshTavern?.source
    return typeof source === 'string' && source !== '' ? path.resolve(source) : null
  } catch {
    return null
  }
}

function legacyDataRoots() {
  const roots = []
  const seen = new Set()
  function add(candidate, explicitData = false) {
    if (typeof candidate !== 'string' || candidate === '') return
    const data = path.resolve(explicitData ? candidate : path.join(candidate, 'data'))
    if (seen.has(data) || !existsSync(data)) return
    seen.add(data)
    roots.push({ path: data, label: path.basename(path.dirname(data)) })
  }
  add(installedCommandSource())
  add(existingProfileSource())
  add(SOURCE_ROOT)
  for (const candidate of (process.env.DSH_TAVERN_LEGACY_DATA || '').split(path.delimiter)) add(candidate, true)
  return roots
}

export async function recordInstalledRelease(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT)
  const dshRoot = path.resolve(options.dshRoot || DSH_ROOT)
  if (existsSync(path.join(sourceRoot, '.git'))) return { source: 'git', commit: '' }
  const releasePath = path.join(sourceRoot, RELEASE_FILE)
  if (existsSync(releasePath)) return JSON.parse(readFileSync(releasePath, 'utf8').replace(/^\uFEFF/, ''))
  let commit = String(options.targetCommit || process.env.DSH_TAVERN_TARGET_COMMIT || '')
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    const fetchHead = path.join(dshRoot, 'source-cache', 'dsh-tavern.git', 'FETCH_HEAD')
    if (existsSync(fetchHead)) commit = readFileSync(fetchHead, 'utf8').match(/^[0-9a-f]{40}/i)?.[0] || ''
  }
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    const request = options.request || fetch
    const response = await request(options.commitUrl || process.env.DSH_TAVERN_COMMIT_URL || DEFAULT_COMMIT_URL, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`GitHub commit HTTP ${response.status}`)
    commit = String((await response.json())?.sha || '')
  }
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('GitHub 返回的提交号无效')
  const release = { commit, installedAt: new Date().toISOString() }
  const temporary = `${releasePath}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(release, null, 2)}\n`, 'utf8')
  renameSync(temporary, releasePath)
  return release
}

export async function installProfile(host = 'cli') {
  const dsh = findDshCommand()
  requireCommand('node', '请安装 Node.js 22.19 或更高版本')
  requireCommand('pnpm', '请运行 npm install -g pnpm')
  verifySource()
  const dshVersion = extractDshVersion(runDsh(dsh, ['--version'], { capture: true, host }))
  console.log(dshCompatibilityNotice(dshVersion))

  mkdirSync(PROFILE_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
  const dataRoot = resolveTavernDataRoot({ dshHome: DSH_ROOT })
  const migration = await migrateLegacyTavernData({
    targetRoot: dataRoot,
    backupRoot: path.join(DSH_ROOT, 'backups', 'dsh-tavern-data-upgrade'),
    legacyRoots: legacyDataRoots(),
  })
  for (const directory of ['cards', 'chats', 'scripts', 'sources', 'skills', 'diffs']) {
    mkdirSync(path.join(dataRoot, directory), { recursive: true })
  }
  await ensureUserExtensions(dataRoot)
  if (migration.migratedSources > 0) console.log(`已迁移 ${migration.migratedSources} 处旧数据；冲突保留 ${migration.conflicts} 个。`)

  const hostDependencies = installPluginDependencies({ pluginDirectory: path.join(SOURCE_ROOT, 'tavern-plugin'), dsh, host, run })
  for (const dependency of hostDependencies) console.log(`复用当前 DSH 依赖：${dependency.name} ${dependency.version}`)
  installBundledImagePlugin({ sourceRoot: SOURCE_ROOT, dsh, host })
  const configuration = prepareProfileConfiguration(host, dshVersion)
  const transaction = await beginProfileConfigurationUpdate({
    profileDir: PROFILE_DIR,
    manifest: configuration.manifest,
    patchText: configuration.patchText,
  })
  for (const backup of Object.values(transaction.backups)) {
    if (backup !== null) console.log(`已备份原配置：${backup}`)
  }
  try {
    const workspaceText = readFileSync(path.join(SOURCE_ROOT, 'pnpm-workspace.yaml'), 'utf8')
    copyFileSync(path.join(SOURCE_ROOT, 'pnpm-workspace.yaml'), path.join(PROFILE_DIR, 'pnpm-workspace.yaml'))
    syncProfileDependencyPatches({ sourceRoot: SOURCE_ROOT, profileDir: PROFILE_DIR, workspaceText })
    run('pnpm', ['--dir', PROFILE_DIR, 'install'])
    runDsh(dsh, ['--profile', PROFILE, '--dump-config'], { stdio: 'ignore', host })
    ensureSidebarDefaults()
    transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }
  if (host === 'cli') installCommand()
  try {
    await recordInstalledRelease()
  } catch (error) {
    console.warn(`未能记录安装提交号，不影响本次安装：${String(error?.message || error)}`)
  }

  console.log('DSH Tavern 已安装。')
  console.log(`已复用当前 DSH ${dshVersion} 的本地依赖；未升级或降级 DSH。`)
  if (host === 'desktop') {
    console.log('请重启 DSH Desktop，然后从托盘的 Profile 菜单切换到 tavern。')
  } else if (host === 'android') {
    console.log('Android Tavern Profile 已配置。')
  } else {
    console.log('启动：dsh-tavern start')
  }
  if (host === 'cli' && process.platform === 'win32') {
    console.log('如果当前 PowerShell 尚未识别新命令，也可以在仓库目录运行：pnpm run start:tavern')
  }
}
