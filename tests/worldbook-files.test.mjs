import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import { recentWorldbookLookupPaths, worldbookTitleHints } from '../tavern-plugin/lib/domain/worldbook-title-hints.js'

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

test('成功查到正文的条目安静十个剧情回合，标题命中、失效路径和不可见回执不计入', async t => {
  const { provider, agent, lookup, state } = await fixture(t)
  const { files } = await provider.inspect(lookup)
  const first = files.find(file => file.ref === 'a')
  const second = files.find(file => file.ref === 'b')
  await provider.refresh(agent)

  const events = []
  function lookupAt(turn, name, args, text, isError = false) {
    const id = 'call-' + events.length
    events.push(
      { type: 'assistant/message', data: { turn, message: { role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] } } },
      { type: 'tool/result', data: { turn, message: { role: 'tool', toolCallId: id, isError, content: [{ type: 'text', text }] } } }
    )
  }
  lookupAt(2, 'worldbook_grep', { query: '港口' }, JSON.stringify({ matches: [
    { path: first.path, line: 4, text: '港口秘密' },
    { path: second.path, line: 1, text: '# 港口' }
  ] }))
  lookupAt(4, 'read', { file_path: second.path }, '读取失败', true)
  lookupAt(6, 'read', { file_path: second.path }, '3: 另一港口')
  const session = { surface: { nodes: [0, 1, 2, 3, 4] }, eventAt: index => events[index] }
  const messages = Array.from({ length: 10 }, (_, index) => ({ role: 'assistant', turn: 2 * (index + 1) }))
  const paths = recentWorldbookLookupPaths(session, messages)
  assert.deepEqual(provider.refsForPaths(agent, paths), ['a'])
  assert.deepEqual(provider.refsForPaths({}, paths), [])
  assert.deepEqual([...recentWorldbookLookupPaths(session, [...messages, { role: 'assistant', turn: 22 }])], [])
  session.surface.nodes.push(5)
  assert.deepEqual(provider.refsForPaths(agent, recentWorldbookLookupPaths(session, messages)), ['b', 'a'])

  state.worldBook.view.entries[0].content += '\n改写'
  await provider.refresh(agent)
  assert.deepEqual(provider.refsForPaths(agent, paths), [])
})

test('标题提醒用一行列出至多三个近期未读的静态匹配项', () => {
  const entries = ['薛姨妈', '史太君', '王夫人', '贾琏', '凤姐'].map((title, index) => ({
    ref: title, title, enabled: true, order: 100 + index, primaryKeys: [title], content: title + '正文'
  }))
  const input = { worldBook: { view: { entries } }, chat: { messages: [] },
    turn: 15, userText: entries.map(entry => entry.title).join(' '), recentlyReadRefs: ['史太君'] }
  assert.equal(worldbookTitleHints(input), '<lorebook_title_hints>\n可能用到的世界书条目：薛姨妈、王夫人、贾琏\n</lorebook_title_hints>')
  assert.equal(worldbookTitleHints({ ...input, userText: '史太君' }), '')
})
