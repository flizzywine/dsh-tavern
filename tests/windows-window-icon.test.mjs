import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import pngjs from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/vendor/pngjs/lib/png.js'
import { startWindowsWindowIcon } from '../bin/windows-window-icon.mjs'

const execute = promisify(execFile)

test('窗口图标辅助进程静默启动，非 Windows 不启动', () => {
  const calls = []
  const launch = (...args) => { calls.push(args); return 123 }
  startWindowsWindowIcon('browser.exe', { platform: 'darwin', launch })
  assert.equal(calls.length, 0)
  assert.equal(startWindowsWindowIcon('C:\\Program Files\\Browser\\browser.exe', { platform: 'win32', launch, logFile: 'D:\\logs\\icon.log' }), 123)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'powershell.exe')
  assert.deepEqual(calls[0][1].slice(-4), ['-Browser', 'C:\\Program Files\\Browser\\browser.exe', '-LogFile', 'D:\\logs\\icon.log'])
})

test('Windows 实际窗口按 DPI 使用 ICO 原生像素，并排除其他窗口', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-window-icon-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const helper = fileURLToPath(new URL('../bin/windows-window-icon.ps1', import.meta.url))
  const icoPath = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern/assets/dsh-tavern-app.ico', import.meta.url))
  const quote = value => "'" + value.replace(/'/g, "''") + "'"
  const script = `
$ErrorActionPreference = 'Stop'
. ${quote(helper)} -DefineOnly
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Location = New-Object Drawing.Point(-32000, -32000)
$form.Text = 'Unrelated window'
try {
  $form.Show()
  [Windows.Forms.Application]::DoEvents()
  $browser = (Get-Process -Id $PID).Path
  if ([TavernWindowIcons]::Find($browser).Contains($form.Handle)) { throw 'Unrelated window matched' }
  $form.Text = 'DSH Tavern'
  if (![TavernWindowIcons]::Find($browser).Contains($form.Handle)) { throw 'Tavern window not found' }
  if ([TavernWindowIcons]::Find('C:\\unrelated.exe').Contains($form.Handle)) { throw 'Other process matched' }
  [TavernWindowIcons]::Apply($form.Handle, ${quote(icoPath)})
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReadWindowIcon {
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
  foreach ($kind in @(0,1)) {
    $handle = [ReadWindowIcon]::SendMessage($form.Handle, 127, [IntPtr]$kind, [IntPtr]::Zero)
    $bitmap = [Drawing.Icon]::FromHandle($handle).ToBitmap()
    $bitmap.Save((Join-Path ${quote(root)} ("icon-" + $kind + ".png")))
    $bitmap.Dispose()
  }
} finally {
  $form.Close()
  $form.Dispose()
  [TavernWindowIcons]::Dispose()
}
`
  const fixture = path.join(root, 'fixture.ps1')
  await writeFile(fixture, script, 'utf8')
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixture], { windowsHide: true, timeout: 20000 })
  const ico = await readFile(icoPath)
  for (const kind of [0, 1]) {
    const actual = pngjs.PNG.sync.read(await readFile(path.join(root, `icon-${kind}.png`)))
    let expected
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const entry = 6 + i * 16
      if ((ico[entry] || 256) !== actual.width) continue
      const offset = ico.readUInt32LE(entry + 12)
      expected = pngjs.PNG.sync.read(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)))
    }
    assert.ok(expected, `必须提供 ${actual.width}px 原生帧`)
    let compared = 0
    for (let i = 0; i < actual.data.length; i += 4) {
      if (expected.data[i + 3] !== 255) continue
      assert.deepEqual(actual.data.subarray(i, i + 4), expected.data.subarray(i, i + 4), '实际窗口像素必须等于 ICO 原生像素，不能从 favicon 放大')
      compared++
    }
    assert.ok(compared > actual.width * actual.height / 2)
  }
})
