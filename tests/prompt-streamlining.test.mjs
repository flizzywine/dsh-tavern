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
  assert.match(clientSource, /查看候选 Agent 运行轨迹/)
  assert.match(clientSource, /body\.dsh-tavern-shell-active button\[aria-haspopup="tree"\] \{ display: none !important; \}/)
  assert.match(clientSource, /refreshSubagents\(panel\.sessionId\)/)
  assert.match(clientSource, /openSubagent\(\{ parentSessionId: panel\.sessionId, childSessionId: panel\.traceSessionId, mode: "one-shot" \}\)/)
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
})

test('达到输出 token 上限时不把截断内容当作成功', () => {
  const call = between(serverSource, 'async function callModel', 'const contextPlanner')

  assert.match(call, /finish\.kind === 'max-tokens'/)
  assert.match(call, /模型输出达到 token 上限/)
})

test('候选 Agent 不进入正文上下文注入和工具过滤', () => {
  const lifecycle = between(serverSource, '// ---------- DSH 回合生命周期 ----------', '// ---------- 模型可选工具 ----------')

  assert.match(lifecycle, /candidateAgentRunner\.owns\(sessionId\)/)
  assert.match(lifecycle, /if \(candidateAgentRunner\.owns\(sessionId\)\) return next\(\)/)
  assert.match(lifecycle, /if \(candidateAgentRunner\.owns\(sessionId\)\) return/)
  assert.match(lifecycle, /if \(candidateAgentRunner\.owns\(agent\.session\.id\)\) return assembly/)
})

test('剧本正文产生明显推进后自然收束，不把剧本块当清单', () => {
  const systemPrompt = prompt('script-story')

  assert.match(systemPrompt, /明显的剧情推进/)
  assert.match(systemPrompt, /自然收束/)
  assert.match(systemPrompt, /不是.*清单/)
})
