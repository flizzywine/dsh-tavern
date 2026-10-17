import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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
