import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import YAML from 'yaml'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// pnpm 把 patchedDependencies 的补丁路径换成补丁文件内容的 sha256 写进 lockfile
// （顶层 patchedDependencies 与 importers/snapshots 的 patch_hash 三处同值）。
// 改过 patches/*.patch 而没重写 lockfile 时，pnpm install --frozen-lockfile 会以
// ERR_PNPM_LOCKFILE_CONFIG_MISMATCH 直接失败——安装器与手机端更新都走 frozen 安装，
// 于是表现为「更新失败：安装程序执行失败（退出码 1）」。
async function patchHashMismatches(root) {
  const workspace = YAML.parse(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')) ?? {}
  const lock = YAML.parse(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')) ?? {}
  const declared = workspace.patchedDependencies ?? {}
  const recorded = lock.patchedDependencies ?? {}
  const problems = []
  for (const name of Object.keys(declared).sort()) {
    const relative = declared[name]
    const digest = createHash('sha256')
      .update(await readFile(path.resolve(root, relative)))
      .digest('hex')
    const expected = recorded[name]
    if (!expected) {
      problems.push(`${name}: lockfile 缺少记录，请运行 pnpm install --lockfile-only --ignore-scripts`)
    } else if (expected !== digest) {
      problems.push(`${name}: lockfile=${expected} 补丁实际=${digest}`)
    }
  }
  for (const name of Object.keys(recorded).sort()) {
    if (!(name in declared)) problems.push(`${name}: lockfile 仍在引用 workspace 已移除的补丁`)
  }
  return problems
}

test('pnpm-lock.yaml 的补丁 hash 与 patches/*.patch 内容一致', async () => {
  const problems = await patchHashMismatches(ROOT)
  assert.deepEqual(
    problems,
    [],
    'pnpm-lock.yaml 的 patchedDependencies 已过期；改过 patches/*.patch 后运行 '
      + 'pnpm install --lockfile-only --ignore-scripts 再提交，否则 frozen 安装会失败',
  )
})

test('补丁 hash 校验能发现过期记录', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lockfile-patch-hash-'))
  try {
    await mkdir(path.join(root, 'patches'))
    await writeFile(path.join(root, 'patches', 'demo@1.0.0.patch'), 'first\n')
    const first = createHash('sha256').update('first\n').digest('hex')
    await writeFile(path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\npatchedDependencies:\n  demo@1.0.0: patches/demo@1.0.0.patch\n')
    await writeFile(path.join(root, 'pnpm-lock.yaml'),
      `lockfileVersion: '9.0'\n\npatchedDependencies:\n  demo@1.0.0: ${first}\n`)
    assert.deepEqual(await patchHashMismatches(root), [])

    await writeFile(path.join(root, 'patches', 'demo@1.0.0.patch'), 'second\n')
    const problems = await patchHashMismatches(root)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /demo@1\.0\.0: lockfile=/)

    await writeFile(path.join(root, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n\npatchedDependencies:\n  gone@2.0.0: abc\n")
    const stale = await patchHashMismatches(root)
    assert.equal(stale.length, 2)
    assert.match(stale.join('\n'), /demo@1\.0\.0: lockfile 缺少记录/)
    assert.match(stale.join('\n'), /gone@2\.0\.0: lockfile 仍在引用/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
