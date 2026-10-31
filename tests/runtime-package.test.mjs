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
const bundledWorldbooks = ['tavern-plugin/packages/dsh-tavern-image-bundled/世界书-通用生图规则.json', 'tavern-plugin/packages/dsh-tavern-image-bundled/世界书-角色与服装库.json']
required.push('bin/bundled-scene-image-plugin.mjs', 'tavern-plugin/packages/dsh-tavern-image-bundled/package.json', 'tavern-plugin/packages/dsh-tavern-image-bundled/BUNDLED-VERSION.json', 'tavern-plugin/packages/dsh-tavern-image-bundled/cordis.patch.yml', 'tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js', 'tavern-plugin/packages/dsh-tavern-image-bundled/client.js', ...bundledWorldbooks)
required.push('tavern-plugin/lib/domain/server-template-runtime.js', 'tavern-plugin/lib/domain/server-template-worker.js', 'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/engine.js', 'tavern-plugin/lib/vendor/st-prompt-template/server-artifact/manifest.json')
required.push('tavern-plugin/lib/domain/tavern-client-assets.js', 'tavern-plugin/lib/client-assets/tavern.css')
required.push('bin/build-tavern-client.mjs')
required.push(...['package.json','cordis.patch.yml','lib/index.js','lib/runtime.js','lib/module.js','lib/requests.js','lib/rpc.js','lib/workflow.js','lib/story-observer.js','lib/card-assets.js'].map(file=>'tavern-plugin/packages/dsh-tavern-stage/'+file))
required.push(...['asset-engine.js', 'asset-runtime.js', 'card-zip-target.js', 'cg-gallery.js', 'domain/mods/core-media.js', 'domain/mods/models.js', 'domain/stage-director.js', 'domain/widget-variable-service.js', 'engine-judge.js', 'figure-voice-authoring.js', 'mod-config-host.js', 'mod-config.js', 'mod-service.js', 'mod-stage.js', 'mod-system-execution.js', 'mod-system-production.js'].map(file=>'tavern-plugin/packages/dsh-tavern-stage/lib/'+file))
required.push(...['runtime-kernel.cjs', 'runtime-store.cjs', 'session.cjs', 'lifetime.cjs'].map(file=>'tavern-plugin/packages/dsh-tavern-stage/lib/client/'+file))
// In the repository and the Git package, but never read by an installed copy (lib/client.js is the
// built client; only settings.html and the licenses of the vendored upstream sources are loaded).
const developmentOnly = ['tavern-plugin/src/client/main.js', 'tavern-plugin/lib/vendor/st-prompt-template/upstream/package.json', 'tavern-plugin/lib/vendor/magvarupdate/upstream/package.json']
const lazyFontBinaries = ['tavern-plugin/fonts', 'tavern-plugin/packages/dsh-dream-skin/fonts'].flatMap(root => ['woff2', 'ttf', 'otf'].map(ext => root + '/example/face.' + ext))
const fontMetadata = ['tavern-plugin/fonts/example/index.json', 'tavern-plugin/fonts/example/OFL.txt', 'tavern-plugin/fonts/example/LICENSE']
const keptUpstream = ['tavern-plugin/lib/vendor/st-prompt-template/upstream/settings.html', 'tavern-plugin/lib/vendor/st-prompt-template/upstream/LICENSE', 'tavern-plugin/lib/vendor/magvarupdate/upstream/LICENSE']

// Git emits USTAR/PAX UTF-8 names; Windows tar's listing and extraction depend on locale.
function gitTarFiles(archive) {
  const files = [], utf8 = new TextDecoder('utf-8', { fatal: true })
  const text = bytes => utf8.decode(bytes).split('\0', 1)[0]
  let offset = 0, pendingPath
  while (offset < archive.length) {
    assert.ok(offset + 512 <= archive.length, 'Truncated TAR header')
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      assert.ok(archive.length - offset >= 1024 && (archive.length - offset) % 512 === 0 && archive.subarray(offset).every(byte => byte === 0), 'Invalid TAR trailer')
      assert.equal(pendingPath, undefined, 'Missing PAX target')
      return files
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    assert.equal(checksum, parseInt(text(header.subarray(148, 156)).trim(), 8), 'Invalid TAR checksum')
    const sizeText = text(header.subarray(124, 136)).trim()
    assert.match(sizeText, /^[0-7]+$/, 'Invalid TAR size')
    const size = parseInt(sizeText, 8), next = offset + 512 + Math.ceil(size / 512) * 512
    assert.ok(Number.isSafeInteger(size) && Number.isSafeInteger(next) && next <= archive.length, 'Truncated or invalid TAR entry')
    const type = String.fromCharCode(header[156])
    if (type === 'x') {
      const body = archive.subarray(offset + 512, offset + 512 + size)
      for (let cursor = 0; cursor < body.length;) {
        const space = body.indexOf(32, cursor)
        assert.ok(space > cursor, 'Invalid PAX record')
        const lengthText = body.subarray(cursor, space).toString('ascii')
        assert.match(lengthText, /^[0-9]+$/, 'Invalid PAX length')
        const length = Number(lengthText)
        assert.ok(Number.isSafeInteger(length) && length > space - cursor + 2 && cursor + length <= body.length, 'Invalid PAX length')
        assert.equal(body[cursor + length - 1], 10, 'Invalid PAX terminator')
        const record = utf8.decode(body.subarray(space + 1, cursor + length - 1))
        assert.ok(record.indexOf('=') > 0, 'Invalid PAX attribute')
        if (record.startsWith('path=')) pendingPath = record.slice(5)
        cursor += length
      }
    } else if (type !== 'g') { // Git's global PAX header only carries its commit comment.
      const prefix = text(header.subarray(345, 500))
      const name = pendingPath ?? (prefix ? prefix + '/' : '') + text(header.subarray(0, 100))
      assert.ok(name, 'Invalid TAR filename')
      files.push(name)
      pendingPath = undefined
    }
    offset = next
  }
  assert.fail('Missing TAR end marker')
}

// Read names from the archive bytes on every platform: system tar's listing depends on the
// locale (macOS bsdtar without a UTF-8 LANG prints 世界书 as \344\270\226…).
async function listTarFiles(file) {
  return gitTarFiles(await readFile(file))
}

test('Git TAR 清单保留 Unicode、PAX 长路径和 USTAR prefix，并拒绝损坏或截断', () => {
  const entry = (name, type, body = Buffer.alloc(0), prefix = '') => {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12)
    header.write(type, 156, 1)
    header.write('ustar\0', 257, 6)
    header.write(prefix, 345, 155, 'utf8')
    header.fill(32, 148, 156)
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8)
    return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
  }
  const pax = value => {
    let length = Buffer.byteLength(value) + 3
    while (Buffer.byteLength(`${length} ${value}\n`) !== length) length = Buffer.byteLength(`${length} ${value}\n`)
    return Buffer.from(`${length} ${value}\n`)
  }
  const longPath = '目录/' + '世界书'.repeat(40) + '.json'
  const archive = Buffer.concat([
    entry('pax_global_header', 'g', pax('comment=fixture')),
    entry('世界书.json', '0', Buffer.from('内容')),
    entry('pax_header', 'x', Buffer.concat([pax('comment=中文'), pax('path=' + longPath)])),
    entry('placeholder', '0', Buffer.from('long path content')),
    entry('plain.txt', '0'), // The previous PAX path must not leak into this entry.
    entry('规则.json', '0', Buffer.alloc(0), 'plugins/中文目录'),
    entry('目录/', '5'),
    Buffer.alloc(1024),
  ])
  assert.deepEqual(gitTarFiles(archive), ['世界书.json', longPath, 'plain.txt', 'plugins/中文目录/规则.json', '目录/'])
  for (const truncated of [archive.subarray(0, 511), archive.subarray(0, 600), archive.subarray(0, -1)]) assert.throws(() => gitTarFiles(truncated), /TAR/)
  const damaged = Buffer.from(archive)
  damaged[0] ^= 1
  assert.throws(() => gitTarFiles(damaged), /checksum/)
  assert.throws(() => gitTarFiles(Buffer.concat([entry('pax_header', 'x', Buffer.from('999 path=bad\n')), Buffer.alloc(1024)])), /PAX length/)
})

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
    const files = await listTarFiles(archive)
    for (const file of required) assert.ok(files.includes(file), `运行包遗漏：${file}`)
    assert.ok(!files.some(file => /^(docs|tests|references)\//.test(file)))
  })
}

test('CDN 清单生成器包含全部依赖补丁及其校验值', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'tavern-runtime-package-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  for (const directory of ['android', 'bin', 'config', 'presets', 'tavern-plugin']) await mkdir(path.join(fixture, directory))
  for (const file of new Set([...required, ...developmentOnly, ...keptUpstream, 'cordis.patch.yml', 'install.sh', 'install.ps1', 'android/setup.sh'])) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true })
    await writeFile(path.join(fixture, file), await readFile(path.join(root, file)))
  }
  for (const file of [...lazyFontBinaries, ...fontMetadata]) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true })
    await writeFile(path.join(fixture, file), 'fixture')
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
  assert.ok(manifest.files.some(file => file.path === 'android/setup.sh'), 'CDN 清单需要 android/ 才能增量更新 APK 端的安装脚本')
  for (const file of lazyFontBinaries) assert.ok(!manifest.files.some(entry => entry.path === file), `Lazy font must not enter core: ${file}`)
  for (const file of fontMetadata) assert.ok(manifest.files.some(entry => entry.path === file), `Font metadata/license must remain: ${file}`)
  for (const file of developmentOnly) assert.ok(!manifest.files.some(entry => entry.path === file), `CDN 清单不应下载开发用文件：${file}`)
  for (const file of [...required, ...keptUpstream]) {
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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-archive-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, `app.${format}`)
    // Write directly to disk: the source archive intentionally still includes bundled fonts
    // for old installers and exceeds Node's former 100 MB stdout buffer cap.
    execFileSync('git', ['archive', `--format=${format}`, `--output=${file}`, process.env.DSH_TEST_ARCHIVE_TREE || 'HEAD'], { cwd: root })
    // ZIP readers may stop before consuming all stdin bytes; use a seekable file
    // to avoid EPIPE or a blocked synchronous pipe on macOS.
    // Windows bsdtar uses the legacy system locale to decode ZIP names; .NET reads UTF-8 names directly.
    const listing = format === 'tar'
      ? (await listTarFiles(file)).join('\n')
      : format === 'zip' && process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference = \'Stop\'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead($env:DSH_TEST_ZIP_PATH); try { foreach ($entry in $zip.Entries) { [Console]::Out.WriteLine($entry.FullName) } } finally { $zip.Dispose() }'], { encoding: 'utf8', env: { ...process.env, DSH_TEST_ZIP_PATH: file } })
      : format === 'zip' && process.platform === 'linux'
        ? execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' })
        : execFileSync('tar', ['-tf', file], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })
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
