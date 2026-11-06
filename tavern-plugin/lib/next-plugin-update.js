import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import desktopRuntime from '../../bin/official-desktop-runtime.cjs'

export function createNextPluginUpdate(ctx) {
  let pending
  function invocation() {
    if (process.platform !== 'win32' || !process.versions.electron || !process.connected ||
        !process.env.SystemRoot || ctx.get('desktopProfiles')?.current?.name !== 'tavern') return
    const profile = ctx.get('profileContext')
    const layout = desktopRuntime.layout(process.execPath)
    if (layout.name !== 'dsh-desktop-next' || !profile?.home || !profile.dir) return
    return {
      executable: process.execPath,
      cli: join(layout.app, 'lib', 'desktop-cli.js'),
      home: profile.home,
      profileDir: profile.dir,
    }
  }

  function queue() {
    if (pending) return pending
    const options = invocation()
    if (!options) throw new Error('请先退出酒馆，再通过 DSH NEXT 终端更新。')
    // Keep the waiter outside node_modules so pnpm can replace the running build.
    const input = Buffer.from(JSON.stringify({ ...options, host: process.pid, shell: process.ppid }), 'utf8').toString('base64')
    const command = `
$ErrorActionPreference = 'Stop'
try {
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
  Write-Host '请从 NEXT 的「应用 → 退出」关闭程序，并保持此窗口打开。'
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $name = [IO.Path]::GetFileNameWithoutExtension($config.executable)
  while ((Get-Process -Id @($config.host, $config.shell) -ErrorAction SilentlyContinue) -or
         (Get-Process -Name $name -ErrorAction SilentlyContinue)) {
    if ($clock.Elapsed.TotalMinutes -ge 5) { throw '等待退出超时，尚未执行更新。' }
    Start-Sleep -Milliseconds 400
  }
  $env:DSH_HOME = $config.home
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $config.executable --expose-internals $config.cli plugin --profile tavern add 'github:flizzywine/dsh-tavern#plugin-market-next' --allow-build=sharp | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "DSH 更新失败（退出代码 $LASTEXITCODE）。" }
  $bundle = Join-Path $config.profileDir 'node_modules/dsh-tavern-bundle'
  $manifest = Get-Content -LiteralPath (Join-Path $bundle 'package.json') -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'dsh-tavern-bundle' -or !$manifest.dsh.bundle.patch) { throw '酒馆插件安装不完整。' }
  foreach ($patch in $manifest.dsh.bundle.patch) {
    if (!(Test-Path -LiteralPath (Join-Path $bundle $patch) -PathType Leaf)) { throw "找不到插件配置文件 $patch" }
  }
  Remove-Item Env:ELECTRON_RUN_AS_NODE
  Start-Process -FilePath $config.executable
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host '按回车关闭窗口'
  exit 1
}
`
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    // Start-Process opens an interactive console with its own standard handles.
    const launcher = `
$worker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoLogo','-NoProfile','-EncodedCommand','${encoded}' -PassThru
$worker.WaitForExit()
`
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], {
      cwd: tmpdir(), detached: true, windowsHide: true, stdio: 'ignore',
    })
    pending = new Promise((resolve, reject) => {
      child.once('spawn', () => { child.unref(); resolve() })
      child.once('error', error => { pending = undefined; reject(error) })
      child.once('exit', () => { pending = undefined })
    })
    return pending
  }

  return { supported: () => Boolean(invocation()), queued: () => Boolean(pending), queue }
}
