import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionStablePrefixSections, stableCardName, stableSectionBody } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { cardSystemPromptSnapshot } from '../tavern-plugin/lib/domain/card-system-prompt.js'
import { isWithdrawnEntryText, withdrawnEntryText } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'

// Fixed prefixes frozen by chats of three periods: the original Chinese headings (before 11-03),
// the English tags of #491 (11-03 to 11-12) and today's tags.
const PREFIXES = {
  chinese: '【故事设定 · 人物卡】\n名字: 雨夜\n\n设定: 港口小城\n\n【人物卡系统提示】\n叙述雨夜的故事\n\n【常驻世界书】\n港口规则',
  english: '<character_card>\nName: 雨夜\n</character_card>\n\n<character_description>\nDescription: 港口小城\n</character_description>\n\n<card_system>\n叙述雨夜的故事\n</card_system>\n\n<constant_worldbook>\n港口规则\n</constant_worldbook>',
  current: '<character_card_name>\n雨夜\n</character_card_name>\n\n<character_description>\n港口小城\n</character_description>\n\n<card_system>\n叙述雨夜的故事\n</card_system>\n\n<lorebook_constant>\n港口规则\n</lorebook_constant>'
}

for (const [period, text] of Object.entries(PREFIXES)) {
  test(`frozen ${period} prefix splits into the same sections and reads back`, () => {
    const sections = sessionStablePrefixSections({ id: 'compat', events: [] }, text)
    assert.deepEqual(sections.map(section => section.name), ['tavern:character-card', 'tavern:card-system-prompt', 'tavern:constant-worldbook'])
    const byName = Object.fromEntries(sections.map(section => [section.name, section.text]))
    assert.equal(stableCardName(byName['tavern:character-card']), '雨夜')
    assert.equal(stableSectionBody('tavern:card-system-prompt', byName['tavern:card-system-prompt']).trim(), '叙述雨夜的故事')
    assert.equal(stableSectionBody('tavern:constant-worldbook', byName['tavern:constant-worldbook']).trim(), '港口规则')
    // The same system prompt is not announced again as an update.
    assert.equal(cardSystemPromptSnapshot({ id: 'compat', events: [] }, '叙述雨夜的故事', [], text), null)
    assert.match(cardSystemPromptSnapshot({ id: 'compat', events: [] }, '新的叙述', [], text).rendered, /^<card_system_update>\nCard system prompt update · /)
  })
}

test('a withdrawn entry is written tagged and recognized in both forms', () => {
  assert.equal(withdrawnEntryText('entry:7'), '<lorebook_entry_withdrawn>\n世界书条目 entry:7 已更新为空；先前该条目的内容已撤回，不再作为当前设定。\n</lorebook_entry_withdrawn>')
  assert.ok(isWithdrawnEntryText(withdrawnEntryText('entry:7')))
  assert.ok(isWithdrawnEntryText('【世界书条目 entry:7 已更新为空；先前该条目的内容已撤回，不再作为当前设定。】'))
  assert.ok(!isWithdrawnEntryText('世界书条目 entry:7 的正文'))
})
