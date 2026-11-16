import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'

// 移动端会话切换的两段延迟：服务端故事窗口的重复投影、客户端窗口缓存的容量与在途
// 请求。这里分别锁住：过期判断必须是「版本 + 窗口签名」而不是只看版本；快速连切
// 必须真的打断上一条读。

const dataSource = await readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8')
function loadDataModule() {
	const sandbox = { console, AbortController, setTimeout, clearTimeout, queueMicrotask, React: {} }
	vm.createContext(sandbox)
	vm.runInContext(dataSource, sandbox)
	vm.runInContext('globalThis.__story = { create: createTavernStoryTranscriptDataModule, prefetch: prefetchTavernStoryTranscript }', sandbox)
	return sandbox.__story
}

function storyWindow(overrides) {
	const messages = [{ role: 'user', text: '行动' }, { role: 'assistant', text: '正文' }]
	return Object.assign({
		chat: { id: 'c1', sessionId: 's1', mode: 'story', messages },
		from: 0, to: 1, messageCount: 2, revision: 5,
		storyTranscript: { source: 'story', revision: 5, from: 0, to: 1, messageCount: 2, messages: [] }
	}, overrides || {})
}

function storyFixture() {
	const calls = { window: 0, projection: 0 }
	const states = []
	let resources = 'wb-1'
	const window = storyWindow()
	const reader = createSessionViewReader({
		readStoryWindow: async () => { calls.window += 1; return window },
		project: { story: async value => { calls.projection += 1; return { chatId: value.chat.id, storyTranscript: value.storyTranscript } } },
		resourceVersion: async () => resources,
		trace: { stage: (_name, fn) => fn(), state: state => states.push(state) }
	})
	return { reader, calls, states, setResources: value => { resources = value }, window }
}

test('同一份故事窗口的第二次请求命中服务端缓存，不再重投影', async () => {
	const f = storyFixture()
	const first = await f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	assert.equal(first.storyTranscript.source, 'story')
	assert.equal(typeof first.storySignature, 'string')
	const second = await f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	assert.equal(f.calls.projection, 1)
	assert.equal(second.storyTranscript.source, 'story')
	assert.equal(second.storySignature, first.storySignature)
	assert.deepEqual(f.states.filter(row => row.viewRebuild).map(row => row.viewRebuild), ['story', 'story-cache'])
})

test('并发的同一份窗口请求合并成一次投影', async () => {
	const f = storyFixture()
	let release
	const gate = new Promise(resolve => { release = resolve })
	f.reader = createSessionViewReader({
		readStoryWindow: async () => storyWindow(),
		project: { story: async value => { f.calls.projection += 1; await gate; return { chatId: value.chat.id, storyTranscript: value.storyTranscript } } },
		resourceVersion: async () => 'wb-1',
		trace: { stage: (_name, fn) => fn(), state: () => {} }
	})
	const first = f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	const second = f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(f.calls.projection, 1)
	release()
	await Promise.all([first, second])
	assert.equal(f.calls.projection, 1)
})

test('带回来的窗口签名命中时直接返回 unchanged，跳过投影', async () => {
	const f = storyFixture()
	const first = await f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	const again = await f.reader.response({ sessionId: 's1', storyTranscript: 1,
		knownRevision: first.revision, knownStorySignature: first.storySignature })
	assert.equal(again.unchanged, true)
	assert.equal(again.revision, first.revision)
	assert.equal(again.storySignature, first.storySignature)
	assert.equal(again.view, undefined)
	assert.equal(f.calls.projection, 1)
})

test('外部资源变化时 revision 未动也不判 unchanged', async () => {
	const f = storyFixture()
	const first = await f.reader.response({ sessionId: 's1', storyTranscript: 1 })
	f.setResources('wb-2')
	const after = await f.reader.response({ sessionId: 's1', storyTranscript: 1,
		knownRevision: first.revision, knownStorySignature: first.storySignature })
	assert.notEqual(after.unchanged, true)
	assert.equal(after.storyTranscript.source, 'story')
	assert.notEqual(after.storySignature, first.storySignature)
	assert.equal(f.calls.projection, 2)
})

test('服务端缓存只留 12 份窗口投影', async () => {
	const states = []
	const projections = []
	const reader = createSessionViewReader({
		readStoryWindow: async sessionId => {
			const index = Number(String(sessionId).replace('s', ''))
			return storyWindow({ chat: { id: 'c' + index, sessionId, mode: 'story', messages: [] }, revision: index })
		},
		project: { story: async value => { projections.push(value.chat.id); return { chatId: value.chat.id, storyTranscript: value.storyTranscript } } },
		resourceVersion: async () => '',
		trace: { stage: (_name, fn) => fn(), state: state => states.push(state) }
	})
	for (let index = 0; index < 14; index += 1) await reader.response({ sessionId: 's' + index, storyTranscript: 1 })
	assert.equal(projections.length, 14)
	await reader.response({ sessionId: 's13', storyTranscript: 1 })
	assert.equal(projections.length, 14, '最近一份仍在缓存里')
	await reader.response({ sessionId: 's0', storyTranscript: 1 })
	assert.equal(projections.length, 15, '最早一份被 LRU 淘汰后重新投影')
})

function storeFixture(load) {
	const data = loadDataModule()
	return data.create({ rpc: async () => ({}) }).createStoryTranscriptStore({ load })
}

function transcriptFor(sessionId, revision) {
	return { source: 'story', revision, from: 0, to: 0, messageCount: 1,
		messages: [{ absoluteIndex: 0, key: 'index:0', message: { role: 'assistant', text: sessionId } }] }
}

test('客户端窗口缓存默认保留 12 个会话', async () => {
	const store = storeFixture(async id => ({ transcript: transcriptFor(id, 1), view: {}, revision: 1 }))
	for (let index = 0; index < 6; index += 1) await store.read('s' + index, {})
	for (let index = 0; index < 6; index += 1) {
		const snapshot = store.peek('s' + index)
		assert.ok(snapshot && snapshot.status === 'ready', '第 ' + index + ' 个会话的正文仍应在缓存里')
	}
})

test('缓存命中且服务端回 unchanged 时不重新发布快照', async () => {
	const seen = []
	let loads = 0
	const store = storeFixture(async (id) => {
		loads += 1
		if (id === 's1' && loads > 2) return { unchanged: true, revision: 3, storySignature: 'sig-s1' }
		return { transcript: transcriptFor(id, 3), view: { sessionId: id }, revision: 3, storySignature: 'sig-' + id }
	})
	await store.read('s1', {})
	await store.read('s2', {})
	let publishes = 0
	const unsubscribe = store.subscribe(() => { publishes += 1 })
	await store.read('s1', {})
	assert.equal(publishes, 1, '缓存先上屏一次，unchanged 补读不再重绘')
	const snapshot = store.getSnapshot()
	assert.equal(snapshot.sessionId, 's1')
	assert.equal(snapshot.revision, 3)
	assert.equal(snapshot.transcript.messages[0].message.text, 's1')
	assert.ok(store.peek('s1'), 'unchanged 后仍留在缓存里')
	unsubscribe()
})

test('补读带回上次的版本与窗口签名', async () => {
	const args = []
	const store = storeFixture(async (id, options) => {
		args.push({ id, options })
		return { transcript: transcriptFor(id, 4), view: {}, revision: 4, storySignature: 'sig-' + id }
	})
	await store.read('s1', {})
	await store.read('s2', {})
	await store.read('s1', {})
	const replay = args.filter(row => row.id === 's1').at(-1)
	assert.equal(replay.options.knownRevision, 4)
	assert.equal(replay.options.knownStorySignature, 'sig-s1')
})

test('快速连切打断上一个还在途的故事读', async () => {
	const signals = []
	const store = storeFixture((id, options) => {
		signals.push(Object.assign({ id }, { signal: options && options.signal }))
		if (id === 's2') return Promise.resolve({ transcript: transcriptFor(id, 1), view: {}, revision: 1, storySignature: 'sig-s2' })
		return new Promise((resolve, reject) => {
			const signal = options && options.signal
			if (signal && typeof signal.addEventListener === 'function') {
				signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
			}
		})
	})
	const first = store.read('s1', {})
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(signals[0].signal.aborted, false)
	await store.read('s2', {})
	assert.equal(signals[0].signal.aborted, true, '切走后旧请求必须被中断')
	await first
	assert.equal(store.getSnapshot().sessionId, 's2')
})

test('切换瞬间的预取只写缓存，不改可见快照', async () => {
	const data = loadDataModule()
	let loads = 0
	const store = data.create({ rpc: async () => ({}) }).createStoryTranscriptStore({
		load: async id => { loads += 1; return { transcript: transcriptFor(id, 2), view: {}, revision: 2, storySignature: 'sig-' + id } }
	})
	let publishes = 0
	store.subscribe(() => { publishes += 1 })
	const prefetched = await data.prefetch('s9')
	assert.equal(loads, 1)
	assert.ok(prefetched && prefetched.status === 'ready')
	assert.equal(publishes, 0)
	assert.ok(store.peek('s9'))
})

test('未注册 / 未包含预取模块时侧栏调用安全返回 null', async () => {
	const data = loadDataModule()
	assert.equal(data.prefetch('s1'), null)
})
