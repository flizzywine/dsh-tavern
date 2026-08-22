import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReplyPresentation } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { renderTavernRegexDisplay } from '../tavern-plugin/lib/domain/tavern-regex-display.js'

const girlPattern = String.raw`\[在场女生\]\s*\r?\n【名字】[：:]\s*(.*?)\r?\n【状态】[：:]\s*(.*?)(?=\r?\n\[在场女生\]|$)`

function displayScript(name, findRegex, replaceString) {
  return {
    name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [1, 2],
    enabled: true,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null
  }
}

function campusScripts(girlSlots = 15) {
  return [
    displayScript(
      '选项-白伊甸校园',
      String.raw`/A选项：\s*([\s\S]*?)\n/B选项：\s*([\s\S]*?)\n/C选项：\s*([\s\S]*?)\n/D选项：\s*([\s\S]*?)(?=\n\s*\[在场女生\])`,
      '<section class="options"><button>$1</button><button>$2</button><button>$3</button><button>$4</button></section>'
    ),
    displayScript(
      '正文-白伊甸校园',
      String.raw`【时间】[：:]\s*(.*?)\n【天气】[：:]\s*(.*?)\n【地点】[：:]\s*(.*?)\n【日期】[：:]\s*(.*?)\n【星期】[：:]\s*(.*?)\n([\s\S]+?)\n\s*———+\s*(?:\n|$)`,
      '<article><header>$1 · $2 · $3 · $4 · $5</header><main>$6</main></article>'
    ),
    ...Array.from({ length: girlSlots }, (_, index) => displayScript(
      '在场女生' + (index + 1),
      girlPattern,
      '<aside class="girl"><b>$1</b><span>$2</span></aside>'
    ))
  ]
}

const campusReply = `【时间】：09:00
【天气】：晴
【地点】：白伊甸校园
【日期】：2210-07-01
【星期】：星期一
叶天邪走进校门。
——————————————
/A选项：前往教室
/B选项：留在校门
/C选项：询问学生
/D选项：查看地图
[在场女生]
【名字】：白石凛
【状态】：警惕
[在场女生]
【名字】：月岛葵
【状态】：好奇`

test('女子校园展示正则按原始顺序渲染正文、候选项和重复人物卡片', () => {
  const result = renderTavernRegexDisplay(campusReply, campusScripts(), {
    placement: 2,
    isMarkdown: true,
    depth: 0
  })

  assert.equal(result.changed, true)
  assert.equal(result.applied.length, 4)
  assert.match(result.text, /<article>/)
  assert.match(result.text, /<section class="options">/)
  assert.equal((result.text.match(/<aside class="girl">/g) || []).length, 2)
  assert.doesNotMatch(result.text, /\/A选项：|\[在场女生\]/)
  assert.equal(result.warnings.length, 0)
})

test('display-only 正则把命中内容移出正文并生成独立 HTML 投影', () => {
  const result = projectReplyPresentation(campusReply, {
    regexScripts: campusScripts(),
    placement: 2,
    isMarkdown: true,
    depth: 0
  })

  assert.equal(result.bodyText, '')
  assert.equal(result.sourceText, campusReply)
  assert.match(result.presentationHtml, /<article>/)
  assert.match(result.presentationHtml, /<aside class="girl">/)
})

test('正则未命中的内容继续留在正文', () => {
  const source = '序章说明\n校园\n尾声说明'
  const result = projectReplyPresentation(source, {
    regexScripts: [displayScript('校园展示', '校园', '<strong>校园</strong>')],
    placement: 2,
    isMarkdown: true
  })

  assert.equal(result.bodyText, '序章说明\n\n尾声说明')
  assert.equal(result.sourceText, source)
  assert.equal(result.presentationHtml, '序章说明\n<strong>校园</strong>\n尾声说明')
})

test('损坏规则只产生诊断，后续规则继续执行', () => {
  const scripts = [
    displayScript('损坏规则', '/[/', '<b>bad</b>'),
    displayScript('可用规则', '校园', '<strong>校园</strong>')
  ]
  const result = renderTavernRegexDisplay('进入校园', scripts, { placement: 2, isMarkdown: true })

  assert.equal(result.changed, true)
  assert.equal(result.text, '进入<strong>校园</strong>')
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /损坏规则/)
})

test('非展示规则、禁用规则和不匹配 placement 的规则不会执行', () => {
  const scripts = [
    { ...displayScript('仅提示词', '校园', 'PROMPT'), markdownOnly: false, promptOnly: true },
    { ...displayScript('已禁用', '校园', 'DISABLED'), enabled: false },
    { ...displayScript('仅用户输入', '校园', 'USER'), placement: [1] }
  ]
  const result = renderTavernRegexDisplay('进入校园', scripts, { placement: 2, isMarkdown: true })

  assert.equal(result.changed, false)
  assert.equal(result.text, '进入校园')
})
