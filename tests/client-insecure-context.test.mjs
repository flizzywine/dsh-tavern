import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFile } from 'node:fs/promises'

const executorSource = await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

for (const [name, crypto] of [['HTTP', {}], ['no crypto', undefined], ['HTTPS', { randomUUID: () => 'native-uuid' }]]) {
  test(`chat import creates a reusable operation identity: ${name}`, async () => {
    const statement = mainSource.match(/attempt = \{ operationId: [^\n]+/)[0]
    const scope = vm.createContext({ window: { crypto }, targetWorkspaceId: 'workspace', props: { conversationHost: { connectWorkspace: async id => `session:${id}` } } })
    const attempt = await vm.runInContext(`(async () => { let attempt; ${statement} return attempt; })()`, scope)
    assert.ok(attempt.operationId.length > 0)
    assert.equal(attempt.sessionId, 'session:workspace')
    if (crypto?.randomUUID) assert.equal(attempt.operationId, 'native-uuid')
    assert.equal(JSON.parse(JSON.stringify(attempt)).operationId, attempt.operationId)
  })
}

test('the main page installs the SHA-256 fallback when http on a LAN address has no crypto.subtle', async () => {
  assert.match(mainSource, /^\s*if \(typeof window !== "undefined"\) installTavernCryptoSubtlePolyfill\(window\);$/m)
  const polyfill = await readFile(new URL('../tavern-plugin/src/client/crypto-digest.js', import.meta.url), 'utf8')
  const page = { crypto: { getRandomValues: bytes => bytes } }
  vm.runInNewContext(polyfill + ';installTavernCryptoSubtlePolyfill(page)', { page, Uint8Array, DataView, ArrayBuffer, Promise })
  const digest = Buffer.from(await page.crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'))).toString('hex')
  assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
