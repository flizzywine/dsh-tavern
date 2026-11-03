import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { launchWindowsUpdater } from './windows-update-launch.mjs'
import { DSH_ROOT } from './launcher-environment.mjs'

// --app windows expose the browser's small tab favicon as their Windows icon.
// Set the native icon from our multi-resolution ICO, at the window's actual DPI.
export function startWindowsWindowIcon(browser, { platform = process.platform, launch = launchWindowsUpdater, logFile = path.join(DSH_ROOT, 'logs', 'tavern-window-icon.log') } = {}) {
  if (platform !== 'win32') return
  const helper = fileURLToPath(new URL('./windows-window-icon.ps1', import.meta.url))
  const icon = fileURLToPath(new URL('../tavern-plugin/packages/dsh-profile-bridge/assets/dsh-tavern-app.ico', import.meta.url))
  // Spawn through the existing WMI broker: detached children still inherit the
  // launcher's kill-on-close Job and can die before they have scanned a window.
  try {
    return launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Icon', icon, '-Browser', browser, '-LogFile', logFile])
  } catch (error) {
    console.warn('未能启动窗口图标辅助进程：' + error.message)
  }
}
