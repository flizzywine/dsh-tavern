// Read-only replay of a captured foreground request. Never writes user data or
// calls a provider. Supply the player's macro name as argv[3] if it is not 你.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContextPlanner } from '../../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameBuilder } from '../../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

const record = JSON.parse(await readFile(process.argv[2], 'utf8'))
const messages = record.request.messages
const text = m => typeof m.content === 'string' ? m.content : (m.content || []).map(b => b.text || '').join('')
const tail = messages.at(-1)
assert.equal(tail.source.form, 'foreground-frame')
const sections = tail.source.sections
const original = sections.find(s => s.source.sectionKind === 'previous-source')
assert(original, 'request must contain the duplicated source contribution')
const history = messages.slice(0, -1)
const previous = history.slice().reverse().find(m => m.role === 'assistant')
const plan = await createContextPlanner({ prompt: () => '' }).plan({ purpose: 'body',
  card: { name: text(messages[0]).match(/名字: ([^\n]+)/)?.[1] || '' },
  chat: { macroState: { userName: process.argv[3] || '你' }, messages: [{ role: 'assistant', text: text(previous),
    sourceText: original.text.slice(original.text.indexOf('\n') + 1) }] } })
const replacement = plan.sections.find(s => s.kind === 'previous-source')
const frame = createForegroundFrameBuilder().build({ chatId: 'audit', branchId: 'audit', operationId: 'audit',
  basedOnRevision: 1, turn: 2, inputs: [{ kind: 'foreground.user-input', projectedText: 'audit' },
    ...sections.map(s => ({ kind: s.source.sectionKind === 'previous-source' ? 'foreground.current-state' : 'foreground.writing-rules',
      text: s === original ? replacement.text : s.text, source: s.source }))] })
const projected = createForegroundFrameSessionAdapter({ id: () => 'audit' }).append({ messages: history, frame, step: 1 }).messages
assert.deepEqual(projected.slice(0, -1), history)
assert(!text(projected.at(-1)).includes('【上一轮正文源文本'))
assert.equal(text(projected.at(-1)), sections.filter(s => s !== original).map(s => s.text.trim()).join('\n\n'))
const size = list => list.reduce((n, m) => n + text(m).length, 0)
const before = size(messages), after = size(projected)
console.log(JSON.stringify({ beforeMessageChars: before, afterMessageChars: after, removedChars: before - after,
  reductionPercent: Number(((1 - after / before) * 100).toFixed(1)), historyUnchanged: true,
  unit: 'characters, not provider tokens; no model call' }, null, 2))
