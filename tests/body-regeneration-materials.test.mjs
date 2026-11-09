import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBodyRegenerationMaterials, captureBodyRegenerationSource, visibleBodyRegenerationHistory } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'

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
