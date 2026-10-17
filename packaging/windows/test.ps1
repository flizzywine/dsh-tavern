param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$TestDirectory
)
$ErrorActionPreference = 'Stop'
$Launcher = (Resolve-Path -LiteralPath $Launcher).Path
$TestDirectory = [IO.Path]::GetFullPath($TestDirectory)
if (Test-Path -LiteralPath $TestDirectory) { throw 'Use a new, empty test directory' }
New-Item -ItemType Directory $TestDirectory | Out-Null
$originalTestRoot = $env:DSH_LAUNCHER_TEST_ROOT
$originalOffline = $env:DSH_ONLINE_TEST_OFFLINE
# Read shortcuts through Unicode IShellLinkW: WScript.Shell mangles non-ANSI paths
# on a non-Chinese system code page (for example GitHub's en-US Windows runners).
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class ShortcutReader {
 [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
 [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
 interface IShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
  void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
 }
 public static string[] Read(string file) {
  var link = (IShellLinkW)new ShellLink();
  try {
   ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(file, 0);
   var target = new StringBuilder(32768); link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
   var directory = new StringBuilder(32768); link.GetWorkingDirectory(directory, directory.Capacity);
   return new[] { target.ToString(), directory.ToString() };
  } finally { Marshal.FinalReleaseComObject(link); }
 }
}
'@
function Assert-True($condition, $message) {
    if (!$condition) { throw "FAIL: $message" }
    Write-Output "PASS: $message"
}
function Run-Launcher([string]$file, [string]$argument='--prepare-only') {
    $process = Start-Process -FilePath $file -ArgumentList $argument -PassThru -WindowStyle Hidden
    $null=$process.Handle; if (!$process.WaitForExit(120000)) { $process.Kill(); throw 'Launcher timed out' }
    return $process.ExitCode
}
try {
    $install = Join-Path $TestDirectory '中文 安装路径'
    $downloads = Join-Path $TestDirectory 'Downloads'
    New-Item -ItemType Directory $downloads | Out-Null
    $download = Join-Path $downloads 'setup.exe'
    Copy-Item -LiteralPath $Launcher -Destination $download
    $env:DSH_LAUNCHER_TEST_ROOT = $install
    Assert-True ((Run-Launcher $download) -eq 0) 'first preparation succeeds'
    $stable = Join-Path $install 'DSH Tavern.exe'
    Assert-True (Test-Path -LiteralPath $stable) 'stable outer launcher exists'
    Assert-True (((Get-Item -LiteralPath $install).Attributes -band [IO.FileAttributes]::Hidden) -eq 0) 'new installation folder is visible'
    $runtime = (Get-ChildItem -LiteralPath $install -Directory -Filter 'runtime-*' | Select-Object -First 1).FullName
    $electronMode = $env:ELECTRON_RUN_AS_NODE
    try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        $probeArguments = @((Join-Path $PSScriptRoot 'test-unicode-shims.mjs'), $runtime, (Join-Path $install '中文 命令测试')) | ForEach-Object { '"' + $_ + '"' }
        $stdout = Join-Path $install 'unicode-test.stdout.txt'; $stderr = Join-Path $install 'unicode-test.stderr.txt'
        $probe = Start-Process -FilePath (Join-Path $runtime 'DeepSeek Harness.exe') -ArgumentList $probeArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $null=$probe.Handle; if (!$probe.WaitForExit(30000)) { $probe.Kill(); throw 'Unicode command probe timed out' }
        Get-Content -LiteralPath $stdout
        if ($probe.ExitCode -ne 0) { Get-Content -LiteralPath $stderr; throw 'Unicode command shim regression failed' }
    } finally { $env:ELECTRON_RUN_AS_NODE = $electronMode }
    foreach ($folder in @('Desktop','StartMenu')) {
        $linkPath = Join-Path $install "$folder/DSH Tavern.lnk"
        Assert-True (Test-Path -LiteralPath $linkPath) "$folder shortcut exists"
        $link = [ShortcutReader]::Read($linkPath)
        Assert-True ($link[0] -eq $stable) "$folder targets stable launcher"
        Assert-True ($link[1] -eq $install) "$folder has correct working directory"
    }
    $sentinel = Join-Path $install 'data/用户存档.txt'
    Set-Content -LiteralPath $sentinel -Value 'Existing card and chat sentinel'
    $before = (Get-FileHash -LiteralPath $sentinel).Hash
    $installFolder = Get-Item -LiteralPath $install
    $installFolder.Attributes = $installFolder.Attributes -bor [IO.FileAttributes]::Hidden
    # Moving away the original download must not break the installed entry.
    Move-Item -LiteralPath $download -Destination (Join-Path $downloads 'removed-download.exe')
    Remove-Item -LiteralPath (Join-Path $install 'Desktop/DSH Tavern.lnk')
    Assert-True ((Run-Launcher $stable) -eq 0) 'installed entry runs after download is moved'
    Assert-True (((Get-Item -LiteralPath $install -Force).Attributes -band [IO.FileAttributes]::Hidden) -eq 0) 'legacy hidden installation becomes visible'
    Assert-True (Test-Path -LiteralPath (Join-Path $install 'Desktop/DSH Tavern.lnk')) 'missing shortcut is repaired'
    Assert-True ((Get-FileHash -LiteralPath $sentinel).Hash -eq $before) 'existing data is preserved'

    # A persisted external legacy data directory remains authoritative across launches.
    $legacy = Join-Path $TestDirectory '旧数据 保留原位'
    New-Item -ItemType Directory $legacy | Out-Null
    Set-Content -LiteralPath (Join-Path $legacy '存档.txt') -Value 'Legacy data'
    $settings = Join-Path $install 'launcher-settings.xml'
    $xml = [xml](Get-Content -LiteralPath $settings -Raw)
    $xml.Installation.DataDirectory = [string]$legacy
    $xml.Save($settings)
    Assert-True ((Run-Launcher $stable) -eq 0) 'legacy external data path is accepted'
    Assert-True (([xml](Get-Content -LiteralPath $settings -Raw)).Installation.DataDirectory -eq $legacy) 'legacy data path is not silently reset'
    Assert-True ((Get-Content -LiteralPath (Join-Path $legacy '存档.txt')) -eq 'Legacy data') 'legacy data is untouched'

    # Online failure still leaves a discoverable retry entry and does not claim success.
    $env:DSH_ONLINE_TEST_OFFLINE = '1'
    Assert-True ((Run-Launcher $stable '--tavern-smoke') -ne 0) 'offline first install reports failure'
    Assert-True (Test-Path -LiteralPath $stable) 'failed install retains retry entry'
    Assert-True (Test-Path -LiteralPath (Join-Path $install 'StartMenu/DSH Tavern.lnk')) 'failed install retains start-menu entry'
    Assert-True (Test-Path -LiteralPath (Join-Path $install 'launcher-error.txt')) 'failure includes a local diagnostic log'

    # Missing old data must be reported rather than replaced by an empty profile.
    $missing = Join-Path $TestDirectory 'missing-data'
    $xml.Installation.DataDirectory = [string]$missing; $xml.Save($settings)
    Assert-True ((Run-Launcher $stable) -ne 0) 'missing data path blocks silent reset'
    Assert-True (!(Test-Path -LiteralPath $missing)) 'missing data directory is not recreated'
    Write-Output 'All Windows launcher integration checks passed.'
} finally {
    $env:DSH_LAUNCHER_TEST_ROOT = $originalTestRoot
    $env:DSH_ONLINE_TEST_OFFLINE = $originalOffline
}
