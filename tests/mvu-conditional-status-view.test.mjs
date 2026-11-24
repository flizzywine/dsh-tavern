import assert from 'node:assert/strict'
import test from 'node:test'
import { createIncrementalReplyView } from '../tavern-plugin/lib/domain/incremental-reply-view.js'

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
