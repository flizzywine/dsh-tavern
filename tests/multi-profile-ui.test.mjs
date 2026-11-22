import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function UserPreferenceProfileTab('), source.indexOf('function GuideLibraryTab('))
function render(hasConfirmed, consent = true, activeId = 'a', conversationOnly = true) {
  const calls = [], warnings = []
  const record = { profileId: 'b', name: '冒险', hasConfirmed, confirmed: hasConfirmed ? { injectionText: '快节奏' } : null,
    defaultProfileId: 'a', profiles: [{ id: 'a', name: '日常', hasConfirmed: true, confirmedRevision: 4 }, { id: 'b', name: '冒险', hasConfirmed, confirmedRevision: 3 }] }
  let index = 0
  const React = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment',
    useState: initial => [[record, { enabled: true, profileId: activeId, revision: 3, content: '本局实际内容' }, false, '', false, false, false, true][index++] ?? initial, () => {}],
    useRef: value => ({ current: value }), useEffect: () => {} }
  const rpc = async (name, args) => { calls.push({ name, args }); return { userProfile: record } }
  const window = { confirm: text => { warnings.push(text); return consent }, prompt: () => '新画像' }
  const fn = new Function('React', 'rpc', 'window', 'usePersistentError', 'notifyTavernDataChanged', 'useTavernConfirm', 'HelpTip', component + ';return UserPreferenceProfileTab;')(React, rpc, window, () => ['', () => {}], () => {}, () => async text => { warnings.push(text); return consent }, 'HelpTip')
  const tree = fn({ scope: { sessionId: 'game' }, conversationOnly, Field: 'InlineField' })
  function nodes(value) { return value && typeof value === 'object' ? [value, ...(value.children || []).flat(Infinity).flatMap(nodes)] : [] }
  return { tree, calls, warnings, nodes: nodes(tree), button: text => nodes(tree).find(node => node.type === 'button' && node.children.includes(text)) }
}

test('updating a stale game uses its own profile even when browsing another one', async () => {
  const ui = render(true)
  assert.match(JSON.stringify(ui.tree), /这局仍使用修改前的内容/)
  await ui.button('更新到当前游戏').props.onClick()
  assert.equal(ui.calls[0].args.profileId, 'a')
})
