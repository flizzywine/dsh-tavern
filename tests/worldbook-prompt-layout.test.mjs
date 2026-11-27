import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { buildWorldBookPromptLayout, WORLD_BOOK_LAYOUT_PREVIEW_LIMIT } from '../tavern-plugin/lib/domain/worldbook-prompt-layout.js'
import { planWorldBookLayoutReorder } from '../tavern-plugin/lib/domain/worldbook-layout-reorder.js'
import { projectVirtualWorldbookPrefix } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { activateWorldBook, promptOrder } from '../tavern-plugin/lib/domain/worldbook-activation.js'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'
import { browserReactScript } from './fixtures/browser-react.mjs'

function createMemoryWorldBookEnv({ cardsData = {}, standaloneData = {}, bindings = {}, globals = [] } = {}) {
  const cardsStore = new Map(Object.entries(cardsData).map(([k, v]) => [k, structuredClone(v)]))
  const filesStore = new Map(Object.entries(standaloneData).map(([k, v]) => [k, JSON.stringify(v, null, 2)]))
  const bindingStore = new Map(Object.entries(bindings))
  const globalSet = new Set(globals)

  const resources = {
    async list() { return [...filesStore.keys()] },
    async readText(path) { return filesStore.get(path) },
    async write(path, text) { filesStore.set(path, text) },
    async import(_prepared, working) {
      const path = 'worldbooks/imported-' + filesStore.size + '.json'
      filesStore.set(path, JSON.stringify(working, null, 2))
      return path
    },
    async globalSources() { return [...globalSet].map(path => ({ kind: 'standalone', path })) },
    async setGlobal(path, enabled) { if (enabled) globalSet.add(path); else globalSet.delete(path) },
    async bindingForCard(cardPath) { return bindingStore.get(cardPath) || { kind: 'default' } },
    async bindMany(cardPath, sources) {
      if (!sources.length) bindingStore.set(cardPath, { kind: 'none' })
      else if (sources.length === 1) bindingStore.set(cardPath, { ...sources[0], available: true })
      else bindingStore.set(cardPath, { kind: 'multiple', sources: sources.map(s => ({ ...s, available: true })) })
    },
    async unbind(cardPath) { bindingStore.set(cardPath, { kind: 'none' }) }
  }

  const cards = {
    async listPaths() { return [...cardsStore.keys()] },
    async read(cardPath) { return cardsStore.has(cardPath) ? structuredClone(cardsStore.get(cardPath)) : undefined },
    async update(cardPath, patch) {
      const prev = cardsStore.get(cardPath)
      if (!prev) throw new Error('人物卡不存在: ' + cardPath)
      cardsStore.set(cardPath, { ...prev, ...patch })
    }
  }

  const worldBooks = createWorldBookLibrary({
    resources,
    cards,
    normalizePath: value => String(value || ''),
    removeStandalone: async path => { filesStore.delete(path); globalSet.delete(path); return { removed: path } }
  })

  return { worldBooks, cardsStore, filesStore, globalSet }
}

function makeFixtures() {
  const card = {
    name: 'Aethelgard',
    character_book: {
      name: 'Aethelgard 主书',
      token_budget: 8192,
      entries: [
        { id: 1, comment: '世界观总纲', content: '纪元法则正文', enabled: true, constant: true, insertion_order: 100, position: 'before_char', extensions: { position: 0, display_index: 0 } },
        { id: 2, comment: '北境地理', content: '北境城邦正文', enabled: true, constant: true, insertion_order: 100, position: 'before_char', extensions: { position: 0, display_index: 1 } },
        { id: 3, comment: '势力关系', content: '三大势力正文', enabled: true, constant: true, insertion_order: 20, position: 'after_char', extensions: { position: 1, display_index: 2 } },
        { id: 4, comment: '战斗规则', content: '检定结算规则', enabled: true, constant: true, insertion_order: 60, position: 'after_char', extensions: { position: 1, display_index: 3, tavern_channel: 'tail' } },
        { id: 5, comment: '普通触发条目', content: '只在提到钟楼时检索', enabled: true, constant: false, keys: ['钟楼'], insertion_order: 50, position: 'before_char', extensions: { position: 0, display_index: 4 } },
        { id: 6, comment: '[mvu_update] 变量规则', content: '仅后台更新', enabled: true, constant: true, insertion_order: 10, position: 'before_char', extensions: { position: 0, display_index: 5 } },
        { id: 7, comment: '已禁用条目', content: '不应显示', enabled: false, constant: true, insertion_order: 10, position: 'before_char', extensions: { position: 0, display_index: 6 } }
      ]
    }
  }

  const globalBook = {
    name: '文风工具箱',
    entries: {
      '0': { uid: 0, comment: '文风规则', content: '全局文风正文', disable: false, constant: true, order: 100, position: 0, displayIndex: 0, extensions: {} },
      '1': { uid: 1, comment: '禁词强注', content: '非常驻但钉在前缀', disable: false, constant: false, key: ['禁词'], order: 15, position: 0, displayIndex: 1, extensions: { tavern_channel: 'prefix' } },
      '2': { uid: 2, comment: '动态状态', content: '当前地点：{{getvar::location}}', disable: false, constant: true, order: 90, position: 0, displayIndex: 2, extensions: { tavern_channel: 'prefix' } }
    }
  }

  return { card, globalBook }
}

test('不变量对照：常驻排布的 prefix 串联正文与实际稳定前缀、foreground-worldbook 完全一致，且排除 MVU 与禁用条目', async () => {
  const { card, globalBook } = makeFixtures()
  const { worldBooks } = createMemoryWorldBookEnv({
    cardsData: { 'cards/aethelgard.json': card },
    standaloneData: { 'worldbooks/style.json': globalBook },
    globals: ['worldbooks/style.json']
  })

  const chat = { id: 'chat-1', sessionId: 'sess-1', cardPath: 'cards/aethelgard.json', cardName: 'Aethelgard', messages: [] }
  const merged = await worldBooks.bound(chat.cardPath, card, chat)
  const layout = await worldBooks.promptLayout(chat.cardPath, card, chat)

  // 1) 与 projectVirtualWorldbookPrefix 逐字节一致
  const expectedPrefix = projectVirtualWorldbookPrefix(merged, chat, { restore: false }).staticPrefix
  const layoutPrefixText = layout.prefix.map(item => item.preview).join('\n\n')
  assert.equal(layoutPrefixText, expectedPrefix)

  // 2) 与 foreground-worldbook 实际请求投影的 staticPrefix 一致
  const project = createForegroundWorldbook({
    bound: async () => merged,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }),
    globalVariables: async () => ({})
  })
  const foreground = await project({ requestKey: 'r1', chat, card, userText: '你好' })
  assert.equal(layoutPrefixText, foreground.staticPrefix)

  // 3) 检查内容过滤：不含 MVU、不含禁用条目、不含普通触发条目；动态条目即使标 prefix 也落入 tail 且锁定
  const allTitles = layout.prefix.concat(layout.tail).map(item => item.title)
  assert.equal(allTitles.includes('[mvu_update] 变量规则'), false)
  assert.equal(allTitles.includes('已禁用条目'), false)
  assert.equal(allTitles.includes('普通触发条目'), false)

  // 同 order=100 时全局书 displayIndex 更大，经 promptOrder 排在主书之前
  assert.deepEqual(layout.prefix.map(item => item.title), ['禁词强注', '文风规则', '北境地理', '世界观总纲', '势力关系'])

  const dynItem = layout.tail.find(item => item.title === '动态状态')
  assert.ok(dynItem, '动态条目应出现在每轮尾部')
  assert.equal(dynItem.dynamic, true)
  assert.equal(dynItem.lockedToTail, true)

  const tailStatic = layout.tail.find(item => item.title === '战斗规则')
  assert.ok(tailStatic, '显式 tail 通道条目应出现在每轮尾部')
  assert.equal(tailStatic.lockedToTail, false)
})

test('尾部预算挤出判定与 activateWorldBook 一致（高 order 优先入选，低 order 超限时标记 budgetEvicted）', async () => {
  const tightBook = {
    name: '预算测试书',
    token_budget: 25,
    entries: {
      '0': { uid: 0, comment: '高优尾部', content: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸', disable: false, constant: true, order: 200, position: 0, displayIndex: 0, extensions: { tavern_channel: 'tail' } },
      '1': { uid: 1, comment: '中优尾部', content: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸', disable: false, constant: true, order: 100, position: 0, displayIndex: 1, extensions: { tavern_channel: 'tail' } },
      '2': { uid: 2, comment: '低优尾部', content: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸', disable: false, constant: true, order: 50, position: 0, displayIndex: 2, extensions: { tavern_channel: 'tail' } }
    }
  }
  const { worldBooks } = createMemoryWorldBookEnv({
    standaloneData: { 'worldbooks/tight.json': tightBook },
    globals: ['worldbooks/tight.json']
  })

  const record = await worldBooks.get({ kind: 'standalone', path: 'worldbooks/tight.json' })
  const activated = activateWorldBook({
    worldBook: record,
    entries: record.view.entries,
    chat: { messages: [] },
    turn: 1,
    userText: '继续',
    isCoolingDown: () => false
  })
  const evictedByActivation = new Set(activated.diagnostics.filter(d => d.reason === 'budget').map(d => d.ref))
  assert.ok(evictedByActivation.size > 0, '预算收紧后应触发挤出')

  const layout = await worldBooks.promptLayout('', undefined, null)
  assert.equal(layout.budget.limit, 25)
  assert.equal(layout.budget.overflowed, true)
  const evictedByLayout = new Set(layout.tail.filter(item => item.budgetEvicted).map(item => item.entryRef))
  assert.deepEqual(evictedByLayout, evictedByActivation)
  assert.equal(layout.tail.find(item => item.title === '高优尾部').budgetEvicted, false)
  assert.equal(layout.tail.find(item => item.title === '低优尾部').budgetEvicted, true)
})

test('拖拽重排写回往返：同 order 无空隙重编、跨 position 分桶对齐、跨通道换区、动态锁定拦截', async () => {
  const { card, globalBook } = makeFixtures()
  const { worldBooks } = createMemoryWorldBookEnv({
    cardsData: { 'cards/aethelgard.json': card },
    standaloneData: { 'worldbooks/style.json': globalBook },
    globals: ['worldbooks/style.json']
  })
  const chat = { id: 'chat-1', sessionId: 'sess-1', cardPath: 'cards/aethelgard.json', cardName: 'Aethelgard', messages: [] }

  // 辅助：应用 planner 产出的 updates 到真实 worldBooks，再重新读取 layout
  async function applyPlan(plan) {
    assert.equal(plan.ok, true)
    for (const u of plan.updates) {
      await worldBooks.update(u.source, { operations: u.operations })
    }
    return await worldBooks.promptLayout(chat.cardPath, undefined, chat)
  }

  let layout = await worldBooks.promptLayout(chat.cardPath, undefined, chat)
  // 初始前缀顺序：['禁词强注', '文风规则', '北境地理', '世界观总纲', '势力关系']
  // 1) 把「世界观总纲」(order=100) 移到「文风规则」(order=100) 和「北境地理」(order=100) 之间 -> 无整数空隙，自动重编 10/20/30…
  const worldId = layout.prefix.find(i => i.title === '世界观总纲').id
  const plan1 = planWorldBookLayoutReorder({ prefix: layout.prefix, tail: layout.tail, movedId: worldId, targetZone: 'prefix', targetIndex: 2 })
  assert.equal(plan1.prefixChanged, true)
  assert.ok(plan1.affectedGlobalBooks.includes('文风工具箱'), '涉及全局书重编应提示全局书名')
  layout = await applyPlan(plan1)
  assert.deepEqual(layout.prefix.map(i => i.title), ['禁词强注', '文风规则', '世界观总纲', '北境地理', '势力关系'])

  // 2) 跨 position 分桶：把「势力关系」(position=1) 拖到最前（position=0 区域），写回后仍稳居首位
  const factionId = layout.prefix.find(i => i.title === '势力关系').id
  const plan2 = planWorldBookLayoutReorder({ prefix: layout.prefix, tail: layout.tail, movedId: factionId, targetZone: 'prefix', targetIndex: 0 })
  layout = await applyPlan(plan2)
  assert.equal(layout.prefix[0].title, '势力关系')
  assert.equal(layout.prefix[0].placementKey, '0')

  // 3) 跨通道：把「北境地理」从稳定前缀拖入每轮尾部首位
  const northId = layout.prefix.find(i => i.title === '北境地理').id
  const plan3 = planWorldBookLayoutReorder({ prefix: layout.prefix, tail: layout.tail, movedId: northId, targetZone: 'tail', targetIndex: 0 })
  assert.equal(plan3.channelChanged, true)
  assert.equal(plan3.prefixChanged, true)
  layout = await applyPlan(plan3)
  assert.equal(layout.prefix.some(i => i.title === '北境地理'), false)
  assert.equal(layout.tail[0].title, '北境地理')
  assert.equal(layout.tail[0].channel, 'tail')

  // 4) 动态锁定拦截：把「动态状态」拖进稳定前缀应被拒绝
  const dynId = layout.tail.find(i => i.title === '动态状态').id
  const blocked = planWorldBookLayoutReorder({ prefix: layout.prefix, tail: layout.tail, movedId: dynId, targetZone: 'prefix', targetIndex: 0 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'dynamic-locked')

  // 5) 每次写回后，prefix 串联正文依然与实时 projectVirtualWorldbookPrefix 严丝合缝
  const mergedNow = await worldBooks.bound(chat.cardPath, undefined, chat)
  assert.equal(
    layout.prefix.map(i => i.preview).join('\n\n'),
    projectVirtualWorldbookPrefix(mergedNow, chat, { restore: false }).staticPrefix
  )
})

test('RPC getWorldBookPromptLayout 与 getWorldBookEntryContent：覆盖无会话只算全局、开局快照标记与长正文按需全文读取', async () => {
  const longText = '甲'.repeat(WORLD_BOOK_LAYOUT_PREVIEW_LIMIT + 321)
  const { card } = makeFixtures()
  const globalLong = {
    name: '长文全局书',
    entries: {
      '0': { uid: 0, comment: '超长条目', content: longText, disable: false, constant: true, order: 10, position: 0, displayIndex: 0, extensions: {} }
    }
  }
  const { worldBooks } = createMemoryWorldBookEnv({
    cardsData: { 'cards/aethelgard.json': card },
    standaloneData: { 'worldbooks/long.json': globalLong },
    globals: ['worldbooks/long.json']
  })

  const chats = {
    'sess-snap': {
      cardPath: 'cards/aethelgard.json',
      cardName: 'Aethelgard',
      mode: 'play',
      openingWorldbookSnapshot: { version: 1, source: { kind: 'card', cardPath: 'cards/aethelgard.json' }, document: card.character_book }
    }
  }
  const handlers = createResourceHandlers({
    worldBooks,
    str: v => v == null ? '' : String(v),
    chatHeaderForSession: async id => chats[id] || null
  })

  // 无会话 -> 只返回全局书，且超长条目正确截断预览
  const globalOnly = await handlers.getWorldBookPromptLayout({ sessionId: '' })
  assert.equal(globalOnly.cardName, '')
  assert.equal(globalOnly.openingSnapshot, false)
  assert.deepEqual(globalOnly.books.map(b => b.name), ['长文全局书'])
  assert.equal(globalOnly.prefix.length, 1)
  assert.equal(globalOnly.prefix[0].contentTruncated, true)
  assert.equal(globalOnly.prefix[0].preview.length, WORLD_BOOK_LAYOUT_PREVIEW_LIMIT)
  assert.equal(globalOnly.prefix[0].contentLength, longText.length)

  // 按需读取完整正文
  const full = await handlers.getWorldBookEntryContent({
    source: globalOnly.prefix[0].bookSource,
    ref: globalOnly.prefix[0].entryRef
  })
  assert.equal(full.content, longText)

  // 开局快照会话 -> 标明 openingSnapshot: true
  const snapLayout = await handlers.getWorldBookPromptLayout({ sessionId: 'sess-snap' })
  assert.equal(snapLayout.cardName, 'Aethelgard')
  assert.equal(snapLayout.openingSnapshot, true)
  assert.ok(snapLayout.books.some(b => b.name === 'Aethelgard 主书'))
  assert.ok(snapLayout.books.some(b => b.name === '长文全局书'))
})

test('边界场景：没有任何生效世界书时 buildWorldBookPromptLayout 返回空结构而非报错', () => {
  const empty = buildWorldBookPromptLayout({ records: [] })
  assert.deepEqual(empty.prefix, [])
  assert.deepEqual(empty.tail, [])
  assert.equal(empty.summary.totalCount, 0)
  assert.equal(empty.budget.used, 0)
  assert.equal(promptOrder([]).length, 0)
})

test('真实浏览器（桌面 + 移动端）：入口进入常驻排布、防误触快速查看全文、调序持久化与跳原书编辑', async t => {
  const longBody = '北境长卷设定。'.repeat(700)
  const { card } = makeFixtures()
  card.character_book.entries[1].content = longBody
  const { worldBooks } = createMemoryWorldBookEnv({
    cardsData: { 'cards/aethelgard.json': card },
    standaloneData: {},
    globals: []
  })
  const handlers = createResourceHandlers({
    worldBooks,
    str: v => v == null ? '' : String(v),
    chatHeaderForSession: async () => ({ cardPath: 'cards/aethelgard.json', cardName: 'Aethelgard', mode: 'play' })
  })

  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8')
    + '\n' + await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const mount = `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};`
  const start = `(() => {
    let library, tab = { id: 'wb-tab', meta: null }
    const root = modules['react-dom/client'].createRoot(document.querySelector('main'))
    const ctx = {
      effect(run, label) { if (label === 'dsh-tavern: Better Sidebar worldbook library tab') return run() },
      inject() { return { dispose() {} } }, get() {}, provide() {}, slots: {}, tavernSessionSignals: { subscribe() { return () => {} } },
      betterSidebar: { registerTab(spec) { library = spec.component }, updateTab(id, patch) { tab = { ...tab, ...patch }; render() } }
    }
    const render = () => root.render(modules.react.createElement(library, { tab, scope: { sessionId: 'fixture' }, ctx, visible: true }))
    window.client.apply(ctx)
    render()
  })()`
  const script = body => `<script>${body.replaceAll('</script', '<\\/script')}</script>`
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>常驻排布验证</title><style>${css}\nhtml,body{margin:0;height:100%}main{height:100vh;display:flex;flex-direction:column}</style>` +
    `<body><main></main>${script(await browserReactScript())}${script(mount)}${script(client)}${script(start)}</body></html>`

  const server = createServer(async (req, res) => {
    if (req.method === 'GET') return req.url === '/' ? res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html) : res.writeHead(404).end()
    let body = ''
    for await (const chunk of req) body += chunk
    const method = new URL(req.url, 'http://fixture').pathname.split('/').at(-1)
    const args = body ? JSON.parse(body) : {}
    try {
      const result = typeof handlers[method] === 'function' ? await handlers[method](args) : {}
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } })
  const pageErrors = []
  page.on('pageerror', err => pageErrors.push(err))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)

  // 1) 从世界书库标题右侧「常驻排布」入口进入
  const entryBtn = page.locator('button.dsh-wbl-entry-btn')
  await entryBtn.waitFor()
  await entryBtn.click()
  await page.locator('.dsh-wbl-page').waitFor()

  // 2) 防误触验证：普通点击条目文字区域不会弹出预览弹窗
  const firstRow = page.locator('ul[aria-label="稳定前缀条目"] > li.dsh-wbl-row').first()
  await firstRow.locator('.dsh-wbl-name').click()
  assert.equal(await page.locator('.dsh-wbl-preview-modal').count(), 0)

  // 3) 点击显式「查看内容」按钮，校验长正文按需全文加载（>4000字）
  await page.locator('button.dsh-wbl-preview-btn[aria-label*="北境地理"]').click()
  const previewText = page.locator('.dsh-wbl-preview-text')
  await previewText.waitFor()
  await page.waitForFunction(len => (document.querySelector('.dsh-wbl-preview-text')?.textContent?.length || 0) === len, longBody.length)

  // 4) 点「去原书编辑」直接跳到原书并自动展开对应条目，点返回回到排布页
  await page.getByRole('button', { name: '去原书编辑' }).click()
  await page.locator('.dsh-wbd-entry[data-open]').filter({ has: page.locator('button[title="北境地理"]') }).waitFor()
  await page.locator('button.dsh-card-back').click()
  await page.locator('.dsh-wbl-page').waitFor()

  // 5) 桌面端点击「下移」按钮调整稳定前缀第一条顺序，校验缓存中断徽章与持久化回读
  const beforeNames = await page.locator('ul[aria-label="稳定前缀条目"] .dsh-wbl-name').allInnerTexts()
  await page.locator('ul[aria-label="稳定前缀条目"] > li.dsh-wbl-row').first().locator('button[aria-label^="下移"]').click()
  await page.locator('.dsh-wbl-pill.is-warn').waitFor()
  await page.waitForFunction(first => document.querySelector('ul[aria-label="稳定前缀条目"] .dsh-wbl-name')?.textContent !== first, beforeNames[0])
  const afterNames = await page.locator('ul[aria-label="稳定前缀条目"] .dsh-wbl-name').allInnerTexts()
  assert.equal(afterNames[0], beforeNames[1])
  assert.equal(afterNames[1], beforeNames[0])

  const desktopRowHeight = await page.evaluate(() => Math.round(document.querySelector('.dsh-wbl-row').getBoundingClientRect().height))

  // 6) 移动端 390px 视口验证：无横向溢出、条目更紧凑（不高过桌面端），显式查看按钮可打开底部预览
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.locator('button.dsh-wbl-entry-btn').click()
  await page.locator('.dsh-wbl-page').waitFor()
  const reloadedNames = await page.locator('ul[aria-label="稳定前缀条目"] .dsh-wbl-name').allInnerTexts()
  assert.deepEqual(reloadedNames, afterNames, '刷新后应保持已持久化的新顺序')
  const mobileRowHeight = await page.evaluate(() => Math.round(document.querySelector('.dsh-wbl-row').getBoundingClientRect().height))
  assert.ok(mobileRowHeight <= desktopRowHeight && mobileRowHeight <= 50, `移动端单行应比桌面端更紧凑，实际 mobile=${mobileRowHeight}px desktop=${desktopRowHeight}px`)
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(overflowX <= 1, '移动端不应出现横向滚动溢出，实际溢出：' + overflowX)
  await page.locator('button.dsh-wbl-preview-btn').first().click()
  await page.locator('.dsh-wbl-preview-modal').waitFor()

  assert.deepEqual(pageErrors, [])
})
