import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { selectTestRuntime, probeTestRuntime } from '../bin/test-runtime.mjs'

test('an explicitly selected desktop wins over stale CLI and fails closed if removed', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'test-desktop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'DeepSeek Harness.exe')
  await writeFile(executable, '')
  await mkdir(path.join(root, 'resources/app'), { recursive: true })
  await writeFile(path.join(root, 'resources/app/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop' }))
  const options = { env: {}, platform: 'win32', installation: { testDesktopExecutable: executable }, cliBoot: () => assert.fail('must not use CLI') }
  const runtime = selectTestRuntime(options)
  assert.equal(runtime.command, executable)
  assert.equal(runtime.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(runtime.anchor, path.join(root, 'resources/app/dsh/package.json'))
  await rm(executable)
  assert.throws(() => selectTestRuntime(options), /不存在/)
})

test('explicit standalone override remains available; incompatible hosts are rejected before tests', () => {
  const runtime = selectTestRuntime({ env: { DSH_BOOT_MODULE: '/fixture/boot.js' }, discover: () => assert.fail('explicit override'), execPath: process.execPath })
  assert.equal(runtime.command, process.execPath)
  const run = version => () => ({ status: 0, stdout: JSON.stringify({ boot: runtime.boot, version, nodeVersion: '24.21.0' }) })
  assert.throws(() => probeTestRuntime(runtime, run('0.1.1-rc.2')), /0\.1\.1/)
  assert.equal(probeTestRuntime(runtime, run('0.2.1-rc.5')).version, '0.2.1-rc.5')
  assert.throws(() => probeTestRuntime(runtime, () => ({ status: 1, stderr: 'broken installation' })), /broken installation/)
})

test('selected DSH dependency routing reaches native imports and nested fixture processes', () => {
  assert.ok(process.env.DSH_BOOT_MODULE, 'run through bin/test-tavern.mjs')
  const host = createRequire(process.env.DSH_BOOT_MODULE)
  const local = createRequire(import.meta.url)
  assert.equal(local.resolve('@deepseek-ai/dsh-session'), host.resolve('@deepseek-ai/dsh-session'))
  const result = spawnSync(process.execPath, ['-e', 'console.log(require.resolve("@deepseek-ai/dsh-session"))'], {
    env: process.env, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), host.resolve('@deepseek-ai/dsh-session'))
})


test('test runner validates the selected runtime Node, independently of the parent Node', () => {
  const runtime = { command: '/selected/desktop', args: [], env: {}, boot: '/fixture/boot.js' }
  const run = nodeVersion => (command, args) => {
    assert.equal(command, runtime.command)
    assert.match(args.at(-1), /nodeVersion:process.versions.node/)
    return { status: 0, stdout: JSON.stringify({ boot: runtime.boot, version: '0.2.2-rc.1', nodeVersion }) }
  }
  assert.equal(probeTestRuntime(runtime, run('24.21.0')).version, '0.2.2-rc.1')
  assert.throws(() => probeTestRuntime(runtime, run('22.22.2')), /需要 Node.js 24\.9\.0/)
  assert.throws(() => probeTestRuntime(runtime, run(undefined)), /当前宿主 Node.js 未知/)
})
