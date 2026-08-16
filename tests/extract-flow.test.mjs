import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

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

test('空玩家身份由首轮 Agent 对话确认，并可通过 cardPatch.player 写入', () => {
  assert.match(serverSource, /请直接在对话中告诉我两件事：准备提炼谁/)
  assert.match(serverSource, /typeof patch\.player === 'string'/)
  assert.match(serverSource, /ext\.player = nextPlayer/)
})
