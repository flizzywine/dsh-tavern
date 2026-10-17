import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { createTavernRegexEngine } from '../tavern-plugin/lib/domain/tavern-regex-engine.js'
import { installTavernHelperRegexApi } from '../tavern-plugin/lib/domain/tavern-helper-regex-api.js'
import { applyTavernRegexText, renderTavernRegexDisplay } from '../tavern-plugin/lib/domain/tavern-regex-display.js'

function rule(findRegex, replaceString, options = {}) {
  return { findRegex, replaceString, placement: [2], enabled: true, ...options }
}

function harness(context = {}, serialized = false) {
  let state = { character: { path: 'card.json', name: '角色名' }, playerName: '玩家名', ...context }
  const warnings = [], window = { console: { warn: value => warnings.push(value) } }
  const setup = { window, context: () => state, createEngine: createTavernRegexEngine }
  if (serialized) vm.runInNewContext(`(${installTavernHelperRegexApi.toString()})({
    window, context, createEngine: (${createTavernRegexEngine.toString()})
  })`, setup)
  else installTavernHelperRegexApi(setup)
  return { window, warnings, state: () => state, setContext: value => { state = value } }
}

test('formatter routes every upstream source placement and rejects prototype keys', () => {
  const placements = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 }
  const w = harness({ regexScripts: { global: Object.entries(placements).map(([source, placement]) => rule('X', source, { placement: [placement] })) } }).window
  for (const source of Object.keys(placements)) assert.equal(w.formatAsTavernRegexedString('X', source, 'display'), source)
  for (const source of ['assistant', '__proto__', 'toString', undefined]) {
    assert.throws(() => w.formatAsTavernRegexedString('X', source, 'display'), TypeError)
  }
  assert.throws(() => w.formatAsTavernRegexedString('X', 'ai_output', 'storage'), TypeError)
})

test('omitted depth bypasses bounds, explicit depth applies inclusive min/max, host defaults remain depth zero', () => {
  const scripts = [rule('X', 'bounded', { minDepth: 2, maxDepth: 3 })]
  const w = harness({ regexScripts: { global: scripts } }).window
  const format = depth => w.formatAsTavernRegexedString('X', 'ai_output', 'display', { depth })
  assert.equal(format(undefined), 'bounded')
  for (const depth of [0, 1, 4]) assert.equal(format(depth), 'X')
  for (const depth of [2, 3]) assert.equal(format(depth), 'bounded')
  assert.equal(applyTavernRegexText('X', scripts).text, 'X')
  assert.equal(applyTavernRegexText('X', scripts, { depth: 2 }).text, 'bounded')
  assert.equal(applyTavernRegexText('X', scripts, { ignoreDepth: true }).text, 'bounded')
  for (const depth of [NaN, Infinity, '2', null]) assert.throws(() => format(depth), /有限数字/)
})

test('find-pattern identity substitution supports raw and escaped modes and preserves mode zero', () => {
  for (const [mode, input, expected] of [
    [0, '{{char}}', 'matched'], [0, 'A.B', 'A.B'],
    [1, 'AxB', 'matched'], [2, 'A.B', 'matched'], [2, 'AxB', 'AxB']
  ]) {
    const w = harness({ regexScripts: { global: [rule('{{char}}', 'matched', { substituteRegex: mode })] } }).window
    assert.equal(w.formatAsTavernRegexedString(input, 'ai_output', 'display', { character_name: 'A.B' }), expected)
  }
})

test('formatter shares numbered captures, named captures, match token, trimming and sequential replacement semantics', () => {
  const w = harness({ regexScripts: { global: [
    rule('/<item>(?<word>.*?)<\/item>/g', '$<word>:$1:{{match}}', { trimStrings: ['_'] }),
    rule('/foo/g', 'bar')
  ] } }).window
  assert.equal(w.formatAsTavernRegexedString('<item>_foo_</item>', 'ai_output', 'display'), 'bar:bar:<item>bar</item>')
  const withMacroTrim = harness({ regexScripts: { global: [
    rule('/(.*)/', '$1', { trimStrings: ['{{user}}'] })
  ] } }).window
  assert.equal(withMacroTrim.formatAsTavernRegexedString('玩家名说话', 'ai_output', 'display'), '说话')
})

test('character permission follows the live bound card, rather than individual rules or fake avatar settings', () => {
  const run = harness({ extensionSettings: { character_allowed_regex: [] }, regexScripts: { character: [rule('X', 'card', { enabled: false })] } })
  assert.equal(run.window.isCharacterTavernRegexesEnabled(), true)
  assert.equal(run.window.formatAsTavernRegexedString('X', 'ai_output', 'display'), 'X')
  run.setContext({ character: null, extensionSettings: { character_allowed_regex: ['old.png'] }, regexScripts: {
    global: [rule('X', 'global')], character: [rule('global', 'stale-card')]
  } })
  assert.equal(run.window.isCharacterTavernRegexesEnabled(), false)
  assert.equal(run.window.formatAsTavernRegexedString('X', 'ai_output', 'display'), 'global')
  run.setContext({ character: { avatar: 'next.png' }, regexScripts: { character: [rule('X', '{{char}}')] } })
  assert.equal(run.window.isCharacterTavernRegexesEnabled(), true)
  assert.equal(run.window.formatAsTavernRegexedString('X', 'ai_output', 'display'), '角色')
})

test('refactored host display engine retains presentation extraction and whole-body guard', () => {
  const rules = [rule('/<status>(.*?)<\/status>/g', '<aside>$1</aside>')]
  const rendered = renderTavernRegexDisplay('story<status>fine</status>', rules, { isMarkdown: true })
  assert.equal(rendered.text, 'story<aside>fine</aside>')
  assert.equal(rendered.bodyText, 'story')
  assert.equal(rendered.presentationText, '<aside>fine</aside>')
  const guarded = renderTavernRegexDisplay('<status>fine</status>', rules, { isMarkdown: true })
  assert.equal(guarded.changed, false)
  assert.equal(guarded.text, '<status>fine</status>')
  assert.equal(guarded.warnings.length, 1)
})
