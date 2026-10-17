param([Parameter(Mandatory=$true)][string]$InstallDirectory,[switch]$Retry,
      [string]$Registry=$(if($env:DSH_TAVERN_NPM_REGISTRY){$env:DSH_TAVERN_NPM_REGISTRY}else{'https://registry.npmmirror.com'}))
$ErrorActionPreference='Stop'
$InstallDirectory=(Resolve-Path -LiteralPath $InstallDirectory).Path
if(!(Test-Path (Join-Path $InstallDirectory 'Desktop/DSH Tavern.lnk'))){throw 'Use an isolated launcher test installation'}
$data=Join-Path $InstallDirectory 'data'
$source=Join-Path $data 'harness/apps/dsh-tavern'
if((Test-Path $source) -and !$Retry){throw 'Fixture source must not already exist'}
New-Item -ItemType Directory -Force $source | Out-Null
if(!$Retry){
[IO.File]::WriteAllText((Join-Path $source 'package.json'),'{"name":"dsh-profile-tavern","version":"2.0.0","private":true}')
}
$sentinel=Join-Path $data 'upgrade-data-sentinel.txt'
if(!$Retry){Set-Content $sentinel 'existing game data'}
$before=(Get-FileHash $sentinel).Hash
$previousTestRoot=$env:DSH_LAUNCHER_TEST_ROOT
$previousRegistry=$env:DSH_TAVERN_NPM_REGISTRY
$env:DSH_LAUNCHER_TEST_ROOT=$InstallDirectory
$env:DSH_TAVERN_NPM_REGISTRY=$Registry
try {
    $testProcess=Start-Process -FilePath (Join-Path $InstallDirectory 'DSH Tavern.exe') -ArgumentList '--tavern-smoke' -WindowStyle Hidden -PassThru
    $null=$testProcess.Handle
    if(!$testProcess.WaitForExit(600000)){throw 'Online upgrade timed out'}
    if($testProcess.ExitCode -ne 0){throw 'Online upgrade failed; inspect launcher-error.txt and data/setup-upgrade.log'}
    $version=(Get-Content (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version
    if([version]$version -lt [version]'2.1.0'){throw 'Old plugin was retained'}
    $smoke=Get-Content (Join-Path $data 'smoke-result.json') -Raw | ConvertFrom-Json
    if(!$smoke.ok -or $smoke.desktop -ne '0.2.1-rc.2'){throw 'Unexpected Desktop startup result'}
    if((Get-FileHash $sentinel).Hash -ne $before){throw 'Existing data changed'}
    if(!(Test-Path (Join-Path $data '.launcher-upgrade-ready'))){throw 'Successful upgrade not recorded'}
    Write-Output "PASS: old installation upgraded to Tavern $version / Desktop $($smoke.desktop); data preserved; smoke passed"
} finally {
    $env:DSH_LAUNCHER_TEST_ROOT=$previousTestRoot
    $env:DSH_TAVERN_NPM_REGISTRY=$previousRegistry
}
