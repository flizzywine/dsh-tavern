import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createAssetPacks, packMediaType } from '../tavern-plugin/lib/domain/asset-packs.js'
import { readCardArchive } from '../tavern-plugin/lib/domain/card-archive.js'
import { createUploads } from '../tavern-plugin/lib/domain/uploads.js'
import { openZipFile, zipEntryPath } from '../tavern-plugin/lib/domain/zip-file.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082', 'hex')
const crc32 = data => { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1 } return (value ^ 0xffffffff) >>> 0 }

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dshcard-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
async function zipFile(dir, name, entries) {
  const file = join(dir, name)
  await writeFile(file, writeZipEntries(Object.entries(entries).map(([path, content]) => ({ path, content: typeof content === 'string' ? content : Buffer.from(content) }))))
  return file
}
function memoryStore() {
  const files = new Map()
  return { files, async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined }, async writeJson(path, value) { files.set(path, JSON.stringify(value)) } }
}

// A ZIP64 archive by hand: one deflated entry whose sizes and offset live in the ZIP64 extra field.
function zip64(name, content) {
  const data = Buffer.from(content), packed = deflateRawSync(data), nameBytes = Buffer.from(name)
  const extra = Buffer.alloc(4 + 24); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2)
  extra.writeBigUInt64LE(BigInt(data.length), 4); extra.writeBigUInt64LE(BigInt(packed.length), 12); extra.writeBigUInt64LE(0n, 20)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14)
  local.writeUInt32LE(0xffffffff, 18); local.writeUInt32LE(0xffffffff, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(extra.length, 28)
  const head = Buffer.concat([local, nameBytes, extra, packed])
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(45, 4); central.writeUInt16LE(45, 6); central.writeUInt16LE(8, 10)
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(0xffffffff, 20); central.writeUInt32LE(0xffffffff, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(0xffffffff, 42)
  const directory = Buffer.concat([central, nameBytes, extra])
  const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14)
  record.writeBigUInt64LE(1n, 24); record.writeBigUInt64LE(1n, 32); record.writeBigUInt64LE(BigInt(directory.length), 40); record.writeBigUInt64LE(BigInt(head.length), 48)
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(head.length + directory.length), 8); locator.writeUInt32LE(1, 16)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([head, directory, record, locator, end])
}

test('从磁盘读 ZIP：逐个流式解压并校验，ZIP64 能读，越界路径跳过，内容被改坏时报错', async t => {
  const dir = await temp(t)
  const file = await zipFile(dir, 'a.zip', { 'card.json': '{"a":1}', 'assets/p/x.txt': 'hello'.repeat(1000), '../evil.txt': 'no', 'dir/../../up.txt': 'no' })
  const zip = await openZipFile(file)
  assert.deepEqual([...zip.entries.keys()].sort(), ['assets/p/x.txt', 'card.json'])
  assert.equal((await zip.readBuffer(zip.entries.get('assets/p/x.txt'))).toString(), 'hello'.repeat(1000))
  await assert.rejects(zip.readBuffer(zip.entries.get('assets/p/x.txt'), 10), /超过/)
  await zip.close()
  assert.equal(zipEntryPath('a/./b.png'), 'a/b.png')
  assert.equal(zipEntryPath('/etc/passwd'), null)

  const bytes = await readFile(file)
  const at = bytes.indexOf(Buffer.from('{"a":1}'))
  bytes[at + 5] = 0x32
  await writeFile(join(dir, 'bad.zip'), bytes)
  const bad = await openZipFile(join(dir, 'bad.zip'))
  await assert.rejects(bad.readBuffer(bad.entries.get('card.json')), /校验和不一致/)
  await bad.close()

  await writeFile(join(dir, 'z64.zip'), zip64('dsh.json', '{"format":"dshcard"}'))
  const big = await openZipFile(join(dir, 'z64.zip'))
  assert.equal((await big.readBuffer(big.entries.get('dsh.json'))).toString(), '{"format":"dshcard"}')
  await big.close()
})

test('素材包：每个文件按内容只存一份，同 id 同摘要的包直接复用；只按白名单直接提供', async t => {
  const dir = await temp(t)
  const store = memoryStore()
  const packs = createAssetPacks({ store, mediaStore: createMediaStore({ root: join(dir, 'asset-packs') }) })
  const file = await zipFile(dir, 'p.zip', { 'assets/fish/manifest.json': '{"id":"fish"}', 'assets/fish/media/a.png': PNG, 'assets/fish/media/b.png': PNG, 'assets/fish/x.html': '<script>1</script>', 'card.json': '{}' })
  const zip = await openZipFile(file)
  const first = await packs.importFromZip(zip, { prefix: 'assets/fish/', id: 'fish', format: 'dsh-asset-pack', title: '鱼', credits: ['manifest.json', 'missing.md'] })
  assert.equal(first.reused, false)
  assert.deepEqual(Object.keys(first.pack.files).sort(), ['manifest.json', 'media/a.png', 'media/b.png', 'x.html'])
  assert.equal(first.pack.files['media/a.png'].sha256, first.pack.files['media/b.png'].sha256, '同样内容只存一份')
  assert.deepEqual(first.pack.credits, ['manifest.json'])
  const again = await packs.importFromZip(zip, { prefix: 'assets/fish/', id: 'fish', contentHash: first.pack.contentHash })
  assert.equal(again.reused, true)
  await zip.close()
  const image = await packs.file('fish', first.pack.contentHash, 'media/a.png')
  assert.equal(image.mediaType, 'image/png')
  assert.equal(image.inline, true)
  assert.deepEqual(await readFile(image.path), PNG)
  const page = await packs.file('fish', first.pack.contentHash, 'x.html')
  assert.deepEqual([page.mediaType, page.inline], ['application/octet-stream', false], 'HTML 不直接显示')
  assert.equal(await packs.file('fish', first.pack.contentHash, '../card.json'), undefined)
  assert.equal(packMediaType('m.svg').inline, false)
  assert.equal(packMediaType('song.ogg').mediaType, 'audio/ogg')
})

test('卡档案：DSH 人物卡读清单和素材包，保留名与过新版本报错；分支卡包补上封面；普通 CHARX 照读', async t => {
  const dir = await temp(t)
  const card = { spec: 'chara_card_v3', data: { name: '鱼', assets: [{ type: 'emotion', uri: 'embeded://assets/fish/media/a.png', name: 'happy', ext: 'png' }] } }
  const dsh = { format: 'dshcard', formatVersion: 1, card: { version: '1.0.0', title: '鱼', author: 'a' }, requires: { tavernApi: 2 },
    plugins: [{ name: 'director', path: 'plugins/director', purpose: '导演' }],
    packs: [{ id: 'fish-1', title: '鱼', format: 'dsh-asset-pack', contentHash: 'a'.repeat(64), path: 'assets/fish/', credits: ['assets/fish/credits/C.md'] }] }
  let zip = await openZipFile(await zipFile(dir, 'a.dshcard', { 'card.json': JSON.stringify(card), 'dsh.json': JSON.stringify(dsh), 'assets/fish/media/a.png': PNG, 'assets/fish/credits/C.md': 'cc', 'plugins/director/package.json': JSON.stringify({ name: 'director', version: '1.0.0' }) }))
  const archive = await readCardArchive(zip)
  await zip.close()
  assert.equal(archive.kind, 'dshcard')
  assert.deepEqual(archive.packs, [{ prefix: 'assets/fish/', id: 'fish-1', contentHash: 'a'.repeat(64), format: 'dsh-asset-pack', title: '鱼', credits: ['credits/C.md'] }])
  assert.deepEqual(archive.plugins.map(plugin => plugin.name), ['director'])
  assert.deepEqual(archive.resolve('embeded://assets/fish/media/a.png'), PNG)
  assert.equal(archive.info.version, '1.0.0')

  zip = await openZipFile(await zipFile(dir, 'b.dshcard', { 'card.json': '{}', 'dsh.json': JSON.stringify({ ...dsh, packs: [{ id: 'x', path: 'assets/emotion/' }] }) }))
  await assert.rejects(readCardArchive(zip), /保留名/)
  await zip.close()
  zip = await openZipFile(await zipFile(dir, 'c.dshcard', { 'card.json': '{}', 'dsh.json': JSON.stringify({ ...dsh, formatVersion: 9 }) }))
  await assert.rejects(readCardArchive(zip), /请先更新 Tavern/)
  await zip.close()

  const bundle = { format: 'dsh-tavern-card-bundle', schemaVersion: 1, cover: { path: 'card/cover.png' }, dependencies: [{ packId: 'p1', contentHash: 'b'.repeat(64), embedded: true }] }
  zip = await openZipFile(await zipFile(dir, 'd.zip', { 'dsh-tavern-card-bundle.json': JSON.stringify(bundle), 'card/card.json': JSON.stringify({ spec: 'chara_card_v3', data: { name: '鱼' } }), 'card/cover.png': PNG,
    'packs/p1/manifest.json': JSON.stringify({ format: 'dsh-asset-pack', name: '本体', credits: ['credits/C.md'] }), 'packs/p1/credits/C.md': 'c' }))
  const fork = await readCardArchive(zip)
  await zip.close()
  assert.equal(fork.kind, 'bundle')
  assert.deepEqual(fork.packs[0], { prefix: 'packs/p1/', id: 'p1', contentHash: 'b'.repeat(64), format: 'dsh-asset-pack', title: '本体', credits: ['credits/C.md'] })
  assert.deepEqual(fork.card.data.assets[0], { type: 'icon', uri: 'embeded://card/cover.png', name: 'main', ext: 'png' })
  assert.deepEqual(fork.resolve('embeded://card/cover.png'), PNG)

  zip = await openZipFile(await zipFile(dir, 'e.charx', { 'card.json': JSON.stringify(card) }))
  assert.equal((await readCardArchive(zip)).kind, 'charx')
  await zip.close()
})

test('上传：原始请求体落盘，超过上限拒绝；取走后可删除，过期的会被清理', async t => {
  const dir = await temp(t)
  const uploads = createUploads({ root: dir, maxBytes: 10, maxAgeMs: 0 })
  const { id, size } = await uploads.receive(Readable.from([Buffer.from('12345')]))
  assert.equal(size, 5)
  const taken = await uploads.take(id)
  assert.equal(await readFile(taken.file, 'utf8'), '12345')
  await taken.remove()
  await assert.rejects(uploads.take(id), /不存在/)
  await assert.rejects(uploads.receive(Readable.from([Buffer.alloc(11)])), /超过/)
  await assert.rejects(uploads.take('../x'), /不存在/)
  const old = await uploads.receive(Readable.from([Buffer.from('1')]))
  await uploads.sweep(Date.now() + 1000)
  await assert.rejects(uploads.take(old.id), /不存在/)
})

test('卡内插件：导入时放在一边不加载；启用后进 plugins/；内容相同的多张卡共用一份，最后一张放手才删；同名不同内容拒绝；改名跟随', async t => {
  const { createCardPlugins } = await import('../tavern-plugin/lib/domain/card-plugins.js')
  const { existsSync } = await import('node:fs')
  const dir = await temp(t)
  const pluginsDir = join(dir, 'plugins')
  const plugins = createCardPlugins({ dataRoot: dir, pluginsDir })
  const file = await zipFile(dir, 'a.dshcard', { 'card.json': '{}', 'dsh.json': '{}', 'plugins/director/package.json': JSON.stringify({ version: '1.0.0', name: 'dsh-card-fish-director', exports: { '.': './index.mjs' } }), 'plugins/director/index.mjs': 'export function apply() {}' })
  const zip = await openZipFile(file)
  const staged = await plugins.stage(zip, { cardKey: 'k'.repeat(64), plugins: [{ name: 'director', path: 'plugins/director/', purpose: '导演' }] })
  await assert.rejects(plugins.stage(zip, { cardKey: 'k'.repeat(64), plugins: [{ path: 'plugins/../x/' }] }), /插件路径/)
  await zip.close()
  assert.deepEqual(staged.map(item => [item.folder, item.name, item.files, item.purpose]), [['director', 'dsh-card-fish-director', 2, '导演']])
  assert.match(staged[0].sha256, /^[0-9a-f]{64}$/)
  assert.equal(existsSync(pluginsDir), false, '导入时不加载')
  assert.equal((await plugins.scope()).size, 0)

  await plugins.enable({ cardKey: 'k'.repeat(64), cardPath: 'cards/鱼.png', plugins: staged })
  const scope = await plugins.scope()
  assert.deepEqual(scope.get('dsh-card-fish-director').cards, ['cards/鱼.png'])
  const folder = scope.get('dsh-card-fish-director').folder
  assert.match(await readFile(join(pluginsDir, folder, 'index.mjs'), 'utf8'), /apply/)

  // 同一张卡导入两份：内容相同的插件只装一份，两张卡共用；最后一张放手才删。
  await plugins.enable({ cardKey: 'j'.repeat(64), cardPath: 'cards/鱼 (1).png', plugins: staged })
  assert.deepEqual((await plugins.scope()).get('dsh-card-fish-director').cards, ['cards/鱼.png', 'cards/鱼 (1).png'])
  assert.deepEqual((await readdir(pluginsDir)).length, 1, '共用同一份安装')
  await plugins.disable({ cardPath: 'cards/鱼.png', plugins: staged })
  assert.deepEqual((await plugins.scope()).get('dsh-card-fish-director').cards, ['cards/鱼 (1).png'])
  assert.equal(existsSync(join(pluginsDir, folder)), true, '还有卡在用，不删')

  // 同名但内容不同（新版本、改过的副本）：宿主一个名字只能加载一份，拒绝并说明是哪张卡占着。
  const changed = [{ ...staged[0], sha256: 'f'.repeat(64) }]
  await assert.rejects(plugins.enable({ cardKey: 'k'.repeat(64), cardPath: 'cards/鱼.png', plugins: changed }), /同名插件.*鱼 \(1\)\.png.*内容不同/)

  // 卡改名：插件跟着走，暂存的副本也跟着走。
  await plugins.movePath('cards/鱼 (1).png', 'cards/大鱼.png')
  assert.deepEqual((await plugins.scope()).get('dsh-card-fish-director').cards, ['cards/大鱼.png'])
  await plugins.remove({ cardKey: 'j'.repeat(64), cardPath: 'cards/大鱼.png', plugins: staged })
  assert.equal(existsSync(join(pluginsDir, folder)), false, '最后一张卡放手后删除')
  assert.equal((await plugins.scope()).size, 0)

  // 同名的用户自装插件不让位。
  await mkdir(join(pluginsDir, 'mine'), { recursive: true })
  await writeFile(join(pluginsDir, 'mine', 'package.json'), JSON.stringify({ version: '1.0.0', name: 'dsh-card-fish-director' }))
  await assert.rejects(plugins.enable({ cardKey: 'k'.repeat(64), cardPath: 'cards/鱼.png', plugins: staged }), /同名插件.*plugins\/mine/)
  await rm(join(pluginsDir, 'mine'), { recursive: true })

  // 旧安装（按卡命名的目录，标记只写一张卡）照样认得，可以共用和停用。
  const legacy = join(pluginsDir, 'card-kkkkkkkkkk-director')
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'package.json'), JSON.stringify({ version: '1.0.0', name: 'dsh-card-fish-director' }))
  await writeFile(join(legacy, '.dsh-card.json'), JSON.stringify({ cardPath: 'cards/鱼.png', sha256: staged[0].sha256 }))
  await plugins.enable({ cardKey: 'j'.repeat(64), cardPath: 'cards/鱼 (1).png', plugins: staged })
  assert.deepEqual((await plugins.scope()).get('dsh-card-fish-director'), { cards: ['cards/鱼.png', 'cards/鱼 (1).png'], folder: 'card-kkkkkkkkkk-director' })
  await plugins.disable({ cardPath: 'cards/鱼.png', plugins: staged })
  await plugins.disable({ cardPath: 'cards/鱼 (1).png', plugins: staged })
  assert.equal(existsSync(legacy), false)

  await plugins.enable({ cardKey: 'k'.repeat(64), cardPath: 'cards/鱼.png', plugins: staged })
  await plugins.remove({ cardKey: 'k'.repeat(64), cardPath: 'cards/鱼.png', plugins: staged })
  assert.equal(existsSync(join(pluginsDir, folder)), false)
  assert.equal(existsSync(join(dir, 'card-plugins', 'k'.repeat(64))), false)
})

test('开局默认：dsh.json 指向包内预设，只认少数几项设置，其余忽略', async t => {
  const { startSettings } = await import('../tavern-plugin/lib/domain/card-archive.js')
  const dir = await temp(t)
  const dsh = { format: 'dshcard', formatVersion: 1, packs: [], plugins: [], defaults: { preset: 'presets/舞台.json',
    settings: { statusBarPlacement: 'body', backgroundTasks: { posture: true, variables: 'x' }, webSearch: false, backgroundModel: { provider: 'p' }, playerName: '作者' } } }
  const zip = await openZipFile(await zipFile(dir, 'a.dshcard', { 'card.json': '{"spec":"chara_card_v3","data":{"name":"鱼"}}', 'dsh.json': JSON.stringify(dsh), 'presets/舞台.json': '{"prompts":[]}' }))
  const archive = await readCardArchive(zip)
  await zip.close()
  assert.deepEqual(archive.defaults, { preset: { name: '舞台.json', text: '{"prompts":[]}' }, settings: { statusBarPlacement: 'body', backgroundTasks: { posture: true }, webSearchEnabled: false } })
  assert.equal(startSettings({ playerName: 'x' }), null)
  const bad = await openZipFile(await zipFile(dir, 'b.dshcard', { 'card.json': '{}', 'dsh.json': JSON.stringify({ ...dsh, defaults: { preset: '../x.json' } }) }))
  await assert.rejects(readCardArchive(bad), /defaults\.preset/)
  await bad.close()
})

test('素材包：插件用零散文件建包，与卡带的包同一存储；路径不安全、重复或空包时拒绝', async t => {
  const dir = await temp(t)
  const packs = createAssetPacks({ store: memoryStore(), mediaStore: createMediaStore({ root: join(dir, 'asset-packs') }) })
  const first = await packs.importFiles([{ path: 'bg/night.png', data: PNG }, { path: 'manifest.json', data: Buffer.from('{}') }], { id: 'stage-bg', format: 'my-director', title: '背景' })
  assert.equal(first.reused, false)
  assert.equal(first.pack.format, 'my-director')
  assert.deepEqual(await readFile((await packs.file('stage-bg', first.pack.contentHash, 'bg/night.png')).path), PNG)
  assert.equal((await packs.importFiles([{ path: 'manifest.json', data: Buffer.from('{}') }, { path: 'bg/night.png', data: PNG }], { id: 'stage-bg' })).reused, true, '内容相同就复用')
  for (const bad of ['../x.png', '/x.png', 'a/.hidden', 'a\\b.png', '']) await assert.rejects(packs.importFiles([{ path: bad, data: PNG }], { id: 'p' }), /路径无效/)
  await assert.rejects(packs.importFiles([{ path: 'a.png', data: PNG }, { path: 'a.png', data: PNG }], { id: 'p' }), /重复/)
  await assert.rejects(packs.importFiles([{ path: 'a.png', data: 'x' }], { id: 'p' }), /Uint8Array/)
  await assert.rejects(packs.importFiles([], { id: 'p' }), /空/)
})

for (const pkg of [null, [], { name: 'director' }, { name: 1, version: '1.0.0' }, { name: 'director', version: '' }, { name: 'director', version: ' ' }, { name: 'director', version: 1 }]) {
  test('card import rejects incomplete package identity: ' + JSON.stringify(pkg), async t => {
    const { createCardPlugins } = await import('../tavern-plugin/lib/domain/card-plugins.js')
    const dir = await temp(t)
    const plugins = createCardPlugins({ dataRoot: dir, pluginsDir: join(dir, 'plugins') })
    const zip = await openZipFile(await zipFile(dir, 'bad.dshcard', { 'plugins/director/package.json': JSON.stringify(pkg) }))
    t.after(() => zip.close())
    await assert.rejects(plugins.stage(zip, { cardKey: 'card', plugins: [{ path: 'plugins/director/' }] }), { code: 'TAVERN_CARD_PLUGIN_INVALID' })
    await assert.rejects(readdir(join(dir, 'plugins')), { code: 'ENOENT' })
  })
}

test('old staged manifests are checked before any installed plugin is replaced', async t => {
  const { createCardPlugins } = await import('../tavern-plugin/lib/domain/card-plugins.js')
  const dir = await temp(t), pluginsDir = join(dir, 'plugins')
  const plugins = createCardPlugins({ dataRoot: dir, pluginsDir })
  const zip = await openZipFile(await zipFile(dir, 'good.dshcard', { 'plugins/director/package.json': JSON.stringify({ name: 'director', version: '1.0.0' }) }))
  t.after(() => zip.close())
  const staged = await plugins.stage(zip, { cardKey: 'card', plugins: [{ path: 'plugins/director/' }] })
  await plugins.enable({ cardKey: 'card', cardPath: 'cards/a.json', plugins: staged })
  const folder = (await plugins.scope()).get('director').folder
  const original = await readFile(join(pluginsDir, folder, 'package.json'), 'utf8')
  await writeFile(join(dir, 'card-plugins/card/director/package.json'), '{"name":"director"}')
  await assert.rejects(plugins.enable({ cardKey: 'card', cardPath: 'cards/a.json', plugins: [{ ...staged[0], sha256: 'f'.repeat(64) }] }), /version/)
  assert.equal(await readFile(join(pluginsDir, folder, 'package.json'), 'utf8'), original)
  await writeFile(join(pluginsDir, folder, 'package.json'), '{"name":"director"}')
  await assert.rejects(plugins.enable({ cardKey: 'card', cardPath: 'cards/b.json', plugins: staged }), /version/)
  assert.deepEqual(JSON.parse(await readFile(join(pluginsDir, folder, '.dsh-card.json'), 'utf8')).cards, ['cards/a.json'])
})
