

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const sidebar = client.slice(client.indexOf('function TavernSidebar'))
// refresh() is now the coalescing wrapper; the list calls it runs live in refreshNow().
const refreshSource = sidebar.slice(sidebar.indexOf('function refreshNow(kinds)'), sidebar.indexOf('\t\t\tReact.useEffect', sidebar.indexOf('function refreshNow(kinds)')))
for (const failed of ['listCards', 'listSessions']) {
  test('sidebar independently refreshes surviving data when ' + failed + ' fails', async () => {
    const state = { cards: ['previous-card'], history: ['previous-session'], errors: [] }
    const refresh = new Function('call', 'setCards', 'setHistory', 'setTrustedCardMode', 'publishSessionModes', 'current', 'isPlayMode', 'setRequestMode', 'window', 'tavernErrorHub', 'return (' + refreshSource + ')')(
      async method => {
        if (method === failed) throw new Error('unreadable file')
        return { cards: ['healthy-card'], sessions: [{ sessionId: 'current', mode: 'story' }] }
      }, value => { state.cards = value }, value => { state.history = value }, () => {}, () => {}, 'current', () => true, () => {}, {},
      { resolve() {}, report(source) { state.errors.push(source) } })
    await refresh()
    assert.deepEqual(state.cards, failed === 'listCards' ? ['previous-card'] : ['healthy-card'])
    assert.deepEqual(state.history, failed === 'listSessions' ? ['previous-session'] : [{ sessionId: 'current', mode: 'story' }])
    assert.equal(state.errors.length, 1)
  })
}
