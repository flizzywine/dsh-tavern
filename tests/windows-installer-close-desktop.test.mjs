import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// The in-app updater runs install.ps1 under the desktop executable in Node mode; DeepSeek Harness's
// own terminal runs it under the desktop. A first install must not stop the process running it.
test('first-install desktop close never stops the installer\'s own launch chain', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'installer-close-desktop-'))
  try {
    const source = (await readFile(new URL('../install.ps1', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
    const functions = source.slice(source.indexOf('function Get-DesktopProcesses'), source.indexOf('function Test-Command'))
    assert.match(functions, /function Close-DesktopForFirstInstall/)
    // Windows process ids are multiples of 4, so these odd ids never name a real process.
    const probe = `
$ErrorActionPreference = 'Stop'
$InstallHost = 'desktop'
$Exe = '"C:\\Apps\\DeepSeek Harness\\DeepSeek Harness.exe"'
function Row($Id, $Parent, $Name, $Command) { [pscustomobject]@{ ProcessId = $Id; ParentProcessId = $Parent; Name = $Name; CommandLine = $Command } }
$script:Rows = @()
$script:Stopped = @()
function Get-CimInstance { param($ClassName, $ErrorAction) $script:Rows | Where-Object { $script:Stopped -notcontains $_.ProcessId } }
function Get-Process { param($Id, $ErrorAction) [pscustomobject]@{ Id = $Id } | Add-Member -PassThru ScriptMethod CloseMainWindow { $true } }
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) $script:Stopped += $Id }
function Start-Sleep {}
function Write-InstallStatus {}
function Test-DesktopLinked { $false }
${functions}
$Gui = @((Row 201 1 'DeepSeek Harness.exe' $Exe), (Row 203 201 'DeepSeek Harness.exe' ($Exe + ' --type=renderer')))

# In-app update: the updater is the desktop executable in Node mode, started outside the GUI.
$script:Rows = @((Row $PID 101 'powershell.exe' 'powershell -File install.ps1'), (Row 101 4 'DeepSeek Harness.exe' ($Exe + ' "C:\\app\\bin\\dsh-tavern.mjs" update'))) + $Gui
if (-not (Close-DesktopForFirstInstall)) { throw 'running desktop not reported' }
if (($script:Stopped | Sort-Object) -join ',' -ne '201,203') { throw ('stopped ' + ($script:Stopped -join ',')) }

# Nothing else running: nothing to close or reopen.
$script:Stopped = @()
$script:Rows = @((Row $PID 101 'powershell.exe' 'powershell'), (Row 101 4 'DeepSeek Harness.exe' ($Exe + ' "C:\\app\\bin\\dsh-tavern.mjs" update')))
if (Close-DesktopForFirstInstall) { throw 'own updater reported as a running desktop' }

# The desktop's own terminal: refuse before stopping anything.
$script:Rows = @((Row $PID 301 'powershell.exe' 'powershell'), (Row 301 303 'OpenConsole.exe' 'OpenConsole'), (Row 303 201 'DeepSeek Harness.exe' ($Exe + ' --expose-internals C:\\app\\dsh-desktop-host\\lib\\index.js'))) + $Gui
try { [void](Close-DesktopForFirstInstall); throw 'terminal inside the desktop accepted' } catch { if ($_.Exception.Message -notmatch 'Windows PowerShell') { throw } }
if ($script:Stopped.Count) { throw ('stopped ' + ($script:Stopped -join ',')) }
`
    await writeFile(path.join(root, 'probe.ps1'), '\ufeff' + probe)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'probe.ps1')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { await rm(root, { recursive: true, force: true }) }
})
