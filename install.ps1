$ErrorActionPreference = 'Stop'

$InstallHost = if ($env:DSH_TAVERN_HOST) { $env:DSH_TAVERN_HOST } else { 'cli' }
if ($InstallHost -notin @('cli', 'desktop')) { throw "不支持的安装宿主：$InstallHost" }

$Repository = if ($env:DSH_TAVERN_REPOSITORY) { $env:DSH_TAVERN_REPOSITORY } else { 'flizzywine/dsh-tavern' }
$RepositoryUrl = if ($env:DSH_TAVERN_GIT_URL) { $env:DSH_TAVERN_GIT_URL } else { "https://github.com/$Repository.git" }
$ArchiveUrl = if ($env:DSH_TAVERN_ARCHIVE_URL) { $env:DSH_TAVERN_ARCHIVE_URL } else { "https://codeload.github.com/$Repository/zip/refs/heads/main" }
$CommitUrl = if ($env:DSH_TAVERN_COMMIT_URL) { $env:DSH_TAVERN_COMMIT_URL } else { "https://api.github.com/repos/$Repository/commits/main" }
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
  'tavern-plugin'
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
  $MissingPackages = @()
  if ($InstallHost -eq 'cli' -and -not (Test-Command 'pnpm')) { $MissingPackages += 'pnpm' }
  $DshCommand = Resolve-Command 'dsh'
  if ($InstallHost -eq 'cli' -and $null -eq $DshCommand) {
    $MissingPackages += '@deepseek-ai/dsh'
  }
  if ($MissingPackages.Count -gt 0) {
    Write-Host ("正在安装或升级：" + ($MissingPackages -join '、') + '……')
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    & $NpmCommand install --global --prefix $RuntimeRoot @MissingPackages
    Assert-LastCommand 'pnpm 或 DeepSeek Harness 安装失败。'
  }
  $PnpmCommand = Resolve-Command 'pnpm'
  if ($null -eq $PnpmCommand) { throw '未找到 pnpm。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。' }
  $DshCommand = Resolve-Command 'dsh'
  if ($null -eq $DshCommand) { throw '未找到 DSH。Desktop 版请从 DSH Desktop 托盘打开 DSH Terminal 后运行本命令。' }

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
    Write-Host '未检测到可用 Git，正在下载完整 ZIP……'
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
  New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force
  $SourceDir = if ($UsedGit) {
    Get-Item -LiteralPath $ExtractDir
  } else {
    Get-ChildItem -LiteralPath $ExtractDir -Directory | Select-Object -First 1
  }
  if ($null -eq $SourceDir) { throw '下载内容不完整。' }
  if (-not (Test-Path (Join-Path $SourceDir.FullName 'package.json'))) {
    throw '下载内容不完整。'
  }

  $OldLauncher = Join-Path $AppDir 'bin\dsh-tavern.mjs'
  if ($InstallHost -eq 'cli' -and (Test-Path $OldLauncher)) {
    & node $OldLauncher stop *> $null
  }

  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  # 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data\ 用户数据会保留。
  Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item -Destination $AppDir -Recurse -Force
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
    Write-Host 'DSH Tavern 安装完成：http://127.0.0.1:3081'
    Write-Host '以后可以使用：dsh-tavern start、stop、restart、status、update（新 PowerShell 生效）'
    if ($env:DSH_TAVERN_NO_OPEN -ne '1') {
      Start-Process 'http://127.0.0.1:3081'
    }
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
