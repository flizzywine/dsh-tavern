import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/card-plugins.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('function tavernPluginAllowed'), source.indexOf('function useTavernCardPluginScopes'))
const store = source.slice(source.indexOf('const tavernCardPluginScopes'), source.indexOf('/** Whether a plugin may show itself'))

function allowed(scopes, view) {
  return new Function('tavernCardPluginScopes', 'liveTavernView', `${body}; return tavernPluginAllowed`)(
    { get: () => scopes }, { getSnapshot: () => ({ view }) })
}

function scopeStore(rpc) {
  return new Function('rpc', 'window', 'tavernDataChangeAffects', `${store}; return tavernCardPluginScopes`)(rpc, {}, () => false)
}

test('card plugin actions show only in games of the cards the plugin is bound to', () => {
  const view = { card: { path: 'cards/other-card.json' } }
  const scopes = { 'card-a': ['cards/card-a.json'], unbound: [] }
  assert.equal(allowed(scopes, view)('card-a', 's1'), false)
  assert.equal(allowed(scopes, { card: { path: 'cards/card-a.json' } })('card-a', 's1'), true)
  assert.equal(allowed(scopes, view)('unbound', 's1'), false, 'bound card plugin without a live binding is shown nowhere')
  assert.equal(allowed(scopes, view)('user-plugin', 's1'), true, 'the user\'s own plugins are unrestricted')
})

test('no plugin shows before the host has said which plugins belong to which cards', () => {
  const view = { card: { path: 'cards/other-card.json' } }
  assert.equal(allowed(null, view)('card-a', 's1'), false, 'a page that just loaded does not know card-a is another card\'s plugin')
})

test('a failed scope read leaves the scopes unknown and the next read asks again', async () => {
  let calls = 0
  const scopes = scopeStore(async () => { calls += 1; if (calls === 1) throw new Error('host restarting'); return { scopes: { 'card-a': ['cards/card-a.json'] } } })
  let notified = 0
  scopes.subscribe(() => { notified += 1 })
  await scopes.load()
  assert.equal(scopes.get(), null, 'a failure is not an empty list of card plugins')
  scopes.subscribe(() => {})
  await scopes.load()
  assert.deepEqual(scopes.get(), { 'card-a': ['cards/card-a.json'] })
  assert.equal(calls, 2)
  assert.equal(notified, 1, 'subscribers hear once the scopes are known')
})
