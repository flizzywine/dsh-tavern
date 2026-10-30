import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { crc32, deflateRawSync } from 'node:zlib'
import { openZip, writeZip } from '../src/zip.js'

async function fixture(t) { const root = await mkdtemp(path.join(tmpdir(), 'fork-zip-')); t.after(() => rm(root, { recursive: true, force: true })); return root }
// Independent descriptor fixture: the local header deliberately has zero sizes/CRC.
function descriptorZip(name, bytes) {
  const n = Buffer.from(name), compressed = deflateRawSync(bytes), local = Buffer.alloc(30), cd = Buffer.alloc(46), end = Buffer.alloc(22), descriptor = Buffer.alloc(16)
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(n.length, 26)
  descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc32(bytes), 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(bytes.length, 12)
  cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc32(bytes), 16); cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(bytes.length, 24); cd.writeUInt16LE(n.length, 28)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + compressed.length + 16, 16)
  return Buffer.concat([local, n, compressed, descriptor, cd, n, end])
}

test('streaming ZIP round trip: UTF-8 names, STORE, DEFLATE, empty and ratio-safe fallback', async t => {
  const root = await fixture(t), file = path.join(root, 'pack.zip')
  // DEFLATE-eligible entries must be non-empty, compressible, and under ZIP_LIMITS.ratio (200); ~4 KB of repeated text gives a ratio near 100.
  const repeated = (text, bytes) => Buffer.from(text.repeat(Math.ceil(bytes / text.length)).slice(0, bytes))
  const entries = [{ path: 'card/\u4eba\u7269.json', data: Buffer.from(JSON.stringify({ name: 'test', lines: Array(150).fill('tavern line') })) }, { path: 'assets/picture.png', data: Buffer.from('png bytes') }, { path: 'notes/repeat.txt', data: repeated('abcdefghijklmnopqrstuvwxyz\n', 4096) }, { path: 'zeros.txt', data: repeated('0123456789', 4096) }]
  await writeZip(file, entries)
  const archive = await openZip(file)
  assert.deepEqual(archive.entries.map(e => e.method), [8, 0, 8, 8])
  for (let i = 0; i < entries.length; i++) { assert.equal(archive.entries[i].path, entries[i].path); assert.deepEqual(await archive.read(archive.entries[i]), entries[i].data) }
  // Empty entries cannot beat STORE (a DEFLATE stream is >= 2 bytes), so they get their own round-trip check.
  const emptyFile = path.join(root, 'empty-only.zip')
  await writeZip(emptyFile, [{ path: 'empty.txt', data: Buffer.alloc(0) }])
  const empty = await openZip(emptyFile)
  assert.deepEqual(empty.entries.map(e => e.method), [0])
  assert.deepEqual(await empty.read(empty.entries[0]), Buffer.alloc(0))
})

test('reader accepts independent ASCII data-descriptor ZIP', async t => {
  const root = await fixture(t), file = path.join(root, 'descriptor.zip'), bytes = Buffer.from('hello descriptor')
  await writeFile(file, descriptorZip('hello.txt', bytes))
  const archive = await openZip(file); assert.deepEqual(await archive.read(archive.entries[0]), bytes)
})

test('reader accepts PowerShell Compress-Archive output (independent fixture fallback)', async t => {
  const root = await fixture(t), file = path.join(root, 'external.zip'), source = path.join(root, 'hello.txt')
  await writeFile(source, 'hello external zip')
  const command = `Compress-Archive -LiteralPath '${source.replaceAll("'", "''")}' -DestinationPath '${file.replaceAll("'", "''")}'`
  const result = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') await writeFile(file, descriptorZip('hello.txt', Buffer.from('hello external zip')))
  else assert.equal(result.status, 0, result.stderr)
  const archive = await openZip(file); assert.equal((await archive.read(archive.entries[0])).toString(), 'hello external zip')
})

test('ZIP rejects corruption, traversal/absolute paths, encryption, ZIP64, unsupported method and limits', async t => {
  const root = await fixture(t), source = path.join(root, 'source.zip')
  await writeZip(source, [{ path: 'safe/file.png', data: Buffer.from('test contents') }])
  const original = await readFile(source), cd = original.indexOf(Buffer.from('504b0102', 'hex'))
  const mutations = [
    ['crc', b => { b[30 + Buffer.byteLength('safe/file.png')] ^= 1 }, /CRC/],
    ['traversal', b => { b.write('../x/file.png', 30); b.write('../x/file.png', cd + 46) }, /path/],
    ['absolute', b => { b.write('/abs/file.png', 30); b.write('/abs/file.png', cd + 46) }, /path/],
    ['drive', b => { b.write('C:/x/file.png', 30); b.write('C:/x/file.png', cd + 46) }, /path/],
    ['encrypted', b => b.writeUInt16LE(0x801, cd + 8), /Encrypted/],
    ['zip64', b => b.writeUInt32LE(0xffffffff, cd + 24), /ZIP64/],
    ['method', b => b.writeUInt16LE(12, cd + 10), /method/],
    ['oversize', b => b.writeUInt32LE(513 * 1024 ** 2, cd + 24), /size/],
    ['ratio', b => b.writeUInt32LE(3000, cd + 24), /ratio/]
  ]
  for (const [name, mutate, pattern] of mutations) {
    const bytes = Buffer.from(original); mutate(bytes); const file = path.join(root, name + '.zip'); await writeFile(file, bytes)
    await assert.rejects(async () => { const zip = await openZip(file); await zip.read(zip.entries[0]) }, pattern, name)
  }
  await assert.rejects(openZip(source, { totalSize: 1 }), /size/)
  await assert.rejects(openZip(source, { entries: 0 }), /count/)
  await assert.rejects(writeZip(path.join(root, 'many.zip'), Array(65536).fill({})), /65535/)
  for (const name of ['../file', '/file', 'C:/file', 'x\\file', 'nul.txt', 'x/../file']) await assert.rejects(writeZip(path.join(root, 'bad.zip'), [{ path: name, data: Buffer.alloc(0) }]), /path/)
})
