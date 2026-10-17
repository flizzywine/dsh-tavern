import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { patchThemeFontLimit } from '../bin/theme-font-limit.mjs'
import { adaptedDshVersion } from '../bin/dsh-compatibility.mjs'
import { SESSION_PATCH_VERSION } from '../tavern-plugin/lib/domain/host-session-patch.js'
import { installHostSubprocessPatch } from '../tavern-plugin/lib/domain/host-subprocess-patch.js'

const native = { skip: !process.env.DSH_BOOT_MODULE }
test('目标宿主与会话补丁版本保持一致', () => {
  assert.equal(SESSION_PATCH_VERSION, adaptedDshVersion)
})

test('目标宿主字号补丁只扩大正文字号，重复安装幂等且漂移不写入', native, async t => {
  const require = createRequire(process.env.DSH_BOOT_MODULE)
  const source = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-theme/package.json'))
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-theme-native-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await cp(source, directory, { recursive: true })
  assert.equal(patchThemeFontLimit(directory), true)
  assert.equal(patchThemeFontLimit(directory), false)
  for (const name of ['index.js', 'client.js']) {
    const code = await readFile(path.join(directory, 'lib', name), 'utf8')
    assert.match(code, /variable: "--dsh-content-font-size",\s+min: 10,\s+max: 32,/)
    assert.match(code, /variable: "--dsh-code-font-size",\s+min: 10,\s+max: 16,/)
    assert.match(code, /variable: "--dsh-terminal-font-size",\s+min: 10,\s+max: 20,/)
  }
  await cp(source, directory, { recursive: true })
  const client = path.join(directory, 'lib/client.js')
  const host = path.join(directory, 'lib/index.js')
  const originalHost = await readFile(host, 'utf8')
  const drifted = (await readFile(client, 'utf8')).replace('max: 22,', 'max: 23,')
  await writeFile(client, drifted)
  assert.throws(() => patchThemeFontLimit(directory), /字号补丁不匹配/)
  assert.equal(await readFile(host, 'utf8'), originalHost)
  assert.equal(await readFile(client, 'utf8'), drifted)
})

test('目标宿主 Windows 子进程补丁可安装、共享并恢复，宿主文件不变', native, async () => {
  const require = createRequire(process.env.DSH_BOOT_MODULE)
  const { pathToFileURL } = await import('node:url')
  const entry = require.resolve('@deepseek-ai/dsh-subprocess-local')
  const { default: Local } = await import(pathToFileURL(entry).href)
  const before = await readFile(entry, 'utf8')
  const original = Local.prototype.spawn
  const restore = await installHostSubprocessPatch({ hostRequire: require, platform: 'win32' })
  try {
    assert.notEqual(Local.prototype.spawn, original)
    const second = await installHostSubprocessPatch({ hostRequire: require, platform: 'win32' })
    second()
    assert.notEqual(Local.prototype.spawn, original)
    assert.equal(await readFile(entry, 'utf8'), before)
  } finally { restore() }
  assert.equal(Local.prototype.spawn, original)
})
