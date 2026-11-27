import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import { formatWorldbookTitleHints, recentWorldbookLookups, worldbookTitleHints } from '../tavern-plugin/lib/domain/worldbook-title-hints.js'
import { estimateWorldBookTokens } from '../tavern-plugin/lib/domain/worldbook-activation.js'

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
  function lookupAt(turn, name, args, text, isError = false, meta = undefined) {
    const id = 'call-' + events.length
    events.push(
      { type: 'assistant/message', data: { turn, message: { role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] } } },
      { type: 'tool/result', data: { turn, meta, message: { role: 'tool', toolCallId: id, isError, content: [{ type: 'text', text }] } } }
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
  const lookups = recentWorldbookLookups(session, messages)
  assert.deepEqual(provider.refsForLookups(agent, lookups), ['a'])
  assert.deepEqual(provider.refsForLookups({}, lookups), [])
  assert.deepEqual(recentWorldbookLookups(session, [...messages, { role: 'assistant', turn: 22 }]), { paths: new Set(), ids: new Set() })
  session.surface.nodes.push(5)
  assert.deepEqual(provider.refsForLookups(agent, recentWorldbookLookups(session, messages)), ['b', 'a'])

  const body = await provider.readByKeyword({ keyword: second.lookupId }, lookup)
  lookupAt(8, 'read_lorebook', { keyword: second.lookupId }, body.text, false, { worldbookRead: { id: body.id, title: body.title } })
  lookupAt(10, 'read_lorebook', { keyword: '港口' }, JSON.stringify(await provider.readByKeyword({ keyword: '港口' }, lookup)))
  session.surface.nodes = [6, 7, 8, 9]
  assert.deepEqual(provider.refsForLookups(agent, recentWorldbookLookups(session, messages)), ['b'])
  lookupAt(12, 'grep_lorebook', { query: '秘密' }, '港口\n港口秘密', false, { lorebookGrepIds: [first.lookupId] })
  lookupAt(14, 'grep_lorebook', { query: '港口' }, '港口', false, { lorebookGrepIds: [] })
  session.surface.nodes = [10, 11, 12, 13]
  const grepLookups = recentWorldbookLookups(session, messages)
  assert.deepEqual(provider.refsForLookups(agent, grepLookups), ['a'])

  state.worldBook.view.entries[0].content += '\n改写'
  await provider.refresh(agent)
  assert.deepEqual(provider.refsForLookups(agent, lookups), [])
  assert.deepEqual(provider.refsForLookups(agent, grepLookups), [])
  assert.deepEqual(provider.refsForLookups(agent, recentWorldbookLookups(session, messages)), [])
})

test('按标题、别名或正文关键词读取；同名条目按候选 ID 区分', async t => {
  const { provider, lookup, state } = await fixture(t)
  state.worldBook.view.entries[2].primaryKeys = ['港口', '默认规则']
  const read = (keyword, options) => provider.readByKeyword({ keyword, ...options }, lookup)
  const duplicate = await read(' 港口 ')
  assert.equal(duplicate.status, 'multiple')
  assert.equal(duplicate.total, 2, 'exact titles take precedence over aliases and body mentions')
  assert.deepEqual(duplicate.candidates.map(row => row.title), ['港口', '港口'])
  const second = await read(duplicate.candidates[1].id)
  assert.equal(second.text, '另一港口')
  assert.equal((await read('harbor')).text, 'Harbor\n港口秘密\n另一行港口')
  assert.equal((await read('默认规则')).text, '常驻秘密')
  for (const keyword of ['关闭秘密', '更新规则', '<%= value %>', '不存在']) {
    assert.deepEqual(await read(keyword), { status: 'not_found' })
  }
  state.worldBook.view.entries[2].content = '🍵'.repeat(8001)
  const firstPage = await read('默认规则')
  assert.equal(firstPage.text, '🍵'.repeat(8000))
  const nextPage = await read(firstPage.id, { offset: firstPage.nextOffset })
  assert.equal(nextPage.text, '🍵')
  assert.equal(nextPage.nextOffset, null)
})

test('标题提醒按召回顺序列出预算内的近期未读静态匹配项，可超过三条', () => {
  const entries = ['薛姨妈', '史太君', '王夫人', '贾琏', '凤姐'].map((title, index) => ({
    ref: title, title, enabled: true, order: 100 + index, primaryKeys: [title], content: title + '正文'
  }))
  const input = { worldBook: { view: { entries } }, chat: { messages: [] },
    turn: 15, userText: entries.map(entry => entry.title).join(' '), recentlyReadRefs: ['史太君'] }
  assert.equal(worldbookTitleHints(input), '<lorebook_title_hints>\n可能用到的世界书条目：薛姨妈、王夫人、贾琏、凤姐\n</lorebook_title_hints>')
  assert.equal(worldbookTitleHints({ ...input, userText: '史太君' }), '')
})

test('长标题按提示预算取舍，给放得下的后续短标题留机会', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ title: i + '长'.repeat(79) }))
  const hints = formatWorldbookTitleHints([...entries, { title: '短标题' }, entries[0]])
  assert.ok(estimateWorldBookTokens(hints) <= 256)
  assert.ok(hints.includes(entries[0].title + '、' + entries[1].title))
  assert.ok(!hints.includes(entries.at(-1).title))
  assert.match(hints, /、短标题\n/)
  assert.equal(hints.split(entries[0].title).length, 2)
})
