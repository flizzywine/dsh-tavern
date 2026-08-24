import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import test from 'node:test'

import {
  applySidebarDefaults,
  browserOpenCommand,
  encodeWindowsPowerShellScript,
  ensureSidebarDefaults,
  extractDshVersion,
  isPortOpen,
  needsFrontendBootstrap,
  parseInstallHost,
  parseUpdateOptions,
  renderWindowsLauncher,
  restartBrowserTarget,
  resolveServicePort,
} from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const profilePatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const profileWorkspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

test('Windows launcher quotes paths containing spaces and forwards arguments', () => {
  const launcher = renderWindowsLauncher('D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs')
  assert.equal(
    launcher,
    '@echo off\r\nnode "D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs" %*\r\n',
  )
})

test('安装宿主默认使用 CLI，并明确接受 Desktop', () => {
  assert.equal(parseInstallHost([]), 'cli')
  assert.equal(parseInstallHost(['--host', 'desktop']), 'desktop')
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
  assert.equal(encodeWindowsPowerShellScript("Write-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
  assert.equal(encodeWindowsPowerShellScript("\uFEFFWrite-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
})

test('UI 更新参数明确传递宿主、状态文件和启动延迟', () => {
  assert.deepEqual(parseUpdateOptions(['--host', 'desktop', '--status-file', '/tmp/update.json', '--delay=800']), {
    host: 'desktop',
    statusFile: '/tmp/update.json',
    delay: 800,
  })
  assert.deepEqual(parseUpdateOptions([]), { host: 'cli', statusFile: '', delay: 0 })
  assert.throws(() => parseUpdateOptions(['--host', 'other']), /不支持的安装宿主/)
  assert.throws(() => parseUpdateOptions(['--status-file', 'relative.json']), /绝对路径/)
})

test('Windows installer compares Node versions without native argument quoting', () => {
  assert.match(windowsInstaller, /\[version\]\$NodeVersionText\.TrimStart\('v'\)/)
  assert.doesNotMatch(windowsInstaller, /node -e/)
})

test('Tavern no longer bundles dsh-codex-connect and removes it from existing profiles', () => {
  assert.equal(rootManifest.dependencies['dsh-codex-connect'], undefined)
  assert.doesNotMatch(JSON.stringify(rootManifest.dsh.profile.bundles), /dsh-codex-connect/)
  assert.match(launcherSource, /delete dependencies\['dsh-codex-connect'\]/)
})

test('Tavern profile installs Better Sidebar as its right-panel foundation', () => {
  assert.equal(rootManifest.dependencies['dsh-better-sidebar'], '0.15.0')
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-better-sidebar'))
  assert.match(launcherSource, /'dsh-better-sidebar': source\.dependencies\['dsh-better-sidebar'\]/)
})

test('Tavern profile does not auto-install Better Sidebar peer dependencies over DSH built-ins', () => {
  assert.match(profileWorkspace, /^autoInstallPeers:\s*false$/m)
})

test('Tavern profile isolates conversations from other DSH profiles on fresh installs', () => {
  assert.match(profilePatch, /id: session-persistence-jsonl[\s\S]*dshHomePath\('profile-data', 'tavern', 'sessions'\)/)
  assert.match(profilePatch, /id: storage-json[\s\S]*dshHomePath\('profile-data', 'tavern', 'storages'\)/)
  assert.match(launcherSource, /copyFileSync\(path\.join\(SOURCE_ROOT, 'cordis\.patch\.yml'\), path\.join\(PROFILE_DIR, 'cordis\.patch\.yml'\)\)/)
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

test('命令行启动器向共享 Profile 标记当前运行宿主', () => {
  assert.match(launcherSource, /DSH_TAVERN_RUNTIME_HOST: 'cli'/)
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
