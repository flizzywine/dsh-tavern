import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Failure falls back to manual tray quit. A cancelled native task confirmation
// is never overridden; the switch worker still waits for the app to exit.
export async function requestDesktopQuit({ pid, executable, platform = process.platform }, { run = execFile, kill = process.kill, defer = setTimeout, onError = () => {} } = {}) {
  if (!Number.isInteger(pid) || pid <= 1 || !executable) return false
  if (platform !== 'win32') {
    defer(() => { try { kill(pid, 'SIGTERM') } catch {} }, 500)
    return true
  }
  return new Promise(resolve => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./windows-quit.ps1', import.meta.url)), '-DesktopProcessId', String(pid), '-Executable', executable],
    { windowsHide: true, timeout: 10000, encoding: 'utf8' }, error => {
      if (error) onError(error)
      resolve(!error)
    })
  })
}
