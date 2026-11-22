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

test('预览提取：跳过开场白，清理最近一轮的正文并记下轮数', () => {
  const preview = extractChatPreview(importChat())
  assert.equal(preview.turnCount, 1)
  assert.equal(preview.messageCount, 3)
  assert.match(preview.userText, /我推门走进旅店/)
  assert.match(preview.replyText, /老板抬起头/)
  assert.doesNotMatch(preview.replyText, /StatusPlaceHolderImpl|style|<initvar>/)
  // 已经聊过的存档显示最近一轮。
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
  assert.equal(preview.userText, '玩家第 8 轮')
  assert.equal(preview.replyText, '角色续写，同一轮。')
  assert.equal(preview.openingText, '')
})

test('预览保留还在等待回复的最新输入，不混入上一轮正文', () => {
  const chat = importChat()
  chat.messages.push({ role: 'user', text: '我起身走出旅店。' }, { role: 'assistant', turn: 3, text: '' })
  const preview = extractChatPreview(chat)
  assert.equal(preview.userText, '我起身走出旅店。')
  assert.equal(preview.replyText, '')
  assert.equal(preview.openingText, '')
})

test('只续写正文时显示最新一轮正文，避免带上上一轮输入', () => {
  const chat = importChat()
  chat.messages.push({ role: 'assistant', turn: 3, text: '第二天清晨，雨停了。' })
  const preview = extractChatPreview(chat)
  assert.equal(preview.userText, '')
  assert.equal(preview.replyText, '第二天清晨，雨停了。')
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
  // 直接读取会话片段。
  assert.equal(store.counts.chatReads, 0)
  assert.ok(store.counts.sliceReads > 0)
  assert.equal(store.snapshot().index.chats[0].preview.turnCount, 1)
  const sliceReads = store.counts.sliceReads
  const second = await registry.backfillPreviews(['chat-import-1'])
  assert.deepEqual(second.previews, {})
  assert.equal(store.counts.sliceReads, sliceReads)
})

test('236 轮的旧存档从首轮预览升级到末轮，只读取小片段', async () => {
  const messages = [{ role: 'assistant', greeting: true, turn: 1, text: '开场白。' }]
  for (let turn = 2; turn <= 237; turn++) {
    messages.push({ role: 'user', text: '第 ' + (turn - 1) + ' 轮玩家输入' })
    messages.push({ role: 'assistant', turn, text: '第 ' + (turn - 1) + ' 轮正文' })
  }
  const chat = importChat({ messages })
  assert.equal(chat.messages.length, 473)
  const store = memoryStore({
    links: { session: 'chat-import-1' },
    index: { chats: [{ id: 'chat-import-1', cardPath: chat.cardPath, cardName: chat.cardName, title: 'Storyteller - Storyteller - 2026-11-09 21-34', mode: 'story', createdAt: 1000, updatedAt: 1000, lastOpenedAt: 1000,
      preview: { turnCount: 236, messageCount: 473, userText: '第 1 轮玩家输入', replyText: '第 1 轮正文', openingText: '' } }] },
    chats: { 'chat-import-1': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const result = await registry.backfillPreviews(['chat-import-1'])
  const preview = result.previews['chat-import-1']
  assert.equal(preview.turnCount, 236)
  assert.equal(preview.messageCount, 473)
  assert.equal(preview.userText, '第 236 轮玩家输入')
  assert.equal(preview.replyText, '第 236 轮正文')
  assert.equal(preview.latest, true)
  assert.equal(preview.openingText, '')
  assert.equal(store.counts.chatReads, 0)
  assert.equal(store.counts.sliceReads, 2)
  assert.deepEqual((await registry.list())[0].preview, preview)
})

test('已经更新为末轮的预览跳过回填', async () => {
  const chat = importChat()
  const kept = { latest: true, turnCount: 12, messageCount: 25, userText: '旧玩家', replyText: '旧角色', openingText: '' }
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

test('局部正文写入、编辑和回退后索引预览跟随，并保留更新的版本', async () => {
  const chat = importChat({ _storageRevision: 1, sessionId: 'session' })
  const store = memoryStore({ links: { session: chat.id }, chats: { [chat.id]: chat } })
  const notified = []
  const registry = createTavernConversationRegistry({ store: store.adapter, onPreviewChange: row => notified.push(row.preview) })
  await registry.sync(chat)
  const old = structuredClone(chat)

  chat._storageRevision = 2
  chat.messages.push({ role: 'user', text: '我结账离开。' }, { role: 'assistant', turn: 3, text: '街上起了风。' })
  await store.adapter.writeChat(chat)
  const header = { ...chat, messages: [] }
  await registry.sync(header, { metadataOnly: true, refreshPreview: true })
  const lastPreview = async () => (await registry.list())[0].preview
  assert.equal((await lastPreview()).userText, '我结账离开。')
  assert.equal((await lastPreview()).replyText, '街上起了风。')
  await registry.sync(old)
  assert.equal((await lastPreview()).storageRevision, 2)

  chat._storageRevision = 3
  chat.messages.at(-1).text = '街灯已经亮了。'
  await store.adapter.writeChat(chat)
  await registry.sync({ ...header, _storageRevision: 3 }, { metadataOnly: true, refreshPreview: true })
  assert.equal((await lastPreview()).replyText, '街灯已经亮了。')

  chat._storageRevision = 4
  chat.messages.splice(3, 2)
  await store.adapter.writeChat(chat)
  await registry.sync({ ...header, _storageRevision: 4 }, { metadataOnly: true, refreshPreview: true })
  assert.equal((await lastPreview()).replyText.includes('老板抬起头'), true)
  assert.equal(notified.length, 4)
  assert.equal(store.counts.chatReads, 0)
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
  // 抽屉（frame 的第一个子元素）在手机上铺满整屏，且只在抽屉展开时生效。
  assert.match(css, /\[data-mobile-nav="frame"\]:not\(\[data-sidebar-collapsed\]\) > :first-child:has\(\.dsh-tavern-sidebar\) \{\n    width: 100vw !important;/)
  assert.match(css, /\.dsh-tavern-sidebar:not\(\.collapsed\) \{\n    position: fixed !important; inset: 0 !important;/)
  // 收起状态（.collapsed 的 ＋ 窄条）绝不能被撑成整屏空白。
  assert.doesNotMatch(css, /\.dsh-tavern-sidebar \{\n    position: fixed !important; inset: 0/)
  // 行内展开按钮在触屏上也照样渲染，不再被 CSS 藏掉。
  assert.doesNotMatch(css, /\.dsh-tavern-side-row-expand \{ display: none; \}/)
  assert.match(css, /\.dsh-tavern-side-row-preview \{[^}]*-webkit-line-clamp: 3;/)
  assert.doesNotMatch(css, /\.dsh-tavern-side-row-preview \{ -webkit-line-clamp: 2; \}/)
})

test('Windows 酒馆标志紧跟标题栏，收起按钮仍可点击', async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.setContent(`<!doctype html><html data-windows-titlebar><head><style>
    body { margin: 0; padding-top: 40px; }
    .host_root { display: flex; flex-direction: column; width: 300px; height: 720px; padding: 6px 8px; }
    .host_logoRow { flex: none; height: 40px; overflow: hidden; }
    .host_toggle { position: fixed; top: 6px; left: 12px; width: 28px; height: 28px; }
    .host_newSessionRow { display: flex; flex: none; margin-top: 6px; }
    .host_scrollRegion { position: relative; margin-top: 4px; }
    [data-sidebar-scrollport] { display: grid; grid-template-rows: 8px 0 2px max-content; }
    .host_regionArea { grid-row: 4; }
  </style></head><body class="dsh-tavern-shell-active">
    <div class="host_root">
      <div class="host_logoRow">
        <span class="host_brand">DSH</span>
        <button class="host_toggle" aria-label="收起侧栏" onclick="this.dataset.clicked = 'true'">◧</button>
      </div>
      <div class="host_newSessionRow"><div data-slot="sidebar.session.action"><button aria-label="新建会话">＋</button></div></div>
      <div class="host_scrollRegion"><div data-sidebar-scrollport>
        <div class="host_regionArea"><div data-slot="sidebar.workspaces">
          <div class="dsh-tavern-sidebar">
            <div class="dsh-tavern-side-head"><div class="dsh-tavern-side-brand"></div></div>
            <div class="dsh-tavern-mode-switch"><button>游玩</button><button>卡片</button></div>
          </div>
        </div></div>
      </div></div>
    </div>
  </body></html>`)
  await page.addStyleTag({ content: css })
  const brand = () => page.locator('.dsh-tavern-side-brand').boundingBox()
  assert.equal((await brand()).y, 50, '标题栏以下只留正常边距')
  await page.addStyleTag({ content: readFileSync(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8') })
  const paperBrand = await brand()
  assert.equal(paperBrand.y, 50, '纸感主题也不叠加额外顶部内边距')
  const modeSwitch = await page.locator('.dsh-tavern-mode-switch').boundingBox()
  assert.ok(modeSwitch.y >= paperBrand.y + paperBrand.height, '模式切换位于标志下方')
  const toggle = page.getByRole('button', { name: '收起侧栏' })
  assert.equal((await toggle.boundingBox()).y, 6)
  await toggle.click({ timeout: 2000 })
  assert.equal(await toggle.getAttribute('data-clicked'), 'true')
})

test('宽屏管理面板在移动端铺满卡片正文宽度、动作按钮下沉且 portal 压过宿主壳层', async t => {
  assert.match(sidebar, /portalOverlay\(historyManagerPanel\)/)
  assert.match(css, /\.dsh-tavern-picker-overlay \{ position: fixed; z-index: 1450;/)
  assert.match(css, /body:not\(\.dsh-tavern-picker-open\) \.dsh-tavern-story-return/)

  const { chromium } = await import('playwright')
  const themeCss = readFileSync(new URL('../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8')
  const paperCss = readFileSync(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())

  const html = `<!doctype html>
<html class="dsh-tavern-viewport-pinned" style="--dsh-vv-top: 0px; --dsh-vv-height: 823px;">
<head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body class="dsh-tavern-shell-active dsh-tavern-picker-open" data-dream-skin="paper">
  <div data-slot="root">
    <div class="host_frame" data-mobile-nav="frame">
      <div class="host_sidebarCol" style="position: fixed; inset: 0; z-index: 1300;">
        <div class="hHd-Xa_root" style="width: 280px;">
          <div class="hHd-Xa_logoRow"><button class="hHd-Xa_toggle" aria-label="收起侧边栏">◧</button></div>
          <div class="hHd-Xa_regionArea"><div data-slot="sidebar.workspaces"><div class="dsh-tavern-sidebar"></div></div></div>
          <div data-slot="sidebar.settings"><div><div data-slot="settings.launcher"><button data-signed-out="true" data-collapsed="false">··· </button></div></div></div>
        </div>
      </div>
      <div class="host_rightbarCol"><div data-sidebar-right-panel="fullscreen" data-sidebar-right-open="true"></div></div>
    </div>
  </div>
  <button type="button" class="dsh-tavern-story-return">‹ 回到故事</button>
  <div class="dsh-tavern-picker-overlay dsh-tavern-history-manager-overlay">
    <div class="dsh-tavern-history-manager" role="dialog" aria-modal="true" aria-label="会话管理">
      <div class="dsh-tavern-history-manager-head">
        <span>游玩历史 · 管理</span>
        <span class="dsh-tavern-history-manager-count">共 223 · 当前 223</span>
        <span class="dsh-tavern-spacer"></span>
        <button class="dsh-tavern-btn">关闭</button>
      </div>
      <div class="dsh-tavern-history-manager-toolbar">
        <input class="dsh-tavern-library-search dsh-tavern-history-manager-search" placeholder="搜索标题或对话内容" />
        <div class="dsh-tavern-history-manager-select"><button class="dsh-tavern-history-card-trigger">全部人物卡</button></div>
        <div class="dsh-tavern-history-manager-filters">
          <button class="dsh-tavern-history-manager-filter" aria-pressed="true">全部</button>
          <button class="dsh-tavern-history-manager-filter" aria-pressed="false">有交互</button>
          <button class="dsh-tavern-history-manager-filter" aria-pressed="false">仅开场</button>
          <button class="dsh-tavern-history-manager-filter" aria-pressed="false">已归档</button>
        </div>
      </div>
      <div class="dsh-tavern-history-manager-list">
        <div class="dsh-tavern-history-manager-row current">
          <input type="checkbox" class="dsh-tavern-history-manager-check" />
          <div class="dsh-tavern-history-manager-body">
            <div class="dsh-tavern-history-manager-headline">
              <span class="dsh-tavern-history-manager-title-group"><span class="dsh-tavern-history-manager-title">11/7 20:25 开局</span><button class="dsh-tavern-history-manager-rename-button" aria-label="重命名：11/7 20:25 开局"></button></span>
              <span class="dsh-tavern-history-manager-turn">23 轮</span>
              <span class="dsh-tavern-history-manager-time">11/12 11:42</span>
            </div>
            <div class="dsh-tavern-history-manager-card">示例角色卡</div>
            <div class="dsh-tavern-history-manager-preview">你：ok\n角色：多行预览文本在窄屏下应占满整行宽度，不在右侧留下大片空白。</div>
          </div>
          <div class="dsh-tavern-history-manager-actions">
            <button>打开</button><button>归档</button><button class="danger">删除</button>
          </div>
        </div>
      </div>
      <div class="dsh-tavern-history-manager-foot">
        <button class="dsh-tavern-btn">全选筛选结果</button>
        <button class="dsh-tavern-btn">取消选择</button>
        <span class="dsh-tavern-history-manager-selected">已选 1 个</span>
        <span class="dsh-tavern-spacer"></span>
        <button class="dsh-tavern-btn">归档所选（1）</button>
        <button class="dsh-tavern-btn" disabled>恢复所选</button>
        <button class="dsh-tavern-btn danger">彻底删除（1）</button>
      </div>
    </div>
  </div>
</body></html>`

  const mobileContext = await browser.newContext({ viewport: { width: 386, height: 823 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const mobile = await mobileContext.newPage()
  await mobile.setContent(html)
  await mobile.addStyleTag({ content: css + '\n' + themeCss + '\n' + paperCss })
  const m = await mobile.evaluate(() => {
    const dialog = document.querySelector('.dsh-tavern-history-manager')
    const row = document.querySelector('.dsh-tavern-history-manager-row')
    const body = row.querySelector('.dsh-tavern-history-manager-body')
    const actions = row.querySelector('.dsh-tavern-history-manager-actions')
    const search = document.querySelector('.dsh-tavern-history-manager-search').getBoundingClientRect()
    const select = document.querySelector('.dsh-tavern-history-manager-select').getBoundingClientRect()
    const footButtons = [...document.querySelectorAll('.dsh-tavern-history-manager-foot .dsh-tavern-btn')]
    const rr = row.getBoundingClientRect(), br = body.getBoundingClientRect(), ar = actions.getBoundingClientRect()
    const archiveHit = (() => {
      const btn = footButtons[2], r = btn.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return btn === hit || btn.contains(hit)
    })()
    return {
      bodyRatio: br.width / rr.width,
      actionsBelowBody: ar.top >= br.bottom - 1,
      actionsAlignedWithBody: Math.abs(ar.left - br.left) <= 2,
      selectMatchesSearchWidth: Math.abs(select.width - search.width) <= 2,
      archiveRowBelowSelectAll: footButtons[2].getBoundingClientRect().top >= footButtons[0].getBoundingClientRect().bottom - 1,
      archiveHit,
      storyReturnDisplay: getComputedStyle(document.querySelector('.dsh-tavern-story-return')).display,
      logoRowDisplay: getComputedStyle(document.querySelector('.hHd-Xa_logoRow')).display,
      opaqueDialogBg: /^rgb\(/.test(getComputedStyle(dialog).backgroundColor)
    }
  })
  assert.ok(m.bodyRatio > 0.82, `移动端会话正文应占满卡片宽度：${m.bodyRatio}`)
  assert.equal(m.actionsBelowBody, true, '移动端操作按钮应排在预览下方而不是挤占右列')
  assert.equal(m.actionsAlignedWithBody, true, '移动端操作按钮左边缘应与正文列对齐')
  assert.equal(m.selectMatchesSearchWidth, true, '移动端人物卡筛选下拉应占满整行宽度')
  assert.equal(m.archiveRowBelowSelectAll, true, '移动端底栏批量操作应独立换到下一行')
  assert.equal(m.archiveHit, true, '底栏归档按钮不应被宿主侧栏设置或回到故事浮层遮挡')
  assert.equal(m.storyReturnDisplay, 'none')
  assert.equal(m.logoRowDisplay, 'none')
  assert.equal(m.opaqueDialogBg, true)
  await mobileContext.close()

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const desktop = await desktopContext.newPage()
  await desktop.setContent(html)
  await desktop.addStyleTag({ content: css + '\n' + themeCss + '\n' + paperCss })
  const d = await desktop.evaluate(() => {
    const row = document.querySelector('.dsh-tavern-history-manager-row')
    const body = row.querySelector('.dsh-tavern-history-manager-body').getBoundingClientRect()
    const actions = row.querySelector('.dsh-tavern-history-manager-actions').getBoundingClientRect()
    return { actionsOnRight: actions.left >= body.right - 1 }
  })
  assert.equal(d.actionsOnRight, true, '桌面端保留右侧动作列')
  await desktopContext.close()
})


