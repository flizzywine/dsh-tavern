import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import test from 'node:test'
import { parseDocument } from 'yaml'

import {
  applySidebarDefaults,
  browserOpenCommand,
  decodeUpdateOutput,
  encodeWindowsPowerShellScript,
  ensureSidebarDefaults,
  extractDshVersion,
  isPortOpen,
  isServiceReady,
  needsFrontendBootstrap,
  parseInstallHost,
  parseUpdateOptions,
  resolveUpdateProgram,
  renderWindowsLauncher,
  restartBrowserTarget,
  resolveServicePort,
  updateApplication,
} from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const updateHelperSource = await readFile(new URL('../bin/dsh-tavern-update-helper.mjs', import.meta.url), 'utf8')
const profilePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const managedProfilePatch = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')
const profileConfigurationSource = await readFile(new URL('../bin/profile-configuration.mjs', import.meta.url), 'utf8')
const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tavernPluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
const profileWorkspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

test('Windows launcher quotes paths containing spaces and forwards arguments', () => {
  const launcher = renderWindowsLauncher('D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs')
  assert.equal(
    launcher,
    '@echo off\r\nnode "D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs" %*\r\n',
  )
})

test('安装宿主默认使用 CLI，并明确接受 Desktop 与 Android', () => {
  assert.equal(parseInstallHost([]), 'cli')
  assert.equal(parseInstallHost(['--host', 'desktop']), 'desktop')
  assert.equal(parseInstallHost(['--host', 'android']), 'android')
  assert.equal(parseInstallHost(['--host=cli']), 'cli')
  assert.throws(() => parseInstallHost(['--host', 'unknown']), /不支持的安装宿主/)
  assert.throws(() => parseInstallHost(['--unknown']), /无法识别的安装参数/)
})

test('命令行启动端口默认 3081，安卓环境可显式使用 3088', () => {
  assert.equal(resolveServicePort(undefined), 3081)
  assert.equal(resolveServicePort('3088'), 3088)
  assert.throws(() => resolveServicePort('0'), /1 到 65535/)
  assert.throws(() => resolveServicePort('not-a-port'), /1 到 65535/)
})

test('升级时只用本次启动标识引导一次新页面，之后交给页面自动恢复', () => {
  assert.equal(
    restartBrowserTarget(3081, 'runtime-a b'),
    'http://127.0.0.1:3081/?tavern-boot=runtime-a%20b',
  )
  assert.equal(needsFrontendBootstrap(null), true)
  assert.equal(needsFrontendBootstrap({ version: 0 }), true)
  assert.equal(needsFrontendBootstrap({ version: 1 }), false)
  assert.match(launcherSource, /const target = restartBrowserTarget\(state\.port, state\.runtimeGeneration\)/)
  assert.match(launcherSource, /openBrowserTarget\(target\)/)
  assert.match(launcherSource, /if \(!bootstrapFrontendOnce\(state\)\)/)
  assert.doesNotMatch(launcherSource, /Shift \+ R 强制刷新/)
  assert.deepEqual(browserOpenCommand('http://127.0.0.1:3081/?tavern-boot=x', 'darwin'), {
    command: 'open',
    args: ['http://127.0.0.1:3081/?tavern-boot=x'],
  })
})

test('从 CLI 输出识别 DSH 预发布版本', () => {
  assert.equal(extractDshVersion('0.1.0-rc.7'), '0.1.0-rc.7')
  assert.equal(extractDshVersion('DeepSeek Harness 0.1.1-rc.2\n'), '0.1.1-rc.2')
  assert.throws(() => extractDshVersion('unknown'), /无法识别当前 DSH 版本/)
})

test('Windows update script carries a UTF-8 BOM for Windows PowerShell 5.1', () => {
  for (const source of ["Write-Host '模型设置'", "\uFEFFWrite-Host '模型设置'"]) {
    const encoded = encodeWindowsPowerShellScript(source)
    assert.ok(encoded.startsWith('\uFEFF'))
    assert.match(encoded, /System\.Text\.UTF8Encoding/)
    assert.equal(encoded.match(/Write-Host '模型设置'/g)?.length, 1)
  }
})

test('Windows 更新日志同时识别 UTF-8 与 UTF-16LE', () => {
  assert.equal(decodeUpdateOutput(Buffer.from('更新失败', 'utf8')), '更新失败')
  assert.equal(decodeUpdateOutput(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('更新失败', 'utf16le')])), '更新失败')
})

test('UI 更新参数明确传递宿主、状态文件和启动延迟', () => {
  assert.deepEqual(parseUpdateOptions(['--host', 'desktop', '--status-file', '/tmp/update.json', '--delay=800']), {
    host: 'desktop',
    statusFile: '/tmp/update.json',
    delay: 800,
  })
  assert.deepEqual(parseUpdateOptions(['--host=android']), { host: 'android', statusFile: '', delay: 0 })
  assert.deepEqual(parseUpdateOptions([]), { host: 'cli', statusFile: '', delay: 0 })
  assert.throws(() => parseUpdateOptions(['--host', 'other']), /不支持的安装宿主/)
  assert.throws(() => parseUpdateOptions(['--status-file', 'relative.json']), /绝对路径/)
})

test('Android UI 更新选择专用更新脚本，CLI 与 Desktop 保持原安装器', () => {
  assert.deepEqual(resolveUpdateProgram('android', 'linux', '/app/dsh-tavern'), {
    script: path.join('/app/dsh-tavern', 'android', 'update.sh'),
    command: 'bash',
    args: [path.join('/app/dsh-tavern', 'android', 'update.sh')],
  })
  assert.deepEqual(resolveUpdateProgram('cli', 'linux', '/app/dsh-tavern'), {
    script: path.join('/app/dsh-tavern', 'install.sh'),
    command: 'sh',
    args: [path.join('/app/dsh-tavern', 'install.sh')],
  })
})

test('Windows 更新在 PATH 缺少 PowerShell 时优先使用系统绝对路径', () => {
  const systemPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const program = resolveUpdateProgram('desktop', 'win32', 'C:\\app\\dsh-tavern', {
    env: { SystemRoot: 'C:\\Windows' },
    fileExists: (candidate) => candidate === systemPowerShell,
    commandAvailable: () => false,
  })

  assert.equal(program.command, systemPowerShell)
  assert.deepEqual(program.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
})

test('Windows 更新在 Windows PowerShell 不可用时回退到 PowerShell 7', () => {
  const program = resolveUpdateProgram('cli', 'win32', 'C:\\app\\dsh-tavern', {
    env: {},
    fileExists: () => false,
    commandAvailable: (candidate) => candidate === 'pwsh.exe',
  })

  assert.equal(program.command, 'pwsh.exe')
})

test('Windows 更新找不到任何 PowerShell 时给出手动恢复命令', () => {
  assert.throws(() => resolveUpdateProgram('desktop', 'win32', 'C:\\app\\dsh-tavern', {
    env: {},
    fileExists: () => false,
    commandAvailable: () => false,
  }), /cdn\.jsdelivr\.net\/gh\/flizzywine\/dsh-tavern@main\/install\.ps1/)
})

test('更新器在选择安装器后的任一步骤失败时写入 failed 终态', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-update-runner-'))
  try {
    const statusFile = path.join(root, 'update-status.json')
    await assert.rejects(() => updateApplication({
      host: 'cli', statusFile, delay: 0, sourceRoot: path.join(root, 'missing-source'),
      log: function () {},
    }), /当前安装缺少更新程序/)
    const status = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(status.phase, 'failed')
    assert.equal(status.host, 'cli')
    assert.match(status.error, /当前安装缺少更新程序/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('更新器成功执行并清理临时脚本后写入 completed 终态', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-update-runner-'))
  try {
    const statusFile = path.join(root, 'update-status.json')
    const installerName = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
    const installerSource = process.platform === 'win32' ? 'exit 0\r\n' : '#!/bin/sh\nexit 0\n'
    await writeFile(path.join(root, installerName), installerSource)
    const logs = []
    await updateApplication({ host: 'cli', statusFile, delay: 0, sourceRoot: root, log: function (message) { logs.push(message) } })
    const status = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(status.phase, 'completed')
    assert.equal(status.host, 'cli')
    assert.equal(status.requiresRestart, false)
    assert.deepEqual(logs, ['正在更新 DSH Tavern……'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows UI 更新隐藏 PowerShell 窗口并保持 UTF-8 输出', () => {
  assert.match(launcherSource, /System\.Text\.UTF8Encoding/)
  assert.match(launcherSource, /spawnSync\(command, args, \{[\s\S]*?windowsHide: true,/)
  assert.match(updateHelperSource, /detached: true/)
  assert.match(updateHelperSource, /windowsHide: true/)
})

test('后台更新禁止重复打开浏览器，并用临时日志避免后台进程占住输出管道', () => {
  assert.match(launcherSource, /DSH_TAVERN_NO_OPEN: '1'/)
  assert.match(launcherSource, /stdio: capture \? \['ignore', outputDescriptor, outputDescriptor\] : 'inherit'/)
  assert.doesNotMatch(launcherSource, /stdio: capture \? 'pipe' : 'inherit'/)
})

test('Windows installer compares Node versions without native argument quoting', () => {
  assert.match(windowsInstaller, /\[version\]\$NodeVersionText\.TrimStart\('v'\)/)
  assert.doesNotMatch(windowsInstaller, /node -e/)
})

test('Tavern no longer bundles dsh-codex-connect and removes it from existing profiles', () => {
  assert.equal(rootManifest.dependencies['dsh-codex-connect'], undefined)
  assert.doesNotMatch(JSON.stringify(rootManifest.dsh.profile.bundles), /dsh-codex-connect/)
  assert.match(profileConfigurationSource, /LEGACY_MANAGED_BUNDLES[\s\S]*'dsh-codex-connect'/)
  assert.match(profileConfigurationSource, /LEGACY_MANAGED_DEPENDENCIES[\s\S]*'dsh-codex-connect'/)
})

test('Tavern profile installs Better Sidebar as its right-panel foundation', () => {
  assert.equal(rootManifest.dependencies['dsh-better-sidebar'], '0.15.0')
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-better-sidebar'))
  assert.match(profileConfigurationSource, /managedDependencies/)
})

test('Tavern profile does not auto-install Better Sidebar peer dependencies over DSH built-ins', () => {
  assert.match(profileWorkspace, /^autoInstallPeers:\s*false$/m)
})

test('Tavern profile isolates conversations from other DSH profiles on fresh installs', () => {
  assert.match(managedProfilePatch, /id: session-persistence-jsonl[\s\S]*dshHomePath\('profile-data', 'tavern', 'sessions'\)/)
  assert.match(managedProfilePatch, /id: storage-json[\s\S]*dshHomePath\('profile-data', 'tavern', 'storages'\)/)
  assert.deepEqual(parseDocument(profilePatch).toJS(), [])
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-tavern-plugin'))
  assert.equal(tavernPluginManifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(launcherSource, /prepareProfilePatch/)
  assert.match(unixInstaller, /node "\$\{APP_DIR\}\/bin\/dsh-tavern\.mjs" install --host "\$\{INSTALL_HOST\}"/)
  assert.match(windowsInstaller, /Join-Path \$AppDir 'bin\\dsh-tavern\.mjs'\) install --host \$InstallHost/)
})

test('Tavern sidebar defaults enable resource tabs, Files and text previews', () => {
  const settings = applySidebarDefaults({
    'unrelated-plugin': { enabled: true },
    'dsh-better-sidebar': { openByDefault: false },
  })

  assert.deepEqual(settings['unrelated-plugin'], { enabled: true })
  assert.equal(settings['dsh-better-sidebar'].openByDefault, false)
  assert.equal(settings['dsh-better-sidebar'].defaultWidthPercent, 30)
  assert.deepEqual(settings['dsh-better-sidebar'].tabsEnabled, {
    editor: true,
    git: false,
    subagent: false,
    terminal: false,
    browser: false,
    diff: false,
    'dsh-tavern:resources': true,
    'dsh-tavern:presets': true,
    'dsh-tavern:cards': true,
    'dsh-tavern:status': true,
  })
  assert.deepEqual(settings['dsh-better-sidebar'].viewersEnabled, {
    image: false,
    pdf: false,
    markdown: true,
    html: false,
    code: true,
    'binary-download': false,
  })
  assert.equal(settings['dsh-tavern'].sidebarDefaultsVersion, 8)
})

test('Tavern sidebar restores native Files and text previews during version 5 migration', () => {
  const settings = applySidebarDefaults({
    'dsh-tavern': { sidebarDefaultsVersion: 4 },
    'dsh-better-sidebar': { tabsEnabled: { editor: false, 'dsh-tavern:resources': false }, viewersEnabled: { markdown: false, code: false } },
  })
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled.editor, true)
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:resources'], false)
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:cards'], true)
  assert.equal(settings['dsh-better-sidebar'].viewersEnabled.markdown, true)
  assert.equal(settings['dsh-better-sidebar'].viewersEnabled.code, true)
})

test('Tavern sidebar preserves user choices after version 5 migration', () => {
  const settings = applySidebarDefaults({
    'dsh-tavern': { sidebarDefaultsVersion: 5 },
    'dsh-better-sidebar': { tabsEnabled: { editor: false }, viewersEnabled: { markdown: false, code: false } },
  })
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled.editor, false)
  assert.equal(settings['dsh-better-sidebar'].viewersEnabled.markdown, false)
  assert.equal(settings['dsh-better-sidebar'].viewersEnabled.code, false)
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:boundary-prompts'], undefined)
})

test('Tavern sidebar version 8 migration removes the retired boundary prompt tab', () => {
  const settings = applySidebarDefaults({
    'dsh-tavern': { sidebarDefaultsVersion: 7 },
    'dsh-better-sidebar': { tabsEnabled: { 'dsh-tavern:boundary-prompts': false } },
  })
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:boundary-prompts'], undefined)
})

test('Tavern sidebar migration marker与三个库设置写入 YAML', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-settings-'))
  t.after(async function () { await rm(directory, { recursive: true, force: true }) })
  const settingsPath = path.join(directory, 'settings.yaml')
  await writeFile(settingsPath, 'dsh-better-sidebar:\n  tabsEnabled:\n    editor: false\n', 'utf8')

  assert.equal(ensureSidebarDefaults(settingsPath), true)
  const written = await readFile(settingsPath, 'utf8')
  assert.match(written, /dsh-tavern:\n  sidebarDefaultsVersion: 8/)
  assert.match(written, /editor: true/)
  assert.match(written, /dsh-tavern:resources: true/)
  assert.match(written, /dsh-tavern:cards: true/)
  assert.match(written, /dsh-tavern:presets: true/)
  assert.doesNotMatch(written, /dsh-tavern:boundary-prompts/)
})

test('Tavern applies sidebar migrations before every service start', () => {
  assert.match(launcherSource, /async function startService\(\) \{\s*verifyProfile\(\)\s*ensureSidebarDefaults\(\)/)
})

test('installers accept the installed DSH host without pinning its release', () => {
  assert.match(windowsInstaller, /if \(\$InstallHost -eq 'cli' -and -not \(Test-Command 'pnpm'\)\)/)
  assert.doesNotMatch(windowsInstaller, /RequiredDshVersion|Test-DshVersion/)
  assert.match(windowsInstaller, /@deepseek-ai\/dsh'/)
  assert.match(unixInstaller, /if ! command -v pnpm/)
  assert.doesNotMatch(unixInstaller, /REQUIRED_DSH_VERSION|dsh_version_is_compatible/)
  assert.match(unixInstaller, /"@deepseek-ai\/dsh"/)
  assert.doesNotMatch(launcherSource, /MINIMUM_DSH_VERSION|supportsDshVersion|requireDshVersion/)
})

test('installers default to codeload archives while allowing an override', () => {
  assert.match(windowsInstaller, /DSH_TAVERN_ARCHIVE_URL/)
  assert.match(windowsInstaller, /https:\/\/codeload\.github\.com\/\$Repository\/zip\/refs\/heads\/main/)
  assert.match(unixInstaller, /DSH_TAVERN_ARCHIVE_URL/)
  assert.match(unixInstaller, /https:\/\/codeload\.github\.com\/\$\{REPOSITORY\}\/tar\.gz\/refs\/heads\/main/)
})

test('安装器优先使用持久化 Git 稀疏缓存，并保留完整 ZIP 回退', () => {
  assert.match(windowsInstaller, /source-cache\\dsh-tavern\.git/)
  assert.match(windowsInstaller, /clone --bare --filter=blob:none --depth 1/)
  assert.match(windowsInstaller, /archive --format=zip/)
  assert.match(windowsInstaller, /未检测到可用 Git，正在下载完整 ZIP/)
  assert.match(unixInstaller, /source-cache\/dsh-tavern\.git/)
  assert.match(unixInstaller, /clone --bare --filter=blob:none --depth 1/)
  assert.match(unixInstaller, /archive --format=tar/)
  assert.match(unixInstaller, /未检测到可用 Git，正在下载完整 ZIP/)

  const windowsRuntimePaths = windowsInstaller.match(/\$RuntimePaths = @\(([\s\S]*?)\)/)?.[1] || ''
  const unixRuntimePaths = unixInstaller.match(/RUNTIME_PATHS='([^']+)'/)?.[1] || ''
  for (const paths of [windowsRuntimePaths, unixRuntimePaths]) {
    assert.match(paths, /tavern-plugin/)
    assert.doesNotMatch(paths, /docs|demo|references|tests|\.github/)
  }
})

test('一键更新在依赖检查前复用 Tavern 托管运行时', () => {
  const windowsRuntimePath = windowsInstaller.indexOf('$env:Path = "$RuntimeRoot;$env:Path"')
  const windowsDependencyCheck = windowsInstaller.indexOf('$MissingPackages = @()')
  assert.ok(windowsRuntimePath >= 0)
  assert.ok(windowsRuntimePath < windowsDependencyCheck)

  const unixRuntimePath = unixInstaller.indexOf('PATH=${RUNTIME_BIN}:${PATH}')
  const unixDependencyCheck = unixInstaller.indexOf('  set --')
  assert.ok(unixRuntimePath >= 0)
  assert.ok(unixRuntimePath < unixDependencyCheck)
})

test('Desktop 安装复用内置运行时，不启动独立 3081 服务', () => {
  assert.match(unixInstaller, /INSTALL_HOST=\$\{DSH_TAVERN_HOST:-cli\}/)
  assert.match(unixInstaller, /install --host "\$\{INSTALL_HOST\}"/)
  assert.match(unixInstaller, /if \[ "\$\{INSTALL_HOST\}" = "desktop" \]/)
  assert.match(windowsInstaller, /\$InstallHost = if \(\$env:DSH_TAVERN_HOST\)/)
  assert.match(windowsInstaller, /install --host \$InstallHost/)
  assert.match(launcherSource, /if \(host === 'cli'\) installCommand\(\)/)
  assert.match(launcherSource, /请重启 DSH Desktop/)
})

test('一键安装先安装下载包依赖，再运行 Tavern 安装器', () => {
  const unixDependencies = unixInstaller.indexOf('pnpm --dir "${APP_DIR}" install --frozen-lockfile')
  const unixLauncher = unixInstaller.indexOf('node "${APP_DIR}/bin/dsh-tavern.mjs" install')
  assert.ok(unixDependencies >= 0)
  assert.ok(unixDependencies < unixLauncher)

  const windowsDependencies = windowsInstaller.indexOf('& $PnpmCommand --dir $AppDir install --frozen-lockfile')
  const windowsLauncher = windowsInstaller.indexOf("& node (Join-Path $AppDir 'bin\\dsh-tavern.mjs') install")
  assert.ok(windowsDependencies >= 0)
  assert.ok(windowsDependencies < windowsLauncher)
})

test('一键安装直接启动 Tavern，不通过包管理器托管后台进程', () => {
  assert.match(unixInstaller, /DSH_HOME=\$\{DSH_ROOT\} node "\$\{APP_DIR\}\/bin\/dsh-tavern\.mjs" start/)
  assert.doesNotMatch(unixInstaller, /pnpm --dir "\$\{APP_DIR\}" run start:tavern/)

  assert.match(windowsInstaller, /& node \(Join-Path \$AppDir 'bin\\dsh-tavern\.mjs'\) start/)
  assert.doesNotMatch(windowsInstaller, /& \$PnpmCommand --dir \$AppDir run start:tavern/)
})

test('启动器保留显式 Android 运行宿主，普通命令行仍默认 CLI', () => {
  assert.match(launcherSource, /DSH_TAVERN_RUNTIME_HOST: process\.env\.DSH_TAVERN_RUNTIME_HOST \|\| 'cli'/)
})

test('共享 Profile 不固定端口，CLI Adapter 启动时显式使用 3081', () => {
  assert.doesNotMatch(profilePatch, /^\s*(?:host|port):/m)
  assert.match(launcherSource, /spawn\(dsh, \['--profile', PROFILE, '--host', CLI_HOST, '--port', String\(CLI_PORT\), '--no-open'\]/)
})

test('Tavern 依赖安装时与当前宿主 DSH 版本对齐', () => {
  assert.match(launcherSource, /extractDshVersion\(runDsh\(dsh, \['--version'\]/)
  assert.match(launcherSource, /workspace\.setIn\(\['overrides', '@deepseek-ai\/dsh-subagent'\], dshVersion\)/)
  assert.match(launcherSource, /workspace\.setIn\(\['overrides', '@deepseek-ai\/dsh-tools'\], dshVersion\)/)
  assert.match(launcherSource, /install', '--lockfile=false'/)
})

test('升级后用户数据固定在 Profile 目录，并在安装时迁移旧源码数据', () => {
  assert.match(launcherSource, /resolveTavernDataRoot\(\{ dshHome: DSH_ROOT \}\)/)
  assert.match(launcherSource, /migrateLegacyTavernData\(\{/)
  assert.match(launcherSource, /backupRoot: path\.join\(DSH_ROOT, 'backups', 'dsh-tavern-data-upgrade'\)/)
  assert.doesNotMatch(launcherSource, /mkdirSync\(path\.join\(SOURCE_ROOT, 'data'/)
})

test('port probe distinguishes an open listener from a closed port', async () => {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  assert.equal(await isPortOpen(address.port), true)
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  assert.equal(await isPortOpen(address.port), false)
})

test('Web 服务就绪检查要求 HTTP 成功响应', async () => {
  assert.equal(await isServiceReady(3081, async () => ({ ok: true })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false })), false)
  assert.equal(await isServiceReady(3081, async () => { throw new Error('offline') }), false)
})
