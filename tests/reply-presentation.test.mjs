import assert from 'node:assert/strict'
import test from 'node:test'

import { displayModeOf, projectDisplayParts, projectReplyHistory, projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

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
  assert.equal(result.displayParts.length, 1)
  assert.equal(result.displayParts[0].kind, 'html')
  assert.match(result.displayParts[0].content, /<details><summary>状态<\/summary><!-- HP: 10 --><\/details>/)
  assert.deepEqual(result.applied, { session: [], display: [] })
})

test('展示层把带空行和缩进的完整 HTML 原样交给同一个 iframe', () => {
  const source = '<div class="outer">\n    <div>顶部</div>\n\n    <!-- 分区 -->\n    <div class="body">正文</div>\n</div>'
  const result = projectDisplayParts(source)

  assert.deepEqual(result.parts.map(part => part.kind), ['html'])
  assert.equal(result.parts[0].content, source)
  assert.doesNotMatch(result.parts[0].content, /<pre><code>|&lt;div/)
})

test('纯文本不执行 Markdown，只转成保留原文的 HTML 文本容器', () => {
  const source = '# 标题\n\n**不是粗体**\n2 < 3 & 5 > 4'
  const result = projectDisplayParts(source)

  assert.deepEqual(result.parts.map(part => part.kind), ['html'])
  assert.match(result.parts[0].content, /class="dsh-tavern-plain-text"/)
  assert.match(result.parts[0].content, /# 标题/)
  assert.match(result.parts[0].content, /\*\*不是粗体\*\*/)
  assert.match(result.parts[0].content, /2 &lt; 3 &amp; 5 &gt; 4/)
  assert.doesNotMatch(result.parts[0].content, /<h1>|<strong>/)
})

test('没有展示正则的纯文本历史也生成整轮 HTML 投影', () => {
  const result = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '# 原样标题', sourceText: '# 原样标题' }
  ])

  assert.equal(result.projections.length, 1)
  assert.equal(result.projections[0].mode, 'html')
  assert.deepEqual(result.projections[0].parts.map(part => part.kind), ['html'])
  assert.match(result.projections[0].parts[0].content, /># 原样标题</)
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
  assert.equal(result.displayMode, 'html')
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
  assert.deepEqual(projected.parts.map(part => part.kind), ['html', 'html'])
  assert.match(projected.parts[0].content, /示例：/)
  assert.equal(projected.parts[1].content, '<div>只展示源码</div>\n')
})

test('独立围栏 UI 不与正文共用 iframe，避免 body.load 清空正文', () => {
  const source = '【开局二·虞汐颜】\n\n幽暗秘境深处。\n\n```html\n<body><script>$("body").load("/status.html")</script></body>\n```'
  const projected = projectDisplayParts(source)

  assert.deepEqual(projected.parts.map(part => part.kind), ['html', 'html'])
  assert.match(projected.parts[0].content, /幽暗秘境深处/)
  assert.doesNotMatch(projected.parts[0].content, /body.*load/s)
  assert.match(projected.parts[1].content, /body.*load/s)
  assert.doesNotMatch(projected.parts[1].content, /幽暗秘境深处/)
})

test('未标语言但包含 HTML 的代码围栏也进入独立 HTML 渲染', () => {
  const projected = projectDisplayParts('正文前\n```\n<section>远程面板</section>\n```\n正文后')
  assert.deepEqual(projected.parts.map(part => part.kind), ['html', 'html', 'html'])
  assert.match(projected.parts[0].content, /正文前/)
  assert.match(projected.parts[1].content, /<section>远程面板<\/section>/)
  assert.match(projected.parts[2].content, /正文后/)
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
  assert.deepEqual(result.displayParts.map(part => part.kind), ['html', 'html', 'html'])
  assert.match(result.displayParts[0].content, /正文前/)
  assert.match(result.displayParts[1].content, /document\.body\.dataset\.ready/)
  assert.match(result.displayParts[2].content, /正文后/)
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
    { turn: 2, text: '正文。\n\n', mode: 'html' }
  ])

  const disabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '正文。', sourceText: source }
  ], { regexScripts: [], placement: 2 })

  assert.deepEqual(disabled.projections.map(({ turn, text, mode }) => ({ turn, text, mode })), [
    { turn: 2, text: source, mode: 'html' }
  ])
  assert.equal(disabled.presentation, null)
})

test('多 Swipe 的纯 Markdown 也生成展示投影，使旧候选可覆盖原生正文', () => {
  const result = projectReplyHistory([{
    role: 'assistant', turn: 3, text: '旧候选', sourceText: '旧候选', projectionText: '旧候选', swipeId: 0, swipes: ['旧候选', '新候选']
  }])
  assert.deepEqual(result.projections.map(function (item) { return { turn: item.turn, text: item.text, mode: item.mode } }), [
    { turn: 3, text: '旧候选', mode: 'html' }
  ])
})
