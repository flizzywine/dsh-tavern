import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const extract = (name, next) => source.slice(source.indexOf((name === 'sceneImagePurchaseConfirmation' ? 'async ' : '') + 'function ' + name + '('), source.indexOf('function ' + next + '('))

test('scene request identifiers also work on LAN HTTP without crypto.randomUUID', () => {
  const context = vm.createContext({
    useTavernConfirm: () => async () => true,
    recordImageInteraction() {}, window: {} })
  const make = vm.runInContext(extract('sceneImageRequestId', 'sceneImageStageLabel') + ';sceneImageRequestId', context)
  const ids = Array.from({ length: 1000 }, make)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => /^[a-zA-Z0-9_-]{8,100}$/.test(id)))
})
