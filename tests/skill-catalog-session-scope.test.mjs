import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { installSkillCatalogSessionScope } from '../tavern-plugin/lib/domain/skill-catalog-session-scope.js'
const pluginRequire = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const { SessionSkillCatalog } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-api-session-controller')))
const { scopeChainOf } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-scope')))

test('cold play menus list only user-invocable writing skills while other sessions keep the host menu', async () => {
  const host = { skills: [{ name: 'host-probe' }] }
  const catalog = { async scopeFor(preset) { return { key: preset } }, async list() { return host } }
  const restore = installSkillCatalogSessionScope(catalog, async id => id === 'play' ? [
    { name: 'dialogue', description: '写作', userInvocable: true, modelInvocable: false },
    { name: 'model-only', userInvocable: false, modelInvocable: true }
  ] : id === 'empty' ? [] : null)
  assert.deepEqual((await catalog.list({ sessionId: 'play' })).skills.map(skill => [skill.name, skill.modelInvocable]), [['dialogue', false]])
  assert.deepEqual(await catalog.list({ sessionId: 'empty' }), { skills: [] })
  assert.equal(await catalog.list({ sessionId: 'card' }), host)
  restore()
  assert.equal(await catalog.list({ sessionId: 'play' }), host)
})

test('DSH 0.1.5: cold skills/list scopes get a session identity, keep the preset ancestry, and reuse one key per session', async () => {
  const presetScope = {}
  const catalog = { async scopeFor(sessionId, preset) { return preset === 'tavern' ? presetScope : undefined } }
  const original = catalog.scopeFor
  const restore = installSkillCatalogSessionScope(catalog)
  const [card, story] = await Promise.all([catalog.scopeFor('card', 'tavern'), catalog.scopeFor('story', 'tavern')])
  assert.equal(card.session.id, 'card')
  assert.equal(story.session.id, 'story')
  assert.notEqual(card, story)
  assert.ok(scopeChainOf(card).includes(presetScope), 'the shared preset scope stays an ancestor')
  assert.equal(await catalog.scopeFor('card', 'tavern'), card, 'the same session reuses its key')
  const live = { session: { id: 'live' } }
  const withLive = { async scopeFor() { return live } }
  const restoreLive = installSkillCatalogSessionScope(withLive)
  assert.equal(await withLive.scopeFor('live', 'tavern'), live, 'a scope that already names a session is kept')
  restoreLive()
  restore()
  assert.equal(catalog.scopeFor, original)
})
