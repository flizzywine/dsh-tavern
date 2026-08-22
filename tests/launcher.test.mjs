import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import test from 'node:test'

import {
  applySidebarDefaults,
  encodeWindowsPowerShellScript,
  ensureSidebarDefaults,
  isPortOpen,
  renderWindowsLauncher,
  supportsDshVersion,
} from '../bin/dsh-tavern.mjs'

const windowsInstaller = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const unixInstaller = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const launcherSource = await readFile(new URL('../bin/dsh-tavern.mjs', import.meta.url), 'utf8')
const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const profileWorkspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')

test('Windows launcher quotes paths containing spaces and forwards arguments', () => {
  const launcher = renderWindowsLauncher('D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs')
  assert.equal(
    launcher,
    '@echo off\r\nnode "D:\\My Games\\dsh-tavern\\bin\\dsh-tavern.mjs" %*\r\n',
  )
})

test('Windows update script carries a UTF-8 BOM for Windows PowerShell 5.1', () => {
  assert.equal(encodeWindowsPowerShellScript("Write-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
  assert.equal(encodeWindowsPowerShellScript("\uFEFFWrite-Host '模型设置'"), "\uFEFFWrite-Host '模型设置'")
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
  assert.equal(rootManifest.dependencies['dsh-better-sidebar'], '0.14.0')
  assert.ok(rootManifest.dsh.profile.bundles.includes('dsh-better-sidebar'))
  assert.match(launcherSource, /'dsh-better-sidebar': source\.dependencies\['dsh-better-sidebar'\]/)
})

test('Tavern profile does not auto-install Better Sidebar peer dependencies over DSH built-ins', () => {
  assert.match(profileWorkspace, /^autoInstallPeers:\s*false$/m)
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
    'dsh-tavern:boundary-prompts': true,
  })
  assert.deepEqual(settings['dsh-better-sidebar'].viewersEnabled, {
    image: false,
    pdf: false,
    markdown: true,
    html: false,
    code: true,
    'binary-download': false,
  })
  assert.equal(settings['dsh-tavern'].sidebarDefaultsVersion, 7)
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
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:boundary-prompts'], true)
})

test('Tavern sidebar preserves user choices after version 7 migration', () => {
  const settings = applySidebarDefaults({
    'dsh-tavern': { sidebarDefaultsVersion: 7 },
    'dsh-better-sidebar': { tabsEnabled: { 'dsh-tavern:boundary-prompts': false } },
  })
  assert.equal(settings['dsh-better-sidebar'].tabsEnabled['dsh-tavern:boundary-prompts'], false)
})

test('Tavern sidebar migration marker与四个库设置写入 YAML', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-settings-'))
  t.after(async function () { await rm(directory, { recursive: true, force: true }) })
  const settingsPath = path.join(directory, 'settings.yaml')
  await writeFile(settingsPath, 'dsh-better-sidebar:\n  tabsEnabled:\n    editor: false\n', 'utf8')

  assert.equal(ensureSidebarDefaults(settingsPath), true)
  const written = await readFile(settingsPath, 'utf8')
  assert.match(written, /dsh-tavern:\n  sidebarDefaultsVersion: 7/)
  assert.match(written, /editor: true/)
  assert.match(written, /dsh-tavern:resources: true/)
  assert.match(written, /dsh-tavern:cards: true/)
  assert.match(written, /dsh-tavern:presets: true/)
  assert.match(written, /dsh-tavern:boundary-prompts: true/)
})

test('Tavern applies sidebar migrations before every service start', () => {
  assert.match(launcherSource, /async function startService\(\) \{\s*verifyProfile\(\)\s*ensureSidebarDefaults\(\)/)
})

test('DSH rc.8 is the minimum supported launcher version', () => {
  assert.equal(supportsDshVersion('0.1.0-rc.7'), false)
  assert.equal(supportsDshVersion('0.1.0-rc.8'), true)
  assert.equal(supportsDshVersion('0.1.0-rc.9'), true)
  assert.equal(supportsDshVersion('0.1.0'), true)
  assert.equal(supportsDshVersion('0.2.0-rc.1'), true)
  assert.equal(supportsDshVersion('unknown'), false)
})

test('installers reuse compatible DSH and upgrade older versions to rc.8', () => {
  assert.match(windowsInstaller, /if \(-not \(Test-Command 'pnpm'\)\)/)
  assert.match(windowsInstaller, /\$RequiredDshVersion = '0\.1\.0-rc\.8'/)
  assert.match(windowsInstaller, /Test-DshVersion \$DshVersionText/)
  assert.match(windowsInstaller, /@deepseek-ai\/dsh@\$RequiredDshVersion/)
  assert.match(unixInstaller, /if ! command -v pnpm/)
  assert.match(unixInstaller, /REQUIRED_DSH_VERSION=0\.1\.0-rc\.8/)
  assert.match(unixInstaller, /dsh_version_is_compatible/)
  assert.match(unixInstaller, /@deepseek-ai\/dsh@\$\{REQUIRED_DSH_VERSION\}/)
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
