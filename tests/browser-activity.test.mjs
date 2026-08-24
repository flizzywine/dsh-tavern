import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadPolicy() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} })
}

const browserModule = await loadPolicy()
const describeTavernActivity = browserModule.describeTavernActivity

test('Browser Activity 只描述候选项生成是否繁忙', function () {
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'pending', busy: false, role: 'settlement' }))), {
    phase: 'pending', busy: false, role: 'settlement', label: '生成候选项', blockReason: ''
  })
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'running', busy: true, role: 'settlement' }))), {
    phase: 'running', busy: true, role: 'settlement', label: '后台结算中…', blockReason: '后台结算中，请稍候…'
  })
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'running', busy: true, role: 'candidate' }))), {
    phase: 'running', busy: true, role: 'candidate', label: '生成中…', blockReason: '正在生成候选项，请稍候…'
  })
})

test('空闲或失败 Activity 不阻止候选项生成', function () {
  assert.equal(describeTavernActivity(null).busy, false)
  assert.equal(describeTavernActivity({ phase: 'failed', busy: false, role: 'settlement' }).blockReason, '')
})

test('Tavern 不提供正文 Composer Gate', function () {
  assert.equal(browserModule.createComposerGate, undefined)
})
