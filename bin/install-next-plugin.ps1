param(
    [string] $IndexUrl = 'https://raw.githubusercontent.com/flizzywine/dsh-tavern/plugin-market-next/index.json'
)

$ErrorActionPreference = 'Stop'

if (-not $env:DSH_HOME -or -not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    throw 'Run this command in the DSH terminal opened from DSH NEXT.'
}

$profileDir = Join-Path $env:DSH_HOME 'profiles/tavern'
$manifestPath = Join-Path $profileDir 'package.json'
$createProfile = -not (Test-Path -LiteralPath $profileDir)
if (-not $createProfile) {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'The existing tavern Profile has no package.json. Repair it in DSH NEXT before installing.'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = $manifest.dsh.profile.bundles
    if ($bundles -contains 'dsh-tavern-plugin') {
        throw 'This tavern Profile uses the source installation. Remove its old Tavern bundles before installing dsh-tavern-bundle.'
    }
    if ($bundles -notcontains '@deepseek-ai/dsh-web-app') {
        throw 'The existing tavern Profile must use the Web template.'
    }
}

$sources = @()
$version = $null
if (-not $PSBoundParameters.ContainsKey('IndexUrl')) {
    $roots = @('https://raw.githubusercontent.com/flizzywine/dsh-tavern/', 'https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@')
    foreach ($root in $roots) {
        try {
            $download = Invoke-RestMethod -Uri "${root}plugin-next-downloads/next-download.json" -TimeoutSec 12
            if ($download.revision -cnotmatch '^[a-f0-9]{40}$') { continue }
            $version = $download.version
            $sources = @($root) + @($roots | Where-Object { $_ -ne $root }) | ForEach-Object { "$_$($download.revision)/dsh-tavern-bundle.tgz" }
            break
        } catch { Write-Verbose $_.Exception.Message }
    }
}

if (-not $sources.Count -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Could not read the Tavern download manifest from GitHub or jsDelivr. Check your connection and try again.'
}

if ($createProfile) {
    dsh --profile tavern --from-default-profile web --dump-config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the tavern Profile.' }
}

foreach ($source in $sources) {
    Write-Host "Installing DSH Tavern $version into the tavern Profile..."
    dsh plugin --profile tavern add $source --allow-build=sharp
    if ($LASTEXITCODE -eq 0) { break }
}
if (-not $sources.Count -or $LASTEXITCODE -ne 0) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'DSH plugin installation failed from GitHub and jsDelivr.' }
    $index = Invoke-RestMethod -Uri $IndexUrl -TimeoutSec 30
    $plugin = $index.plugins | Where-Object { $_.name -eq 'dsh-tavern-bundle' }
    $release = $plugin.versions | Select-Object -First 1
    $repository = 'https://github.com/flizzywine/dsh-tavern.git'
    if ($index.format -ne 1 -or $release.source.type -ne 'git' -or $release.source.url -cne $repository -or $release.source.commit -cnotmatch '^[a-f0-9]{40}$') {
        throw 'The Tavern release index does not contain a valid Git release.'
    }
    Write-Host "Installing DSH Tavern $($release.version) into the tavern Profile via Git..."
    dsh plugin --profile tavern add "git+${repository}#$($release.source.commit)" --allow-build=sharp
    if ($LASTEXITCODE -ne 0) { throw 'DSH plugin installation failed.' }
}
Write-Host 'Ready. Select tavern from the DSH NEXT tray Profile menu. Run this command again to update.'
