import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
function extract(start, end) {
  const at = source.indexOf(start), until = source.indexOf(end, at + start.length)
  assert.ok(at >= 0 && until > at, start)
  return source.slice(at, until)
}
const referenceEditor = extract('    function ReferenceImageEditor(', '    function SettingsPanel(')
const generationCard = extract('      function generationModeCard(', '      function planTab(')
const clone = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function walk(node, predicate, result = []) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, predicate, result)); return result }
  if (!node || typeof node !== 'object') return result
  if (predicate(node)) result.push(node)
  node.children?.forEach(child => walk(child, predicate, result))
  return result
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.children || []) : String(node) }
function one(tree, predicate) { const result = walk(tree, predicate); assert.equal(result.length, 1); return result[0] }
const h = (type, props, ...children) => ({ type, props: props || {}, children })
const image = letter => ({ id: letter.repeat(64), mediaType: 'image/png', name: 'reference.png', byteLength: 8 })
const file = (changes = {}) => ({ name: 'reference.png', size: 8, type: 'image/png', data: 'data:image/png;base64,aGVsbG8=', ...changes })
function mount(initial = {}) {
  const slots = [], effects = [], calls = [], patches = []
  let cursor = 0, tree, value = clone(initial), response = { ok: true, referenceImage: image('a') }, failure = null, gate = null
  const React = {
    useState(initial) {
      const slot = cursor++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], update => { slots[slot] = typeof update === 'function' ? update(slots[slot]) : update }]
    },
    useRef(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot] },
    useEffect(effect) { const slot = cursor++; if (!(slot in slots)) { slots[slot] = true; effects.push(effect) } },
  }
  const context = vm.createContext({ React, h, BASE: '/plugins/dsh-tavern-image',
    FileReader: class { readAsDataURL(file) { this.result = file.data; queueMicrotask(() => this.onload()) } },
    async jsonFetch(url, init) {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) })
      if (gate) await gate.promise
      if (failure) throw failure
      return response
    },
  })
  const Component = vm.runInContext(`(()=>{${referenceEditor};return ReferenceImageEditor})()`, context)
  const cleanups = []
  function render() {
    cursor = 0
    tree = Component({ value, label: '角色「林月」', onChange(patch) { patches.push(clone(patch)); value = { ...value, ...clone(patch) } } })
    effects.splice(0).forEach(effect => cleanups.push(effect()))
    return tree
  }
  render()
  return { calls, patches, render, unmount() { cleanups.forEach(fn => fn?.()) },
    get value() { return value }, get tree() { return tree },
    set response(next) { response = next }, set failure(next) { failure = next }, set gate(next) { gate = next },
    async upload(input = file()) { const target = { files: [input], value: 'fake-local-path' }; await one(tree, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target }); assert.equal(target.value, ''); render() },
    remove() { one(tree, node => node.type === 'button' && text(node) === '移除').props.onClick(); render() },
    supplement(content) { one(tree, node => node.type === 'textarea').props.onChange({ target: { value: content } }); render() },
  }
}

test('reference upload posts image bytes once, binds metadata to draft, and keeps existing object fields', async () => {
  const ui = mount({ id: 'char-a', traits: { face: 'existing face' }, consistencyText: 'keep eyes' })
  await ui.upload()
  assert.deepEqual(ui.calls, [{ url: '/plugins/dsh-tavern-image/reference-image', method: 'POST', body: { data: file().data, mediaType: 'image/png', name: 'reference.png' } }])
  assert.deepEqual(ui.patches, [{ referenceImage: image('a') }])
  assert.equal(ui.value.consistencyText, 'keep eyes')
  assert.deepEqual(ui.value.traits, { face: 'existing face' })
  assert.equal(one(ui.tree, node => node.type === 'img').props.src, '/plugins/dsh-tavern-image/reference-image?id=' + 'a'.repeat(64))
  assert.match(text(ui.tree), /参考图仅本机保存，不随导出迁移/)
  assert.match(text(ui.tree), /请保存/)
})

test('replacement and consistency editing preserve each other; removing only unbinds and never DELETEs bytes', async () => {
  const ui = mount({ referenceImage: image('a'), consistencyText: 'old' })
  ui.supplement('new consistency')
  ui.response = { ok: true, referenceImage: image('b') }
  await ui.upload()
  assert.equal(ui.value.referenceImage.id, 'b'.repeat(64))
  assert.equal(ui.value.consistencyText, 'new consistency')
  ui.remove()
  assert.equal(ui.value.referenceImage, null)
  assert.equal(ui.value.consistencyText, 'new consistency')
  assert.equal(ui.calls.length, 1)
  assert.match(text(ui.tree), /历史参考图不会删除/)
})

for (const [description, input, expected] of [
  ['unsupported media type', file({ type: 'image/gif', name: 'bad.gif' }), /PNG、JPEG 或 WebP/],
  ['oversized image', file({ size: 32 * 1024 * 1024 + 1 }), /32 MiB/],
  ['empty image', file({ size: 0 }), /不能为空/],
]) test(`reference editor rejects ${description} without posting or losing existing reference`, async () => {
  const ui = mount({ referenceImage: image('a') })
  await ui.upload(input)
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.value.referenceImage.id, 'a'.repeat(64))
  assert.match(text(ui.tree), expected)
})

test('upload failure keeps original metadata and exposes exact service error', async () => {
  const ui = mount({ referenceImage: image('a') })
  ui.failure = new Error('storage full')
  await ui.upload()
  assert.equal(ui.value.referenceImage.id, 'a'.repeat(64))
  assert.match(text(ui.tree), /上传失败：storage full/)
})

test('invalid reference metadata is not accepted into a draft or used as a URL', async () => {
  const ui = mount({ referenceImage: image('a') })
  ui.response = { ok: true, referenceImage: { id: 'javascript:bad' } }
  await ui.upload()
  assert.equal(ui.patches.length, 0)
  assert.match(text(ui.tree), /没有返回有效/)
})

test('removing during an upload cancels the pending binding without a delete request', async () => {
  const ui = mount({ referenceImage: image('a'), consistencyText: 'keep' })
  const gate = deferred(); ui.gate = gate
  ui.response = { ok: true, referenceImage: image('b') }
  const uploading = ui.upload()
  await tick(); ui.render(); ui.remove()
  gate.resolve(); await uploading
  assert.equal(ui.value.referenceImage, null)
  assert.equal(ui.value.consistencyText, 'keep')
  assert.deepEqual(ui.patches, [{ referenceImage: null }])
  assert.equal(ui.calls.length, 1)
})

test('a completed upload cannot attach its image after its library editor unmounts', async () => {
  const ui = mount({ id: 'old-character' })
  const gate = deferred(); ui.gate = gate
  const uploading = ui.upload()
  await tick(); ui.unmount(); gate.resolve(); await uploading
  assert.deepEqual(ui.patches, [])
})

for (const [backend, protocol, supported] of [
  ['atlascloud', '', true], ['openai', '', true], ['comfyui', '', false],
  ['custom', 'openai', true], ['custom', 'novelai', false], ['custom', 'grok', true],
]) test(`global generation selector follows effective provider capability (${backend}${protocol ? '/' + protocol : ''})`, () => {
  const channel = { id: 'channel', provider: backend, options: protocol ? { apiProtocol: protocol } : {}, model: 'user/exact-model' }
  const config = { generationMode: 'reference', imageBackend: backend, activeImageChannel: 'channel', imageChannels: [channel] }, patches = []
  const data = { config, referenceSupported: backend === 'comfyui' && supported }
  const uiSupportsImageReferences = (selected, state) => {
    if (selected?.provider === 'comfyui') return state.referenceSupported === true
    const effective = selected?.provider === 'custom' ? selected.options?.apiProtocol || 'openai' : selected?.provider
    return new Set(['atlascloud', 'openai', 'gemini', 'gemini-chat', 'sdwebui', 'seedream', 'grok', 'qwen']).has(effective)
  }
  const context = vm.createContext({ h, config, data, channelSecretDrafts: {}, uiSupportsImageReferences, imageBackend: backend, S: { card: {}, row: {}, input: {}, label: {} }, save: patch => patches.push(clone(patch)) })
  const tree = vm.runInContext(`(()=>{${generationCard};return generationModeCard()})()`, context)
  const select = one(tree, node => node.props['aria-label'] === '默认生图模式')
  assert.equal(select.props.value, 'reference')
  assert.equal(one(select, node => node.type === 'option' && node.props.value === 'reference').props.disabled, !supported)
  if (!supported) assert.match(text(tree), /不会自动降级/)
  assert.equal(patches.length, 0, 'rendering never silently changes the mode or model')
  select.props.onChange({ target: { value: 'text' } })
  assert.deepEqual(patches, [{ generationMode: 'text' }])
  assert.equal(config.imageChannels[0].model, 'user/exact-model')
})

test('global generation selector offers auto (use references when the picture has them)', () => {
  const config = { generationMode: 'auto', imageBackend: 'custom', activeImageChannel: 'channel', imageChannels: [{ id: 'channel', provider: 'custom', options: { apiProtocol: 'novelai' } }] }, patches = []
  const context = vm.createContext({ h, config, data: { config }, channelSecretDrafts: {}, uiSupportsImageReferences: () => false, imageBackend: 'custom', S: { card: {}, row: {}, input: {}, label: {} }, save: patch => patches.push(clone(patch)) })
  const tree = vm.runInContext(`(()=>{${generationCard};return generationModeCard()})()`, context)
  const select = one(tree, node => node.props['aria-label'] === '默认生图模式')
  assert.equal(select.props.value, 'auto')
  assert.equal(one(select, node => node.type === 'option' && node.props.value === 'auto').props.disabled, undefined)
  assert.match(text(tree), /自动模式下每张都按文生图提交/)
  assert.equal(patches.length, 0)
})