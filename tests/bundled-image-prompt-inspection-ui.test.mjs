import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
function fragment(start, end) {
  const at = source.indexOf(start), until = source.indexOf(end, at + start.length)
  assert.ok(at >= 0 && until > at)
  return source.slice(at, until)
}
const promptCapabilities = fragment('const IMAGE_API_PROTOCOLS =', 'function createHistoryRequestEpoch()')
const editor = fragment('    function PromptEditor() {', '    async function viewImage(')
const upgrade = fragment('    function WorldbookUpgradePanel(', '    function SettingsPanel() {')
const h = (type, props, ...children) => ({ type, props: props || {}, children })
function nodes(node, predicate, out = []) {
  if (Array.isArray(node)) node.forEach(item => nodes(item, predicate, out))
  else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); nodes(node.children, predicate, out) }
  return out
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.children) : String(node) }
function one(tree, predicate) { const result = nodes(tree, predicate); assert.equal(result.length, 1); return result[0] }
function mount(code, name, props = {}, initial, extra = {}) {
  const slots = [], cleanup = []; let cursor = 0
  const React = { createElement: h,
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = at === 0 && initial ? initial : value; return [slots[at], next => { slots[at] = typeof next === 'function' ? next(slots[at]) : next }] },
    useRef(value) { const at = cursor++; if (!(at in slots)) slots[at] = { current: value }; return slots[at] },
    useEffect(fn) { const at = cursor++; if (!(at in slots)) { slots[at] = true; cleanup.push(fn()) } },
  }
  const ctx = vm.createContext({ React, h, useEffect() {}, BASE: '/plugins/dsh-tavern-image', confirm: () => true, ...extra })
  const fn = vm.runInContext(`(()=>{${promptCapabilities};let openPromptEditor;${code};return ${name}})()`, ctx)
  let tree
  const render = () => { cursor = 0; tree = fn(props); return tree }
  render()
  return { render, get tree() { return tree }, get state() { return slots[0] }, unmount() { cleanup.forEach(fn => fn?.()) } }
}

test('inspection distinguishes immutable planner input, editable draft and final payload; metadata IDs stay in debug captions', () => {
  const final = '最终提交原样文本 [characterId=legacy]'
  const ui = mount(editor, 'PromptEditor', {}, { open: true, jobId: 'job', prompt: '草稿', originalPrompt: '规划中文\n原文', submittedPrompt: final, actualNegative: '不加字', sourceBackend: 'atlascloud', generationMode: 'reference', references: [
    { index: 1, kind: 'character', characterId: 'c1', label: '江铭', image: { id: 'a'.repeat(64) } },
    { index: 2, kind: 'outfit', outfitId: 'o1', label: '通用服装／常服（本图穿着者：江铭 [characterId=c1]）', image: { id: 'b'.repeat(64) }, consistencyText: '保留领口' },
  ] })
  assert.equal(one(ui.tree, n => n.props['aria-label'] === '规划原文').children[0], '规划中文\n原文')
  assert.equal(one(ui.tree, n => n.props['aria-label'] === '实际提交提示词').children[0], final, 'never sanitize the actual payload viewer')
  const captions = nodes(ui.tree, n => n.type === 'figcaption').map(text)
  assert.match(captions[0], /上传顺序 1 · 参考图 1.*江铭[\s\S]*身份参考[\s\S]*所属人物：江铭/)
  assert.match(captions[1], /上传顺序 2[\s\S]*服装参考[\s\S]*公共服装[\s\S]*本图穿着者：江铭/)
  assert.doesNotMatch(captions.join(''), /characterId|outfitId|c1|o1/)
  assert.match(text(nodes(ui.tree, n => n.props['aria-label'] === '参考图调试信息')), /c1|o1/)
  const draft = nodes(ui.tree, n => n.type === 'textarea')[0]
  draft.props.onChange({ target: { value: '新草稿' } }); ui.render()
  assert.equal(ui.state.prompt, '新草稿')
  assert.equal(one(ui.tree, n => n.props['aria-label'] === '规划原文').children[0], '规划中文\n原文')
  assert.equal(one(ui.tree, n => n.props['aria-label'] === '实际提交提示词').children[0], final)
})

test('old task fallbacks and missing reference names are explicitly labeled, never replaced with raw IDs', () => {
  const ui = mount(editor, 'PromptEditor', {}, { open: true, jobId: 'old', prompt: '', rawPrompt: 'fallback', rawPromptSource: 'positive', actualPositive: 'positive', submittedPromptSource: 'positive', references: [{ kind: 'outfit', characterId: 'secret-character', outfitId: 'secret-outfit' }] })
  assert.match(text(ui.tree), /原文缺失/)
  assert.match(text(ui.tree), /旧任务可能没有完整提交文本/)
  assert.doesNotMatch(text(nodes(ui.tree, n => n.type === 'figcaption')), /secret-character|secret-outfit/)
})

test('assembly provenance is displayed only from explicit versioned records', () => {
  const ui = mount(editor, 'PromptEditor', {}, { open: true, jobId: 'new', prompt: 'draft', promptAssembly: { version: 2, definitionAdditions: ['人物补充', '场景补充'], referenceText: '参考图1 → 江铭' } })
  const provenance = one(ui.tree, n => n.props['aria-label'] === '提示词组装来源')
  assert.match(text(provenance), /人物补充\n\n场景补充/)
  assert.match(text(provenance), /参考图1 → 江铭/)
})

const status = () => ({ format: 'structured', key: 'main', version: 2, fingerprint: 'fp1', entries: ['update', 'customized', 'missing', 'disabled', 'ambiguous', 'current'].map(state => ({ id: state, state, current: state === 'missing' ? null : { comment: state, content: 'old ' + state }, proposed: { comment: state, content: 'new ' + state } })) })
function upgradeUi(options = {}) {
  const calls = []; let applied = 0
  const props = { book: 'main', async request(path, body) { calls.push({ path, body: body && JSON.parse(JSON.stringify(body)) }); if (options.fail && body) throw new Error('fingerprint conflict'); return { ok: true, upgrade: status() } }, async onApplied() { applied++ } }
  const ui = mount(upgrade, 'WorldbookUpgradePanel', props, undefined, { confirm: () => options.confirm !== false })
  return { ...ui, get tree() { return ui.tree }, calls, get applied() { return applied },
    async click(label) { await one(ui.tree, n => n.type === 'button' && text(n) === label).props.onClick(); ui.render() },
    select(id) { one(ui.tree, n => n.props['aria-label'] === '更新规则 ' + id).props.onChange({ target: { checked: true } }); ui.render() } }
}

test('upgrade preview is lazy and requires explicit selection plus confirmation, preserving disabled entries', async () => {
  const ui = upgradeUi()
  assert.equal(ui.calls.length, 0)
  await ui.click('读取／刷新升级预览')
  assert.deepEqual(ui.calls, [{ path: '/worldbook-upgrade?book=main', body: undefined }])
  assert.equal(nodes(ui.tree, n => n.type === 'input' && n.props.checked).length, 0)
  for (const id of ['disabled', 'ambiguous', 'current']) assert.equal(one(ui.tree, n => n.props['aria-label'] === '更新规则 ' + id).props.disabled, true)
  assert.match(text(ui.tree), /old customized[\s\S]*new customized/)
  ui.select('customized'); ui.select('missing')
  await ui.click('确认更新所选 2 条')
  assert.deepEqual(ui.calls[1], { path: '/worldbook-upgrade', body: { book: 'main', expectedFingerprint: 'fp1', entryIds: ['customized', 'missing'] } })
  assert.equal(ui.applied, 1)
})

test('cancelled confirmation sends no request; stale fingerprint requires reloading preview', async () => {
  const cancelled = upgradeUi({ confirm: false })
  await cancelled.click('读取／刷新升级预览'); cancelled.select('update'); await cancelled.click('确认更新所选 1 条')
  assert.equal(cancelled.calls.length, 1)
  const ui = upgradeUi({ fail: true })
  await ui.click('读取／刷新升级预览'); ui.select('update'); await ui.click('确认更新所选 1 条')
  assert.match(text(ui.tree), /fingerprint conflict.*重新读取预览/)
  assert.equal(ui.applied, 0)
  assert.equal(nodes(ui.tree, n => n.type === 'input').length, 0)
})
