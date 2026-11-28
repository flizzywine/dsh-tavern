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

// The content-height reset of the roots serves the reporter; a host-sized frame keeps the page's own root height, so a
// page centred with top: 50% (a stage performance page) centres in the frame, not on a zero-height root at its top edge.
test('hostSized keeps the page roots its own height', async () => {
  let descriptor
  vm.runInNewContext(await readFile('tavern-plugin/lib/client.js', 'utf8'), {window: {__ModuleLoader__: {load(value) { descriptor = value }}}, console})
  const client = descriptor.factory(() => ({}))
  const content = '<style>html,body{height:100%}</style><div style="position:absolute;top:50%">报告</div>'
  const plain = client.buildTavernFrameDocument({content, token: 'plain'}), hosted = client.buildTavernFrameDocument({content, token: 'hosted', hostSized: true})
  const adapter = doc => doc.match(/<style data-dsh-sillytavern-iframe-adapter>[^<]*/)[0]
  assert.match(plain, /content-roots/)
  assert.match(adapter(plain), /html,body\{[^}]*height:auto!important/)
  assert.doesNotMatch(hosted, /content-roots/)
  assert.doesNotMatch(adapter(hosted), /html,body\{[^}]*(height:auto|overflow:visible)/, 'the SillyTavern adapter leaves the roots alone too')
})
