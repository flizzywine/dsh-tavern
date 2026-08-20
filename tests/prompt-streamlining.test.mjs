import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const orchestratorSource = await readFile(new URL('../tavern-plugin/lib/domain/turn-orchestration.js', import.meta.url), 'utf8')
const tavernPresetSource = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')

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

test('卡片工作台使用结构化卡片修改工具，不再传递 JSON 字符串', () => {
  assert.doesNotMatch(serverSource, /draftPatch/)
  assert.doesNotMatch(serverSource, /cardPatch|worldBookPatch/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.match(serverSource, /fields: \{/)
  assert.match(serverSource, /worldBook: \{/)
})

test('模型工具只保留按需读取和明确修改', () => {
  assert.doesNotMatch(serverSource, /name: 'tavern_session'|action=context|action=commit|assistantText.*description/)
  assert.match(serverSource, /name: 'tavern_read_script'/)
  assert.match(serverSource, /name: 'tavern_read_card'/)
  assert.match(serverSource, /name: 'tavern_read_source'/)
  assert.match(serverSource, /name: 'tavern_read_worldbook'/)
  assert.match(serverSource, /name: 'tavern_update_card'/)
  assert.doesNotMatch(serverSource, /additionalProperties: true \},\s*render/)
})

test('卡片 Agent 以极简模式工具为底座，游玩 Agent 不暴露文件工具', () => {
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-bash-persistent/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-pwsh-persistent/)
  assert.match(tavernPresetSource, /@deepseek-ai\/dsh-tool-str-replace-editor/)
  assert.match(tavernPresetSource, /disabled: !!js process\.platform === 'win32'/)
  assert.match(tavernPresetSource, /disabled: !!js process\.platform !== 'win32'/)
  assert.match(tavernPresetSource, /shellDialect: pwsh/)
  assert.match(tavernPresetSource, /Run commands in a PowerShell shell/)
  assert.match(tavernPresetSource, /Run commands in a bash shell/)
  assert.match(tavernPresetSource, /State is persistent across command calls and discussions with the user\./)
  assert.match(tavernPresetSource, /Please avoid commands that may produce a very large amount of output\./)
  assert.match(tavernPresetSource, /text: ''/)
  assert.doesNotMatch(tavernPresetSource, /complete: true/)
  assert.match(serverSource, /text: prompt\(mode === 'card' \? 'card-mode' : 'play-mode'\)/)
  assert.match(orchestratorSource, /if \(mode === 'card'\) return \[shellToolName, 'str_replace_editor', 'tavern_read_card', 'tavern_read_source', 'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card'\]/)
  assert.doesNotMatch(orchestratorSource, /mode === 'revision'|mode === 'extract'/)
  assert.doesNotMatch(orchestratorSource, /if \(mode === 'script'\) return \[[^\]]*'bash'/)
  assert.match(serverSource, /controlledToolNames = new Set\(\['bash', 'pwsh', 'str_replace_editor', 'tavern_read_card', 'tavern_read_source', 'tavern_read_script', 'tavern_read_worldbook', 'tavern_update_card'\]\)/)
  assert.doesNotMatch(serverSource, /name: 'tavern_bind_script'/)
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

  assert.match(sessionView, /chat\.messages\.some\(function \(message\)/)
  assert.match(sessionView, /message\.greeting !== true/)
  assert.doesNotMatch(sessionView, /chat\.messages\.length > 0/)
})

test('开场白切换原地替换原生消息，并同步剧本对齐与酒馆记录', () => {
  const startChat = between(serverSource, 'async function startChat', 'async function appendNativeOpening')
  const switchOpening = between(serverSource, 'async function switchOpening', '// ---------- HTTP RPC')
  const appendOpening = between(serverSource, 'async function appendNativeOpening', 'async function scriptPreviewOf')

  assert.match(startChat, /resolveCardOpening\(card, selectedOpeningId\)/)
  assert.match(startChat, /chat\.openingText = greeting/)
  assert.match(startChat, /startAligned\(script, greeting, card\.script_start\)/)
  assert.match(startChat, /text: greeting.*greeting: true/)
  assert.match(appendOpening, /typeof chat\.openingText === 'string'/)
  assert.match(appendOpening, /text = chat\.openingText/)
  assert.match(switchOpening, /本轮正文开始后不能切换开场白/)
  assert.match(switchOpening, /surfaceOp: \{ op: 'replace'/)
  assert.match(switchOpening, /chat\.openingText = greeting/)
  assert.match(switchOpening, /startAligned\(script, greeting, card\.script_start\)/)
  assert.match(serverSource, /switchable: !hasStory/)
})
