import assert from 'node:assert/strict'
import test from 'node:test'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { sessionSeedTrajectoryMessages } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'

const messages = session => session.events.filter(event => event.type === 'assistant/message' && event.data?.message?.source?.model === 'character-card')

test('只有新建修改人物卡任务保存实验快照，重入不重新读取素材', async () => {
  const h = initializationFixture()
  const foreground = await h.make().start({ ...h.input, sessionId: 'foreground' })
  const input = { ...h.input, mode: 'card', cardTask: 'edit' }
  const chat = await h.make().start(input)
  assert.deepEqual(chat.cardEditContext, { version: 1 })
  assert.equal(messages(h.session()).length, 0)
  assert.equal(chat.openingText, '')
  assert.equal(h.session().events.at(-1).data.source.workspaceContextVersion, 1)
  assert.equal(h.session().events.at(-1).data.role, 'user')
  assert.equal(h.session().prefix, foreground.cardContextSnapshot)
  assert.deepEqual(seedMessages(h.session()).map(e => e.type === 'user/message' ? e.data.content[0].text : e.data.message.content[0].text), sessionSeedTrajectoryMessages(h.session().id, 'story').map(s => s.text))
  assert.ok(h.trace.indexOf('prefix') < h.trace.indexOf('opening.native-append'))
  h.card.description = '后续修改不重建开局快照'
  const reopened = await h.make().start(input)
  assert.equal(reopened.cardContextSnapshot, foreground.cardContextSnapshot)
  for (const cardTask of ['mvu', 'extract', undefined]) {
    const other = await h.make().start({ ...input, sessionId: 'other-' + cardTask, cardTask })
    assert.equal(other.cardEditContext, undefined)
  }
})
const seedMessages = session => session.events.filter(event => {
  const source = event.type === 'assistant/message' ? event.data?.message?.source : event.data?.source
  return source?.form === 'synthetic-trajectory' || source?.model === 'synthetic-trajectory'
})

async function profileFixture() {
  let value
  const profile = createUserPreferenceProfile({ store: {
    readJson: async () => structuredClone(value),
    updateJson: async (_path, update) => { value = await update(structuredClone(value)); return structuredClone(value) }
  } })
  const draft = await profile.saveDraft({ summary: '偏好', injectionText: '偏好慢热但持续推进。' })
  await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
  return profile
}

test('画像仅采用右侧保存的开关，旧开场参数不能启用或覆盖设置', async () => {
  const profile = await profileFixture()
  const h = initializationFixture({ userPreferenceProfile: profile })
  const off = await h.make().start({ ...h.input, userProfileEnabled: true })
  assert.equal(off.userProfileEnabled, false)
  assert.equal(off.userProfileContextSnapshot, '')

  await profile.setDefaultEnabled(true)
  const on = await h.make().start({ ...h.input, sessionId: 'enabled', userProfileEnabled: false })
  assert.equal(on.userProfileEnabled, true)
  assert.match(on.userProfileContextSnapshot, /偏好慢热但持续推进/)
  assert.ok(on.userProfileRevision > 0)
  assert.match(h.session('enabled').prefix, /偏好慢热但持续推进/)

  const card = await h.make().start({ ...h.input, sessionId: 'workbench', mode: 'card', cardPath: '' })
  assert.equal(card.userProfileEnabled, false)
  assert.equal(card.userProfileContextSnapshot, '')
})

test('画像开关和确认版本只影响新局，不改写已创建的游戏', async () => {
  const profile = await profileFixture()
  await profile.setDefaultEnabled(true)
  const h = initializationFixture({ userPreferenceProfile: profile })
  const first = await h.make().start(h.input)
  await profile.updateConfirmed({ expectedRevision: first.userProfileRevision, summary: '新偏好', injectionText: '改为快节奏冒险。' })
  await profile.setDefaultEnabled(false)
  const existing = await h.make().start(h.input)
  assert.equal(existing.userProfileEnabled, true)
  assert.equal(existing.userProfileRevision, first.userProfileRevision)
  assert.equal(existing.userProfileContextSnapshot, first.userProfileContextSnapshot)
  assert.equal((await h.make().start({ ...h.input, sessionId: 'next' })).userProfileEnabled, false)
})

test('没有确认画像时，即使旧数据保存了开启标记，也不会注入', async () => {
  const h = initializationFixture({ userPreferenceProfile: { read: async () => ({ hasConfirmed: false, defaultEnabled: true }) } })
  assert.equal((await h.make().start(h.input)).userProfileEnabled, false)
})

test('creation preserves opening source/projection, stable context, request mode and unknown preset fields', async () => {
  const h = initializationFixture(), before = structuredClone(h.card)
  const chat = await h.make().start(h.input)
  assert.equal(chat.mode, 'story')
  assert.equal(chat.requestMode, 'dsh')
  assert.equal(chat.openingText, '玩家，你好。')
  assert.equal(chat.messages[0].sourceText, '{{user}}，你好。')
  assert.equal(chat.messages[0].displayText, '玩家，你好。')
  assert.equal(chat.runtimePresetSnapshot.unknown, 'preserved')
  assert.equal(chat.cardContextSnapshotVersion, 7)
  assert.equal(chat.timeline.schemaVersion, 1, 'new chats persist the timeline before opening background work')
  assert.equal(chat.timeline.revision, 0)
  assert.match(chat.timeline.branchId, /^branch-/)
  for (const text of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界书']) assert.ok(chat.cardContextSnapshot.includes(text))
  assert.doesNotMatch(chat.cardContextSnapshot, /逐轮系统|逐轮后置|动态世界书/)
  assert.equal(h.session().prefix, chat.cardContextSnapshot)
  assert.equal(messages(h.session()).length, 1)
  assert.equal(h.session().phase.lastTurn, 1)
  assert.deepEqual(h.card, before)
  assert.equal(h.writes[0].metadata.source, 'chat.create', 'no unpublished snapshot save')
  assert.ok(h.trace.indexOf('wait') < h.trace.indexOf('chat.create'))
})

test('开场白使用 Tavern 合成模型来源，不冒充缺少 reasoning 续传信息的供应商原始回复', async () => {
  const h = initializationFixture()
  await h.make().start(h.input)
  const opening = messages(h.session())[0].data.message

  assert.deepEqual(opening.source, { kind: 'model', provider: 'dsh-tavern', model: 'character-card' })
})

test('原生游玩把固定会话种子写在人物卡背景之后、开场白之前，重入不重复', async () => {
  const h = initializationFixture()
  await h.make().start(h.input)
  const first = structuredClone(h.session().events)
  const seed = seedMessages(h.session())

  assert.deepEqual(seed.map(event => event.type), ['user/message', 'assistant/message', 'user/message'])
  assert.ok(seed.every(event => event.seq < messages(h.session())[0].seq))
  assert.ok(h.trace.indexOf('prefix') < h.trace.indexOf('flush'))
  await h.make().start(h.input)
  assert.deepEqual(h.session().events, first)

  const compatibility = initializationFixture()
  await compatibility.make().start({ ...compatibility.input, requestMode: 'sillytavern' })
  assert.equal(seedMessages(compatibility.session()).length, 0)

  const card = initializationFixture()
  await card.make().start({ ...card.input, mode: 'card', cardPath: '' })
  assert.equal(seedMessages(card.session()).length, 3)
  assert.match(seedMessages(card.session())[0].data.content[0].text, /待编辑素材/)
  const cardEvents = structuredClone(card.session().events)
  await card.make().start({ ...card.input, mode: 'card', cardPath: '' })
  assert.deepEqual(card.session().events, cardEvents)
})

test('会话种子任一消息写入中断后可恢复，且不重放已经追加的前缀', async () => {
  for (const suffix of [':1', ':2', ':3']) {
    const h = initializationFixture()
    let failed = false
    h.state.failures.append = (_type, data) => {
      const messageId = data?.id || data?.message?.id || ''
      if (!failed && messageId.endsWith(suffix)) { failed = true; throw Error('seed append failed') }
    }
    await assert.rejects(h.make().start(h.input), /seed append failed/)
    const before = structuredClone(h.session().events)
    delete h.state.failures.append

    await h.make().ensureOpening('session')

    assert.deepEqual(h.session().events.slice(0, before.length), before)
    assert.equal(seedMessages(h.session()).length, 3)
    assert.equal(messages(h.session()).length, 1)
  }
})

test('新游戏固化创建时的联网搜索设置，之后不随设置变化', async () => {
  const h = initializationFixture()
  h.state.settings.webSearchEnabled = true
  const created = await h.make().start(h.input)
  assert.equal(created.webSearchEnabled, true)

  h.state.settings.webSearchEnabled = false
  assert.equal((await h.make().start(h.input)).webSearchEnabled, true)

  const fresh = initializationFixture()
  assert.equal((await fresh.make().start(fresh.input)).webSearchEnabled, false)
  fresh.state.settings.webSearchEnabled = true
  assert.equal((await fresh.make().start({ ...fresh.input, cardPath: '', mode: 'card' })).webSearchEnabled, false)
})

test('新游戏默认动态跟随前台，显式后台配置才固化；重入不改写选择', async () => {
  const following = initializationFixture()
  const first = await following.make().start(following.input)
  assert.equal(first.backgroundModelSelection, null)
  following.state.settings.backgroundModel = { provider: 'vertex', model: 'gemini-2.5-flash' }
  assert.equal((await following.make().start(following.input)).backgroundModelSelection, null)

  const fixed = initializationFixture()
  fixed.state.settings.backgroundModel = { provider: 'siliconflow', model: 'deepseek-v4' }
  assert.deepEqual((await fixed.make().start(fixed.input)).backgroundModelSelection, { provider: 'siliconflow', model: 'deepseek-v4' })
  assert.equal((await fixed.make().start({ ...fixed.input, cardPath: '', mode: 'card' })).backgroundModelSelection, null)
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

test('mode selection preserves legacy aliases and enables compatibility experiments', async () => {
  for (const mode of ['card', 'revision', 'extract']) {
    const h = initializationFixture()
    const chat = await h.make().start({ ...h.input, cardPath: '', mode })
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
    h.state.failures.append = (type, data) => {
      if (type === stage && (stage !== 'assistant/message' || data?.message?.source?.model === 'character-card')) throw Error('append failed')
    }
    await assert.rejects(h.make().start(h.input), /append failed/)
    const before = structuredClone(h.session().events)
    delete h.state.failures.append
    await h.make().ensureOpening('session')
    assert.deepEqual(h.session().events.slice(0, before.length), before)
    assert.deepEqual(h.session().events.map(x => x.type), [
      'user/message', 'assistant/message', 'user/message',
      'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'
    ])
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
  const old = messages(h.session())[0]
  old.data.message.id = '11111111-1111-4111-8111-111111111111'
  old.data.message.source = { kind: 'model', provider: 'fixture', model: 'text' }
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


test('开局草稿世界书在第一次保存前固化，再次打开不覆盖本局配置', async () => {
  const h = initializationFixture()
  const snapshot = { version: 1, source: null, document: null }
  const chat = await h.make().start({ ...h.input, preparation: { worldbookSnapshot: snapshot } })
  assert.deepEqual(chat.openingWorldbookSnapshot, snapshot)
  assert.deepEqual(h.writes[0].chat.openingWorldbookSnapshot, snapshot)
  const reopened = await h.make().start({ ...h.input, preparation: { worldbookSnapshot: { version: 99 } } })
  assert.deepEqual(reopened.openingWorldbookSnapshot, snapshot)
})

test('starting from a preparation preserves chat and selected opening variables', async () => {
  const h = initializationFixture()
  h.state.extensions = { mvuResources: [{ enabled: true }] }
  const preparation = { worldbookSnapshot: { version: 1 }, variables: { setup: 'ready' }, messageVariables: { stat_data: { name: '旅人', hp: 12 } } }
  const chat = await h.make().start({ ...h.input, preparation })
  assert.deepEqual(chat.variables, preparation.variables)
  const opening = chat.messages.find(message => message.greeting)
  assert.deepEqual(opening.variables[opening.swipeId || 0], preparation.messageVariables)
  preparation.messageVariables.stat_data.hp = 0
  assert.equal(opening.variables[opening.swipeId || 0].stat_data.hp, 12)
})
