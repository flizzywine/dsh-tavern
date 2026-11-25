import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { worldbookPlacement } from '../tavern-plugin/lib/domain/worldbook-placement.js'
import { constantWorldBookContext, prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { activateWorldBook } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { classifyWorldbookEntry } from '../tavern-plugin/lib/domain/worldbook-entry-classification.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectVirtualWorldbookPrefix } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'
import { mergeWorldBooks } from '../tavern-plugin/lib/domain/worldbook-merge.js'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import {
  exportCharacterBook,
  exportSillyTavernWorldBook,
  inspectWorldBookDocument,
  updateWorldBookDocument
} from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { extractDormantWorldbookHooks } from '../tavern-plugin/packages/dsh-tavern-plot-compass/lib/plot-compass.js'

function channels(entries) {
  const { foregroundRefs, prefixRefs } = worldbookPlacement(entries, [])
  return { foreground: [...foregroundRefs].sort(), prefix: [...prefixRefs].sort() }
}

function stableRefs(entries) {
  return constantWorldBookContext({ worldBook: { view: { entries } } }).refs.slice().sort()
}

function select(entries, options = {}) {
  return activateWorldBook({
    worldBook: { view: { raw: {}, entries } },
    entries,
    chat: { messages: [] },
    turn: 1,
    userText: '继续',
    isCoolingDown: () => false,
    ...options
  })
}

function bookDocument(rootExtensions, entries) {
  return {
    name: '测试书',
    extensions: rootExtensions,
    entries: Object.fromEntries(entries.map(function (value, index) {
      return [String(index), {
        uid: index,
        key: value.keys || [],
        keysecondary: [],
        comment: value.comment || '条目' + index,
        content: value.content,
        disable: false,
        constant: value.constant === true,
        selective: true,
        order: value.order ?? 100,
        position: 0,
        extensions: value.extensions || {}
      }]
    }))
  }
}

test('auto / prefix / tail 的放置、稳定前缀、触发与预算核算符合预期', () => {
  const entries = [
    { ref: 'auto-const', comment: '自动常驻', content: '世界底色', constant: true, enabled: true, channel: 'auto', primaryKeys: [] },
    { ref: 'auto-kw', comment: '自动触发', content: '钟楼规则', constant: false, enabled: true, channel: 'auto', primaryKeys: ['钟楼'] },
    { ref: 'pin-prefix', comment: '固定前缀', content: '帝国年表', constant: false, enabled: true, channel: 'prefix', primaryKeys: ['年表'] },
    { ref: 'pin-tail', comment: '固定尾部', content: '当前天候', constant: true, enabled: true, channel: 'tail', primaryKeys: ['天气'] }
  ]

  // 放置：auto 常驻和 prefix 进前缀；auto 非常驻和 tail 进尾部。
  assert.deepEqual(channels(entries), {
    foreground: ['auto-kw', 'pin-tail'],
    prefix: ['auto-const', 'pin-prefix']
  })
  assert.deepEqual(stableRefs(entries), ['auto-const', 'pin-prefix'])

  // 激活：未提关键词时，prefix 与 tail 都直接激活；prefix 不计预算，tail 计预算。
  const base = select(entries)
  assert.deepEqual(base.entries.map(item => item.ref).sort(), ['auto-const', 'pin-prefix', 'pin-tail'])
  assert.equal(base.diagnostics.find(item => item.ref === 'auto-const').tokenCost, 0)
  assert.equal(base.diagnostics.find(item => item.ref === 'pin-prefix').tokenCost, 0)
  assert.ok(base.diagnostics.find(item => item.ref === 'pin-tail').tokenCost > 0)

  // 冷却和语义筛选对 prefix / tail 不生效，只拦截 auto 非常驻。
  const cooled = select(entries, {
    userText: '钟楼',
    isCoolingDown: () => 'read',
    allowedRefs: new Set(['auto-kw'])
  })
  assert.deepEqual(cooled.entries.map(item => item.ref).sort(), ['auto-const', 'pin-prefix', 'pin-tail'])

  // prepareWorldBookRecall：不把 prefix 当尾部，但保留 tail。
  const recalled = prepareWorldBookRecall({
    worldBook: { view: { raw: {}, entries } },
    chat: { messages: [] },
    turn: 1,
    userText: '钟楼'
  })
  assert.deepEqual(recalled.refs.sort(), ['auto-kw', 'pin-tail'])
})

test('动态正文即使标了 prefix 也不进静态前缀，跨条目标签边界不把 tail 算成常驻静态', () => {
  const entries = [
    { ref: 'ejs', content: '<%= "动态" %>', constant: false, enabled: true, channel: 'prefix' },
    { ref: 'rnd', content: '{{random::晴::雨}}', constant: false, enabled: true, channel: 'prefix' },
    { ref: 'last', content: '{{lastMessage}}', constant: false, enabled: true, channel: 'prefix' },
    { ref: 'macro', content: '金币 {{get_message_variable::stat_data.coins}}', constant: false, enabled: true, channel: 'prefix' },
    { ref: 'open', content: '<状态>', constant: true, enabled: true, channel: 'tail', order: 10, position: 0 },
    { ref: 'inner', content: '生命 100', constant: true, enabled: true, channel: 'tail', order: 20, position: 0 },
    { ref: 'close', content: '</状态>', constant: true, enabled: true, channel: 'tail', order: 30, position: 0 }
  ]

  assert.deepEqual(channels(entries), {
    foreground: ['close', 'ejs', 'inner', 'last', 'macro', 'open', 'rnd'],
    prefix: []
  })
  assert.deepEqual(stableRefs(entries), [])
  assert.equal(classifyWorldbookEntry(entries[0]).kind, 'dynamic-constant')
  assert.equal(classifyWorldbookEntry(entries[3]).kind, 'dynamic-constant')
})

test('整本默认通道与单条覆盖、清除与 ST/角色卡往返导出', () => {
  const document = bookDocument({ tavern_channel: 'prefix' }, [
    { content: '甲设定' },
    { content: '乙设定', extensions: { tavern_channel: 'tail' } },
    { content: '丙设定', extensions: { tavern_channel: 'auto' } }
  ])
  const view = inspectWorldBookDocument(document)
  assert.equal(view.channel, 'prefix')
  assert.equal(view.entries[0].channel, 'prefix')
  assert.equal(view.entries[0].channelInherited, true)
  assert.equal(view.entries[1].channel, 'tail')
  assert.equal(view.entries[1].channelInherited, false)
  assert.equal(view.entries[2].channel, 'auto')
  assert.equal(view.entries[2].channelInherited, false)

  // 手写世界书根级 bare channel 也能识别。
  const bare = inspectWorldBookDocument({ channel: 'tail', entries: { 0: { uid: 0, content: '手写' } } })
  assert.equal(bare.channel, 'tail')
  assert.equal(bare.entries[0].channel, 'tail')
  assert.equal(bare.entries[0].channelInherited, true)

  // 清除第 1 条覆盖 -> 删除 tavern_channel，恢复跟随整本 prefix；
  // 新增条目未传 channel -> 自动跟随整本 prefix；
  // 整本默认为 prefix 时将第 0 条显式设为 auto -> 写入 tavern_channel: 'auto' 覆盖整本。
  const step1 = updateWorldBookDocument(document, {
    operations: [
      { op: 'update', ref: 'entry:1', patch: { channel: null } },
      { op: 'update', ref: 'entry:0', patch: { channel: 'auto' } },
      { op: 'add', entry: { comment: '新增', content: '新设定' } }
    ]
  })
  assert.equal(Object.hasOwn(step1.document.entries['1'].extensions, 'tavern_channel'), false)
  assert.equal(step1.view.entries[1].channel, 'prefix')
  assert.equal(step1.view.entries[1].channelInherited, true)
  assert.equal(step1.document.entries['0'].extensions.tavern_channel, 'auto')
  assert.equal(step1.view.entries[0].channel, 'auto')
  assert.equal(step1.view.entries[0].channelInherited, false)
  assert.equal(step1.view.entries[3].channel, 'prefix')
  assert.equal(step1.view.entries[3].channelInherited, true)

  // 转成 character_book 再切回 auto，不应从 originalData 幽灵复活 tavern_channel。
  const embedded = exportCharacterBook(step1.document)
  assert.equal(embedded.extensions.tavern_channel, 'prefix')
  assert.equal(embedded.entries[0].extensions.tavern_channel, 'auto')
  assert.equal(Object.hasOwn(embedded.entries[1].extensions, 'tavern_channel'), false)

  const roundtrip = exportSillyTavernWorldBook({ character_book: embedded })
  const clearedBook = updateWorldBookDocument(roundtrip, {
    channel: 'auto',
    operations: [{ op: 'update', ref: 'entry:0', patch: { channel: 'auto' } }]
  })
  assert.equal(Object.hasOwn(clearedBook.document.extensions, 'tavern_channel'), false)
  assert.equal(Object.hasOwn(clearedBook.document.entries['0'].extensions, 'tavern_channel'), false)
  const embeddedAfterClear = exportCharacterBook(clearedBook.document)
  assert.equal(Object.hasOwn(embeddedAfterClear.extensions, 'tavern_channel'), false)
  assert.equal(Object.hasOwn(embeddedAfterClear.entries[0].extensions, 'tavern_channel'), false)
})

test('前台 native-skills 运行时正确处理 prefix 与 tail（含静态与动态多轮注入）', async () => {
  const entries = [
    { ref: 'kw-prefix', comment: '暗线前置', title: '暗线前置', content: '前置秘密', constant: false, enabled: true, channel: 'prefix', primaryKeys: ['秘门'], order: 10 },
    { ref: 'const-tail', comment: '常驻改尾', title: '常驻改尾', content: '当前战局规则', constant: true, enabled: true, channel: 'tail', order: 20 },
    { ref: 'kw-tail', comment: '非常驻改尾', title: '非常驻改尾', content: '每日天气晴朗', constant: false, enabled: true, channel: 'tail', primaryKeys: ['天气'], order: 30 },
    { ref: 'dyn-tail', comment: '动态改尾', title: '动态改尾', content: '状态：{{get_message_variable::stat_data.hp}}', constant: false, enabled: true, channel: 'tail', order: 40 },
    { ref: 'skill-auto', comment: '普通线索', title: '普通线索', content: '酒馆传闻', constant: false, enabled: true, channel: 'auto', primaryKeys: ['酒馆'], order: 50 }
  ]
  const worldBook = { view: { displayName: '测试书', raw: { token_budget: 8192 }, entries } }
  const project = createForegroundWorldbook({
    bound: async () => worldBook,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }),
    globalVariables: async () => ({})
  })
  const chat = {
    sessionId: 'channel-runtime',
    cardPath: 'cards/test.json',
    worldbookStrategy: 'native-skills',
    messages: [{ role: 'assistant', variables: [{ stat_data: { hp: 85 } }] }]
  }

  const first = await project({ chat, card: { name: '主角' }, requestKey: 'r1', userText: '打听酒馆' })
  assert.equal(first.staticPrefix, '前置秘密')
  assert.equal(first.prefixContext, '前置秘密')
  assert.doesNotMatch(first.staticPrefix, /当前战局规则/)
  assert.match(first.context, /当前战局规则/)
  assert.match(first.context, /每日天气晴朗/)
  assert.match(first.context, /状态：85/)
  assert.equal(first.foregroundContext, first.context)
  assert.match(first.titleHints, /普通线索/)
  assert.doesNotMatch(first.titleHints, /暗线前置|每日天气晴朗/)
  // static-tail 不写入 virtualState.entries，动态 tail 写入 virtualState.entries。
  assert.equal(first.virtualState.entries['const-tail'], undefined)
  assert.equal(first.virtualState.entries['kw-tail'], undefined)
  assert.equal(first.virtualState.entries['dyn-tail'].text, '状态：85')

  chat.worldBookVirtualState = first.virtualState
  const restored = projectVirtualWorldbookPrefix(worldBook, chat, { restore: false })
  assert.equal(restored.staticPrefix, '前置秘密')

  // 第二轮变量值未变且未提关键词时，所有 tail 条目仍持续出现在尾部上下文中。
  const second = await project({ chat, card: { name: '主角' }, requestKey: 'r2', userText: '继续前进' })
  assert.equal(second.staticPrefix, '前置秘密')
  assert.match(second.context, /当前战局规则/)
  assert.match(second.context, /每日天气晴朗/)
  assert.match(second.context, /状态：85/)
})

test('文件投影将 prefix 静态归入常驻资料、tail 静态归入静态资料', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wb-files-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const files = createWorldbookFiles({
    directory: dir,
    load: async () => ({
      authorizedSessionId: 's1',
      chat: { sessionId: 's1', cardPath: 'cards/hero.json' },
      worldBook: {
        view: {
          displayName: '书',
          entries: [
            { ref: 'p', title: '固定前缀条目', content: 'P', constant: false, enabled: true, channel: 'prefix' },
            { ref: 't', title: '固定尾部条目', content: 'T', constant: true, enabled: true, channel: 'tail' }
          ]
        }
      }
    })
  })
  const listed = await files.listFiles({}, { scope: { session: { id: 's1' } } })
  const byTitle = Object.fromEntries(listed.files.map(item => [item.title, item.category]))
  assert.equal(byTitle['固定前缀条目'], '常驻资料')
  assert.equal(byTitle['固定尾部条目'], '静态资料')
})

test('多书合并把各本书默认通道下沉到条目并清除合并根通道，互不串书', () => {
  const bookA = {
    source: { kind: 'standalone', path: 'a.json' },
    document: bookDocument({ tavern_channel: 'prefix' }, [{ content: '书A设定' }])
  }
  const bookB = {
    source: { kind: 'standalone', path: 'b.json' },
    document: bookDocument({ tavern_channel: 'tail' }, [
      { content: '书B跟随' },
      { content: '书B显式自动', keys: ['钟楼'], extensions: { tavern_channel: 'auto' } }
    ])
  }
  const merged = mergeWorldBooks([bookA, bookB])
  assert.equal(Object.hasOwn(merged.document.extensions || {}, 'tavern_channel'), false)
  // 原输入文档未被就地改动。
  assert.equal(Object.hasOwn(bookA.document.entries['0'].extensions, 'tavern_channel'), false)
  assert.equal(bookA.document.extensions.tavern_channel, 'prefix')

  const view = inspectWorldBookDocument(merged.document)
  assert.equal(view.channel, 'auto')
  const byContent = Object.fromEntries(view.entries.map(entry => [entry.content, entry.channel]))
  assert.deepEqual(byContent, {
    '书A设定': 'prefix',
    '书B跟随': 'tail',
    '书B显式自动': 'auto'
  })
})

test('剧情罗盘提取休眠世界书暗线时跳过 prefix 和 tail 条目', () => {
  const hooks = extractDormantWorldbookHooks([
    { comment: '前缀暗线', content: '已经写进固定前缀的长文本设定内容。', enabled: true, constant: false, channel: 'prefix' },
    { comment: '尾部规则', content: '已经每轮尾部注入的长文本设定内容。', enabled: true, constant: false, channel: 'tail' },
    { comment: '休眠暗线', content: '尚未触发的古老钟楼传闻，可供后续剧情展开。', enabled: true, constant: false, channel: 'auto', primaryKeys: ['钟楼'] }
  ])
  assert.deepEqual(hooks.map(item => item.title), ['休眠暗线'])
})
