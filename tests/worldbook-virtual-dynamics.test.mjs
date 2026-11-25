import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectVirtualWorldbookPrefix } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'
import { constantWorldBookContext } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { pureWritingSystem } from '../tavern-plugin/lib/domain/pure-writing-request.js'

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

test('worldbook resolves Helper message macros from the selected player floor and replaces old raw snapshots', async () => {
  const macro = '{{get_message_variable::stat_data.game._context}}'
  const f = fixture([entry('state', '当前状态：' + macro)])
  f.chat.messages.push(
    { role: 'assistant', greeting: true, variables: [{ stat_data: { game: null }, schema: {} }] },
    { role: 'tavern-helper', tavernRole: 'user', swipeId: 1, variables: [{}, { stat_data: { game: { _context: '港口已开放' } }, schema: {} }] },
    { role: 'user', placeholder: true }
  )
  const first = await f.run('opening')
  assert.match(first.context, /当前状态：港口已开放/)
  assert.deepEqual(first.variableConstantRefs, ['state'])

  const stale = f.chat.worldBookVirtualState.entries.state
  stale.text = stale.contextText = stale.projection.text = '当前状态：' + macro
  delete stale.projection.helperVariableMacros
  stale.renderHash = 'previous-unexpanded-output'
  const restarted = createForegroundWorldbook({ bound: async () => f.worldBook,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }), globalVariables: async () => ({}) })
  const replayed = await restarted({ chat: f.chat, card: { name: 'hero' }, requestKey: 'opening' })
  assert.match(replayed.context, /当前状态：港口已开放/)
  assert.doesNotMatch(replayed.context, /get_message_variable/)
})

test('standalone Helper macros and macros returned by EJS reach the pure writer with resolved values', async () => {
  const f = fixture([entry('direct', '天气 {{GET_CHAT_VARIABLE::weather}}'),
    entry('from-template', '<%= templateValue %>'), entry('fixed', '世界背景')],
  async (_text, { scopes }) => ({ ok: true, text: '时段 {{format_global_variable::time}}', scopes }))
  f.chat.variables = { weather: '晴' }
  f.chat.macroState.global = { time: '上午' }
  const result = await f.run('opening')
  assert.deepEqual(new Set(result.variableConstantRefs), new Set(['direct', 'from-template']))
  assert.equal(constantWorldBookContext({ worldBook: f.worldBook }).context, '世界背景')
  assert.match(result.context, /天气 晴/)
  assert.match(result.context, /时段 上午/)
  assert.match(projectVirtualWorldbookPrefix(f.worldBook, f.chat).snapshots, /时段 上午/)
  const source = { worldBook: { variableConstantRefs: result.variableConstantRefs },
    regenerationMaterials: { worldbookEntries: result.renderedEntries } }
  const prompt = pureWritingSystem([], { source, contributions: [] })
  assert.match(prompt, /天气 晴/)
  assert.match(prompt, /时段 上午/)
  assert.doesNotMatch(prompt, /\{\{/)
})
