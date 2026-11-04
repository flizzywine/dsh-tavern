import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'
import { CDN_ENTRYPOINTS, stageCdnEntrypoints } from '../.github/scripts/stage-cdn-entrypoints.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const workflow = parse(await readFile(path.join(root, '.github/workflows/publish-runtime-manifest.yml'), 'utf8'))

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-cdn-dist-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const files = []
  for (const file of CDN_ENTRYPOINTS.filter(file => file !== 'dsh-tavern-runtime.json')) {
    const bytes = Buffer.from(file === 'install.ps1' ? '# 安装脚本\n' : '#!/bin/sh\n# 安装脚本\n')
    await mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await writeFile(path.join(source, file), bytes)
    files.push({ path: file, size: bytes.length, sha256: hash(bytes) })
  }
  await writeFile(path.join(source, 'dsh-tavern-runtime.json'), JSON.stringify({ revision: 'a'.repeat(40), files }))
  return { directory, source }
}

test('CDN 发布流程生成小分支，清单固定引用上一提交的 ZIP，并保留匹配的入口', { skip: process.platform === 'win32' }, async t => {
  const { directory, source } = await fixture(t)
  const remote = path.join(directory, 'origin.git')
  const temporary = path.join(directory, 'runner')
  await mkdir(temporary)
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  await mkdir(path.join(source, '.github/scripts'), { recursive: true })
  for (const file of ['check-runtime-archive.mjs', 'attach-runtime-archive.mjs', 'stage-cdn-entrypoints.mjs']) {
    await writeFile(path.join(source, '.github/scripts', file), await readFile(path.join(root, '.github/scripts', file)))
  }
  await writeFile(path.join(source, 'development-only.txt'), 'must not enter CDN branch')
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('add', '.')
  git('commit', '-qm', 'source fixture')
  const revision = git('rev-parse', 'HEAD')
  const initial = JSON.parse(await readFile(path.join(source, 'dsh-tavern-runtime.json')))
  initial.revision = revision
  await writeFile(path.join(source, 'dsh-tavern-runtime.json'), JSON.stringify(initial))
  git('init', '--bare', '-q', remote)
  git('remote', 'add', 'origin', remote)
  const step = workflow.jobs.publish.steps.find(step => step.name === 'Publish runtime archive')
  execFileSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
    cwd: source, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, RUNNER_TEMP: temporary, GITHUB_REF_NAME: 'main', GITHUB_WORKSPACE: source },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const distribution = git('--git-dir', remote, 'rev-parse', 'runtime-archive-main')
  const manifest = JSON.parse(git('--git-dir', remote, 'show', distribution + ':dsh-tavern-runtime.json'))
  assert.equal(manifest.revision, revision)
  assert.equal(git('--git-dir', remote, 'rev-parse', distribution + '^'), manifest.archive.commit)
  assert.deepEqual(git('--git-dir', remote, 'ls-tree', '-r', '--name-only', distribution).split('\n').sort(), [...CDN_ENTRYPOINTS, 'runtime.zip'].sort())
  assert.equal(git('--git-dir', remote, 'ls-tree', '-r', '--name-only', manifest.archive.commit), 'runtime.zip')
  const archive = execFileSync('git', ['--git-dir', remote, 'show', manifest.archive.commit + ':runtime.zip'])
  assert.equal(manifest.archive.sha256, hash(archive))
  assert.equal(manifest.archive.size, archive.length)
  for (const file of CDN_ENTRYPOINTS.filter(file => file !== 'dsh-tavern-runtime.json')) {
    const bytes = execFileSync('git', ['--git-dir', remote, 'show', distribution + ':' + file])
    assert.deepEqual(bytes, await readFile(path.join(source, file)))
    assert.equal(manifest.files.find(entry => entry.path === file).sha256, hash(bytes))
  }
})

test('发布前拒绝 ZIP 或安装入口与清单不一致', async t => {
  const { directory, source } = await fixture(t)
  const destination = path.join(directory, 'distribution')
  await mkdir(destination)
  const bytes = Buffer.from('archive fixture')
  await writeFile(path.join(destination, 'runtime.zip'), bytes)
  const manifestFile = path.join(source, 'dsh-tavern-runtime.json')
  const manifest = JSON.parse(await readFile(manifestFile))
  manifest.archive = { commit: 'b'.repeat(40), path: 'runtime.zip', size: bytes.length, sha256: hash(bytes) }
  await writeFile(manifestFile, JSON.stringify(manifest))
  assert.ok(await stageCdnEntrypoints(source, destination) < 50_000_000)
  await writeFile(path.join(destination, 'runtime.zip'), 'damaged')
  await assert.rejects(stageCdnEntrypoints(source, destination), /archive does not match/)
  await writeFile(path.join(destination, 'runtime.zip'), bytes)
  await writeFile(path.join(source, 'install.sh'), 'stale installer')
  await assert.rejects(stageCdnEntrypoints(source, destination), /entry point does not match.*install.sh/)
})
