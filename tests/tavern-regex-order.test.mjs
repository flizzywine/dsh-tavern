import test from 'node:test'
import assert from 'node:assert/strict'
import { composeTavernRegexScripts } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

const rule = (name, findRegex, replaceString) => ({ name, findRegex, replaceString, enabled: true, placement: [2], markdownOnly: true })

test('legacy card-only extensions preserve internal order and allow absent groups', () => {
  const a = rule('a', 'a', 'b'), b = rule('b', 'b', 'c'), p = rule('p', 'p', 'a')
  assert.deepEqual(composeTavernRegexScripts({ regexScripts: [a,b] }, [p]), [p,a,b])
  assert.deepEqual(composeTavernRegexScripts(null, [p]), [p])
})

test('display rules can jointly consume the entire source', () => {
  const source = '[DATA]\n[UI]'
  const html = '<div>界面</div>'
  const regexScripts = [
    rule('hide data', '\\[DATA\\]', ''),
    rule('show UI', '\\[UI\\]', html)
  ]
  const result = projectReplyLayers(source, { regexScripts, placement: 2 })
  assert.equal(result.sessionText, source)
  assert.equal(result.displayText.trim(), html)
  assert.deepEqual(result.displayParts.filter(part => part.kind === 'html'), [{ kind: 'html', content: html }])
  assert.deepEqual(result.applied.display.map(match => match.name), ['hide data', 'show UI'])
})

test('display rules can hide the whole message while retaining the source and rule diagnostics', () => {
  const source = '[DEMO_OPENING]'
  for (const replacement of ['', ' \n ', ' <!-- first -->\n<!-- second --> ']) {
    const result = projectReplyLayers(source, { regexScripts: [rule('opening', '.*', replacement)], placement: 2 })
    assert.equal(result.sessionText, source)
    assert.equal(result.displayText, replacement)
    assert.equal(result.displayParts.map(part => part.text ?? part.content).join('').trim(), '')
    assert.deepEqual(result.applied.display, [{ index: 0, id: '', name: 'opening', matches: 1 }])
  }
})
