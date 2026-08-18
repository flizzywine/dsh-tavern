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

test('候选项使用独立提示，不再复用正文输出约束', () => {
  const flow = between(serverSource, 'async function generateChoices', 'async function getChoices')

  assert.match(flow, /buildCandidateSystem/)
  assert.doesNotMatch(flow, /buildSystem\(/)
  assert.doesNotMatch(flow, /只输出小说正文/)
  assert.equal((flow.match(/【用户额外要求】/g) || []).length, 1)
  assert.match(serverSource, /cardContextParts\(card, chat, undefined, true, false\)/)
})

test('模型选择只读取当前会话和 DSH 默认值', () => {
  assert.doesNotMatch(serverSource, /getSettings|updateSettings|settings\.json|settings\.provider|settings\.model/)
  assert.match(serverSource, /当前会话的模型选择器/)
})

test('注入模型的人物卡变量统一替换为实际卡名和你', () => {
  assert.match(serverSource, /return substChar\(text, card, '你', str\(card\.name\)\)/)
  assert.doesNotMatch(serverSource, /所有其他角色/)
  assert.match(serverSource, /renderCardText\(card\.system_prompt, card\)/)
  assert.match(serverSource, /renderCardText\(card\.mes_example, card\)/)
})

test('素材抽取提交返回卡片草稿语义', () => {
  assert.doesNotMatch(serverSource, /draftPatch/)
  assert.match(serverSource, /value\.mode === 'extract'/)
  assert.match(serverSource, /卡片草稿已更新/)
  assert.match(serverSource, /卡片草稿未改动/)
})

test('候选项 RPC 只返回一份 candidates', () => {
  const dispatch = between(serverSource, "case 'generateChoices'", "case 'addGuide'")

  assert.match(dispatch, /return \{ candidates: candidates \}/)
  assert.doesNotMatch(dispatch, /choices: candidates\.choices/)
  assert.match(clientSource, /result\.candidates && result\.candidates\.choices/)
})

test('姿势结算限制为短 JSON 输出', () => {
  const flow = between(serverSource, 'async function runSettlement', 'function queueSettlement')

  assert.match(flow, /maxTokens: 400/)
  assert.match(flow, /text\.slice\(0, 200\)/)
})
