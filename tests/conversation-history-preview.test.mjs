import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { readFileSync } from 'node:fs'
import { createTavernConversationRegistry, extractChatPreview } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

const cardList = readFileSync(new URL('../tavern-plugin/src/client/features/card-list.js', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

function memoryStore(seed = {}) {
  let links = structuredClone(seed.links || {})
  let index = structuredClone(seed.index || { chats: [] })
  const chats = new Map(Object.entries(structuredClone(seed.chats || {})))
  const counts = { chatReads: 0, sliceReads: 0 }
  const adapter = {
    async readLinks() { return structuredClone(links) },
    async updateLinks(updater) { const next = await updater(structuredClone(links)); if (next !== undefined) links = structuredClone(next) },
    async readIndex() { return structuredClone(index) },
    async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) index = structuredClone(next); return next },
    async readChat(id) {
      counts.chatReads += 1
      return chats.has(id) ? structuredClone(chats.get(id)) : undefined
    },
    async readChatSlice(id, indices = [], fields) {
      counts.sliceReads += 1
      const chat = chats.get(id)
      if (!chat) return null
      const rows = Array.isArray(chat.messages) ? chat.messages : []
      if (indices.some(index => index >= rows.length)) return undefined
      const head = {}
      for (const field of fields || []) if (Object.hasOwn(chat, field)) head[field] = structuredClone(chat[field])
      return { chat: { ...head, messages: indices.map(index => structuredClone(rows[index])) }, messageCount: rows.length }
    },
    async writeChat(chat) { chats.set(chat.id, structuredClone(chat)) },
    async removeChat(id) { chats.delete(id) }
  }
  return { adapter, counts, snapshot: () => ({ links: structuredClone(links), index: structuredClone(index), chats: Object.fromEntries(chats) }) }
}

function importChat(overrides = {}) {
  return {
    id: 'chat-import-1', cardPath: 'cards/storyteller.json', cardName: 'Storyteller', mode: 'story', requestMode: 'sillytavern',
    createdAt: 1000, updatedAt: 1000,
    messages: [
      // 开场白里带状态栏与 initvar，预览必须只留正文。
      { role: 'assistant', greeting: true, turn: 1, text: '<style>.x{}</style>\n<initvar>{"hp":10}</initvar>\n\n雨声落在窗外，旅店的门被推开。' },
      { role: 'user', text: '我推门走进旅店。\n把湿透的外套挂在门口。' },
      { role: 'assistant', turn: 2, text: '<StatusPlaceHolderImpl/>\n老板抬起头，把一杯热汤推过来。\n第二段正文。' }
    ],
    ...overrides
  }
}

test('预览提取：跳过开场白，取玩家首条与角色首条，并记下轮数', () => {
  const preview = extractChatPreview(importChat())
  assert.equal(preview.turnCount, 1)
  assert.equal(preview.messageCount, 3)
  assert.match(preview.userText, /我推门走进旅店/)
  assert.match(preview.replyText, /老板抬起头/)
  assert.doesNotMatch(preview.replyText, /StatusPlaceHolderImpl|style|<initvar>/)
  // 已经聊过的存档不把开场白当预览，侧边栏显示玩家和角色的首轮。
  assert.equal(preview.openingText, '')
})

test('预览提取：一条没聊过的存档标成仅开场，保留开场白前几行', () => {
  const preview = extractChatPreview({ id: 'chat-blank', messages: [{ role: 'assistant', greeting: true, turn: 1, text: '雨声落在窗外。\n\n远处传来马蹄声。' }] })
  assert.equal(preview.turnCount, 0)
  assert.equal(preview.messageCount, 1)
  assert.equal(preview.userText, '')
  assert.match(preview.openingText, /雨声落在窗外/)
  assert.match(preview.openingText, /远处传来马蹄声/)
})

test('预览提取：多轮存档按 turn 记轮数，助手多段回复不重复计数', () => {
  const messages = [{ role: 'assistant', greeting: true, turn: 1, text: '开场。' }]
  for (let turn = 2; turn <= 9; turn++) {
    messages.push({ role: 'user', text: '玩家第 ' + (turn - 1) + ' 轮' })
    messages.push({ role: 'assistant', turn, text: '角色第 ' + (turn - 1) + ' 轮' })
    messages.push({ role: 'assistant', turn, text: '角色续写，同一轮。' })
  }
  const preview = extractChatPreview({ id: 'chat-long', messages })
  assert.equal(preview.turnCount, 8)
  assert.match(preview.userText, /玩家第 1 轮/)
  assert.equal(preview.openingText, '')
})

test('预览提取：只有头部投影或空历史时不清空已记住的预览', () => {
  const existing = { turnCount: 3, messageCount: 7, userText: '玩家', replyText: '角色', openingText: '' }
  assert.deepEqual(extractChatPreview({ id: 'chat-1', messages: [] }, existing), existing)
  assert.deepEqual(extractChatPreview({ id: 'chat-1', messages: [] }, existing, { metadataOnly: true }), existing)
})

test('索引同步写入 preview，列表只读索引不读存档', async () => {
  const store = memoryStore({ links: { link: 'seed' } })
  store.adapter.readLinks = async () => ({ session: 'chat-import-1' })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const chat = importChat()
  await registry.sync(chat)
  const rows = await registry.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].preview.turnCount, 1)
  assert.match(rows[0].preview.userText, /我推门走进旅店/)
  assert.equal(store.counts.chatReads, 0)
})

test('旧索引缺 preview 时按需回填，写回后第二次不再读存档', async () => {
  const chat = importChat()
  const store = memoryStore({
    links: { session: 'chat-import-1' },
    index: { chats: [{ id: 'chat-import-1', cardPath: chat.cardPath, cardName: chat.cardName, title: '', mode: 'story', requestMode: 'sillytavern', createdAt: 1000, updatedAt: 1000, lastOpenedAt: 1000 }] },
    chats: { 'chat-import-1': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const first = await registry.backfillPreviews(['chat-import-1'])
  assert.equal(first.previews['chat-import-1'].turnCount, 1)
  assert.equal(first.remaining, 0)
  // 走的是切片读：只取头部几条 + 最后一条，不整份加载 236 个存档。
  assert.equal(store.counts.chatReads, 0)
  assert.ok(store.counts.sliceReads > 0)
  assert.equal(store.snapshot().index.chats[0].preview.turnCount, 1)
  const sliceReads = store.counts.sliceReads
  const second = await registry.backfillPreviews(['chat-import-1'])
  assert.deepEqual(second.previews, {})
  assert.equal(store.counts.sliceReads, sliceReads)
})

test('236 轮的长存档回填：只读切片也数得准轮数，不整份加载', async () => {
  const messages = [{ role: 'assistant', greeting: true, turn: 1, text: '开场白。' }]
  for (let turn = 2; turn <= 237; turn++) {
    messages.push({ role: 'user', text: '第 ' + (turn - 1) + ' 轮玩家输入' })
    messages.push({ role: 'assistant', turn, text: '第 ' + (turn - 1) + ' 轮正文' })
  }
  const chat = importChat({ messages })
  assert.equal(chat.messages.length, 473)
  const store = memoryStore({
    links: { session: 'chat-import-1' },
    index: { chats: [{ id: 'chat-import-1', cardPath: chat.cardPath, cardName: chat.cardName, title: 'Storyteller - Storyteller - 2026-11-09 21-34', mode: 'story', createdAt: 1000, updatedAt: 1000, lastOpenedAt: 1000 }] },
    chats: { 'chat-import-1': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const result = await registry.backfillPreviews(['chat-import-1'])
  const preview = result.previews['chat-import-1']
  assert.equal(preview.turnCount, 236)
  assert.equal(preview.messageCount, 473)
  assert.match(preview.userText, /第 1 轮玩家输入/)
  assert.equal(preview.openingText, '')
  assert.equal(store.counts.chatReads, 0)
})

test('回填只补缺失的行，已有 preview 的存档原样保留', async () => {
  const chat = importChat()
  const kept = { turnCount: 12, messageCount: 25, userText: '旧玩家', replyText: '旧角色', openingText: '' }
  const store = memoryStore({
    links: { session: 'chat-import-1', other: 'chat-import-1' },
    index: { chats: [{ id: 'chat-import-1', cardPath: chat.cardPath, cardName: chat.cardName, title: '', mode: 'story', createdAt: 1000, updatedAt: 1000, lastOpenedAt: 1000, preview: kept }] },
    chats: { 'chat-import-1': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const result = await registry.backfillPreviews([])
  assert.deepEqual(result.previews, {})
  assert.deepEqual(store.snapshot().index.chats[0].preview, kept)
  assert.equal(store.counts.sliceReads, 0)
})

function cardListHelpers() {
  const ctx = vm.createContext({})
  for (const name of ['tavernPreviewLines', 'formatTavernHistoryPreview', 'compactTavernHistoryTitle']) {
    vm.runInContext(sourceFunction(cardList, name), ctx)
  }
  return ctx
}

test('SillyTavern 导入的重复角色前缀在分组里折叠，尾部日期露出来', () => {
  const ctx = cardListHelpers()
  const title = 'Storyteller - Storyteller - 2026-11-09 21-34'
  assert.equal(ctx.compactTavernHistoryTitle(title, 'Storyteller'), '2026-11-09 21-34')
  // 只折叠作为前缀出现的角色名，标题里别处的同名不动。
  assert.equal(ctx.compactTavernHistoryTitle('雨夜 - Storyteller', 'Storyteller'), '雨夜 - Storyteller')
  assert.equal(ctx.compactTavernHistoryTitle('Storyteller', 'Storyteller'), 'Storyteller')
})

test('行内预览分紧凑与展开两份，仅开场单独标注', () => {
  const ctx = cardListHelpers()
  const dialogue = ctx.formatTavernHistoryPreview({ turnCount: 18, messageCount: 37, userText: '我推门走进旅店。\n把外套挂好。', replyText: '老板抬起头。\n第二段。', openingText: '' })
  assert.equal(dialogue.turnBadge, '18 轮')
  assert.equal(dialogue.isOpeningOnly, false)
  assert.deepEqual(Array.from(dialogue.compactLines, line => line.label), ['你', '角色'])
  assert.ok(dialogue.detailLines[0].text.length >= dialogue.compactLines[0].text.length)
  // 预览不加硬换行：行数由 CSS 的 line-clamp 控制，收起 3 行、展开 9 行。
  assert.doesNotMatch(dialogue.compactLines[0].text, /\n/)
  const opening = ctx.formatTavernHistoryPreview({ turnCount: 0, messageCount: 44, userText: '', replyText: '', openingText: '雨声落在窗外。' })
  assert.equal(opening.turnBadge, '仅开场')
  assert.equal(opening.isOpeningOnly, true)
  assert.equal(opening.compactLines[0].label, '开场')
})

test('侧边栏行渲染预览、轮数与展开开关，并挂上宽屏管理面板', () => {
  assert.match(sidebar, /dsh-tavern-side-row-preview/)
  assert.match(sidebar, /dsh-tavern-side-row-expand/)
  assert.match(sidebar, /preview\.turnBadge/)
  assert.match(sidebar, /call\("loadSessionPreviews"/)
  assert.match(sidebar, /dsh-tavern-history-manager/)
  assert.match(css, /\.dsh-tavern-side-row-preview \{/)
  assert.match(css, /\.dsh-tavern-history-manager \{/)
})

test('移动端侧栏整屏铺开，右上角有收回按钮，▾ 仍然在行内', () => {
  assert.match(sidebar, /dsh-tavern-side-collapse/)
  assert.match(sidebar, /togglePreview\(item\); \}/)
  // 抽屉（frame 的第一个子元素）在手机上铺满整屏。
  assert.match(css, /\[data-mobile-nav="frame"\] > :first-child:has\(\.dsh-tavern-sidebar\) \{\n    width: 100vw !important;/)
  assert.match(css, /\.dsh-tavern-sidebar \{\n    position: fixed !important; inset: 0 !important;/)
  // 行内展开按钮在触屏上也照样渲染，不再被 CSS 藏掉。
  assert.doesNotMatch(css, /\.dsh-tavern-side-row-expand \{ display: none; \}/)
  assert.match(css, /\.dsh-tavern-side-row-preview \{[^}]*-webkit-line-clamp: 3;/)
  assert.doesNotMatch(css, /\.dsh-tavern-side-row-preview \{ -webkit-line-clamp: 2; \}/)
})


