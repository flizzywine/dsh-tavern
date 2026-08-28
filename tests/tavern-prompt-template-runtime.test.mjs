import assert from 'node:assert/strict'
import test from 'node:test'

import { TavernPromptTemplateRuntime } from '../tavern-plugin/lib/domain/tavern-prompt-template-runtime.js'

const runtime = await TavernPromptTemplateRuntime.create()

test('使用官方 EJS 语义执行转义、原文、条件、循环与 print', () => {
  const result = runtime.render('<%= html %>|<%- html %>|<% if (show) { for (const item of items) print(item) } %>', {
    locals: { html: '<b>x</b>', show: true, items: ['甲', '乙'] }
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, '&lt;b&gt;x&lt;/b&gt;|<b>x</b>|甲乙')
})

test('模板变量按 global initial local message 优先级合并并可持久修改作用域', () => {
  const result = runtime.render([
    '<%= variables.value %>',
    '<% setGlobalVar("globalOnly", 2) %>',
    '<% setLocalVar("localOnly", 3) %>',
    '<% setvar("value", 5) %>',
    '<%= getGlobalVar("globalOnly") + getLocalVar("localOnly") + getMessageVar("value") %>'
  ].join(''), {
    scopes: {
      global: { value: 1 }, initial: { value: 2 }, local: { value: 3 }, message: { value: 4 }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, '410')
  assert.equal(result.scopes.global.globalOnly, 2)
  assert.equal(result.scopes.local.localOnly, 3)
  assert.equal(result.scopes.message.value, 5)
})

test('同一请求内按消息顺序传播模板变量更新', () => {
  const result = runtime.renderMessages([
    { role: 'system', content: '<% setLocalVar("mode", "仙侠") %>' },
    { role: 'user', content: '<%= getLocalVar("mode") %>' }
  ], { scopes: { local: {} } })
  assert.deepEqual(result.messages.map(item => item.content), ['', '仙侠'])
  assert.equal(result.scopes.local.mode, '仙侠')
  assert.equal(result.evaluated, 2)
})

test('模板无法访问 Node、网络与宿主进程', () => {
  for (const name of ['process', 'require', 'fetch']) {
    const result = runtime.render(`<%= typeof ${name} %>`)
    assert.equal(result.ok, true)
    assert.equal(result.text, 'undefined')
  }
})

test('语法错误、无限循环与超大输出被局部隔离', () => {
  assert.equal(runtime.render('<% if ( %>').kind, 'syntax-error')
  assert.equal(runtime.render('<% while (true) {} %>').kind, 'execution-limit')
  assert.equal(runtime.render(`<%= 'x'.repeat(${300 * 1024}) %>`).kind, 'output-limit')

  const messages = runtime.renderMessages([
    { role: 'system', content: '保留 <% if ( %>' },
    { role: 'user', content: '正常 <%= 1 + 1 %>' }
  ])
  assert.deepEqual(messages.messages.map(item => item.content), ['保留 <% if ( %>', '正常 2'])
  assert.deepEqual(messages.diagnostics, [{ kind: 'prompt-template', code: 'syntax-error', messageIndex: 0 }])
})

test('YAML、聊天记录、世界书读取和 lodash 常用函数可用', () => {
  const result = runtime.render([
    '<%= _.get(variables, "stat_data.hp") %>|',
    '<%= lastUserMessage %>|',
    '<%- (await getwi("规则")).trim() %>|',
    '<%- YAML.stringify({ a: 1 }).trim() %>'
  ].join(''), {
    scopes: { message: { stat_data: { hp: 9 } } },
    transcript: [{ role: 'user', content: '行动' }],
    worldBookEntries: [{ id: '1', name: '规则', comment: '规则', content: '遵守设定' }]
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, '9|行动|遵守设定|a: 1')
})

test('从世界书专用条目初始化 EJS 变量且不接受普通条目', () => {
  const result = runtime.initializeVariables([
    { enabled: true, comment: '普通条目', content: 'ignored: true' },
    { enabled: true, comment: '[InitialVariables] 基础', content: '角色:\n  体力: 10\n  标签: [旧]' },
    { enabled: true, comment: '装饰器', content: '@@initial_variables\n角色:\n  标签: [新]\n模式: <%= "仙侠" %>' }
  ])
  assert.deepEqual(result.initial, { 角色: { 体力: 10, 标签: ['新'] }, 模式: '仙侠' })
  assert.deepEqual(result.diagnostics, [])
})
