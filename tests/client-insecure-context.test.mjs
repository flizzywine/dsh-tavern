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
