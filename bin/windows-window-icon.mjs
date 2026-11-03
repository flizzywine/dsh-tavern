import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// --app windows expose the browser's small tab favicon as their Windows icon.
// Set the native icon from our multi-resolution ICO, at the window's actual DPI.
export function startWindowsWindowIcon(browser, { platform = process.platform, launch = spawn } = {}) {
  if (platform !== 'win32') return
  const helper = fileURLToPath(new URL('./windows-window-icon.ps1', import.meta.url))
  const icon = fileURLToPath(new URL('../tavern-plugin/packages/dsh-profile-bridge/assets/dsh-tavern-app.ico', import.meta.url))
  const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Icon', icon, '-Browser', browser],
    { detached: true, stdio: 'ignore', windowsHide: true })
  // Opening the application still works if the optional icon helper cannot start.
  child.on('error', () => {})
  child.unref()
}
