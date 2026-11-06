import { spawnSync } from 'node:child_process'
import { resolveUpdateProgram } from './application-update.mjs'

// CreateProcess command-line quoting, not PowerShell or cmd.exe interpolation.
export function quoteWindowsArgument(value) {
  return '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'
}

// WMI is the parent of the updater, so stopping the old service cannot kill it
// through either taskkill /T or a third-party launcher's kill-on-close Job.
// Explicit environment transfer preserves proxy settings, DSH_HOME and Electron
// mode without putting credentials in command arguments or temporary files.
export const windowsUpdateLaunchScript = `
$ErrorActionPreference = 'Stop'
try {
  # A parent PowerShell 7 session may leave a module path incompatible with 5.1.
  Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1'))
  $OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $Encoded = [Console]::In.ReadToEnd()
  $Payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Encoded)) | ConvertFrom-Json
  Add-Type -AssemblyName System.Management
  $StartupClass = New-Object System.Management.ManagementClass -ArgumentList 'Win32_ProcessStartup'
  $Processes = New-Object System.Management.ManagementClass -ArgumentList 'Win32_Process'
  $Startup = $StartupClass.CreateInstance()
  # Break away from WMI provider Jobs too; preserve Unicode environment values.
  $Startup.CreateFlags = 0x01000000 -bor 0x08000000 -bor 0x00000400
  $Startup.ShowWindow = 0
  $Startup.EnvironmentVariables = [string[]]$Payload.environment
  $Parameters = $Processes.GetMethodParameters('Create')
  $Parameters.CommandLine = $Payload.commandLine
  $Parameters.CurrentDirectory = $Payload.cwd
  $Parameters.ProcessStartupInformation = $Startup
  $Result = $Processes.InvokeMethod('Create', $Parameters, $null)
  if ($Result.ReturnValue -ne 0) { throw ('WMI Create failed: ' + $Result.ReturnValue) }
  [Console]::Out.WriteLine($Result.ProcessId)
} catch {
  # Do not print the request or PowerShell invocation (they contain environment values).
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

export function launchWindowsUpdater(command, args, options = {}) {
  const env = options.env || process.env
  const cwd = options.cwd || process.cwd()
  const execute = options.execute || spawnSync
  const powershell = options.powershell || resolveUpdateProgram('cli', 'win32').command
  const payload = {
    commandLine: [command, ...args].map(quoteWindowsArgument).join(' '), cwd,
    environment: Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
  }
  const result = execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(windowsUpdateLaunchScript, 'utf16le').toString('base64')], {
    cwd, env, windowsHide: true, timeout: 20000, encoding: 'utf8',
    input: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
  })
  if (result.error || result.status !== 0) {
    throw new Error(`无法独立启动 Windows 更新器：${result.error?.message || result.stderr?.trim() || `退出码 ${result.status}`}。请先确认更新状态；未启动时可从外部终端运行 dsh-tavern update。`)
  }
  const pid = Number(result.stdout?.trim())
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Windows 更新器没有返回有效进程号，请检查更新诊断日志。')
  return pid
}
