import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { renderSite, readTopics, markdown, escapeHTML } from '../docs/manual/build.mjs'
import { sections, help, gettingStarted } from '../docs/manual/navigation.mjs'
import { topics } from '../docs/manual/topics.mjs'
import { installCommands } from '../docs/manual/introduction.mjs'
import { adaptedDshVersion } from '../bin/dsh-compatibility.mjs'
import { screenshots, pageScreenshots, screenshotSource } from '../docs/manual/screenshots.mjs'
import { demoDownloads } from '../examples/manual-demo/downloads.mjs'

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
  assert.equal(resolveRoute('', routeIds).id, 'a01')
})

test('全部 100 个主题都有独立完整文字与真实目录入口', () => {
  const rows = readTopics(inventory)
  assert.equal(rows.length, 100)
  assert.equal(Object.keys(topics).length, 100)
  assert.equal(pages.filter(p => /^[a-n]\d{2}$/.test(p.id)).length, 100)
  const navigation = [gettingStarted, ...sections, help].flatMap(g => g.chapters.flatMap(([, keys]) => keys.split(' ')))
  for (const row of rows) {
    assert.ok(navigation.includes(row.key), row.key)
    const page = pages.find(p => p.id === row.id)
    assert.ok(page, row.id)
    if (!['A01', 'A02'].includes(row.key)) {
      assert.ok(page.body.includes('在哪里'))
      assert.ok(page.body.includes('结果与生效范围'))
      assert.ok(page.body.includes('注意事项'))
    }
    assert.ok(topics[row.key].steps.length > 0)
    for (const related of topics[row.key].related) assert.ok(topics[related], related)
  }
})

test('产品概览和安装是独立入门入口，默认首页先讲产品和界面', () => {
  assert.ok(html.indexOf('aria-label="入门指南"') < html.indexOf('aria-label="四部分文档目录"'))
  assert.equal(pages[0].id, 'a01')
  assert.equal(pages[1].id, 'a02')
  for (const id of ['a01', 'a02']) assert.equal(pages.find(p => p.id === id).group, 'getting-started')
  const intro = pages.find(p => p.id === 'a01').body
  for (const term of ['DSH Tavern 是什么', '两种主要使用方式', '界面大概是什么样', '一次游玩是怎样的', '开始前需要准备什么']) assert.ok(intro.includes(term), term)
  assert.match(intro, /href="#a02"/)
  assert.equal(resolveRoute('#main', routeIds).id, 'a01')
  assert.equal(resolveRoute('#start', routeIds).id, 'a02')
})

test('安装页提供与 README 一致的可复制命令、当前适配版本和各平台步骤', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const install = pages.find(p => p.id === 'a02').body
  for (const command of Object.values(installCommands)) {
    assert.ok(readme.includes(command), 'Installation command must match README')
    assert.ok(install.includes(`<code>${escapeHTML(command)}</code>`), 'Commands must remain literal text')
  }
  for (const term of ['方式一：桌面版', '方式二：命令行版', 'Open DSH Terminal', '配置模型并开始第一局', '关机后如何重新打开', '更新与重新安装', 'Android：实验性安装', '安装失败时', adaptedDshVersion]) assert.ok(install.includes(term), term)
  assert.match(install, /class="copy-code"/)
  assert.match(install, /不要分享给别人/)
  assert.doesNotMatch(install, /\{\{dshVersion\}\}|```/)
})

test('代码块保持命令原文，转义 HTML 且不误识别管道和 Markdown', () => {
  const command = "echo '<script>**raw**</script>' | next --arg='a&b'\n# heading"
  const rendered = markdown('```bash\n' + command + '\n```', 'test')
  assert.ok(rendered.includes(`<code>${escapeHTML(command)}</code>`))
  assert.doesNotMatch(rendered, /<script>|<strong>|<table>|<h2/)
})

test('文档只采用独立样例截图，不复用旧图片或加载远程脚本', () => {
  assert.doesNotMatch(html, /<picture\b|<video\b|<iframe\b|images\/readme\//)
  assert.doesNotMatch(html, /<script[^>]+src="https?:/)
  assert.ok(!/预设库（实验性）|保证永不失忆/.test(html))
  assert.match(pages.find(p => p.id === 'd11').body, /已停用/)
  assert.doesNotMatch(html, /截图将在内容定稿后补充|暂不使用旧版截图/)
  assert.match(html, /界面截图均使用公开样例/)
})

test('截图有有效本地资源、替代文字、说明、来源与放大入口', async () => {
  const expected = Object.values(pageScreenshots).flat().length
  assert.equal((html.match(/<figure class="manual-screenshot">/g) || []).length, expected)
  assert.equal((html.match(/<img /g) || []).length, expected)
  for (const [id, keys] of Object.entries(pageScreenshots)) {
    const body = pages.find(p => p.id === id)?.body
    assert.ok(body, id)
    assert.ok(body.includes(screenshotSource.label))
    assert.ok(body.includes(screenshotSource.runtime))
    for (const key of keys) {
      const shot = screenshots[key]
      assert.ok(shot?.alt && shot?.caption, key)
      const src = `images/manual/${shot.file}`
      assert.ok(body.includes(`href="${src}" target="_blank" rel="noopener noreferrer"`))
      assert.ok(body.includes(`src="${src}" alt="${escapeHTML(shot.alt)}" width="1309" height="707" loading="lazy"`))
      const bytes = await readFile(new URL(src, root))
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], `${src} must be a real JPEG capture`)
      assert.ok(bytes.length > 10000)
    }
  }
  const provenance = await readFile(new URL('../examples/manual-demo/README.md', import.meta.url), 'utf8')
  assert.match(provenance, /CC0/)
  assert.match(provenance, /独立 DSH Profile/)
})

test('网页公开样例下载与原创源数据一致，人物卡没有远程脚本依赖', async () => {
  for (const [name, source] of Object.entries(demoDownloads)) {
    assert.equal(await readFile(new URL(`examples/manual-demo/${name}`, root), 'utf8'), source)
  }
  const card = JSON.parse(demoDownloads['lighthouse-card.json'])
  assert.equal(card.spec, 'chara_card_v3')
  assert.deepEqual(card.data.extensions.tavern_helper.scripts, [])
  assert.doesNotMatch(demoDownloads['lighthouse-card.json'], /https?:\/\/|\/Users\//)
  assert.match(demoDownloads['README.txt'], /CC0/)
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
