import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { readFileSync } from 'node:fs'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const cardList = readFileSync(new URL('../tavern-plugin/src/client/features/card-list.js', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
const globalSettings = readFileSync(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

// 设置 › 高级 › 对话按最新回复排序：默认关闭，列表按创建时间固定排列。
test('对话排序设置默认按创建时间，布尔值才落盘', () => {
  assert.equal(presentTavernSettings({}, {}).recentReplyFirst, false)
  const enabled = applyTavernSettingsPatch({ other: 'keep' }, { recentReplyFirst: true })
  assert.equal(enabled.recentReplyFirst, true)
  assert.equal(enabled.other, 'keep')
  assert.equal(presentTavernSettings(enabled, {}).recentReplyFirst, true)
  assert.equal(applyTavernSettingsPatch(enabled, { recentReplyFirst: false }).recentReplyFirst, false)
  for (const value of ['true', 1, null, {}]) {
    assert.throws(() => applyTavernSettingsPatch(enabled, { recentReplyFirst: value }), /对话排序设置必须是布尔值/)
    assert.equal(presentTavernSettings({ recentReplyFirst: value }, {}).recentReplyFirst, false)
  }
})

test('设置 › 高级 有「对话按最新回复排序」开关，绑定 recentReplyFirst', () => {
  assert.match(globalSettings, /sw\("recentReplyFirst", "对话按最新回复排序"/)
})

const ROWS = [
  // 旧对话回复了：活动时间最新，创建时间最早。
  { sessionId: 'session-a', chatId: 'chat-a', cardPath: 'card.json', cardName: '卡', mode: 'story', createdAt: 100, updatedAt: 900, lastOpenedAt: 100 },
  { sessionId: 'session-b', chatId: 'chat-b', cardPath: 'card.json', cardName: '卡', mode: 'story', createdAt: 300, updatedAt: 300, lastOpenedAt: 300 },
  { sessionId: 'session-c', chatId: 'chat-c', cardPath: 'other.json', cardName: '另一张卡', mode: 'story', createdAt: 200, updatedAt: 200, lastOpenedAt: 200 }
]

// 结果来自 vm 上下文，转成宿主数组再比较，避免跨 realm 的原型差异。
function keys(items, key) { return Array.from(items, item => key(item)); }

function helpers() {
  const ctx = vm.createContext({})
  for (const name of ['tavernHistoryCardKey', 'tavernHistoryActivity', 'tavernHistoryReplyAt', 'tavernHistoryOrder', 'groupTavernHistory', 'orderTavernHistory', 'sortTavernHistoryByActivity', 'tavernHistoryStamp']) {
    vm.runInContext(sourceFunction(cardList, name), ctx)
  }
  return ctx
}

test('创建序：整张列表和卡内对话都保持创建时间固定排列', () => {
  const ctx = helpers()
  const ordered = ctx.orderTavernHistory(ROWS, {}, 'created')
  assert.deepEqual(keys(ordered, item => item.sessionId), ['session-b', 'session-c', 'session-a'])
  const groups = ctx.groupTavernHistory(ROWS, {}, 'created')
  assert.deepEqual(keys(groups, group => group.key), ['card:card.json', 'card:other.json'])
  assert.deepEqual(keys(groups[0].items, item => item.sessionId), ['session-b', 'session-a'])
})

test('最新回复序：刚回复过的旧对话排到最前，卡组和组内都一样', () => {
  const ctx = helpers()
  const ordered = ctx.orderTavernHistory(ROWS, {}, 'recent')
  assert.deepEqual(keys(ordered, item => item.sessionId), ['session-a', 'session-b', 'session-c'])
  const groups = ctx.groupTavernHistory(ROWS, {}, 'recent')
  assert.deepEqual(keys(groups, group => group.key), ['card:card.json', 'card:other.json'])
  assert.deepEqual(keys(groups[0].items, item => item.sessionId), ['session-a', 'session-b'])
})

test('最新回复序把宿主会话摘要的回复时间算进来，并列时按创建时间', () => {
  const ctx = helpers()
  const summaries = { 'session-c': { updatedAt: 1000 } }
  assert.deepEqual(keys(ctx.orderTavernHistory(ROWS, summaries, 'recent'), item => item.sessionId), ['session-c', 'session-a', 'session-b'])
  const tied = [{ sessionId: 'old', chatId: 'x', createdAt: 100, updatedAt: 500 }, { sessionId: 'new', chatId: 'y', createdAt: 200, updatedAt: 500 }]
  assert.deepEqual(keys(ctx.orderTavernHistory(tied, {}, 'recent'), item => item.sessionId), ['new', 'old'])
  // created 序不受宿主摘要影响：这里它只决定行内时间，不决定位置。
  assert.deepEqual(keys(ctx.orderTavernHistory(ROWS, summaries, 'created'), item => item.sessionId), ['session-b', 'session-c', 'session-a'])
})

test('行内时间跟随排序：创建序是创建时间，最新回复序是最近活动时间', () => {
  const ctx = helpers()
  const item = ROWS[0]
  assert.equal(ctx.tavernHistoryStamp(item, { updatedAt: 950 }, { 'session-a': { updatedAt: 950 } }, 'created'), 100)
  assert.equal(ctx.tavernHistoryStamp(item, { updatedAt: 950 }, { 'session-a': { updatedAt: 950 } }, 'recent'), 950)
  // 只有单条摘要时也按活动时间走，不会退回创建时间。
  assert.equal(ctx.tavernHistoryStamp(item, { updatedAt: 950 }, null, 'recent'), 950)
})

test('侧边栏按偏好切换排序，并在设置变化后重新读取', () => {
  assert.match(sidebar, /recentReplyFirst === true \? "recent" : "created"/)
  // 未归档与已归档两张表各自排序：侧栏把归档从主列表拆成了独立分组。
  assert.match(sidebar, /const orderedActiveHistory = orderTavernHistory\(activeHistory, summaries, historyOrder\)/)
  assert.match(sidebar, /const orderedArchivedHistory = orderTavernHistory\(archivedHistory, summaries, historyOrder\)/)
  assert.match(sidebar, /groupTavernHistory\(orderedActiveHistory, summaries, historyOrder\)/)
  assert.match(sidebar, /void reloadHistoryOrder\(\)/)
  assert.match(sidebar, /formatTime\(tavernHistoryStamp\(item, summary, summaries, historyOrder\)\)/)
})

test('最新回复序：切换/打开对话不改变位置，只有新回复才排到最前', () => {
  const ctx = helpers()
  const rows = [
    { sessionId: 'session-old', chatId: 'chat-old', cardPath: 'card.json', cardName: '卡', mode: 'story', createdAt: 100, updatedAt: 100, lastOpenedAt: 900 },
    { sessionId: 'session-new', chatId: 'chat-new', cardPath: 'card.json', cardName: '卡', mode: 'story', createdAt: 200, updatedAt: 500, lastOpenedAt: 500 },
    { sessionId: 'session-mid', chatId: 'chat-mid', cardPath: 'other.json', cardName: '另一张卡', mode: 'story', createdAt: 300, updatedAt: 300, lastOpenedAt: 300 }
  ]
  // 刚切到创建最早、回复也最早那条：lastOpenedAt 最大，仍排在最后。
  assert.deepEqual(keys(ctx.orderTavernHistory(rows, {}, 'recent'), item => item.sessionId), ['session-new', 'session-mid', 'session-old'])
  const groups = ctx.groupTavernHistory(rows, {}, 'recent')
  assert.deepEqual(keys(groups, group => group.key), ['card:card.json', 'card:other.json'])
  assert.deepEqual(keys(groups[0].items, item => item.sessionId), ['session-new', 'session-old'])
  // 同一张卡内也一样：打开过的旧档不会挤到新档前面。
  assert.deepEqual(keys(ctx.sortTavernHistoryByActivity(rows, {}), item => item.sessionId), ['session-new', 'session-mid', 'session-old'])
  // 行内时间是最近回复时间，不是打开时间。
  assert.equal(ctx.tavernHistoryStamp(rows[0], null, {}, 'recent'), 100)
  // 宿主摘要的回复时间照旧参与排序（打开存档不会写摘要的 updatedAt）。
  const summaries = { 'session-old': { updatedAt: 1000 } }
  assert.deepEqual(keys(ctx.orderTavernHistory(rows, summaries, 'recent'), item => item.sessionId), ['session-old', 'session-new', 'session-mid'])
})
