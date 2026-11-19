// 设置 › 模型's 最近用过的网址: the host card patch and the provider pairs it reaches (dsh-tavern-tts model-endpoints.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { patchSettingsModelsSource, patchSettingsModelsEndpoints, SETTINGS_MODELS_PATCHED_VERSION } from '../bin/settings-models-endpoints-patch.mjs'
import { createModelEndpoints } from '../tavern-plugin/packages/dsh-tavern-tts/src/model-endpoints.js'

// The provider card's Base URL input as 0.2.1-rc.2 ships it, inside the editor's scope.
const CARD = `function ProviderEditor(props) { const { namespace, settingsPath } = props; const keyRef = "X_API_KEY", disabled = false, fallback = {}, stringAt = (s, k) => s[k];
  const setField = () => {}; const draft = {};
  return [(0, react_jsx_runtime.jsx)("input", {
										value: stringAt(draft, "baseURL") ?? "",
										onChange: (event) => {
											setField("baseURL", event.target.value === "" ? void 0 : event.target.value);
										}
									}), "hint"] }`

test('the card patch inserts the picker once after the Base URL input, is idempotent and refuses another shape', () => {
  const applied = patchSettingsModelsSource(CARD)
  assert.equal(applied.status, 'applied')
  assert.equal(patchSettingsModelsSource(applied.text).status, 'patched')
  assert.equal(patchSettingsModelsSource(CARD.replace('setField("baseURL"', 'setField("endpoint"')).status, 'unmatched')
  assert.equal(patchSettingsModelsSource(CARD + CARD).status, 'unmatched', 'two inputs: no guess which one')
  // the patched card renders the published picker with the card's own values, and nothing without it
  const rendered = []
  const run = new Function('react_jsx_runtime', 'props', applied.text + '; return ProviderEditor(props)')
  const jsx = { jsx: (type, p) => (rendered.push([type, p]), type === 'input' ? 'input' : 'picker') }
  const props = { provider: 'relay', displayName: '中转', namespace: { ns: 'llm-pi-ai' }, settingsPath: ['providers', 'relay'], defaultBaseURL: 'https://api.example.com', onClose: v => rendered.push(['closed', v]) }
  assert.deepEqual(run(jsx, props), ['input', null, 'hint'])
  const ModelEndpoints = () => {}
  globalThis[Symbol.for('dsh.endpointHistory')] = { ModelEndpoints }
  try {
    assert.deepEqual(run(jsx, props), ['input', 'picker', 'hint'])
    const [, given] = rendered.find(([type]) => type === ModelEndpoints)
    assert.deepEqual({ ...given, onSwitched: undefined }, { provider: 'relay', label: '中转', ns: 'llm-pi-ai', path: ['providers', 'relay'], keyRef: 'X_API_KEY', url: 'https://api.example.com', disabled: false, onSwitched: undefined })
    given.onSwitched(); assert.deepEqual(rendered.at(-1), ['closed', true])
  } finally { delete globalThis[Symbol.for('dsh.endpointHistory')] }
})

test('the patch writes the package file only when needed and names its package', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'models-patch-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, 'lib'))
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-settings-models', version: SETTINGS_MODELS_PATCHED_VERSION }))
  writeFileSync(path.join(dir, 'lib', 'client.js'), CARD)
  assert.equal(patchSettingsModelsEndpoints(dir), true)
  assert.equal(patchSettingsModelsEndpoints(dir), false)
  writeFileSync(path.join(dir, 'lib', 'client.js'), 'changed')
  assert.equal(patchSettingsModelsEndpoints(dir), null)
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'other' }))
  assert.throws(() => patchSettingsModelsEndpoints(dir), /仅适用于/)
})

function store(initial = {}) {
  const refs = new Map(Object.entries(initial))
  return { refs, api: { resolve: async r => refs.has(r) ? { value: refs.get(r) } : undefined, set: async (r, v) => { refs.set(r, v) }, unset: async r => { refs.delete(r) }, describe: async r => ({ configured: refs.has(r) }) } }
}

test('model provider pairs: the saved pair is recorded on open; 使用 writes the API 地址 and the key together; keys never leave', async () => {
  const s = store({ RELAY_API_KEY: 'sk-official-key-0001' }), writes = []
  let fail = false
  const settings = { mutate: async (ns, ops) => { if (fail) throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }); writes.push([ns, ops]) } }
  const m = createModelEndpoints({ credentials: () => s.api, settings: () => settings })
  const target = { provider: 'relay', ns: 'llm-pi-ai', path: ['providers', 'relay'], keyRef: 'RELAY_API_KEY' }
  let { recent } = await m.list({ ...target, url: 'https://api.official.example/' })
  assert.deepEqual(recent.map(e => [e.url, e.keyTail, !!e.current]), [['https://api.official.example', '0001', true]])
  // the owner types another relay into the card and saves; the next open records it
  s.refs.set('RELAY_API_KEY', 'sk-relay-key-0002')
  ;({ recent } = await m.list({ ...target, url: 'https://relay.example' }))
  assert.deepEqual(recent.map(e => [e.label, !!e.current]), [['relay.example', true], ['api.official.example', false]])
  ;({ recent } = await m.use({ ...target, entry: recent[1].id }))
  assert.deepEqual(writes, [['llm-pi-ai', [{ op: 'set', path: ['providers', 'relay', 'baseURL'], value: 'https://api.official.example' }]]])
  assert.equal(s.refs.get('RELAY_API_KEY'), 'sk-official-key-0001')
  assert.deepEqual(recent.map(e => [e.url, !!e.current]), [['https://api.official.example', true], ['https://relay.example', false]])
  // a refused settings write puts the key back
  fail = true
  await assert.rejects(m.use({ ...target, entry: recent[1].id }), { code: 'REVISION_CONFLICT' })
  assert.equal(s.refs.get('RELAY_API_KEY'), 'sk-official-key-0001')
  fail = false
  assert.equal(JSON.stringify(recent).includes('sk-'), false)
  // providers keep their own lists; rename, forget, clear
  assert.deepEqual((await m.list({ ...target, provider: 'other', keyRef: 'OTHER_API_KEY' })).recent, [])
  ;({ recent } = await m.rename({ ...target, entry: recent[1].id, label: '中转' }))
  assert.equal(recent[1].label, '中转')
  ;({ recent } = await m.forget({ ...target, entry: recent[1].id }))
  assert.equal(recent.length, 1)
  assert.deepEqual(await m.clear(target), { recent: [] })
  // only LLM namespaces, short paths and credential names
  for (const bad of [{ ns: 'tts' }, { path: ['a', 'b', 'c', 'd', 'e'] }, { keyRef: 'lower-case' }, { provider: '../x' }]) await assert.rejects(m.list({ ...target, ...bad }), { code: 'INVALID_INPUT' })
})
