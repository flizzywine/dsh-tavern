import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {openZip, writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'

// A card picture with its bundle appended (PNG bytes, then the ZIP) keeps the ZIP's offsets relative to the ZIP itself.
test('a ZIP behind a prefix (a PNG with the archive appended) opens with its entries at the shifted offsets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-prefix-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  const plain = path.join(root, 'plain.zip'), wrapped = path.join(root, 'card.png')
  await writeZip(plain, [{path:'card/card.json', data:Buffer.from('{"name":"灯塔"}')}, {path:'packs/a.zip', data:Buffer.alloc(4096, 7)}])
  const prefix = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(300, 1)])
  await fs.writeFile(wrapped, Buffer.concat([prefix, await fs.readFile(plain)]))
  const zip = await openZip(wrapped)
  assert.deepEqual(zip.entries.map(entry => entry.path), ['card/card.json', 'packs/a.zip'])
  assert.equal(String(await zip.read(zip.entries[0])), '{"name":"灯塔"}')
  assert.deepEqual(await zip.read(zip.entries[1]), Buffer.alloc(4096, 7))
  // Cut from the front: the central directory now points before the file start.
  const bytes = await fs.readFile(plain), cut = path.join(root, 'cut.zip')
  await fs.writeFile(cut, bytes.subarray(16))
  await assert.rejects(openZip(cut), /Invalid ZIP/)
})
