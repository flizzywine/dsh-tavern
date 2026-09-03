import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { sections, help, overview } from './navigation.mjs'
import { topics as topicContent } from './topics.mjs'

export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const inline = text => escapeHTML(text).replace(/\[([^\]]+)\]\((#[a-z0-9-]+|https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

// Intentionally limited to the Markdown used by this manual; raw HTML is escaped.
export function markdown(source, route) {
  const lines = source.trim().split('\n'), output = []
  let heading = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('## ')) { output.push(`<h2 id="${route}--section-${++heading}">${inline(line.slice(3))}</h2>`); continue }
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim())
      i--
      const cells = row => row.slice(1, -1).split('|').map(x => inline(x.trim()))
      output.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="说明表格"><table><thead><tr>${cells(rows[0]).map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${cells(row).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (/^(?:- |\d+\. )/.test(line)) {
      const ordered = /^\d+/.test(line), tag = ordered ? 'ol' : 'ul', pattern = ordered ? /^\d+\. / : /^- /, items = []
      while (i < lines.length && pattern.test(lines[i].trim())) items.push(`<li>${inline(lines[i++].trim().replace(pattern, ''))}</li>`)
      i--
      output.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }
    output.push(`<p>${inline(line)}</p>`)
  }
  return output.join('\n')
}

export function readTopics(inventory) {
  return [...inventory.matchAll(/^\| ([A-N]\d{2}) \| (.*?) \| (.*?) \| (.*?) \|$/gm)].map(([, id, title, entry, description]) => ({ id: id.toLowerCase(), key: id, title, entry, description }))
}

const link = (id, label, cls = '') => `<a class="${cls}" href="#${id}">${escapeHTML(label)}</a>`

export function renderSite(inventory) {
  const topics = readTopics(inventory), byId = new Map(topics.map(t => [t.key, t]))
  const groups = [...sections, help]
  const owner = new Map()
  for (const group of groups) for (const [, keys] of group.chapters) for (const key of keys.split(' ')) if (!owner.has(key)) owner.set(key, group)
  // Shared links point to one article; its main home follows the user's task.
  for (const [key, id] of Object.entries({ I01: 'play', J01: 'cards', L02: 'cards', D02: 'play' })) owner.set(key, groups.find(g => g.id === id))
  if (topics.length !== 100 || owner.size !== 100 || topics.some(t => !owner.has(t.key))) throw new Error('The manual must cover every inventory topic exactly once or via shared links.')
  const allPages = groups.map(g => ({ ...g, group: g.id, content: overview[g.id] }))
  const orderedTopics = groups.flatMap(g => [...new Set(g.chapters.flatMap(([, keys]) => keys.split(' ')))].filter(key => owner.get(key) === g).map(key => byId.get(key)))
  for (const topic of orderedTopics) {
    const content = topicContent[topic.key]
    if (!content?.intro || !content.steps?.length || !content.result || !content.note) throw new Error(`Missing text: ${topic.key}`)
    const related = content.related.map(key => { const target = byId.get(key); if (!target) throw new Error(`Missing related topic: ${key}`); return `- [${target.title}](#${target.id})` }).join('\n')
    allPages.push({ ...topic, group: owner.get(topic.key).id, intro: content.intro, content: `## 在哪里\n\n${topic.entry}\n\n## ${topic.entry.startsWith('自动') ? '怎样参与游玩' : '如何使用'}\n\n${content.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n## 结果与生效范围\n\n${content.result}\n\n## 注意事项\n\n${content.note}\n\n${related ? '## 相关说明\n\n' + related : ''}` })
  }
  const navGroup = (group, index) => `<section class="nav-group" data-group="${group.id}"><div class="nav-group-heading">${link(group.id, `${index + 1}. ${group.title}`)}<button class="group-toggle" aria-expanded="true" aria-controls="nav-${group.id}" aria-label="折叠${group.title}">⌄</button></div><div id="nav-${group.id}" class="nav-children">${link(group.id, '概览', 'overview-link')}${group.chapters.map(([name, keys]) => `<details class="chapter"><summary>${escapeHTML(name)}</summary><div>${keys.split(' ').map(key => link(byId.get(key).id, byId.get(key).title)).join('')}</div></details>`).join('')}</div></section>`
  const article = page => {
    const group = groups.find(g => g.id === page.group)
    const directory = page.chapters ? `<h2 id="${page.id}--topics">逐项查阅</h2>` + page.chapters.map(([name, keys]) => `<h3>${escapeHTML(name)}</h3><ul class="topic-list">${keys.split(' ').map(key => `<li>${link(byId.get(key).id, byId.get(key).title)}</li>`).join('')}</ul>`).join('') : ''
    const siblings = page.key ? [...new Set(group.chapters.flatMap(([, keys]) => keys.split(' ')))].filter(key => owner.get(key) === group) : []
    const at = siblings.indexOf(page.key), previous = byId.get(siblings[at - 1]), next = byId.get(siblings[at + 1])
    const pagination = page.key ? `<nav class="pagination" aria-label="相邻文档">${previous ? link(previous.id, `← ${previous.title}`) : link(group.id, `← ${group.title}`)}${next ? link(next.id, `${next.title} →`) : link('index', '全部功能索引 →')}</nav>` : ''
    return `<article class="doc-page" id="${page.id}" data-group="${page.group}" data-title="${escapeHTML(page.title)}"><div class="breadcrumb">使用文档 <span>/</span> ${link(group.id, group.title)}${page.id === group.id ? '' : ' <span>/</span> 功能说明'}</div><h1 tabindex="-1">${escapeHTML(page.title)}</h1><p class="lead">${escapeHTML(page.intro || '')}</p>${markdown(page.content, page.id)}${directory}${pagination}<footer class="article-footer"><span>DSH Tavern 使用文档 · 本地文字初稿</span>${link('help', '需要帮助？')}</footer></article>`
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>酒馆生态兼容 · DSH Tavern 文档</title>
<meta name="description" content="DSH Tavern 使用文档：酒馆生态兼容、游玩模式、卡片模式与高级功能。按界面与操作逐项查阅。">
<meta name="theme-color" content="#ffffff">
<meta property="og:title" content="DSH Tavern 使用文档"><meta property="og:description" content="酒馆生态兼容、游玩模式、卡片模式与高级功能。"><meta property="og:type" content="website"><meta property="og:image" content="https://flizzywine.github.io/dsh-tavern/assets/social.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="DSH Tavern 使用文档"><meta name="twitter:description" content="按界面与操作逐项查阅 DSH Tavern 功能。"><meta name="twitter:image" content="https://flizzywine.github.io/dsh-tavern/assets/social.png">
<link rel="stylesheet" href="assets/manual.css"><script src="assets/manual-state.js" defer></script><script src="assets/manual.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-header"><a class="brand" href="#compatibility"><span class="brand-mark" aria-hidden="true">T</span><span>DSH Tavern <b>Docs</b></span></a><button class="search-trigger" type="button" hidden>搜索文档 <kbd>⌘ K</kbd></button><nav aria-label="顶部导航">${link('play', '开始游玩')}${link('index', '功能索引')}${link('help', '帮助')}<a href="https://github.com/flizzywine/dsh-tavern" target="_blank" rel="noopener noreferrer">GitHub ↗</a><button id="theme-toggle" type="button" aria-label="切换深色主题" hidden>◐</button></nav></header>
<div class="mobile-bar"><button id="menu-toggle" type="button" aria-expanded="false" aria-controls="sidebar">☰ 功能目录</button><span>本地文字初稿</span></div>
<aside class="sidebar" id="sidebar" aria-label="功能目录"><div class="sidebar-label">使用文档 <span>文字初稿</span></div><nav aria-label="四部分文档目录">${sections.map(navGroup).join('')}</nav><div class="sidebar-bottom">${link('index', '全部功能索引')}${link('help', '帮助与维护')}<a href="product.html">原产品介绍 ↗</a><p>先开始使用，再按需了解。</p></div></aside>
<div class="page-layout"><main id="main">${allPages.map(article).join('')}<article class="doc-page" id="index" data-title="全部功能索引" data-group="index"><div class="breadcrumb">使用文档 / 索引</div><h1 tabindex="-1">全部功能索引</h1><p class="lead">100 个功能与指南主题，按四个部分逐项查阅。辅助指南单列，不是第五种产品模式。</p>${groups.map(g => `<h2 id="index--${g.id}">${link(g.id, g.title)}</h2><ul class="topic-list">${orderedTopics.filter(t => owner.get(t.key) === g).map(t => `<li>${link(t.id, t.title)}</li>`).join('')}</ul>`).join('')}</article><article class="doc-page" id="not-found" data-title="没有找到这篇文档" data-group="help"><h1 tabindex="-1">没有找到这篇文档</h1><p>这个链接可能已经变更。请打开${link('index', '全部功能索引')}，或搜索功能名称。</p></article></main><aside class="page-toc" aria-label="本页导航"><p>本页导航</p><nav id="toc-links"></nav><div class="toc-note">文字先行<br>截图将在内容定稿后补充。</div></aside></div>
<dialog id="search-dialog" aria-labelledby="search-title"><div class="search-header"><label id="search-title" for="doc-search">搜索文档</label><button type="button" id="search-close" aria-label="关闭搜索">Esc</button></div><input id="doc-search" type="search" placeholder="输入功能或操作，例如：重写、世界书…" autocomplete="off"><p id="search-status" role="status"></p><ul id="search-results"></ul></dialog>
<noscript><div class="noscript-note">未启用 JavaScript：下方按顺序展示全部文字，可通过目录跳转。</div></noscript>
</body></html>\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = await readFile(new URL('../feature-inventory.md', import.meta.url), 'utf8')
  await writeFile(new URL('../index.html', import.meta.url), renderSite(inventory))
  console.log('DSH Tavern manual built: docs/index.html')
}
