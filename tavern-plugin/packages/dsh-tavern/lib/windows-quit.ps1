param(
  [Parameter(Mandatory=$true)][int]$DesktopProcessId,
  [Parameter(Mandatory=$true)][string]$Executable
)
$ErrorActionPreference = 'Stop'
# Invoke the official tray's Quit action, preserving its task confirmation and
# shutdown handlers. Never close arbitrary windows or terminate a process.
$desktopProcess = Get-Process -Id $DesktopProcessId
if ([IO.Path]::GetFullPath($desktopProcess.Path) -ine [IO.Path]::GetFullPath($Executable)) {
  throw 'Desktop process identity changed'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TavernTrayQuit {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  public static bool Focus(IntPtr hwnd) {
    if (SetForegroundWindow(hwnd)) return true;
    uint owner;
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    uint current = GetCurrentThreadId();
    if (foreground == 0 || current == foreground || !AttachThreadInput(current, foreground, true)) return false;
    try { return SetForegroundWindow(hwnd); }
    finally { AttachThreadInput(current, foreground, false); }
  }
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hwnd, unused) => {
      uint owner; GetWindowThreadProcessId(hwnd, out owner);
      var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
      if (owner == pid && name.ToString() == "Electron_NotifyIconHostWindow") { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$trayWindow = [TavernTrayQuit]::Find($DesktopProcessId)
if ($trayWindow -eq [IntPtr]::Zero) { throw 'Official desktop tray is unavailable' }
# A background Electron tray refuses to open its menu without foreground ownership.
if (-not [TavernTrayQuit]::Focus($trayWindow)) { throw 'Could not focus the official desktop tray' }
# Electron notify_icon_host.cc: WM_APP+1, first icon id 3 (base 2 + counter 1), WM_CONTEXTMENU.
# https://github.com/electron/electron/blob/main/shell/browser/ui/win/notify_icon_host.cc
if (-not [TavernTrayQuit]::PostMessage($trayWindow, 0x8001, [IntPtr]3, [IntPtr]0x007B)) {
  throw 'Could not open the official desktop tray menu'
}
$ownerCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $DesktopProcessId)
$menuCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::MenuItem)
$condition = New-Object Windows.Automation.AndCondition($ownerCondition, $menuCondition)
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $items = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
  foreach ($item in $items) {
    # Source: official desktop's DesktopTray.relabel(), Chinese and English locales.
    if ($item.Current.Name -notmatch '^(?:\u9000\u51fa|Quit) DeepSeek Harness$') { continue }
    if (-not $item.Current.IsEnabled) { throw 'Official desktop Quit action is disabled' }
    $invoke = $item.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Official desktop Quit menu was not accessible; use the tray to quit manually'
