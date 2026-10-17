param(
 [Parameter(Mandatory=$true)][string]$Launcher,
 [Parameter(Mandatory=$true)][string]$TestDirectory
)
$ErrorActionPreference='Stop'
$Launcher=(Resolve-Path -LiteralPath $Launcher).Path
$TestDirectory=[IO.Path]::GetFullPath($TestDirectory)
if(Test-Path -LiteralPath $TestDirectory){throw 'Use a new test directory'}
New-Item -ItemType Directory -Path $TestDirectory | Out-Null
$savedRoot=$env:DSH_LAUNCHER_TEST_ROOT; $savedTemp=$env:TEMP; $savedTmp=$env:TMP
$held=$null; $process=$null
try {
 $env:DSH_LAUNCHER_TEST_ROOT=$TestDirectory; $env:TEMP=$TestDirectory; $env:TMP=$TestDirectory
 $process=Start-Process -FilePath $Launcher -ArgumentList '--prepare-only' -WindowStyle Hidden -PassThru
 $null=$process.Handle
 $deadline=[DateTime]::UtcNow.AddSeconds(120)
 $lockedFile=$null
 while(!$process.HasExited -and [DateTime]::UtcNow -lt $deadline -and !$held) {
  foreach($directory in [IO.Directory]::GetDirectories($TestDirectory)) {
   $candidate=Join-Path $directory 'DeepSeek Harness.exe'
   if((Split-Path $directory -Leaf) -like 'preparing-*'){$candidate=Join-Path $directory 'app/DeepSeek Harness.exe'}
   if([IO.File]::Exists($candidate)) {
    try {
     # Allow extraction/patch reads and writes, but never share deletion/rename.
     $held=[IO.File]::Open($candidate,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
     $lockedFile=$candidate
     if(Test-Path -LiteralPath (Join-Path (Split-Path $candidate -Parent) 'ready')){throw 'Lock arrived after publication'}
     break
    } catch [IO.IOException] {}
   }
  }
  if(!$held){Start-Sleep -Milliseconds 20}
 }
 if(!$held){throw 'Could not acquire file lock before launcher finished'}
 if(!$process.WaitForExit(120000)){throw 'Launcher did not finish under a persistent file lock'}
 if($process.ExitCode -ne 0){
  Get-Content -LiteralPath (Join-Path $TestDirectory 'launcher-error.txt') -ErrorAction SilentlyContinue
  throw "Preparation failed while lock remained held: $($process.ExitCode)"
 }
 $runtime=Split-Path $lockedFile -Parent
 if(!(Test-Path -LiteralPath (Join-Path $runtime 'ready'))){throw 'Prepared runtime was moved or not committed'}
 Write-Output 'PASS: real payload extraction and patch finish while executable remains locked against rename'
 $readyBefore=(Get-Item -LiteralPath (Join-Path $runtime 'ready')).LastWriteTimeUtc
 $process.Dispose()
 $process=Start-Process -FilePath (Join-Path $TestDirectory 'DSH Tavern.exe') -ArgumentList '--prepare-only' -WindowStyle Hidden -PassThru
 $null=$process.Handle
 if(!$process.WaitForExit(30000) -or $process.ExitCode -ne 0){throw 'Installed entry failed with the same lock still held'}
 $runtimes=@(Get-ChildItem -LiteralPath $TestDirectory -Directory -Filter 'runtime-*')
 if($runtimes.Count -ne 1 -or (Get-Item -LiteralPath (Join-Path $runtime 'ready')).LastWriteTimeUtc -ne $readyBefore){throw 'Next launch prepared another runtime'}
 $shell=New-Object -ComObject WScript.Shell
 try {
  $link=$shell.CreateShortcut((Join-Path $TestDirectory 'Desktop/DSH Tavern.lnk'))
  try {if($link.IconLocation -ne ($lockedFile+',0')){throw 'Shortcut icon points to another runtime'}}
  finally {[Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null}
 } finally {[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null}
 Write-Output 'PASS: installed entry reuses the same committed runtime and shortcut while the lock remains held'
} finally {
 if($held){$held.Dispose()}
 if($process){if(!$process.HasExited){$process.Kill();$process.WaitForExit()};$process.Dispose()}
 $env:DSH_LAUNCHER_TEST_ROOT=$savedRoot; $env:TEMP=$savedTemp; $env:TMP=$savedTmp
}
