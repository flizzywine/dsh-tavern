import test from 'node:test'
import assert from 'node:assert/strict'

import { compileSillyTavernRequest } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'

function resolveMacros(text, context) {
  return { text: String(text).replaceAll('{{char}}', context.charName).replaceAll('{{user}}', context.macroState.userName), diagnostics: [], macroState: context.macroState }
}

test('兼容编译器按 prompt_order 展开 marker 并保留 system user assistant 边界', () => {
  const result = compileSillyTavernRequest({
    card: { name: '阿芙拉', description: '人物描述', first_mes: '开场白' },
    preset: {
      title: '酒馆预设', orderGroupIndex: 0,
      entries: [
        { entryKey: 'main#1', identifier: 'main', name: '主提示', role: 'system', content: '扮演 {{char}}', enabled: true, ordered: true },
        { entryKey: 'begin#1', identifier: 'begin', name: '开始', role: 'user', content: '开始 {{user}}', enabled: true, ordered: true },
        { entryKey: 'disabled#1', identifier: 'disabled', name: '关闭', role: 'assistant', content: '不应出现', enabled: false, ordered: true },
        { entryKey: 'char#1', identifier: 'charDescription', name: '人物', role: 'system', content: '', marker: true, enabled: true, ordered: true },
        { entryKey: 'history#1', identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true, enabled: true, ordered: true }
      ]
    },
    presetPath: 'presets/demo.json', presetDocument: {}, userName: '玩家',
    history: [{ role: 'assistant', text: '开场白' }], input: '你好', resolveMacros
  })
  assert.deepEqual(result.messages.map(function (item) { return [item.role, item.content] }), [
    ['system', '扮演 阿芙拉'], ['user', '开始 玩家'], ['system', '人物描述'], ['assistant', '开场白'], ['user', '你好']
  ])
  assert.deepEqual(result.trace.selectedEntryKeys, ['main#1', 'begin#1', 'char#1', 'history#1'])
})

test('人物卡 system prompt 与历史后指令遵循酒馆覆盖语义', () => {
  const result = compileSillyTavernRequest({
    card: { name: '角色', system_prompt: '卡片主提示', post_history_instructions: '卡片历史后指令' },
    preset: { entries: [
      { entryKey: 'main#1', identifier: 'main', role: 'system', content: '预设主提示', enabled: true, ordered: true },
      { entryKey: 'jailbreak#1', identifier: 'jailbreak', role: 'system', content: '预设历史后指令', enabled: true, ordered: true }
    ] },
    presetDocument: {}, resolveMacros
  })
  assert.deepEqual(result.messages.map(function (item) { return item.content }), ['卡片主提示', '卡片历史后指令'])
})

test('禁止覆盖的 main 与 jailbreak 保留预设原文', () => {
  const result = compileSillyTavernRequest({
    card: { name: '角色', system_prompt: '卡片主提示', post_history_instructions: '卡片历史后指令' },
    preset: { entries: [
      { entryKey: 'main#1', identifier: 'main', role: 'system', content: '预设主提示', forbidOverrides: true, enabled: true, ordered: true },
      { entryKey: 'jailbreak#1', identifier: 'jailbreak', role: 'system', content: '预设历史后指令', forbidOverrides: true, enabled: true, ordered: true }
    ] },
    presetDocument: {}, resolveMacros
  })
  assert.deepEqual(result.messages.map(function (item) { return item.content }), ['预设主提示', '预设历史后指令'])
})

test('对话示例只识别与当前玩家和角色名匹配的英文冒号前缀', () => {
  const mismatch = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '玩家：不应进入\n角色：也不应进入' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(mismatch.messages, [])

  const matched = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '你: 问候\n角色: 回答' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(matched.messages.map(function (item) { return [item.role, item.name || '', item.content] }), [
    ['system', '', '[开始示例]'],
    ['system', 'example_user', '问候'],
    ['system', 'example_assistant', '回答']
  ])
})

test('绝对深度条目插入聊天历史且正则只投影真实聊天消息', () => {
  const result = compileSillyTavernRequest({
    card: { name: '角色' },
    preset: { entries: [
      { entryKey: 'depth#1', identifier: 'depth', role: 'system', content: '深度内容', enabled: true, ordered: true, injectionPosition: 1, injectionDepth: 1 },
      { entryKey: 'history#1', identifier: 'chatHistory', role: 'system', content: '', marker: true, enabled: true, ordered: true }
    ] },
    presetDocument: {}, history: [{ role: 'assistant', text: '原始' }], input: '输入', resolveMacros,
    projectPromptText: function (text) { return { text: String(text).replace('输入', '投影输入'), warnings: [] } }
  })
  assert.deepEqual(result.messages.map(function (item) { return [item.role, item.content] }), [
    ['assistant', '原始'], ['system', '深度内容'], ['user', '投影输入']
  ])
})

test('变量条目不进入请求且提示词正则只处理聊天消息并按最新消息计算深度', () => {
  const calls = []
  const result = compileSillyTavernRequest({
    card: { name: '角色' },
    preset: { entries: [
      { entryKey: 'vars#1', identifier: 'vars', role: 'system', content: '{{setvar::style::轻小说}}{{// 作者注释}}', enabled: true, ordered: true },
      { entryKey: 'bypass#1', identifier: 'bypass', role: 'user', content: '预设用户角色 {{getvar::style}}', enabled: true, ordered: true },
      { entryKey: 'history#1', identifier: 'chatHistory', role: 'system', content: '', marker: true, enabled: true, ordered: true }
    ] },
    presetDocument: {},
    history: [
      { role: 'user', text: '较早输入' },
      { role: 'assistant', text: '最近回复' }
    ],
    input: '当前输入',
    resolveMacros: function (text, context) {
      const rendered = renderTavernMacros(text, {
        charName: context.charName,
        userName: context.macroState.userName,
        localVariables: context.macroState.local,
        globalVariables: context.macroState.global
      })
      return {
        text: rendered.text,
        diagnostics: rendered.diagnostics,
        macroState: {
          userName: context.macroState.userName,
          local: rendered.localVariables,
          global: rendered.globalVariables
        }
      }
    },
    projectPromptText: function (text, context) {
      calls.push({ text, context })
      return { text: context.placement === 1 && context.depth <= 1 ? '<input>' + text + '</input>' : text, warnings: [] }
    }
  })

  assert.deepEqual(result.messages.map(function (item) { return [item.role, item.content] }), [
    ['user', '预设用户角色 轻小说'],
    ['user', '较早输入'],
    ['assistant', '最近回复'],
    ['user', '<input>当前输入</input>']
  ])
  assert.deepEqual(calls.map(function (item) { return [item.text, item.context.placement, item.context.depth] }), [
    ['较早输入', 1, 2],
    ['最近回复', 2, 1],
    ['当前输入', 1, 0]
  ])
})
