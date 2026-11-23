// A frame its host sizes (frame-document hostSized: a stage card page) carries no height reporter, so a layout-changing
// mutation does not walk the whole document; other frames keep it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'

test('hostSized drops the height reporter and only it', async () => {
  let descriptor
  vm.runInNewContext(await readFile('tavern-plugin/lib/client.js', 'utf8'), {window: {__ModuleLoader__: {load(value) { descriptor = value }}}, console})
  const client = descriptor.factory(() => ({}))
  const content = '<p>页面</p>'
  const plain = client.buildTavernFrameDocument({content, token: 'plain'})
  const hosted = client.buildTavernFrameDocument({content, token: 'hosted', hostSized: true})
  assert.match(plain, /dsh-tavern-frame-height/)
  assert.doesNotMatch(hosted, /dsh-tavern-frame-height/)
  assert.match(hosted, /dsh-tavern-frame-ready/, 'the ready report stays')
})
