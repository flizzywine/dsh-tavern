import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
import { openCardZip, encryptCardArchiveFile, CARD_PASSWORD_REQUIRED, CARD_PASSWORD_INVALID } from '../tavern-plugin/lib/domain/card-encryption.js'
import { readCardArchive } from '../tavern-plugin/lib/domain/card-archive.js'
import { createCardHandlers } from '../tavern-plugin/lib/rpc/cards.js'
import { createUploads } from '../tavern-plugin/lib/domain/uploads.js'
import { createTransferExportStore } from '../tavern-plugin/lib/domain/transfer-store.js'
import { Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { createRequire } from 'node:module'
import { pngWithTextChunks, pngCardTextChunk } from '../tavern-plugin/lib/domain/card-assets.js'

const PASSWORD = '测试-only-password-123'
const COVER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8V8AAAAASUVORK5CYII=', 'base64')
const padding = pngCardTextChunk('padding', 'x'.repeat(100000))
padding.write('paDd', 4, 'ascii')
padding.writeUInt32BE(crc32(padding.subarray(4, -4)), padding.length - 4)
const LARGE_COVER = Buffer.concat([COVER.subarray(0, -12), padding, COVER.subarray(-12)])
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'card-encryption-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const entries = [
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Encrypted fixture', description: 'private card description' } }) },
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name: 'game', path: 'plugins/game/' }] }) },
    { path: 'plugins/game/package.json', content: JSON.stringify({ name: 'game', version: '1.0.0' }) },
    { path: 'plugins/game/assets/state.bin', content: Buffer.alloc(6 * 1024 * 1024, 0x5a) },
  ]
  const plain = path.join(dir, 'plain.dshcard'), encrypted = path.join(dir, 'encrypted.dshcard')
  await writeFile(plain, writeZipEntries(entries))
  return { dir, plain, encrypted, entries }
}

test('ordinary cards need no password; AES-256 cards require it and stream all original plugin bytes intact', async t => {
  const f = await fixture(t)
  const plain = await openCardZip(f.plain)
  assert.equal((await readCardArchive(plain)).card.data.name, 'Encrypted fixture')
  await plain.close()
  await encryptCardArchiveFile(f.plain, f.encrypted, PASSWORD)
  assert.equal((await readFile(f.encrypted)).includes(Buffer.from('private card description')), false)
  await assert.rejects(openCardZip(f.encrypted), { code: CARD_PASSWORD_REQUIRED })
  await assert.rejects(openCardZip(f.encrypted, { password: 'wrong' }), { code: CARD_PASSWORD_INVALID })
  const zip = await openCardZip(f.encrypted, { password: PASSWORD })
  try {
    assert.equal((await readCardArchive(zip)).plugins[0].name, 'game')
    for (const entry of f.entries) assert.deepEqual(await zip.readBuffer(zip.entries.get(entry.path)), Buffer.from(entry.content))
  } finally { await zip.close() }
})

test('failed encryption never overwrites an existing output, and a damaged authentication tag never imports', async t => {
  const f = await fixture(t)
  await writeFile(f.encrypted, 'keep existing file')
  await assert.rejects(encryptCardArchiveFile(f.plain, f.encrypted, PASSWORD), { code: 'EEXIST' })
  assert.equal(await readFile(f.encrypted, 'utf8'), 'keep existing file')
  await rm(f.encrypted)
  await encryptCardArchiveFile(f.plain, f.encrypted, PASSWORD)
  const metadata = await openZipFile(f.encrypted, { allowEncrypted: true })
  const first = metadata.entries.get('card.json')
  await metadata.close()
  const bytes = await readFile(f.encrypted)
  const start = first.localOffset + 30 + bytes.readUInt16LE(first.localOffset + 26) + bytes.readUInt16LE(first.localOffset + 28)
  bytes[start + first.compressedSize - 1] ^= 0x01
  await writeFile(f.encrypted, bytes)
  await assert.rejects(openCardZip(f.encrypted, { password: PASSWORD }), { code: CARD_PASSWORD_INVALID })
})

test('upload survives missing/wrong password retries, is removed after success, and can be cancelled explicitly', async t => {
  const f = await fixture(t)
  await encryptCardArchiveFile(f.plain, f.encrypted, PASSWORD)
  const uploads = createUploads({ root: f.dir })
  let imported = 0
  const handlers = createCardHandlers({ uploads, str: String, async importCardArchiveFile(file, name, options) {
    const zip = await openCardZip(file, options)
    try { const result = await readCardArchive(zip); imported++; return { name: result.card.data.name } } finally { await zip.close() }
  } })
  const { id } = await uploads.receive(Readable.from([await readFile(f.encrypted)]))
  const args = { uploadId: id, name: 'encrypted.dshcard' }
  await assert.rejects(handlers.importCardUpload(args), { code: CARD_PASSWORD_REQUIRED })
  await uploads.take(id)
  await assert.rejects(handlers.importCardUpload({ ...args, password: 'wrong' }), { code: CARD_PASSWORD_INVALID })
  assert.equal(imported, 0)
  await handlers.importCardUpload({ ...args, password: PASSWORD })
  assert.equal(imported, 1)
  await assert.rejects(uploads.take(id), /不存在/)
  const again = await uploads.receive(Readable.from([await readFile(f.encrypted)]))
  await handlers.discardCardUpload({ uploadId: again.id })
  await assert.rejects(uploads.take(again.id), /不存在/)
})

test('native encrypt upload produces a downloadable password-protected card without changing its contents', async t => {
  const f = await fixture(t), uploads = createUploads({ root: f.dir }), exports = createTransferExportStore({ root: path.join(f.dir, 'exports') })
  t.after(() => exports.close())
  const handlers = createCardHandlers({ uploads, transferExports: exports, str: String })
  const { id } = await uploads.receive(Readable.from([await readFile(f.plain)]))
  const result = await handlers.encryptCardUpload({ uploadId: id, name: 'fixture.dshcard', password: PASSWORD })
  assert.equal(result.filename, 'fixture-加密.dshcard')
  const stored = await exports.take(new URL(result.downloadUrl, 'http://localhost').searchParams.get('token'))
  await assert.rejects(openCardZip(stored.file), { code: CARD_PASSWORD_REQUIRED })
  const zip = await openCardZip(stored.file, { password: PASSWORD })
  assert.equal((await readCardArchive(zip)).card.data.name, 'Encrypted fixture')
  await zip.close()
  await assert.rejects(uploads.take(id), /不存在/)
})

test('encrypting the current library card again creates one new password layer and leaves the previous export intact', async t => {
  const f = await fixture(t), uploads = createUploads({ root: f.dir }), exports = createTransferExportStore({ root: path.join(f.dir, 'exports') })
  t.after(() => exports.close())
  let calls = 0
  const handlers = createCardHandlers({ uploads, transferExports: exports, str: String, async exportCardFile(cardPath) {
    assert.equal(cardPath, 'cards/current.json'); calls++
    return { name: 'Current card', file: f.plain, dispose: async () => {} }
  } })
  const first = await handlers.encryptLibraryCard({ path: 'cards/current.json', password: 'first-test-password' })
  const second = await handlers.encryptLibraryCard({ path: 'cards/current.json', password: 'second-test-password' })
  assert.equal(calls, 2)
  for (const [result, password] of [[first, 'first-test-password'], [second, 'second-test-password']]) {
    const stored = await exports.take(new URL(result.downloadUrl, 'http://localhost').searchParams.get('token'))
    await assert.rejects(openCardZip(stored.file), { code: CARD_PASSWORD_REQUIRED })
    const zip = await openCardZip(stored.file, { password })
    try {
      assert.equal((await readCardArchive(zip)).plugins[0].name, 'game')
      assert.equal((await readCardArchive(zip)).card.data.name, 'Encrypted fixture')
    } finally { await zip.close() }
  }
  const stored = await exports.take(new URL(second.downloadUrl, 'http://localhost').searchParams.get('token'))
  await assert.rejects(openCardZip(stored.file, { password: 'first-test-password' }), { code: CARD_PASSWORD_INVALID })
})

test('standard AES ZIP interoperability with 7-Zip in both directions', { skip: !process.env.TAVERN_7ZIP_TEST }, async t => {
  const f = await fixture(t)
  // 7-Zip's ZIP password mode restricts its CLI to ASCII; native Tavern Unicode passwords are tested above.
  const password = 'interop-password-123'
  await encryptCardArchiveFile(f.plain, f.encrypted, password)
  const testArchive = spawnSync(process.env.TAVERN_7ZIP_TEST, ['t', '-p' + password, f.encrypted], { encoding: 'utf8', windowsHide: true })
  assert.equal(testArchive.status, 0, testArchive.stderr)
  const source = path.join(f.dir, 'source')
  await mkdir(source)
  await writeFile(path.join(source, 'card.json'), '{"data":{"name":"external"}}')
  const external = path.join(f.dir, 'external.charx')
  const pack = spawnSync(process.env.TAVERN_7ZIP_TEST, ['a', '-tzip', '-mem=AES256', '-p' + password, external, 'card.json'], { cwd: source, encoding: 'utf8', windowsHide: true })
  assert.equal(pack.status, 0, pack.stderr)
  const zip = await openCardZip(external, { password })
  assert.equal((await readCardArchive(zip)).card.data.name, 'external')
  await zip.close()
})

test('ordinary PNG stores its cover and embedded assets inside encrypted DSH and keeps them through decryption', async t => {
  const f = await fixture(t), input = path.join(f.dir, 'normal.png'), output = path.join(f.dir, 'covered.dshcard')
  const card = { spec: 'chara_card_v2', data: { name: 'ST private name', description: 'secret prompt', extensions: { risuai: { emotions: [['happy', '__asset:1']] }, custom: { keep: true } } } }
  const png = pngWithTextChunks(LARGE_COVER, [pngCardTextChunk('chara', JSON.stringify(card)), pngCardTextChunk('chara-ext-asset_:1', COVER)])
  await writeFile(input, png)
  await encryptCardArchiveFile(input, output, PASSWORD, { name: 'normal.png' })
  const bytes = await readFile(output)
  assert.equal(bytes.readUInt32LE(0), 0x04034b50)
  assert.equal(bytes.includes(Buffer.from('secret prompt')), false)
  await assert.rejects(openCardZip(output), { code: CARD_PASSWORD_REQUIRED })
  const zip = await openCardZip(output, { password: PASSWORD })
  try {
    const archive = await readCardArchive(zip)
    assert.deepEqual(archive.resolve(archive.card.data.assets[0].uri), LARGE_COVER)
    assert.equal(archive.card.data.description, 'secret prompt')
    assert.equal(archive.card.data.extensions.custom.keep, true)
    assert.deepEqual(archive.resolve(archive.card.data.extensions.risuai.emotions[0][1]), COVER)
  } finally { await zip.close() }
  const decrypted = path.join(f.dir, 'decrypted.dshcard')
  await encryptCardArchiveFile(output, decrypted, PASSWORD, { name: 'covered.dshcard', decrypt: true })
  const plain = await openCardZip(decrypted)
  try { assert.equal((await readCardArchive(plain)).card.data.name, 'ST private name'); assert.equal(plain.prefix, 0) } finally { await plain.close() }
  if (process.env.TAVERN_7ZIP_TEST) {
    // Use an ASCII password for external ZIP tools.
    const ascii = path.join(f.dir, 'ascii.dshcard')
    await encryptCardArchiveFile(input, ascii, 'cover-test', { name: 'normal.png' })
    const check = spawnSync(process.env.TAVERN_7ZIP_TEST, ['t', '-pcover-test', ascii], { encoding: 'utf8', windowsHide: true })
    assert.equal(check.status, 0, check.stdout + check.stderr)
  }
})

test('JSON with or without a cover exports only DSH, and decrypt retries keep the upload', async t => {
  const f = await fixture(t), uploads = createUploads({ root: f.dir }), exports = createTransferExportStore({ root: path.join(f.dir, 'exports') })
  t.after(() => exports.close())
  const handlers = createCardHandlers({ uploads, transferExports: exports, str: String })
  for (const covered of [false, true]) {
    const card = { name: 'ST v1', description: 'private v1', ...(covered ? { assets: [{ type: 'icon', name: 'main', uri: 'data:image/png;base64,' + COVER.toString('base64'), ext: 'png' }] } : {}) }
    const upload = await uploads.receive(Readable.from([Buffer.from(JSON.stringify(card))]))
    const result = await handlers.encryptCardUpload({ uploadId: upload.id, name: '普通卡.json', password: PASSWORD })
    assert.equal(result.filename, '普通卡-加密.dshcard')
    const stored = await exports.take(new URL(result.downloadUrl, 'http://localhost').searchParams.get('token'))
    const again = await uploads.receive(Readable.from([await readFile(stored.file)]))
    const args = { uploadId: again.id, name: result.filename }
    await assert.rejects(handlers.decryptCardUpload(args), { code: CARD_PASSWORD_REQUIRED })
    await assert.rejects(handlers.decryptCardUpload({ ...args, password: 'wrong' }), { code: CARD_PASSWORD_INVALID })
    await uploads.take(again.id)
    const plain = await handlers.decryptCardUpload({ ...args, password: PASSWORD })
    assert.ok(plain.filename.endsWith('.dshcard'))
    const decrypted = await exports.take(new URL(plain.downloadUrl, 'http://localhost').searchParams.get('token'))
    const zip = await openCardZip(decrypted.file)
    try { assert.equal((await readCardArchive(zip)).card.description, 'private v1') } finally { await zip.close() }
    await assert.rejects(uploads.take(again.id), /不存在/)
  }
})

test('JPEG and WebP covers retain their exact original bytes inside encrypted DSH', async t => {
  const f = await fixture(t), require = createRequire(import.meta.url)
  for (const kind of ['jpeg', 'webp']) {
    const encoder = await import('@jsquash/' + kind + '/encode.js')
    const wasm = kind === 'jpeg' ? 'mozjpeg_enc' : 'webp_enc'
    await encoder.init(await WebAssembly.compile(await readFile(require.resolve('@jsquash/' + kind + '/codec/enc/' + wasm + '.wasm'))))
    const image = Buffer.from(await encoder.default({ width: 1, height: 1, data: new Uint8ClampedArray([90, 120, 150, 255]) }))
    const input = path.join(f.dir, kind + '.json'), output = path.join(f.dir, kind + '.dshcard')
    const uri = 'data:image/' + kind + ';base64,' + image.toString('base64')
    await writeFile(input, JSON.stringify({ data: { name: kind, assets: [{ type: 'icon', name: 'main', uri, ext: kind }], extensions: { original: uri } } }))
    await encryptCardArchiveFile(input, output, PASSWORD, { name: kind + '.json' })
    assert.equal((await readFile(output)).readUInt32BE(0), 0x504b0304)
    const zip = await openCardZip(output, { password: PASSWORD })
    try {
      const card = (await readCardArchive(zip)).card
      assert.equal(card.data.assets[0].uri, uri)
      assert.equal(card.data.extensions.original, uri)
    } finally { await zip.close() }
  }
})
