import assert from 'node:assert/strict'
import test from 'node:test'

import {
  preserveRuntimeSource,
  projectBackgroundInput,
  projectBackgroundOutput,
  projectAgentContent,
  projectAgentMessageText,
  projectOpeningCommit,
  projectOpeningPreview,
  resolveRuntimeMacroText
} from '../tavern-plugin/lib/domain/runtime-content-projection.js'

test('进入 Agent 的聊天消息统一解析宏并且不修改权威宏状态', () => {
  const state = { userName: '陈锋', local: { stage: 1 }, global: {} }

  assert.equal(projectAgentMessageText({
    text: '陈锋已经进门。',
    sourceText: '{{user}}已经进门。'
  }, { charName: '阿芙拉', macroState: state }), '陈锋已经进门。')
  assert.equal(projectAgentMessageText({
    sourceText: '{{user}}遇见{{char}}；阶段{{incvar::stage}}。'
  }, { charName: '阿芙拉', macroState: state }), '陈锋遇见阿芙拉；阶段2。')
  assert.deepEqual(state, { userName: '陈锋', local: { stage: 1 }, global: {} })
})

test('游玩投影统一解析宏并把块级 HTML 与原生正文分段，且不修改传入的权威变量', () => {
  const state = { userName: '陈锋', local: { stage: 2 }, global: {} }
  const result = projectAgentContent(
    '当前阶段 {{getvar::stage || 1}}。\n<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>',
    { charName: '命运', macroState: state }
  )

  assert.equal(result.agentText, '当前阶段 2。\n<style>.panel{color:red}</style><div class="panel">阶段 2</div>')
  assert.equal(result.displayText, result.agentText)
  assert.equal(result.displayMode, 'html')
  assert.deepEqual(result.displayParts, [
    { kind: 'markdown', text: '当前阶段 2。\n' },
    { kind: 'html', content: '<style>.panel{color:red}</style><div class="panel">阶段 2</div>' }
  ])
  assert.equal(result.presentationHtml, '')
  assert.deepEqual(result.macroState.local, { stage: 2 })
  assert.deepEqual(state, { userName: '陈锋', local: { stage: 2 }, global: {} })
})

test('卡片编辑与资料阅读使用源码投影，不执行宏也不拆 HTML', () => {
  const source = '{{incvar::stage}}<div>模板</div>'
  const result = preserveRuntimeSource(source, {
    charName: '命运',
    macroState: { userName: 'User', local: { stage: 1 }, global: {} }
  })

  assert.equal(result.agentText, source)
  assert.equal(result.displayText, source)
  assert.equal(result.presentationHtml, '')
  assert.deepEqual(result.macroState.local, { stage: 1 })
})

test('同一份游玩输入重复投影不会重复修改权威变量', () => {
  const state = { userName: 'User', local: { stage: 1 }, global: {} }
  const first = projectAgentContent('{{incvar::stage}}阶段 {{.stage}}', { macroState: state })
  const second = projectAgentContent('{{incvar::stage}}阶段 {{.stage}}', { macroState: state })

  assert.equal(first.agentText, '2阶段 2')
  assert.equal(second.agentText, '2阶段 2')
  assert.deepEqual(state.local, { stage: 1 })
})

test('开场白预览保留完整渲染结果，不提前剥离 HTML 或提交变量', () => {
  const state = { userName: 'User', local: { stage: 1 }, global: {} }
  const result = projectOpeningPreview(
    '{{incvar::stage}}序章<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>',
    { charName: '命运', macroState: state }
  )

  assert.match(result.agentText, /^2序章<style>/)
  assert.equal(result.bodyText, result.agentText)
  assert.equal(result.displayText, result.agentText)
  assert.equal(result.displayMode, 'html')
  assert.equal(result.presentationHtml, '')
  assert.equal(result.presentationOnly, false)
  assert.deepEqual(state.local, { stage: 1 })
})

test('开场白展示正则生成 HTML 时，正文 Markdown 与界面分开渲染', () => {
  const result = projectOpeningPreview(
    '***索引页***\n\n<UpdateVariable>hp: 10</UpdateVariable>',
    {
      regexPlacement: 2,
      regexScripts: [{
        id: 'variable-ui',
        name: '变量界面',
        enabled: true,
        placement: [2],
        findRegex: '/<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi',
        replaceString: '<section class="variable-ui">$1</section>'
      }]
    }
  )

  assert.deepEqual(result.displayParts.map((part) => part.kind), ['markdown', 'html'])
  assert.equal(result.displayParts[0].text.trim(), '***索引页***')
  assert.match(result.displayParts[1].content, /<section class="variable-ui">hp: 10<\/section>/)
})

test('确认开场白后仍保留正文与 HTML 的原始顺序', () => {
  const mixed = projectOpeningCommit('序章<div class="panel">状态</div>')
  const page = projectOpeningCommit('<div class="cover">封面</div>')

  assert.equal(mixed.agentText, '序章<div class="panel">状态</div>')
  assert.equal(mixed.displayText, mixed.agentText)
  assert.equal(mixed.presentationOnly, false)
  assert.equal(page.agentText, '<div class="cover">封面</div>')
  assert.equal(page.displayText, page.agentText)
  assert.equal(page.presentationOnly, false)
})

test('Agent 投影剥离解析失败后残留的宏花括号，但保留源码和诊断', () => {
  const source = '世界书带{{if}}宏按阶段门控。'
  const projected = projectAgentContent(source)
  const opening = projectOpeningCommit(source)
  const preserved = preserveRuntimeSource(source)

  assert.equal(projected.agentText, '世界书带if宏按阶段门控。')
  assert.equal(opening.agentText, '世界书带if宏按阶段门控。')
  assert.equal(preserved.agentText, source)
  assert.ok(projected.diagnostics.some((item) => /Macro "if"/.test(item.message)))
})

test('预设宏解析保留提示词结构，后台输入输出采用各自固定正则语义', () => {
  const macro = resolveRuntimeMacroText('<section>{{user}}</section>', { macroState: { userName: '陈锋' } })
  assert.equal(macro.text, '<section>陈锋</section>')

  const scripts = [{
    id: 'cleanup', name: '清理', findRegex: '/SECRET/g', replaceString: '',
    disabled: false, placement: [1, 2], promptOnly: false, markdownOnly: false, runOnEdit: false
  }]
  assert.equal(projectBackgroundInput('输入 SECRET', scripts).text, '输入 ')
  assert.equal(projectBackgroundOutput('输出 SECRET', scripts).text, '输出 ')
})
