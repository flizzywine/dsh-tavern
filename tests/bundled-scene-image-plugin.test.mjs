import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPluginUpdater, REPOSITORY_URL } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/updater.js'
import { createReleaseUpdater } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/release-updater.js'
import { createDownloadPackage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/download-package.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync, symlinkSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  BUNDLED_SCENE_IMAGE_FOLDER,
  comparePluginVersions,
  installBundledSceneImagePlugin,
  LEGACY_SCENE_IMAGE_PACKAGE_NAME,
  readBundledSceneImage,
  SCENE_IMAGE_PACKAGE_NAME,
} from '../bin/bundled-scene-image-plugin.mjs'

// 只依赖 node 内置模块，可在没有 node_modules 的浅克隆里单独跑：
//   node --test tests/bundled-scene-image-plugin.test.mjs

const CONTRACT = { tavern: { sceneImages: 'delegate' } }

function makeSource(t, version = '2.8.0') {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-src-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tavern-plugin', 'packages', 'dsh-tavern-image-bundled')
  mkdirSync(path.join(dir, 'lib'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: SCENE_IMAGE_PACKAGE_NAME, version, main: './lib/index.js', dsh: CONTRACT,
  }))
  writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const bundled = true\n')
  writeFileSync(path.join(dir, 'client.js'), '// client\n')
  mkdirSync(path.join(dir, 'workflows'), { recursive: true })
  writeFileSync(path.join(dir, 'workflows', 'seed-deleted.json'), '{"seed":true}')
  writeFileSync(path.join(dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version }))
  return { root, dir }
}

function makeData(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-bundled-data-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'plugins'), { recursive: true })
  return root
}

const quiet = { warn() {}, log() {} }
const PRIVATE_REFERENCE_FILES = ['reference-images/' + 'a'.repeat(64), 'format-worldbooks/tags/worldbook.json', 'format-worldbooks/structured/worldbook-outfits.json', 'format-worldbooks/migration-v1.json']
function privateData(directory, label) {
  const entries = PRIVATE_REFERENCE_FILES.map(file => [file, label + ':' + file])
  for (const [file, text] of entries) { mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); writeFileSync(path.join(directory, file), text) }
  return entries
}
function storedZipEntries(bytes) {
  const entries = new Map()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'download package uses stored entries')
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataAt = offset + 30 + nameLength + extraLength
    entries.set(name, bytes.subarray(dataAt, dataAt + length))
    offset = dataAt + length
  }
  return entries
}
function releaseFixture(t, archive, sourceVersion = '3.1.5') {
  const root = makeData(t)
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.4', dsh: { compatibility: { tavernApiVersion: 1 } } }))
  const original = privateData(root, 'local-private')
  const zipUrl = `https://github.com/weixinlll/dsh-tavern-image/releases/download/v${sourceVersion}/dsh-tavern-image-source.zip`
  const sumsUrl = `https://github.com/weixinlll/dsh-tavern-image/releases/download/v${sourceVersion}/SHA256SUMS`
  const bodies = new Map([
    ['https://api.github.com/repos/weixinlll/dsh-tavern-image/releases/latest', JSON.stringify({ tag_name: 'v' + sourceVersion, assets: [{ name: 'dsh-tavern-image-source.zip', browser_download_url: zipUrl }, { name: 'SHA256SUMS', browser_download_url: sumsUrl }] })],
    [zipUrl, archive], [sumsUrl, createHash('sha256').update(archive).digest('hex') + '  dsh-tavern-image-source.zip\n'],
  ])
  const fetchImpl = async url => { assert.ok(bodies.has(url), 'unexpected network request: ' + url); return new Response(bodies.get(url), { status: 200 }) }
  return { root, original, updater: createReleaseUpdater({ root, fetchImpl }) }
}
function gitUpdateFixture(t, changes) {
  const root = makeData(t)
  mkdirSync(path.join(root, '.git'))
  const packageData = version => ({ name: SCENE_IMAGE_PACKAGE_NAME, version, dsh: { compatibility: { tavernApiVersion: 1 } } })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageData('3.1.4')))
  const original = privateData(root, 'local-private'), calls = []
  const base = 'a'.repeat(40), target = 'b'.repeat(40)
  let head = base
  const git = async args => {
    calls.push(args)
    const command = args.join(' ')
    if (command === 'rev-parse --show-toplevel') return root
    if (command === 'remote get-url origin') return REPOSITORY_URL
    if (command === 'branch --show-current') return 'master'
    if (command === 'rev-parse HEAD') return head
    if (command === 'status --porcelain --untracked-files=no' || command === 'fetch --no-tags origin master') return ''
    if (command === 'rev-parse FETCH_HEAD') return target
    if (command === 'show ' + target + ':package.json') return JSON.stringify(packageData('3.1.5'))
    if (command === 'merge-base HEAD ' + target) return base
    if (args[0] === 'diff') { assert.ok(args.includes('-z')); assert.ok(args.includes('--no-renames')); return changes.join('\0') + '\0' }
    if (command === 'merge --ff-only --no-edit ' + target) { head = target; return '' }
    throw new Error('unexpected git invocation: ' + command)
  }
  return { root, original, calls, updater: createPluginUpdater({ root, git, getApiVersion: () => 5 }) }
}

test('首装不遍历或携带参考图、独立世界书及其他用户数据，仅保留代码和工作流占位', t => {
  const source = makeSource(t), data = makeData(t)
  privateData(source.dir, 'source-secret')
  writeFileSync(path.join(source.dir, 'config.json'), '{"apiKey":"source-secret"}')
  writeFileSync(path.join(source.dir, 'workflows', '.gitkeep'), '')
  writeFileSync(path.join(source.dir, 'lib', 'reference-images.js'), '// reference helper code')
  writeFileSync(path.join(source.dir, 'lib', 'format-worldbooks.js'), '// format helper code')
  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'installed')
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  for (const directory of ['reference-images', 'format-worldbooks']) assert.equal(existsSync(path.join(target, directory)), false)
  assert.equal(existsSync(path.join(target, 'config.json')), false)
  assert.equal(existsSync(path.join(target, 'workflows', 'seed-deleted.json')), false)
  assert.ok(existsSync(path.join(target, 'workflows', '.gitkeep')))
  for (const file of ['reference-images.js', 'format-worldbooks.js']) assert.ok(existsSync(path.join(target, 'lib', file)))
})

test('首装忽略安装源中的私有参考图目录链接，不跟随也不阻断代码安装', t => {
  const source = makeSource(t), data = makeData(t)
  const outside = path.join(data, 'private-references')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'secret.txt'), 'do not copy')
  for (const directory of ['reference-images', 'format-worldbooks']) symlinkSync(outside, path.join(source.dir, directory), process.platform === 'win32' ? 'junction' : 'dir')
  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'installed')
  for (const directory of ['reference-images', 'format-worldbooks']) assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER, directory)), false)
  assert.equal(readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'do not copy')
})

test('内置升级保留全部参考图和格式世界书，不覆盖、不补回用户删除的规则', t => {
  const source = makeSource(t, '3.1.5'), data = makeData(t)
  privateData(source.dir, 'must-not-overwrite')
  mkdirSync(path.join(source.dir, 'format-worldbooks', 'natural'), { recursive: true })
  writeFileSync(path.join(source.dir, 'format-worldbooks', 'natural', 'worldbook.json'), 'must-not-recreate')
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target)
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.4', main: './lib/index.js', dsh: CONTRACT }))
  const original = privateData(target, 'user-data')
  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'upgraded')
  for (const [file, text] of original) assert.equal(readFileSync(path.join(target, file), 'utf8'), text)
  assert.equal(existsSync(path.join(target, 'format-worldbooks', 'natural', 'worldbook.json')), false)
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.1.5')
})

test('下载源码包白名单不携带参考图和独立世界书，但包含对应实现代码', async t => {
  const source = makeSource(t)
  privateData(source.dir, 'source-secret-never-export')
  writeFileSync(path.join(source.dir, 'lib', 'reference-images.js'), '// helper')
  writeFileSync(path.join(source.dir, 'lib', 'format-worldbooks.js'), '// helper')
  const archive = await createDownloadPackage(source.dir), entries = storedZipEntries(archive)
  assert.ok(entries.has('dsh-tavern-image/lib/reference-images.js'))
  assert.ok(entries.has('dsh-tavern-image/lib/format-worldbooks.js'))
  assert.ok([...entries.keys()].every(name => !/^dsh-tavern-image\/(reference-images|format-worldbooks)(\/|$)/i.test(name)))
  assert.equal(archive.includes(Buffer.from('source-secret-never-export')), false)
  const packagePath = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/package.json', import.meta.url))
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8'))
  assert.ok(Array.isArray(metadata.files))
  assert.ok(metadata.files.every(name => !/^(reference-images|format-worldbooks)(\/|$)/i.test(name) && !['*', '**', '**/*', '.'].includes(name)), 'npm files 仍是静态代码白名单')
})

test('Git 更新拒绝新增、删除或重命名涉及新私有目录的任何路径', async t => {
  for (const changed of ['reference-images', 'reference-images/' + 'a'.repeat(64), 'format-worldbooks/structured/worldbook.json', 'format-worldbooks/含引号"与\n换行.json', 'FORMAT-WORLDBOOKS/mixed/worldbook-outfits.json']) {
    const { root, original, calls, updater } = gitUpdateFixture(t, [changed, 'lib/reference-images.js'])
    const result = await updater.check()
    assert.equal(result.available, true)
    assert.equal(result.canUpdate, false, changed)
    assert.match(result.reason, /用户数据路径/)
    await assert.rejects(updater.apply(result.target), /先检查更新/)
    assert.ok(!calls.some(args => args[0] === 'merge'))
    for (const [file, text] of original) assert.equal(readFileSync(path.join(root, file), 'utf8'), text)
  }
})

test('Git 更新允许两个 helper 的代码变更，且不触碰本地参考图和格式世界书', async t => {
  const { root, original, calls, updater } = gitUpdateFixture(t, ['lib/reference-images.js', 'lib/format-worldbooks.js', 'README.md'])
  const result = await updater.check()
  assert.equal(result.canUpdate, true, result.reason)
  assert.equal((await updater.apply(result.target)).restartRequired, true)
  assert.equal(calls.filter(args => args[0] === 'merge').length, 1)
  for (const [file, text] of original) assert.equal(readFileSync(path.join(root, file), 'utf8'), text)
})

test('Release 白名单升级保留本地参考图和独立世界书', async t => {
  const source = makeSource(t, '3.1.5')
  writeFileSync(path.join(source.dir, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.5', dsh: { compatibility: { tavernApiVersion: 1 } } }))
  privateData(source.dir, 'source-secret')
  const { root, original, updater } = releaseFixture(t, await createDownloadPackage(source.dir))
  const checked = await updater.check()
  assert.equal(checked.canUpdate, true, checked.reason)
  assert.equal((await updater.apply(checked.target)).restartRequired, true)
  for (const [file, text] of original) assert.equal(readFileSync(path.join(root, file), 'utf8'), text)
  assert.match(readFileSync(path.join(root, 'lib', 'index.js'), 'utf8'), /bundled/)
})

test('Release ZIP 即便含有效校验和也不能写入参考图或独立世界书目录', async t => {
  for (const protectedPath of ['reference-images/never-overwrite', 'format-worldbooks/tags/worldbook.json']) {
    const source = makeSource(t, '3.1.5')
    writeFileSync(path.join(source.dir, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.5', dsh: { compatibility: { tavernApiVersion: 1 } } }))
    const innocentPath = 'lib/' + 'x'.repeat(protectedPath.length - 4)
    writeFileSync(path.join(source.dir, innocentPath), 'malicious new user data')
    const archive = Buffer.from(await createDownloadPackage(source.dir))
    const before = Buffer.from('dsh-tavern-image/' + innocentPath), after = Buffer.from('dsh-tavern-image/' + protectedPath)
    assert.equal(before.length, after.length)
    // Rename both local and central-directory filenames without altering file
    // content CRCs, so rejection must be the protected-path allowlist itself.
    let count = 0, offset = 0
    while ((offset = archive.indexOf(before, offset)) >= 0) { after.copy(archive, offset); offset += after.length; count++ }
    assert.equal(count, 2)
    const { root, original, updater } = releaseFixture(t, archive)
    const result = await updater.check()
    assert.equal(result.canUpdate, false)
    assert.match(result.reason, /protected path/)
    await assert.rejects(updater.apply(result.target), /请先检查/)
    for (const [file, text] of original) assert.equal(readFileSync(path.join(root, file), 'utf8'), text)
  }
})

test('comparePluginVersions 按段比较，忽略多余段', () => {
  assert.equal(comparePluginVersions('2.8.0', '2.8.0'), 0)
  assert.equal(comparePluginVersions('2.8.1', '2.8.0'), 1)
  assert.equal(comparePluginVersions('2.8.0', '2.8.1'), -1)
  assert.equal(comparePluginVersions('2.10.0', '2.9.9'), 1)
  assert.equal(comparePluginVersions('3.0', '2.99.99'), 1)
  assert.equal(comparePluginVersions('2.8.0', '2.8'), 0)
})

test('内置副本不完整时报 unavailable，且不去碰数据目录', t => {
  const source = makeSource(t)
  rmSync(path.join(source.dir, 'client.js'))
  const data = makeData(t)
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'unavailable')
  assert.match(r.reason, /client\.js/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
})

test('全新安装：装进 plugins/<目录名>，核心文件齐全，契约仍在', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'installed')
  assert.equal(r.version, '2.8.0')
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'client.js']) {
    assert.ok(existsSync(path.join(target, file)), 'missing ' + file)
  }
  const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.tavern.sceneImages, 'delegate')
  // BUNDLED-VERSION.json 是仓库侧标记，不装给用户
  assert.equal(existsSync(path.join(target, 'BUNDLED-VERSION.json')), false)
})

test('重复安装同版本：跳过，不重写文件', t => {
  const source = makeSource(t)
  const data = makeData(t)
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'installed')
  const marker = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER, 'lib', 'index.js')
  writeFileSync(marker, 'export const handwritten = true\n')  // 模拟用户/插件自己更新过
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.match(readFileSync(marker, 'utf8'), /handwritten/)
})

test('已存在的较新插件目录：完整保留', t => {
  const source = makeSource(t, '2.8.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '9.0.0', main: './lib/index.js', dsh: CONTRACT }))
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.equal(r.installedVersion, '9.0.0')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '9.0.0')
})

test('3.0.2 就地升级：更新代码，同时完整保留私人数据与工作流', t => {
  const source = makeSource(t, '3.1.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(path.join(target, 'lib'), { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.2', main: './lib/index.js', dsh: CONTRACT }))
  writeFileSync(path.join(target, 'lib', 'index.js'), 'export const old = true\n')
  writeFileSync(path.join(target, 'lib', 'removed-upstream.js'), '// old helper\n')
  // 用户的私人数据：升级必须保留
  const userFiles = {
    'config.json': '{"apiKey":"user-own"}',
    'worldbook.json': '{"entries":[]}',
    'definitions.json': '{"characters":[]}',
    'jobs-store.json': '{"jobs":[]}',
    'plans-store.json': '{"plans":[]}',
    '.tavern-disabled': '',
  }
  for (const [name, body] of Object.entries(userFiles)) writeFileSync(path.join(target, name), body)
  mkdirSync(path.join(target, 'cache'), { recursive: true })
  mkdirSync(path.join(target, 'backups'), { recursive: true })
  mkdirSync(path.join(target, 'workflows'), { recursive: true })
  writeFileSync(path.join(target, 'cache', 'private.json'), 'cache')
  writeFileSync(path.join(target, 'backups', 'private.json'), 'backup')
  writeFileSync(path.join(target, 'workflows', 'custom.json'), '{"custom":true}')
  writeFileSync(path.join(target, 'workflows', 'edited-seed.json'), '{"edited":true}')
  // A bundled workflow deleted by the user must stay deleted after upgrade.
  rmSync(path.join(target, 'workflows', 'seed-deleted.json'), { force: true })

  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'upgraded')
  assert.equal(r.installedVersion, '3.0.2')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.1.0')
  assert.match(readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), /bundled/)
  assert.ok(existsSync(path.join(target, 'client.js')))
  for (const [name, body] of Object.entries(userFiles)) {
    assert.equal(readFileSync(path.join(target, name), 'utf8'), body, 'user data changed: ' + name)
  }
  assert.equal(readFileSync(path.join(target, 'cache', 'private.json'), 'utf8'), 'cache')
  assert.equal(readFileSync(path.join(target, 'backups', 'private.json'), 'utf8'), 'backup')
  assert.equal(readFileSync(path.join(target, 'workflows', 'custom.json'), 'utf8'), '{"custom":true}')
  assert.equal(readFileSync(path.join(target, 'workflows', 'edited-seed.json'), 'utf8'), '{"edited":true}')
  assert.equal(existsSync(path.join(target, 'workflows', 'seed-deleted.json')), false)
  assert.ok(existsSync(path.join(target, 'lib', 'removed-upstream.js')), '不删任何已有文件')
  assert.deepEqual(readdirSync(path.join(data, 'plugins')).sort(), [BUNDLED_SCENE_IMAGE_FOLDER], '临时目录和备份都清理掉')
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'skipped', '升级后再装是同版本，跳过')
})

test('3.1.0 就地升级到 3.1.1：替换修复代码，保留私人数据与工作流，重复安装跳过', t => {
  const source = makeSource(t, '3.1.1')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(path.join(target, 'lib'), { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.0', main: './lib/index.js', dsh: CONTRACT }))
  writeFileSync(path.join(target, 'lib', 'index.js'), 'export const oldFixes = true\n')
  writeFileSync(path.join(target, 'client.js'), '// old client\n')
  writeFileSync(path.join(target, 'config.json'), '{"apiKey":"private"}')
  mkdirSync(path.join(target, 'workflows'), { recursive: true })
  writeFileSync(path.join(target, 'workflows', 'custom.json'), '{"custom":true}')

  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'upgraded')
  assert.equal(result.version, '3.1.1')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.1.1')
  assert.match(readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), /bundled/)
  assert.equal(readFileSync(path.join(target, 'client.js'), 'utf8'), '// client\n')
  assert.equal(readFileSync(path.join(target, 'config.json'), 'utf8'), '{"apiKey":"private"}')
  assert.equal(readFileSync(path.join(target, 'workflows', 'custom.json'), 'utf8'), '{"custom":true}')

  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'skipped')
})

test('未知来源、Git 检出、更新版本和版本未知：不升级', t => {
  const source = makeSource(t, '2.8.0')
  for (const [setup, reason] of [
    [target => mkdirSync(path.join(target, '.git')), /Git/],
    [target => writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: LEGACY_SCENE_IMAGE_PACKAGE_NAME, version: '1.0.0' })), /不是可识别/],
  ]) {
    const data = makeData(t)
    const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '2.7.0', main: './lib/index.js', dsh: CONTRACT }))
    setup(target)
    const before = readFileSync(path.join(target, 'package.json'), 'utf8')
    const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
    assert.equal(r.action, 'skipped')
    assert.match(r.reason, reason)
    assert.equal(readFileSync(path.join(target, 'package.json'), 'utf8'), before)
    assert.equal(existsSync(path.join(target, 'client.js')), false)
  }
})

test('升级替换中途失败：已替换文件回滚且临时备份清理', t => {
  const source = makeSource(t, '3.1.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(path.join(target, 'lib'), { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.2', main: './lib/index.js', dsh: CONTRACT }))
  writeFileSync(path.join(target, 'client.js'), 'old client\n')
  writeFileSync(path.join(target, 'cordis.patch.yml'), 'old patch\n')
  writeFileSync(path.join(target, 'lib', 'index.js'), 'old entry\n')
  writeFileSync(path.join(target, 'config.json'), 'private config\n')
  const moduleUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/bundled-scene-image-plugin.mjs')).href
  const child = `
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import path from 'node:path'
    import { syncBuiltinESMExports } from 'node:module'
    import { installBundledSceneImagePlugin } from ${JSON.stringify(moduleUrl)}
    const [sourceRoot, dataRoot] = process.argv.slice(1)
    const target = path.join(dataRoot, 'plugins', ${JSON.stringify(BUNDLED_SCENE_IMAGE_FOLDER)})
    const originalRename = fs.renameSync
    let failed = false
    fs.renameSync = (from, to) => {
      if (!failed && String(from).includes(path.join('lib', 'index.js')) && path.resolve(to) === path.join(target, 'lib', 'index.js')) {
        failed = true
        const error = new Error('injected replace failure')
        error.code = 'EIO'
        throw error
      }
      return originalRename(from, to)
    }
    syncBuiltinESMExports()
    assert.throws(() => installBundledSceneImagePlugin({ sourceRoot, dataRoot, logger: { warn() {} } }), /injected replace failure/)
    assert.equal(fs.readFileSync(path.join(target, 'package.json'), 'utf8').includes('3.0.2'), true)
    assert.equal(fs.readFileSync(path.join(target, 'client.js'), 'utf8'), 'old client\\n')
    assert.equal(fs.readFileSync(path.join(target, 'cordis.patch.yml'), 'utf8'), 'old patch\\n')
    assert.equal(fs.readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), 'old entry\\n')
    assert.equal(fs.readFileSync(path.join(target, 'config.json'), 'utf8'), 'private config\\n')
    assert.deepEqual(fs.readdirSync(path.join(dataRoot, 'plugins')).filter(name => name.startsWith('.dsh-tavern-image-')), [])
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, source.root, data], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('升级遇到 workflows 私人目录链接：保留链接和链接目标内容', t => {
  const source = makeSource(t, '3.1.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const outside = path.join(data, 'private-workflows')
  mkdirSync(path.join(target, 'lib'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.2', main: './lib/index.js', dsh: CONTRACT }))
  writeFileSync(path.join(target, 'lib', 'index.js'), 'old entry\n')
  writeFileSync(path.join(outside, 'custom.json'), 'private workflow\n')
  symlinkSync(outside, path.join(target, 'workflows'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'upgraded')
  assert.equal(readFileSync(path.join(outside, 'custom.json'), 'utf8'), 'private workflow\n')
  assert.equal(readFileSync(path.join(target, 'workflows', 'custom.json'), 'utf8'), 'private workflow\n')
})

test('升级遇到 lib junction：拒绝更新且不写入插件目录外', t => {
  const source = makeSource(t, '3.1.0')
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const outside = path.join(data, 'private-lib')
  mkdirSync(target, { recursive: true })
  mkdirSync(outside)
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.2', main: './lib/index.js', dsh: CONTRACT }))
  writeFileSync(path.join(outside, 'index.js'), 'external private code\n')
  symlinkSync(outside, path.join(target, 'lib'), process.platform === 'win32' ? 'junction' : 'dir')

  const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'skipped')
  assert.match(result.reason, /符号链接或 junction/)
  assert.equal(readFileSync(path.join(outside, 'index.js'), 'utf8'), 'external private code\n')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.0.2')
  assert.ok(existsSync(path.join(target, 'lib')))
  assert.deepEqual(readdirSync(path.join(data, 'plugins')).sort(), [BUNDLED_SCENE_IMAGE_FOLDER])
})

test('profile 已装旧名包且目标已存在：跳过并提示真实数据备份位置', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const profile = path.join(data, 'profile')
  const installed = path.join(profile, 'node_modules', LEGACY_SCENE_IMAGE_PACKAGE_NAME)
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: LEGACY_SCENE_IMAGE_PACKAGE_NAME, version: '2.8.0' }))
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.2' }))

  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, profileDir: profile, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.match(r.reason, /单一来源/)
  assert.deepEqual(r.profilePackage, { name: LEGACY_SCENE_IMAGE_PACKAGE_NAME, version: '2.8.0' })
  assert.match(r.hint, /MIGRATION\.md/)
  assert.match(r.hint, /实际位置并备份整个真实数据目录/)
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.0.2')
})

test('profile 已装 canonical 包：跳过，避免同一插件重复来源', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const profile = path.join(data, 'profile')
  const installed = path.join(profile, 'node_modules', SCENE_IMAGE_PACKAGE_NAME)
  mkdirSync(installed, { recursive: true })
  writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '2.9.1' }))

  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, profileDir: profile, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.match(r.reason, /单一来源/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
})

test('profile 迁移提示只针对 legacy、未知版本或较旧 canonical 包（覆盖目标目录有无）', t => {
  const cases = [
    { name: LEGACY_SCENE_IMAGE_PACKAGE_NAME, version: '3.1.0', hint: true },
    { name: SCENE_IMAGE_PACKAGE_NAME, version: undefined, hint: true },
    { name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.9', hint: true },
    { name: SCENE_IMAGE_PACKAGE_NAME, version: '3.1.0', hint: false },
    { name: SCENE_IMAGE_PACKAGE_NAME, version: '3.2.0', hint: false },
  ]

  for (const hasTarget of [false, true]) {
    for (const profileCase of cases) {
      const source = makeSource(t, '3.1.0')
      const data = makeData(t)
      const profile = path.join(data, 'profile')
      const installed = path.join(profile, 'node_modules', profileCase.name)
      mkdirSync(installed, { recursive: true })
      writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: profileCase.name, ...(profileCase.version ? { version: profileCase.version } : {}) }))
      const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
      if (hasTarget) {
        mkdirSync(target, { recursive: true })
        writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '3.0.0' }))
      }

      const result = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, profileDir: profile, logger: quiet })
      assert.equal(result.action, 'skipped')
      assert.deepEqual(result.profilePackage, { name: profileCase.name, version: profileCase.version ?? null })
      assert.equal('hint' in result, profileCase.hint, `${profileCase.name} ${profileCase.version ?? '(unknown)'}, target exists: ${hasTarget}`)
    }
  }
})

test('readBundledSceneImage 校验版本标记、包名和委派契约', t => {
  const source = makeSource(t, '2.8.3')
  const info = readBundledSceneImage(source.root)
  assert.equal(info.ok, true)
  assert.equal(info.version, '2.8.3')
  assert.equal(info.contract, 'delegate')
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '9.0.0' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: 'wrong-name', version: '2.8.3' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
  writeFileSync(path.join(source.dir, 'BUNDLED-VERSION.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '2.8.3' }))
  writeFileSync(path.join(source.dir, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: '2.8.3', main: './lib/index.js' }))
  assert.equal(readBundledSceneImage(source.root).ok, false)
})

test('已存在残缺目录或符号链接：跳过且不触碰目标', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target)
  writeFileSync(path.join(target, 'keep.txt'), 'user data')
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }).action, 'skipped')
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'user data')

  const other = makeData(t)
  const linkedTarget = path.join(other, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const outside = path.join(other, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'keep.txt'), 'linked data')
  symlinkSync(outside, linkedTarget, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: other, logger: quiet }).action, 'skipped')
  assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'linked data')
})

test('已存在版本未知的插件目录：不尝试修复或覆盖', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const target = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  mkdirSync(target)
  writeFileSync(path.join(target, 'package.json'), '{ invalid json')
  writeFileSync(path.join(target, 'config.json'), '{"apiKey":"keep"}')
  const r = installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet })
  assert.equal(r.action, 'skipped')
  assert.equal(readFileSync(path.join(target, 'package.json'), 'utf8'), '{ invalid json')
  assert.equal(readFileSync(path.join(target, 'config.json'), 'utf8'), '{"apiKey":"keep"}')
})

test('复制遇到内置符号链接失败时清理临时目录且目标仍不存在', t => {
  const source = makeSource(t)
  const linkedDirectory = path.join(source.root, 'linked-source')
  mkdirSync(linkedDirectory)
  symlinkSync(linkedDirectory, path.join(source.dir, 'linked-directory'), process.platform === 'win32' ? 'junction' : 'dir')
  const data = makeData(t)
  assert.throws(() => installBundledSceneImagePlugin({ sourceRoot: source.root, dataRoot: data, logger: quiet }), /符号链接/)
  assert.equal(existsSync(path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)), false)
  assert.deepEqual(readdirSync(path.join(data, 'plugins')), [])
})

test('rename 目标被并发创建的非空目录占用时跳过并清理 staging', t => {
  const source = makeSource(t)
  const data = makeData(t)
  const moduleUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/bundled-scene-image-plugin.mjs')).href
  const child = `
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import path from 'node:path'
    import { syncBuiltinESMExports } from 'node:module'
    import { installBundledSceneImagePlugin } from ${JSON.stringify(moduleUrl)}
    const [sourceRoot, dataRoot] = process.argv.slice(1)
    const target = path.join(dataRoot, 'plugins', ${JSON.stringify(BUNDLED_SCENE_IMAGE_FOLDER)})
    const originalRename = fs.renameSync
    let injected = false
    fs.renameSync = (from, to) => {
      if (!injected && path.resolve(to) === path.resolve(target)) {
        injected = true
        fs.mkdirSync(target)
        fs.writeFileSync(path.join(target, 'winner.txt'), 'winner')
      }
      return originalRename(from, to)
    }
    syncBuiltinESMExports()
    const result = installBundledSceneImagePlugin({ sourceRoot, dataRoot, logger: { warn() {} } })
    assert.equal(injected, true, 'the real renameSync call reached the race hook')
    assert.equal(result.action, 'skipped')
    assert.equal(fs.readFileSync(path.join(target, 'winner.txt'), 'utf8'), 'winner')
    assert.deepEqual(fs.readdirSync(path.join(dataRoot, 'plugins')).filter(name => name.startsWith('.dsh-tavern-image-')), [])
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, source.root, data], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('真实发行副本：完整安装、入口可加载且默认不创建私有配置', async t => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const bundled = path.join(sourceRoot, 'tavern-plugin', 'packages', 'dsh-tavern-image-bundled')
  const marker = JSON.parse(readFileSync(path.join(bundled, 'BUNDLED-VERSION.json'), 'utf8'))
  const info = readBundledSceneImage(sourceRoot)
  assert.equal(info.ok, true, info.reason)
  assert.equal(info.packageName, marker.name)
  assert.equal(info.version, marker.version)

  const data = makeData(t)
  const result = installBundledSceneImagePlugin({ sourceRoot, dataRoot: data, logger: quiet })
  assert.equal(result.action, 'installed')
  assert.equal(result.version, marker.version)
  const installed = path.join(data, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
  const pkg = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(pkg.name, marker.name)
  assert.equal(pkg.version, marker.version)
  assert.equal(pkg.dsh.tavern.sceneImages, 'delegate')
  assert.equal(existsSync(path.join(installed, 'config.json')), false)
  assert.equal(existsSync(path.join(installed, 'BUNDLED-VERSION.json')), false)

  function countInstalledFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
      if (entry.name === 'node_modules') return count
      const entryPath = path.join(directory, entry.name)
      return count + (entry.isDirectory() ? countInstalledFiles(entryPath) : 1)
    }, 0)
  }
  assert.equal(result.files, countInstalledFiles(installed))
  const entry = await import(pathToFileURL(path.join(installed, 'lib', 'index.js')).href)
  assert.equal(entry.name, 'dsh-tavern-image')
  assert.equal(typeof entry.apply, 'function')

  const configPath = path.join(installed, 'config.json')
  const userConfig = '{"imageChannels":[],"private":"preserve-me"}\n'
  writeFileSync(configPath, userConfig)
  const repeated = installBundledSceneImagePlugin({ sourceRoot, dataRoot: data, logger: quiet })
  assert.equal(repeated.action, 'skipped')
  assert.equal(readFileSync(configPath, 'utf8'), userConfig)
})

test('真实 3.4.1 发行副本升级旧版本：保留用户数据和删除状态，重复安装跳过', t => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = path.join(sourceRoot, 'tavern-plugin', 'packages', 'dsh-tavern-image-bundled')
  const info = readBundledSceneImage(sourceRoot)
  assert.equal(info.ok, true, info.reason)
  assert.equal(info.version, '3.4.1')
  for (const installedVersion of ['3.1.9', '3.2.1', '3.3.0', '3.3.1', '3.4.0']) {
    const dataRoot = makeData(t)
    const target = path.join(dataRoot, 'plugins', BUNDLED_SCENE_IMAGE_FOLDER)
    mkdirSync(path.join(target, 'lib'), { recursive: true })
    writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: SCENE_IMAGE_PACKAGE_NAME, version: installedVersion, main: './lib/index.js', dsh: CONTRACT }))
    writeFileSync(path.join(target, 'lib', 'index.js'), '// previous ' + installedVersion + ' code\n')
    writeFileSync(path.join(target, 'client.js'), '// previous client\n')
    const referenceId = 'b'.repeat(64), outfitReferenceId = 'c'.repeat(64)
    const preserved = privateData(target, 'existing-private-' + installedVersion)
    preserved.push(
      ['config.json', '{"imageChannels":[{"id":"custom","provider":"custom","apiKey":"local-secret"}],"comfyAuthToken":"local-token"}\n'],
      ['definitions.json', '{"characters":[{"id":"character","referenceImage":{"id":"' + referenceId + '"},"outfits":[{"id":"outfit","referenceImage":{"id":"' + outfitReferenceId + '"}}]}]}\n'],
      ['reference-images/' + referenceId, 'immutable-reference-bytes-' + installedVersion],
      ['reference-images/' + outfitReferenceId, 'immutable-outfit-reference-' + installedVersion],
      ['jobs-store.json', '{"jobs":[{"referenceSnapshot":[{"image":{"id":"' + referenceId + '"}},{"image":{"id":"' + outfitReferenceId + '"}}]}]}\n'],
      ['workflows/custom.json', '{"custom":true}\n'],
    )
    for (const [file, text] of preserved) {
      mkdirSync(path.dirname(path.join(target, file)), { recursive: true })
      writeFileSync(path.join(target, file), text)
    }
    const options = { sourceRoot, dataRoot, logger: quiet }
    const result = installBundledSceneImagePlugin(options)
    assert.equal(result.action, 'upgraded', installedVersion)
    assert.equal(result.installedVersion, installedVersion)
    assert.equal(result.version, '3.4.1')
    assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version, '3.4.1')
    for (const file of [
      'lib/index.js', 'lib/reference-images.js', 'lib/format-worldbooks.js',
      'lib/image-channels.js', 'lib/image-provider-capabilities.js', 'lib/image-providers.js',
      'lib/comfy-reference-images.js', 'client.js',
    ]) {
      assert.deepEqual(readFileSync(path.join(target, file)), readFileSync(path.join(source, file)), 'current release code: ' + file)
    }
    for (const [file, text] of preserved) assert.equal(readFileSync(path.join(target, file), 'utf8'), text, 'private data changed: ' + file)
    assert.equal(existsSync(path.join(target, 'workflows', 'seed-deleted.json')), false, 'a removed bundled workflow stays removed')
    assert.equal(existsSync(path.join(target, 'BUNDLED-VERSION.json')), false)
    const repeated = installBundledSceneImagePlugin(options)
    assert.equal(repeated.action, 'skipped')
    assert.equal(repeated.installedVersion, '3.4.1')
    for (const [file, text] of preserved) assert.equal(readFileSync(path.join(target, file), 'utf8'), text, 'private data changed on repeat: ' + file)
    assert.deepEqual(readdirSync(path.join(dataRoot, 'plugins')), [BUNDLED_SCENE_IMAGE_FOLDER])
  }
})
