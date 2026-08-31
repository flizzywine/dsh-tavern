import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { projectOpeningCommit } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

const lighthouseCardPath = process.env.DSH_TAVERN_LIGHTHOUSE_CARD
  || path.join(homedir(), '.dsh/profile-data/tavern/data/resources/cards/灯火阑珊.json')

test('开局选择只执行人物卡正则，MVU 留到对话建立后由官方运行时初始化', async () => {
  const card = {
    name: '测试卡',
    first_mes: '第一幕 <UpdateVariable>hp: 10</UpdateVariable>',
    alternate_greetings: ['第二幕 <visual_cards>[]</visual_cards>'],
    character_book: { name: '测试世界书', entries: [] }
  }
  const extensions = {
    regexScripts: [
      {
        id: 'update-ui', name: '变量 UI', enabled: true,
        findRegex: '/<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi',
        replaceString: '<section class="variable-ui">$1</section>', placement: [2]
      },
      {
        id: 'status-ui', name: '状态栏 UI', enabled: true,
        findRegex: '/<visual_cards>([\\s\\S]*?)<\\/visual_cards>/gi',
        replaceString: '```html\n<div class="status-ui"></div>\n```', placement: [2]
      }
    ],
    mvuResources: [{ enabled: true }]
  }
  const result = await projectCardOpeningPreviews({
    card,
    extensions,
    userName: '玩家'
  })

  assert.equal(result.openings.length, 2)
  assert.deepEqual(result.openings[0].projection.parts.map((part) => part.kind), ['markdown', 'html'])
  assert.match(result.openings[0].projection.parts[1].content, /class="variable-ui"/)
  assert.deepEqual(result.openings[1].projection.parts.map((part) => part.kind), ['markdown', 'html'])
  assert.match(result.openings[1].projection.parts[1].content, /class="status-ui"/)
  assert.equal(result.openings[0].helperContext, null)
  assert.equal(result.openings[1].helperContext, null)
})

test('MVU 展示入口不会把原有开场 HTML 降为 Markdown，且状态栏仍独立渲染', async () => {
  const html = '<div class="opening"><h1>开场说明</h1></div>'
  const card = {
    name: '预览测试卡',
    first_mes: html + '\n<mvu-status/>',
    alternate_greetings: ['```html\n' + html + '\n```\n<mvu-status/>', '***开场说明***\n<mvu-status/>']
  }
  const before = structuredClone(card)
  const result = await projectCardOpeningPreviews({
    card,
    extensions: { regexScripts: [{
      id: 'mvu-status', name: 'MVU 状态视图', enabled: true,
      findRegex: '/<mvu-status\\s*\\/>/g',
      replaceString: '```html\n<div class="status-ui">状态</div>\n```',
      placement: [2], markdownOnly: true
    }] }
  })

  for (const opening of result.openings.slice(0, 2)) {
    const parts = opening.projection.parts
    assert.deepEqual(parts.map((part) => part.kind), ['html', 'html'])
    assert.match(parts[0].content, /<div class="opening"><h1>开场说明<\/h1><\/div>/)
    assert.doesNotMatch(parts[0].content, /status-ui|&lt;div|```/)
    assert.match(parts[1].content, /<div class="status-ui">状态<\/div>/)
    assert.doesNotMatch(parts[1].content, /class="opening"/)
  }
  assert.deepEqual(result.openings[2].projection.parts.map((part) => part.kind), ['markdown', 'html'])
  assert.equal(result.openings[2].projection.parts[0].text.trim(), '***开场说明***')
  assert.deepEqual(card, before)
})

test('预览延后依赖 MVU 的状态脚本，保留开场、普通脚本与正式开局资源', async () => {
  const status = '<div id="notice"></div><script>waitGlobalInitialized("Mvu").then(function () { Mvu.getMvuData(); });</script>'
  const ordinary = '<div>普通展示</div><script>window.ordinaryRan = true;</script>'
  const card = { name: '测试卡', first_mes: '<h1>开场正文</h1>\n<status/>\n<ordinary/>' }
  const extensions = { regexScripts: [
    { id: 'status', enabled: true, placement: [2], markdownOnly: true, findRegex: '/<status\\/>/g', replaceString: '```html\n' + status + '\n```' },
    { id: 'ordinary', enabled: true, placement: [2], markdownOnly: true, findRegex: '/<ordinary\\/>/g', replaceString: '```html\n' + ordinary + '\n```' }
  ] }
  const before = structuredClone({ card, extensions })
  const result = await projectCardOpeningPreviews({ card, extensions,
    runtime: { initializeChat() { throw new Error('预览不得初始化游戏') } }
  })
  const opening = result.openings[0]
  const context = vm.createContext({ window: {} })
  for (const part of opening.projection.parts) {
    for (const match of (part.content || '').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
      vm.runInContext(match[1], context)
    }
  }
  assert.equal(context.window.ordinaryRan, true)
  assert.equal(opening.helperContext, null)
  assert.equal(opening.text, card.first_mes)
  const preview = opening.projection.parts.map(part => part.content || part.text).join('\n')
  assert.match(preview, /<h1>开场正文<\/h1>/)
  assert.match(preview, /状态栏将在开始游戏后加载/)
  assert.doesNotMatch(preview, /waitGlobalInitialized|Mvu\.getMvuData/)
  const committed = projectOpeningCommit(card.first_mes, { regexScripts: extensions.regexScripts, regexPlacement: 2 })
  assert.match(committed.displayText, /waitGlobalInitialized\("Mvu"\)/)
  assert.doesNotMatch(committed.displayText, /状态栏将在开始游戏后加载/)
  assert.deepEqual({ card, extensions }, before)
})

test('普通人物卡无需伪造 MVU Helper 上下文', async () => {
  const result = await projectCardOpeningPreviews({
    card: { name: '普通卡', first_mes: '你好，{{user}}。', alternate_greetings: [] },
    extensions: { regexScripts: [], mvuResources: [] },
    runtime: { async initializeChat() { throw new Error('不应初始化 MVU') } },
    userName: '小明'
  })

  assert.equal(result.openings[0].projection.parts[0].content.includes('你好，小明。'), true)
  assert.equal(result.openings[0].helperContext, null)
})

test('真实《灯火阑珊》的 15 条开局只生成选择 UI，不执行第二套 MVU', { skip: !existsSync(lighthouseCardPath) }, async () => {
  const workspace = JSON.parse(await readFile(lighthouseCardPath, 'utf8'))
  const cards = createCardPreparation({ id: () => 'lighthouse', now: () => 0 })
  const result = await projectCardOpeningPreviews({
    card: cards.project(workspace),
    extensions: cards.present({ card: workspace, as: 'card-extensions' }),
    userName: '王辰'
  })

  assert.equal(result.openings.length, 15)
  const indexOpeningHtml = result.openings[0].projection.parts.map(function (part) {
    return String(part.content || '')
  }).join('')
  assert.equal(result.openings[0].projection.parts[0].kind, 'markdown')
  assert.match(result.openings[0].projection.parts[0].text, /\*\*\*索引页\*\*\*/)
  assert.match(indexOpeningHtml, /<!-- 中间核心内容 -->/)
  assert.match(indexOpeningHtml, /<div style="display: flex; align-items: center; justify-content: center;/)
  assert.doesNotMatch(indexOpeningHtml, /<pre><code>[\s\S]*(?:&lt;div style=|中间核心内容)/)
  assert.ok(result.openings.every(function (opening) {
    return opening.projection.parts.some(function (part) {
      return /cultivation-var-update|\.load\(/.test(String(part.content || ''))
    })
  }))
  assert.ok(result.openings.every(function (opening) { return opening.helperContext === null }))
})
