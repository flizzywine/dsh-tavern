// 「DSH 酒馆」桌面快捷方式与独立窗口：只在用户要求时创建，不覆盖；桌面版正是酒馆时不另起一份。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTavernShortcut, macLauncherScript, windowsLauncherScript } from '../tavern-plugin/packages/dsh-tavern/lib/shortcut.mjs'
import { appWindowBrowser, desktopUsesTavern } from '../bin/tavern-window.mjs'

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-shortcut-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await mkdir(path.join(source, 'bin'), { recursive: true })
  await mkdir(path.join(source, 'tavern-plugin'), { recursive: true })
  await writeFile(path.join(source, 'bin', 'dsh-tavern.mjs'), '')
  const dsh = path.join(root, '.dsh')
  await mkdir(path.join(dsh, 'profiles', 'tavern', 'node_modules'), { recursive: true })
  await mkdir(path.join(root, 'Desktop'))
  const paths = { home: dsh, profilesDir: path.join(dsh, 'profiles') }
  return { root, source, dsh, paths }
}

test('macOS：桌面生成 DSH 酒馆.app，指向本机酒馆脚本；已存在不覆盖；没装酒馆就说明', async t => {
  const { root, source, paths } = await setup(t)
  assert.throws(() => createTavernShortcut({ paths, platform: 'darwin', runner: '/App/Electron', home: root }), /还没有装好 DSH 酒馆/)
  await symlink(path.join(source, 'tavern-plugin'), path.join(paths.profilesDir, 'tavern', 'node_modules', 'dsh-tavern-plugin'), 'junction')
  const created = createTavernShortcut({ paths, platform: 'darwin', runner: '/App/Electron', home: root })
  assert.equal(created.existed, false)
  assert.equal(created.path, path.join(root, 'Desktop', 'DSH 酒馆.app'))
  const launcher = await readFile(path.join(created.path, 'Contents', 'MacOS', 'launcher'), 'utf8')
  assert.match(launcher, /ELECTRON_RUN_AS_NODE=1 '\/App\/Electron' --expose-internals '.*dsh-tavern\.mjs' window --host desktop/)
  if (process.platform !== 'win32') assert.ok((await stat(path.join(created.path, 'Contents', 'MacOS', 'launcher'))).mode & 0o100, '可执行')
  assert.match(await readFile(path.join(created.path, 'Contents', 'Info.plist'), 'utf8'), /<string>launcher<\/string>/)
  assert.equal(createTavernShortcut({ paths, platform: 'darwin', runner: '/App/Electron', home: root }).existed, true)
})

test('启动脚本：路径里的引号与中文都安全', () => {
  assert.match(macLauncherScript({ runner: "/A'pp/E", script: '/s.mjs', logFile: '/l.log' }), /'\/A'\\''pp\/E'/)
  const vbs = windowsLauncherScript({ runner: 'C:\\P\\DeepSeek Harness.exe', script: 'C:\\Users\\张\\bin\\dsh-tavern.mjs', logFile: 'C:\\Users\\张\\w.log' })
  assert.match(vbs, /shell\.Run\("cmd \/d \/s \/c """"C:\\P\\DeepSeek Harness\.exe"" --expose-internals ""C:\\Users\\张\\bin\\dsh-tavern\.mjs"" window --host desktop >> ""C:\\Users\\张\\w\.log"" 2>&1""", 0, True\)/)
  assert.match(vbs, /Charset = "utf-8"/)
})

test('独立窗口：桌面版链接到酒馆时不另起一份；按平台挑应用窗口浏览器', async t => {
  const { dsh } = await setup(t)
  await mkdir(path.join(dsh, 'profiles', 'desktop'))
  assert.equal(desktopUsesTavern(dsh), false)
  await rm(path.join(dsh, 'profiles', 'desktop'), { recursive: true })
  await symlink(path.join(dsh, 'profiles', 'tavern'), path.join(dsh, 'profiles', 'desktop'), 'junction')
  assert.equal(desktopUsesTavern(dsh), true)

  const mac = appWindowBrowser('darwin', {}, file => file === path.join('/Applications', 'Microsoft Edge.app'), '/Users/me')
  assert.deepEqual(mac.args('http://x/'), ['-na', path.join('/Applications', 'Microsoft Edge.app'), '--args', '--app=http://x/'])
  const windows = appWindowBrowser('win32', { PROGRAMFILES: 'C:\\PF' }, file => file === path.join('C:\\PF', 'Google\\Chrome\\Application\\chrome.exe'))
  assert.deepEqual(windows.args('http://x/'), ['--app=http://x/'])
  assert.equal(appWindowBrowser('darwin', {}, () => false, '/Users/me'), null)
})
