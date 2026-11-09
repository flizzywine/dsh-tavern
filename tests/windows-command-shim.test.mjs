import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { resolveDshCliEntry, resolveNpmCliEntry } from '../bin/plugin-dependencies.mjs'
import { renderWindowsLauncher } from '../bin/profile-installation.mjs'

test('command shim bootstrap preserves argv and cwd when loading a Unicode installation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-shim-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, '赵 的游戏')
  const commandDir = path.join(root, '自定义命令目录')
  await mkdir(source); await mkdir(commandDir)
  const script = path.join(source, 'cli.mjs')
  await writeFile(script, 'console.log(JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd()}))')
  const shim = renderWindowsLauncher(script)
  const bootstrap = shim.match(/node -e "([^"]+)" -- %\*/)?.[1]
  assert.ok(bootstrap, 'shim must run the ASCII bootstrap with a Node option terminator')
  const args = ['--help', '中文参数 with spaces']
  const result = spawnSync(process.execPath, ['-e', bootstrap, '--', ...args], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.argv, [script, ...args])
  assert.equal(await realpath(output.cwd), await realpath(root))
  if (process.platform === 'win32') {
    const command = path.join(commandDir, 'dsh-tavern.cmd')
    await writeFile(command, shim)
    const actual = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${command}" --help "two words""`], { cwd: root, encoding: 'utf8', windowsVerbatimArguments: true })
    assert.equal(actual.status, 0, actual.stderr)
    const actualOutput = JSON.parse(actual.stdout)
    assert.deepEqual(actualOutput.argv, [script, '--help', 'two words'])
    assert.equal(await realpath(actualOutput.cwd), await realpath(root))
  }
})

test('status while stopped prints a useful error and exits 1', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-stopped-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = path.join(root, 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{}')
  await writeFile(path.join(profile, 'cordis.patch.yml'), '')
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/dsh-tavern.mjs', import.meta.url)), 'status'], {
    env: { ...process.env, DSH_HOME: root, DSH_TAVERN_CLI_HOME: root, DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_PORT: String(port) }, encoding: 'utf8'
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /DSH Tavern 未运行/)
  assert.doesNotMatch(result.stderr, /ReferenceError|fail is not defined/)
})

test('Windows service resolves the selected installation CLI from its bin declaration', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prefix = path.join(root, '赵 的游戏')
  const pkg = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(pkg, { recursive: true })
  const shim = path.join(prefix, 'dsh.cmd')
  await writeFile(shim, '@echo off\r\n')
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: './custom-cli.cjs' } }))
  const entry = path.join(pkg, 'custom-cli.cjs')
  await writeFile(entry, 'console.log("cli stdout"); console.error("cli stderr")')
  const resolved = resolveDshCliEntry({ dsh: shim, platform: 'win32' })
  assert.equal(await realpath(resolved), await realpath(entry))
  const actual = spawnSync(process.execPath, [resolved], { encoding: 'utf8', shell: false })
  assert.equal(actual.status, 0, actual.stderr)
  assert.match(actual.stdout, /cli stdout/)
  assert.match(actual.stderr, /cli stderr/)
})

test('Windows npm entry preserves private prefixes with spaces and shell characters', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-npm-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prefix = path.join(root, '赵 的 npm & tools')
  const pkg = path.join(prefix, 'node_modules', 'npm')
  await mkdir(pkg, { recursive: true })
  await writeFile(path.join(prefix, 'npm.cmd'), '@echo off\r\n')
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'npm', bin: { npm: './entry.cjs' } }))
  await writeFile(path.join(pkg, 'entry.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))')
  const resolved = resolveNpmCliEntry({ env: { PATH: prefix }, platform: 'win32' })
  const args = ['install', '--prefix', path.join(root, '游戏 & runtime')]
  const actual = spawnSync(process.execPath, [resolved, ...args], { encoding: 'utf8', shell: false })
  assert.equal(actual.status, 0, actual.stderr)
  assert.deepEqual(JSON.parse(actual.stdout), args)
})

test('npm entry follows a pnpm env shim whose package is outside its node_modules ancestry', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-pnpm-env-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pnpmHome = path.join(root, 'pnpm home')
  const pkg = path.join(pnpmHome, 'nodejs', '24.12.0', 'node_modules', 'npm')
  await mkdir(path.join(pkg, 'bin'), { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'npm', bin: { npm: './bin/npm-cli.js' } }))
  await writeFile(path.join(pkg, 'bin', 'npm-cli.js'), '')
  await writeFile(path.join(pnpmHome, 'npm.cmd'), '@SETLOCAL\r\n@SET "_prog=%~dp0\\node.exe"\r\n"%_prog%"  "%~dp0\\nodejs\\24.12.0\\node_modules\\npm\\bin\\npm-cli.js" %*\r\n')
  const resolved = resolveNpmCliEntry({ env: { PATH: pnpmHome }, platform: 'win32' })
  assert.equal(await realpath(resolved), await realpath(path.join(pkg, 'bin', 'npm-cli.js')))
})
