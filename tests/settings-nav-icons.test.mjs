import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../tavern-plugin/src/client/settings-nav-icons.js', import.meta.url), 'utf8')
const load = () => { const context = {}; vm.runInNewContext(source + '\nthis.css = settingsNavIconCss; this.install = installSettingsNavIcons;', context); return context }
const entry = (id, order) => ({ options: { id, order } })

test('settings navigation: each known section gets its glyph at the row the shell sorts it to', () => {
  const { css } = load()
  // registration order is not display order: the shell sorts by `order`, stable for ties.
  const sheet = css([entry('dsh-tavern', 110), entry('general', 0), entry('tts', 70), entry('pocket', 0), entry('market', 40)])
  const rows = [...sheet.matchAll(/button:nth-child\((\d+)\)::before \{[^}]*data:image\/svg\+xml,([^"]+)"/g)].map(m => [Number(m[1]), decodeURIComponent(m[2])])
  // general 1, pocket 2, market 3, tts 4, dsh-tavern 5: the shell's own and unknown ids keep their icon.
  assert.deepEqual(rows.map(row => row[0]), [2, 4, 5])
  assert.match(rows[1][1], /M2\.5 6\.5v3M5\.25 4\.5v7/)
  assert.doesNotMatch(sheet, /nth-child\([13]\)/)
})

test('settings navigation hides host glyphs in both row layouts while keeping built-in icons', t => {
  const { css } = load()
  const sheet = css([entry('profile-bridge', 10), entry('tts', 20), entry('general', 30)])
  const dom = new JSDOM(`<style>${sheet}</style><div data-shortcut-modal="settings"><nav><div class="host_navList">
    <button><span class="host_navIcon" aria-hidden="true"><svg></svg></span><span>酒馆启动器</span></button>
    <button><svg></svg><span>语音后端</span></button>
    <button><span class="host_navIcon" aria-hidden="true"><svg></svg></span><span>通用设置</span></button>
  </div></nav></div>`)
  t.after(() => dom.window.close())
  const { document, getComputedStyle } = dom.window
  const [wrappedIcon, directIcon, builtInIcon] = document.querySelectorAll('button > :first-child')
  assert.equal(getComputedStyle(wrappedIcon).display, 'none')
  assert.equal(getComputedStyle(directIcon).display, 'none')
  assert.notEqual(getComputedStyle(builtInIcon).display, 'none')
  for (const label of document.querySelectorAll('button > :last-child')) assert.notEqual(getComputedStyle(label).display, 'none')
})

test('settings navigation: the sheet follows the slot and leaves with the plugin', () => {
  const { install } = load()
  let entries = [entry('tts', 70)], listener = null
  const head = { children: [], appendChild(node) { this.children.push(node); node.remove = () => { head.children = head.children.filter(child => child !== node) } } }
  const doc = { head, createElement: () => ({ dataset: {}, textContent: '' }) }
  const slots = { entries: () => entries, subscribe: (name, fn) => { assert.equal(name, 'settings.section'); listener = fn; return () => { listener = null } } }
  const dispose = install(slots, doc)
  assert.match(head.children[0].textContent, /nth-child\(1\)/)
  entries = [entry('pocket', 1), entry('tts', 70)]
  listener()
  assert.match(head.children[0].textContent, /nth-child\(1\)[\s\S]*nth-child\(2\)/)
  dispose()
  assert.equal(head.children.length, 0)
  assert.equal(listener, null)
})
