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

test('已缓存会话在后台生成新楼层后，侧栏预取仍带旧签名重验并更新缓存', async () => {
	const data = loadDataModule()
	let s1Revision = 1
	const calls = []
	const store = data.create({ rpc: async () => ({}) }).createStoryTranscriptStore({
		load: async (id, options) => {
			calls.push({ id, options })
			if (id === 's1') {
				return {
					transcript: transcriptFor('s1-rev-' + s1Revision, s1Revision),
					view: { storageRevision: s1Revision },
					revision: s1Revision,
					storySignature: 'sig-s1-' + s1Revision
				}
			}
			return { transcript: transcriptFor(id, 1), view: { storageRevision: 1 }, revision: 1, storySignature: 'sig-' + id }
		}
	})
	await store.read('s1', {})
	await store.read('s2', {})
	// s1 在非当前对话状态下完成了新一轮生成
	s1Revision = 2
	let publishes = 0
	const unsubscribe = store.subscribe(() => { publishes += 1 })
	const prefetched = await data.prefetch('s1')
	assert.equal(publishes, 0, '在 s2 浏览期间预取 s1 不得改动当前可见快照')
	assert.equal(calls.at(-1).options.knownRevision, 1)
	assert.equal(calls.at(-1).options.knownStorySignature, 'sig-s1-1')
	assert.equal(prefetched.revision, 2)
	assert.equal(store.snapshotFor('s1', null).transcript.messages[0].message.text, 's1-rev-2', '切回首帧即可直接拿到后台新楼层')
	unsubscribe()
})

test('预取仍在途时切入同一会话，首读直接复用在途预取而不重复请求', async () => {
	const data = loadDataModule()
	let loads = 0
	let resolveLoad
	const pending = new Promise(resolve => { resolveLoad = resolve })
	const store = data.create({ rpc: async () => ({}) }).createStoryTranscriptStore({
		load: () => { loads += 1; return pending }
	})
	const prefetchPromise = data.prefetch('s-bg')
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(loads, 1)
	const readPromise = store.read('s-bg', {})
	assert.equal(loads, 1, '挂载首读应复用已在途的预取请求')
	resolveLoad({ transcript: transcriptFor('后台新楼层', 5), view: { storageRevision: 5 }, revision: 5, storySignature: 'sig-5' })
	await Promise.all([prefetchPromise, readPromise])
	assert.equal(loads, 1)
	assert.equal(store.getSnapshot().revision, 5)
	assert.equal(store.getSnapshot().transcript.messages[0].message.text, '后台新楼层')
})

test('切回会话首读在途时，带目标版本的跟进刷新复用同一在途请求而不自相中断', async () => {
	let loads = 0
	const signals = []
	let resolveFirst
	const firstLoad = new Promise(resolve => { resolveFirst = resolve })
	const store = storeFixture((id, options) => {
		loads += 1
		signals.push(options && options.signal)
		if (id === 's2') return Promise.resolve({ transcript: transcriptFor('s2', 1), view: {}, revision: 1, storySignature: 'sig-s2' })
		if (loads === 1) return Promise.resolve({ transcript: transcriptFor('s1-old', 1), view: {}, revision: 1, storySignature: 'sig-1' })
		return firstLoad
	})
	await store.read('s1', {})
	await store.read('s2', {})
	// 切回 s1：首读先发出（先上屏旧缓存 rev=1，后台补读在途）
	const initialSwitchRead = store.read('s1', {})
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(loads, 3)
	// 紧接着 liveView / tavern-state 告知最新 storageRevision=3，触发带 minimumRevision 的强制刷新
	const controller = new AbortController()
	const followUpRefresh = store.read('s1', { force: true, signal: controller.signal, minimumRevision: 3 })
	assert.equal(signals.at(-1).aborted, false, '同一目标的跟进刷新不得掐断已在途的首读')
	assert.equal(loads, 3, '不得重复发起第二次 getStoryTranscript')
	resolveFirst({ transcript: transcriptFor('s1-latest-floor', 3), view: { storageRevision: 3 }, revision: 3, storySignature: 'sig-3' })
	await Promise.all([initialSwitchRead, followUpRefresh])
	assert.equal(loads, 3)
	assert.equal(store.getSnapshot().revision, 3)
	assert.equal(store.getSnapshot().transcript.messages[0].message.text, 's1-latest-floor')
})

test('storyResourceVersion 与全量 resourceVersion 解耦：其他窗口写无关扩展设置不击穿故事窗口签名，全局正则变化才失效', async () => {
	let fullRes = 'ext-v1'
	let storyRes = 'regex-v1'
	let projections = 0
	const reader = createSessionViewReader({
		readStoryWindow: async () => storyWindow(),
		project: { story: async value => { projections += 1; return { chatId: value.chat.id, storyTranscript: value.storyTranscript } } },
		resourceVersion: async () => fullRes,
		storyResourceVersion: async () => storyRes,
		trace: { stage: (_name, fn) => fn(), state: () => {} }
	})
	const first = await reader.response({ sessionId: 's1', storyTranscript: 1 })
	assert.equal(projections, 1)

	// 其他窗口仅写非正则扩展设置或模板全局变量：fullRes 推进，storyRes 未变 -> 命中 unchanged
	fullRes = 'ext-v2'
	const unchanged = await reader.response({
		sessionId: 's1',
		storyTranscript: 1,
		knownRevision: first.revision,
		knownStorySignature: first.storySignature
	})
	assert.equal(unchanged.unchanged, true)
	assert.equal(projections, 1)

	// 全局展示正则或世界书绑定变化：storyRes 推进 -> 正常重投影
	storyRes = 'regex-v2'
	const rebuilt = await reader.response({
		sessionId: 's1',
		storyTranscript: 1,
		knownRevision: first.revision,
		knownStorySignature: first.storySignature
	})
	assert.notEqual(rebuilt.unchanged, true)
	assert.equal(projections, 2)
})
