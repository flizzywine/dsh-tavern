import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

function between(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing start marker: ${start}`)
  assert.notEqual(to, -1, `missing end marker: ${end}`)
  return source.slice(from, to)
}

test('模型选择只读取当前会话和 DSH 默认值', () => {
  assert.doesNotMatch(serverSource, /getSettings|updateSettings|settings\.json|settings\.provider|settings\.model/)
  assert.match(serverSource, /当前会话的模型选择器/)
})

test('素材抽取使用结构化卡片修改工具，不再传递 JSON 字符串', () => {
  assert.doesNotMatch(serverSource, /draftPatch/)
  assert.doesNotMatch(serverSource, /cardPatch|worldBookPatch/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.match(serverSource, /fields: \{/)
  assert.match(serverSource, /worldBook: \{/)
})

test('模型工具只保留按需读取和明确修改', () => {
  assert.doesNotMatch(serverSource, /name: 'tavern_session'|action=context|action=commit|assistantText.*description/)
  assert.match(serverSource, /name: 'tavern_read_script'/)
  assert.match(serverSource, /name: 'tavern_read_worldbook'/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.doesNotMatch(serverSource, /additionalProperties: true \},\s*render/)
})

test('候选项 RPC 只返回一份 candidates', () => {
  const dispatch = between(serverSource, "case 'generateChoices'", "case 'addGuide'")

  assert.match(dispatch, /return \{ candidates: candidates \}/)
  assert.doesNotMatch(dispatch, /choices: candidates\.choices/)
  assert.match(clientSource, /readyCandidatePanel\(props\.sessionId, props\.messageId, result\.candidates\)/)
  assert.match(clientSource, /查看后台 Agent/)
  assert.doesNotMatch(clientSource, /button\[aria-haspopup="tree"\] \{ display: none !important; \}/)
  assert.match(clientSource, /refreshSubagents\(panel\.sessionId\)/)
  assert.match(clientSource, /openSubagent\(\{ parentSessionId: panel\.sessionId, childSessionId: panel\.traceSessionId, mode: panel\.traceMode \}\)/)
})

test('姿势结算限制为短 JSON 输出', () => {
  const input = between(serverSource, 'function settleUserText', 'function parseJsonLenient')
  const flow = between(serverSource, 'async function runSettlement', 'function queueSettlement')
  const systemPrompt = prompt('posture-settlement')

  assert.match(input, /slice\(-2\)/)
  assert.match(input, /【上一轮结算姿势】/)
  assert.doesNotMatch(input, /slice\(-4\)/)
  assert.match(systemPrompt, /只输出 JSON/)
  assert.match(systemPrompt, /位置、姿势、动作/)
  assert.match(flow, /maxTokens: 3000/)
  assert.doesNotMatch(flow, /maxTokens: 400/)
  assert.match(flow, /attempt < 2/)
  assert.match(flow, /姿势 JSON 无效/)
  assert.match(flow, /text\.slice\(0, 200\)/)
  assert.match(flow, /backgroundAgentRunner\.run/)
  assert.match(flow, /task: 'settlement'/)
  assert.match(flow, /persistent: true/)
  assert.match(flow, /participant: \{ sessionId: backgroundSessionId/)
})

test('达到输出 token 上限时不把截断内容当作成功', () => {
  const call = between(serverSource, 'async function callModel', 'const contextPlanner')

  assert.match(call, /finish\.kind === 'max-tokens'/)
  assert.match(call, /模型输出达到 token 上限/)
})

test('后台 Agent 不进入前台正文上下文注入和工具过滤', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(lifecycle, /backgroundAgentRunner\.owns\(sessionId\)/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(sessionId\)\) return next\(\)/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(sessionId\)\) return/)
  assert.match(lifecycle, /if \(backgroundAgentRunner\.owns\(agent\.session\.id\)\) return assembly/)
})

test('无玩家输入的开场回合不进入正文结算', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(lifecycle, /const userText = userTextForTurn\(session, payload\.turn\)/)
  assert.match(lifecycle, /if \(userText === ''\) return/)
  assert.match(lifecycle, /userText,\s*assistantText:/)
})

test('只有人物卡开场白时不启动姿势结算', () => {
  const sessionView = between(serverSource, 'async function sessionView', 'async function ensureNativeOpening')
  assert.match(sessionView, /message\.greeting !== true/)
  assert.doesNotMatch(sessionView, /chat\.messages\.length > 0/)
})

test('人物卡原版与清理后的工作版分开保存', () => {
  const importFlow = between(serverSource, 'async function importCard', 'async function listCards')
  assert.match(importFlow, /originals\/cards/)
  assert.match(importFlow, /cleanWorkspaceCardMacros\(card\)/)
})

test('游玩固定选择一个开场白，并用它对齐剧本', () => {
  const startChat = between(serverSource, 'async function startChat', 'async function appendNativeOpening')
  const appendOpening = between(serverSource, 'async function appendNativeOpening', 'async function scriptPreviewOf')

  assert.match(startChat, /resolveCardOpening\(card\)/)
  assert.match(startChat, /chat\.openingText = greeting/)
  assert.match(startChat, /startAligned\(script, greeting, card\.script_start\)/)
  assert.match(startChat, /text: greeting.*greeting: true/)
  assert.match(appendOpening, /typeof chat\.openingText === 'string'/)
  assert.match(appendOpening, /text = chat\.openingText/)
  assert.doesNotMatch(serverSource, /switchOpening|openingViewOf|openingId|switchable: !hasStory/)
})
