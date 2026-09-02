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
required.push('bin/bundled-image-plugin.mjs', ...['package.json', 'cordis.patch.yml', 'LICENSE', 'src/index.ts', 'lib/index.js', 'lib/client.js'].map(file => `tavern-plugin/packages/dsh-image-gen/${file}`))
required.push('tavern-plugin/lib/domain/scene-image-module-settings.js', 'tavern-plugin/lib/domain/image-generation-host.js', 'tavern-plugin/packages/dsh-image-gen/src/module.js', 'tavern-plugin/packages/dsh-image-gen/src/configuration.js',
  ...['redact', 'scene-image-reference', 'scene-image-style', 'scene-image-channels', 'scene-image-connection', 'scene-image-comfy-workflow', 'scene-image-zip', 'scene-image-comfy', 'scene-image-provider', 'scene-image-auth', 'scene-image-novelai'].map(name => `tavern-plugin/packages/dsh-image-gen/src/tavern/${name}.js`))

for (const [name, paths] of [
  ['Unix', unix.match(/^RUNTIME_PATHS='([^']+)'/m)[1].split(/\s+/)],
  ['Windows', [...windows.match(/\$RuntimePaths = @\(([\s\S]*?)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1])],
]) {
  test(`${name} 实际 Git 运行包包含所有依赖补丁，不打包文档`, () => {
    // The two installers use identical Git path selection, independent of tar/zip format.
    const archive = execFileSync('git', ['archive', '--format=tar', process.env.DSH_TEST_ARCHIVE_TREE || 'HEAD', '--', ...paths], { cwd: root, maxBuffer: 50 * 1024 * 1024 })
    const files = execFileSync('tar', ['-tf', '-'], { input: archive, encoding: 'utf8' }).split(/\r?\n/)
    for (const file of required) assert.ok(files.includes(file), `运行包遗漏：${file}`)
    assert.ok(!files.some(file => /^(docs|tests|references)\//.test(file)))
  })
}

test('CDN 清单生成器包含全部依赖补丁及其校验值', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'tavern-runtime-package-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  for (const directory of ['bin', 'config', 'presets', 'tavern-plugin', 'patches']) await mkdir(path.join(fixture, directory))
  for (const file of new Set([...required, 'cordis.patch.yml', 'install.sh', 'install.ps1'])) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true })
    await writeFile(path.join(fixture, file), await readFile(path.join(root, file)))
  }
  execFileSync(process.execPath, [path.join(root, '.github/scripts/write-runtime-manifest.mjs'), 'a'.repeat(40), '42'], { cwd: fixture })
  const manifest = JSON.parse(await readFile(path.join(fixture, 'dsh-tavern-runtime.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.equal(manifest.releaseSequence, 42)
  assert.equal(manifest.version, '1.2.0')
  for (const file of required) {
    const entry = manifest.files.find(entry => entry.path === file)
    assert.ok(entry, `CDN 清单遗漏：${file}`)
    const content = await readFile(path.join(fixture, file))
    assert.equal(entry.size, content.length)
    assert.equal(entry.sha256, createHash('sha256').update(content).digest('hex'))
  }
})
