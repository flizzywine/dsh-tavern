import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {randomId} = require('../tavern-plugin/packages/dsh-presentation-protocol/src/random-id.cjs')

test('http on a LAN address (no randomUUID) builds a v4 UUID from getRandomValues', () => {
  const insecure = {getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes)}
  const ids = new Set(Array.from({length: 200}, () => randomId(insecure)))
  assert.equal(ids.size, 200)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(randomId({getRandomValues: bytes => bytes.fill(0xff)}), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
})
