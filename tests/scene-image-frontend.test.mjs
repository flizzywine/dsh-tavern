import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { parse } from 'acorn'
import { readFile } from 'node:fs/promises'

const clientRoot = new URL('../tavern-plugin/src/client/features/', import.meta.url)
const [rendererSource, gallerySource] = await Promise.all([
  readFile(new URL('assistant-renderer.js', clientRoot), 'utf8'),
  readFile(new URL('scene-images.js', clientRoot), 'utf8')
])

function declaration(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  let found
  function visit(node) {
    if (!node || found) return
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = node; return }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  }
  visit(ast)
  assert.ok(found, `source declares ${name}`)
  return source.slice(found.start, found.end)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function componentHarness(functionSource, { rpc, extras = {} }) {
  const slots = [], effects = new Map(), pendingEffects = []
  let cursor = 0
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(callback, deps) {
      const index = cursor++
      const prior = slots[index]
      if (!prior || !sameDeps(prior.deps, deps)) slots[index] = { callback, deps }
      return slots[index].callback
    },
    useEffect(effect, deps) {
      const index = cursor++
      pendingEffects.push({ index, effect, deps })
    }
  }
  const listeners = new Map()
  const context = vm.createContext({
    React,
    rpc,
    URLSearchParams,
    useTavernConfirm: () => async () => true,
    tavernPluginMediaIndex: { subscribe: () => () => {} },
    openSceneImagePreview() {},
    DshUi: { IconTrashOutlineRegular: 'trash-icon' },
    window: {
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener) },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event) }
    },
    CustomEvent: function (type, init = {}) { return { type, ...init } },
    ...extras
  })
  const Component = vm.runInContext(`${functionSource}; ${functionSource.match(/function\s+(\w+)\s*\(/)[1]}`, context)
  let tree
  function render(props) { cursor = 0; tree = Component(props); return tree }
  function flushEffects() {
    for (const next of pendingEffects.splice(0)) {
      const previous = effects.get(next.index)
      if (previous && !sameDeps(previous.deps, next.deps)) previous.cleanup?.()
      if (!previous || !sameDeps(previous.deps, next.deps)) {
        const cleanup = next.effect()
        effects.set(next.index, { deps: next.deps, cleanup })
      }
    }
  }
  function dispose() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear() }
  return { render, flushEffects, dispose, get tree() { return tree } }
}

function walk(node, predicate, found = []) {
  if (Array.isArray(node)) { node.forEach(child => walk(child, predicate, found)); return found }
  if (!node || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  node.children?.forEach(child => walk(child, predicate, found))
  return found
}

function imageItems(prefix) {
  return {
    items: [{ chatId: prefix, key: `${prefix}-key`, turn: 1, versions: [{ id: `${prefix}-native`, description: `${prefix} native`, createdAt: 1 }] }],
    pluginItems: [{ id: `${prefix}-plugin`, turn: 1, caption: `${prefix} plugin`, createdAt: 2, updatedAt: 3 }]
  }
}

test('gallery deletes the selected plugin image in its session', async t => {
  const calls = []
  const h = componentHarness(declaration(gallerySource, 'SceneImageGallery'), {
    rpc: async (method, args, sessionId) => {
      calls.push({ method, args, sessionId })
      return method === 'listSceneImageHistory' ? imageItems('game-B') : { results: [{ versionId: 'game-B-plugin', ok: true }] }
    }
  })
  t.after(() => h.dispose())
  h.render({ gallerySessionId: 'session-B' }); h.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  h.render({ gallerySessionId: 'session-B' })

  const galleryImages = walk(h.tree, node => node.type === 'img')
  assert.equal(galleryImages.length, 1, 'only plugin pictures: old native ones are no longer kept')
  assert.ok(galleryImages.some(node => node.props.src.includes('game-B-plugin')))

  const removePluginButton = walk(h.tree, node => node.type === 'figure' && node.props.title === 'game-B plugin')[0]
  const deleteButton = walk(removePluginButton, node => node.type === 'button')[0]
  deleteButton.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const deletion = calls.find(call => call.method === 'removeSceneImageHistory')
  assert.equal(deletion.sessionId, 'session-B')
  assert.equal(deletion.args.sessionId, 'session-B')
  assert.deepEqual(Array.from(deletion.args.pluginItems), ['game-B-plugin'])
  assert.equal(deletion.args.items, undefined)

})

test('gallery sends selected plugin pictures with their session scope', async t => {
  const calls = []
  const h = componentHarness(declaration(gallerySource, 'SceneImageGallery'), {
    rpc: async (method, args, sessionId) => {
      calls.push({ method, args, sessionId })
      return method === 'listSceneImageHistory' ? imageItems('mixed-game') : { results: [
        { versionId: 'mixed-native', ok: true }, { versionId: 'mixed-plugin', ok: true }
      ] }
    }
  })
  t.after(() => h.dispose())
  h.render({ gallerySessionId: 'mixed-session' }); h.flushEffects()
  await new Promise(resolve => setImmediate(resolve))
  h.render({ gallerySessionId: 'mixed-session' })

  walk(h.tree, node => node.type === 'button' && node.children.includes('批量删除'))[0].props.onClick()
  h.render({ gallerySessionId: 'mixed-session' })
  const checkboxes = walk(h.tree, node => node.type === 'input' && node.props.type === 'checkbox')
  assert.equal(checkboxes.length, 1)
  checkboxes.forEach(node => node.props.onChange({ target: { checked: true } }))
  h.render({ gallerySessionId: 'mixed-session' })
  const removeSelected = walk(h.tree, node => node.type === 'button' && node.children[0]?.startsWith('删除选中的'))[0]
  removeSelected.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  const deletion = calls.find(call => call.method === 'removeSceneImageHistory')
  assert.equal(deletion.sessionId, 'mixed-session')
  assert.equal(deletion.args.sessionId, 'mixed-session')
  assert.equal(deletion.args.items, undefined)
  assert.deepEqual(Array.from(deletion.args.pluginItems), ['mixed-game-plugin'])
})

function hReact() {
  return {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
    useRef(initial) { return { current: initial } },
    useEffect() {}
  }
}
