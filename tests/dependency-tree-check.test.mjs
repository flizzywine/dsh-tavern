import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDependencyTree, readImporterDependencies, resolvedVersion } from '../bin/dependency-tree-check.mjs'

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@scope/plain':
        specifier: 1.2.3
        version: 1.2.3
      peered:
        specifier: ^2.0.0
        version: 2.1.0(react@19.2.0)
      aliased:
        specifier: npm:real@3.0.0
        version: real@3.0.0
      linked:
        specifier: link:./local
        version: link:local
    devDependencies:
      devdep:
        specifier: 4.0.0
        version: 4.0.0
    optionalDependencies:
      onlinuxonly:
        specifier: 5.0.0
        version: 5.0.0
`

async function fixture(t, lockfile = LOCKFILE) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-deps-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(root, { recursive: true })
  if (lockfile !== null) await writeFile(path.join(root, 'pnpm-lock.yaml'), lockfile)
  return root
}

async function install(root, name, version) {
  const directory = path.join(root, 'node_modules', name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version }))
}

test('只读 importers 段，忽略 packages/snapshots 里的同名条目', () => {
  const importers = readImporterDependencies(`${LOCKFILE}
packages:

  devdep@4.0.0:
    resolution: {integrity: sha512-x}
`)
  assert.deepEqual([...importers.keys()], ['.'])
  assert.equal(importers.get('.')?.get('devdep')?.version, '4.0.0')
})

test('peer 后缀与 npm 别名都还原成可比较的版本号', () => {
  assert.equal(resolvedVersion('2.1.0(react@19.2.0)'), '2.1.0')
  assert.equal(resolvedVersion('real@3.0.0'), '3.0.0')
  assert.equal(resolvedVersion('link:local'), '')
  assert.equal(resolvedVersion(''), '')
})

test('依赖齐全（含 peer 后缀、别名、link、可选包缺失）时判定为完整', async (t) => {
  const root = await fixture(t)
  await install(root, '@scope/plain', '1.2.3')
  await install(root, 'peered', '2.1.0')
  await install(root, 'aliased', '3.0.0')
  await mkdir(path.join(root, 'local'), { recursive: true })
  await install(root, 'devdep', '4.0.0')
  const result = checkDependencyTree(root)
  assert.equal(result.complete, true, result.reason)
  assert.equal(result.checked, 6)
})

test('少一个包就不算完整，并点名缺哪个', async (t) => {
  const root = await fixture(t)
  await install(root, '@scope/plain', '1.2.3')
  await install(root, 'peered', '2.1.0')
  await install(root, 'aliased', '3.0.0')
  const result = checkDependencyTree(root)
  assert.equal(result.complete, false)
  // link: 依赖由源码目录自己提供，不计入缺包判断。
  assert.match(result.reason, /缺少 1 个包/)
  assert.ok(result.missing.includes('devdep'))
})

test('版本与 lockfile 不符时不算完整（防止只删不换的半装状态）', async (t) => {
  const root = await fixture(t)
  await install(root, '@scope/plain', '1.2.3')
  await install(root, 'peered', '2.1.0')
  await install(root, 'aliased', '3.0.0')
  await install(root, 'devdep', '9.9.9')
  const result = checkDependencyTree(root)
  assert.equal(result.complete, false)
  assert.match(result.reason, /版本不符/)
  assert.match(result.reason, /devdep/)
})

test('optionalDependencies 缺失不影响判定；缺 lockfile 直接判不完整', async (t) => {
  const root = await fixture(t)
  await install(root, '@scope/plain', '1.2.3')
  await install(root, 'peered', '2.1.0')
  await install(root, 'aliased', '3.0.0')
  await install(root, 'devdep', '4.0.0')
  assert.equal(checkDependencyTree(root).complete, true)

  const empty = await fixture(t, null)
  const missingLock = checkDependencyTree(empty)
  assert.equal(missingLock.complete, false)
  assert.match(missingLock.reason, /pnpm-lock\.yaml/)
})

test('命令行入口用退出码表达结论', async (t) => {
  const root = await fixture(t)
  await install(root, '@scope/plain', '1.2.3')
  await install(root, 'peered', '2.1.0')
  await install(root, 'aliased', '3.0.0')
  await install(root, 'devdep', '4.0.0')
  const script = fileURLToPath(new URL('../bin/dependency-tree-check.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /核对通过/)

  await install(root, 'devdep', '9.9.9')
  const bad = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /版本不符/)
})

test('安卓安装器在 .pnpm/lock.yaml 缺失时改用这项核对而不是整批重装', async () => {
  const script = await readFile(new URL('../android/install.sh', import.meta.url), 'utf8')
  assert.match(script, /bin\/dependency-tree-check\.mjs/)
  assert.match(script, /node_modules\/\.pnpm\/lock\.yaml 缺失，已按 pnpm-lock\.yaml 逐项核对/)
})
