import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { prependSystemInstruction } from '../tavern-plugin/lib/domain/system-append.js'
import { markTavernSectionsLiteral } from '../tavern-plugin/lib/domain/literal-sections.js'
import { ensureSessionVariableDirectory } from '../tavern-plugin/lib/domain/session-variable-directory.js'
import { ensureSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

// Card data may name a stat_data key with a SillyTavern macro; the host
// interpolates {{name}} strictly and rejects every unregistered name. Tavern
// therefore marks its sections literal at the assembly exits, which also covers
// events recorded before the mark existed.
const exit = sections => markTavernSectionsLiteral({ sections }).sections
const LITERAL = '【故事设定 · 人物卡】\n名字: 测试人物\n\n设定: {{user}} 表示玩家。\n\n【常驻世界书】\n{{char}} 把钥匙交给 {{user}}。'

test('变量目录的宏路径原样保留，并在出口按字面文本装配', async () => {
  const session = Session.create('braces-directory')
  const chat = { mode: 'story', messages: [{ swipeId: 0, variables: [{ stat_data: { '{{user}}': { 穿搭: { 上身: '衬衫' } }, 世界: { 当前时间: '08:00' } } }] }] }
  assert.ok(ensureSessionVariableDirectory(session, chat))
  const section = sessionEvents(session).flatMap(event => event.data?.source?.sections || []).find(item => item.name === 'tavern:variable-directory')
  assert.match(section.text, /"\/\{\{user\}\}\/穿搭\/上身"/)
  assert.ok(exit(sessionStablePrefixSections(session)).every(item => item.interpolate === false))
})

test('存量快照在出口补上字面标记，且不改写已落盘事件', async () => {
  const session = Session.create('braces-legacy')
  await ensureSessionStablePrefix(session, LITERAL)
  const before = JSON.stringify(sessionEvents(session))
  const sections = exit(sessionStablePrefixSections(session))
  assert.ok(sections.length >= 2)
  assert.ok(sections.every(section => section.interpolate === false))
  assert.ok(sections.some(section => section.text.includes('{{user}} 表示玩家')))
  assert.equal(JSON.stringify(sessionEvents(session)), before)
})

test('动态世界书投影同样按字面文本装配', () => {
  const sections = exit(withCurrentWorldbook([{ name: 'tavern:character-card', text: '设定' }], '{{char}} 说：{{user}} 回来了。'))
  assert.equal(sections[0].name, 'tavern:constant-worldbook')
  assert.equal(sections[0].interpolate, false)
  assert.match(sections[0].text, /\{\{char\}\}/)
  assert.equal(sections[1].name, 'tavern:character-card')
})

test('玩家手写的追加指令不参与变量插值，非酒馆段落不受影响', () => {
  const host = { name: 'tool:web_search', text: '{{provider}}' }
  const assembly = markTavernSectionsLiteral(prependSystemInstruction({ sections: [host] }, '  用 {{user}} 称呼玩家  '))
  assert.deepEqual(assembly.sections.map(section => section.name), ['tavern:system-append', 'tool:web_search'])
  assert.equal(assembly.sections[0].interpolate, false)
  assert.equal(assembly.sections[0].text, '<system_append>\n用 {{user}} 称呼玩家\n</system_append>')
  assert.equal(assembly.sections[1], host)
})
