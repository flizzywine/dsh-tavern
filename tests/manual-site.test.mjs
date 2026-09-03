import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { renderSite, readTopics, markdown } from '../docs/manual/build.mjs'
import { sections, help } from '../docs/manual/navigation.mjs'
import { topics } from '../docs/manual/topics.mjs'

const root = new URL('../docs/', import.meta.url)
const inventory = await readFile(new URL('feature-inventory.md', root), 'utf8')
const html = await readFile(new URL('index.html', root), 'utf8')
const sandbox = {}
vm.runInNewContext(await readFile(new URL('assets/manual-state.js', root), 'utf8'), sandbox)
const { resolveRoute, searchPages } = sandbox.DshManualState
const pages = [...html.matchAll(/<article class="doc-page" id="([^"]+)" data-group="([^"]+)" data-title="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, id, group, title, body]) => ({ id, group, title, text: body.replace(/<[^>]+>/g, ' '), body }))
const routeIds = [...html.matchAll(/<article class="doc-page" id="([^"]+)"/g)].map(m => m[1])

test('生成结果与文字源一致，避免修改源后忘记重新生成', () => {
  assert.equal(html, renderSite(inventory))
})

test('四个产品部分按认知顺序排列，帮助不算第五部分', () => {
  assert.deepEqual(sections.map(s => s.title), ['酒馆生态兼容', '游玩模式', '卡片模式', '高级功能'])
  assert.equal((html.match(/class="nav-group" data-group=/g) || []).length, 4)
  assert.equal(help.id, 'help')
  assert.equal(resolveRoute('', routeIds).id, 'compatibility')
})

test('全部 100 个主题都有独立完整文字与真实目录入口', () => {
  const rows = readTopics(inventory)
  assert.equal(rows.length, 100)
  assert.equal(Object.keys(topics).length, 100)
  assert.equal(pages.filter(p => /^[a-n]\d{2}$/.test(p.id)).length, 100)
  const navigation = [...sections, help].flatMap(g => g.chapters.flatMap(([, keys]) => keys.split(' ')))
  for (const row of rows) {
    assert.ok(navigation.includes(row.key), row.key)
    const page = pages.find(p => p.id === row.id)
    assert.ok(page, row.id)
    assert.ok(page.body.includes('在哪里'))
    assert.ok(page.body.includes('结果与生效范围'))
    assert.ok(page.body.includes('注意事项'))
    assert.ok(topics[row.key].steps.length > 0)
    for (const related of topics[row.key].related) assert.ok(topics[related], related)
  }
})

test('新文档页纯文字，无旧截图、图片占位和远程脚本', () => {
  assert.doesNotMatch(html, /<img\b|<picture\b|<video\b|<iframe\b|images\/readme\//)
  assert.doesNotMatch(html, /<script[^>]+src="https?:/)
  assert.ok(!/预设库（实验性）|保证永不失忆/.test(html))
  assert.match(pages.find(p => p.id === 'd11').body, /已停用/)
  assert.match(html, /截图将在内容定稿后补充/)
})

test('所有静态资源、文章与页内锚点存在，支持 GitHub Pages 子目录', async () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (value.startsWith('https://')) continue
    assert.ok(!value.startsWith('/'), value)
    if (value.startsWith('#')) assert.ok(ids.includes(value.slice(1)), value)
    else await access(new URL(value, root))
  }
})

test('深链接、旧入口、非法和不存在的地址都有确定结果', () => {
  assert.equal(resolveRoute('#b07', routeIds).id, 'b07')
  assert.equal(resolveRoute('#b07--section-2', routeIds).target, 'b07--section-2')
  assert.equal(resolveRoute('#b07--section-2', routeIds).id, 'b07')
  assert.equal(resolveRoute('#features', routeIds).id, 'index')
  assert.equal(resolveRoute('#create', routeIds).id, 'cards')
  assert.equal(resolveRoute('#%E0%A4%A', routeIds).id, 'not-found')
  assert.equal(resolveRoute('#unknown', routeIds).id, 'not-found')
})

test('搜索匹配中文正文、标题、大小写及多个关键词，处理空和无结果', () => {
  assert.ok(searchPages(pages, '用户画像').some(p => p.id === 'e01'))
  assert.ok(searchPages(pages, 'MVU').some(p => p.id === 'd02'))
  assert.ok(searchPages(pages, 'mvu').some(p => p.id === 'd02'))
  assert.ok(searchPages(pages, '后台 人物').some(p => p.id === 'd10'))
  assert.ok(searchPages(pages, '重写')[0].title.includes('重写') || searchPages(pages, '重写')[0].text.includes('重写'))
  assert.equal(searchPages(pages, '不存在的功能xyz').length, 0)
  assert.equal(searchPages(pages, '   ').length, 5)
})

test('生图与画像是高级功能，后台设计与搜索分别有独立页面', () => {
  for (const id of ['e01', 'e04', 'd10', 'm02', 'f01', 'h07']) assert.equal(pages.find(p => p.id === id).group, 'advanced')
  assert.match(pages.find(p => p.id === 'e04').body, /默认关闭/)
  assert.match(pages.find(p => p.id === 'e04').body, /不会改变已有游戏/)
  assert.match(pages.find(p => p.id === 'd10').body, /没有独立玩家按钮/)
  assert.match(pages.find(p => p.id === 'm02').body, /改设置不改变旧局/)
  assert.match(pages.find(p => p.id === 'f09').body, /重试保存/)
})

test('关闭 JavaScript 后所有正文仍可顺序阅读', () => {
  for (const page of pages) assert.ok(page.text.length > 100, page.id)
  assert.doesNotMatch(html, /<article[^>]*\bhidden\b/)
  assert.match(html, /<noscript>/)
  assert.match(html, /href="#main">跳到正文/)
})

test('Markdown 转换转义原始 HTML，只允许安全链接，生成语义表格', () => {
  const result = markdown('## 标题\n\n<script>alert(1)</script>\n\n[不安全](javascript:alert)\n\n[文档](#play)\n\n| 名称 | 说明 |\n| --- | --- |\n| 内容 | 正文 |', 'test')
  assert.doesNotMatch(result, /<script>|href="javascript:/)
  assert.match(result, /&lt;script&gt;/)
  assert.match(result, /href="#play"/)
  assert.match(result, /<th scope="col">名称/)
})
