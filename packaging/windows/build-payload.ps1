param(
    [Parameter(Mandatory=$true)][string]$DesktopSetup,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$OutputPayload,
    [string]$WorkDirectory
)
$ErrorActionPreference = 'Stop'
$DesktopSetup = (Resolve-Path -LiteralPath $DesktopSetup).Path
$SevenZip = (Resolve-Path -LiteralPath $SevenZip).Path
$OutputPayload = [IO.Path]::GetFullPath($OutputPayload)
$root = if ($WorkDirectory) { [IO.Path]::GetFullPath($WorkDirectory) } else { Join-Path (Split-Path -Parent $OutputPayload) 'payload-work' }
$extract = Join-Path $root 'extract'
$stage = Join-Path $root 'stage'
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $extract,$stage | Out-Null

# The upstream Setup is an electron-builder NSIS installer; the application files are
# in $PLUGINSDIR/app-64.7z. Reading NSIS needs the full 7z.exe, not the standalone 7za.exe.
Write-Host "Extracting Desktop setup..."
$setupFiles = Join-Path $root 'setup'
& $SevenZip x $DesktopSetup "-o$setupFiles" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to extract Desktop setup (7-Zip exit $LASTEXITCODE)" }
$appArchive = Join-Path $setupFiles '$PLUGINSDIR\app-64.7z'
if (-not (Test-Path -LiteralPath $appArchive)) { throw 'Desktop setup did not contain $PLUGINSDIR/app-64.7z' }
& $SevenZip x $appArchive "-o$extract" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to extract Desktop application archive (7-Zip exit $LASTEXITCODE)" }
if (-not (Test-Path -LiteralPath (Join-Path $extract 'DeepSeek Harness.exe'))) { throw 'Desktop setup did not contain DeepSeek Harness.exe' }
$oldNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & (Join-Path $extract 'DeepSeek Harness.exe') --expose-internals (Join-Path $PSScriptRoot 'prepare-official-runtime.cjs') (Join-Path $extract 'resources')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare official Desktop runtime' }
} finally { $env:ELECTRON_RUN_AS_NODE = $oldNodeMode }

function Test-KeepRelative([string]$rel) {
    $normalized = $rel.Replace('\','/')
    if ($normalized -match '\.(map|pdb)$') { return $false }
    if ($normalized -match '^locales/' -and $normalized -notmatch '/(en-US|en-GB|zh-CN|zh-TW)\.pak$') { return $false }
    if ($normalized -match 'sharp-win32-arm64') { return $false }
    return $true
}

Write-Host "Copying slim runtime..."
Get-ChildItem -LiteralPath $extract -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($extract.Length).TrimStart('\')
    if (-not (Test-KeepRelative $rel)) { return }
    $dest = Join-Path $stage $rel
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../bin/official-desktop-runtime.cjs') -Destination (Join-Path $stage 'resources/official-desktop-runtime.cjs') -Force
$portable = Join-Path $PSScriptRoot 'tavern-portable.js'
$online = Join-Path $PSScriptRoot 'online-install.mjs'
Copy-Item -LiteralPath $portable -Destination (Join-Path $stage 'resources\app\lib\tavern-portable.js') -Force
Copy-Item -LiteralPath $online -Destination (Join-Path $stage 'resources\online-install.mjs') -Force

$manifestPath = Join-Path $stage 'resources\app\package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne '0.2.1-rc.2') { throw "Unexpected Desktop version: $($manifest.version)" }
$manifest.main = 'lib/tavern-portable.js'
[IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 100) + "`n"), [Text.UTF8Encoding]::new($false))

$license = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path 'LICENSE'
if (Test-Path -LiteralPath $license) {
    Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'resources\app\TAVERN-LICENSE.txt') -Force
}

$buildInfo = @{
    desktop = '0.2.1-rc.2'
    adaptedDshVersion = '0.2.1-rc.2'
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    source = [IO.Path]::GetFileName($DesktopSetup)
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $stage 'resources\app\tavern-build.json'), ($buildInfo + "`n"), [Text.UTF8Encoding]::new($false))

New-Item -ItemType Directory -Force (Split-Path -Parent $OutputPayload) | Out-Null
if (Test-Path -LiteralPath $OutputPayload) { Remove-Item -LiteralPath $OutputPayload -Force }
Write-Host "Compressing payload..."
Push-Location $stage
try {
    & $SevenZip a -t7z -mx=9 -m0=LZMA2 $OutputPayload * | Out-Null
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath $OutputPayload)) { throw 'Failed to create payload archive' }
$hash = (Get-FileHash -LiteralPath $OutputPayload -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Payload=$OutputPayload"
Write-Output "SHA256=$hash"
