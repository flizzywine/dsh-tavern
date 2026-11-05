import { preserveInstallationFonts } from './preserve-font-assets.mjs'
import officialDesktopRuntime from './official-desktop-runtime.cjs'
import { beginDesktopProfileInstallation } from './desktop-profile-installation.mjs'
import { ensureInitialTavernShortcut } from '../tavern-plugin/packages/dsh-profile-bridge/lib/shortcut.mjs'
import { importUserHome } from './import-user-home.mjs'
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
import { patchChatAnswerStep } from './chat-answer-step-patch.mjs'
import { installPluginDependencies, resolveHostDependencies } from './plugin-dependencies.mjs'
import { installBundledSceneImagePlugin } from './bundled-scene-image-plugin.mjs'
import { isAsarPath } from './desktop-host-paths.mjs'
import { repairDirectoryLinksSync } from './portable-fs.mjs'
import { migrateLegacyTavernData, resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'
import { beginProfileConfigurationUpdate, loadProfileManifest, mergeProfileManifest, prepareProfilePatch, prepareProfileWorkspace, syncProfileDependencyPatches } from './profile-configuration.mjs'
import { ensureSidebarDefaults } from './launcher-settings.mjs'
import { assertProfileBundlesLoad } from './profile-bundle-check.mjs'
import { INSTALL_HOSTS, SOURCE_ROOT, DSH_ROOT, BACKUP_ROOT, writeInstallationFile, LEGACY_DSH_ROOT, CLI_RUNTIME_ROOT, RUNTIME_HOST, PROFILE_DIR, LOG_DIR, SCRIPT_PATH, PROFILE, RELEASE_FILE, DEFAULT_COMMIT_URL, REQUIRED_SOURCE_FILES, findDshCommand, pinnedDesktopDsh, requireCommand, run, runInstallCommand, runInstallDsh } from './launcher-environment.mjs'

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
  if (host === 'desktop') {
    manifest.dshTavern.officialDesktop = true
    manifest.dshTavern.profileBridge = true
    manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-profile-bridge'])]
    manifest.dependencies['dsh-profile-bridge'] = `link:${path.join(pluginPath, 'packages/dsh-profile-bridge').replaceAll(path.sep, '/')}`
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

function existingProfileSource(profileDir = PROFILE_DIR) {
  const manifest = path.join(profileDir, 'package.json')
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
  add(existingProfileSource(path.join(DSH_ROOT, 'profiles', 'tavern')))
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
    // 源码里自带的运行清单就记着这次安装对应的提交号；手机/内网常常连不上
    // GitHub，先本地取，能在没有网络时也留下安装记录（否则“检查更新”会一直
    // 报“无法确认当前构建或提交先后”）。
    try {
      const metadata = JSON.parse(readFileSync(path.join(sourceRoot, 'dsh-tavern-runtime.json'), 'utf8').replace(/^\uFEFF/, ''))
      const revision = String(metadata?.revision || '')
      if (/^[0-9a-f]{40}$/i.test(revision)) commit = revision
    } catch { /* 清单缺失或损坏时继续走网络 */ }
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

export async function installProfile(host = RUNTIME_HOST, { guiRoot } = {}) {
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
    const receipt = await installProfileOwned(host, { attemptId, runInstall, runDsh, guiRoot })
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

async function installProfileOwned(host, { attemptId, runInstall, runDsh, guiRoot }) {
  requireCommand('node', '请安装 Node.js 22.19 或更高版本（DSH 0.2.2 起需要 24.9 或更高版本）')
  requireCommand('pnpm', '请运行 npm install -g pnpm')
  verifySource()
  if (host === 'cli' && existsSync(path.join(LOG_DIR, 'tavern.pid.json'))) await stopService()
  if (host === 'cli' && migrateCliHome({ source: LEGACY_DSH_ROOT, target: DSH_ROOT })) {
    console.log(`已复制旧 CLI 配置与游戏数据到 ${DSH_ROOT}；原数据保持不变。`)
  }
  const runtime = host === 'cli' ? await installCliRuntime({ root: CLI_RUNTIME_ROOT, run: runInstall }) : null
  if (runtime?.reused) console.log('已复用版本匹配且可启动的独立 DSH，无需重新下载。')
  let bridge
  try {
    const dsh = runtime?.command || pinnedDesktopDsh(host)?.bootstrap || findDshCommand(host)
    const dshVersion = extractDshVersion(await runDsh(dsh, ['--version'], { capture: true, host, timeoutMs: 30_000 }))
    assertCompatibleDshVersion(dshVersion, host)
    console.log(dshCompatibilityNotice(dshVersion, host))

    if (host === 'desktop' && process.env.DSH_TAVERN_IMPORT_HOME) {
      const imported = importUserHome({ source: process.env.DSH_TAVERN_IMPORT_HOME, target: DSH_ROOT })
      console.log(`${imported.alreadyImported ? '已继承过该目录，保留当前进度' : '旧目录数据继承完成'}；双方备份：${imported.backup}`)
    }
    if (host === 'desktop') {
      bridge = beginDesktopProfileInstallation({ home: DSH_ROOT, sourceRoot: SOURCE_ROOT, guiRoot })
      if (bridge) console.log(`${bridge.refreshOnly ? '原版切换组件备份' : 'Profile 完整备份'}：${bridge.backup}`)
    }
    mkdirSync(PROFILE_DIR, { recursive: true })
    mkdirSync(LOG_DIR, { recursive: true })
    const dataRoot = resolveTavernDataRoot({ dshHome: DSH_ROOT })
    const migration = await migrateLegacyTavernData({
      targetRoot: dataRoot,
      backupRoot: path.join(BACKUP_ROOT, 'dsh-tavern-data-upgrade'),
      legacyRoots: legacyDataRoots(),
    })
    for (const directory of ['cards', 'chats', 'scripts', 'sources', 'skills', 'diffs']) {
      mkdirSync(path.join(dataRoot, directory), { recursive: true })
    }
    await preserveInstallationFonts(SOURCE_ROOT, { dataRoot, androidBackups: host === 'android' })
    await ensureUserExtensions(dataRoot)
    if (migration.migratedSources > 0) console.log(`已迁移 ${migration.migratedSources} 处旧数据；冲突保留 ${migration.conflicts} 个。`)

    const hostDependencies = await installPluginDependencies({ pluginDirectory: path.join(SOURCE_ROOT, 'tavern-plugin'), dsh, host, run: runInstall })
    for (const dependency of hostDependencies) console.log(`复用当前 DSH 依赖：${dependency.name} ${dependency.version}`)

    // 安装内置固定版本的剧情生图插件：只读发行包里随附的副本，全程不联网、不拉 latest。
    // 已装同一插件的旧版时就地升级代码、保留数据；更新的版本、别的来源和残缺目录不动。
    // 失败不阻断 Tavern 安装 —— 插件装不上只是少了接管方，Tavern 本身照常可用。
    try {
      const bundledPlugin = installBundledSceneImagePlugin({ sourceRoot: SOURCE_ROOT, dataRoot, profileDir: PROFILE_DIR })
      if (bundledPlugin.action === 'installed') console.log(`已内置剧情生图插件 ${bundledPlugin.version}：${bundledPlugin.target}`)
      else if (bundledPlugin.action === 'upgraded') console.log(`已把剧情生图插件从 ${bundledPlugin.installedVersion} 升级到 ${bundledPlugin.version}：${bundledPlugin.target}`)
      else console.log(`内置剧情生图插件：${bundledPlugin.reason || bundledPlugin.action}`)
      if (bundledPlugin.hint) console.warn('[Tavern 插件] ' + bundledPlugin.hint)
    } catch (error) {
      console.warn('[Tavern 插件] 内置剧情生图插件安装失败（不影响 Tavern 使用）：' + (error?.message || error))
    }
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
      // pnpm keeps an existing link whose target text matches, so untraversable Windows links
      // (they stop the desktop host at startup) must be replaced before it runs.
      for (const directory of [PROFILE_DIR, bridge?.refreshOnly ? null : bridge?.desktopStage].filter(Boolean)) {
        for (const link of repairDirectoryLinksSync(path.join(directory, 'node_modules'))) console.log(`已修复无法访问的依赖链接：${link}`)
      }
      // This generated profile changes dependencies and patch settings on upgrade.
      // Its previous lockfile is not the source repository's frozen lockfile.
      await runInstall('pnpm', ['install', '--no-frozen-lockfile'], { cwd: PROFILE_DIR })
      if (host === 'desktop') await runInstall('node', [path.join(SOURCE_ROOT, 'bin', 'validate-desktop-profile.mjs')], { label: '验证桌面版配置', timeoutMs: 60_000 })
      else {
        await runDsh(dsh, ['--profile', PROFILE, '--dump-config'], { host, timeoutMs: 60_000 })
        // --dump-config passes even when DSH would skip a bundle at boot; the desktop validator already checks this.
        await assertProfileBundlesLoad({ dsh, host, profileDir: PROFILE_DIR, managedBundles: configuration.manifest.dshTavern.managedBundles })
      }
      // --dump-config never imports the plugin; a partial node_modules would only fail after restart.
      assertRuntimeDependencies(SOURCE_ROOT)
      ensureSidebarDefaults()
      const [theme] = resolveHostDependencies({ dsh, host, requiredExports: { '@deepseek-ai/dsh-client-ui-theme': null } })
      // 0.2.0-rc.2 适配：桌面把 dsh-client-ui-theme 打进 app.asar（只读归档），纯 Node 既读不到
      // 也改不了，字号补丁在 0.2.0 桌面上不可用。这里明确跳过并说明，而不是让
      // patchThemeFontLimit 抛错、被下面的 catch 捕获后 rollback 整个安装。
      if (isAsarPath(theme.directory)) console.log('0.2.0 桌面把 dsh-client-ui-theme 放在 app.asar 内（只读归档），字号上限补丁跳过；界面字号仍以宿主上限为准。')
      else {
        const patched = patchThemeFontLimit(theme.directory)
        if (patched === null) console.log('当前 DSH 的字号设置与补丁不符，已跳过；界面字号仍以宿主上限为准。')
        else if (patched) console.log('已将 DSH 原有字号上限放宽到 32px。')
      }
      const [chat] = resolveHostDependencies({ dsh, host, requiredExports: { '@deepseek-ai/dsh-client-ui-chat': null } })
      // An asar host is read-only: the page applies the same patch when the chat view loads
      // (tavern-plugin/lib/domain/chat-answer-boot-patch.js). A mismatch is skipped, never rolled back.
      if (!isAsarPath(chat.directory)) {
        const patched = patchChatAnswerStep(chat.directory)
        if (patched === null) console.log('当前 DSH 的对话界面与回复步骤补丁不符，已跳过。')
        else if (patched) console.log('已修正 DSH 对话界面：整理过正文的回合不再被当作过程收起。')
      }
      if (bridge) {
        // Refresh publication is reversible until the installation receipt exists.
        // Validate the newly published independent bridge, not its stale predecessor.
        if (bridge.refreshOnly) bridge.finish()
        await runInstall('node', [path.join(SOURCE_ROOT, 'bin', 'validate-desktop-profile.mjs'), bridge.desktopStage], { label: '验证原版 Desktop 切换入口', timeoutMs: 60_000 })
        if (!bridge.refreshOnly) bridge.finish()
      }
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

    writeInstallationFile({ host, dshHome: DSH_ROOT })
    runtime?.commit()
    const receipt = await recordInstallationReceipt({ sourceRoot: SOURCE_ROOT, dshHome: DSH_ROOT, host, attemptId, bridgeUpdateId: bridge?.bridgeUpdateId })
    bridge?.commit()
    if (host === 'desktop') {
      try {
        const shortcut = ensureInitialTavernShortcut({ paths: { home: DSH_ROOT, profilesDir: path.join(DSH_ROOT, 'profiles') }, runner: pinnedDesktopDsh(host)?.executable || officialDesktopRuntime.discover() })
        if (!shortcut.skipped) console.log(`桌面快捷方式已就绪：${shortcut.path}`)
      } catch (error) {
        console.warn(`未能添加桌面快捷方式，可稍后在设置中手动添加：${error?.message || error}`)
      }
    }
    console.log('DSH Tavern 已安装。')
    console.log(host === 'cli' ? `已安装独立 DSH ${dshVersion}：${CLI_RUNTIME_ROOT}；不使用全局 DSH。` : `已复用当前 DSH ${dshVersion} 的本地依赖；未升级或降级宿主。`)
    if (host === 'desktop') {
      console.log(`请重启官方桌面版 DeepSeek Harness，酒馆已安装到 ${path.basename(PROFILE_DIR)} 配置；原 Tavern 数据目录保持不变。`)
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
    if (!error.unsafeToRetry) { bridge?.rollback(); runtime?.rollback() }
    throw error
  }
}
