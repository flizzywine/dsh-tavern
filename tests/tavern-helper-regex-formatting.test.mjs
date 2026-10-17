import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { createTavernRegexEngine } from '../tavern-plugin/lib/domain/tavern-regex-engine.js'
import { installTavernHelperRegexApi } from '../tavern-plugin/lib/domain/tavern-helper-regex-api.js'
import { renderTavernRegexDisplay } from "../tavern-plugin/lib/domain/tavern-regex-display.js"

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
