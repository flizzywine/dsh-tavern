import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('素材抽取直接进入 Agent 对话，不再使用原生身份弹窗', () => {
  const flow = between(clientSource, 'async function newExtractSession', 'function formatTime')

  assert.doesNotMatch(flow, /window\.prompt/)
  assert.match(flow, /call\("startExtract", \{ sourceIds: sourceIds, sessionId: sessionId, player: "" \}\)/)
})

test('成功创建抽取会话后关闭选择器并清空素材勾选', () => {
  const flow = between(clientSource, 'async function newExtractSession', 'function formatTime')
  const start = flow.indexOf('await call("startExtract"')
  const close = flow.indexOf('setPicking(false)', start)
  const clear = flow.indexOf('setSelectedSourceIds([])', start)
  const refresh = flow.indexOf('await refresh()', start)

  assert.ok(start >= 0 && close > start && clear > start)
  assert.ok(close < refresh && clear < refresh)
})

test('Tavern 只接管会话区域，保留 DSH 原生设置与模型配置入口', () => {
  assert.match(clientSource, /slots\.inject\("sidebar\.workspaces"/)
  assert.doesNotMatch(clientSource, /slots\.inject\("sidebar",/)
})

test('酒馆会话就绪后通过 DSH 原生布局打开状态栏，不再依赖定时重试', () => {
  const sidebar = between(clientSource, 'function TavernSidebar', 'function RevisionFieldsPanel')

  assert.match(sidebar, /readyTavernSession/)
  assert.match(sidebar, /summaries\[current\]\.blank === false/)
  assert.match(sidebar, /history\.some\(function \(entry\) \{ return entry\.sessionId === current; \}\)/)
  assert.match(sidebar, /props\.openDetails\(\)/)
  assert.doesNotMatch(clientSource, /ensureDetailsOpen|setTimeout\(props\.openDetails|1000 \* i/)
})

test('剧本预览只显示当前召回和后续块', () => {
  assert.match(clientSource, /index === 0 \? "当前召回" : "后续"/)
  assert.doesNotMatch(clientSource, /上一块（已召回）|当前待召回|scriptPreview\.previous/)
})
