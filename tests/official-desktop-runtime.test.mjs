import test from 'node:test'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import runtime from '../bin/official-desktop-runtime.cjs'

const clean = dir => { const prev = process.noAsar; process.noAsar = true; return rm(dir, {recursive: true, force: true}).finally(() => { process.noAsar = prev }) }
test('Windows 官方 shim 不将中文路径写进批处理，并拒绝未知宿主', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-desktop-中文 '))
  t.after(() => clean(root))
  const executable = path.join(root, 'DeepSeek Harness.exe')
  const {app, host, pnpm} = runtime.layout(executable, 'win32')
  // layout initially selects ASAR; use the unpacked build layout for this fixture.
  const unpacked = app.replace(/app\.asar$/, 'app')
  await mkdir(unpacked, {recursive: true})
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: '@deepseek-ai/dsh-desktop'}))
  const paths = runtime.layout(executable, 'win32')
  const cli = path.join(paths.host, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
  await mkdir(path.dirname(cli), {recursive: true}); await writeFile(cli, '')
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  const home = path.join(root, '旧存档')
  const env = runtime.prepare({executable, home, platform: 'win32', env: {Path: 'original'}})
  assert.ok(env.Path.endsWith(';original'))
  assert.equal(env.DSH_HOME, home)
  assert.equal(env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR, path.join(paths.host, 'package.json'))
  for (const name of ['node', 'pnpm', 'dsh']) {
    const shim = await readFile(path.join(home, 'tools/official-desktop/bin', name + '.cmd'), 'utf8')
    assert.match(shim, /^[\x00-\x7f]+$/)
    assert.match(shim, /DisableDelayedExpansion/)
  }
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: 'dsh-desktop'}))
  assert.throws(() => runtime.prepare({executable, home, platform: 'win32'}), /仅支持官方 DeepSeek Harness/)
})

test('本机官方 Electron 可从中文目录运行 DSH 和 pnpm', async t => {
  let executable
  try { executable = runtime.discover() } catch { t.skip('未安装官方 Desktop'); return }
  const home = await mkdtemp(path.join(tmpdir(), 'official-中文 '))
  t.after(() => rm(home, {recursive: true, force: true}))
  const setup = spawnSync(executable, ['--expose-internals', path.resolve('bin/official-desktop-runtime.cjs'), home],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8'})
  assert.equal(setup.status, 0, setup.stderr)
  const env = {...process.env, ...JSON.parse(setup.stdout), ELECTRON_RUN_AS_NODE: '1'}
  for (const [entry, expected] of [[env.DSH_DESKTOP_DSH_BOOTSTRAP, /^0\.2\./], [env.DSH_DESKTOP_PNPM_ENTRY, '11.28.5']]) {
    const result = spawnSync(executable, ['--expose-internals', entry, '--version'], {env, encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    if (expected instanceof RegExp) assert.match(result.stdout.trim(), expected)
    else assert.equal(result.stdout.trim(), expected)
  }
})

function asar(files) {
  const tree = {files: {}}, bodies = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text)
    let node = tree
    const parts = name.split('/')
    for (const part of parts.slice(0, -1)) node = node.files[part] ??= {files: {}}
    node.files[parts.at(-1)] = {size: body.length, offset: String(offset)}
    offset += body.length; bodies.push(body)
  }
  const json = Buffer.from(JSON.stringify(tree))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4)])
  const header = Buffer.alloc(8); header.writeUInt32LE(4 + padded.length, 0); header.writeUInt32LE(json.length, 4)
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(4, 0); sizes.writeUInt32LE(header.length + padded.length, 4)
  return Buffer.concat([sizes, header, padded, ...bodies])
}

for (const name of ['dsh-plugin-desktop', 'dsh-desktop-next']) {
  for (const packed of [false, true]) test(`拒绝社区宿主 ${name} (${packed ? 'asar' : 'unpacked'})，不写入用户目录`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'unsupported-desktop-'))
    t.after(() => clean(root))
    const executable = path.join(root, 'DeepSeek Harness.exe') // Renaming cannot bypass the package check.
    const resources = path.join(root, 'resources'), home = path.join(root, 'home')
    await mkdir(resources, {recursive: true})
    if (packed) await writeFile(path.join(resources, 'app.asar'), asar({'package.json': JSON.stringify({name})}))
    else {
      await mkdir(path.join(resources, 'app'))
      await writeFile(path.join(resources, 'app/package.json'), JSON.stringify({name}))
    }
    assert.throws(() => runtime.prepare({executable, home, platform: 'win32'}), /仅支持官方 DeepSeek Harness/)
    assert.equal(existsSync(home), false)
  })
}

test('自动发现只搜索官方桌面，社区应用不会作为后备宿主', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-discovery-'))
  t.after(() => clean(root))
  for (const app of ['DSH NEXT', 'DSH Desktop']) {
    await mkdir(path.join(root, app))
    await writeFile(path.join(root, app, app + '.exe'), '')
  }
  assert.deepEqual(runtime.APP_NAMES, ['DeepSeek Harness'])
  assert.throws(() => runtime.discover({ProgramFiles: root}, 'win32'), /找不到官方 DeepSeek Harness/)
  const executable = path.join(root, 'DeepSeek Harness/DeepSeek Harness.exe')
  await mkdir(path.dirname(executable)); await writeFile(executable, '')
  assert.equal(runtime.discover({ProgramFiles: root}, 'win32'), executable)
})

test('官方 asar 包可用纯 Node 识别并生成运行环境', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-asar-'))
  t.after(() => clean(root))
  const executable = path.join(root, 'DeepSeek Harness.exe'), resources = path.join(root, 'resources')
  await mkdir(resources)
  await writeFile(path.join(resources, 'app.asar'), asar({
    'package.json': JSON.stringify({name: '@deepseek-ai/dsh-desktop'}),
    'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js': '',
  }))
  const pnpm = runtime.layout(executable, 'win32').pnpm
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  const env = runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32', env: {Path: ''}})
  for (const key of ['DSH_DESKTOP_NODE_EXECUTABLE', 'DSH_DESKTOP_DSH_RUNNER', 'DSH_DESKTOP_PNPM_RUNNER']) assert.equal(env[key], executable)
  await writeFile(path.join(resources, 'app.asar'), 'invalid')
  assert.throws(() => runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32'}), /读到的应用包名：无法读取/)
})
