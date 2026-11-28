import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../tavern-plugin/packages/dsh-dream-skin/', import.meta.url)
const client = await readFile(new URL('lib/client.js', root), 'utf8')
const themes = JSON.parse(await readFile(new URL('tavern-themes.json', root), 'utf8'))

/** Slice one top-level function declaration out of the vendored client bundle. */
function extract(name, nextName) {
  const start = client.indexOf(`function ${name}(`)
  const end = client.indexOf(`function ${nextName}(`, start)
  assert.ok(start !== -1 && end > start, `${name} must exist in the vendored client`)
  return client.slice(start, end)
}

// The bundle is a browser IIFE, so the two pure helpers are re-evaluated here
// with stub inputs instead of booting a DOM. Everything they read (SKINS,
// readBuiltinLast) is injected, which is also what keeps them testable.
const nativeScheme = new Function('readBuiltinLast', `${extract('nativeScheme', 'resolveSchemeSkin')}\nreturn nativeScheme`)(() => globalThis.__builtinLast)
const resolveSchemeSkin = new Function('SKINS', `${extract('resolveSchemeSkin', 'rawActiveTheme')}\nreturn resolveSchemeSkin`)([
  ...themes,
  { id: 'mist', colorScheme: 'light', tokens: {} }
])

test('resolveSchemeSkin selects the family member for the scheme', () => {
  assert.equal(resolveSchemeSkin('tavern-terracotta', 'dark'), 'tavern-terracotta-dark')
  assert.equal(resolveSchemeSkin('tavern-terracotta-dark', 'light'), 'tavern-terracotta')
  // Already matching, or no scheme to follow: the id is returned untouched.
  assert.equal(resolveSchemeSkin('tavern-terracotta', 'light'), 'tavern-terracotta')
  assert.equal(resolveSchemeSkin('tavern-terracotta', null), 'tavern-terracotta')
  // Skins without a family, and imported packs, are never rewritten.
  assert.equal(resolveSchemeSkin('mist', 'dark'), 'mist')
  assert.equal(resolveSchemeSkin('dream-pack:mist', 'dark'), 'dream-pack:mist')
})

test('each shipped Bloom palette can switch to its light and dark variants', () => {
  const labels = {
    cinnabar: '朱砂', dawn: '粉霞', tangerine: '橙黄', aurora: '落霞', stone: '赭石',
    amber: '琥珀', osmanthus: '轻黄', mint: '草色', sage: '竹青', ripple: '天青',
    mist: '黛蓝', lapis: '青金', lavender: '青莲', silverrose: '银红', petal: '桃夭'
  }
  const bloom = themes.filter(theme => theme.id.startsWith('tavern-bloom-'))
  const names = new Map(bloom.map(theme => [theme.id, theme.label]))
  assert.equal(bloom.length, 30)
  for (const [variant, label] of Object.entries(labels)) {
    const light = `tavern-bloom-${variant}`
    const dark = `${light}-dark`
    assert.equal(names.get(light), label)
    assert.equal(names.get(dark), label + ' · 深色')
    assert.equal(resolveSchemeSkin(light, 'dark'), dark)
    assert.equal(resolveSchemeSkin(dark, 'light'), light)
  }
})

test('Bloom renders the active palette backdrop over its saved stock wallpaper', () => {
  const backdropFor = new Function('SKINS', 'rawActiveTheme', 'followsSkin',
    `${extract('bloomBackdropFor', 'setBloomBackdrop')}\nreturn bloomBackdropFor`)(themes, snapshot => snapshot, () => true)
  const light = themes.find(theme => theme.id === 'tavern-bloom-mist')
  const dark = themes.find(theme => theme.id === 'tavern-bloom-mist-dark')
  assert.ok(light.bloomBackdrop && dark.bloomBackdrop)
  assert.equal(backdropFor(light, light.wallpaperGradient), light.bloomBackdrop)
  assert.equal(backdropFor(dark, light.wallpaperGradient), dark.bloomBackdrop)
  assert.equal(backdropFor(dark, 'linear-gradient(#123, #567)'), null)
  assert.equal(backdropFor(light, 'url("custom.jpg")'), null)
  assert.equal(backdropFor(themes[0], light.wallpaperGradient), null)
})
