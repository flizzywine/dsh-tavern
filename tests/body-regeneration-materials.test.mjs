import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBodyRegenerationMaterials, captureBodyRegenerationSource, findBodyRegenerationFrame,
  visibleBodyRegenerationHistory } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'

function setup() {
  const card = { name: '阿青', description: '原始人物设定', personality: '安静', extensions: { private: 'not-card-material' } }
  const beforeChat = { id: 'game', sessionId: 'session', messages: [{ role: 'assistant', turn: 1, greeting: true,
    text: '被提示词正则删掉', projectionText: '完整开场', variables: [{ stat_data: { money: 10 } }] }],
    cardDefinitionSnapshot: card, cardContextSnapshot: '已展开的人物与常驻世界书', posture: '站在门外',
    variables: { score: 1 }, macroState: { userName: '玩家' }, userProfileContextSnapshot: '玩家设定',
    worldBookVirtualState: { visibility: { refs: ['unchanged', 'changed', 'withdrawn'] }, entries: {
      unchanged: { text: '此前已经生效且未变化的设定' }, changed: { text: '此前的设定' }, withdrawn: { text: '此前已撤回', withdrawn: true }
    } } }
  const prepared = structuredClone(beforeChat)
  prepared.worldBookVirtualState.entries.changed.text = '本轮更新的设定'
  prepared.variables = { score: 2 }
  const frame = { kind: 'foreground', turn: 2, chatId: 'game', branchId: 'branch', operationId: 'body-2',
    userInput: { sourceText: '推开门', projectedText: '【玩家输入】推开门' },
    contributions: [{ slot: 'activeWorldbook', text: '本轮更新的设定' }, { slot: 'writingRules', text: '保持连贯' },
      { slot: 'guide', text: '写具体细节' }, { slot: 'currentStateProjection', text: '不能冒充起点的状态注入' }],
    source: { worldBook: { refs: ['changed'], diagnostics: [{ text: 'private-diagnostic' }] }, ...captureBodyRegenerationSource({ chat: prepared, card }) } }
  const chat = { ...structuredClone(prepared), timeline: { branchId: 'branch', revision: 2 },
    messages: [...structuredClone(beforeChat.messages), { role: 'user', text: '推开门' },
      { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', variables: [{ stat_data: { money: 99 } }] }],
    posture: '已经到屋内', variables: { score: 99 }, foregroundFrames: { 'body-2': frame },
    regenRecovery: { before: { secret: 'private-recovery' } } }
  return { chat, beforeChat, card, turn: 2, assistantIndex: 2, operationId: 'regen-1' }
}

test('materials expose original inputs and authoritative preturn state without host internals', () => {
  const input = setup()
  const materials = buildBodyRegenerationMaterials(input)
  assert.deepEqual(materials.history.map(row => row.text), ['完整开场'])
  assert.deepEqual(materials.input, { raw: '推开门', projected: '【玩家输入】推开门' })
  assert.equal(materials.card.description, '原始人物设定')
  assert.equal(materials.beforeState.posture, '站在门外')
  assert.deepEqual(materials.beforeState.variables, { score: 1 })
  assert.deepEqual(materials.beforeState.messageVariables, { stat_data: { money: 10 } })
  const serialized = JSON.stringify(materials)
  for (const excluded of ['旧正文', 'private-recovery', 'private-diagnostic', 'not-card-material', '不能冒充起点', 'regenerationState']) assert.ok(!serialized.includes(excluded), excluded)
  assert.ok(Object.isFrozen(materials.history[0]))
  input.chat.foregroundFrames['body-2'].source.regenerationMaterials.card.description = '后来改了'
  assert.equal(materials.card.description, '原始人物设定')
})

test('canonical visible history excludes hidden work, discarded swipes and suppressed rounds without truncation', () => {
  const rows = [{ role: 'assistant', greeting: true, turn: 1, projectionText: '开场' },
    { role: 'system', text: 'private-system' }, { role: 'tool', text: 'private-tool' },
    { role: 'tavern-helper', tavernRole: 'assistant', tavernHidden: true, text: 'private-helper' },
    { role: 'user', hidden: true, text: 'private-hidden-user' },
    { role: 'user', text: 'private-suppressed-input' }, { role: 'assistant', turn: 8, projectionText: 'private-suppressed-body' },
    { role: 'user', text: '合法输入' }, { role: 'assistant', turn: 9, projectionText: '合法正文 {{setvar::x::不要执行}}',
      sourceText: 'private-raw-source', swipes: ['private-discarded', '合法正文'], swipeId: 1 },
    { role: 'tavern-helper', tavernRole: 'user', tavernHidden: false, text: '可见补充输入' }]
  for (let turn = 10; turn < 130; turn++) rows.push({ role: 'user', text: '输入' + turn }, { role: 'assistant', turn, projectionText: '完整正文' + turn, text: 'summary-only' })
  const result = visibleBodyRegenerationHistory({ messages: rows, suppressedDshTurns: [8] }, rows.length)
  assert.equal(result.length, 244)
  assert.doesNotMatch(JSON.stringify(result), /private-|summary-only/)
  assert.equal(result[2].input, '合法输入')
  assert.equal(result[2].text, '合法正文 {{setvar::x::不要执行}}')
  assert.equal(result.at(-1).text, '完整正文129')
})

test('hidden targets, sparse history and missing original material fail before a plugin receives anything', () => {
  const hidden = setup(); hidden.chat.messages[2].hidden = true
  assert.throws(() => buildBodyRegenerationMaterials(hidden), { code: 'TAVERN_REGEN_MATERIALS_UNAVAILABLE' })
  const hiddenInput = setup(); hiddenInput.chat.messages[1].tavernHidden = true
  assert.throws(() => buildBodyRegenerationMaterials(hiddenInput), /不可见/)
  const suppressed = setup(); suppressed.chat.suppressedDshTurns = [2]
  assert.throws(() => buildBodyRegenerationMaterials(suppressed), /不可见/)
  const replacing = setup(); replacing.chat.replacingDshTurns = [2]
  assert.throws(() => buildBodyRegenerationMaterials(replacing), /不可见/)
  const missing = setup(); delete missing.chat.foregroundFrames
  assert.throws(() => buildBodyRegenerationMaterials(missing), /原始上下文材料快照/)
  assert.throws(() => visibleBodyRegenerationHistory({ messages: [{ role: 'assistant', stub: true }] }, 1), /完整加载/)
  assert.throws(() => visibleBodyRegenerationHistory({ messages: [{ role: 'assistant', sourceText: '{{setvar::x::1}}正文' }] }, 1), /历史宏/)
})

test('hidden player floors never become an associated input and invisible helper notes do not steal a visible pair', () => {
  const messages = [{ role: 'user', text: '未配对输入' }, { role: 'user', is_hidden: true, text: 'private-hidden-input' },
    { role: 'assistant', turn: 2, projectionText: '独立可见正文' }, { role: 'user', text: '可见玩家输入' },
    { role: 'tavern-helper', tavernRole: 'assistant', tavernHidden: true, text: 'private-helper-note' },
    { role: 'assistant', turn: 3, projectionText: '对应正文' }]
  const history = visibleBodyRegenerationHistory({ messages }, messages.length)
  assert.equal(history[1].input, '')
  assert.equal(history[3].input, '可见玩家输入')
  assert.doesNotMatch(JSON.stringify(history), /private-/)
})

test('a failed input exports the entire visible prefix without inventing a current body', () => {
  const input = setup()
  input.chat.messages = structuredClone(input.beforeChat.messages)
  const result = buildBodyRegenerationMaterials({ ...input, kind: 'failed', assistantIndex: undefined, targetInput: { raw: '推开门' } })
  assert.equal(result.target.kind, 'failed')
  assert.deepEqual(result.history.map(message => message.text), ['完整开场'])
  assert.deepEqual(result.input, { raw: '推开门', projected: '【玩家输入】推开门' })
  assert.throws(() => buildBodyRegenerationMaterials({ ...input, kind: 'failed', targetInput: { raw: '推开门', hidden: true } }), /可见的失败输入/)
  assert.throws(() => buildBodyRegenerationMaterials({ ...input, kind: 'failed', targetInput: { raw: '改过的输入' } }), /原始输入快照/)
})

test('full worldbook includes unchanged effective entries instead of only the last request delta', () => {
  const input = setup()
  const result = buildBodyRegenerationMaterials(input)
  assert.match(result.worldbook.context, /此前已经生效且未变化的设定/)
  assert.match(result.worldbook.context, /本轮更新的设定/)
  assert.doesNotMatch(result.worldbook.context, /此前已撤回|此前的设定/)
  assert.equal(result.worldbook.context.split('本轮更新的设定').length, 2)
  // Older frames reconstruct the same effective set from their checkpoint and changed entry snapshots.
  const frame = input.chat.foregroundFrames['body-2']
  delete frame.source.regenerationMaterials
  frame.source.worldBook.virtualWorldbook = { texts: { changed: '本轮更新的设定' } }
  const older = buildBodyRegenerationMaterials(input)
  assert.equal(older.worldbook.context, result.worldbook.context)
  assert.equal(older.completeness.materials, 'checkpoint')
})

test('repeated regeneration selects the replacement frame, not the original turn frame', () => {
  const input = setup()
  input.chat.regeneratedDshTurns = { 2: 7 }
  const replacement = structuredClone(input.chat.foregroundFrames['body-2'])
  replacement.turn = 7
  replacement.userInput = { sourceText: '重新生成这段 private-previous-body', projectedText: 'synthetic private-previous-body' }
  replacement.contributions.push({ slot: 'writingRules', text: '新一轮的规则' })
  input.chat.foregroundFrames['body-7'] = replacement
  assert.equal(findBodyRegenerationFrame(input.chat, 2), replacement)
  const result = buildBodyRegenerationMaterials(input)
  assert.equal(result.input.projected, '【玩家输入】推开门')
  assert.match(JSON.stringify(result), /新一轮的规则/)
  assert.doesNotMatch(JSON.stringify(result), /private-previous-body/)
})

test('regeneration keeps the frozen lookup supplement without re-reading tools or leaking extra metadata', () => {
  const input = setup()
  const frame = input.chat.foregroundFrames['body-2']
  const original = buildBodyRegenerationMaterials(input)
  frame.source.bodyGenerationToolResults = [{ tool: 'read', text: '工具实际读取的完整设定 {{不可重新执行}}', internal: 'private-tool-diagnostic' }]
  const result = buildBodyRegenerationMaterials(input)
  assert.notEqual(result.digest, original.digest)
  assert.match(result.worldbook.context, /工具实际读取的完整设定 \{\{不可重新执行\}\}/)
  assert.deepEqual(result.worldbook.toolResults, [{ tool: 'read', text: '工具实际读取的完整设定 {{不可重新执行}}' }])
  assert.doesNotMatch(JSON.stringify(result), /private-tool-diagnostic/)
  assert.ok(Object.isFrozen(result.worldbook.toolResults[0]))
  input.chat.regeneratedDshTurns = { 2: 7 }
  input.chat.foregroundFrames['body-7'] = { ...structuredClone(frame), turn: 7, operationId: 'body-7' }
  delete frame.source.bodyGenerationToolResults
  assert.equal(buildBodyRegenerationMaterials(input).worldbook.context, result.worldbook.context)
})

test('visible historical player edits replace the previous template text', () => {
  const history = visibleBodyRegenerationHistory({ messages: [{ role: 'user', text: '玩家改过的输入', projectionText: 'private-old-input',
    bodyEdit: { role: 'user' } }, { role: 'assistant', turn: 2, projectionText: '正文' }] }, 2)
  assert.equal(history[0].text, '玩家改过的输入')
  assert.equal(history[1].input, '玩家改过的输入')
  assert.doesNotMatch(JSON.stringify(history), /private-old-input/)
})

test('capture contains explicit host restore fields but no arbitrary chat properties', () => {
  const input = setup()
  const capture = captureBodyRegenerationSource({ chat: input.chat, card: input.card })
  assert.ok(capture.regenerationState.fields.includes('promptTemplateInput'))
  assert.ok(!Object.hasOwn(capture.regenerationState, 'promptTemplateInput'))
  assert.ok(!Object.hasOwn(capture.regenerationState, 'messages'))
  assert.ok(!Object.hasOwn(capture.regenerationState, 'regenRecovery'))
})

test('capture replaces opening worldbook and system instructions with the prepared request values', () => {
  const input = setup()
  input.chat.cardContextSnapshot = '【用户已确认的长期偏好】\n偏好\n\n【故事设定 · 人物卡】\n人物\n\n【人物卡系统提示】\nprivate-old-instruction\n\n【常驻世界书】\nprivate-old-constant'
  Object.assign(input.chat.foregroundFrames['body-2'].source, captureBodyRegenerationSource({
    chat: input.chat, card: input.card, worldbookPrefix: '本轮完整常驻设定', systemPromptText: '本轮人物卡指令'
  }))
  const materials = buildBodyRegenerationMaterials(input)
  assert.match(materials.cardContext, /偏好[\s\S]*人物[\s\S]*本轮人物卡指令/)
  assert.match(materials.worldbook.context, /本轮完整常驻设定/)
  assert.doesNotMatch(JSON.stringify(materials), /private-old-/)
  // A deliberately empty current prefix withdraws previous constants too.
  const empty = captureBodyRegenerationSource({ chat: input.chat, card: input.card, worldbookPrefix: '', systemPromptText: '' })
  assert.doesNotMatch(empty.regenerationMaterials.cardContext, /private-old-|【常驻世界书】|【人物卡系统提示】/)
})
