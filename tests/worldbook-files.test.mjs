import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worldbook-files-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const agent = { session: { id: 'game' } }
  const state = { chat: { sessionId: 'game', cardPath: '江湖.json', worldbookStrategy: 'native-skills' }, worldBook: { view: { entries: [
    { ref: 'a', title: '港口', content: 'Harbor\n港口秘密\n另一行港口' },
    { ref: 'b', title: '港口', content: '另一港口' },
    { ref: 'c', title: '常驻', content: '常驻秘密', constant: true },
    { ref: 'd', title: '动态', content: '<%= value %>' },
    { ref: 'e', title: '关闭', content: '关闭秘密', enabled: false },
    { ref: 'f', title: '[mvu_update]变量更新', content: '更新规则' }
  ] } } }
  const provider = createWorldbookFiles({ directory, load: async scope => scope === agent ? state : null })
  return { directory, agent, state, provider, lookup: { scope: agent } }
}

test('reads reject foreign scope, traversal, symlinks, cancellation and permits legacy saves', async t => {
  const { provider, lookup, state } = await fixture(t)
  const { files } = await provider.listFiles({}, lookup)
  assert.equal(await provider.authorizeRead(files[0].path, { scope: { session: { id: 'foreign' } } }), false)
  assert.equal(await provider.authorizeRead(path.join(files[0].path, '../../secret'), lookup), false)
  await t.test('rejects a file symlink in the materialized worldbook', async t => {
    await fs.unlink(files[0].path)
    if (!createFileSymlink(t, files[1].path, files[0].path)) return
    await assert.rejects(provider.authorizeRead(files[0].path, lookup), /symlink/)
  })
  const abort = new AbortController(); abort.abort()
  await assert.rejects(provider.listFiles({}, { ...lookup, signal: abort.signal }))
  state.chat.worldbookStrategy = 'legacy'
  assert.ok((await provider.listFiles({}, lookup)).files.length > 0)
})
