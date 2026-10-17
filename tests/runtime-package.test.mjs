import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const unix = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const windows = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')
const workspace = parse(await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
const patches = Object.values(workspace.patchedDependencies || {}).map(value => typeof value === 'string' ? value : value.path)

const required = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bin/dsh-compatibility.mjs', 'bin/dsh-tavern.mjs', 'bin/launcher-environment.mjs', 'bin/launcher-settings.mjs', 'bin/profile-installation.mjs', 'bin/service-lifecycle.mjs', 'bin/application-update.mjs', 'config/dsh-compatibility.json', ...patches]
required.push('bin/dsh-tavern-update-helper.mjs', 'bin/windows-update-launch.mjs', 'bin/update-diagnostics.mjs')
required.push('tavern-plugin/lib/domain/server-template-runtime.js', 'tavern-plugin/lib/domain/server-template-worker.js', 'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/engine.js', 'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/manifest.json')
required.push('tavern-plugin/lib/domain/tavern-client-assets.js', 'tavern-plugin/lib/client-assets/tavern.css')
required.push('bin/build-tavern-client.mjs', 'tavern-plugin/src/client/main.js',
  ...['runtime-generation-monitor', 'library-refresh', 'live-tavern-view'].map(name => `tavern-plugin/src/client/modules/${name}.js`))
required.push('bin/bundled-image-plugin.mjs', ...['package.json', 'cordis.patch.yml', 'LICENSE', 'src/index.ts', 'lib/index.js', 'lib/client.js'].map(file => `tavern-plugin/packages/dsh-image-gen/${file}`))
required.push('tavern-plugin/lib/domain/scene-image-module-settings.js', 'tavern-plugin/lib/domain/image-generation-host.js', 'tavern-plugin/packages/dsh-image-gen/src/module.js', 'tavern-plugin/packages/dsh-image-gen/src/configuration.js',
  ...['redact', 'scene-image-reference', 'scene-image-style', 'scene-image-channels', 'scene-image-connection', 'scene-image-comfy-workflow', 'scene-image-zip', 'scene-image-comfy', 'scene-image-provider', 'scene-image-auth', 'scene-image-novelai'].map(name => `tavern-plugin/packages/dsh-image-gen/src/tavern/${name}.js`))

for (const [name, paths] of [
  ['Unix', unix.match(/^RUNTIME_PATHS='([^']+)'/m)[1].split(/\s+/)],
  ['Windows', [...windows.match(/\$RuntimePaths = @\(([\s\S]*?)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1])],
]) {
  test(`${name} 实际 Git 运行包包含所有依赖补丁，不打包文档`, async t => {
    // The two installers use identical Git path selection, independent of tar/zip format.
    // List from a file like the installers do: bsdtar stops at the end-of-archive
    // marker, so feeding it through stdin can fail with EPIPE on the trailing padding.
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-runtime-archive-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const archive = path.join(directory, 'app.tar')
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, process.env.DSH_TEST_ARCHIVE_TREE || 'HEAD', '--', ...paths], { cwd: root })
    const files = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).split(/\r?\n/)
    for (const file of required) assert.ok(files.includes(file), `运行包遗漏：${file}`)
    assert.ok(!files.some(file => /^(docs|tests|references)\//.test(file)))
  })
}

test('CDN 清单生成器包含全部依赖补丁及其校验值', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'tavern-runtime-package-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  for (const directory of ['bin', 'config', 'presets', 'tavern-plugin']) await mkdir(path.join(fixture, directory))
  for (const file of new Set([...required, 'cordis.patch.yml', 'install.sh', 'install.ps1'])) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true })
    await writeFile(path.join(fixture, file), await readFile(path.join(root, file)))
  }
  for (const directory of ['docs', 'tests', '__tests__', 'testsets']) {
    await mkdir(path.join(fixture, 'tavern-plugin', directory))
    await writeFile(path.join(fixture, 'tavern-plugin', directory, 'unused.txt'), 'development only')
  }
  execFileSync(process.execPath, [path.join(root, '.github/scripts/write-runtime-manifest.mjs'), 'a'.repeat(40), '42'], { cwd: fixture })
  const manifest = JSON.parse(await readFile(path.join(fixture, 'dsh-tavern-runtime.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.ok(!manifest.files.some(file => file.path.endsWith('/unused.txt')), 'CDN 也不应下载嵌套的测试或文档')
  assert.equal(manifest.releaseSequence, 42)
  assert.equal(manifest.version, JSON.parse(await readFile(path.join(fixture, 'package.json'), 'utf8')).version)
  for (const file of required) {
    const entry = manifest.files.find(entry => entry.path === file)
    assert.ok(entry, `CDN 清单遗漏：${file}`)
    const content = await readFile(path.join(fixture, file))
    assert.equal(entry.size, content.length)
    assert.equal(entry.sha256, createHash('sha256').update(content).digest('hex'))
  }
})

test('Git 增量归档在用户开启 CRLF 转换时仍保持运行文件原始字节', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-archive-eol-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: directory })
  git(['init', '-q'])
  const source = Buffer.from('#!/bin/sh\necho hello\n')
  await writeFile(path.join(directory, 'install.sh'), source)
  git(['-c', 'core.autocrlf=false', 'add', '.'])
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  git(['config', 'core.autocrlf', 'true'])
  for (const installer of [unix, windows]) {
    const line = installer.split('\n').find(line => line.includes('git.archive') && line.includes('--format='))
    assert.ok(line, 'Installer must invoke the logged Git archive operation')
    const flags = [...line.replace(/['",]/g, '').matchAll(/-c\s+(core\.[a-z]+=[a-z]+)/g)].flatMap(match => ['-c', match[1]])
    assert.deepEqual(flags, ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'])
    const archive = git([...flags, 'archive', '--format=tar', 'HEAD'])
    assert.deepEqual(execFileSync('tar', ['-xOf', '-', 'install.sh'], { input: archive }), source)
  }
})

// Exercise the actual fallback archive, not just the installer's path allowlist.
// Both formats must retain every runtime byte while excluding development data.
for (const format of ['tar', 'zip']) {
  test(`兜底 ${format} 下载包只移除开发资料，保留完整运行文件`, async t => {
    const archive = execFileSync('git', ['archive', `--format=${format}`, process.env.DSH_TEST_ARCHIVE_TREE || 'HEAD'], { cwd: root, maxBuffer: 100 * 1024 * 1024 })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-archive-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, `app.${format}`)
    await writeFile(file, archive)
    // ZIP readers may stop before consuming all stdin bytes; use a seekable file
    // to avoid EPIPE or a blocked synchronous pipe on macOS.
    const listing = format === 'zip' && process.platform === 'linux'
      ? execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' })
      : execFileSync('tar', ['-tf', file], { encoding: 'utf8' })
    const files = listing.split(/\r?\n/)
    for (const file of required) assert.ok(files.includes(file), `运行包遗漏：${file}`)
    assert.ok(files.includes('LICENSE'), '保留许可文件')
    assert.ok(files.includes('android/setup.sh'), '源码下载包保留 Android 安装入口')
    assert.ok(!files.some(file => /(^|\/)(docs|tests|__tests__|testsets)(\/|$)/.test(file)), '下载包不应包含文档、图片或测试目录')
    for (const directory of ['examples', 'references', '.github', 'claude', 'scripts', 'packaging']) {
      assert.ok(!files.some(file => file.startsWith(directory + '/')), `开发资料未排除：${directory}`)
    }
  })
}

test('依赖补丁每个文件段都以 diff --git 标头开头（pnpm 12 拒绝缺标头的补丁，#194）', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const dir = new URL('../patches/', import.meta.url)
  for (const name of readdirSync(dir).filter(file => file.endsWith('.patch'))) {
    const lines = readFileSync(new URL(name, dir), 'utf8').split(/\r?\n/)
    assert.match(lines[0], /^diff --git a\/\S+ b\/\S+$/, name)
    lines.forEach((line, index) => {
      if (line.startsWith('--- a/') && lines[index + 1]?.startsWith('+++ b/')) assert.ok(lines.slice(Math.max(0, index - 4), index).some(item => item.startsWith('diff --git ')), name + ' 第 ' + (index + 1) + ' 行')
    })
  }
})
