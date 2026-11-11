import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/card-plugins.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('function tavernPluginAllowed'), source.indexOf('function useTavernCardPluginScopes'))

function allowed(scopes, view) {
  return new Function('tavernCardPluginScopes', 'liveTavernView', `${body}; return tavernPluginAllowed`)(
    { get: () => scopes }, { getSnapshot: () => ({ view }) })
}

test('card plugin actions show only in games of the cards the plugin is bound to', () => {
  const view = { card: { path: 'cards/other-card.json' } }
  const scopes = { 'card-a': ['cards/card-a.json'], unbound: [] }
  assert.equal(allowed(scopes, view)('card-a', 's1'), false)
  assert.equal(allowed(scopes, { card: { path: 'cards/card-a.json' } })('card-a', 's1'), true)
  assert.equal(allowed(scopes, view)('unbound', 's1'), false, 'bound card plugin without a live binding is shown nowhere')
  assert.equal(allowed(scopes, view)('user-plugin', 's1'), true, 'the user\'s own plugins are unrestricted')
})
