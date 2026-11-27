import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { encodeWindowsPowerShellScript } from '../bin/application-update.mjs'

test('Windows updater preserves installer parameters and extracts Unicode paths in PowerShell 5.1', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'windows-runtime-zip-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
  const extraction = source.match(/    New-Item -ItemType Directory -Force -Path \$ExtractDir \| Out-Null\r?\n[\s\S]+?(?=    # Only the temporary download)/)[0]
  const repo = (...args) => execFileSync('git', ['-C', directory, ...args])
  const name = '世界书.json'
  await writeFile(path.join(directory, name), '原文')
  repo('init', '-q')
  repo('add', '--', name)
  const tree = String(repo('write-tree')).trim()
  repo('archive', '--format=zip', '--output=runtime.zip', tree)
  const script = path.join(directory, 'probe.ps1')
  await writeFile(script, encodeWindowsPowerShellScript(`param([switch]$LauncherOnly)
$ErrorActionPreference = 'Stop'
if (-not $LauncherOnly) { throw 'Installer switch was not bound' }
function Write-InstallStatus {}
function Expand-Archive { throw 'Incompatible PowerShell archive module' }
$ArchivePath = Join-Path $PSScriptRoot 'runtime.zip'
$ExtractDir = Join-Path $PSScriptRoot 'extract'
${extraction}`))
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-LauncherOnly'])
  assert.equal(await readFile(path.join(directory, 'extract', name), 'utf8'), '原文')
})

for (const transport of ['curl', 'node', 'curl-failed']) {
  test(`Windows CDN download survives blocked PowerShell sockets: ${transport}`, { skip: process.platform !== 'win32' }, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'windows-download-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const bytes = Buffer.from([0, 255, 13, 10, 128, 42])
    const revision = 'a'.repeat(40)
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const metadata = { schemaVersion: 2, revision, version, files: [{ path: 'bin/test.bin', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }
    const server = createServer((req, res) => {
      if (req.url === '/metadata') { res.end(JSON.stringify(metadata)); return }
      if (req.url === '/archive') { res.end(bytes); return }
      if (req.url === `/source@${revision}/bin/test.bin`) { res.end(bytes); return }
      res.writeHead(404); res.end('missing')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
    const url = `http://127.0.0.1:${server.address().port}`
    const source = (await readFile(new URL('../install.ps1', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
    const functions = source.slice(source.indexOf('function Test-Command'), source.indexOf('$PreviousDshHome ='))
    const cdn = source.slice(source.indexOf("      Write-UpdateLog 'installer.stage.started' 'source.jsdelivr'"), source.indexOf('      $UsedCdn = $true'))
    assert.ok(cdn.length > 0, 'CDN download block must be exercised')
    const archiveStart = source.lastIndexOf('  if (-not $UsedGit) {', source.indexOf('    $PreviousProgressPreference ='))
    const archive = source.slice(archiveStart, source.indexOf('  if (-not $UsedGit -and -not $UsedArchive)', archiveStart))
    assert.ok(archiveStart >= 0 && archive.includes('Invoke-SourceDownload $ArchiveUrl'), 'archive download block must be exercised')
    const manifestStart = source.indexOf("  $PublishedManifest = Join-Path $TempDir 'published-runtime.json'")
    const manifest = source.slice(manifestStart, source.indexOf('  $UsedGit = $false', manifestStart))
    assert.match(manifest, /source\.manifest/)
    await writeFile(path.join(directory, 'bad-curl.cmd'), '@exit /b 7\r\n')
    const probe = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$TempDir = $PSScriptRoot
$AppDir = Join-Path $PSScriptRoot 'installed'
$CdnMetadataUrl = '${url}/metadata'
$InstallerVersion = '${version}'
$UsedGit = $false
$CdnRootUrl = '${url}/source/'
${functions}
function Invoke-WebRequest { throw 'WSAEACCES: blocked PowerShell socket' }
function Invoke-RestMethod { throw 'WSAEACCES: blocked PowerShell socket' }
function Write-UpdateLog {}
function Write-InstallStatus {}
function Invoke-InstallCommand([string]$Step, [string]$Command, [string[]]$CommandArgs) {
  & $Command @CommandArgs
  if ($LASTEXITCODE -ne 0) { throw 'CDN file download failed' }
}
${transport === 'node' ? 'function Resolve-Command { return $null }' : transport === 'curl-failed' ? "function Resolve-Command { return (Join-Path $PSScriptRoot 'bad-curl.cmd') }" : ''}
$env:DSH_TAVERN_ARCHIVE_URL = '${url}/archive'
${manifest}
${cdn}
$ArchivePath = Join-Path $PSScriptRoot 'archive.zip'
${archive}
if (-not $UsedArchive) { throw 'Archive fallback did not complete' }
if ($TargetCommit -ne '${revision}') { throw 'Published revision not selected' }
try {
  Invoke-SourceDownload '${url}/missing' (Join-Path $PSScriptRoot 'missing')
  throw 'HTTP error accepted'
} catch { if ($_.Exception.Message -notmatch 'HTTP 404') { throw } }
if (Test-Path (Join-Path $PSScriptRoot 'missing')) { throw 'Failed download left a file' }
if (Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.download-*') { throw 'Partial download was not cleaned up' }
exit 0
`
    const file = path.join(directory, 'probe.ps1')
    await writeFile(file, '\ufeff' + probe)
    const result = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
        timeout: 30000,
        // A parent PowerShell 7 session may supply incompatible module paths to 5.1.
        env: { ...process.env, PSModulePath: path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/Modules') },
      })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      child.on('error', reject)
      child.on('close', code => resolve({ code, output }))
    })
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(await readFile(path.join(directory, 'cdn-source/bin/test.bin')), bytes)
    assert.deepEqual(await readFile(path.join(directory, 'archive.zip')), bytes)
  })
}
