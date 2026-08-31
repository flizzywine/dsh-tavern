// Read-only replay of a captured background request, preserving every section
// except the production MVU prompt projection. Never writes cards or sessions.
// node tests/fixtures/mvu-prompt-size-audit.mjs /path/to/request.json
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createMvuBackgroundTaskFrame, projectMvuBackgroundRequest } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'

const record = JSON.parse(await readFile(process.argv[2], 'utf8'))
const before = record.request
const after = structuredClone(before)
let found = false
let originalVariables
for (const message of after.messages || []) {
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block.type !== 'text' || !block.text.includes('【当前变量快照】')) continue
    const text = block.text
    const start = text.indexOf('【当前变量快照】')
    const schemaStart = text.indexOf('\n【变量结构】\n', start)
    const rulesStart = text.indexOf('\n【人物卡变量更新规则】\n', schemaStart)
    const end = text.indexOf('\n\n【最近剧情与本次任务】', rulesStart)
    assert(start >= 0 && schemaStart > start && rulesStart > schemaStart && end > rulesStart)
    const variables = JSON.parse(text.slice(start + '【当前变量快照】\n'.length, schemaStart))
    const schema = JSON.parse(text.slice(schemaStart + '\n【变量结构】\n'.length, rulesStart))
    const rules = text.slice(rulesStart + '\n【人物卡变量更新规则】\n'.length, end)
    const storyStart = text.indexOf('[正文]\n', end)
    const storyEnd = text.indexOf('\n\n【DSH 后台任务协议', storyStart)
    assert(storyStart > end && storyEnd > storyStart)
    const frame = createMvuBackgroundTaskFrame({ operationId: 'audit', chatId: 'audit', branchId: 'audit', basedOnRevision: 0,
      messageId: 0, swipeId: 0, storyText: text.slice(storyStart + '[正文]\n'.length, storyEnd), currentVariables: variables, variableSchema: schema, updateRules: [rules] })
    const projected = projectMvuBackgroundRequest(frame).turnContext
    const projectedVariables = JSON.parse(projected.split('【当前变量快照】\n')[1].split('\n【变量结构】')[0])
    assert.deepEqual(projectedVariables.stat_data, variables.stat_data)
    assert(projected.endsWith(rules))
    assert.deepEqual(frame.authoritativeState.currentVariables, variables)
    block.text = text.slice(0, start) + projected + text.slice(end)
    found = true
    originalVariables = variables
  }
}
assert(found, 'not a captured MVU settlement request')
const messageText = request => request.messages.map(message => typeof message.content === 'string' ? message.content :
  (message.content || []).map(block => block.text || '').join('\n')).join('\n')
const beforeChars = messageText(before).length, afterChars = messageText(after).length
console.log(JSON.stringify({ beforeMessageChars: beforeChars, afterMessageChars: afterChars,
  removedChars: beforeChars - afterChars, reductionPercent: Number(((1 - afterChars / beforeChars) * 100).toFixed(1)),
  originalRootChars: Object.fromEntries(Object.entries(originalVariables).map(([key, value]) => [key, JSON.stringify(value).length])),
  stateAndRulesPreserved: true, unit: 'characters, not provider tokens; no new model call' }, null, 2))
