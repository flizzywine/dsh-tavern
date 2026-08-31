$ErrorActionPreference = 'Stop'

$InstallHost = if ($env:DSH_TAVERN_HOST) { $env:DSH_TAVERN_HOST } else { 'cli' }
if ($InstallHost -notin @('cli', 'desktop')) { throw "不支持的安装宿主：$InstallHost" }

$Repository = if ($env:DSH_TAVERN_REPOSITORY) { $env:DSH_TAVERN_REPOSITORY } else { 'flizzywine/dsh-tavern' }
$RepositoryUrl = if ($env:DSH_TAVERN_GIT_URL) { $env:DSH_TAVERN_GIT_URL } else { "https://github.com/$Repository.git" }
$ArchiveUrl = if ($env:DSH_TAVERN_ARCHIVE_URL) { $env:DSH_TAVERN_ARCHIVE_URL } else { "https://codeload.github.com/$Repository/zip/refs/heads/main" }
$CommitUrl = if ($env:DSH_TAVERN_COMMIT_URL) { $env:DSH_TAVERN_COMMIT_URL } else { "https://api.github.com/repos/$Repository/commits/main" }
$CdnMetadataUrl = if ($env:DSH_TAVERN_CDN_METADATA_URL) { $env:DSH_TAVERN_CDN_METADATA_URL } else { "https://cdn.jsdelivr.net/gh/$Repository@main/dsh-tavern-runtime.json" }
$CdnRootUrl = if ($env:DSH_TAVERN_CDN_ROOT_URL) { $env:DSH_TAVERN_CDN_ROOT_URL.TrimEnd('/') } else { "https://cdn.jsdelivr.net/gh/$Repository" }
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
$AppDir = if ($env:DSH_TAVERN_APP_DIR) { $env:DSH_TAVERN_APP_DIR } else { Join-Path $DshRoot 'apps\dsh-tavern' }
$RuntimeRoot = Join-Path $DshRoot 'runtime'
$CommandBin = Join-Path $DshRoot 'bin'
$SourceCache = Join-Path $DshRoot 'source-cache\dsh-tavern.git'
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("dsh-tavern-install-" + [Guid]::NewGuid().ToString('N'))
$TargetCommit = if ($env:DSH_TAVERN_TARGET_COMMIT) { $env:DSH_TAVERN_TARGET_COMMIT } else { '' }
$RuntimePaths = @(
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  'install.ps1',
  'install.sh',
  'bin',
  'config',
  'presets',
  'tavern-plugin',
  'patches'
)

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-Command([string]$Name) {
  $WindowsShim = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
  if ($null -ne $WindowsShim) { return $WindowsShim.Source }
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $Command) { return $Command.Source }
  return $null
}

function Assert-LastCommand([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

try {
  if (-not (Test-Command 'node')) {
    Start-Process 'https://nodejs.org/'
    throw '未找到 Node.js。请安装 Node.js 22.19 或更高版本，然后重新运行本命令。'
  }

  $NodeVersionText = (& node --version).Trim()
  $NodeVersion = [version]$NodeVersionText.TrimStart('v')
  if ($NodeVersion -lt [version]'22.19.0') {
    throw "Node.js 版本过低，需要 22.19 或更高版本（当前：$NodeVersionText）。"
  }
  $GitCommand = Resolve-Command 'git'
  $NpmCommand = Resolve-Command 'npm'
  if ($InstallHost -eq 'cli' -and $null -eq $NpmCommand) { throw '未找到 npm，请重新安装 Node.js。' }

  # UI updates start in a fresh process that may not inherit the install-time PATH.
  # Prefer the DSH/pnpm shims already installed in Tavern's managed runtime before
  # deciding that either package is missing and downloading it again.
  $env:Path = "$RuntimeRoot;$env:Path"

  if ($InstallHost -eq 'cli') {
    $env:DSH_TAVERN_BIN_DIR = $CommandBin
    $env:Path = "$CommandBin;$env:Path"
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $UserEntries = @($UserPath -split ';' | Where-Object { $_ -ne '' })
    if (-not ($UserEntries | Where-Object { $_.TrimEnd('\') -ieq $CommandBin.TrimEnd('\') })) {
      $NewUserPath = (@($UserEntries) + $CommandBin) -join ';'
      [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
    }
  }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  $ArchivePath = Join-Path $TempDir 'app.zip'
  $ExtractDir = Join-Path $TempDir 'extract'
  $UsedGit = $false
  $UsedCdn = $false
  if ($null -ne $GitCommand) {
    try {
      Write-Host '正在通过 Git 增量同步 DSH Tavern（不下载文档与图片）……'
      New-Item -ItemType Directory -Force -Path (Split-Path $SourceCache -Parent) | Out-Null
      if (-not (Test-Path (Join-Path $SourceCache 'HEAD'))) {
        & $GitCommand clone --bare --filter=blob:none --depth 1 --single-branch --branch main $RepositoryUrl $SourceCache
        Assert-LastCommand 'DSH Tavern Git 缓存初始化失败。'
      }
      & $GitCommand --git-dir=$SourceCache remote set-url origin $RepositoryUrl
      Assert-LastCommand 'DSH Tavern Git 远程地址配置失败。'
      & $GitCommand --git-dir=$SourceCache fetch --depth 1 origin main
      Assert-LastCommand 'DSH Tavern 增量更新失败。'
      $TargetCommit = (& $GitCommand --git-dir=$SourceCache rev-parse FETCH_HEAD).Trim()
      Assert-LastCommand 'DSH Tavern 提交号读取失败。'
      & $GitCommand --git-dir=$SourceCache archive --format=zip "--output=$ArchivePath" FETCH_HEAD -- @RuntimePaths
      Assert-LastCommand 'DSH Tavern 精简运行包生成失败。'
      $UsedGit = $true
    }
    catch {
      Write-Warning ("Git 增量更新不可用，将回退到完整 ZIP：" + $_.Exception.Message)
    }
  }
  if (-not $UsedGit) {
    try {
      Write-Host 'GitHub 直连不可用，正在通过 jsDelivr 备用源下载运行代码……'
      $CdnSource = Join-Path $TempDir 'cdn-source'
      New-Item -ItemType Directory -Force -Path $CdnSource | Out-Null
      $Metadata = Invoke-RestMethod -UseBasicParsing -Uri $CdnMetadataUrl -TimeoutSec 15
      if ([string]$Metadata.revision -notmatch '^[0-9a-fA-F]{40}$') { throw 'jsDelivr 运行清单缺少有效提交号。' }
      $RuntimePattern = '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|cordis\.patch\.yml|install\.ps1|install\.sh|bin/|config/|presets/|tavern-plugin/)'
      $Files = @($Metadata.files | Where-Object { $_.path -match $RuntimePattern -and $_.path -notmatch '(^|/)\.\.(/|$)' -and $_.sha256 -match '^[0-9a-fA-F]{64}$' })
      if ($Files.Count -eq 0) { throw 'jsDelivr 未返回运行文件清单。' }
      foreach ($File in $Files) {
        $RelativePath = $File.path.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $Target = Join-Path $CdnSource $RelativePath
        New-Item -ItemType Directory -Force -Path (Split-Path $Target -Parent) | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri ("$CdnRootUrl@$($Metadata.revision)/$($File.path)") -OutFile $Target -TimeoutSec 30
        $ActualHash = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ActualHash -ne ([string]$File.sha256).ToLowerInvariant()) { throw "jsDelivr 文件校验失败：$($File.path)" }
      }
      $TargetCommit = [string]$Metadata.revision
      $UsedCdn = $true
    }
    catch {
      Write-Warning ("jsDelivr 备用源不可用，将回退到完整 ZIP：" + $_.Exception.Message)
    }
  }
  if (-not $UsedGit -and -not $UsedCdn) {
    Write-Host '正在下载完整 ZIP……'
    $PreviousProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
      if ($TargetCommit -eq '') {
        try { $TargetCommit = (Invoke-RestMethod -UseBasicParsing -Uri $CommitUrl -Headers @{ Accept = 'application/vnd.github+json' }).sha }
        catch { Write-Warning '无法记录当前提交号，不影响本次安装。' }
      }
      for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
        try {
          Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $ArchivePath
          break
        }
        catch {
          if ($Attempt -eq 3) { throw }
          Write-Host "下载失败，正在重试（$Attempt/3）……"
          Start-Sleep -Seconds 2
        }
      }
    }
    finally {
      $ProgressPreference = $PreviousProgressPreference
    }
  }
  if (-not $UsedCdn) {
    New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force
  }
  $SourceDir = if ($UsedCdn) {
    Get-Item -LiteralPath $CdnSource
  } elseif ($UsedGit) {
    Get-Item -LiteralPath $ExtractDir
  } else {
    Get-ChildItem -LiteralPath $ExtractDir -Directory | Select-Object -First 1
  }
  if ($null -eq $SourceDir) { throw '下载内容不完整。' }
  if (-not (Test-Path (Join-Path $SourceDir.FullName 'package.json'))) {
    throw '下载内容不完整。'
  }

  # Read compatibility from the downloaded release before installing missing tools.
  $CompatibilityScript = Join-Path $SourceDir.FullName 'bin\dsh-compatibility.mjs'
  $AdaptedDshVersion = (& node $CompatibilityScript --version)
  Assert-LastCommand '读取 DSH 适配版本失败。'
  $AdaptedDshVersion = $AdaptedDshVersion.Trim()
  & node $CompatibilityScript --notice
  Assert-LastCommand '读取 DSH 兼容提示失败。'
  $MissingPackages = @()
  if ($InstallHost -eq 'cli' -and -not (Test-Command 'pnpm')) { $MissingPackages += 'pnpm' }
  $DshCommand = Resolve-Command 'dsh'
  if ($InstallHost -eq 'cli' -and $null -eq $DshCommand) {
    $MissingPackages += "@deepseek-ai/dsh@$AdaptedDshVersion"
  }
  if ($MissingPackages.Count -gt 0) {
    Write-Host ("正在安装缺失依赖：" + ($MissingPackages -join '、') + '……')
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    & $NpmCommand install --global --prefix $RuntimeRoot @MissingPackages
    Assert-LastCommand 'pnpm 或 DeepSeek Harness 安装失败。'
  }
  $PnpmCommand = Resolve-Command 'pnpm'
  if ($null -eq $PnpmCommand) { throw '未找到 pnpm。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。' }
  $DshCommand = Resolve-Command 'dsh'
  if ($null -eq $DshCommand) { throw '未找到 DSH。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。' }

  $OldLauncher = Join-Path $AppDir 'bin\dsh-tavern.mjs'
  if ($InstallHost -eq 'cli' -and (Test-Path $OldLauncher)) {
    & node $OldLauncher stop *> $null
  }

  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  # 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data\ 用户数据会保留。
  Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item -Destination $AppDir -Recurse -Force
  if ($UsedCdn -and (Test-Path (Join-Path $AppDir '.dsh-tavern-release.json'))) {
    Remove-Item -LiteralPath (Join-Path $AppDir '.dsh-tavern-release.json') -Force
  }
  if ($TargetCommit -match '^[0-9a-fA-F]{40}$') {
    $ReleaseJson = @{ commit = $TargetCommit; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $AppDir '.dsh-tavern-release.json'), $ReleaseJson, (New-Object Text.UTF8Encoding($false)))
  }

  Write-Host '正在安装程序依赖……'
  & $PnpmCommand --dir $AppDir install --frozen-lockfile
  Assert-LastCommand '程序依赖安装失败。'

  Write-Host '正在配置 Tavern……'
  & node (Join-Path $AppDir 'bin\dsh-tavern.mjs') install --host $InstallHost
  Assert-LastCommand 'Tavern profile 安装失败。'
  if ($InstallHost -eq 'desktop') {
    Write-Host 'DSH Tavern Desktop 版安装完成。'
    Write-Host '请重启 DSH Desktop，再从托盘的 Profile 菜单切换到 tavern。'
  }
  else {
    & node (Join-Path $AppDir 'bin\dsh-tavern.mjs') start
    Assert-LastCommand 'DSH Tavern 启动失败。'
    Write-Host 'DSH Tavern 安装完成。请使用上方完整访问地址，或运行 dsh-tavern open 打开网页。'
    Write-Host '以后可以使用：dsh-tavern start、open、stop、restart、status、update（新 PowerShell 生效）'
  }
}
catch {
  throw ("安装失败：" + $_.Exception.Message)
}
finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
