import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const attributes = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8')
const unix = readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
const windows = readFileSync(new URL('../install.ps1', import.meta.url), 'utf8')
const docs = ['docs/images/readme/overview.png', 'tavern-plugin/packages/dsh-image-gen/docs/assets/gallery-preview.png']
const icon = 'tavern-plugin/lib/vendor/runtime-assets/jquery-ui/themes/base/images/ui-icons_444444_256x240.png'
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-distribution-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const name of [...docs, icon]) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), 'image')
  }
  writeFileSync(path.join(root, 'package.json'), '{"version":"2.1.0"}')
  return root
}
function command(cwd, program, args) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('Git 导出的 tar 和 ZIP 排除 README 及子包宣传图，保留运行图标', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t)
  writeFileSync(path.join(root, '.gitattributes'), attributes)
  command(root, 'git', ['init', '-q'])
  command(root, 'git', ['add', '.'])
  command(root, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  for (const format of ['tar', 'zip']) {
    command(root, 'git', ['archive', '--format=' + format, '--output=app.' + format, 'HEAD'])
    const files = format === 'tar' ? command(root, 'tar', ['-tf', 'app.tar']) : command(root, 'unzip', ['-Z1', 'app.zip'])
    assert.doesNotMatch(files, /(^|\/)docs\//m)
    assert.ok(files.includes(icon))
    assert.ok(files.includes('package.json'))
  }
  // Export attributes must not remove the original website or README assets.
  for (const name of docs) assert.equal(readFileSync(path.join(root, name), 'utf8'), 'image')
})

test('运行清单不列入子包文档图片，继续校验运行图片', t => {
  const root = fixture(t)
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh']) writeFileSync(path.join(root, name), '')
  for (const name of ['bin', 'config', 'presets', 'patches']) mkdirSync(path.join(root, name))
  writeFileSync(path.join(root, 'patches', 'sidebar.patch'), 'runtime dependency patch')
  command(root, process.execPath, [fileURLToPath(new URL('../.github/scripts/write-runtime-manifest.mjs', import.meta.url)), 'a'.repeat(40), '1'])
  const manifest = JSON.parse(readFileSync(path.join(root, 'dsh-tavern-runtime.json'), 'utf8'))
  assert.ok(manifest.files.some(file => file.path === 'patches/sidebar.patch'))
  assert.ok(manifest.files.some(file => file.path === icon && file.sha256.length === 64))
  assert.ok(!manifest.files.some(file => file.path.split('/').includes('docs')))
})

test('旧完整压缩包的 Unix 兜底解压也排除文档图片', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t)
  const temp = mkdtempSync(path.join(tmpdir(), 'tavern-extract-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  mkdirSync(path.join(temp, 'extract'))
  command(root, 'tar', ['-czf', path.join(temp, 'app.tar.gz'), '-C', path.dirname(root), path.basename(root)])
  const extract = unix.split('\n').find(line => line.includes('tar -xzf "${TEMP_DIR}/app.tar.gz"'))
  assert.ok(extract)
  const result = spawnSync('sh', ['-ec', extract], { env: { ...process.env, TEMP_DIR: temp }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const files = command(temp, 'find', ['extract', '-type', 'f'])
  assert.doesNotMatch(files, /\/docs\//)
  assert.ok(files.includes(icon))
})

test('README 引用的本地图片均在排除范围内，Windows 只清理临时解压目录', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]).filter(url => !/^https?:/.test(url))
  assert.ok(images.length > 20)
  assert.ok(images.every(file => file.startsWith('docs/')))
  assert.match(windows, /Get-ChildItem -LiteralPath \$ExtractDir -Directory -Recurse -Filter 'docs'/)
  assert.ok(windows.indexOf("-Filter 'docs'") < windows.indexOf('Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item'))
})
