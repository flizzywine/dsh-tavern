import test from 'node:test'
import assert from 'node:assert/strict'
import { composeTavernRegexScripts } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { renderTavernRegexDisplay } from '../tavern-plugin/lib/domain/tavern-regex-display.js'

const rule = (name, findRegex, replaceString) => ({ name, findRegex, replaceString, enabled: true, placement: [2], markdownOnly: true })
const displayOptions = { isMarkdown: true, placement: 2, depth: 0 }

test('legacy card-only extensions preserve internal order and allow absent groups', () => {
  const a = rule('a', 'a', 'b'), b = rule('b', 'b', 'c'), p = rule('p', 'p', 'a')
  assert.deepEqual(composeTavernRegexScripts({ regexScripts: [a,b] }, [p]), [p,a,b])
  assert.deepEqual(composeTavernRegexScripts(null, [p]), [p])
})

test('complete and partial display replacements preserve raw and fenced HTML', () => {
  const source = '[DEMO_OPENING]'
  const html = '<div>Demo opening UI</div>'
  for (const replacement of [html, '```html\n' + html + '\n```']) {
    const rules = [rule('opening', '^\\[DEMO_OPENING\\]$', replacement)]
    const full = renderTavernRegexDisplay(source, rules, displayOptions)
    assert.equal(full.bodyText, '')
    assert.equal(full.text, replacement)
    assert.equal(full.presentationText, replacement)
    assert.equal(full.changed, true)
    assert.deepEqual(full.warnings, [])
  }

  const partial = renderTavernRegexDisplay('故事\n' + source, [rule('opening', '\\[DEMO_OPENING\\]', html)], displayOptions)
  assert.equal(partial.bodyText, '故事\n')
  assert.equal(partial.text, '故事\n' + html)
  assert.equal(partial.presentationText, html)
})

test('display rules can jointly consume the entire source', () => {
  const html = '<div>界面</div>'
  const result = renderTavernRegexDisplay('[DATA]\n[UI]', [
    rule('hide data', '\\[DATA\\]', ''),
    rule('show UI', '\\[UI\\]', html)
  ], displayOptions)
  assert.equal(result.bodyText.trim(), '')
  assert.equal(result.text.trim(), html)
  assert.equal(result.presentationText, html)
  assert.deepEqual(result.applied.map(match => match.name), ['hide data', 'show UI'])
})

test('fallback preserves rule diagnostics when the entire display is blank or comment-only', () => {
  const source = '[DEMO_OPENING]'
  for (const replacement of ['', ' \n ', ' <!-- first -->\n<!-- second --> ']) {
    const result = renderTavernRegexDisplay(source, [rule('opening', '.*', replacement)], displayOptions)
    assert.equal(result.text, source)
    assert.equal(result.bodyText, source)
    assert.equal(result.presentationText, '')
    assert.equal(result.changed, false)
    assert.deepEqual(result.applied, [{ index: 0, id: '', name: 'opening', matches: 1 }])
    assert.match(result.warnings.join('\n'), /整轮正文/)
  }
})
