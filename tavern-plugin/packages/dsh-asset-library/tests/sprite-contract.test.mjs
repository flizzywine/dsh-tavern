import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// build.mjs copies the maintained client parser whole (since 0df8f0fb5) behind its generated header.
test('the shared layered sprite contract is the maintained client parser as build.mjs emits it', async () => {
  const source = await readFile(new URL('../../../src/client/layered-sprite.cjs', import.meta.url), 'utf8')
  const subset = await readFile(new URL('../src/shared/layered-sprite.cjs', import.meta.url), 'utf8')
  assert.equal(subset, '// Generated from client/layered-sprite.cjs by build.mjs; do not edit.\n' + source)
})
