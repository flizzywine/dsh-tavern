// 「DSH 酒馆」桌面快捷方式：点开即运行 `dsh-tavern window`，用桌面版自带的运行环境另起一个
// 进程加载酒馆配置，在独立窗口打开。首装自动创建一次，也可手动恢复；已有快捷方式只刷新自带图标。
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from './state.mjs'

export const SHORTCUT_NAME = 'DSH 酒馆'
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

// Keep this receipt outside the desktop so deleting the shortcut is respected on updates.
export function ensureInitialTavernShortcut(options, create = createTavernShortcut) {
  const marker = join(options.paths.home, 'profile-bridge', 'shortcut-initialized.json')
  if (existsSync(marker)) {
    if ((options.platform || process.platform) === 'win32') {
      const { path } = JSON.parse(readFileSync(marker, 'utf8'))
      if (typeof path === 'string' && existsSync(path)) refreshWindowsShortcutIcon(options.paths.home, path)
    }
    return { skipped: true }
  }
  mkdirSync(dirname(marker), { recursive: true })
  const result = create(options)
  writeFileSync(marker, JSON.stringify({ path: result.path, createdAt: new Date().toISOString() }) + '\n')
  return result
}

/** The tavern launcher script, found through the tavern profile's own plugin link. */
export function tavernScript(profilesDir) {
  let plugin
  try { plugin = realpathSync(join(profilesDir, 'tavern', 'node_modules', 'dsh-tavern-plugin')) } catch { fail('no-tavern', '还没有装好 DSH 酒馆，装好后再添加快捷方式。') }
  const script = join(dirname(plugin), 'bin', 'dsh-tavern.mjs')
  if (!existsSync(script)) fail('no-tavern', '找不到 DSH 酒馆的启动脚本，请重新安装酒馆后再试。')
  return script
}

const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'"

export function macLauncherScript({ runner, script, logFile }) {
  return `#!/bin/sh
# DSH 酒馆：用桌面版自带的运行环境启动酒馆，并在独立窗口打开。
LOG=${shellQuote(logFile)}
mkdir -p "$(dirname "$LOG")"
OUT=$(ELECTRON_RUN_AS_NODE=1 ${shellQuote(runner)} --expose-internals ${shellQuote(script)} window --host desktop 2>&1)
STATUS=$?
printf '%s\\n' "$OUT" >> "$LOG"
if [ $STATUS -ne 0 ]; then
  MESSAGE=$(printf '%s' "$OUT" | tail -n 1 | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
  osascript -e "display alert \\"DSH 酒馆没有打开\\" message \\"$MESSAGE\\""
fi
exit $STATUS
`
}

function macInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${SHORTCUT_NAME}</string>
  <key>CFBundleDisplayName</key><string>${SHORTCUT_NAME}</string>
  <key>CFBundleIdentifier</key><string>io.github.flizzywine.dsh-tavern.window</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>tavern</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`
}

// 512px PNG → .icns，用系统自带的 sips 与 iconutil；做不出来就不带图标。
function macIcon(png, target) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-tavern-icon-'))
  try {
    const set = join(work, 'tavern.iconset')
    mkdirSync(set)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const pixels = size * scale
        if (pixels > 512) continue
        if (spawnSync('sips', ['-z', String(pixels), String(pixels), png, '--out', join(set, `icon_${size}x${size}${suffix}.png`)], { stdio: 'ignore' }).status !== 0) return
      }
    }
    spawnSync('iconutil', ['-c', 'icns', set, '-o', target], { stdio: 'ignore' })
  } finally { rmSync(work, { recursive: true, force: true }) }
}

function createMac({ desktop, runner, script, logFile }) {
  const bundle = join(desktop, SHORTCUT_NAME + '.app')
  if (existsSync(bundle)) return { path: bundle, existed: true }
  const staged = join(desktop, `.${SHORTCUT_NAME}.creating-${process.pid}.app`)
  rmSync(staged, { recursive: true, force: true })
  try {
    mkdirSync(join(staged, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(staged, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(join(staged, 'Contents', 'Info.plist'), macInfoPlist())
    const launcher = join(staged, 'Contents', 'MacOS', 'launcher')
    writeFileSync(launcher, macLauncherScript({ runner, script, logFile }))
    chmodSync(launcher, 0o755)
    macIcon(join(ASSETS, 'dsh-tavern-app-icon-512.png'), join(staged, 'Contents', 'Resources', 'tavern.icns'))
    renameSync(staged, bundle)
  } catch (error) { rmSync(staged, { recursive: true, force: true }); throw error }
  return { path: bundle, existed: false }
}

const vbsQuote = value => '"' + String(value).replace(/"/g, '""') + '"'

// WScript 静默运行（不闪黑框）；失败时弹窗显示日志最后一行。
export function windowsLauncherScript({ runner, script, logFile }) {
  const command = `cmd /d /s /c ""${runner}" --expose-internals "${script}" window --host desktop >> "${logFile}" 2>&1"`
  return [
    "' DSH 酒馆：用桌面版自带的运行环境启动酒馆，并在独立窗口打开。",
    'Set shell = CreateObject("WScript.Shell")',
    'shell.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"',
    'code = shell.Run(' + vbsQuote(command) + ', 0, True)',
    'If code <> 0 Then',
    '  message = "详情见 " & ' + vbsQuote(logFile),
    '  Set files = CreateObject("Scripting.FileSystemObject")',
    '  If files.FileExists(' + vbsQuote(logFile) + ') Then',
    '    Set stream = CreateObject("ADODB.Stream")',
    '    stream.Type = 2 : stream.Charset = "utf-8" : stream.Open',
    '    stream.LoadFromFile ' + vbsQuote(logFile),
    '    lines = Split(stream.ReadText, vbLf)',
    '    stream.Close',
    '    For i = UBound(lines) To 0 Step -1',
    '      If Trim(Replace(lines(i), vbCr, "")) <> "" Then message = Replace(lines(i), vbCr, "") : Exit For',
    '    Next',
    '  End If',
    '  MsgBox message, 48, "DSH 酒馆没有打开"',
    'End If',
    '',
  ].join('\r\n')
}

// ICO 可直接内嵌 PNG（Vista 起支持），不用转位图。
export function icoFromPng(png) {
  const frames = Array.isArray(png) ? png : [png]
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  for (const [i, frame] of frames.entries()) {
    const width = frame.readUInt32BE(16), height = frame.readUInt32BE(20)
    if (width < 1 || height < 1 || width > 256 || height > 256) throw new Error('ICO frames must be between 1 and 256 pixels')
    const entry = 6 + i * 16
    header.writeUInt8(width === 256 ? 0 : width, entry); header.writeUInt8(height === 256 ? 0 : height, entry + 1)
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  }
  return Buffer.concat([header, ...frames])
}

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim()
}

const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'"

function windowsIcon(home) {
  const image = readFileSync(join(ASSETS, 'dsh-tavern-app.ico'))
  // A new filename prevents Explorer from reusing its cached single-frame icon.
  const revision = createHash('sha256').update(image).digest('hex').slice(0, 12)
  const target = join(home, 'tools', 'dsh-tavern-window', `tavern-${revision}.ico`)
  mkdirSync(dirname(target), { recursive: true })
  if (!existsSync(target)) writeFileSync(target, image)
  return target
}

function refreshWindowsShortcutIcon(home, link) {
  const tools = join(home, 'tools', 'dsh-tavern-window')
  const ico = windowsIcon(home)
  // Preserve user-customized icons and never recreate a deleted shortcut.
  powershell([
    'if (Test-Path -LiteralPath ' + psQuote(link) + ') {',
    '$shell = New-Object -ComObject WScript.Shell',
    '$link = $shell.CreateShortcut(' + psQuote(link) + ')',
    '$old = ($link.IconLocation -replace ",\\s*-?\\d+$", "")',
    'if ((Split-Path -Parent $old) -eq ' + psQuote(tools) + ' -and (Split-Path -Leaf $old) -match "^tavern(?:-[0-9a-f]{12})?\\.ico$" -and $old -ne ' + psQuote(ico) + ') {',
    '$link.IconLocation = ' + psQuote(ico + ',0'),
    '$link.Save()',
    '}',
    '}',
  ].join('\n'))
}

function createWindows({ home, runner, script, logFile }) {
  const desktop = powershell("[Environment]::GetFolderPath('Desktop')")
  const link = join(desktop, SHORTCUT_NAME + '.lnk')
  if (existsSync(link)) {
    refreshWindowsShortcutIcon(home, link)
    return { path: link, existed: true }
  }
  const tools = join(home, 'tools', 'dsh-tavern-window')
  mkdirSync(tools, { recursive: true })
  const vbs = join(tools, 'launch.vbs')
  const ico = windowsIcon(home)
  // UTF-16LE 带 BOM：路径里有中文用户名也能读对。
  writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsLauncherScript({ runner, script, logFile }), 'utf16le')]))
  powershell([
    '$shell = New-Object -ComObject WScript.Shell',
    '$link = $shell.CreateShortcut(' + psQuote(link) + ')',
    "$link.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'",
    '$link.Arguments = ' + psQuote('"' + vbs + '"'),
    '$link.WorkingDirectory = ' + psQuote(tools),
    '$link.IconLocation = ' + psQuote(ico + ',0'),
    "$link.Description = '打开 DSH 酒馆（独立窗口）'",
    '$link.Save()',
  ].join('\n'))
  return { path: link, existed: false }
}

/** Creates the desktop shortcut once, on the user's request. */
export function createTavernShortcut({ paths, platform = process.platform, runner = process.execPath, home = homedir() }) {
  const script = tavernScript(paths.profilesDir)
  const logFile = join(paths.home, 'logs', 'tavern-window.log')
  if (platform === 'darwin') return createMac({ desktop: join(home, 'Desktop'), runner, script, logFile })
  if (platform === 'win32') return createWindows({ home: paths.home, runner, script, logFile })
  fail('unsupported', '桌面快捷方式目前只支持 macOS 和 Windows。')
}

