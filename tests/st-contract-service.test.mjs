import test from 'node:test'
import assert from 'node:assert/strict'
import { tavernStContract as st, projectPluginBody } from '../tavern-plugin/lib/domain/st-contract-service.js'

const rules = [
  { findRegex: '<think>.*?</think>', replaceString: '', placement: [2], promptOnly: true },
  { findRegex: 'plan', replaceString: 'panel', placement: [2], markdownOnly: true },
]

test('shared regex service separates channels and respects depth, placement and edits', async () => {
  const input = { text: '<think>plan</think>body', regexScripts: rules }
  assert.equal((await st.applyRegex({ ...input, channel: 'prompt' })).text, 'body')
  assert.equal((await st.applyRegex({ ...input, channel: 'display' })).text, '<think>panel</think>body')
  assert.equal((await st.applyRegex({ ...input, channel: 'prompt', placement: 1 })).text, input.text)
  assert.equal((await st.applyRegex({ ...input, channel: 'prompt', isEdit: true })).text, input.text)
  assert.equal((await st.applyRegex({ ...input, regexScripts: [{ ...rules[0], minDepth: 2 }], channel: 'prompt', depth: 1 })).text, input.text)
  await assert.rejects(st.applyRegex({ ...input, channel: 'output' }), /channel/)
})

test('macro service returns local snapshots without mutating env or persisting between calls', async () => {
  const env = { userName: '玩家', charName: '角色', localVariables: { n: 1 }, globalVariables: { g: '值' } }
  const result = await st.renderMacros({ text: '{{user}}/{{char}}/{{incvar::n}}/{{getglobalvar::g}}/{{unknown}}', env })
  assert.equal(result.text, '玩家/角色/2/值/{{unknown}}')
  assert.equal(result.localVariables.n, 2)
  assert.equal(env.localVariables.n, 1)
  assert.equal((await st.renderMacros({ text: '{{getvar::n}}', env })).text, '1')
  await assert.rejects(st.renderMacros({ text: 'x', allowScript: true }), /allowScript/)
})

test('plugin projection composes plugin then opt-in host rules independently per channel', async () => {
  const result = await projectPluginBody('<think>plan</think>body', { pluginRegexScripts: rules, hostRegex: true,
    regexScripts: [{ findRegex: 'body', replaceString: 'HOST', placement: [2] }] })
  assert.equal(result.sourceText, '<think>plan</think>body')
  assert.equal(result.sessionText, 'HOST')
  assert.equal(result.displayText, '<think>panel</think>HOST')
  const disabled = await projectPluginBody('body', { pluginRegexScripts: [], regexScripts: [{ findRegex: 'body', replaceString: 'HOST', placement: [2] }] })
  assert.equal(disabled.sessionText, 'body')
})

test('invalid, empty and runaway projections retain the original body with a warning', async () => {
  for (const [text, options] of [
    ['body', { projectionWarning: 'invalid rules' }],
    ['body', { pluginRegexScripts: [{ findRegex: '[', replaceString: '', placement: [2] }] }],
    ['body', { pluginRegexScripts: [{ findRegex: '.*', replaceString: '', placement: [2] }] }],
    ['a'.repeat(100) + '!', { pluginRegexScripts: [{ findRegex: '(a+)+$', replaceString: '', placement: [2] }] }],
  ]) {
    const result = await projectPluginBody(text, options)
    assert.equal(result.sessionText, text)
    assert.equal(result.displayText, text)
    assert.equal(result.warnings.length, 1)
  }
  assert.equal((await st.applyRegex({ text: 'body', regexScripts: [], channel: 'prompt' })).text, 'body', 'worker capacity is released after failure')
})
