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

test('独立与人物卡内置世界书使用明确类型引用，不会退化为整张人物卡', () => {
  assert.deepEqual(mentionedTavernResources('参考 @[通用设定](tavern-worldbook:worldbooks%2F%E9%80%9A%E7%94%A8.json) @[红楼梦](tavern-worldbook:cards%2F%E7%BA%A2%E6%A5%BC%E6%A2%A6.json)'), [
    { kind: 'worldbook', path: 'worldbooks/通用.json', label: '通用设定' },
    { kind: 'worldbook', path: 'cards/红楼梦.json', label: '红楼梦' },
  ])
  assert.deepEqual(rememberTavernResources([], '@[红楼梦](tavern-worldbook:cards%2F%E7%BA%A2%E6%A5%BC%E6%A2%A6.json)'), [
    { kind: 'worldbook', path: 'cards/红楼梦.json', label: '红楼梦' },
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

test('人物卡任务提示不会删除已挂载的单轮游玩诊断引用', () => {
  const reference = {
    kind: 'play-chat', path: 'play-chat:chat-source', label: '校园 · 游玩第 2 轮',
    chatId: 'chat-source', turn: 2, sourceUpdatedAt: 123,
    cardSnapshotVersion: 3, cardSnapshotDigest: '1234567890abcdef'
  }
  assert.deepEqual(rememberTavernResources([reference], '【目标人物卡】\n@"cards/校园.json"'), [
    reference,
    { kind: 'card', path: 'cards/校园.json', label: '校园.json' }
  ])
})

test('伪造或残缺的游玩诊断引用不会进入人物卡工作台', () => {
  assert.deepEqual(rememberTavernResources([
    { kind: 'play-chat', path: 'play-chat:other', chatId: 'chat-source', turn: 2 },
    { kind: 'play-chat', path: 'play-chat:chat-source', chatId: 'chat-source', turn: 0 }
  ], ''), [])
})
