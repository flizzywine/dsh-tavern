// Read-only exclusion fence for installation management. Names/paths identify
// possible users of these files, NEVER ownership or permission to kill them.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

const exec = promisify(execFile)
const fail = message => { throw Object.assign(new Error(message), { code: 'installation-process-busy' }) }
const normalize = (value, platform) => platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value
const runtime = /^(?:node|electron|dsh)(?:\.exe|\.cmd)?$/i
const gui = /^(?:deepseek[ -]?harness|dsh[- ]?desktop)(?:\.exe)?$/i
// Match runnable entry points, not a repository name or arbitrary pasted source.
const dshArguments = /(?:[\\/](?:bin[\\/]dsh-tavern\.mjs|dsh-desktop-host(?:[\\/\s"']|$))|--profile(?:=|\s+)['"]?tavern(?:['"]?\s|$))/i
const firstArgument = command => /^(?:"([^"\n]+)"|'([^'\n]+)'|(\S+))/.exec(command.trim())?.slice(1).find(Boolean) || ''
const executableName = value => value.replaceAll('\\', '/').split('/').at(-1)
const includesPath = (text, root) => {
  let offset = text.indexOf(root)
  while (offset !== -1) {
    const next = text[offset + root.length]
    if (next === undefined || /[\\/\s"']/.test(next)) return true
    offset = text.indexOf(root, offset + 1)
  }
  return false
}

export async function installationProcessInventory({ platform = process.platform, run = exec } = {}) {
  if (platform === 'win32') {
    const script = '$ErrorActionPreference="Stop"; $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { @{pid=[int]$_.ProcessId; name=$_.Name; commandLine=$_.CommandLine; executable=$_.ExecutablePath} }); @{inspectorPid=$PID;rows=$rows}|ConvertTo-Json -Depth 4 -Compress'
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,args='], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
  const rows = stdout.trim().split('\n').filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match) throw new Error('无法解析进程清单')
    return { pid: Number(match[1]), commandLine: match[2], name: firstArgument(match[2]) }
  })
  // ps itself has no installation paths in its arguments; it is not excluded by
  // command-string matching, so a different process cannot impersonate it.
  return { rows }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM') return true
    throw error
  }
}

export async function assertInstallationIdle(request, {
  platform = process.platform, selfPid = process.pid,
  inventory = () => installationProcessInventory({ platform }),
  alive = processAlive, read = readFileSync,
  cwd = pid => platform === 'linux' ? readlinkSync(`/proc/${pid}/cwd`) : '',
} = {}) {
  const home = request.home || request.installation?.sharedHome
  if (typeof home !== 'string' || !home) fail('无法确定安装归属，未修改目录。')
  const pidFile = path.join(home, 'logs', 'tavern.pid.json')
  try {
    const record = JSON.parse(read(pidFile, 'utf8'))
    if (!Number.isSafeInteger(record?.pid) || record.pid <= 1) fail(`酒馆服务进程记录无效，请检查：${pidFile}`)
    // Even a recycled PID is a reason to refuse, not a reason to terminate it.
    if (record.pid === selfPid || await alive(record.pid)) fail(`酒馆独立服务可能仍在运行（PID ${record.pid}）。请正常退出并核对 ${pidFile} 后重试；未结束任何进程。`)
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`无法确认酒馆独立服务已停止：${error.message}`)
  }
  let snapshot
  try { snapshot = await inventory() } catch (error) { fail(`无法读取进程清单，未修改目录：${error.message}`) }
  if (!Array.isArray(snapshot?.rows) || snapshot.rows.length === 0) fail('进程清单为空或无效，无法确认安装空闲。')
  const roots = [home, request.installation?.appDir, request.installation?.profileDir, request.installation?.dataDir,
    ...(request.installation?.entries || []).flatMap(entry => [entry.from, entry.to])].filter(value => typeof value === 'string' && value)
    .map(value => normalize(value, platform))
  for (const row of snapshot.rows) {
    if (!Number.isSafeInteger(row?.pid) || row.pid < 0) fail('进程清单包含无效 PID，未修改目录。')
    if (row.pid === selfPid || row.pid === snapshot.inspectorPid || row.pid <= 1) continue
    const command = typeof row.commandLine === 'string' ? row.commandLine : ''
    const identity = `${row.name || ''} ${row.executable || ''} ${command}`
    const executable = executableName(row.executable || row.name || firstArgument(command))
    const isGui = gui.test(executable)
    const knownRuntime = runtime.test(executable)
    if (!knownRuntime && !isGui) continue
    // A relevant executable with hidden arguments cannot be cleared safely.
    if (!command.trim()) fail(`无法检查运行时进程 PID ${row.pid} 的参数；请正常退出相关程序后重试。`)
    let directory = ''
    if (platform === 'linux') {
      try { directory = cwd(row.pid) } catch (error) {
        // Exit during inspection is harmless. Permission denial is not proof of idle.
        if (!['ENOENT', 'ESRCH'].includes(error.code)) fail(`无法检查运行时进程 PID ${row.pid} 的工作目录：${error.message}`)
      }
    }
    const searchable = normalize(`${identity}\n${directory}`, platform)
    if (isGui || /^dsh(?:\.exe|\.cmd)?$/i.test(executable) || dshArguments.test(command) || roots.some(root => includesPath(searchable, root))) {
      fail(`检测到可能使用酒馆或 DSH 的进程（PID ${row.pid}）。请正常退出所有 DSH / 酒馆窗口与服务后重试；未结束任何进程。`)
    }
  }
  return { idle: true }
}
