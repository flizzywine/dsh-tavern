import assert from 'node:assert/strict'
import test from 'node:test'

import { mentionedTavernResources, rememberTavernResources, resourceWorkspaceContext } from '../tavern-plugin/lib/domain/workspace-resources.js'

test('卡片 Agent 获得原生文件工具所需的绝对资源根目录', () => {
  const context = resourceWorkspaceContext('/workspace/data/resources')

  assert.match(context, /\/workspace\/data\/resources/)
  assert.match(context, /str_replace_editor/)
  assert.match(context, /必须使用绝对路径/)
  assert.match(context, /Tavern 工具.*相对路径/)
  assert.match(context, /不得猜测 `\/materials`/)
})

test('读取 DSH 原生路径引用并按真实路径挂载 Tavern 资料', () => {
  assert.deepEqual(mentionedTavernResources('参考 @"cards/阿芙拉.json" @"presets/写作预设.json" @"materials/长篇 小说.md" @"scripts/阿芙拉/银铃.txt"'), [
    { kind: 'card', path: 'cards/阿芙拉.json', label: '阿芙拉.json' },
    { kind: 'preset', path: 'presets/写作预设.json', label: '写作预设.json' },
    { kind: 'source', path: 'materials/长篇 小说.md', label: '长篇 小说.md' },
    { kind: 'script', path: 'scripts/阿芙拉/银铃.txt', label: '银铃.txt' },
  ])
})

test('继续读取历史 tavern-file 结构化资源引用', () => {
  assert.deepEqual(mentionedTavernResources('参考 @[阿芙拉](tavern-file:cards%2F%E9%98%BF%E8%8A%99%E6%8B%89.json) @[长篇 小说](tavern-file:materials%2F%E9%95%BF%E7%AF%87%20%E5%B0%8F%E8%AF%B4.md) @[银铃](tavern-file:scripts%2F%E9%98%BF%E8%8A%99%E6%8B%89%2F%E9%93%B6%E9%93%83.txt)'), [
    { kind: 'card', path: 'cards/阿芙拉.json', label: '阿芙拉' },
    { kind: 'source', path: 'materials/长篇 小说.md', label: '长篇 小说' },
    { kind: 'script', path: 'scripts/阿芙拉/银铃.txt', label: '银铃' },
  ])
})

test('挂载资源按真实相对路径持久去重', () => {
  assert.deepEqual(rememberTavernResources([{ kind: 'card', path: 'cards/阿芙拉.json', label: '旧名' }], '@[阿芙拉](tavern-file:cards%2F%E9%98%BF%E8%8A%99%E6%8B%89.json) @[银铃](tavern-file:scripts%2F%E9%98%BF%E8%8A%99%E6%8B%89%2F%E9%93%B6%E9%93%83.txt)'), [
    { kind: 'card', path: 'cards/阿芙拉.json', label: '阿芙拉' },
    { kind: 'script', path: 'scripts/阿芙拉/银铃.txt', label: '银铃' },
  ])
})

test('普通路径与 DSH Session 引用都不是 Tavern 资源', () => {
  assert.deepEqual(mentionedTavernResources('@"notes/a.md" @[研究对话](dsh-session:abc-123) 请继续'), [])
})
