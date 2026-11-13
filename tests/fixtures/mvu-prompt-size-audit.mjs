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
    if (block.type !== 'text' || !block.text.includes('<variable_state>\nVariable schema:\n')) continue
    const text = block.text
    const start = text.indexOf('<variable_state>\n')
    const end = text.indexOf('\n</variable_state>', start) + '\n</variable_state>'.length
    const body = text.slice(start, end).split('\n')
    const line = label => body[body.indexOf(label) + 1]
    const schema = JSON.parse(line('Variable schema:'))
    const variables = JSON.parse(line('Current variable snapshot:'))
    const rulesAt = body.indexOf('Card variable update rules:')
    const rules = rulesAt < 0 ? [] : [body.slice(rulesAt + 1, body.indexOf('Current variable snapshot:')).join('\n')]
    assert(start >= 0 && end > start)
    const storyStart = text.indexOf('[Story]\n', end)
    const storyEnd = text.indexOf('\n</recent_task>', storyStart)
    assert(storyStart > end && storyEnd > storyStart)
    const frame = createMvuBackgroundTaskFrame({ operationId: 'audit', chatId: 'audit', branchId: 'audit', basedOnRevision: 0,
      messageId: 0, swipeId: 0, storyText: text.slice(storyStart + '[Story]\n'.length, storyEnd), currentVariables: variables, variableSchema: schema, updateRules: rules })
    const projected = projectMvuBackgroundRequest(frame).turnContext
    const projectedVariables = JSON.parse(projected.split('\n')[projected.split('\n').indexOf('Current variable snapshot:') + 1])
    assert.deepEqual(projectedVariables.stat_data, variables.stat_data)
    assert(rules.every(text => projected.includes(text)))
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
