import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { registerRunningUserPlugin } from '../tavern-plugin/lib/domain/user-plugins.js'

test('plugin foreground model queries share a cold resume and return the session selection before releasing it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'tavern-foreground-model-'))
  const previousHome = process.env.DSH_HOME, previousFetch = globalThis.fetch
  let app
  process.env.DSH_HOME = home
  t.after(async () => {
    await app?.dispose()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })
  const store = createProfileDataStore({ dataRoot: join(home, 'profile-data', 'tavern', 'data') })
  await store.writeJson('sessions.json', { story: 'chat' })
  await store.writeJson('chats/chat.json', {
    id: 'chat', sessionId: 'story', mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1, messages: []
  })
  const entered = Promise.withResolvers(), publish = Promise.withResolvers(), secondChecked = Promise.withResolvers()
  const defaults = { provider: 'default', model: 'fallback' }
  const pending = { provider: 'session', model: 'pending', reasoningEffort: 'high' }
  const session = { id: 'story', requestHeader: () => ({ config: { provider: 'session', model: 'last-used' } }) }
  const agent = { session }
  let live, beforeSecond, resumes = 0, disposals = 0, fail = false
  const { createPluginHost } = await import('./fixtures/plugin-host.mjs')
  app = await createPluginHost({ config: { stage: false }, provide: {
    agentDefaultModel: { currentSelection: () => defaults },
    sessionProjections: { stateOf: () => ({ pending }) },
    agents: {
      list: () => live ? [live] : [],
      get(id) { if (id === 'story') { beforeSecond?.(); return live } },
      async resume({ resumeSessionId }) {
        assert.equal(resumeSessionId, 'story')
        resumes++
        if (fail) throw new Error('session unavailable')
        entered.resolve()
        await publish.promise
        live = agent
        return { agent, async dispose() { live = undefined; disposals++ } }
      }
    }
  } })
  const owner = 'foreground-model-fixture'
  const unregister = registerRunningUserPlugin(owner, { folder: owner, runtimeName: owner, origin: 'global', bound: false, cardIds: [] })
  t.after(unregister)
  const tavern = Object.create(app.services.get('tavern'))
  tavern.ctx = { fiber: { name: owner } }
  const query = () => tavern.foregroundModel({ gameId: 'story' })
  const first = query()
  let second
  try {
    await Promise.race([entered.promise, first])
    beforeSecond = () => { beforeSecond = undefined; secondChecked.resolve() }
    second = query()
    await Promise.race([secondChecked.promise, second])
  } finally { publish.resolve(); await Promise.all([first, second]) }
  assert.deepEqual(await first, pending)
  assert.deepEqual(await second, pending)
  assert.equal(resumes, 1)
  assert.equal(disposals, 1)
  assert.equal(live, undefined)

  fail = true
  assert.deepEqual(await query(), defaults)
  live = agent
  assert.deepEqual(await query(), pending)
  assert.equal(resumes, 2)
  assert.equal(disposals, 1)
})
