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

test('Browser Activity 用一个投影同时控制正文输入与候选按钮', function () {
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'pending', busy: true, role: 'worldbook' }))), {
    phase: 'pending', busy: true, role: 'worldbook', label: '后台结算中…', blockReason: '正在准备下一轮世界书，请稍候…'
  })
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'running', busy: true, role: 'settlement' }))), {
    phase: 'running', busy: true, role: 'settlement', label: '后台结算中…', blockReason: '后台结算中，请稍候…'
  })
  assert.deepEqual(JSON.parse(JSON.stringify(describeTavernActivity({ phase: 'running', busy: true, role: 'candidate' }))), {
    phase: 'running', busy: true, role: 'candidate', label: '生成中…', blockReason: '正在生成候选项，请稍候…'
  })
})

test('空闲或失败 Activity 不锁住正文输入', function () {
  assert.equal(describeTavernActivity(null).busy, false)
  assert.equal(describeTavernActivity({ phase: 'failed', busy: false, role: 'settlement' }).blockReason, '')
})

test('Composer Gate 合并 Session 恢复与后台 Activity，不会互相误解锁', function () {
	let snapshot
	let writes = 0
	const blocks = {
		set(_sessionId, value) { writes += 1; snapshot = value },
		storeFor() { return { getSnapshot() { return snapshot } } }
	}
  const conversation = { blocks }
  const gate = browserModule.createComposerGate()

	gate.set(conversation, 'session-1', 'activity', '后台结算中，请稍候…')
	gate.set(conversation, 'session-1', 'activity', '后台结算中，请稍候…')
	assert.equal(writes, 1, '相同投影不应重复通知宿主')
	gate.set(conversation, 'session-1', 'connection', '正在恢复 Session，请稍候…')
  assert.equal(snapshot.reason, '正在恢复 Session，请稍候…')

  gate.clear(conversation, 'session-1', 'activity')
  assert.equal(snapshot.reason, '正在恢复 Session，请稍候…')
	gate.clear(conversation, 'session-1', 'connection')
	assert.equal(snapshot, undefined)
	gate.clear(conversation, 'session-1', 'connection')
	assert.equal(writes, 3, '已清空的 owner 不应再次通知宿主')
})
