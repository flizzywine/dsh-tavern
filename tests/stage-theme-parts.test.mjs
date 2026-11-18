import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {JSDOM} from 'jsdom'
import {splitStageThemes} from '../tavern-plugin/packages/dsh-tavern-stage/lib/theme-parts.js'

const require = createRequire(import.meta.url)
const {createStageThemeSheet} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/theme-sheet.cjs')

const css = `/* head */
.a { color: red; }
.s[data-theme="crt"] .box { color: green; }
.s[data-theme="crt"], .s[data-theme="classic"] .box { color: blue; }
.s[data-theme="classic"] .box { content: "}{"; }
.s:not([data-fk-skin]) .box { color: black; }
.s[data-fk-skin-art] .box { color: white; }
.s:is([data-fk-skin-buttons], [data-fk-skin-decor]) .b { color: gray; }
.s:is([data-fk-skin-buttons], .plain) .b { color: gray; }
@media (max-width: 640px) { .s[data-fk-skin-art] .x { top: 0; } .s[data-fk-cs-nav] .y { top: 1px; } }
@keyframes k { from { opacity: 0; } to { opacity: 1; } }
.z { color: red; }
`

test('themes split by the marks every selector needs, in source order', () => {
  const theme = splitStageThemes(css, {defaultTheme:'classic'})
  // a selector without a mark (the classic alternative, :not(), an :is() with an unmarked branch) keeps its rule in the base
  assert.deepEqual(theme.parts.map(([family, text]) => [family, text.split('\n').length]),
    [['', 1], ['theme-crt', 1], ['', 3], ['skin', 2], ['', 1], ['skin', 1], ['', 2]])
  assert.deepEqual(theme.marks, {
    skin:'[data-fk-cs-nav],[data-fk-skin-art],[data-fk-skin-buttons],[data-fk-skin-decor]',
    'theme-crt':'[data-theme="crt"]'
  })
  assert.match(theme.parts[2][1], /"\}\{"/, 'strings keep their braces')
  assert.doesNotMatch(theme.parts.map(([, text]) => text).join('\n'), /head/, 'comments are dropped')
})

test('the real themes.css loses no rule and keeps its order', async () => {
  const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css', import.meta.url), 'utf8')
  const theme = splitStageThemes(source, {defaultTheme:'classic'})
  const squash = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')
  assert.equal(squash(theme.parts.map(([, text]) => text).join('\n')), squash(source))
  assert.ok(theme.marks['theme-crt'] && theme.marks['theme-aero'] && theme.marks.skin)
  const base = theme.parts.filter(([family]) => !family).reduce((sum, [, text]) => sum + text.length, 0)
  assert.ok(base < source.length / 2, 'a classic stage without a pack skin applies under half of the file')
})

test('a family applies the first time one of its marks is in the document, before the next frame', async () => {
  const dom = new JSDOM('<!doctype html><html><head><style></style></head><body><div class="s" data-theme="classic"></div></body></html>')
  const {document, MutationObserver} = dom.window
  const style = document.querySelector('style')
  const stop = createStageThemeSheet({style, theme:splitStageThemes(css, {defaultTheme:'classic'}), document, MutationObserver})
  assert.doesNotMatch(style.textContent, /green|white/)
  const stage = document.querySelector('.s')
  stage.setAttribute('data-theme', 'crt')
  await Promise.resolve()
  assert.match(style.textContent, /green/)
  assert.doesNotMatch(style.textContent, /white/)
  const pop = document.createElement('div')
  pop.innerHTML = '<span data-fk-skin-art="1"></span>'
  document.body.append(pop)
  await Promise.resolve()
  const text = style.textContent
  assert.ok(text.indexOf('green') < text.indexOf('"}{"') && text.indexOf('"}{"') < text.indexOf('white') && text.indexOf('white') < text.indexOf('.z'), 'source order')
  stage.setAttribute('data-theme', 'classic')
  await Promise.resolve()
  assert.match(style.textContent, /green/, 'families are never removed')
  stop()
})
