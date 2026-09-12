import assert from 'node:assert/strict'
import test from 'node:test'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { projectOpeningCommit } from '../tavern-plugin/lib/domain/runtime-content-projection.js'

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

test('预览保留完整界面及 MVU 脚本，不提前初始化游戏或改写资源', async () => {
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
  assert.equal(opening.helperContext, null)
  assert.equal(opening.text, card.first_mes)
  const preview = opening.projection.parts.map(part => part.content || part.text).join('\n')
  assert.match(preview, /<h1>开场正文<\/h1>/)
  assert.doesNotMatch(preview, /状态栏将在开始游戏后加载|data-dsh-tavern-mvu-preview|<status\/>/)
  assert.match(preview, /waitGlobalInitialized/ )
  assert.match(preview, /Mvu\.getMvuData/)
  assert.match(preview, /window.ordinaryRan = true/)
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

  assert.deepEqual(result.openings[0].projection.parts, [{ kind: 'markdown', text: '你好，小明。' }])
  assert.equal(result.openings[0].helperContext, null)
})

test('交互式首页保留视频和选择脚本，原始 swipe 索引映射到原生开场', async () => {
  const card = { name: '测试首页', first_mes: 'HOME', alternate_greetings: ['', '安全的第二幕'] }
  const extensions = { regexScripts: [{ enabled: true, findRegex: 'HOME', placement: [2], markdownOnly: true,
    replaceString: '<video controls src="https://example.com/opening.mp4"></video><button>选择开场</button><script>async function choose(){await waitGlobalInitialized("Mvu");const messages=getChatMessages("0",{include_swipe:true});await setChatMessage(messages[0].swipes[2],0,{swipe_id:2});}</script>' }] }
  const result = await projectCardOpeningPreviews({ card, extensions })
  assert.match(JSON.stringify(result.openings[0].projection.parts), /<video/)
  assert.match(JSON.stringify(result.openings[0].projection.parts), /setChatMessage/)
  assert.deepEqual(result.openings[0].openingPreview.openingIds, ['primary', null, 'alternate:1'])
  assert.deepEqual(result.openings[0].openingPreview.swipes, ['HOME', '', '安全的第二幕'])
  assert.equal(result.openings[0].helperContext, null)
})


test('MVU 能力检测不会清空完整封面，并为间接调用消息接口的封面提供开场桥接', async () => {
  const html = `<h1>封面</h1><button>开始</button><script>
    const ready = !!(window.Mvu && typeof window.Mvu.getMvuData === 'function');
    const read = api('getChatMessages'); const write = api('setChatMessage');
  </script>`
  const result = await projectCardOpeningPreviews({
    card: { name: '封面测试', first_mes: '【封面】', alternate_greetings: ['第二幕'] },
    extensions: { regexScripts: [{ enabled: true, placement: [2], markdownOnly: true,
      findRegex: '【封面】', replaceString: html }] }
  })
  assert.match(result.openings[0].projection.parts.map(p => p.content || p.text).join(''), /<h1>封面<\/h1>/)
  assert.deepEqual(result.openings[0].openingPreview.openingIds, ['primary', 'alternate:0'])
})

test('text fenced complete HTML from opening regex renders as HTML, ordinary text remains Markdown', async () => {
  for (const [body, language, expected] of [
    ['<!DOCTYPE html>\n<html lang="zh-CN"><head><title>接入协议</title></head><body><button>进入</button></body></html>', 'text', 'html'],
    ['<html><body>开场</body></html>', 'text', 'html'],
    ['<thinking>分析</thinking>\n\n正文', 'text', 'markdown'],
    ['<div>代码示例</div>', 'text', 'markdown'],
    ['<!DOCTYPE html><html><body>尚未结束', 'text', 'markdown'],
    ['<!DOCTYPE html><html><body>示例</body></html>', 'javascript', 'markdown']
  ]) {
    const result = await projectCardOpeningPreviews({ card: { name: '测试', first_mes: '【封面】' }, extensions: {
      regexScripts: [{ enabled: true, findRegex: '【封面】', replaceString: '```' + language + '\n' + body + '\n```', placement: [2] }]
    } });
    assert.equal(result.openings[0].projection.mode, expected, body);
    if (expected === 'html') assert.equal(result.openings[0].projection.parts[0].content, body + '\n');
  }
});

test('native swipe chooser receives opening bridge metadata without treating prose as a chooser', async () => {
  const card = { name: '选择台', first_mes: '<script>const ctx=SillyTavern.getContext();ctx.swipe.to(null,"right",{forceMesId:0,forceSwipeId:1});</script>', alternate_greetings: ['目标开场'] }
  const result = await projectCardOpeningPreviews({ card })
  assert.ok(result.openings[0].openingPreview)
  assert.equal(result.openings[0].openingPreview.openingIds[1], 'alternate:0')
  const prose = await projectCardOpeningPreviews({ card: { first_mes: 'He swiped his card. The character_menu appeared and he decided to jump.' } })
  assert.equal(prose.openings[0].openingPreview, null)
})

test('native chooser drops an empty primary while preserving alternate opening ids', async () => {
  const result = await projectCardOpeningPreviews({ card: { first_mes: '', alternate_greetings: ['<script>ctx.swipe.to(null, "right", { forceSwipeId: 1 })</script>', 'story'] } })
  assert.deepEqual(result.openings[0].openingPreview.openingIds, ['alternate:0', 'alternate:1'])
  assert.equal(result.openings[0].openingPreview.selectedIndex, 0)
  assert.equal(result.openings[0].openingPreview.swipes[1], 'story')
})
