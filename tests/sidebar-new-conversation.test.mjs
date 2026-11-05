import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { readFileSync } from 'node:fs'
import { sourceFunction } from './fixtures/source-function.mjs'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
function fixture({ failCreate = false, failSend = false } = {}) {
  let transition = false
  const events = [], errors = [], busy = []
  const context = vm.createContext({
    uiMode: 'play', openingPicker: { openings: [] },
    openingPerformance: { begin: () => ({ measure: (_name, run) => run(), finish() {} }) },
    playPrewarmRef: { current: { claim: async () => '' } },
    tavernSessionTransition: {
      begin() { transition = true; events.push('begin') },
      end() { assert.equal(transition, true); transition = false; events.push('end') }
    },
    conversationLifecycle: { async start() {
      assert.equal(transition, true)
      events.push('open')
      if (failCreate) throw new Error('create failed')
      return { sessionId: 'new-game' }
    } },
    props: { async executeSlash(line, sessionId) {
      assert.equal(transition, false, 'scripts must start before the first foreground waits for them')
      assert.equal(sessionId, 'new-game')
      events.push('send')
      if (failSend) throw new Error('send failed')
    } },
    substituteTavernIdentityMacros: text => text,
    setBusy: value => busy.push(value), setError: error => errors.push(error), setOpeningPicker() {},
    window: { localStorage: { setItem() {} } }, console: { info() {}, warn() {} }
  })
  vm.runInContext(sourceFunction(source, 'newConversation'), context)
  return { start: text => context.newConversation({ name: 'Fixture' }, 'story', 'primary', 'Player', text), events, errors, busy }
}

test('greeting and no-greeting starts release the same transition before an optional first send', async () => {
  for (const message of ['', 'Continue.']) {
    const h = fixture()
    await h.start(message)
    assert.deepEqual(h.events, ['begin', 'open', 'end', ...(message ? ['send'] : [])])
    assert.deepEqual(h.busy, [true, false])
  }
})

test('failed creation and failed first send both release the transition exactly once', async () => {
  for (const options of [{ failCreate: true }, { failSend: true }]) {
    const h = fixture(options)
    await assert.rejects(h.start('Continue.'), options.failCreate ? /create failed/ : /send failed/)
    assert.deepEqual(h.events, ['begin', 'open', 'end', ...(options.failSend ? ['send'] : [])])
    assert.deepEqual(h.busy, [true, false])
    assert.ok(h.errors.at(-1).includes(options.failCreate ? 'create failed' : 'send failed'))
  }
})
