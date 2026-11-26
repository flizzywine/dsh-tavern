import assert from 'node:assert/strict'
import test from 'node:test'
import { createIncrementalReplyView } from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import { applyTavernRegexText } from '../tavern-plugin/lib/domain/tavern-regex-display.js'

const marker = '<StatusPlaceHolderImpl/>'
const update = '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'
const rule = (id, findRegex, replaceString) => ({ id, scriptName: id, findRegex, replaceString, placement: [2], markdownOnly: true })
const html = name => '\n\n```html\n<div>' + name + '</div><script></script>\n```\n'
const gate = rule('gate', String.raw`/(<\/UpdateVariable(?:variable)?>[\s\S]*?)<StatusPlaceHolderImpl\/>|()<StatusPlaceHolderImpl\/>(?=[\s\S]*<UpdateVariable(?:variable)?>)/g`, '$1<StatusPlaceHolderREADY/>')
const renderer = rule('renderer', '<StatusPlaceHolderREADY/>', html('status panel'))
const warning = rule('warning', String.raw`<StatusPlaceHolderImpl\/>`, html('missing update'))
const nativePanel = rule('native-panel', String.raw`<mvu-status\/>`, html('persistent panel'))

async function project(text, regexScripts) {
  const chat = { id: 'conditional-mvu', messages: [
    { role: 'assistant', turn: 1, greeting: true, text: 'Welcome.\n<mvu-status/>' },
    { role: 'user', text: 'Continue.' },
    { role: 'assistant', turn: 2, text },
  ] }
  return await createIncrementalReplyView().project(chat, { regexScripts })
}

test('the MVU gate controls the floor status without making its fallback a persistent panel', async () => {
  const regexScripts = [gate, renderer, warning, nativePanel]
  for (const text of [update + '\n' + marker, marker + '\n' + update]) {
    const view = await project(text, regexScripts)
    assert.deepEqual(view.statusViews.map(panel => panel.title), ['native-panel'])
    assert.match(view.projections.at(-1).text, /status panel/)
    assert.doesNotMatch(view.projections.at(-1).text, /missing update/)
  }
  const missing = await project('Story\n' + marker, regexScripts)
  assert.deepEqual(missing.statusViews.map(panel => panel.title), ['native-panel'])
  assert.match(missing.projections.at(-1).text, /missing update/)

  const noMarker = await project('Story', regexScripts)
  assert.deepEqual(noMarker.statusViews.map(panel => panel.title), ['native-panel'])
  assert.doesNotMatch(noMarker.projections.at(-1).text, /status panel|missing update/)
})

test('only a preceding display gate changes persistent status inference', async () => {
  for (const regexScripts of [
    [{ ...gate, disabled: true }, warning],
    [{ ...gate, promptOnly: true, markdownOnly: false }, warning],
    [warning, gate],
  ]) {
    const view = await project('Story\n' + marker, regexScripts)
    assert.deepEqual(view.statusViews.map(panel => panel.title), ['warning'])
    assert.doesNotMatch(view.projections.at(-1).text, /missing update/)
  }
})

test('official MVU promotes only the confirmed floor and refreshes a cached warning', async () => {
  const source = 'Story\n' + marker
  const regexScripts = [gate, renderer, warning, rule('command-display', '<UpdateVariable>', 'command shown')]
  const options = { regexScripts, placement: 2, depth: 0 }
  let changes
  const projector = createIncrementalReplyView({ readChanges: async () => changes })
  const floor = { role: 'assistant', turn: 2, sourceText: source, text: source, swipeId: 0 }
  let chat = { id: 'official', _storageRevision: 1, mvu: { enabled: true, owner: 'official' }, messages: [
    { ...floor, turn: 1, mvu: { receipt: { status: 'error' } } },
    { ...floor, mvu: { pending: true, receipt: { status: 'pending' } } },
  ] }
  const pending = await projector.project(chat, options, options, { shared: true })
  assert.match(pending.projections[1].text, /missing update/)
  const confirmed = { ...floor, variables: [{ stat_data: { hp: 8 } }], mvu: { receipt: { status: 'updated' } } }
  chat = { ...chat, _storageRevision: 2, messages: [chat.messages[0], confirmed] }
  changes = { baseRevision: 1, chat, denseMessages: true, indices: [1], messageCount: 2 }
  const result = await projector.project(chat, options, options, { shared: true })
  assert.equal(result.projections[0], pending.projections[0])
  assert.match(result.projections[1].text, /status panel/)
  assert.doesNotMatch(result.projections[1].text, /missing update|UpdateVariable|command shown/)
  assert.equal(confirmed.text, source)
  assert.equal(confirmed.sourceText, source)
  assert.equal(projector.stats().projectedMessages, 3)
})

test('a confirmed update replaces a pre-rendered warning and preserves the rest of the message', async () => {
  const options = { regexScripts: [gate, renderer, warning], placement: 2, depth: 0 }
  const text = 'Story\n' + marker
  const staleDisplay = applyTavernRegexText(text, options.regexScripts, { placement: 2, isMarkdown: true }).text
  const formattingText = 'Rendered prefix\n' + staleDisplay + '\nRendered suffix'
  for (const kind of ['template', 'frozen']) {
    const markings = kind === 'template' ? { tavernPluginData: { template_display: { source: text, swipe: 0, formattingText, html: formattingText } } }
      : { bodyHostRegexApplied: true, displayText: formattingText }
    const floor = { role: 'assistant', turn: 2, text, ...markings }
    for (const [status, overrides, showPanel] of [
      ['updated', {}, true], ['unchanged', {}, true], ['error', {}, false], ['partial', {}, false],
      ['updated', { toolOnly: true }, false]
    ]) {
      const chat = { id: kind, mvu: { enabled: true, owner: 'official' },
        messages: [{ ...floor, mvu: { receipt: { status, ...overrides } } }] }
      const { projections } = await createIncrementalReplyView().project(chat, options)
      assert.match(projections[0].text, /Rendered prefix[\s\S]*Rendered suffix/)
      assert.match(projections[0].text, showPanel ? /status panel/ : /missing update/)
      assert.doesNotMatch(projections[0].text, showPanel ? /missing update/ : /status panel/)
    }
  }
})
