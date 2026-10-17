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

test('Terracotta ships as a light/dark scheme family', () => {
  const light = themes.find(theme => theme.id === 'tavern-terracotta')
  const dark = themes.find(theme => theme.id === 'tavern-terracotta-dark')
  assert.equal(light.colorScheme, 'light')
  assert.equal(dark.colorScheme, 'dark')
  assert.equal(light.schemeFamily, 'tavern-terracotta')
  assert.equal(dark.schemeFamily, light.schemeFamily)
  // The runtime reads the copy embedded in the bundle, not the JSON on disk:
  // the two drifting apart is exactly how the fix would silently stop working.
  for (const theme of [light, dark]) {
    const embedded = new RegExp(`"id": "${theme.id}",\\n  "colorScheme": "${theme.colorScheme}",\\n  "schemeFamily": "tavern-terracotta",`)
    assert.match(client, embedded, `${theme.id} must carry its schemeFamily inside client.js`)
  }
})

test('nativeScheme reads the built-in pointer behind an active skin', () => {
  globalThis.__builtinLast = 'dark'
  // A concrete built-in preference answers directly.
  assert.equal(nativeScheme({ preference: 'dark' }), 'dark')
  assert.equal(nativeScheme({ preference: 'light' }), 'light')
  // `system` resolves through the built-in active theme, which is still the
  // resolved light/dark while the preference itself is `system`.
  // A recorded concrete scheme outranks `system`: on a remote browser the host
  // preference resets to `system` on every reconnect (mobile lock/resume).
  assert.equal(nativeScheme({ preference: 'system', active: { colorScheme: 'light' } }), 'dark')
  globalThis.__builtinLast = 'light'
  assert.equal(nativeScheme({ preference: 'system', active: { colorScheme: 'dark' } }), 'light')
  // With nothing recorded, `system` follows the OS through the built-in active theme.
  globalThis.__builtinLast = null
  assert.equal(nativeScheme({ preference: 'system', active: { colorScheme: 'dark' } }), 'dark')
  assert.equal(nativeScheme({ preference: 'system', active: { colorScheme: 'light' } }), 'light')
  globalThis.__builtinLast = 'dark'
  // A skin owns `preference`, so the recorded built-in choice is all that is left.
  assert.equal(nativeScheme({ preference: 'tavern-terracotta' }), 'dark')
  globalThis.__builtinLast = null
  assert.equal(nativeScheme({ preference: 'tavern-terracotta' }), null)
})

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

test('every skin restore path routes through the scheme family', () => {
  // Boot restore, the sticky re-assert, and the wallpaper wash lookup.
  assert.match(client, /const target = resolveSchemeSkin\(saved, nativeScheme\(ctx\.theme\.getTheme\(\)\)\);\n\t*if \(current !== target\) ctx\.theme\.setTheme\(target\);/)
  assert.match(client, /const target = resolveSchemeSkin\(savedSkin, nativeScheme\(ctx\.theme\.getTheme\(\)\)\);\n\t*if \(current === target\) \{/)
  assert.match(client, /ctx\.theme\.setTheme\(target\);/)
  assert.match(client, /const wantedId = resolveSchemeSkin\(selectedId, nativeScheme\(snapshot\)\);/)
  // The unguarded original would let the light factory default win again.
  assert.doesNotMatch(client, /if \(current !== saved\) ctx\.theme\.setTheme\(saved\);/)
  assert.doesNotMatch(client, /setTheme\(savedSkin\);/)
})

test('picking one half of a family in the skin picker records its scheme', () => {
  // Otherwise a light pick under a recorded `dark` would flip back on the next restore.
  const writes = []
  const writeSavedSkin = new Function('writeStorage', 'STORAGE_KEY', 'DEFAULT_SKIN', 'SKINS', 'writeBuiltinLast', `${extract('writeSavedSkin', 'readWallpaper')}\nreturn writeSavedSkin`)(
    () => {}, 'skin', 'system', [...themes, { id: 'mist', colorScheme: 'dark', tokens: {} }], scheme => writes.push(scheme))
  writeSavedSkin('tavern-terracotta')
  writeSavedSkin('tavern-terracotta-dark')
  writeSavedSkin('mist')
  writeSavedSkin('system')
  assert.deepEqual(writes, ['light', 'dark'])
})
