import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import { virtualHash, virtualScope } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'

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

test('files include static constants but never expose unrendered dynamic code', async t => {
  const { provider, lookup } = await fixture(t)
  const listed = await provider.listFiles({ limit: 1 }, lookup)
  assert.equal(listed.total, 3); assert.equal(listed.nextOffset, 1)
  const next = await provider.listFiles({ offset: listed.nextOffset, version: listed.version }, lookup)
  assert.notEqual(next.files[0].path, listed.files[0].path)
  const names = await fs.readdir(listed.directory)
  assert.deepEqual(names.sort(), ['.scope-id', '港口--2.md', '港口.md', '常驻资料'].sort())
  assert.match(await fs.readFile(listed.files[0].path, 'utf8'), /Harbor\n港口秘密/)
  const result = await provider.searchFiles({ query: 'HARBOR' }, lookup)
  assert.equal(result.total, 1); assert.equal(result.matches[0].line, 3)
  assert.equal((await provider.searchFiles({ query: 'HARBOR', caseSensitive: true }, lookup)).total, 0)
  const search = await provider.searchFiles({ query: '港口', limit: 2 }, lookup)
  assert.equal(search.total, 5); assert.equal(search.nextOffset, 2)
  assert.equal((await provider.searchFiles({ query: '港口', offset: 2, version: search.version }, lookup)).matches.length, 3)
  assert.equal((await provider.searchFiles({ query: '秘密' }, lookup)).total, 2)
  await assert.rejects(provider.searchFiles({ query: '', limit: 1 }, lookup), /query/)
  await assert.rejects(provider.listFiles({ limit: 0 }, lookup), /limit/)
})

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

test('preprocessing visibility remains authoritative and is never executed by file generation', async t => {
  const { provider, lookup, state } = await fixture(t)
  const entries = state.worldBook.view.entries
  entries.push({ ref: 'controller', constant: true, content: '@@generate_before\n<% throw new Error("never execute") %>' })
  assert.equal((await provider.listFiles({}, lookup)).total, 0)
  state.chat.worldBookVirtualState = { schemaVersion: 1, scope: virtualScope(state.chat), visibility: { version: virtualHash(entries), refs: ['a'] }, entries: {} }
  assert.equal((await provider.listFiles({}, lookup)).total, 1)
  entries[0].content = 'changed without runtime visibility update'
  assert.equal((await provider.listFiles({}, lookup)).total, 0)
})

 test('runtime renders feed searchable snapshots without search side effects, dynamic updates preserve static paths', async t => {
  const { createForegroundWorldbook } = await import('../tavern-plugin/lib/domain/foreground-worldbook.js')
  const { projectVirtualWorldbookPrefix } = await import('../tavern-plugin/lib/domain/worldbook-virtual-state.js')
  const { provider, lookup, state, directory } = await fixture(t)
  const dynamic = state.worldBook.view.entries.find(entry => entry.ref === 'd')
  dynamic.constant = true
  let output = '晴天，港口开放', calls = 0
  const project = createForegroundWorldbook({ bound: async () => state.worldBook,
    runtime: async () => ({ render: async () => { calls++; return { ok: true, text: output, scopes: {} } } }), globalVariables: async () => ({}) })
  const run = async requestKey => {
    const projected = await project({ chat: state.chat, card: {}, requestKey })
    state.chat.worldBookVirtualState = projected.virtualState
    return projected
  }
  const first = await run('one')
  assert.equal(first.context, '')
  assert.doesNotMatch(first.context, /晴天|港口开放/)
  const { appendWorldbookSkillChanges } = await import('../tavern-plugin/lib/domain/worldbook-skill-changes.js')
  const payload = { agent: { session: { events: [] } }, messages: [] }
  const notify = async () => {
    await provider.refresh(lookup.scope)
    return appendWorldbookSkillChanges(payload, provider.changeSnapshot(lookup.scope))
  }
  const initialNotice = await notify()
  assert.match(initialNotice.content[0].text, /动态快照已就绪.*动态/)
  assert.doesNotMatch(initialNotice.content[0].text, /晴天|港口开放/)
  assert.equal(await notify(), null)
  const list = await provider.listFiles({}, lookup)
  const staticPath = list.files.find(file => file.title === '港口').path
  const snapshotPath = list.files.find(file => file.category === '动态快照').path
  assert.match(await provider.readResource(snapshotPath, lookup), /晴天，港口开放/)
  assert.equal((await provider.searchFiles({ query: '港口开放' }, lookup)).total, 1)
  assert.equal(calls, 1, 'listing/search/read never execute EJS')
  assert.equal(projectVirtualWorldbookPrefix(state.worldBook, state.chat).snapshots, '', 'compaction cannot restore data bodies')
  assert.equal((await run('two')).context, '', 'unchanged output has no notification')
  output = '暴雨，港口关闭'
  const changed = await run('three')
  assert.equal(changed.context, '')
  const changeNotice = await notify()
  assert.match(changeNotice.content[0].text, /改写.*动态/)
  assert.doesNotMatch(changeNotice.content[0].text, /暴雨|港口关闭/)
  assert.equal(await notify(), null)
  assert.doesNotMatch(changed.context, /暴雨|港口关闭/)
  assert.equal(await provider.authorizeRead(staticPath, lookup), true)
  assert.equal(await provider.authorizeRead(snapshotPath, lookup), false)
  assert.equal((await provider.searchFiles({ query: '晴天' }, lookup)).total, 0)
  assert.equal((await provider.searchFiles({ query: '港口关闭' }, lookup)).total, 1)
  const other = { ...state.chat, sessionId: 'other' }
  const isolated = createWorldbookFiles({ directory, load: async () => ({ chat: other, worldBook: state.worldBook }) })
  assert.equal((await isolated.searchFiles({ query: '港口关闭' }, { scope: { session: { id: 'other' } } })).total, 0)
  output = ''
  assert.equal((await run('four')).context, '')
  assert.match((await notify()).content[0].text, /撤回资料.*动态/)
  assert.equal((await provider.searchFiles({ query: '港口关闭' }, lookup)).total, 0)
  assert.equal((await run('five')).context, '')
})
