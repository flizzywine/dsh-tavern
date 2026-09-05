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
  recordInstalledRelease,
  resolveDshInvocation,
  resolveUpdateProgram,
  renderWindowsLauncher,
  restartBrowserTarget,
  webUrlFromLogChunk,
  resolveServicePort,
  updateApplication,
} from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const serviceSource = await readFile(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
const installationSource = await readFile(new URL('../bin/profile-installation.mjs', import.meta.url), 'utf8')
const updateSource = await readFile(new URL('../bin/application-update.mjs', import.meta.url), 'utf8')
const updateHelperSource = await readFile(new URL('../bin/dsh-tavern-update-helper.mjs', import.meta.url), 'utf8')
const profilePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const managedProfilePatch = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')
const profileConfigurationSource = await readFile(new URL('../bin/profile-configuration.mjs', import.meta.url), 'utf8')
const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('无 Git 的 ZIP 安装在收尾时补写提交号', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-release-'))
  try {
    const commit = 'd'.repeat(40)
    const result = await recordInstalledRelease({ sourceRoot: root, dshRoot: path.join(root, '.dsh'), targetCommit: commit })
    assert.equal(result.commit, commit)
    assert.equal(JSON.parse(await readFile(path.join(root, '.dsh-tavern-release.json'), 'utf8')).commit, commit)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
const tavernPluginManifest = JSON.parse(await readFile(new URL('../tavern-plugin/package.json', import.meta.url), 'utf8'))
const profileWorkspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

test('Windows launcher quotes paths containing spaces and forwards arguments', () => {
  const launcher = renderWindowsLauncher('D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs')
  assert.equal(
    launcher,
    '@echo off\r\nnode "D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs" %*\r\n',
  )
})

test('公开安装命令使用 jsDelivr，不把 raw GitHub 作为国内用户入口', () => {
  assert.match(readme, /cdn\.jsdelivr\.net\/gh\/flizzywine\/dsh-tavern@main\/install\.ps1/)
  assert.match(readme, /cdn\.jsdelivr\.net\/gh\/flizzywine\/dsh-tavern@main\/install\.sh/)
  assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/flizzywine\/dsh-tavern\/main\/install\.(?:ps1|sh)/)
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

test('Android 通过 Node expose-internals 运行 DSH，其他宿主保持原命令', () => {
  assert.deepEqual(resolveDshInvocation('/usr/local/bin/dsh', ['--version'], 'android', '/usr/local/bin/node'), {
    command: '/usr/local/bin/node',
    args: ['--expose-internals', '/usr/local/bin/dsh', '--version'],
  })
  assert.deepEqual(resolveDshInvocation('/usr/local/bin/dsh', ['--version'], 'cli', '/usr/local/bin/node'), {
    command: '/usr/local/bin/dsh',
    args: ['--version'],
  })
})

test('升级时只用本次启动标识引导一次新页面，之后交给页面自动恢复', () => {
  assert.equal(
    restartBrowserTarget(3081, 'runtime-a b', 'http://127.0.0.1:3081/?token=alpha2-token'),
    'http://127.0.0.1:3081/?token=alpha2-token&tavern-boot=runtime-a+b',
  )
  assert.equal(webUrlFromLogChunk('old\ndsh web: http://127.0.0.1:3081/?token=fresh\n'), 'http://127.0.0.1:3081/?token=fresh')
  assert.equal(webUrlFromLogChunk('dsh web: http://127.0.0.1:3081/?token=old\ndsh web: http://127.0.0.1:3081/?token=new\n'), 'http://127.0.0.1:3081/?token=new')
  assert.match(serviceSource, /for \(let logAttempt = 0; logAttempt < 50 && webUrl === ''; logAttempt \+= 1\)/)
  assert.equal(needsFrontendBootstrap(null), true)
  assert.equal(needsFrontendBootstrap({ version: 0 }), true)
  assert.equal(needsFrontendBootstrap({ version: 1 }), true)
  assert.equal(needsFrontendBootstrap({ version: 2 }), false)
  assert.match(serviceSource, /const target = restartBrowserTarget\(state\.port, state\.runtimeGeneration, state\.webUrl\)/)
  assert.match(serviceSource, /openBrowserTarget\(target\)/)
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
  assert.deepEqual(parseUpdateOptions(['--host', 'desktop', '--status-file', '/tmp/update.json', '--delay=800', '--target-commit', 'a'.repeat(40)]), {
    host: 'desktop',
    statusFile: '/tmp/update.json',
    delay: 800,
    targetCommit: 'a'.repeat(40),
  })
  assert.deepEqual(parseUpdateOptions(['--host=android']), { host: 'android', statusFile: '', delay: 0, targetCommit: '' })
  assert.deepEqual(parseUpdateOptions([]), { host: 'cli', statusFile: '', delay: 0, targetCommit: '' })
  assert.throws(() => parseUpdateOptions(['--host', 'other']), /不支持的安装宿主/)
  assert.throws(() => parseUpdateOptions(['--status-file', 'relative.json']), /绝对路径/)
  assert.throws(() => parseUpdateOptions(['--target-commit', 'bad']), /提交号/)
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

test('代码已覆盖但自动重启失败时不再误报整体更新失败', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-update-partial-'))
  try {
    const statusFile = path.join(root, 'update-status.json')
    const commit = 'e'.repeat(40)
    const installerName = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
    const installerSource = process.platform === 'win32' ? 'exit 1\r\n' : '#!/bin/sh\nexit 1\n'
    await writeFile(path.join(root, installerName), installerSource)
    await writeFile(path.join(root, '.dsh-tavern-release.json'), JSON.stringify({ commit }))
    await updateApplication({ host: 'cli', statusFile, delay: 0, sourceRoot: root, targetCommit: commit, log() {} })
    const status = JSON.parse(await readFile(statusFile, 'utf8'))
    assert.equal(status.phase, 'installed-restart-required')
    assert.equal(status.targetCommit, commit)
    assert.match(status.error, /程序文件已更新/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows UI 更新隐藏 PowerShell 窗口并保持 UTF-8 输出', () => {
  assert.match(updateSource, /System\.Text\.UTF8Encoding/)
  assert.match(updateSource, /spawnSync\(command, args, \{[\s\S]*?windowsHide: true,/)
  assert.match(updateHelperSource, /detached: true/)
  assert.match(updateHelperSource, /windowsHide: true/)
})

test('后台更新禁止重复打开浏览器，并用临时日志避免后台进程占住输出管道', () => {
  assert.match(updateSource, /DSH_TAVERN_NO_OPEN: '1'/)
  assert.match(updateSource, /stdio: capture \? \['ignore', outputDescriptor, outputDescriptor\] : 'inherit'/)
  assert.doesNotMatch(updateSource, /stdio: capture \? 'pipe' : 'inherit'/)
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
  assert.equal(rootManifest.dependencies['dsh-better-sidebar'], '0.17.1')
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-better-sidebar'))
  assert.match(profileConfigurationSource, /managedDependencies/)
})

test('Tavern profile also installs the pinned mobile adaptation plugin', () => {
  assert.equal(
    rootManifest.dependencies['dsh-web-mobile'],
    '2.3.0',
  )
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-web-mobile'))
  assert.equal(rootManifest.dependencies['@dsh-external/dsh-mobile-nav'], undefined)
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-better-sidebar'))
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
  assert.match(installationSource, /prepareProfilePatch/)
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
  assert.match(serviceSource, /async function startService\(\) \{\s*verifyProfile\(\)\s*ensureSidebarDefaults\(\)/)
})

test('installers accept the installed DSH host without pinning its release', () => {
  assert.match(windowsInstaller, /if \(\$InstallHost -eq 'cli'\)/)
  assert.doesNotMatch(windowsInstaller, /RequiredDshVersion|Test-DshVersion/)
  assert.match(windowsInstaller, /"@deepseek-ai\/dsh@\$AdaptedDshVersion"/)
  assert.match(unixInstaller, /if \[ "\$\{INSTALL_HOST\}" = "cli" \]/)
  assert.doesNotMatch(unixInstaller, /REQUIRED_DSH_VERSION|dsh_version_is_compatible/)
  assert.match(unixInstaller, /"@deepseek-ai\/dsh@\$\{ADAPTED_DSH_VERSION\}"/)
  assert.doesNotMatch(launcherSource, /MINIMUM_DSH_VERSION|supportsDshVersion|requireDshVersion/)
})

test('installers default to codeload archives while allowing an override', () => {
  assert.match(windowsInstaller, /DSH_TAVERN_ARCHIVE_URL/)
  assert.match(windowsInstaller, /https:\/\/codeload\.github\.com\/\$Repository\/zip\/refs\/heads\/main/)
  assert.match(unixInstaller, /DSH_TAVERN_ARCHIVE_URL/)
  assert.match(unixInstaller, /https:\/\/codeload\.github\.com\/\$\{REPOSITORY\}\/tar\.gz\/refs\/heads\/main/)
})

test('安装器优先使用 Git 稀疏缓存，再用 jsDelivr 校验下载和完整 ZIP 回退', () => {
  assert.match(windowsInstaller, /source-cache\\dsh-tavern\.git/)
  assert.match(windowsInstaller, /clone --bare --filter=blob:none --depth 1/)
  assert.match(windowsInstaller, /archive --format=zip/)
  assert.match(windowsInstaller, /jsDelivr 备用源下载运行代码/)
  assert.match(windowsInstaller, /SHA256/)
  assert.match(windowsInstaller, /正在下载完整 ZIP/)
  assert.match(unixInstaller, /source-cache\/dsh-tavern\.git/)
  assert.match(unixInstaller, /clone --bare --filter=blob:none --depth 1/)
  assert.match(unixInstaller, /archive --format=tar/)
  assert.match(unixInstaller, /jsDelivr 备用源下载运行代码/)
  assert.match(unixInstaller, /createHash\('sha256'\)/)
  assert.match(windowsInstaller, /\$Metadata\.revision/)
  assert.match(unixInstaller, /metadata\.revision/)
  assert.match(unixInstaller, /正在下载完整 ZIP/)

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

test('一键安装固定经过验证的 pnpm 主版本并可从不兼容版本恢复', () => {
  assert.match(windowsInstaller, /\$PnpmVersion = '11\.25\.0'/)
  assert.match(windowsInstaller, /"pnpm@\$PnpmVersion"/)
  assert.match(windowsInstaller, /--version/)
  assert.match(unixInstaller, /PNPM_VERSION=11\.25\.0/)
  assert.match(unixInstaller, /pnpm@\$\{PNPM_VERSION\}/)
  assert.match(unixInstaller, /pnpm --version/)
})

test('Desktop 安装复用内置运行时，不启动独立 3081 服务', () => {
  assert.match(unixInstaller, /INSTALL_HOST=\$\{DSH_TAVERN_HOST:-cli\}/)
  assert.match(unixInstaller, /install --host "\$\{INSTALL_HOST\}"/)
  assert.match(unixInstaller, /if \[ "\$\{INSTALL_HOST\}" = "desktop" \]/)
  assert.match(windowsInstaller, /\$InstallHost = if \(\$env:DSH_TAVERN_HOST\)/)
  assert.match(windowsInstaller, /install --host \$InstallHost/)
  assert.match(installationSource, /if \(host === 'cli'\) installCommand\(\)/)
  assert.match(installationSource, /请重启 DSH Desktop/)
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
  assert.match(serviceSource, /DSH_TAVERN_RUNTIME_HOST: process\.env\.DSH_TAVERN_RUNTIME_HOST \|\| 'cli'/)
})

test('共享 Profile 不固定端口，CLI Adapter 启动时显式使用 3081', () => {
  assert.doesNotMatch(profilePatch, /^\s*(?:host|port):/m)
  assert.match(serviceSource, /\['--profile', PROFILE, '--host', CLI_HOST, '--port', String\(CLI_PORT\), '--no-open'\]/)
  assert.match(serviceSource, /spawn\(invocation\.command, invocation\.args/)
})

test('Tavern 安装依赖时传入当前宿主而不是将版本号当作 npm 依赖', () => {
  assert.match(installationSource, /extractDshVersion\(runDsh\(dsh, \['--version'\]/)
  assert.match(installationSource, /installPluginDependencies\(\{ pluginDirectory: .* dsh, host, run \}\)/)
  assert.doesNotMatch(installationSource, /installPluginDependencies\([^\n]*dshVersion/)
})

test('升级后用户数据固定在 Profile 目录，并在安装时迁移旧源码数据', () => {
  assert.match(installationSource, /resolveTavernDataRoot\(\{ dshHome: DSH_ROOT \}\)/)
  assert.match(installationSource, /migrateLegacyTavernData\(\{/)
  assert.match(installationSource, /backupRoot: path\.join\(DSH_ROOT, 'backups', 'dsh-tavern-data-upgrade'\)/)
  assert.doesNotMatch(installationSource, /mkdirSync\(path\.join\(SOURCE_ROOT, 'data'/)
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

test('Web 服务就绪检查接受 alpha.2 鉴权响应', async () => {
  assert.equal(await isServiceReady(3081, async () => ({ ok: true })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 401 })), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false })), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 403 }), 'android'), true)
  assert.equal(await isServiceReady(3081, async () => ({ ok: false, status: 403 }), 'cli'), false)
  assert.equal(await isServiceReady(3088, async () => ({ ok: false, status: 500 }), 'android'), false)
  assert.equal(await isServiceReady(3081, async () => { throw new Error('offline') }), false)
})
