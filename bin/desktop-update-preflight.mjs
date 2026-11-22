import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import desktopRuntime from './official-desktop-runtime.cjs'
import { isLoopbackHost, resolveBindHost, serviceOrigin } from './service-address.mjs'

const execFileAsync = promisify(execFile)
const windowsPath = value => typeof value === 'string' && /^[a-z]:[\\/]/i.test(value)
  ? path.win32.normalize(value).toLowerCase() : ''
// The service writes startedAt after spawn. Older records or a slow/uncertain
// probe are not enough to block preparation; the publish guard remains mandatory.
const RECORD_WRITE_GRACE_MS = 2_000

export async function findStandaloneDesktopService({ dshHome, sourceRoot, executable, read = readFile,
  exec = execFileAsync, bootstrapFor = file => desktopRuntime.layout(file, 'win32').bootstrap }) {
  try {
    const record = JSON.parse(await read(path.join(dshHome, 'logs', 'tavern.pid.json'), 'utf8'))
    if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || record.pid > 0xffffffff ||
        !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535 ||
        record.profile !== 'tavern' || !windowsPath(sourceRoot) || windowsPath(record.source) !== windowsPath(sourceRoot) ||
        !record.bindHost) return null

    const exe = windowsPath(executable)
    const bootstrap = windowsPath(bootstrapFor(executable))
    if (!exe || !bootstrap || !exe.endsWith('\\deepseek harness.exe') ||
        !bootstrap.endsWith('\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js')) return null

    const bindHost = resolveBindHost(record.bindHost)
    const expected = ['--expose-internals', bootstrap, '--profile', record.profile, '--host', bindHost, '--port', String(record.port), '--no-open']
    if (!isLoopbackHost(bindHost)) expected.push('--trusted-host', `${new URL(serviceOrigin(bindHost, record.port)).hostname}:${record.port}`)
    // Query only the recorded PID. Never propagate the command line or probe
    // errors, which could contain local paths or sensitive process arguments.
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}' -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; command=$_.CommandLine; created=$_.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress }`],
    { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 16 * 1024 })
    const current = JSON.parse(stdout)
    const age = Date.parse(record.startedAt) - Date.parse(current.created)
    if (current.pid !== record.pid || !Number.isFinite(age) || age < 0 || age > RECORD_WRITE_GRACE_MS ||
        typeof current.command !== 'string') return null
    const command = current.command.trim()
    const tokens = [...command.matchAll(/(?:^|\s+)(?:"([^"]+)"|([^"\s]+))(?=\s|$)/g)]
    if (tokens.map(token => token[0]).join('') !== command) return null
    const [actualExe, ...args] = tokens.map(token => token[1] ?? token[2])
    if (windowsPath(actualExe) !== exe || args.length !== expected.length) return null
    args[1] = windowsPath(args[1])
    return expected.every((arg, index) => arg === args[index]) ? { pid: record.pid } : null
  } catch { return null }
}
