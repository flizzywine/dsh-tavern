import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// main is the current release (DSH 0.2.1); the DSH 0.1.5 release lives on the stable branch.
const root = new URL('../', import.meta.url)
function runPowerShell(script) {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return spawnSync(command, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8' })
}

test('安装脚本与更新检查在所有下载方式上都跟随 main 分支', () => {
  for (const file of ['install.sh', 'install.ps1', 'tavern-plugin/lib/application-updater.js', 'bin/launcher-environment.mjs']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.ok(source.includes('/commits/main'), file)
    assert.doesNotMatch(source, /0\.2\.1版本|%E7%89%88%E6%9C%AC|\/commits\/stable|@stable\//, file)
    if (file.startsWith('install.')) {
      assert.ok(source.includes('refs/heads/main'), file)
      assert.ok(source.includes('@runtime-archive-main/dsh-tavern-runtime.json'), file)
      assert.match(source, /--branch["', ]+main/, file)
      assert.match(source, /origin["', ]+main\b/, file)
    }
  }
  assert.match(readFileSync(new URL('android/setup.sh', root), 'utf8'), /BRANCH="\$\{DSH_TAVERN_BRANCH:-main\}"/)
  for (const file of ['android/setup.sh', 'tavern-plugin/lib/application-updater.js']) {
    assert.ok(readFileSync(new URL(file, root), 'utf8').includes('@runtime-archive-main/dsh-tavern-runtime.json'), file)
  }
  const workflow = readFileSync(new URL('.github/workflows/publish-runtime-manifest.yml', root), 'utf8')
  assert.match(workflow, /branches: \[main, stable\]/)
  assert.doesNotMatch(workflow, /@main\/|@0\.2\.1/, 'CDN 刷新按推送的分支')
})

test('桌面与命令行安装入口拒绝 Android 宿主', { skip: process.platform === 'win32' }, () => {
  const result = spawnSync('sh', [new URL('install.sh', root).pathname], { encoding: 'utf8', env: { ...process.env, DSH_TAVERN_HOST: 'android' } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /不支持宿主 android/)
})

test('安装脚本内嵌自己的版本号，jsDelivr 下载不接受比它旧的运行清单', () => {
  const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version
  const sh = readFileSync(new URL('install.sh', root), 'utf8')
  const ps1 = readFileSync(new URL('install.ps1', root), 'utf8')
  assert.ok(sh.includes(`INSTALLER_VERSION='${version}'`), 'install.sh 的版本号与 package.json 一致（node bin/build-installer-scripts.mjs）')
  assert.ok(ps1.includes(`$InstallerVersion = '${version}'`), 'install.ps1 的版本号与 package.json 一致')
  assert.match(sh, /download\.cjs" runtime [^\n]*--min-version "\$\{INSTALLER_VERSION\}"/)
  assert.match(ps1, /'runtime', [^\n]*'--min-version', \$InstallerVersion\)/)
})

test('Windows 桌面探测：环境变量里的 node.exe 不算桌面程序；卸载项缺 InstallLocation 时从卸载程序路径找（#250）', () => {
  const source = readFileSync(new URL('install.ps1', root), 'utf8')
  const candidates = source.slice(source.indexOf('$DesktopCandidates = '), source.indexOf('$OfficialDesktopExecutable = '))
  assert.match(candidates, /\$DesktopCandidates = @\(\$env:DSH_DESKTOP_APP_EXECUTABLE\)/, 'an explicit app path wins')
  assert.match(candidates, /DSH_DESKTOP_NODE_EXECUTABLE\) -notmatch '\^node\(\\\.exe\)\?\$'/)
  assert.match(candidates, /UninstallString/)
  assert.match(candidates, /DisplayIcon/)
})

test('Windows 桌面探测接受带引号的安装目录并跳过无效的卸载路径（#1294）', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('install.ps1', root), 'utf8')
  const registryScan = source.match(/^      \$DesktopCandidates \+= @\(\$DesktopUninstallEntries[\s\S]*?^        }\)/m)?.[0]
  assert.ok(registryScan, 'the installer’s uninstall registry scan must be exercised')
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$DesktopName = 'DeepSeek Harness'
$DesktopCandidates = @()
$QuotedFolder = "$env:SystemDrive\Quoted Harness"
$PartialQuoteFolder = "$env:SystemDrive\Partial Quote Harness"
$FallbackFolder = "$env:SystemDrive\Fallback Harness"
$DesktopUninstallEntries = @(
  [pscustomobject]@{ DisplayName = $DesktopName; InstallLocation = 'MissingHarnessDrive:\Missing'; DisplayIcon = '"MissingHarnessDrive:\Missing\shell.exe"' }
  [pscustomobject]@{ DisplayName = $DesktopName; InstallLocation = ' "' + $QuotedFolder + '" '; UninstallString = '"MissingHarnessDrive:\Missing\uninstall.exe" /S' }
  [pscustomobject]@{ DisplayName = $DesktopName; InstallLocation = '"' + $PartialQuoteFolder }
  [pscustomobject]@{ DisplayName = $DesktopName; UninstallString = '"' + $FallbackFolder + '\uninstall.exe" /S' }
)
${registryScan}
$DesktopCandidates | ConvertTo-Json -Compress
`
  const result = runPowerShell(script)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ['Quoted Harness', 'Partial Quote Harness', 'Fallback Harness']
    .map(folder => `${process.env.SystemDrive}\\${folder}\\DeepSeek Harness.exe`))
})

test('Windows 桌面探测跳过无法读取的卸载项，仅访问所需字段（#1381）', t => {
  const source = readFileSync(new URL('install.ps1', root), 'utf8')
  const scan = source.match(/^function Get-DesktopUninstallEntries\([\s\S]*?^}/m)?.[0]
  assert.ok(scan, 'the installer’s uninstall registry reader must be exercised')
  const result = runPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
class RegistryKeyFixture {
  [hashtable] $SubKeys = @{}
  [hashtable] $Values = @{}
  [bool] $Disposed

  [object] OpenSubKey([string]$Name) {
    if ($Name -eq 'unreadable') { throw [UnauthorizedAccessException]::new('fixture') }
    return $this.SubKeys[$Name]
  }
  [string[]] GetSubKeyNames() { return @('unreadable', 'removed', 'netbeans', 'desktop') }
  [object] GetValue([string]$Name) {
    if ($Name -notin @('DisplayName', 'InstallLocation', 'DisplayIcon', 'UninstallString')) {
      throw [InvalidCastException]::new('unrelated value')
    }
    return $this.Values[$Name]
  }
  [void] Dispose() { $this.Disposed = $true }
}
${scan}
$Registry = [RegistryKeyFixture]::new()
$Uninstall = [RegistryKeyFixture]::new()
$NetBeans = [RegistryKeyFixture]::new()
$NetBeans.Values = @{ DisplayName = 'Apache NetBeans IDE 11.3' }
$Desktop = [RegistryKeyFixture]::new()
$Desktop.Values = @{
  DisplayName = 'DeepSeek Harness'
  InstallLocation = 'D:\Apps\Harness'
  DisplayIcon = 'D:\Apps\Harness\icon.ico'
  UninstallString = 'D:\Apps\Harness\uninstall.exe'
}
$Registry.SubKeys = @{ Uninstall = $Uninstall }
$Uninstall.SubKeys = @{ netbeans = $NetBeans; desktop = $Desktop }
$Entries = @(Get-DesktopUninstallEntries $Registry 'Uninstall')
if (-not ($Uninstall.Disposed -and $NetBeans.Disposed -and $Desktop.Disposed) -or $Registry.Disposed) {
  throw 'Unexpected registry key lifetime'
}
$Entries | ConvertTo-Json -Compress
`)
  if (process.platform !== 'win32' && result.error?.code === 'ENOENT') return t.skip('PowerShell is unavailable')
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [
    { DisplayName: 'Apache NetBeans IDE 11.3', InstallLocation: null, DisplayIcon: null, UninstallString: null },
    { DisplayName: 'DeepSeek Harness', InstallLocation: 'D:\\Apps\\Harness', DisplayIcon: 'D:\\Apps\\Harness\\icon.ico', UninstallString: 'D:\\Apps\\Harness\\uninstall.exe' },
  ])
})
