$ErrorActionPreference = 'Stop'

$Repository = if ($env:DSH_TAVERN_REPOSITORY) { $env:DSH_TAVERN_REPOSITORY } else { 'flizzywine/dsh-tavern' }
$ArchiveUrl = if ($env:DSH_TAVERN_ARCHIVE_URL) { $env:DSH_TAVERN_ARCHIVE_URL } else { "https://github.com/$Repository/archive/refs/heads/main.zip" }
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
$AppDir = if ($env:DSH_TAVERN_APP_DIR) { $env:DSH_TAVERN_APP_DIR } else { Join-Path $DshRoot 'apps\dsh-tavern' }
$RuntimeRoot = Join-Path $DshRoot 'runtime'
$CommandBin = Join-Path $DshRoot 'bin'
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("dsh-tavern-install-" + [Guid]::NewGuid().ToString('N'))

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

  & node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)'
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js 版本过低，需要 22.19 或更高版本（当前：$(& node --version)）。"
  }
  $NpmCommand = Resolve-Command 'npm'
  if ($null -eq $NpmCommand) { throw '未找到 npm，请重新安装 Node.js。' }

  if (-not (Test-Command 'pnpm') -or -not (Test-Command 'dsh')) {
    Write-Host '正在安装 pnpm 与 DeepSeek Harness……'
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    & $NpmCommand install --global --prefix $RuntimeRoot pnpm '@deepseek-ai/dsh'
    Assert-LastCommand 'pnpm 或 DeepSeek Harness 安装失败。'
    $env:Path = "$RuntimeRoot;$env:Path"
  }
  $PnpmCommand = Resolve-Command 'pnpm'
  if ($null -eq $PnpmCommand) { throw '安装后仍未找到 pnpm。' }

  $env:DSH_TAVERN_BIN_DIR = $CommandBin
  $env:Path = "$CommandBin;$env:Path"
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $UserEntries = @($UserPath -split ';' | Where-Object { $_ -ne '' })
  if (-not ($UserEntries | Where-Object { $_.TrimEnd('\') -ieq $CommandBin.TrimEnd('\') })) {
    $NewUserPath = (@($UserEntries) + $CommandBin) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
  }

  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  $ArchivePath = Join-Path $TempDir 'app.zip'
  $ExtractDir = Join-Path $TempDir 'extract'
  Write-Host '正在下载 DSH Tavern……'
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
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force
  $SourceDir = Get-ChildItem -LiteralPath $ExtractDir -Directory | Select-Object -First 1
  if ($null -eq $SourceDir -or -not (Test-Path (Join-Path $SourceDir.FullName 'package.json'))) {
    throw '下载内容不完整。'
  }

  $OldLauncher = Join-Path $AppDir 'bin\dsh-tavern.mjs'
  if (Test-Path $OldLauncher) {
    & node $OldLauncher stop *> $null
  }

  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  # 覆盖程序文件但不删除旧目录，因此未被发布包跟踪的 data\ 用户数据会保留。
  Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item -Destination $AppDir -Recurse -Force

  Write-Host '正在配置 Tavern……'
  & $PnpmCommand --dir $AppDir run install:tavern
  Assert-LastCommand 'Tavern profile 安装失败。'
  & $PnpmCommand --dir $AppDir run start:tavern
  Assert-LastCommand 'DSH Tavern 启动失败。'

  Write-Host 'DSH Tavern 安装完成：http://127.0.0.1:3081'
  Write-Host '以后可以使用：dsh-tavern start、stop、restart、status、update（新 PowerShell 生效）'
  if ($env:DSH_TAVERN_NO_OPEN -ne '1') {
    Start-Process 'http://127.0.0.1:3081'
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
