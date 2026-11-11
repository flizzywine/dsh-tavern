// MVU_SMOKE_CURRENT_ONLY=1 covers enabling MVU after earlier floors already exist.
// MVU_SMOKE_POLL_SIGNALS=1 substitutes polling notifications in a standalone page;
// the production execution lease, MVU callbacks and transaction adapter remain real.
// Real browser loader, execution lease, event gate and settlement. Only the model
// and persistence are isolated. ?mode=manual|auto|unsafe|json|server-error covers recovery/diagnostics.
// Add navigation=1 to test game ownership across parent/child header unmounts.
// mode=capture overlaps a display capture with real MVU execution/persistence.
// mode=opening starts without variables. Optional MVU_SMOKE_CARD_PATH plus
// MVU_SMOKE_OPERATIONS (JSON array) exercises a real card in mode=opening-card,
// reading it without modifying any live chat or invoking a paid model.
// mode=opening-card-flow drives preparation -> start -> immediate foreground ->
// settlement on that card. mode=opening-flow uses the same shape with different
// greeting and worldbook defaults. MVU_SMOKE_OPENING_NOTE overrides the setup text;
// MVU_SMOKE_REPORT saves the flow's evidence.
// mode=opening-card-replay additionally reads MVU_SMOKE_DIAGNOSTICS_PATH and
// MVU_SMOKE_DATA_ROOT to clone a failed chat in memory. MVU_SMOKE_EXPECT_ERROR
// asserts a diagnostic substring instead of success; operations can be overridden.
import { initializationFixture } from '../fixtures/conversation-initialization.mjs'
import { createOpeningPreparation } from '../../tavern-plugin/lib/domain/opening-preparation.js'
import { createForegroundHandoff } from '../../tavern-plugin/lib/domain/foreground-handoff.js'
import { collectMvuHelperContext } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { applyOpeningCommand } from '../../tavern-plugin/lib/domain/opening-command.js'
import { instrumentInitializationAwaits, instrumentInitializationClient } from '../fixtures/mvu-initialization-trace.mjs'
import { createServer } from 'node:http'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { readOfficialMvuBundle, createOfficialMvuBundleReader } from '../../tavern-plugin/lib/domain/official-mvu-assets.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, sanitizeMvuLoadDiagnostic, redactMvuLoadError } from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { createMvuSettlementModule } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { applyMvuSettlementEffect } from '../../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { createSessionSignalTransport } from '../../tavern-plugin/lib/domain/session-signal-transport.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook } from '../../tavern-plugin/lib/domain/worldbook-resource.js'
import { projectTavernHelperWorldbook } from '../../tavern-plugin/lib/domain/tavern-helper-worldbook.js'
import { createCardPreparation } from '../../tavern-plugin/lib/domain/card-preparation.js'
import { projectTavernHelperScripts } from '../../tavern-plugin/lib/domain/tavern-helper-scripts.js'
import { projectTavernHelperContext, lastTavernHelperVariables } from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
import { createTurnOrchestrator } from '../../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../../tavern-plugin/lib/domain/agent-input-frame.js'
import { projectReplyLayers } from '../../tavern-plugin/lib/domain/reply-presentation.js'
import { createTavernStaticResourceCache, rewriteCachedModuleImports } from '../../tavern-plugin/lib/domain/tavern-static-resource-cache.js'

const tracing = process.env.MVU_SMOKE_TRACE === '1'
const rawClient = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const client = tracing ? instrumentInitializationClient(rawClient) : rawClient
const sidebar = await readFile(new URL('../../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
const startConversation = sidebar.slice(sidebar.indexOf('async function newConversation('), sidebar.indexOf('async function preparePlayConversation('))
const bundle = await readOfficialMvuBundle()
const executionBundle = tracing ? instrumentInitializationAwaits(bundle.body.toString(), 'official').source : bundle.body
const assets = createTavernStaticResourceCache({ rootDir: process.env.MVU_SMOKE_ASSET_CACHE || await mkdtemp(path.join(tmpdir(), 'mvu-init-assets-')) })
const signals = createSessionSignalTransport()
const gate = createTavernScriptDispatch({ publishSignal: (sessionId, signal) => signals.publish(sessionId, signal) })
const states = new Map()
const records = new Map()
const diagnostics = createMvuDiagnosticStore({ readJson: async key => records.get(key), updateJson: async (key, update) => { records.set(key, update(records.get(key))) } })
const openingBook = { name: '开场变量', entries: [{ id: 1, comment: '[initvar]初始值', content: 'hp: 10', enabled: true }] }
const cardWorkspace = process.env.MVU_SMOKE_CARD_PATH ? JSON.parse(await readFile(process.env.MVU_SMOKE_CARD_PATH, 'utf8')) : null
const cardPreparation = createCardPreparation()
const realCard = cardWorkspace ? cardPreparation.project(cardWorkspace) : null
const realScripts = cardWorkspace ? projectTavernHelperScripts(cardPreparation.present({ card: cardWorkspace, as: 'card-extensions' }).helperScripts).scripts : []
const replayLog = process.env.MVU_SMOKE_DIAGNOSTICS_PATH ? JSON.parse(await readFile(process.env.MVU_SMOKE_DIAGNOSTICS_PATH, 'utf8')) : null
const replaySubmission = replayLog?.records.find(record => record.stage === 'submitted')
const replayChat = replaySubmission ? await createChatJournalStore({ dataRoot: process.env.MVU_SMOKE_DATA_ROOT }).read(replaySubmission.chatId) : null
const realOperations = process.env.MVU_SMOKE_OPERATIONS ? JSON.parse(process.env.MVU_SMOKE_OPERATIONS) : replaySubmission?.operations
const books = new Map()
function bookFor(id) {
  const template = id.startsWith('opening-card') ? realCard?.character_book : id.startsWith('opening') ? openingBook : null
  if (!template) return null
  if (!books.has(id)) {
    const document = structuredClone(template)
    if (id.startsWith('opening-flow')) document.entries[0].content = 'hp: 0\naffection: 0\nstage: uninitialized'
    books.set(id, { source: { kind: 'card', cardPath: id }, document, view: inspectWorldBookDocument(document) })
  }
  return books.get(id)
}
function isErrorResponse(id) { return /^(json|server-error)/.test(id) }
function state(id) {
  if (!states.has(id)) {
    const variables = { stat_data: { hp: 10 }, schema: { type: 'object', properties: { hp: { type: 'number' } } }, display_data: {}, delta_data: {}, initialized_lorebooks: {} }
    states.set(id, { startedAt: Date.now(), downloads: 0, writes: 0, hpWrites: 0, resumes: 0, calls: 0, reader: createOfficialMvuBundleReader({ read: async () => {
      if (state(id).available) return bundle.body
      throw Object.assign(new Error("ENOENT: open 'C:\\Users\\PRIVATE_USER\\bundle.js'; apiKey=SECRET_VALUE"), { code: 'ENOENT' })
    } }), chat: { id, sessionId: id, mode: 'story', mvu: { enabled: true, owner: 'official' },
      messages: [{ role: 'assistant', text: '测试正文', swipeId: 0, swipes: ['测试正文'], variables: [id.startsWith('opening') ? {} : variables] }] } })
    if (id.startsWith('opening-card') && realCard) {
      const swipes = [realCard.first_mes, ...(realCard.alternate_greetings || [])]
      const swipeId = Math.min(2, swipes.length - 1)
      states.get(id).chat.messages[0] = { role: 'assistant', greeting: true, turn: 1, text: swipes[swipeId], swipeId, swipes, variables: swipes.map(() => ({})) }
    }
    if (id.startsWith('opening-setup')) {
      const chat = states.get(id).chat
      const swipes = ['Unused scene<initvar>{"hp":0}</initvar>',
        'Selected scene<initvar>{"hp":10,"figures":{"figure-42":{"name":"Mira","affinity":5}}}</initvar>']
      chat.messages[0] = { role: 'assistant', greeting: true, text: swipes[1], swipeId: 1, swipes, variables: [{}, {}] }
      chat.mvu.openingInitialization = { version: 2, status: 'pending' }
      applyOpeningCommand(chat, { removeGreeting: true, systemText: 'Mira starts at affinity 25.' }, {}, Date.now)
    }
    if (id.startsWith('opening-authored')) {
      const swipes = ['Default greeting', 'Build a character<initvar>{"hp":0}</initvar>']
      const chat = states.get(id).chat
      chat.messages[0] = { role: 'assistant', greeting: true, text: swipes[1], swipeId: 1, swipes, variables: [{}, { stat_data: { hp: 5 } }] }
      if (id.startsWith('opening-authored-helper')) {
        chat.messages.push({ role: 'tavern-helper', tavernRole: 'user', text: 'Character setup context', variables: [{}] })
      }
    }
    if (id.includes('replay') && replayChat) states.get(id).chat = { ...structuredClone(replayChat), id, sessionId: id }
  }
  return states.get(id)
}
const journal = process.env.MVU_SMOKE_JOURNAL === '1' ? createChatJournalStore({ dataRoot: await mkdtemp(path.join(tmpdir(), 'mvu-init-journal-')) }) : null
const seeds = new Map()
async function seeded(id) {
  if (!seeds.has(id)) seeds.set(id, journal.update(id, current => current || structuredClone(state(id).chat)))
  await seeds.get(id)
}
const persistence = createChatPersistence({ store: journal ? {
  read: async id => { await seeded(id); return journal.read(id) },
  update: async (id, mutate, metadata) => { await seeded(id); const saved = await journal.update(id, mutate, metadata); state(id).chat = structuredClone(saved); return saved },
  remove: id => journal.remove(id)
} : {
  read: async id => structuredClone(state(id).chat),
  update: async (id, mutate) => { state(id).chat = await mutate(structuredClone(state(id).chat)); return structuredClone(state(id).chat) },
  remove: async () => {}
} })
const adapter = createTavernScriptHostAdapter({ diagnostics, resolveChat: async id => (journal || id.startsWith('capture')) ? persistence.read(id) : state(id).chat,
  writeChat: async (chat, metadata) => {
    const s = state(chat.id)
    if (s.chat.messages[0].variables[0].stat_data?.hp !== chat.messages[0].variables[0].stat_data?.hp) s.hpWrites++
    s.writes++
    if (journal || chat.id.startsWith('capture')) await persistence.write(chat, metadata)
    else s.chat = structuredClone(chat)
  },
  readCard: async chat => ({ name: '测试卡', fixtureId: chat.id }), worldBooks: {
    bound: async (_path, card) => bookFor(card.fixtureId),
    update: async (source, request) => {
      const record = bookFor(source.cardPath)
      Object.assign(record, updateWorldBookDocument(record.document, request))
      return record
    }
  }, scriptDispatch: { ...gate,
    async dispatch(id, ...args) {
      if (id.startsWith('capture')) {
        const capture = await persistence.read(id)
        capture.messages[0].displayRuntime = { frames: [{ capturedAt: Date.now(), dom: 'concurrent display capture' }] }
        await persistence.write(capture, { source: 'display.capture', touchUpdatedAt: false })
      }
      return gate.dispatch(id, ...args)
    }
  } })
const settlement = createMvuSettlementModule({ runtime: adapter, diagnostics, model: { async run(request) {
  const s = state(request.sessionId)
  await request.onToolCall({ name: 'posture_submit', arguments: { posture: '站立' } })
  s.calls++
  s.prompt = request.turnContext
  s.feedback = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: s.operations || [{ op: 'replace', path: '/hp', value: 9 }] } }))
  return {}
} } })
// The start page sends immediately, before the runtime has finished loading. Do not
// seed variables or wait for ready here: that hid the real opening race in older fixtures.
async function startOpeningFlow(id) {
  const s = state(id)
  const h = initializationFixture()
  if (realCard) Object.assign(h.card, realCard, { path: 'cards/flow.json' })
  else {
    h.card.first_mes = 'Greeting<initvar>{"hp":10,"affection":5,"stage":"early"}</initvar>'
    h.card.character_book = openingBook
  }
  h.state.extensions = realCard ? cardPreparation.present({ card: cardWorkspace, as: 'card-extensions' }) : { mvuResources: [{ enabled: true }] }
  const preparation = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => bookFor(id) } })
  const draft = await preparation.create(h.card.path)
  const note = process.env.MVU_SMOKE_OPENING_NOTE || 'The player starts with affection 25 in the friends stage.'
  // A no-greeting start is the wizard command "/sys <setup> | /cut 0 | /trigger"; a greeting start sends none.
  if (!id.includes('greeting')) await preparation.callRuntime(draft.id, 'prepareOpeningCommand', { openingId: 'primary', line: '/sys ' + note + ' | /cut 0 | /trigger' })
  s.chat = { ...await h.make().start({ ...h.input, cardPath: h.card.path, openingId: 'primary', preparation: preparation.resolve(draft.id, h.card.path, 'primary') }), id, sessionId: id }
  preparation.dispose()
  const turns = createTurnOrchestrator({
    store: { chatForSession: async () => structuredClone(s.chat), readCard: async () => h.card,
      writeChat: async chat => { s.chat = structuredClone(chat) } },
    timeline: createStoryTimeline(), frameBuilder: createForegroundFrameBuilder(), projectReply: projectReplyLayers,
    planner: { plan: async ({ chat }) => {
      s.foregroundVariables = lastTavernHelperVariables(chat.messages, chat.variables) || {}
      return { text: 'Scripted first scene', sections: [] }
    } }, queueSettlement: async () => {}
  })
  s.handoff = createForegroundHandoff({ turns, store: { chatForSession: async () => structuredClone(s.chat) },
    tasks: { activity: () => ({ phase: 'idle' }) }, queueBackground: async () => {}, scriptDispatch: gate })
}
async function runOpeningFlow(id) {
  const s = state(id)
  await s.handoff.prepare({ sessionId: id, turn: 2, userText: 'Continue.' })
  await s.handoff.finalize({ sessionId: id, turn: 2, userText: 'Continue.', assistantText: 'The friends gather.' })
  const messageId = s.chat.messages.length - 1, message = s.chat.messages[messageId]
  const variables = structuredClone(message.variables[0])
  s.operations = realOperations || [{ op: 'replace', path: '/affection', value: 25 }, { op: 'replace', path: '/stage', value: 'friends' }]
  // Model latency normally lets the runtime finish loading; reproduce that ordering
  // without letting initialization rewrite the already captured foreground baseline.
  if (!gate.status(id).ready) await new Promise(resolve => {
    const stop = gate.subscribeReady(sessionId => { if (sessionId === id) { stop(); resolve() } })
  })
  // Submission is scripted; the runtime and its validation are the production ones.
  const result = await settlement.settleVariables({ sessionId: id, chatId: id, operationId: 'flow-op',
    branchId: s.chat.timeline.branchId, basedOnRevision: s.chat.timeline.revision, messageId, swipeId: 0,
    storyText: message.text, currentVariables: variables, variableSchema: variables.schema,
    helperContext: collectMvuHelperContext(s.chat.messages, messageId) })
  if (result.effect) applyMvuSettlementEffect(s.chat, result.effect)
  return { foregroundVariables: s.foregroundVariables, before: variables, prompt: s.prompt, feedback: s.feedback,
    receipt: result.receipt, after: s.chat.messages[messageId].variables[0], calls: s.calls,
    opening: s.chat.messages[0] }
}
function settlementInput(id) {
  const s = state(id)
  return { sessionId: id, operationId: 'op', chatId: id, branchId: 'b', basedOnRevision: 0,
    messageId: 0, swipeId: 0, storyText: '测试正文', currentVariables: s.chat.messages[0].variables[0] }
}
async function resume(id) {
  const s = state(id)
  if (!s.pending || s.resuming || !gate.status(id).ready) return
  s.resuming = true
  s.resumes++
  try {
    s.result = await settlement.resumeVariables({ ...settlementInput(id), submission: s.pending })
    assert.equal(s.result.receipt.status, 'updated')
    assert.equal(s.chat.messages[0].variables[0].stat_data.hp, 9)
    assert.equal(s.calls, 1)
    // Core initializes its schema once before settlement; count game mutations separately.
    assert.equal(s.hpWrites, 1)
    assert.equal(s.resumes, 1)
    s.pending = null
  } catch (error) { s.resumeError = error.message } finally { s.resuming = false }
}
gate.subscribeReady(sessionId => { void resume(sessionId) })
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/trace') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state(url.searchParams.get('id')).trace || {}))
    if (url.pathname.startsWith('/api/dsh-tavern/vendor/runtime-assets/')) {
      const relative = url.pathname.slice('/api/dsh-tavern/vendor/runtime-assets/'.length)
      const root = path.resolve('tavern-plugin/lib/vendor/runtime-assets')
      const target = path.resolve(root, relative)
      if (!target.startsWith(root + path.sep)) throw new Error('Invalid asset path')
      const body = await readFile(target)
      const type = /\.(?:m?js)$/.test(target) ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'application/octet-stream'
      return res.writeHead(200, { 'content-type': type }).end(body)
    }
    if (url.pathname === '/client.js') return res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(client)
    if (url.pathname === '/api/dsh-tavern/events') {
      const sessionId = url.searchParams.get('sessionId') || ''
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const stop = signals.subscribe(sessionId, [], signal => res.write('id: ' + signal.id + '\ndata: ' + JSON.stringify(signal) + '\n\n'))
      req.once('close', stop)
      return
    }
    if (url.pathname === '/mvu.js') {
      const id = url.searchParams.get('id'), s = state(id); s.downloads++
      if (isErrorResponse(id)) {
        try { await s.reader.read() } catch (error) {
          const legacy = id.startsWith('json')
          return res.writeHead(legacy ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: false, error: legacy ? error.message : redactMvuLoadError(error.message), body: 'DO_NOT_LOG_BODY' }))
        }
      }
      const fail = id.startsWith('manual') ? !s.available : id.startsWith('auto') && s.downloads < 3
      const body = id.startsWith('unsafe') ? 'window.partialWrites=(window.partialWrites||0)+1;throw Error("partial initialization");' : executionBundle
      return res.writeHead(fail ? 503 : 200, { 'content-type': bundle.mediaType }).end(fail ? 'unavailable' : body)
    }
    if (url.pathname === '/api/dsh-tavern/static-assets') {
      const asset = await assets.get(url.searchParams.get('url'))
      return res.writeHead(200, { 'content-type': asset.mediaType }).end(/javascript/.test(asset.mediaType) ? rewriteCachedModuleImports(asset.body.toString(), asset.finalUrl) : asset.body)
    }
    if (url.pathname === '/version') return res.end(JSON.stringify({ pkgVersion: '1.12.14' }))
    if (url.pathname === '/rpc') {
      // Decode once: a large Chinese card can split a UTF-8 character between chunks.
      const chunks = []; for await (const part of req) chunks.push(part)
      const { method, args = {}, sessionId } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      let result = {}
      if (method === 'claimTavernScriptWork') result = await adapter.claimWork(sessionId, args.runtimeId, args.ready, args.initializationError, args.contextBaseline)
      else if (method === 'startTavernScriptWork') result = adapter.startWork(sessionId, args.eventId, args.leaseToken, args.runtimeId)
      else if (method === 'heartbeatTavernScriptRuntime') result = adapter.heartbeatRuntime(sessionId, args.runtimeId, args.ready, args.initializationError)
      else if (method === 'completeTavernHelperEvent') result = gate.complete(sessionId, args.eventId, args.args, args.runtimeId, args.leaseToken, args.error, args.diagnostics)
      else if (method === 'releaseTavernHelperRuntime') result = gate.dispose(sessionId, args.runtimeId)
      else if (method === 'updateTavernHelperVariables') result = args.option?.type === 'global' ? { updated: true } : await adapter.updateVariables(sessionId, args.option, args.variables, args.expectedLifecycleRevision, args.eventId)
      else if (method === 'updateTavernHelperMessages') result = await adapter.updateMessages(sessionId, args.messages, args.expectedLifecycleRevision, args.eventId)
      else if (method === 'updateTavernHelperPrompts') result = await adapter.updatePrompts(sessionId, args.operation, args.expectedLifecycleRevision, args.eventId)
      else if (method === 'trace') { state(sessionId).trace = args.trace; result = { recorded: true } }
      else if (method === 'saveTavernExtensionSettings') result = { updated: true, extensionSettings: args.settings }
      else if (method === 'loadTavernWorldInfo') result = { worldInfo: bookFor(sessionId) ? exportSillyTavernWorldBook(bookFor(sessionId).document) : { entries: {} } }
      else if (method === 'getTavernHelperWorldbook') result = await adapter.getWorldbook(sessionId, args.name)
      else if (method === 'replaceTavernHelperWorldbook') result = await adapter.replaceWorldbook(sessionId, args.name, args.entries, args.expectedEntries)
      else if (method === 'recover') { state(sessionId).available = true; result = { available: true } }
      else if (method === 'recordMvuRuntimeDiagnostic' && args.diagnostic?.kind === 'mvu-load') {
        const diagnostic = sanitizeMvuLoadDiagnostic(args.diagnostic)
        if (diagnostic) await diagnostics.record(sessionId, { stage: 'mvu-load', diagnostic })
      }
      else if (method === 'diagnostics') {
        const log = await diagnostics.read(sessionId)
        const s = state(sessionId)
        const zip = await createMvuDiagnosticExport({ sessionId, store: diagnostics, environment: { mvuAsset: s.reader.inspect() } })
        const text = zip.buffer.toString()
        assert.doesNotMatch(text, /PRIVATE_USER|SECRET_VALUE|DO_NOT_LOG_BODY/)
        if (isErrorResponse(sessionId)) {
          assert.match(text, /json-error/)
          assert.match(text, /ENOENT/)
          assert.match(text, /retry-exhausted/)
          assert.doesNotMatch(text, /execution-failed/)
          if (!s.available) {
            assert.match(text, /read-failed/)
            assert.doesNotMatch(text, /execution-started/)
            assert.equal(s.downloads, 3)
            assert.equal(s.writes, 0)
          } else {
            assert.match(text, /verified/)
            assert.equal(s.downloads, 4)
            assert.equal(s.hpWrites, 1)
            assert.equal(s.resumes, 1)
            assert.equal(s.calls, 1)
          }
        }
        result = { pass: true, zipBytes: zip.buffer.length, records: log.records }
      }
      else if (method === 'timings') result = (await diagnostics.read(sessionId)).records.filter(row => row.diagnostic?.phase === 'initialization-timing')
      else if (method === 'verify-initialization') {
        const s = state(sessionId), saved = journal ? await journal.read(sessionId) : s.chat
        assert.equal(saved.mvu.openingInitialization?.status, 'complete', 'initial variables never persisted')
        const message = saved.messages[0]
        assert.equal(message.variables.length, message.swipes.length)
        assert.ok(message.variables.every(v => v && typeof v.stat_data === 'object' && v.schema !== undefined), 'all opening swipes must have initial variables')
        assert.equal(s.calls, 0, 'initialization must not call a model')
        result = { pass: true, initializationMs: saved.mvu.openingInitialization.completedAt - s.startedAt, swipes: message.variables.length, writes: s.writes, persisted: !!journal, modelCalls: s.calls, schemaKinds: [...new Set(message.variables.map(v => typeof v.schema))] }
      }
      else if (method === 'status') {
        const s = state(sessionId)
        result = { ...gate.status(sessionId), downloads: s.downloads, calls: s.calls, writes: s.writes, hpWrites: s.hpWrites, resumes: s.resumes,
          hp: s.chat.messages[0].variables[0].stat_data?.hp, variableKeys: Object.keys(s.chat.messages[0].variables[0].stat_data || {}), initialized: s.chat.mvu.openingInitialization,
          capture: sessionId.startsWith('capture') ? s.chat.messages[0].displayRuntime : undefined, receipt: s.result?.receipt, resumeError: s.resumeError }
      }
      else if (method === 'flow-context') result = projectTavernHelperContext(state(sessionId).chat)
      else if (method === 'run-opening-flow') result = await runOpeningFlow(sessionId)
      else if (method === 'run-authored-settlement') {
        const s = state(sessionId)
        const greeting = s.chat.messages[0]
        const snapshot = s.chat.messages.at(-1).variables[s.chat.messages.at(-1).swipeId || 0]
        assert.equal(snapshot.stat_data.hp, 5, 'initialization must use the authored value')
        assert.ok(snapshot.schema?.properties?.hp)
        if (s.chat.messages.length === 1) {
          assert.equal(greeting.variables[0].stat_data.hp, 10, 'the other swipe keeps its worldbook defaults')
        } else {
          // Simulate a save made before the fix, where a later Helper floor
          // contained defaults but the foreground turn captured the right data.
          s.chat.messages[1].variables[0] = { ...snapshot, stat_data: { hp: 0, affection: 0 } }
        }
        const baseline = { stat_data: { hp: 5, affection: 1 } }
        const messageId = s.chat.messages.length
        s.chat.messages.push({ role: 'assistant', text: 'The friends gather.', variables: [baseline] })
        s.operations = [{ op: 'replace', path: '/affection', value: 25 }]
        const outcome = await settlement.settleVariables({ ...settlementInput(sessionId), messageId, currentVariables: baseline })
        assert.equal(outcome.receipt.status, 'updated', JSON.stringify(outcome.receipt))
        applyMvuSettlementEffect(s.chat, outcome.effect)
        assert.deepEqual(s.chat.messages[messageId].variables[0].stat_data, { hp: 5, affection: 25 })
        if (messageId === 2) assert.equal(s.chat.messages[1].variables[0].stat_data.hp, 0, 'history remains intact')
        result = { pass: true }
      }
      else if (method === 'run') {
        const s = state(sessionId); s.writes = 0; s.hpWrites = 0
        let input = settlementInput(sessionId), openingBefore
        if (sessionId.startsWith('opening')) {
          assert.equal(s.chat.mvu.openingInitialization?.status, 'complete', 'opening must initialize before settlement')
          assert.ok(s.chat.messages[0].variables.every(v => v.stat_data !== undefined && v.schema !== undefined), 'all opening swipes need initial variables')
          if (sessionId.startsWith('opening-card')) {
            assert.ok(Array.isArray(realOperations) && realOperations.length > 0, 'set MVU_SMOKE_OPERATIONS for the chosen card')
            s.operations = realOperations
          }
          if (sessionId.startsWith('opening-setup')) {
            assert.equal(s.chat.messages.length, 1)
            assert.equal(s.chat.messages[0].role, 'system')
            assert.equal(s.chat.messages[0].text, 'Mira starts at affinity 25.')
            const initial = s.chat.messages[0].variables[0]
            assert.equal(initial.stat_data.figures['figure-42'].affinity, 5)
            assert.equal(initial.stat_data.figures['figure-42'].name, 'Mira')
            assert.ok(initial.schema.properties.figures, 'initvar must generate the schema')
            s.operations = [{ op: 'replace', path: '/figures/figure-42/affinity', value: 25 }]
          }
          openingBefore = structuredClone(s.chat.messages[0])
          const variables = structuredClone(openingBefore.variables[openingBefore.swipeId])
          if (sessionId.includes('replay')) {
            const messageId = replaySubmission.messageId, swipeId = replaySubmission.swipeId
            input = { ...input, messageId, swipeId, storyText: s.chat.messages[messageId].text, currentVariables: s.chat.messages[messageId].variables[swipeId] }
          } else {
            s.chat.messages.push({ role: 'user', text: '继续', turn: 2, variables: [{}] }, { role: 'assistant', text: '测试正文', turn: 2, swipeId: 0, swipes: ['测试正文'], variables: [variables] })
            if (process.env.MVU_SMOKE_CURRENT_ONLY === '1') {
              s.chat.messages[0].variables = s.chat.messages[0].variables.map(() => ({}))
              openingBefore = structuredClone(s.chat.messages[0])
            }
            input = { ...input, messageId: 2, currentVariables: variables }
          }
        }
        const resultState = await settlement.settleVariables(input)
        if (openingBefore) {
          if (process.env.MVU_SMOKE_EXPECT_ERROR) {
            assert.equal(resultState.receipt.status, 'error')
            assert.equal(s.feedback.ok, false)
            assert.ok(JSON.stringify(resultState.receipt.runtimeDiagnostics).includes(process.env.MVU_SMOKE_EXPECT_ERROR), 'receipt must expose the actual schema error')
            assert.equal(s.writes, 0, 'rejected operations must not persist')
            const exported = await createMvuDiagnosticExport({ sessionId, store: diagnostics })
            assert.ok(exported.buffer.toString().includes(process.env.MVU_SMOKE_EXPECT_ERROR), 'diagnostic export must retain the schema error')
          } else {
            assert.equal(resultState.receipt.status, 'updated', JSON.stringify(resultState.receipt))
            assert.equal(s.feedback.ok, true)
            assert.equal(s.feedback.failures.length, 0)
          }
          assert.deepEqual(s.chat.messages[0], openingBefore, 'settlement must preserve opening history')
          assert.equal(s.calls, 1)
          s.result = resultState
          result = { pass: true, calls: s.calls, writes: s.writes, receipt: resultState.receipt }
          return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
        }
        const failed = sessionId.startsWith('unsafe'), waiting = !gate.status(sessionId).ready && !failed
        assert.equal(resultState.receipt.status, failed ? 'error' : waiting ? 'pending' : 'updated')
        assert.equal(s.chat.messages[0].variables[0].stat_data.hp, failed || waiting ? 10 : 9)
        assert.equal(s.writes, failed || waiting ? 0 : 1)
        assert.equal(s.calls, 1)
        if (sessionId.startsWith('capture') && !waiting) assert.equal(s.chat.messages[0].displayRuntime.frames[0].dom, 'concurrent display capture')
        if (failed) { assert.equal(s.feedback.retryable, false); assert.match(JSON.stringify(resultState.receipt), /partial initialization/) }
        s.result = resultState
        if (waiting) { s.pending = resultState.submission; void resume(sessionId) }
        result = { pass: true, hp: s.chat.messages[0].variables[0].stat_data.hp, writes: s.writes, calls: s.calls, receipt: resultState.receipt }
      }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
    }
    const mode = url.searchParams.get('mode') || 'normal', id = mode + (url.searchParams.has('sandbox') ? '-sandbox' : '-trusted')
    if (mode.includes('-flow')) await startOpeningFlow(id)
    const view = { chatId: id, card: { name: '测试卡' }, tavernHelper: projectTavernHelperContext(state(id).chat),
      tavernRuntimePolicy: { trustedCardMode: !url.searchParams.has('sandbox') }, tavernHelperScripts: [],
      tavernHelperWorldbook: bookFor(id) ? projectTavernHelperWorldbook(bookFor(id).view) : null,
      tavernMvuRuntime: { owner: 'official', assetUrl: '/mvu.js?id=' + id } }
    if (id.startsWith('opening')) view.tavernHelperScripts.push({ id: 'opening-companion', name: '开场配套脚本', content: 'await updateVariablesWith(v=>({...v,enabled:true}),{type:"script"});', data: {}, enabled: true })
    if (mode === 'opening-slow') view.tavernHelperScripts.unshift({ id: 'slow-companion', name: '延迟测试', content: 'await new Promise(resolve=>setTimeout(resolve,20000));', data: {}, enabled: true })
    if (id.startsWith('opening-card')) {
      assert.ok(realCard, 'set MVU_SMOKE_CARD_PATH for mode=opening-card')
      view.card = realCard; view.tavernHelperScripts = realScripts
    }
    if (mode.includes('-flow')) view.tavernHelperScripts.unshift({ id: 'loading-companion', name: 'Opening startup ordering', content: 'await new Promise(resolve=>setTimeout(resolve,250));', data: {}, enabled: true })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>MVU 初始化验证</title>
      <div id="recovery"></div><button id="network">恢复下载服务</button><button id="run" disabled>验证结算</button><button id="diagnostics">验证诊断包</button><pre id="logs"></pre><pre id="trace"></pre><pre id="result">加载中</pre>
      ${url.searchParams.has('navigation') ? '<button id="child">查看子代理</button><button id="parent">返回主对话</button><button id="other">切换另一游戏</button><p id="navigation">主对话</p>' : ''}
      <script>
      const react={createElement(tag,props,...children){const node=document.createElement(tag);for(const [key,value] of Object.entries(props||{})){if(key==='onClick')node.onclick=value;else if(key==='style')Object.assign(node.style,value);else if(key==='className')node.className=value;else node.setAttribute(key,value);}for(const child of children)if(child!==null&&child!==false)node.append(child);return node;}};
      window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?react:{});}};</script><script src="/client.js"></script>
      <script>
      const id=${JSON.stringify(id)},output=document.querySelector('#result');
      async function rpc(method,args={},sessionId=id){const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({method,args,sessionId})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
      const view=${JSON.stringify(view)};
      // Exercise the actual sidebar start, including the transition gate used by
      // the session owner. Direct execution.sync() bypassed that gate and hid the deadlock.
      function startFlow() {
        let active = null, current = '', flow;
        const transitionListeners = new Set(), sessionListeners = new Set();
        const tavernSessionTransition = { getSnapshot:()=>active, subscribe(fn){transitionListeners.add(fn);return()=>transitionListeners.delete(fn)},
          begin(value){active=value;transitionListeners.forEach(fn=>fn())}, end(){active=null;transitionListeners.forEach(fn=>fn())} };
        const sessions = { list:{getSnapshot:()=>({current}), subscribe(fn){sessionListeners.add(fn);return()=>sessionListeners.delete(fn)}}, subagentAddress(){} };
        const liveTavernView = {getSnapshot:()=>({phase:'ready',view}),invalidate(){},subscribe(id,fn){fn({phase:'ready',view});return()=>{}}};
        const owner = client.createTavernScriptSessionOwner({sessions,rpc,transition:tavernSessionTransition,
          signals:{subscribe(id,kind,run){const timer=setInterval(run,100);return()=>clearInterval(timer)}},
          liveView:liveTavernView});
        owner.start();
        const openingPicker={openings:[]}, uiMode='play', setBusy=()=>{}, setError=()=>{}, setOpeningPicker=()=>{};
        const openingPerformance={begin:()=>({measure:(_name,run)=>run(),finish(){}})};
        const playPrewarmRef={current:{claim:async()=>''}};
        const substituteTavernIdentityMacros=text=>text;
        const conversationLifecycle={start:async()=>{current=id;sessionListeners.forEach(fn=>fn());return {sessionId:id}}};
        const props={executeSlash(){if(tavernSessionTransition.getSnapshot())throw Error('Initial send still holds the session transition');flow=rpc('run-opening-flow');return flow}};
        ${startConversation}
        return newConversation(view.card,'story','primary','Player',id.includes('greeting')?'':'Continue.').then(()=>flow || rpc('run-opening-flow'));
      }
      function display(state,retry){const node=client.TavernMvuLoadRecovery({state,retry});document.querySelector('#recovery').replaceChildren(...(node?[node]:[]));}
      let execution, page='parent';
      if (${mode.includes('-flow')}) {
        window.openingFlow = startFlow();
        window.openingFlow.catch(error=>{document.querySelector('#logs').textContent=error.message});
      } else if (${url.searchParams.has('navigation')}) {
        let current=id;const listeners=new Set();
        const sessions={list:{getSnapshot:()=>({current}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}},subagentAddress(sessionId){return sessionId===id+'-child'?{parentSessionId:id,childSessionId:sessionId}:undefined;}};
        execution=client.createTavernScriptSessionOwner({sessions,rpc,transition:{getSnapshot:()=>false,subscribe:()=>()=>{}},liveView:{invalidate(){},subscribe(sessionId,fn){fn({phase:'ready',view:sessionId===id?view:{}});return()=>{};}}});
        execution.start();
        let stopHeader=()=>{};
        function mountHeader(){stopHeader();document.querySelector('#recovery').replaceChildren();const render=()=>display(execution.getSnapshot().loadState,execution.retryMvuLoad);stopHeader=execution.subscribe(render);render();}
        function navigate(sessionId,name){stopHeader();current=sessionId;page=name;listeners.forEach(fn=>fn());mountHeader();document.querySelector('#navigation').textContent=name;}
        mountHeader();
        document.querySelector('#child').onclick=()=>navigate(id+'-child','子代理');
        document.querySelector('#parent').onclick=()=>navigate(id,'主对话');
        document.querySelector('#other').onclick=()=>navigate('other-game','另一游戏');
      } else {
        execution=client.createTavernScriptExecutionModule({rpc,${process.env.MVU_SMOKE_POLL_SIGNALS === '1' ? 'signals:{subscribe(id,kind,run){const timer=setInterval(run,100);return()=>clearInterval(timer);}},' : ''}invalidate(){},onMvuLoadState(state){display(state,()=>execution.retryMvuLoad());}});
        execution.sync(id,view);
      }
      window.addEventListener('message',event=>{if(event.data?.type==='mvu-smoke-trace'){document.querySelector('#trace').textContent=JSON.stringify(event.data.trace);void rpc('trace',{trace:event.data.trace});}});
      let ran=false;const timer=setInterval(async()=>{const s=await rpc('status');output.textContent=JSON.stringify(s,null,2);if(!ran&&(s.ready||s.initializationError||s.downloads>=3))document.querySelector('#run').disabled=false;},100);
      document.querySelector('#network').onclick=()=>rpc('recover');
      document.querySelector('#diagnostics').onclick=async()=>{try{document.querySelector('#logs').textContent=JSON.stringify(await rpc('diagnostics'),null,2);}catch(e){document.querySelector('#logs').textContent='FAIL: '+e.message;}};
      document.querySelector('#run').onclick=async()=>{ran=true;document.querySelector('#run').disabled=true;try{await rpc('run');}catch(e){clearInterval(timer);output.textContent='FAIL: '+e.message;}};
      </script>`)
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })) }
})
server.listen(Number(process.env.MVU_SMOKE_PORT) || 0, '127.0.0.1', () => console.log('MVU_INITIALIZATION_SMOKE_URL=http://127.0.0.1:' + server.address().port))
