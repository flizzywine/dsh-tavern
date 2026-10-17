param([Parameter(Mandatory=$true)][string]$Launcher,
      [Parameter(Mandatory=$true)][string]$Runtime,
      [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $TestDirectory){throw 'Use a new test directory'}
New-Item -ItemType Directory $TestDirectory | Out-Null
$env:DSH_LAUNCHER_TEST_ROOT=$TestDirectory
$env:DSH_ONLINE_TEST_OFFLINE='1'
try {
    $assembly=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes($Launcher))
    $type=$assembly.GetType('Launcher')
    $flags=[Reflection.BindingFlags]'Instance,NonPublic'
    $form=[Activator]::CreateInstance($type,$flags,$null,@(,[string[]]@()),$null)
    $null=$form.Handle
    $data=Join-Path $TestDirectory 'data'
    $source=Join-Path $data 'harness/apps/dsh-tavern'
    New-Item -ItemType Directory -Force $source | Out-Null
    Set-Content (Join-Path $source 'package.json') '{"version":"2.0.0"}'
    foreach($pair in @(@('root',$TestDirectory),@('runtime',$Runtime),@('data',$data))){$type.GetField($pair[0],$flags).SetValue($form,$pair[1])}
    $failed=$false
    try {$type.GetMethod('EnsureTavern',$flags).Invoke($form,@())} catch {
        $failed=$true
        if($_.Exception.GetBaseException().Message -notmatch '网络不可用'){throw}
    }
    if(!$failed){throw 'FAIL: existing old plugin skipped upgrade instead of reporting offline failure'}
    if(Test-Path (Join-Path $data '.launcher-upgrade-ready')){throw 'FAIL: failed upgrade marked ready'}
    if((Get-Content (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version -ne '2.0.0'){throw 'FAIL: offline failure changed old plugin'}
    Write-Output 'PASS: existing plugin attempts upgrade; offline failure preserves version and remains retryable'
    $version=$type.GetField('Version',[Reflection.BindingFlags]'Static,NonPublic').GetRawConstantValue()
    Set-Content (Join-Path $data '.launcher-upgrade-ready') $version -NoNewline
    if($type.GetMethod('NeedsUpgrade',$flags).Invoke($form,@())){throw 'FAIL: successful installed entry requires network again'}
    $type.GetField('showCompletion',$flags).SetValue($form,$true)
    if(!$type.GetMethod('NeedsUpgrade',$flags).Invoke($form,@())){throw 'FAIL: explicit reinstall skips update'}
    try {$type.GetMethod('EnsureTavern',$flags).Invoke($form,@())} catch {
        if($_.Exception.GetBaseException().Message -notmatch '网络不可用'){throw}
    }
    if(Test-Path (Join-Path $data '.launcher-upgrade-ready')){throw 'FAIL: failed explicit update retains success marker'}
    Write-Output 'PASS: normal launch remains offline; explicit setup retries updates and invalidates stale success'
    $owned=Join-Path $TestDirectory 'runtime-old'
    $other=Join-Path ($TestDirectory+'-other') 'runtime-old'
    New-Item -ItemType Directory -Force $owned,$other | Out-Null
    $fixture=Join-Path $TestDirectory 'Fixture.cs'
    Set-Content $fixture 'class Fixture { static void Main(){System.Threading.Thread.Sleep(120000);} }'
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$owned/DSH Desktop.exe" $fixture
    if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
    Copy-Item "$owned/DSH Desktop.exe" "$other/DSH Desktop.exe"
    Copy-Item "$owned/DSH Desktop.exe" "$owned/DeepSeek Harness.exe"
    Copy-Item "$owned/DSH Desktop.exe" "$other/DeepSeek Harness.exe"
    $official=Start-Process "$owned/DeepSeek Harness.exe" -PassThru -WindowStyle Hidden
    $otherOfficial=Start-Process "$other/DeepSeek Harness.exe" -PassThru -WindowStyle Hidden
    $old=Start-Process "$owned/DSH Desktop.exe" -PassThru -WindowStyle Hidden
    $unrelated=Start-Process "$other/DSH Desktop.exe" -PassThru -WindowStyle Hidden
    try {
        $type.GetMethod('StopInstallationProcesses',$flags).Invoke($form,@())
        if(!$old.WaitForExit(1000)){throw 'FAIL: old installation process remains alive'}
        if(!$official.WaitForExit(1000)){throw 'FAIL: official installation process remains alive'}
        if($otherOfficial.HasExited){throw 'FAIL: unrelated official installation was stopped'}
        if($unrelated.HasExited){throw 'FAIL: another installation was stopped'}
        Write-Output 'PASS: old process is stopped; neighboring installation is untouched'
    } finally {
        foreach($process in @($old,$unrelated,$official,$otherOfficial)){if(!$process.HasExited){$process.Kill()};$process.Dispose()}
    }
    $form.Dispose()
} finally {
    Remove-Item Env:DSH_LAUNCHER_TEST_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:DSH_ONLINE_TEST_OFFLINE -ErrorAction SilentlyContinue
}
