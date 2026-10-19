// 原生把同一个 assistant 节点渲染两次：过程面板座（groupPart 为 "reasoning"，面板标题就是
// 「已完成分析」）与正式回复座（groupPart 为 "response"）。过程座若照旧渲染整条消息，正文会
// 同时出现在过程面板和回复里（折叠过程、打开「隐藏上下文注入和思考过程」还会连坐）。
// 这里守住「只在回复座渲染」这条规则，源码与构建产物都要有。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('assistant 节点只在回复座渲染，过程座不再重复渲染正文', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const built = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const guard = /props\.groupPart !== "response"/
  assert.match(source, guard)
  assert.match(built, guard)
})
