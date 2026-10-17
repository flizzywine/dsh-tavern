import { randomUUID } from 'node:crypto'
import installationState from './installation-state.cjs'
import { recordInstallationReceipt } from './installation-receipt.mjs'
import { assertRuntimeDependencies } from './runtime-dependencies.mjs'
import { createUpdateState } from './update-state.mjs'
import { recordUpdateDiagnostic } from './update-diagnostics.mjs'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stopService } from './service-lifecycle.mjs'
import { installCliRuntime, migrateCliHome } from './cli-runtime.mjs'
import { extractDshVersion, assertCompatibleDshVersion, dshCompatibilityNotice } from './dsh-compatibility.mjs'
import { patchThemeFontLimit } from './theme-font-limit.mjs'
import { installPluginDependencies, resolveHostDependencies } from './plugin-dependencies.mjs'
import { isAsarPath } from './desktop-host-paths.mjs'
import { migrateLegacyTavernData, resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'
import { beginProfileConfigurationUpdate, mergeDesktopLegacyProfile, mergeProfilePatchTexts, loadProfileManifest, mergeProfileManifest, prepareProfilePatch, prepareProfileWorkspace, syncProfileDependencyPatches } from './profile-configuration.mjs'
import { ensureSidebarDefaults } from './launcher-settings.mjs'
import { INSTALL_HOSTS, SOURCE_ROOT, DSH_ROOT, LEGACY_DSH_ROOT, CLI_RUNTIME_ROOT, RUNTIME_HOST, PROFILE_DIR, LOG_DIR, SCRIPT_PATH, PROFILE, RELEASE_FILE, DEFAULT_COMMIT_URL, REQUIRED_SOURCE_FILES, findDshCommand, pinnedDesktopDsh, requireCommand, run, runInstallCommand, runInstallDsh } from './launcher-environment.mjs'

// Own installation transaction and legacy-source discovery. Desktop never installs a CLI shim.
export { extractDshVersion } from './dsh-compatibility.mjs'

export function parseInstallHost(args = []) {
  let host = RUNTIME_HOST
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
  let current = loadProfileManifest({ profileDir: PROFILE_DIR })
  if (current.name && current.name !== 'dsh-profile-tavern' && !(host === 'desktop' && current.name === 'dsh-profile-desktop')) {
    throw new Error(`目标 profile 已属于其他项目：${current.name}`)
  }

  const oldProfile = path.join(DSH_ROOT, 'profiles', 'tavern')
  const migrateDesktop = host === 'desktop' && !current.dshTavern?.officialDesktop
  const legacy = migrateDesktop ? loadProfileManifest({ profileDir: oldProfile }) : {}
  if (migrateDesktop) current = mergeDesktopLegacyProfile(current, legacy)
  const pluginPath = path.join(SOURCE_ROOT, 'tavern-plugin')
  const manifest = mergeProfileManifest({
    source,
    current,
    pluginPath,
    dataRoot: resolveTavernDataRoot({ dshHome: DSH_ROOT }),
    host,
    dshVersion,
  })
  let patchText = prepareProfilePatch({
    profileDir: PROFILE_DIR,
    templateText: readFileSync(path.join(SOURCE_ROOT, 'cordis.patch.yml'), 'utf8'),
    legacyManagedText: readFileSync(path.join(SOURCE_ROOT, 'config', 'legacy-profile-patch-v0.6.yml'), 'utf8'),
    profileConfigurationVersion: current.dshTavern && current.dshTavern.profileConfigurationVersion,
  })
  if (host === 'desktop') manifest.dshTavern.officialDesktop = true
  if (migrateDesktop && existsSync(path.join(oldProfile, 'cordis.patch.yml'))) {
    const oldPatch = prepareProfilePatch({ profileDir: oldProfile, templateText: '[]',
      legacyManagedText: readFileSync(path.join(SOURCE_ROOT, 'config', 'legacy-profile-patch-v0.6.yml'), 'utf8'),
      profileConfigurationVersion: legacy.dshTavern?.profileConfigurationVersion })
      ?? readFileSync(path.join(oldProfile, 'cordis.patch.yml'), 'utf8')
    const currentPatch = patchText ?? readFileSync(path.join(PROFILE_DIR, 'cordis.patch.yml'), 'utf8')
    patchText = mergeProfilePatchTexts(oldPatch, currentPatch)
  }
  return { manifest, patchText }
}

export function renderWindowsLauncher(scriptPath) {
  // cmd.exe may decode batch files with an OEM code page. Keep path data ASCII,
  // then decode inside Node without changing cwd or relying on a fixed layout.
  const encoded = Buffer.from(scriptPath, 'utf8').toString('base64')
  const bootstrap = `const p=Buffer.from('${encoded}','base64').toString('utf8');process.argv.splice(1,0,p);import(require('node:url').pathToFileURL(p).href).catch(e=>{console.error(e.message);process.exitCode=1})`
  return `@echo off\r\nnode -e "${bootstrap}" -- %*\r\n`
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

export async function installProfile(host = RUNTIME_HOST) {
  const attemptId = process.env.DSH_TAVERN_INSTALL_ATTEMPT || randomUUID()
  const lease = installationState.acquireInstallation({ dshHome: DSH_ROOT, sourceRoot: SOURCE_ROOT, host, attemptId })
  let safeToRelease = true
  const state = createUpdateState(path.join(resolveTavernDataRoot({ dshHome: DSH_ROOT }), 'update-status.json'), DSH_ROOT)
  async function stage(name, operation) {
    lease.update({ stage: name, progressAt: Date.now() })
    recordUpdateDiagnostic(resolveTavernDataRoot({ dshHome: DSH_ROOT }), { event: 'installer.stage.started', attemptId, step: name })
    try {
      const result = await operation()
      recordUpdateDiagnostic(resolveTavernDataRoot({ dshHome: DSH_ROOT }), { event: 'installer.stage.succeeded', attemptId, step: name })
      return result
    } catch (error) {
      recordUpdateDiagnostic(resolveTavernDataRoot({ dshHome: DSH_ROOT }), { event: 'installer.stage.failed', attemptId, step: name, error: String(error.message || error) })
      throw error
    }
  }
  const supervisedOptions = () => ({ processDirectory: path.join(lease.lockDir, 'processes', randomUUID()) })
  const runInstall = (command, args, options = {}) => stage(options.label || command, () => runInstallCommand(command, args, { ...options, ...supervisedOptions() }))
  const runDsh = (command, args, options = {}) => stage(args.includes('--dump-config') ? '验证 Tavern 配置' : '读取 DSH 版本', () => runInstallDsh(command, args, { ...options, ...supervisedOptions() }))
  try {
    const receipt = await installProfileOwned(host, { attemptId, runInstall, runDsh })
    // A manual local install is authoritative only after the same complete
    // validation/finalization path succeeds. Nested installs leave final status
    // to their updater, which still has to verify the bootstrap outcome.
    if (lease.created) await state.write({ phase: 'completed', host, attemptId, completedAt: receipt.verifiedAt, requiresRestart: host === 'desktop' }, { attemptId })
  } catch (error) {
    if (error.unsafeToRetry) { safeToRelease = false; lease.retain(String(error.message || error)) }
    if (lease.created) await state.write({ phase: safeToRelease ? 'failed' : 'blocked', host, attemptId, failedAt: Date.now(), repairSince: Date.now(), repairRequired: true, error: String(error.message || error) }, { attemptId })
    throw error
  } finally { if (safeToRelease) lease.release() }
}

async function installProfileOwned(host, { attemptId, runInstall, runDsh }) {
  requireCommand('node', '请安装 Node.js 22.19 或更高版本')
  requireCommand('pnpm', '请运行 npm install -g pnpm')
  verifySource()
  if (host === 'cli' && existsSync(path.join(LOG_DIR, 'tavern.pid.json'))) await stopService()
  if (host === 'cli' && migrateCliHome({ source: LEGACY_DSH_ROOT, target: DSH_ROOT })) {
    console.log(`已复制旧 CLI 配置与游戏数据到 ${DSH_ROOT}；原数据保持不变。`)
  }
  const runtime = host === 'cli' ? await installCliRuntime({ root: CLI_RUNTIME_ROOT, run: runInstall }) : null
  if (runtime?.reused) console.log('已复用版本匹配且可启动的独立 DSH，无需重新下载。')
  try {
    const dsh = runtime?.command || pinnedDesktopDsh(host)?.bootstrap || findDshCommand(host)
    const dshVersion = extractDshVersion(await runDsh(dsh, ['--version'], { capture: true, host, timeoutMs: 30_000 }))
    assertCompatibleDshVersion(dshVersion, host)
    console.log(dshCompatibilityNotice(dshVersion, host))

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

    const hostDependencies = await installPluginDependencies({ pluginDirectory: path.join(SOURCE_ROOT, 'tavern-plugin'), dsh, host, run: runInstall })
    for (const dependency of hostDependencies) console.log(`复用当前 DSH 依赖：${dependency.name} ${dependency.version}`)
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
      const workspaceText = prepareProfileWorkspace(readFileSync(path.join(SOURCE_ROOT, 'pnpm-workspace.yaml'), 'utf8'), configuration.manifest)
      writeFileSync(path.join(PROFILE_DIR, 'pnpm-workspace.yaml'), workspaceText)
      syncProfileDependencyPatches({ sourceRoot: SOURCE_ROOT, profileDir: PROFILE_DIR, workspaceText })
      // This generated profile changes dependencies and patch settings on upgrade.
      // Its previous lockfile is not the source repository's frozen lockfile.
      await runInstall('pnpm', ['install', '--no-frozen-lockfile'], { cwd: PROFILE_DIR })
      if (host === 'desktop') await runInstall('node', [path.join(SOURCE_ROOT, 'bin', 'validate-desktop-profile.mjs')], { label: '验证官方 Desktop 配置', timeoutMs: 60_000 })
      else await runDsh(dsh, ['--profile', PROFILE, '--dump-config'], { host, timeoutMs: 60_000 })
      // --dump-config never imports the plugin; a partial node_modules would only fail after restart.
      assertRuntimeDependencies(SOURCE_ROOT)
      ensureSidebarDefaults()
      const [theme] = resolveHostDependencies({ dsh, host, requiredExports: { '@deepseek-ai/dsh-client-ui-theme': null } })
      // 0.2.0-rc.2 适配：桌面把 dsh-client-ui-theme 打进 app.asar（只读归档），纯 Node 既读不到
      // 也改不了，字号补丁在 0.2.0 桌面上不可用。这里明确跳过并说明，而不是让
      // patchThemeFontLimit 抛错、被下面的 catch 捕获后 rollback 整个安装。
      if (isAsarPath(theme.directory)) console.log('0.2.0 桌面把 dsh-client-ui-theme 放在 app.asar 内（只读归档），字号上限补丁跳过；界面字号仍以宿主上限为准。')
      else if (patchThemeFontLimit(theme.directory)) console.log('已将 DSH 原有字号上限放宽到 32px。')
      transaction.commit()
    } catch (error) {
      if (!error.unsafeToRetry) await transaction.rollback()
      throw error
    }
    if (host === 'cli') installCommand()
    try {
      await recordInstalledRelease()
    } catch (error) {
      console.warn(`未能记录安装提交号，不影响本次安装：${String(error?.message || error)}`)
    }

    writeFileSync(path.join(SOURCE_ROOT, '.dsh-tavern-local.json'), JSON.stringify({ host, dshHome: DSH_ROOT }) + '\n')
    runtime?.commit()
    const receipt = await recordInstallationReceipt({ sourceRoot: SOURCE_ROOT, dshHome: DSH_ROOT, host, attemptId })
    console.log('DSH Tavern 已安装。')
    console.log(host === 'cli' ? `已安装独立 DSH ${dshVersion}：${CLI_RUNTIME_ROOT}；不使用全局 DSH。` : `已复用当前 DSH ${dshVersion} 的本地依赖；未升级或降级宿主。`)
    if (host === 'desktop') {
      console.log('请重启官方 DeepSeek Harness，酒馆已安装到 desktop 配置；原 Tavern 数据目录保持不变。')
    } else if (host === 'android') {
      console.log('Android Tavern Profile 已配置。')
    } else {
      console.log('启动：dsh-tavern start')
    }
    if (host === 'cli' && process.platform === 'win32') {
      console.log('如果当前 PowerShell 尚未识别新命令，也可以在仓库目录运行：pnpm run start:tavern')
    }
    return receipt
  } catch (error) {
    if (!error.unsafeToRetry) runtime?.rollback()
    throw error
  }
}
