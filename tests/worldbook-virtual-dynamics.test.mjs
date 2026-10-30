import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectVirtualWorldbookPrefix } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'

const entry = (ref, content, constant = true, extra = {}) => ({ ref, content, constant, enabled: true, ...extra })
function fixture(entries, render = async text => ({ ok: true, text, scopes: {} })) {
  const worldBook = { view: { entries } }
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => ({ render }), globalVariables: async () => ({}) })
  const chat = { sessionId: 'one', cardPath: 'card', worldbookStrategy: 'native-skills', messages: [], macroState: { local: { weather: 'sun' } } }
  const run = async (requestKey = 'request-1', userText = '') => {
    const result = await project({ chat, card: { name: 'hero' }, requestKey, userText })
    if (result.virtualState) chat.worldBookVirtualState = result.virtualState
    return result
  }
  return { worldBook, chat, project, run }
}
test('an unbound worldbook projects empty context and can gain entries in the same request', async () => {
  let worldBook = null
  const project = createForegroundWorldbook({ bound: async () => worldBook,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }),
    globalVariables: async () => ({}) })
  const chat = { sessionId: 'unbound', messages: [] }
  const run = () => project({ chat, card: {}, requestKey: 'one' })
  const empty = await run()
  assert.equal(empty.error, null)
  assert.equal(empty.context, '')
  assert.equal(empty.prefixContext, '')
  assert.deepEqual(empty.refs, [])
  worldBook = { view: { entries: [entry('setting', 'A quiet room.')] } }
  const bound = await run()
  assert.equal(bound.error, null)
  assert.equal(bound.prefixContext, 'A quiet room.')
  worldBook = null
  const removed = await run()
  assert.equal(removed.error, null)
  assert.equal(removed.prefixContext, '')
})

test('new earlier setters survive cached controller replay and refresh pure readers', async () => {
  const entries = [entry('a', '<% controller %>', true, { order: 10 }), entry('b', '{{setvar::weather::snow}}', false, { order: 0 }), entry('c', '{{getvar::weather}}', true, { order: 20 })]
  let calls = 0
  const f = fixture(entries, async () => { calls++; return { ok: true, text: 'controller', scopes: {}, activationRequests: [{ ref: 'b', force: true }] } })
  const result = await f.run()
  assert.equal(result.error, null)
  assert.doesNotMatch(result.context, /snow/)
  assert.equal(result.virtualState.entries.c.text, 'snow')
  assert.doesNotMatch(result.context, /sun/)
  assert.equal(result.macroState.local.weather, 'snow')
  assert.equal(calls, 1)
})
test('whole-book preprocessing is guarded once per request and decorator edits are explicitly deferred', async () => {
  let preparations = 0
  const worldBook = { view: { entries: [entry('controller', '@@generate\n<% controller %>'), entry('plain', 'plain', false)] } }
  const runtime = { render: async () => ({ ok: true, text: 'controller', scopes: {} }),
    prepareWorldbook: async entries => { preparations++; return { entries, scopes: {} } } }
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}) })
  const chat = { sessionId: 'preprocess', worldbookStrategy: 'native-skills', messages: [] }
  await project({ chat, card: {}, requestKey: 'one' })
  worldBook.view.entries[1].content = 'edited plain'
  await project({ chat, card: {}, requestKey: 'one' })
  assert.equal(preparations, 1)
  worldBook.view.entries[0].content = '@@generate\n<% changed %>'
  const deferred = await project({ chat, card: {}, requestKey: 'one' })
  assert.equal(preparations, 1)
  assert.ok(deferred.diagnostics.some(item => item.code === 'preprocessing-edit-deferred-to-next-request'))
  await project({ chat, card: {}, requestKey: 'two' })
  assert.equal(preparations, 2)
})
test('persisted preprocessing guard survives executor restart in the same explicit request', async () => {
  let preparations = 0
  const worldBook = { view: { entries: [entry('controller', '@@generate\n<% controller %>')] } }
  const runtime = { render: async () => ({ ok: true, text: 'controller', scopes: {} }),
    prepareWorldbook: async entries => { preparations++; return { entries, scopes: {} } } }
  const create = () => createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}) })
  const chat = { sessionId: 'preprocess-restart', worldbookStrategy: 'native-skills', messages: [] }
  const first = await create()({ chat, card: {}, requestKey: 'one' })
  chat.worldBookVirtualState = JSON.parse(JSON.stringify(first.virtualState))
  await create()({ chat, card: {}, requestKey: 'one' })
  assert.equal(preparations, 1)
  await create()({ chat, card: {}, requestKey: 'two' })
  assert.equal(preparations, 2)
})
test('nested effectful getter executes only once across activation convergence', async () => {
  const f = fixture([entry('a', '<% controller %>', true, { order: 10 }), entry('b', '{{char}}', false), entry('c', '{{getvar::nested}}', true, { order: 20 })], async () => ({ ok: true, text: 'controller', scopes: {}, activationRequests: [{ ref: 'b', force: true }] }))
  f.chat.macroState.local.nested = '{{incvar::count}}'
  f.chat.macroState.local.count = 0
  const result = await f.run('one')
  assert.equal(result.macroState.local.count, 1)
  assert.equal(result.virtualState.entries.c.text, '1')
})
for (const scope of ['local', 'global']) test(`macro ${scope} dependency reads actual macro scope, not identically named EJS variables`, async () => {
  const suffix = scope === 'global' ? 'globalvar' : 'var'
  const entries = [entry('exists', `{{has${suffix}::present}}`), entry('read', `{{get${suffix}::shadow}}`)]
  const worldBook = { view: { entries } }
  const templates = { present: null, shadow: 'same value' }
  const project = createForegroundWorldbook({ bound: async () => worldBook,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }),
    globalVariables: async () => templates })
  const chat = { sessionId: 'shadow-' + scope, worldbookStrategy: 'native-skills', messages: [], variables: templates,
    macroState: { local: {}, global: {} } }
  const first = await project({ chat, card: {}, requestKey: 'one' })
  assert.equal(first.virtualState.entries.exists.text, 'false')
  assert.equal(first.virtualState.entries.read.text, '')
  chat.worldBookVirtualState = first.virtualState
  chat.macroState[scope].present = null
  chat.macroState[scope].shadow = 'same value'
  const second = await project({ chat, card: {}, requestKey: 'two' })
  assert.equal(second.virtualState.entries.exists.text, 'true')
  assert.equal(second.virtualState.entries.read.text, 'same value')
  assert.deepEqual(new Set(second.changedVirtualRefs), new Set(['exists', 'read']))
})

test('runtime controllers keep their injected and restored output while display templates do not', async () => {
  const f = fixture([entry('controller', '<% executeRule() %>'), entry('data', '<%= state %>')], async text =>
    ({ ok: true, text: text.includes('executeRule') ? 'CONTROLLER RULE' : 'PRIVATE DATA', scopes: {} }))
  const result = await f.run('one')
  assert.match(result.context, /CONTROLLER RULE/)
  assert.doesNotMatch(result.context, /PRIVATE DATA/)
  const prefix = projectVirtualWorldbookPrefix(f.worldBook, f.chat).prefixContext
  assert.match(prefix, /CONTROLLER RULE/)
  assert.doesNotMatch(prefix, /PRIVATE DATA/)
})
