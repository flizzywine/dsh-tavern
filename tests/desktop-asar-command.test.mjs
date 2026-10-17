import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { desktopElectronExecutable, desktopShimExecutable } from '../bin/desktop-host-paths.mjs'
import { resolveDesktopAsarCommand } from '../bin/plugin-dependencies.mjs'

// 0.2.0-rc.2 适配：桌面 0.2.0 的 dsh.cmd 是「Electron + app.asar 内 CLI」的 shim。
// 这类 shim 上方没有 @deepseek-ai/dsh npm 包，且 asar 内文件纯 Node 读不了，
// 启动必须换成 Electron 可执行文件 + ELECTRON_RUN_AS_NODE=1。
const ASAR_CLI = 'C:\\Program Files\\Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js'

async function shimFixture(t, { body }) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-asar-shim-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const executable = path.join(root, 'DeepSeek Harness.exe')
  await writeFile(executable, '')
  const shim = path.join(bin, 'dsh.cmd')
  await writeFile(shim, body(executable))
  return { shim, executable }
}

test('0.2.0 桌面 asar shim 解析为 Electron 可执行文件 + asar CLI 的启动形态', async t => {
  const { shim, executable } = await shimFixture(t, { body: exe => `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${exe}" --expose-internals "${ASAR_CLI}" %*\r\nexit /b %errorlevel%\r\n` })
  const resolved = resolveDesktopAsarCommand({ dsh: shim, platform: 'win32' })
  assert.ok(resolved, '应识别为 asar 形态')
  assert.equal(await realpath(resolved.command), await realpath(executable))
  assert.equal(resolved.entry, path.resolve(ASAR_CLI))
  assert.deepEqual(resolved.env, { ELECTRON_RUN_AS_NODE: '1' })
  assert.deepEqual(['--expose-internals', resolved.entry, '--profile', 'tavern'], ['--expose-internals', path.resolve(ASAR_CLI), '--profile', 'tavern'])
})

test('shim 指向真实 Node 入口时保持原行为（返回 null，交给 resolveDshCliEntry）', async t => {
  const { shim } = await shimFixture(t, { body: () => '@echo off\r\nnode "C:\\real\\dsh\\lib\\bin.js" %*\r\n' })
  assert.equal(resolveDesktopAsarCommand({ dsh: shim, platform: 'win32' }), null)
})

test('非 win32 不启用该分支（host=cli 等既有路径不受影响）', async t => {
  const { shim } = await shimFixture(t, { body: exe => `"${exe}" --expose-internals "${ASAR_CLI}" %*\r\n` })
  assert.equal(resolveDesktopAsarCommand({ dsh: shim, platform: 'linux' }), null)
  assert.equal(resolveDesktopAsarCommand({ dsh: shim, platform: 'darwin' }), null)
})

test('引号形态没被解析但 shim 确实指向 asar 时，退回 Electron 派生路径', async t => {
  const { shim, executable } = await shimFixture(t, {
    body: exe => `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n%DSH_EXE% --expose-internals %DSH_CLI%\r\nrem ${exe}\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js\r\n`,
  })
  const resolved = resolveDesktopAsarCommand({ dsh: shim, platform: 'win32', env: { ...process.env, DSH_DESKTOP_NODE_EXECUTABLE: executable } })
  assert.ok(resolved, '应退回派生路径')
  assert.equal(await realpath(resolved.command), await realpath(executable))
  assert.match(resolved.entry, /resources[\\/]app\.asar[\\/]dsh[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]cli\.js$/)
  assert.deepEqual(resolved.env, { ELECTRON_RUN_AS_NODE: '1' })
})

test('既不指向 asar 也没有 Electron 可执行文件时返回 null（不猜路径）', async t => {
  const { shim } = await shimFixture(t, { body: () => '@echo off\r\nnode "C:\\real\\cli.js" %*\r\n' })
  assert.equal(resolveDesktopAsarCommand({ dsh: shim, platform: 'win32', env: { PATH: '' }, execPath: 'C:\\missing\\node.exe' }), null)
})

// 本机 0.2.0 桌面的 dsh.cmd 就是这种写法：路径全用 %~dp0（= shim 自身目录）相对表达，
// 必须先展开 %~dp0 才能同时拿到 Electron 可执行文件与 asar 入口。
test('真实 dsh.cmd 的 %~dp0 相对形态可解析（无需任何环境变量）', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-asar-dp0-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'a', 'b', 'c', 'bin')
  await mkdir(bin, { recursive: true })
  const executable = path.join(root, 'DeepSeek Harness.exe')
  await writeFile(executable, '')
  const shim = path.join(bin, 'dsh.cmd')
  await writeFile(shim, '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\r\nexit /b %errorlevel%\r\n'.replaceAll('\\', path.sep))
  const resolved = resolveDesktopAsarCommand({ dsh: shim, platform: 'win32', env: { PATH: '' }, execPath: 'C:\\missing\\node.exe' })
  assert.ok(resolved, '应展开 %~dp0 后解析出 Electron 与 asar 入口')
  assert.equal(await realpath(resolved.command), await realpath(executable))
  assert.match(resolved.entry, /app\.asar[\\/]dsh[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]cli\.js$/)
  assert.ok(path.isAbsolute(resolved.entry), resolved.entry)
  assert.deepEqual(resolved.env, { ELECTRON_RUN_AS_NODE: '1' })
})

// 脱离态更新（系统 Node 拉起、没有任何 DSH_DESKTOP_* 变量）曾经算出 <node>\resources\app 这种假根，
// 报「当前 DSH 缺少必需依赖 @deepseek-ai/dsh-agent（查找位置：C:\Program Files\nodejs\resources\app）」。
// 兜底靠 dsh shim 指认 Desktop 安装：这是那时唯一还存在的线索。
test('脱离态系统 Node：execPath 是 node.exe 时用 dsh shim 兜底定位 Electron 可执行文件', async t => {
  const { shim, executable } = await shimFixture(t, { body: exe => `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${exe}" --expose-internals "${ASAR_CLI}" %*\r\n` })
  assert.equal(desktopShimExecutable(shim, 'win32'), executable)
  assert.equal(desktopElectronExecutable({ env: {}, execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32', commandFile: shim }), executable)
  // 不提供 shim 时保持既有行为：系统 Node 的 execPath 绝不被当成 Desktop 可执行文件。
  assert.equal(desktopElectronExecutable({ env: {}, execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32' }), null)
})

test('%~dp0 相对形态的 shim 也能兜底（不依赖任何环境变量）', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-asar-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'a', 'b', 'bin')
  await mkdir(bin, { recursive: true })
  const executable = path.join(root, 'DeepSeek Harness.exe')
  await writeFile(executable, '')
  const shim = path.join(bin, 'dsh.cmd')
  await writeFile(shim, '@echo off\r\n"%~dp0..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\r\n'.replaceAll('\\', path.sep))
  assert.equal(desktopElectronExecutable({ env: {}, execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32', commandFile: shim }), executable)
})

test('shim 不存在、指向 node.exe 或不含可执行文件时不猜路径', async t => {
  const { shim } = await shimFixture(t, { body: () => '@echo off\r\nnode "C:\\real\\dsh\\lib\\bin.js" %*\r\n' })
  assert.equal(desktopShimExecutable(path.join(path.dirname(shim), 'missing.cmd'), 'win32'), null)
  assert.equal(desktopShimExecutable(shim, 'win32'), null)
  assert.equal(desktopShimExecutable(null, 'win32'), null)
})
