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
