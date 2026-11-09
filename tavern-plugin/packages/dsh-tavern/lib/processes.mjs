import { execFile } from 'node:child_process'

// An executable name, command line or cwd is NOT evidence of ownership. Capture
// ancestry while Desktop is alive, before the detached switch helper is spawned.
// FILETIME strings preserve all 64 bits (JavaScript numbers cannot).
const native = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BridgeProcesses {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Entry {
    public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parent;
    public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
  }
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo {
    public IntPtr exitStatus, peb, affinity, priority, pid, parentPid;
  }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, out BasicInfo info, uint size, out uint returned);
  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint low, high; }
  public class Record { public int pid; public int parentPid; public string created; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out FileTime created, out FileTime exit, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Created(IntPtr handle) {
    FileTime c, e, k, u;
    if (!GetProcessTimes(handle, out c, out e, out k, out u)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return (((ulong)c.high << 32) | c.low).ToString();
  }
  public static Record[] Snapshot() {
    var rows = new List<Record>();
    IntPtr h = CreateToolhelp32Snapshot(2, 0);
    if (h == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      Entry e = new Entry(); e.size = (uint)Marshal.SizeOf(typeof(Entry));
      if (!Process32FirstW(h, ref e)) throw new Win32Exception(Marshal.GetLastWin32Error());
      do {
        // Toolhelp supplies candidates only. Read parent + creation from ONE
        // handle, never combine a stale snapshot parent with a recycled PID.
        IntPtr process = OpenProcess(0x0400, false, (int)e.pid);
        if (process == IntPtr.Zero) continue;
        try {
          BasicInfo info; uint returned;
          if (NtQueryInformationProcess(process, 0, out info, (uint)Marshal.SizeOf(typeof(BasicInfo)), out returned) != 0) continue;
          rows.Add(new Record { pid=(int)e.pid, parentPid=(int)info.parentPid.ToInt64(), created=Created(process) });
        } catch (Win32Exception) { }
        finally { CloseHandle(process); }
      } while (Process32NextW(h, ref e));
      if (Marshal.GetLastWin32Error() != 18) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { CloseHandle(h); }
    return rows.ToArray();
  }
  public static bool WaitExit(int pid, string expected, uint timeout) {
    IntPtr h = OpenProcess(0x101000, false, pid);
    if (h == IntPtr.Zero) {
      int code = Marshal.GetLastWin32Error();
      if (code == 87) return true;
      throw new Win32Exception(code);
    }
    try { return Created(h) != expected || WaitForSingleObject(h, timeout) == 0; }
    finally { CloseHandle(h); }
  }
  public static string Stop(int pid, string expected, uint timeout) {
    // Verify AND terminate through one handle: the PID may be reused between calls.
    IntPtr h = OpenProcess(0x101001, false, pid);
    if (h == IntPtr.Zero) {
      int code = Marshal.GetLastWin32Error();
      if (code == 87) return "exited";
      throw new Win32Exception(code);
    }
    try {
      if (Created(h) != expected) return "reused-pid-skipped";
      if (WaitForSingleObject(h, 0) == 0) return "exited";
      if (!TerminateProcess(h, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (WaitForSingleObject(h, timeout) != 0) throw new Exception("Process exit timed out: " + pid);
      return "terminated";
    } finally { CloseHandle(h); }
  }
}`

async function powershell(body, { run = execFile, timeout = 30000 } = {}) {
  const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false\nAdd-Type -TypeDefinition @'\n${native}\n'@\n${body}`
  return new Promise((resolve, reject) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) return reject(new Error(`Windows 进程身份检查失败：${String(stderr || error.message).trim()}`))
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/u, '').trim())) } catch (cause) { reject(new Error('Windows 进程身份检查返回无效结果', { cause })) }
      })
  })
}
const valid = row => Number.isInteger(row?.pid) && row.pid > 1 && typeof row.created === 'string' && /^[1-9]\d*$/u.test(row.created)

/** Pure selection: missing identities and stale parent PIDs never confer ownership. */
export function selectOwnedProcesses(rows, pids, excluded = []) {
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const roots = [...new Set(pids)].map(pid => byPid.get(pid))
  if (!roots.length || roots.some(row => !valid(row))) throw new Error('无法确认桌面进程身份，未安排切换；请重试')
  const protectedPids = new Set(excluded)
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (protectedPids.has(row.parentPid) && !protectedPids.has(row.pid)) { protectedPids.add(row.pid); changed = true }
  }
  const owned = new Map(roots.map(row => [row.pid, row]))
  const descendants = []
  changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      const parent = owned.get(row.parentPid)
      if (!valid(row) || !parent || protectedPids.has(row.pid) || owned.has(row.pid)) continue
      // Parent PID in a snapshot can already belong to a newer process.
      if (BigInt(row.created) < BigInt(parent.created)) continue
      owned.set(row.pid, row); descendants.push(row); changed = true
    }
  }
  return { roots, descendants }
}

export async function captureOwnedProcesses(pids, { platform = process.platform, inspect = powershell } = {}) {
  if (platform !== 'win32') return undefined
  const snapshot = await inspect('[pscustomobject]@{ inspectorPid=$PID; rows=@([BridgeProcesses]::Snapshot()) } | ConvertTo-Json -Depth 5 -Compress')
  const ownership = selectOwnedProcesses(snapshot.rows, pids, [snapshot.inspectorPid])
  const [host, desktop] = ownership.roots
  // process.ppid itself is only a PID. The captured Desktop must predate its
  // Host, otherwise an exited Desktop's recycled PID could own unrelated work.
  if (pids.length !== 2 || ownership.roots.length !== 2 || host.parentPid !== desktop.pid
      || BigInt(host.created) < BigInt(desktop.created)) throw new Error('无法确认桌面与 Host 的父子进程身份，未安排切换；请重试')
  return ownership
}

/** Called only after normal Desktop quit, and only when a rename is blocked. */
export async function cleanupOwnedProcesses(ownership, { platform = process.platform, inspect = powershell, log = () => {}, selfPid = process.pid } = {}) {
  if (platform !== 'win32' || !ownership) return []
  if (!Array.isArray(ownership.roots) || !ownership.roots.length || !ownership.roots.every(valid)
      || !Array.isArray(ownership.descendants) || !ownership.descendants.every(valid)) throw new Error('无效的桌面进程身份记录；未结束任何进程')
  const payload = Buffer.from(JSON.stringify({ ...ownership, selfPid }), 'utf8').toString('base64')
  const result = await inspect(`
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
foreach ($root in $data.roots) {
  if (-not [BridgeProcesses]::WaitExit([int]$root.pid, [string]$root.created, 0)) { throw 'Desktop is still running; refusing descendant cleanup' }
}
# Protect the worker and this inspector, including descendants, even if a corrupt
# or old request accidentally listed them. Never infer NEW owned descendants here.
$rows = @([BridgeProcesses]::Snapshot())
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$protected.Add([int]$data.selfPid); [void]$protected.Add($PID)
do {
  $changed = $false
  foreach ($row in $rows) { if ($protected.Contains($row.parentPid) -and $protected.Add($row.pid)) { $changed = $true } }
} while ($changed)
$results = @()
$failure = $null
$watch = [Diagnostics.Stopwatch]::StartNew()
# Leaf-first minimizes orphan churn. The captured list is parent-first.
$items = @($data.descendants); [array]::Reverse($items)
try { foreach ($item in $items) {
  if ($protected.Contains([int]$item.pid) -or @($data.roots.pid) -contains $item.pid) { continue }
  $remaining = [Math]::Max(0, 15000 - $watch.ElapsedMilliseconds)
  if ($remaining -eq 0) { throw 'Descendant cleanup timed out' }
  $status = [BridgeProcesses]::Stop([int]$item.pid, [string]$item.created, [uint32][Math]::Min(5000, $remaining))
  $results += [pscustomobject]@{ pid=$item.pid; status=$status }
} } catch { $failure = $_.Exception.Message }
[pscustomobject]@{ results=@($results); error=$failure } | ConvertTo-Json -Depth 5 -Compress`)
  for (const row of result.results) log(`桌面遗留子进程 PID ${row.pid}: ${row.status}`)
  if (result.error) throw new Error(`桌面遗留子进程清理失败：${result.error}`)
  return result.results
}

/** Wait on original process handles, not bare PIDs which can be recycled. */
export async function waitForOwnedExit(ownership, { timeout = 120000, inspect = powershell } = {}) {
  if (!Array.isArray(ownership?.roots) || !ownership.roots.length || !ownership.roots.every(valid)) throw new Error('无效的桌面进程身份记录')
  const payload = Buffer.from(JSON.stringify(ownership.roots), 'utf8').toString('base64')
  const result = await inspect(`
$roots = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$watch = [Diagnostics.Stopwatch]::StartNew()
foreach ($root in $roots) {
  $remaining = [Math]::Max(0, ${Math.max(0, Math.floor(timeout))} - $watch.ElapsedMilliseconds)
  if (-not [BridgeProcesses]::WaitExit([int]$root.pid, [string]$root.created, [uint32]$remaining)) { throw '等待桌面退出超时，未修改 profile；请正常退出后重试' }
}
' true '
`, { timeout: timeout + 30000 })
  if (result !== true) throw new Error('无法确认桌面进程已退出')
}
