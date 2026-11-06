import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeTreeSync } from './portable-fs.mjs'

const moduleFile = fileURLToPath(import.meta.url)
const DIRECTORY_ENV = 'DSH_TAVERN_INSTALL_PROCESS_DIR'
const ANCESTORS_ENV = 'DSH_TAVERN_INSTALL_PROCESS_ANCESTORS'
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const positiveInteger = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback

function records(directory) {
  return readdirSync(directory).filter(name => /^\d+\.json$/.test(name)).map(name => {
    let record
    try { record = JSON.parse(readFileSync(path.join(directory, name), 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || !Array.isArray(record.ancestors)) {
      throw new Error('Invalid installation process registration')
    }
    return record
  }).filter(Boolean)
}

function belongsTo(record, pid) {
  return record.pid === pid || record.ancestors.includes(pid)
}

function stopped(directory, ancestors) {
  return existsSync(path.join(directory, 'stopping')) || ancestors.some(pid => existsSync(path.join(directory, `stopping-${pid}`)))
}

function execute(command, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolve(stdout)
    })
  })
}

function windowsProcessAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM') return true
    throw error
  }
}

async function groupIsAlive(pid, deadline) {
  try { process.kill(-pid, 0) } catch (error) {
    if (error.code === 'ESRCH') return false
    // Darwin can report EPERM for a group containing only zombies: killpg1
    // excludes SZOMB members, then finds nobody eligible to receive a signal.
    // EPERM is not proof of exit, so inspect the complete group below instead.
    if (error.code !== 'EPERM') throw error
  }
  // kill(0) includes zombies, particularly under container PID 1. Zombies can
  // never write again; inspect the whole group instead of trusting leader exit.
  if (Date.now() >= deadline) throw new Error('Installation process verification exceeded its cleanup deadline')
  const output = await execute('ps', ['-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], Math.max(1, deadline - Date.now()))
  const rows = output.split('\n').map(line => line.trim()).filter(Boolean)
  // A complete all-process listing contains at least ps itself. A malformed or
  // empty snapshot must never be interpreted as proof that writers have exited.
  if (rows.length === 0 || rows.some(line => !/^\d+\s+\d+\s+\S+$/.test(line))) {
    throw new Error(`Cannot verify installation process group ${pid}: invalid ps output`)
  }
  return rows.some(line => {
    const [, group, state] = line.split(/\s+/)
    return Number(group) === pid && !state.startsWith('Z') && !state.startsWith('X')
  })
}

async function signalGroup(pid, signal, deadline) {
  try { process.kill(-pid, signal) } catch (error) {
    if (error.code === 'ESRCH') return
    // The same Darwin zombie race affects TERM/KILL, not just signal 0. Only
    // forgive it after independent evidence that no group member can write.
    if (error.code === 'EPERM' && !await groupIsAlive(pid, deadline)) return
    throw error
  }
}

async function cleanTree({ directory, pid, root, childExited, killGraceMs, cleanupTimeoutMs }) {
  const deadline = Date.now() + cleanupTimeoutMs
  const failures = []
  const known = new Set(pid ? [pid] : [])
  const registered = new Map()
  // Close the launch gate before enumerating records. A newly scheduled wrapper
  // must register BEFORE checking this gate and cannot launch work after closure.
  try { writeFileSync(path.join(directory, root ? 'stopping' : `stopping-${pid}`), '') } catch (error) {
    failures.push(error.message)
  }
  const discover = () => {
    for (const record of records(directory)) if (root || belongsTo(record, pid)) {
      known.add(record.pid)
      registered.set(record.pid, record)
    }
  }
  try { discover() } catch (error) { failures.push(error.message) }
  if (process.platform === 'win32') {
    // Let job owners terminate their contained processes and record an actual
    // ActiveProcesses=0 result before stopping the wrappers with taskkill.
    const cooperativeDeadline = Math.min(deadline - 500, Date.now() + 3500)
    while (Date.now() < cooperativeDeadline) {
      try { discover() } catch (error) { failures.push(error.message); break }
      if ([...known].every(processId => windowsTreeStopped(directory, processId, registered))) break
      await delay(25)
    }
    for (const processId of [...known].reverse()) {
      if (Date.now() >= deadline) { failures.push('Installation tree cleanup exceeded its deadline'); break }
      try {
        await execute('taskkill', ['/PID', String(processId), '/T', '/F'], Math.max(1, deadline - Date.now()))
      } catch (error) {
        // A nested wrapper may already have been terminated by its outer tree.
        // Only a registration marked stopped by its own supervisor is proof.
        if (!windowsTreeStopped(directory, processId, registered)) failures.push(`taskkill ${processId}: ${error.message}`)
      }
    }
  } else {
    const signal = async name => {
      for (const processId of known) {
        try { await signalGroup(processId, name, deadline) } catch (error) {
          failures.push(`${name} process group ${processId}: ${error.message}`)
        }
      }
    }
    await signal('SIGTERM')
    const gracefulDeadline = Math.min(deadline, Date.now() + killGraceMs)
    while (Date.now() < gracefulDeadline) {
      let live = false
      try {
        discover()
        for (const processId of known) live ||= await groupIsAlive(processId, deadline)
      } catch (error) { failures.push(error.message); break }
      if (!live && childExited()) break
      await delay(Math.min(25, Math.max(1, gracefulDeadline - Date.now())))
    }
    await signal('SIGKILL')
  }
  let live = [...known]
  while (Date.now() < deadline) {
    try {
      discover()
      if (process.platform === 'win32') {
        // Ask the OS per PID (libuv opens the process and checks its exit code) instead of listing every
        // process with tasklist: on slow machines tasklist outlives the few seconds left of this budget,
        // is killed, and a finished install was then reported as unverifiable and locked.
        live = [...known].filter(windowsProcessAlive)
      } else {
        live = []
        for (const processId of known) {
          if (await groupIsAlive(processId, deadline)) {
            live.push(processId)
            // Registrations discovered after the first pass are also terminated.
            await signalGroup(processId, 'SIGKILL', deadline)
          }
        }
      }
    } catch (error) { failures.push(error.message); break }
    if (live.length === 0 && childExited()) break
    await delay(Math.min(25, Math.max(1, deadline - Date.now())))
  }
  if (process.platform === 'win32') {
    for (const processId of known) {
      if (existsSync(path.join(directory, `windows-job-${processId}.json`)) && !windowsTreeStopped(directory, processId, registered)) {
        failures.push(`Windows job ${processId} has no verified empty-job receipt`)
      }
    }
  }
  if (live.length > 0) failures.push(`Installation process groups still running or unverifiable: ${live.join(', ')}`)
  if (!childExited()) failures.push('Installation process wrapper has not exited')
  let safe = failures.length === 0 && live.length === 0 && childExited()
  if (safe) {
    try {
      for (const processId of known) {
        writeFileSync(path.join(directory, `stopped-${processId}`), '')
        removeTreeSync(path.join(directory, `${processId}.json`))
      }
    } catch (error) { safe = false; failures.push(error.message) }
  }
  return { safe, processGroups: [...known], remainingProcessGroups: live, cleanupErrors: failures }
}

/** Read-only, conservative recovery check; never kills a recorded PID. */
export async function verifyInstallationProcessesStopped(processDirectory, options = {}) {
  const deadline = Date.now() + positiveInteger(options.timeoutMs, 2000)
  try {
    if (!existsSync(path.join(processDirectory, 'stopping'))) return { safe: false, reason: 'launch-gate-open' }
    const owner = JSON.parse(readFileSync(path.join(processDirectory, 'supervisor.json'), 'utf8'))
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 1) return { safe: false, reason: 'invalid-supervisor' }
    try {
      process.kill(owner.pid, 0)
      return { safe: false, reason: 'supervisor-still-running', pid: owner.pid }
    } catch (error) { if (error.code !== 'ESRCH') return { safe: false, reason: 'supervisor-unverifiable' } }
    const registered = records(processDirectory)
    const stoppedGroups = readdirSync(processDirectory).filter(name => /^stopped-\d+$/.test(name))
    if (registered.length === 0 && stoppedGroups.length === 0) return { safe: false, reason: 'missing-process-records' }
    const processGroups = registered.map(record => record.pid)
    const registeredByPid = new Map(registered.map(record => [record.pid, record]))
    for (const processId of processGroups) {
      if (process.platform === 'win32') {
        // Windows PIDs do not identify an orphaned tree. Only a completed tree
        // cleanup receipt provides evidence stronger than a vanished parent.
        if (!windowsTreeStopped(processDirectory, processId, registeredByPid)) return { safe: false, reason: 'windows-tree-unverified', processGroups }
        try {
          process.kill(processId, 0)
          return { safe: false, reason: 'process-wrapper-running', processGroups }
        } catch (error) { if (error.code !== 'ESRCH') throw error }
      } else if (await groupIsAlive(processId, deadline)) return { safe: false, reason: 'process-group-running', processGroups }
    }
    return { safe: true, reason: 'process-trees-stopped', processGroups }
  } catch (error) { return { safe: false, reason: 'process-records-unverifiable', error: error.message } }
}

/**
 * Run one installation stage with a bounded lifetime and owned-tree cleanup.
 *
 * timeoutMs defaults to 30 minutes. signal cancels the whole owned subtree.
 * killGraceMs (default 250) precedes SIGKILL; cleanupTimeoutMs defaults to 5s.
 * stdio follows spawn() for stdin/stdout/stderr; piped output is returned as text.
 * onSpawn receives the wrapper ChildProcess (its PID is also the POSIX PGID).
 * processDirectory may put durable registrations under an operation lock.
 * Nested calls automatically inherit the registry and record their ancestry.
 * root:true explicitly starts fresh, ignoring inherited registry/ancestry markers.
 *
 * Rejections have code, status, signal, pid, processGroupId, processGroups,
 * processDirectory and unsafeToRetry. Never rollback/release an operation lock
 * on unsafeToRetry: the supervisor could not prove every owned writer stopped.
 */
export async function runInstallationProcess(command, args = [], options = {}) {
  const label = options.label || command
  const timeoutMs = positiveInteger(options.timeoutMs, 30 * 60 * 1000)
  const killGraceMs = positiveInteger(options.killGraceMs, 250)
  const cleanupTimeoutMs = positiveInteger(options.cleanupTimeoutMs, 5000)
  const makeError = (code, message, details = {}) => Object.assign(new Error(message), { code, unsafeToRetry: false, ...details })
  if (options.signal?.aborted) throw makeError('INSTALLATION_ABORTED', `${label} 已取消`, { cause: options.signal.reason })
  const environment = options.env || process.env
  const inheritedDirectory = options.root === true ? '' : (process.env[DIRECTORY_ENV] || environment[DIRECTORY_ENV])
  const root = !inheritedDirectory
  const directory = inheritedDirectory || options.processDirectory || mkdtempSync(path.join(os.tmpdir(), 'dsh-install-process-'))
  const removeDirectory = root && !options.processDirectory
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (root) writeFileSync(path.join(directory, 'supervisor.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 })
  const ancestors = root ? [] : JSON.parse(process.env[ANCESTORS_ENV] || environment[ANCESTORS_ENV] || '[]')
  if (stopped(directory, ancestors)) throw makeError('INSTALLATION_ABORTED', `${label} 已取消，安装进程正在停止`)
  let child
  let exited = false
  let timeout
  let abort
  let stdout = ''
  let stderr = ''
  let result
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, 1024 * 1024)
  const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-maxOutputBytes)
  try {
    result = await new Promise(resolve => {
      let settled = false
      const finish = value => { if (!settled) { settled = true; resolve(value) } }
      const stdio = options.stdio || ['ignore', 'pipe', 'pipe']
      const streams = Array.isArray(stdio) ? stdio.slice(0, 3) : [stdio, stdio, stdio]
      while (streams.length < 3) streams.push('pipe')
      try {
        child = spawn(process.execPath, [moduleFile, '--installation-process-child', JSON.stringify({ command, args, directory, ancestors, shell: options.shell || false })], {
          cwd: options.cwd, env: { ...environment, [DIRECTORY_ENV]: directory, [ANCESTORS_ENV]: JSON.stringify(ancestors) },
          detached: process.platform !== 'win32', windowsHide: options.windowsHide !== false, stdio: [...streams, 'ipc'],
        })
      } catch (error) { exited = true; finish({ error }); return }
      child.stdout?.on('data', chunk => {
        stdout = append(stdout, chunk)
        try { options.onStdout?.(chunk) } catch (error) { finish({ error }) }
      })
      child.stderr?.on('data', chunk => {
        stderr = append(stderr, chunk)
        try { options.onStderr?.(chunk) } catch (error) { finish({ error }) }
      })
      child.once('spawn', () => {
        try { options.onSpawn?.(child) } catch (error) { finish({ error }) }
      })
      child.once('error', error => { if (!child.pid) exited = true; finish({ error }) })
      child.once('exit', (status, signal) => {
        exited = true
        finish({ error: makeError('INSTALLATION_PROCESS_EXITED', `${label} 的监控进程意外退出`, { status, signal }) })
      })
      child.on('message', message => {
        if (message?.type === 'installation-result') finish(message)
      })
      timeout = setTimeout(() => finish({ error: makeError('INSTALLATION_TIMEOUT', `${label} 超时（${timeoutMs} 毫秒），已请求停止安装进程`, { timeoutMs }) }), timeoutMs)
      abort = () => finish({ error: makeError('INSTALLATION_ABORTED', `${label} 已取消`, { cause: options.signal?.reason }) })
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
    })
  } finally {
    clearTimeout(timeout)
    if (abort) options.signal?.removeEventListener('abort', abort)
  }
  const pid = child?.pid || null
  const cleanup = await cleanTree({ directory, pid, root, childExited: () => exited, killGraceMs, cleanupTimeoutMs })
  child?.stdout?.destroy()
  child?.stderr?.destroy()
  if (child?.connected) child.disconnect()
  child?.unref()
  const metadata = { status: result.status ?? result.error?.status ?? null, signal: result.signal ?? result.error?.signal ?? null, pid, processGroupId: process.platform === 'win32' ? null : pid, processDirectory: directory, ...cleanup, stdout, stderr }
  if (!cleanup.safe) {
    const diagnostics = [...new Set(cleanup.cleanupErrors)].join('; ')
    throw makeError('INSTALLATION_CLEANUP_FAILED', `${label} 的进程树未能确认停止，请勿重试或恢复配置${diagnostics ? ` (${diagnostics})` : ''}`, {
      ...metadata, unsafeToRetry: true, cause: result.error, originalCode: result.error?.code,
    })
  }
  if (removeDirectory) { try { removeTreeSync(directory) } catch {} }
  if (result.error) {
    const error = result.error instanceof Error ? result.error : makeError(result.error.code || 'INSTALLATION_SPAWN_FAILED', result.error.message)
    throw Object.assign(error, { unsafeToRetry: false }, metadata)
  }
  if (result.status !== 0) {
    throw makeError('INSTALLATION_PROCESS_FAILED', `${label} 执行失败（退出码 ${result.status ?? result.signal ?? 'unknown'}）`, { ...metadata, status: result.status, signal: result.signal })
  }
  return { ...metadata, code: result.status, status: result.status, signal: result.signal }
}

// A job owner keeps its non-inheritable job handle open until cleanup. Launching
// suspended is essential: no target code may run before it belongs to the job.
const windowsJobScript = String.raw`param([string] $ConfigFile)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
try {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TavernInstallationJob {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
    public uint cb; public string reserved, desktop, title;
    public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
    public ushort show, reservedSize; public IntPtr reservedPointer, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags; public UIntPtr minWorking, maxWorking;
    public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long user, kernel, periodUser, periodKernel;
    public uint faults, total, active, terminated;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char character in value) {
      if (character == '\\') { slashes++; continue; }
      text.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
      text.Append(character); slashes = 0;
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  static bool Stopping(string[] files) { foreach (string file in files) if (File.Exists(file)) return true; return false; }
  static void Publish(string file, string value) { File.WriteAllText(file + ".tmp", value); File.Move(file + ".tmp", file); }
  static void Hold() { while (true) Thread.Sleep(1000); }
  public static void Run(string command, string[] args, bool verbatimArguments, string result, string ready, string stopped, string[] stopFiles) {
    IntPtr job = IntPtr.Zero; ProcessInfo child = new ProcessInfo();
    try {
      if (Stopping(stopFiles)) { Publish(stopped, ""); Hold(); }
      job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
      var limits = new ExtendedLimits(); limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      var startup = new StartupInfo(); startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo)); startup.flags = 0x100;
      startup.input = GetStdHandle(-10); startup.output = GetStdHandle(-11); startup.error = GetStdHandle(-12);
      foreach (IntPtr handle in new IntPtr[] { startup.input, startup.output, startup.error }) {
        if (handle != IntPtr.Zero && handle != new IntPtr(-1)) Check(SetHandleInformation(handle, 1, 1));
      }
      var line = new StringBuilder(Quote(command)); foreach (string argument in args ?? new string[0]) line.Append(' ').Append(verbatimArguments ? argument : Quote(argument));
      Check(CreateProcess(null, line, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, null, ref startup, out child)); // NO_WINDOW | SUSPENDED
      if (!AssignProcessToJobObject(job, child.process)) {
        int failure = Marshal.GetLastWin32Error(); Check(TerminateProcess(child.process, 1));
        WaitForSingleObject(child.process, 3000); throw new Win32Exception(failure);
      }
      Publish(ready, "{\"holderPid\":" + Process.GetCurrentProcess().Id + ",\"childPid\":" + child.pid + "}");
      if (!Stopping(stopFiles)) Check(ResumeThread(child.thread) != 0xffffffff);
      bool reported = false;
      while (true) {
        if (Stopping(stopFiles)) {
          Check(TerminateJobObject(job, 1));
          // Release our process references before waiting for job accounting.
          if (child.thread != IntPtr.Zero) { CloseHandle(child.thread); child.thread = IntPtr.Zero; }
          if (child.process != IntPtr.Zero) { CloseHandle(child.process); child.process = IntPtr.Zero; }
          var watch = Stopwatch.StartNew();
          while (true) {
            Accounting accounting; Check(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
            if (accounting.active == 0) break;
            if (watch.ElapsedMilliseconds > 3000) throw new TimeoutException("Windows installation job did not stop");
            Thread.Sleep(20);
          }
          Publish(stopped, ""); Hold();
        }
        if (!reported && WaitForSingleObject(child.process, 25) == 0) {
          uint code; Check(GetExitCodeProcess(child.process, out code));
          Publish(result, "{\"status\":" + code + ",\"signal\":null}"); reported = true;
          CloseHandle(child.process); child.process = IntPtr.Zero;
          CloseHandle(child.thread); child.thread = IntPtr.Zero;
        }
        Thread.Sleep(20);
      }
    } finally {
      if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
      if (child.process != IntPtr.Zero) CloseHandle(child.process);
      if (job != IntPtr.Zero) CloseHandle(job);
    }
  }
}
'@
[TavernInstallationJob]::Run([string] $config.command, [string[]] $config.args, [bool] $config.verbatimArguments, [string] $config.result, [string] $config.ready, [string] $config.stopped, [string[]] $config.stopFiles)
} catch {
  if (-not (Test-Path -LiteralPath $config.result)) {
    $failure = $_.Exception.GetBaseException()
    $code = 'INSTALLATION_WINDOWS_JOB_FAILED'
    if ($failure -is [System.ComponentModel.Win32Exception] -and $failure.NativeErrorCode -in @(2, 3)) { $code = 'ENOENT' }
    @{ error = @{ code = $code; message = $failure.Message } } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config.result -Encoding UTF8
  }
  # The job handle is already closed (KILL_ON_JOB_CLOSE), so nothing it held is still
  # running. Acknowledge the supervisor's stop request, or cleanup can never confirm
  # this tree and the installation lock stays held (INSTALLATION_CLEANUP_FAILED).
  while ($true) {
    if (-not (Test-Path -LiteralPath $config.stopped) -and @($config.stopFiles | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) {
      Set-Content -LiteralPath $config.stopped -Value '' -Encoding UTF8
    }
    Start-Sleep -Milliseconds 100
  }
}
`

function windowsTreeStopped(directory, processId, registered) {
  if (existsSync(path.join(directory, `stopped-${processId}`))) return true
  const ancestors = registered.get(processId)?.ancestors || []
  return [processId, ...ancestors].some(id => existsSync(path.join(directory, `windows-stopped-${id}`)))
}

// Keep Windows shell syntax separate from argument data. These are the two
// escaping layers used by cross-spawn's MIT-licensed argument algorithm:
// https://github.com/moxystudio/node-cross-spawn/blob/master/lib/util/escape.js
// Implement the CRT quoting pass as a linear scan rather than regex backtracking.
function quoteWindowsArgument(value) {
  let quoted = '"'
  let backslashes = 0
  for (const character of String(value)) {
    if (character === '\\') { backslashes += 1; continue }
    quoted += '\\'.repeat(character === '"' ? backslashes * 2 + 1 : backslashes) + character
    backslashes = 0
  }
  return quoted + '\\'.repeat(backslashes * 2) + '"'
}

const cmdMetaCharacters = new Set('()[]%!^"`<>&|;, *?')
function escapeCmdSyntax(value) {
  return [...value].map(character => cmdMetaCharacters.has(character) ? `^${character}` : character).join('')
}

/** Build a data-only Windows invocation without permitting shell expressions. */
export function resolveWindowsInstallationInvocation(command, args = [], options = {}) {
  if (!options.shell || /\.(?:exe|com)$/i.test(command)) {
    return { command, args: [...args], verbatimArguments: false }
  }
  const shell = typeof options.shell === 'string' ? options.shell : (options.comspec || process.env.ComSpec || 'cmd.exe')
  if (!/(?:^|[\\/])cmd(?:\.exe)?$/i.test(shell)) {
    throw new Error('Installation commands only support cmd.exe shell mode on Windows')
  }
  if ([command, ...args].some(value => /[\0\r\n]/.test(String(value)))) {
    throw new Error('Windows shell installation arguments cannot contain NUL or line breaks')
  }
  // Batch launchers forward %* through an additional cmd parsing pass. Escape
  // that pass too, including global npm/pnpm shims outside node_modules/.bin.
  const batch = /\.(?:cmd|bat)$/i.test(command)
  const encodedCommand = escapeCmdSyntax(path.win32.normalize(command))
  const encodedArgs = args.map(argument => {
    const encoded = escapeCmdSyntax(quoteWindowsArgument(argument))
    return batch ? escapeCmdSyntax(encoded) : encoded
  })
  const line = [encodedCommand, ...encodedArgs].join(' ')
  return { command: shell, args: ['/d', '/s', '/v:off', '/c', `"${line}"`], verbatimArguments: true }
}

/**
 * CreateProcess only appends ".exe" when searching PATH; it never tries PATHEXT. On
 * Desktop "node" exists only as a node.cmd shim (Electron run as Node), so a bare
 * name that PowerShell resolved fine failed inside the job host with ENOENT. Resolve
 * bare names the way a shell would; a batch result is then run through cmd.exe.
 */
export function resolveWindowsCommand(command, env = process.env, execPath = process.execPath, exists = existsSync) {
  const name = String(command)
  if (/[\\/]/.test(name)) return name
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH')
  const pathextKey = Object.keys(env).find(key => key.toUpperCase() === 'PATHEXT')
  const extensions = path.extname(name) ? [''] : String((pathextKey && env[pathextKey]) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const directory of String((pathKey && env[pathKey]) || '').split(';').filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.win32.join(directory.replace(/^"|"$/g, ''), name + extension.toLowerCase())
      if (exists(candidate)) return candidate
    }
  }
  // This wrapper is itself running on the Node runtime the caller asked for.
  if (/^node(?:\.exe)?$/i.test(name)) return execPath
  return name
}

function startWindowsJob({ command: requested, args, directory, ancestors, shell: requestedShell }, pid, send) {
  const base = path.join(directory, `windows-${pid}`)
  const resultFile = `${base}-result.json`
  const scriptFile = `${base}.ps1`
  const configFile = `${base}-config.json`
  const command = resolveWindowsCommand(requested)
  const shell = requestedShell || /\.(?:cmd|bat)$/i.test(command)
  const invocation = resolveWindowsInstallationInvocation(command, args, { shell })
  writeFileSync(scriptFile, windowsJobScript, { mode: 0o600 })
  writeFileSync(configFile, JSON.stringify({ ...invocation, result: resultFile,
    ready: path.join(directory, `windows-job-${pid}.json`), stopped: path.join(directory, `windows-stopped-${pid}`),
    stopFiles: [path.join(directory, 'stopping'), ...[...ancestors, pid].map(id => path.join(directory, `stopping-${id}`))],
  }), { mode: 0o600 })
  const powerShell = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe'
  const target = spawn(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-ConfigFile', configFile], {
    env: { ...process.env, [ANCESTORS_ENV]: JSON.stringify([...ancestors, pid]) }, stdio: 'inherit', windowsHide: true,
  })
  let reported = false
  const readResult = () => {
    if (reported || !existsSync(resultFile)) return
    try { const result = JSON.parse(readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '')); reported = true; send(result) } catch {}
  }
  const poll = setInterval(readResult, 25)
  target.once('error', error => { clearInterval(poll); send({ error: { code: error.code, message: error.message } }) })
  target.once('exit', (status, signal) => {
    clearInterval(poll)
    readResult()
    if (!reported) send({ error: { code: 'INSTALLATION_WINDOWS_JOB_FAILED', message: `Windows job owner exited (${status ?? signal})` } })
  })
}

// The wrapper registers its own group before running any user command. It stays
// alive after command exit until the supervisor cleans the WHOLE tree, including
// orphaned grandchildren and separately grouped nested installation stages.
/**
 * Per-wrapper files are keyed by PID, and Windows reuses PIDs within seconds. A
 * finished step leaves `stopping-<pid>` behind (its supervisor closes the gate on
 * cleanup), so a later wrapper that drew the same PID saw itself as cancelled and
 * aborted at once ("安装进程正在停止"). Anything carrying this PID that predates this
 * process belonged to a dead predecessor; a supervisor's real cancellation for this
 * wrapper can only be written after it was spawned.
 */
export function clearStaleWrapperFiles(directory, pid, startedAt) {
  for (const name of [`stopping-${pid}`, `windows-stopped-${pid}`, `windows-job-${pid}.json`, `windows-${pid}-result.json`]) {
    const file = path.join(directory, name)
    try { if (statSync(file).mtimeMs < startedAt) unlinkSync(file) } catch {}
  }
}

function runChildWrapper(configuration) {
  const { command, args, directory, ancestors, shell } = configuration
  const pid = process.pid
  clearStaleWrapperFiles(directory, pid, Date.now() - process.uptime() * 1000 - 20)
  const registration = path.join(directory, `${pid}.json`)
  writeFileSync(`${registration}.tmp`, JSON.stringify({ pid, ancestors }), { flag: 'wx', mode: 0o600 })
  renameSync(`${registration}.tmp`, registration)
  const keepAlive = setInterval(() => {}, 60_000)
  const send = value => { if (process.connected) process.send({ type: 'installation-result', ...value }) }
  process.on('disconnect', () => {
    // An abruptly lost supervisor must not leave its command running. This is
    // best effort; durable registrations remain for recovery/diagnostics.
    clearInterval(keepAlive)
    try { writeFileSync(path.join(directory, ancestors.length === 0 ? 'stopping' : `stopping-${pid}`), '') } catch {}
    if (process.platform !== 'win32') {
      let owned = []
      try { owned = records(directory).filter(record => belongsTo(record, pid)) } catch {}
      for (const record of owned.filter(record => record.pid !== pid)) {
        try { process.kill(-record.pid, 'SIGKILL') } catch {}
      }
      try { process.kill(-pid, 'SIGKILL') } catch {}
    } else {
      // Give the native job owner a chance to record ActiveProcesses=0 so a
      // crashed supervisor can be recovered without guessing from dead PIDs.
      setTimeout(() => {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
      }, 3500)
    }
  })
  if (stopped(directory, [...ancestors, pid])) {
    send({ error: { code: 'INSTALLATION_ABORTED', message: '安装进程正在停止' } })
    return
  }
  if (process.platform === 'win32') { startWindowsJob(configuration, pid, send); return }
  let target
  try {
    target = spawn(command, args, {
      env: { ...process.env, [ANCESTORS_ENV]: JSON.stringify([...ancestors, pid]) },
      shell, stdio: 'inherit', windowsHide: true,
    })
  } catch (error) { send({ error: { code: error.code, message: error.message } }); return }
  target.once('error', error => send({ error: { code: error.code, message: error.message } }))
  target.once('exit', (status, signal) => send({ status, signal }))
}

async function runCommandLine(argv) {
  const [label, timeoutText, command, ...args] = argv
  const timeoutMs = Number(timeoutText)
  if (!label || !command || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Usage: installation-process.mjs --run <label> <timeoutMs> <command> [...args]')
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  let lease
  let cancellationPoll
  let processDirectory
  try {
    const lockDir = process.env.DSH_TAVERN_INSTALL_LOCK
    const attemptId = process.env.DSH_TAVERN_INSTALL_ATTEMPT
    if (lockDir || attemptId) {
      if (!lockDir || !attemptId) throw new Error('Installation lock and attempt must be supplied together')
      const state = (await import('./installation-state.cjs')).default
      const dshHome = path.dirname(lockDir)
      const owner = state.readInstallation(dshHome)
      if (!owner || owner.attemptId !== attemptId || path.resolve(owner.lockDir) !== path.resolve(lockDir)) {
        throw Object.assign(new Error('安装任务已失去所有权，已停止写入'), { code: 'INSTALLATION_OWNERSHIP_LOST' })
      }
      lease = state.acquireInstallation({ dshHome, attemptId })
      const checkCancellation = () => {
        try {
          lease.assertOwnership()
          if (state.cancellationRequested(dshHome, attemptId)) cancel()
        } catch { cancel() }
      }
      checkCancellation()
      cancellationPoll = setInterval(checkCancellation, 100)
      if (!process.env[DIRECTORY_ENV]) {
        const base = path.join(lockDir, 'processes')
        mkdirSync(base, { recursive: true, mode: 0o700 })
        processDirectory = mkdtempSync(path.join(base, 'stage-'))
      }
    }
    let pending
    const launch = () => {
      pending = runInstallationProcess(command, args, {
        // No stage may wait on the console: a prompt would hang behind piped output.
        label, timeoutMs, signal: controller.signal, processDirectory, stdio: ['ignore', 'inherit', 'inherit'],
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
      })
    }
    // Registration and launch begin synchronously while ownership is fenced.
    if (lease) lease.withOwnership(launch)
    else launch()
    await pending
  } catch (error) {
    if (error.unsafeToRetry && lease) {
      try { lease.retain(`${error.code}: ${error.message}`) } catch (retainError) {
        console.error(`INSTALLATION_LOCK_RETAIN_FAILED: ${retainError.message}`)
      }
    }
    throw error
  } finally {
    clearInterval(cancellationPoll)
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
  }
}

let isEntryPoint = false
try { isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(moduleFile) } catch {}

if (isEntryPoint && process.argv[2] === '--installation-process-child') {
  try { runChildWrapper(JSON.parse(process.argv[3])) } catch (error) {
    if (process.connected) process.send({ type: 'installation-result', error: { code: error.code, message: error.message } })
    process.exitCode = 1
  }
}

if (isEntryPoint && process.argv[2] === '--run') {
  try { await runCommandLine(process.argv.slice(3)) } catch (error) {
    console.error(`${error.code || 'INSTALLATION_ERROR'}: ${error.message}`)
    process.exitCode = 1
  }
}
