import assert from 'node:assert/strict'
import test from 'node:test'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const messages = session => session.events.filter(event => event.type === 'assistant/message')

test('creation preserves opening source/projection, stable context, request mode and unknown preset fields', async () => {
  const h = initializationFixture(), before = structuredClone(h.card)
  const chat = await h.make().start(h.input)
  assert.equal(chat.mode, 'story')
  assert.equal(chat.requestMode, 'dsh')
  assert.equal(chat.openingText, '玩家，你好。')
  assert.equal(chat.messages[0].sourceText, '{{user}}，你好。')
  assert.equal(chat.messages[0].displayText, '玩家，你好。')
  assert.equal(chat.runtimePresetSnapshot.unknown, 'preserved')
  assert.equal(chat.cardContextSnapshotVersion, 6)
  for (const text of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界书']) assert.ok(chat.cardContextSnapshot.includes(text))
  assert.doesNotMatch(chat.cardContextSnapshot, /逐轮系统|逐轮后置|动态世界书/)
  assert.equal(h.session().prefix, chat.cardContextSnapshot)
  assert.equal(messages(h.session()).length, 1)
  assert.equal(h.session().phase.lastTurn, 1)
  assert.deepEqual(h.card, before)
  assert.equal(h.writes[0].metadata.source, 'chat.create', 'no unpublished snapshot save')
  assert.ok(h.trace.indexOf('wait') < h.trace.indexOf('chat.create'))
})

test('double clicks and ensureOpening share session ordering and do not create duplicate chats or native events', async () => {
  const h = initializationFixture(), api = h.make()
  const result = await Promise.all([api.start(h.input), api.start(h.input), api.ensureOpening('session')])
  assert.equal(new Set(result.map(x => x.id)).size, 1)
  assert.equal(h.saved.size, 1)
  assert.equal(h.state.index.chats.length, 1)
  assert.equal(messages(h.session()).length, 1)
  assert.equal(h.state.presetReads, 1)
  const before = structuredClone(h.session().events)
  assert.equal((await h.make().start({ ...h.input, openingId: 'alternate:0' })).id, result[0].id)
  assert.deepEqual(h.session().events, before, 'reentering keeps the originally selected opening')
})

test('mode selection preserves legacy aliases, script alignment and compatibility policy', async () => {
  for (const mode of ['card', 'revision', 'extract']) {
    const h = initializationFixture()
    const chat = await h.make().start({ ...h.input, cardPath: '', mode, requestMode: 'sillytavern' })
    assert.equal(chat.mode, 'card'); assert.equal(chat.requestMode, 'dsh')
    assert.equal(chat.cardName, '卡片工作台'); assert.equal(chat.cardPath, '')
    assert.equal(chat.openingText, '卡片工作台开场白')
    assert.equal(chat.cardContextSnapshotVersion, 0)
    assert.equal(h.state.presetReads, 0)
    assert.equal(h.session().prefix, undefined)
  }
  const h = initializationFixture()
  h.state.script = { title: '剧本', version: 1, chunks: [{ id: 'one', text: '第二个开场白' }, { id: 'two', text: '后续' }] }
  const chat = await h.make().start({ ...h.input, mode: 'story', openingId: 'alternate:0', requestMode: 'sillytavern' })
  assert.equal(chat.mode, 'script'); assert.equal(chat.openingText, '第二个开场白')
  assert.equal(chat.requestMode, 'sillytavern'); assert.ok(chat.scriptState)
  assert.equal(h.session().prefix, undefined, 'compatibility path must not install native prefix')
  const restricted = initializationFixture(); restricted.state.settings.compatibilityMode = false
  assert.equal((await restricted.make().start({ ...restricted.input, requestMode: 'sillytavern' })).requestMode, 'dsh')
})

test('opening binds a pre-publication worldbook snapshot without leaving temporary chat metadata', async () => {
  let captured = 0
  const h = initializationFixture({ captureSceneWorldbook: async (chat, card, worldBook) => {
    assert.equal(chat.messages.length, 0)
    assert.equal(card.name, '测试角色')
    assert.ok(worldBook.view.entries.some(entry => entry.constant === false))
    captured++
    return { version: 1, digest: 'c'.repeat(64) }
  } })
  const chat = await h.make().start(h.input)
  assert.equal(captured, 1)
  assert.equal(chat.messages[0].sceneWorldbook.digest, 'c'.repeat(64))
  assert.equal(chat.messages[0].sceneWorldbook.bodyDigests.length, 1)
  assert.equal(Object.hasOwn(chat, 'sceneOpeningWorldbook'), false)
  assert.equal(h.writes[0].chat?.sceneOpeningWorldbook, undefined)
})

test('new MVU opening is pending for the official runtime, with independent empty variables per swipe', async () => {
  const h = initializationFixture()
  h.state.extensions = { mvuResources: [{ enabled: true }] }
  const chat = await h.make().start({ ...h.input, openingId: 'alternate:0' })
  assert.equal(chat.mvu.owner, 'official')
  assert.equal(chat.mvu.runtime, 'magvarupdate')
  assert.equal(chat.mvu.openingInitialization.status, 'pending')
  assert.equal(chat.messages[0].swipeId, 1)
  assert.deepEqual(chat.messages[0].variables, [{}, {}])
  chat.messages[0].variables[0].hp = 10
  assert.deepEqual(chat.messages[0].variables[1], {})
})

test('missing cards, invalid openings, missing scripts and readiness failures do not publish partial chats', async () => {
  for (const input of [{ cardPath: 'missing' }, { openingId: 'missing' }, { mode: 'script' }]) {
    const h = initializationFixture()
    await assert.rejects(h.make().start({ ...h.input, ...input }))
    assert.equal(h.saved.size, 0)
    assert.deepEqual(h.state.links, {})
  }
  for (const first_mes of ['开场白', '']) {
    const h = initializationFixture(); h.card.first_mes = first_mes; h.card.alternate_greetings = []
    h.state.failures.wait = async () => { throw Error('not writable') }
    const api = h.make()
    await assert.rejects(api.start(h.input), /not writable/)
    assert.equal(h.saved.size, 0)
    delete h.state.failures.wait
    assert.equal((await api.start(h.input)).nativeOpeningAppended, true)
    assert.equal(messages(h.session()).length, first_mes ? 1 : 0)
  }
})

test('failed registry publication rolls back its chat and links; same initialization owner can retry', async () => {
  const h = initializationFixture(), api = h.make()
  h.state.failures.index = async () => { throw Error('index full') }
  await assert.rejects(api.start(h.input), /index full/)
  assert.equal(h.saved.size, 0)
  assert.deepEqual(h.state.links, {})
  assert.equal(h.session().events.length, 0)
  delete h.state.failures.index
  await api.start(h.input)
  assert.equal(h.saved.size, 1)
  assert.equal(messages(h.session()).length, 1)
})

test('native flush failure and marker-save failure recover across module reload without replaying the opening', async () => {
  for (const failure of ['flush', 'marker', 'prefix']) {
    const h = initializationFixture()
    if (failure === 'flush') h.state.failures.flush = async session => { if (messages(session).length) throw Error('flush failed') }
    if (failure === 'marker') h.state.failures.write = async (_chat, metadata) => { if (metadata.source === 'opening.native-append') throw Error('marker failed') }
    if (failure === 'prefix') h.state.failures.prefix = async () => { throw Error('prefix failed') }
    await assert.rejects(h.make().start(h.input), /failed/)
    const saved = [...h.saved.values()][0]
    assert.notEqual(saved.nativeOpeningAppended, true)
    const id = saved.id
    h.state.failures = {}
    const recovered = await h.make().ensureOpening('session')
    assert.equal(recovered.id, id)
    assert.equal(recovered.nativeOpeningAppended, true)
    assert.equal(messages(h.session()).length, 1)
    assert.equal(h.session().events.filter(x => x.type === 'turn/end').length, 1)
  }
})

test('every partial native append boundary is resumable without deleting history or duplicating events', async () => {
  for (const stage of ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end']) {
    const h = initializationFixture()
    h.state.failures.append = type => { if (type === stage) throw Error('append failed') }
    await assert.rejects(h.make().start(h.input), /append failed/)
    const before = structuredClone(h.session().events)
    delete h.state.failures.append
    await h.make().ensureOpening('session')
    assert.deepEqual(h.session().events.slice(0, before.length), before)
    assert.deepEqual(h.session().events.map(x => x.type), ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'])
  }
})

test('projection failure after initialization is retryable without replay; independent sessions do not block each other', async () => {
  const h = initializationFixture(), api = h.make()
  h.state.failures.present = async () => { throw Error('view failure') }
  await assert.rejects(api.start(h.input), /view failure/)
  delete h.state.failures.present
  assert.equal((await api.start(h.input)).nativeOpeningAppended, true)
  assert.equal(messages(h.session()).length, 1)
  const fresh = initializationFixture(), parallel = fresh.make()
  await Promise.all(['one', 'two'].map(sessionId => parallel.start({ ...fresh.input, sessionId })))
  assert.equal(fresh.saved.size, 2)
  assert.equal(messages(fresh.session('one')).length, 1)
  assert.equal(messages(fresh.session('two')).length, 1)
})

test('missing binding recovers through registry; old standalone UUID greeting is adopted without rewriting its events', async () => {
  const h = initializationFixture()
  const first = await h.make().start(h.input)
  const stored = h.saved.get(first.id); delete stored.nativeOpeningAppended
  const old = messages(h.session())[0]; old.data.message.id = '11111111-1111-4111-8111-111111111111'
  h.state.links = {}
  const before = structuredClone(h.session().events)
  await h.make().ensureOpening('session')
  assert.deepEqual(h.session().events, before)
  assert.equal(h.state.links.session, first.id)
  assert.equal(await h.make().ensureOpening('missing'), null)
})

test('a new script binding does not convert an existing free-story conversation on reentry', async () => {
  const h = initializationFixture(), api = h.make()
  const first = await api.start(h.input)
  h.state.script = { title: 'new', chunks: [{ id: 'one', text: '内容' }] }
  const again = await api.start(h.input)
  assert.equal(again.id, first.id)
  assert.equal(again.mode, 'story')
  assert.equal(messages(h.session()).length, 1)
})

test('a queued retry runs after a failed initialization and recovers the same published Chat', async () => {
  const h = initializationFixture(), api = h.make()
  let failed = false
  h.state.failures.write = async (_chat, metadata) => {
    if (!failed && metadata.source === 'opening.native-append') { failed = true; throw Error('one failed write') }
  }
  const [first, second] = await Promise.allSettled([api.start(h.input), api.start(h.input)])
  assert.equal(first.status, 'rejected')
  assert.equal(second.status, 'fulfilled')
  assert.equal(second.value.nativeOpeningAppended, true)
  assert.equal(h.saved.size, 1)
  assert.equal(messages(h.session()).length, 1)
})

test('recovery refuses to fill an opening after another operation has interleaved history', async () => {
  const h = initializationFixture()
  h.state.failures.append = type => { if (type === 'step/end') throw Error('append failed') }
  await assert.rejects(h.make().start(h.input), /append failed/)
  delete h.state.failures.append
  h.session().append('user/message', { role: 'user', content: [{ type: 'text', text: '其他操作' }] })
  const before = structuredClone(h.session().events)
  await assert.rejects(h.make().ensureOpening('session'), /拒绝重复写入/)
  assert.deepEqual(h.session().events, before)
  assert.notEqual([...h.saved.values()][0].nativeOpeningAppended, true)
})
