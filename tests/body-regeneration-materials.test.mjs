import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBodyRegenerationMaterials, captureBodyRegenerationSource, visibleBodyRegenerationHistory } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'
import { publicBodyMaterials } from '../tavern-plugin/lib/domain/body-generation-materials.js'

test('正文生成与旧轮重生成材料只保留玩家称呼和人物卡上下文', () => {
  const card = { name: '人物卡' }
  const stable = '<character_card>\n人物设置\n</character_card>'
  const cardContextSnapshot = '<user_preferences>\n旧偏好\n</user_preferences>\n\n' + stable
  const beforeChat = { id: 'x', sessionId: 'game', messages: [], cardContextSnapshot, userProfileContextSnapshot: '旧偏好',
    cardDefinitionSnapshot: card, macroState: { userName: '玩家' } }
  const capture = captureBodyRegenerationSource({ chat: beforeChat, card }).regenerationMaterials
  assert.equal(capture.cardContext, stable)
  assert.deepEqual(capture.persona, { name: '玩家', description: '' })
  const archived = { ...capture, cardContext: cardContextSnapshot, persona: { name: '玩家', description: '旧偏好' } }
  const frame = { kind: 'foreground', turn: 2, userInput: { sourceText: '继续' }, contributions: [
    { slot: 'currentStateProjection', text: '本轮范文', source: { writingReference: true } },
    { slot: 'currentStateProjection', text: '其他插件状态' }
  ], source: { regenerationMaterials: archived } }
  const chat = { ...beforeChat, foregroundFrames: { frame } }
  const dto = buildBodyRegenerationMaterials({ chat, beforeChat, turn: 2, kind: 'generate', targetInput: { raw: '继续' } })
  assert.equal(dto.cardContext, stable)
  assert.deepEqual(dto.persona, { name: '玩家', description: '' })
  assert.deepEqual(publicBodyMaterials(dto).context.filter(section => section.kind === 'writing-rules').map(section => section.text), ['本轮范文'])
  assert.equal(frame.source.regenerationMaterials.persona.description, '旧偏好')
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
