import assert from 'node:assert/strict'
import test from 'node:test'

import { createReplyHistoryProjector, displayModeOf, projectDisplayParts, projectReplyHistory, projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

function script(name, findRegex, replaceString, flags = {}) {
  return {
    id: name,
    name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    enabled: true,
    markdownOnly: flags.markdownOnly === true,
    promptOnly: flags.promptOnly === true,
    runOnEdit: false,
    minDepth: null,
    maxDepth: null
  }
}

test('没有正则时三层回复保持原文，HTML 只影响展示分类', () => {
  const source = '正文。\n\n<details><summary>状态</summary><!-- HP: 10 --></details>'
  const result = projectReplyLayers(source)

  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, source)
  assert.equal(result.displayMode, 'html')
  assert.deepEqual(result.displayParts.map(part => part.kind), ['markdown', 'html'])
  assert.equal(result.displayParts[0].text, '正文。\n\n')
  assert.match(result.displayParts[1].content, /<details><summary>状态<\/summary><!-- HP: 10 --><\/details>/)
  assert.deepEqual(result.applied, { session: [], display: [] })
})

test('展示层把带空行和缩进的完整 HTML 原样交给同一个 iframe', () => {
  const source = '<div class="outer">\n    <div>顶部</div>\n\n    <!-- 分区 -->\n    <div class="body">正文</div>\n</div>'
  const result = projectDisplayParts(source)

  assert.deepEqual(result.parts.map(part => part.kind), ['html'])
  assert.equal(result.parts[0].content, source)
  assert.doesNotMatch(result.parts[0].content, /<pre><code>|&lt;div/)
})

test('纯文本保留 Markdown 原文交给原生渲染，不创建 iframe', () => {
  const source = '# 标题\n\n**不是粗体**\n2 < 3 & 5 > 4'
  const result = projectDisplayParts(source)

  assert.deepEqual(result.parts, [{ kind: 'markdown', text: source }])
  assert.equal(displayModeOf(source), 'markdown')
  const layers = projectReplyLayers(source)
  assert.equal(layers.sourceText, source)
  assert.equal(layers.sessionText, source)
  assert.equal(layers.displayMode, 'markdown')
})

test('整段 content 叙事外壳不会把纯文本开场白送进 iframe', () => {
  const source = '<content>\n第一段开场白。\n\n第二段开场白。\n</content>'
  const result = projectDisplayParts(source)

  assert.deepEqual(result.parts, [{ kind: 'markdown', text: '第一段开场白。\n\n第二段开场白。' }])
  assert.equal(displayModeOf(source), 'markdown')
})

test('历史投影会下发剥离 content 外壳后的纯文本开场白', () => {
  const source = '<content>\n第一段开场白。\n\n第二段开场白。\n</content>'
  const result = projectReplyHistory([
    { role: 'assistant', turn: 1, greeting: true, text: source, sourceText: source }
  ])

  assert.equal(result.projections.length, 1)
  assert.deepEqual(result.projections[0].parts, [
    { kind: 'markdown', text: '第一段开场白。\n\n第二段开场白。' }
  ])
})

test('没有展示正则的纯文本历史沿用原生正文，不生成 HTML 投影', () => {
  const result = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '# 原样标题', sourceText: '# 原样标题' }
  ])

  assert.deepEqual(result.projections, [])
})

test('markdownOnly 只改变展示投影并保持替换位置', () => {
  const source = '海风吹过。\n<status>体力 90</status>\n她继续向前。'
  const result = projectReplyLayers(source, {
    regexScripts: [script('状态展示', '/<status>(.*?)<\\/status>/s', '<aside>$1</aside>', { markdownOnly: true })],
    placement: 2
  })

  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, '海风吹过。\n<aside>体力 90</aside>\n她继续向前。')
  assert.equal(result.displayMode, 'html')
  assert.deepEqual(result.applied.session, [])
  assert.deepEqual(result.applied.display.map(item => item.name), ['状态展示'])
})

test('promptOnly 只改变 Session 投影', () => {
  const source = '<draft_notes>思考过程</draft_notes>\n正文。'
  const result = projectReplyLayers(source, {
    regexScripts: [script('移除思考', '/<draft_notes>[\\s\\S]*?<\\/draft_notes>\\s*/', '', { promptOnly: true })],
    placement: 2
  })

  assert.equal(result.sessionText, '正文。')
  assert.equal(result.displayText, source)
  assert.equal(result.displayMode, 'markdown')
})

test('两个 flag 都启用时分别改变 Session 和展示投影', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [script('双投影', '校园', '<b>校园</b>', { markdownOnly: true, promptOnly: true })],
    placement: 2
  })

  assert.equal(result.sessionText, '进入<b>校园</b>')
  assert.equal(result.displayText, '进入<b>校园</b>')
  assert.equal(result.applied.session.length, 1)
  assert.equal(result.applied.display.length, 1)
})

test('两个 flag 都未启用时执行酒馆永久替换语义但保留原始留档', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [script('普通规则', '校园', '学院')],
    placement: 2
  })

  assert.equal(result.sourceText, '进入校园')
  assert.equal(result.sessionText, '进入学院')
  assert.equal(result.displayText, '进入学院')
})

test('完整 HTML、HTML 注释和 details 均留在原位置，不转换也不搬运', () => {
  const source = '正文。\n\n<details><summary>后台日志</summary>\n<!-- <script>alert("x")</script> -->\n</details>\n\n尾声。'
  const result = projectReplyLayers(source)

  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, source)
  assert.match(result.displayText, /<!-- <script>alert\("x"\)<\/script> -->/)
  assert.equal(result.displayMode, 'html')
})

test('HTML 代码围栏在原位置进入独立 HTML 渲染', () => {
  const source = '示例：\n\n```html\n<div>只展示源码</div>\n```'
  const projected = projectDisplayParts(source)
  assert.equal(displayModeOf(source), 'html')
  assert.deepEqual(projected.parts.map(part => part.kind), ['markdown', 'html'])
  assert.match(projected.parts[0].text, /示例：/)
  assert.equal(projected.parts[1].content, '<div>只展示源码</div>\n')
})

test('正文中的块级 CG 展示独立进入 iframe，前后正文仍由原生 Markdown 渲染', () => {
  const source = '第一段正文。\n\n<style>\n.cg-image{display:block;width:100%}\n</style>\n<div class="cg-container"><img class="cg-image" src="/祝南枝/教室.png"></div>\n\n第二段正文。'
  const projected = projectDisplayParts(source)

  assert.deepEqual(projected.parts.map(part => part.kind), ['markdown', 'html', 'markdown'])
  assert.match(projected.parts[0].text, /第一段正文/)
  assert.doesNotMatch(projected.parts[0].text, /cg-container|<style>/)
  assert.match(projected.parts[1].content, /<style>[\s\S]*cg-container/)
  assert.doesNotMatch(projected.parts[1].content, /第一段正文|第二段正文/)
  assert.match(projected.parts[2].text, /第二段正文/)
})

test('独立围栏 UI 不与正文共用 iframe，避免 body.load 清空正文', () => {
  const source = '【开局二·虞汐颜】\n\n幽暗秘境深处。\n\n```html\n<body><script>$("body").load("/status.html")</script></body>\n```'
  const projected = projectDisplayParts(source)

  assert.deepEqual(projected.parts.map(part => part.kind), ['markdown', 'html'])
  assert.match(projected.parts[0].text, /幽暗秘境深处/)
  assert.doesNotMatch(projected.parts[0].text, /body.*load/s)
  assert.match(projected.parts[1].content, /body.*load/s)
  assert.doesNotMatch(projected.parts[1].content, /幽暗秘境深处/)
})

test('混合内容拆开原生 Markdown、块级 HTML 与独立围栏 UI', () => {
  const source = '***索引页***\n\n**开局一·自定义**\n\n<details><summary>天道推演</summary></details>\n\n```html\n<body><script>$("body").load("/status.html")</script></body>\n```'
  const projected = projectDisplayParts(source)

  assert.deepEqual(projected.parts.map(part => part.kind), ['markdown', 'html', 'html'])
  assert.match(projected.parts[0].text, /\*\*\*索引页\*\*\*/)
  assert.match(projected.parts[0].text, /\*\*开局一·自定义\*\*/)
  assert.match(projected.parts[1].content, /<details><summary>天道推演<\/summary><\/details>/)
  assert.doesNotMatch(projected.parts[1].content, /<pre><code>/)
  assert.match(projected.parts[2].content, /body.*load/s)
})

test('未标语言但包含 HTML 的代码围栏也进入独立 HTML 渲染', () => {
  const projected = projectDisplayParts('正文前\n```\n<section>远程面板</section>\n```\n正文后')
  assert.deepEqual(projected.parts.map(part => part.kind), ['markdown', 'html', 'markdown'])
  assert.match(projected.parts[0].text, /正文前/)
  assert.match(projected.parts[1].content, /<section>远程面板<\/section>/)
  assert.match(projected.parts[2].text, /正文后/)
})

test('首页占位符经 markdownOnly 正则变成前端代码，但 Session 保留占位符', () => {
  const source = '正文前。\n\n【首页】\n\n正文后。'
  const replacement = '```html\n<body><button>首页</button><script>document.body.dataset.ready="1"</script></body>\n```'
  const result = projectReplyLayers(source, {
    regexScripts: [script('首页界面', '【首页】', replacement, { markdownOnly: true })],
    placement: 2
  })

  assert.equal(result.sessionText, source)
  assert.match(result.displayText, /<button>首页<\/button>/)
  assert.deepEqual(result.displayParts.map(part => part.kind), ['markdown', 'html', 'markdown'])
  assert.match(result.displayParts[0].text, /正文前/)
  assert.match(result.displayParts[1].content, /document\.body\.dataset\.ready/)
  assert.match(result.displayParts[2].text, /正文后/)
})

test('损坏规则只产生目标诊断，后续规则继续执行', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [
      script('损坏规则', '/[/', '坏'),
      script('可用规则', '校园', '学院')
    ],
    placement: 2
  })

  assert.equal(result.sessionText, '进入学院')
  assert.equal(result.displayText, '进入学院')
  assert.match(result.warnings.join('\n'), /Session：损坏规则/)
  assert.match(result.warnings.join('\n'), /展示：损坏规则/)
})

test('历史投影从原文重算，关闭展示正则后恢复原始消息', () => {
  const rule = script('删除参考块', '/<Reference_Example>[\\s\\S]*?<\\/Reference_Example>/g', '', { markdownOnly: true })
  const source = '正文。\n\n<Reference_Example>辅助内容</Reference_Example>'
  const enabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: source, sourceText: source }
  ], { regexScripts: [rule], placement: 2 })

  assert.deepEqual(enabled.projections.map(({ turn, text, mode }) => ({ turn, text, mode })), [
    { turn: 2, text: '正文。\n\n', mode: 'markdown' }
  ])

  const disabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '正文。', sourceText: source }
  ], { regexScripts: [], placement: 2 })

  assert.deepEqual(disabled.projections.map(({ turn, text, mode }) => ({ turn, text, mode })), [
    { turn: 2, text: source, mode: 'markdown' }
  ])
  assert.equal(disabled.presentation, null)
})

test('多 Swipe 的纯 Markdown 也生成展示投影，使旧候选可覆盖原生正文', () => {
  const result = projectReplyHistory([{
    role: 'assistant', turn: 3, text: '旧候选', sourceText: '旧候选', projectionText: '旧候选', swipeId: 0, swipes: ['旧候选', '新候选']
  }])
  assert.deepEqual(result.projections.map(function (item) { return { turn: item.turn, text: item.text, mode: item.mode } }), [
    { turn: 3, text: '旧候选', mode: 'markdown' }
  ])
})

test('代码示例中的 HTML 不作为活动页面执行', () => {
  for (const source of ['使用 `<button>按钮</button>` 标签。', '```js\nconst html = "<button>按钮</button>"\n```', '    <script>示例</script>']) {
    assert.deepEqual(projectDisplayParts(source).parts, [{ kind: 'markdown', text: source }])
  }
})

test('整页美化继续整体隔离，不把外来脚本和样式注入宿主', () => {
  for (const source of ['<html><head><style>body{color:red}</style></head><body>正文</body></html>']) {
    assert.deepEqual(projectDisplayParts(source).parts, [{ kind: 'html', content: source }])
  }
})

test('独立块级脚本与正文拆开，但脚本仍只进入 iframe', () => {
  const source = '正文\n<script>document.body.replaceChildren()</script>'
  assert.deepEqual(projectDisplayParts(source).parts, [
    { kind: 'markdown', text: '正文\n' },
    { kind: 'html', content: '<script>document.body.replaceChildren()</script>' }
  ])
})

test('HTML 闭合后立即接正文也保持原生正文，多个面板不吞掉中间段落', () => {
  const source = '前文。\n<div>面板</div>\n后文。\n<div>第二面板</div>\n尾声。'
  const result = projectReplyLayers(source)
  assert.equal(result.sessionText, source)
  assert.deepEqual(result.displayParts.map(part => part.kind), ['markdown', 'html', 'markdown', 'html', 'markdown'])
  assert.equal(result.displayParts[1].content.trim(), '<div>面板</div>')
  assert.equal(result.displayParts[3].content.trim(), '<div>第二面板</div>')
  assert.match(result.displayParts[2].text, /后文/)
  assert.match(result.displayParts[4].text, /尾声/)
})

test('同段 HTML 与正文拆分，代码示例保留为原生 Markdown', () => {
  const source = '使用 `<b>示例</b>`，正文 <b>强调</b> 尾声'
  assert.deepEqual(projectDisplayParts(source).parts, [
    { kind: 'markdown', text: '使用 `<b>示例</b>`，正文 ' },
    { kind: 'html', content: '<b>强调</b>' },
    { kind: 'markdown', text: ' 尾声' }
  ])
})

test('多行 UI 保持完整且不吞掉尾声，脚本中的伪标签不改变边界', () => {
  const html = '<div title="a > b">\n<div>标题</div>\n\n<script>const sample = "<div>";</script>\n<div>内容</div>\n</div>'
  const source = '前文\n' + html + '\n尾声'
  const parts = projectDisplayParts(source).parts
  assert.deepEqual(parts.map(part => part.kind), ['markdown', 'html', 'markdown'])
  assert.equal(parts[1].content.trim(), html)
  assert.equal(parts[2].text.trim(), '尾声')
})

test('Windows 换行仍隔离面板并保留原始换行', () => {
  const source = '前文。\r\n<div>面板</div>\r\n后文。'
  const parts = projectDisplayParts(source).parts
  assert.deepEqual(parts.map(part => part.kind), ['markdown', 'html', 'markdown'])
  assert.equal(parts.map(part => part.text ?? part.content).join(''), source)
})

test('命定之诗 gametxt 正文标记不创建 iframe，后续状态面板仍隔离', () => {
  const source = '<gametxt>\r\n第一段。\r\n\r\n*第二段。*\r\n</gametxt>\r\n<details><summary>变量</summary>更新</details>'
  const result = projectReplyLayers(source)
  assert.equal(result.sessionText, source)
  assert.deepEqual(result.displayParts.map(part => part.kind), ['markdown', 'html'])
  assert.match(result.displayParts[0].text, /第一段。[\s\S]*\*第二段。\*/)
  assert.doesNotMatch(result.displayParts[0].text, /gametxt/)
  assert.doesNotMatch(result.displayParts[1].content, /第一段|第二段/)
})

test('正则生成的状态栏展开本局名称宏，保留原始记录及其他模板语法', () => {
  const source = '正文\n[状态]'
  const macros = { userName: '测试玩家', local: { count: 1 } }
  const options = { charName: '测试卡', macroState: macros, regexScripts: [script('状态栏', '\\[状态\\]', '<div>主角：{{user}}；角色：{{ CHAR }}；{{value}}；{{incvar::count}}</div>', { markdownOnly: true })] }
  const result = projectReplyLayers(source, options)
  assert.equal(result.sessionText, source)
  assert.equal(result.sourceText, source)
  assert.match(result.displayText, /主角：测试玩家；角色：测试卡/)
  assert.match(result.displayText, /\{\{value\}\}；\{\{incvar::count\}\}/)
  assert.equal(macros.local.count, 1)
  const history = projectReplyHistory([{ role: 'assistant', turn: 1, text: source, sourceText: source }], options)
  assert.match(history.projections[0].parts.find(p => p.kind === 'html').content, /主角：测试玩家/)
})

test('recovers a missing now_plot wrapper only for an active card bubble renderer', () => {
  const text = '走进教室。\n@bubble:小林|平静|[早上好。]'
  const renderer = script('bubble renderer', '/<now_plot>([\\s\\S]*?)<\\/now_plot>/g', '<div data-renderer="@bubble">$1</div>', { markdownOnly: true })
  const result = projectReplyLayers(text, { regexScripts: [renderer] })
  assert.match(result.displayText, /data-renderer/)
  assert.equal(result.sourceText, text)
  assert.equal(result.sessionText, text)
  for (const override of [{ enabled: false }, { placement: [1] }, { minDepth: 1 }, { promptOnly: true, markdownOnly: false }]) {
    assert.equal(projectReplyLayers(text, { regexScripts: [{ ...renderer, ...override }] }).displayText, text)
  }
  assert.equal(projectReplyLayers(text).displayText, text)
  const wrapped = '<now_plot>' + text + '</now_plot>'
  assert.equal(projectReplyLayers(wrapped, { regexScripts: [renderer] }).displayText, '<div data-renderer="@bubble">' + text + '</div>')
})

test('模型协议标记夹在前言、思考与正文之间时仍保留 Markdown 分段', () => {
  const source = '前言\n<thinking>简短分析</thinking>\n<content>\n第一段。\n\n第二段。\n</content>'
  const result = projectReplyLayers(source)
  assert.equal(result.sessionText, source)
  assert.ok(result.displayParts.every(part => part.kind === 'markdown'))
  assert.match(result.displayParts.map(part => part.text).join(''), /第一段。\n\n第二段。/)
  assert.doesNotMatch(result.displayParts.map(part => part.text).join(''), /<\/?(?:thinking|content)>/)
})

 test('正文中的独立注释不创建空 iframe，真正 HTML 内的注释保留', () => {
  const result = projectDisplayParts('<thinking>分析</thinking>\n<content><!-- 写作备注 -->\n第一段。\n\n第二段。</content>')
  assert.ok(result.parts.every(part => part.kind === 'markdown'))
  assert.deepEqual(projectDisplayParts('<div><!-- UI 注释 -->面板</div>').parts, [{ kind: 'html', content: '<div><!-- UI 注释 -->面板</div>' }])
})

test('任意无属性正文协议标签保留 Markdown 段落，不依赖卡片标签白名单', () => {
  for (const tag of ['story', 'now_plot', 'dream_body', 'Narrative']) {
    const body = '\r\n第一段。\r\n\r\n**第二段。**\r\n'
    const source = `<${tag}>${body}</${tag}>`
    const result = projectReplyLayers(source)
    assert.equal(result.sourceText, source)
    assert.equal(result.sessionText, source)
    assert.ok(result.displayParts.every(part => part.kind === 'markdown'), tag)
    assert.equal(result.displayParts.map(part => part.text).join(''), body)
  }
  const mixed = projectDisplayParts('<story>第一段。\n\n**第二段。**\n<details><summary>状态</summary>正常</details>\n尾声。</story>').parts
  assert.deepEqual(mixed.map(part => part.kind), ['markdown', 'html', 'markdown'])
  for (const source of ['<story-panel>界面</story-panel>', '<panel class="ui">界面</panel>', '<div><story>界面</story></div>', '```html\n<story>界面</story>\n```']) {
    assert.equal(projectDisplayParts(source).parts[0].kind, 'html')
  }
})


test('历史投影复用未改变的回复，新增和编辑只重算变化项', () => {
  const project = createReplyHistoryProjector()
  const messages = [{ role: 'assistant', turn: 1, text: '第一段' }]
  project(messages)
  project(structuredClone(messages))
  assert.equal(project.cacheStats().misses, 1)
  messages.push({ role: 'assistant', turn: 2, text: '第二段' })
  project(messages)
  assert.equal(project.cacheStats().misses, 2)
  messages[0].text = '修改正文'
  project(messages)
  assert.equal(project.cacheStats().misses, 3)
})

test('正则与身份参数变化使缓存失效，返回结果修改不污染缓存', () => {
  const project = createReplyHistoryProjector()
  const messages = [{ role: 'assistant', turn: 1, text: '{{user}}遇见{{char}}' }]
  const options = { charName: '甲', macroState: { userName: '乙' }, regexScripts: [] }
  const first = project(messages, options)
  const expected = structuredClone(first)
  first.projections[0].parts[0].text = '污染'
  assert.deepEqual(project(messages, options), expected)
  options.charName = '丙'
  assert.match(project(messages, options).projections[0].text, /丙/)
  options.macroState.userName = '丁'
  assert.match(project(messages, options).projections[0].text, /丁/)
  options.regexScripts.push(script('replace', '/遇见/g', '看到'))
  assert.match(project(messages, options).projections[0].text, /看到/)
  assert.equal(project.cacheStats().misses, 4)
})

test('缓存按容量淘汰，超大内容不驻留', () => {
  const project = createReplyHistoryProjector({ maxCacheEntries: 2, maxCacheBytes: 2048 })
  const message = text => [{ role: 'assistant', text }]
  for (const text of ['一', '二', '三']) project(message(text))
  assert.equal(project.cacheStats().entries, 2)
  project(message('一'))
  assert.equal(project.cacheStats().misses, 4)
  project(message('超大'.repeat(2000)))
  assert.equal(project.cacheStats().entries, 2)
  assert.ok(project.cacheStats().estimatedBytes <= 2048)
})
