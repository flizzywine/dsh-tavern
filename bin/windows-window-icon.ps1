param([string]$Icon, [string]$Browser, [string]$LogFile, [switch]$DefineOnly)
$ErrorActionPreference = 'Stop'
function Write-IconLog([string]$Message) {
    if ($LogFile) { [IO.File]::AppendAllText($LogFile, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine)) }
}
trap { Write-IconLog ('error: ' + $_.Exception.Message); exit 1 }
if (!$DefineOnly) { Write-IconLog ('started pid=' + $PID) }
Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class TavernWindowIcons {
    delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int metric, uint dpi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance, string file, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr kind, IntPtr value, uint flags, uint timeout, out IntPtr result);
    static readonly Dictionary<string, IntPtr> icons = new Dictionary<string, IntPtr>();

    public static List<IntPtr> Find(string browser) {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr state) {
            if (!IsWindowVisible(window)) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            string name = title.ToString();
            if (name != "DSH Tavern" && !name.EndsWith(" \u2014 DSH Tavern", StringComparison.Ordinal)) return true;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            try {
                using (var process = Process.GetProcessById((int)pid)) {
                    if (String.Equals(process.MainModule.FileName, browser, StringComparison.OrdinalIgnoreCase)) windows.Add(window);
                }
            } catch (System.ComponentModel.Win32Exception) {} catch (InvalidOperationException) {} catch (ArgumentException) {}
            return true;
        }, IntPtr.Zero);
        return windows;
    }

    public static void Apply(IntPtr window, string file) {
        uint dpi = GetDpiForWindow(window);
        if (dpi == 0) return;
        long revision = File.GetLastWriteTimeUtc(file).Ticks;
        foreach (int kind in new int[] { 0, 1 }) {
            int size = GetSystemMetricsForDpi(kind == 0 ? 49 : 11, dpi);
            string key = file + ":" + revision + ":" + size;
            IntPtr icon;
            if (!icons.TryGetValue(key, out icon)) {
                icon = LoadImage(IntPtr.Zero, file, 1, size, size, 0x10);
                if (icon == IntPtr.Zero) throw new InvalidOperationException("Cannot load window icon: " + file);
                icons.Add(key, icon);
            }
            IntPtr current;
            if (SendMessageTimeout(window, 0x7f, (IntPtr)kind, IntPtr.Zero, 2, 250, out current) == IntPtr.Zero) continue;
            if (current != icon) SendMessageTimeout(window, 0x80, (IntPtr)kind, icon, 2, 250, out current);
        }
    }

    public static void Dispose() {
        foreach (var icon in icons.Values) DestroyIcon(icon);
        icons.Clear();
    }
}
'@
if ($DefineOnly) { return }

# Keep native icon handles alive for the window's lifetime. Chromium can replace
# WM_SETICON on navigation, so reapply only when its handle has actually changed.
$taskHasher = [Security.Cryptography.SHA256]::Create()
$taskIdentity = [BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Browser + '|' + $Icon))).Replace('-', '')
$taskHasher.Dispose()
$taskMutex = New-Object Threading.Mutex($false, ('Local\DSHTavernIcons-' + $taskIdentity))
if (!$taskMutex.WaitOne(0)) { $taskMutex.Dispose(); return }
try {
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $taskPreviousCount = -1
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        $taskWindows = [TavernWindowIcons]::Find($Browser)
        foreach ($taskWindow in $taskWindows) { [TavernWindowIcons]::Apply($taskWindow, $Icon) }
        if ($taskWindows.Count -ne $taskPreviousCount) {
            Write-IconLog ('matched windows=' + $taskWindows.Count)
            $taskPreviousCount = $taskWindows.Count
        }
        if ($taskWindows.Count -gt 0) { $taskDeadline = [DateTime]::UtcNow.AddSeconds(5) }
        Start-Sleep -Milliseconds 1000
    }
} finally {
    [TavernWindowIcons]::Dispose()
    $taskMutex.ReleaseMutex()
    $taskMutex.Dispose()
    Write-IconLog 'stopped'
}
