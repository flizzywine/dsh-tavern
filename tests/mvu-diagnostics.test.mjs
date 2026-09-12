import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, redactDiagnostic, sanitizeModuleFailure, redactMvuLoadError, sanitizeMvuLoadDiagnostic } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernScriptDispatch } from '../tavern-plugin/lib/domain/tavern-script-dispatch.js'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

function storage() {
  const data = new Map()
  return {
    readJson: async path => structuredClone(data.get(path)),
    updateJson: async (path, update) => { data.set(path, update(data.get(path))); }
  }
}

test('MVU 加载诊断只允许结构字段，错误脱敏、长度受限且随 ZIP 导出', async () => {
  const diagnostic = sanitizeMvuLoadDiagnostic({ phase: 'download-completed', loadId: 'load-1', cycle: 2, attempt: 3,
    httpStatus: 200, contentType: 'application/json', bodyKind: 'json-error', receivedChars: 200,
    serverError: 'ENOENT C:\\Users\\PRIVATE_USER\\bundle.js; apiKey=KEY_SECRET',
    responsePath: '/bundle.js?token=URL_SECRET', message: 'Bearer AUTH_SECRET',
    body: 'DO_NOT_LOG_BODY', source: 'DO_NOT_LOG_SCRIPT', headers: { authorization: 'DO_NOT_LOG_HEADER' }, browser: 'Chromium/128.0' })
  assert.equal(diagnostic.httpStatus, 200)
  assert.equal(diagnostic.cycle, 2)
  assert.match(diagnostic.serverError, /ENOENT/)
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_USER|KEY_SECRET|URL_SECRET|AUTH_SECRET|DO_NOT_LOG/)
  const store = createMvuDiagnosticStore(storage())
  await store.record('s', { stage: 'mvu-load', diagnostic })
  const zip = await createMvuDiagnosticExport({ sessionId: 's', store, environment: { mvuAsset: { phase: 'verify-failed', expectedSha256: 'a'.repeat(64), actualSha256: 'b'.repeat(64) } } })
  assert.match(zip.buffer.toString(), /download-completed/)
  assert.match(zip.buffer.toString(), /verify-failed/)
  assert.doesNotMatch(zip.buffer.toString(), /PRIVATE_USER|DO_NOT_LOG/)
  assert.equal(sanitizeMvuLoadDiagnostic({ phase: 'invented', httpStatus: Infinity }), null)
  assert.ok(JSON.stringify(sanitizeMvuLoadDiagnostic({ phase: 'execution-failed', message: 'x'.repeat(1000000) })).length < 4200)
})

test('MVU diagnostics distinguish script subscriptions from persisted initial variables', async () => {
  const store = createMvuDiagnosticStore(storage())
  for (const phase of ['subscriptions-ready', 'initialization-waiting', 'initialization-timeout', 'initialization-ready']) {
    const diagnostic = sanitizeMvuLoadDiagnostic({ phase, failureStep: 'initial-variables', variables: { secret: 'DO_NOT_LOG' } })
    assert.equal(diagnostic.phase, phase)
    assert.equal(diagnostic.failureStep, 'initial-variables')
    await store.record('s', { stage: 'mvu-load', diagnostic })
  }
  const zip = await createMvuDiagnosticExport({ sessionId: 's', store })
  assert.match(zip.buffer.toString(), /initialization-waiting/)
  assert.match(zip.buffer.toString(), /initial-variables/)
  assert.doesNotMatch(zip.buffer.toString(), /DO_NOT_LOG/)
})

test('真实日志 RPC 保留加载字段；诊断写盘失败不向运行路径抛错', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf("case 'recordMvuRuntimeDiagnostic':")
  const end = source.indexOf("case 'getPlayChatDebugTarget':", start)
  const store = createMvuDiagnosticStore(storage())
  const context = { chatForSession: async id => ({ sessionId: id }), str: String, sanitizeMvuLoadDiagnostic, sanitizeModuleFailure, redactMvuLoadError, mvuDiagnostics: store }
  const invoke = vm.runInNewContext('(async function(args){switch("recordMvuRuntimeDiagnostic"){' + source.slice(start, end) + '}})', context)
  const args = { sessionId: 's', diagnostic: { kind: 'mvu-load', phase: 'download-response', httpStatus: 403, contentType: 'text/plain' } }
  assert.equal((await invoke(args)).recorded, true)
  const row = (await store.read('s')).records[0]
  assert.equal(row.stage, 'mvu-load')
  assert.equal(row.diagnostic.httpStatus, 403)
  await invoke({sessionId:'s', diagnostic:{scriptId:'schema',level:'error',message:'模块加载失败',moduleFailure:{phase:'module-load',reason:'http',resources:[{url:'https://cdn.example/a.js?token=PRIVATE',status:404}]}}})
  const moduleRow = (await store.read('s')).records.at(-1)
  assert.equal(moduleRow.diagnostic.moduleFailure.resources[0].status,404)
  assert.doesNotMatch(JSON.stringify(moduleRow),/PRIVATE/)
  context.mvuDiagnostics = { record: async () => { throw Error('disk failure') } }
  assert.equal((await invoke(args)).recorded, false)
})

test('诊断记录持久化、限量，并移除凭据', async () => {
  const data = storage()
  const store = createMvuDiagnosticStore(data, { maxRecords: 3 })
  for (let n = 0; n < 5; n++) await store.record('s1', { stage: 'runtime', diagnosticId: 'op:1', n, apiKey: 'SECRET', message: 'Bearer SECRET https://host/x?token=SECRET' })
  const exported = await createMvuDiagnosticStore(data, { maxRecords: 3 }).read('s1')
  assert.equal(exported.records.length, 3)
  assert.equal(exported.dropped, 2)
  assert.doesNotMatch(JSON.stringify(exported), /SECRET/)
  assert.equal((await store.read('s2')).records.length, 0)
  assert.doesNotMatch(JSON.stringify(redactDiagnostic({ Authorization: 'SECRET', nested: { password: 'SECRET' } })), /SECRET/)
  assert.doesNotMatch(redactDiagnostic('request {"apiKey":"SECRET"} https://user:SECRET@host/?signature=SECRET'), /SECRET/)
})

test('诊断包同时导出前台、后台日志和 MVU 记录，缺失日志明确标注', async () => {
  const store = createMvuDiagnosticStore(storage())
  await store.record('s1', { stage: 'submitted', diagnosticId: 'op:1' })
  const flushed = []
  const result = await createMvuDiagnosticExport({
    sessionId: 's1', backgroundSessionIds: ['bg', 'missing'], store,
    sessions: { get: id => ({ id }), flush: async s => flushed.push(s.id) },
    persistence: { readRaw: async id => id === 'missing' ? undefined : { content: JSON.stringify({ type: 'session', id, apiKey: 'SECRET' }) + '\n' } }
  })
  assert.deepEqual(flushed, ['s1', 'bg', 'missing'])
  assert.equal(result.filename, 'dsh-tavern-diagnostics-s1.zip')
  assert.equal(result.buffer.readUInt32LE(0), 0x04034b50)
  const text = result.buffer.toString('utf8')
  assert.match(text, /mvu\/diagnostics.json/)
  assert.match(text, /subagents\/bg\/session.jsonl/)
  assert.match(text, /missing/)
  assert.doesNotMatch(text, /SECRET/)
  const dir = await mkdtemp(join(tmpdir(), 'tavern-log-zip-'))
  try {
    const archive = join(dir, result.filename)
    await writeFile(archive, result.buffer)
    if (process.platform !== 'win32') {
      assert.match(execFileSync('unzip', ['-t', archive], { encoding: 'utf8' }), /No errors detected/)
      const content = execFileSync('unzip', ['-p', archive, 'mvu/diagnostics.json'], { encoding: 'utf8' })
      assert.equal(JSON.parse(content).records[0].stage, 'submitted')
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('超长诊断明确标记截断，日志 ZIP 保留子任务及图片附件', async () => {
  const store = createMvuDiagnosticStore(storage())
  await store.record('s', { stage: 'submitted', diagnosticId: 'op:1', values: 'x'.repeat(100000) })
  const state = await store.read('s')
  assert.equal(state.records[0].truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 32768)
  const ref = { attachmentId: 'img1', mediaType: 'image/png' }
  const result = await createMvuDiagnosticExport({
    sessionId: 's', store,
    query: { traceSession: async () => ({ descendants: [{ session: { header: { id: 'child' } }, descendants: [] }] }) },
    persistence: { readRaw: async id => ({ content: JSON.stringify({ type: 'assistant/message', id, content: [{ type: 'image', attachment: ref }] }) }) },
    attachments: { readImage: async reference => { assert.equal(reference.attachmentId, 'img1'); return { data: Buffer.from('image bytes') } } }
  })
  const text = result.buffer.toString('utf8')
  assert.match(text, /subagents\/child\/session.jsonl/)
  assert.match(text, /media\/img1.png/)
  assert.equal(text.split('image bytes').length - 1, 1)
})

test('浏览器非抛出警告经事件门、执行器和结算回执持久保留，而不进入正文', async () => {
  const store = createMvuDiagnosticStore(storage())
  const gate = createTavernScriptDispatch()
  gate.touch('s', 'browser', true)
  const chat = { id: 'c', sessionId: 's', mode: 'story', mvu: { enabled: true, owner: 'official' }, messages: [{ role: 'assistant', text: '正文', swipes: ['正文'], swipeId: 0, variables: [{}] }] }
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => chat, writeChat: async () => {}, readCard: async () => ({}), worldBooks: { bound: async () => null }, diagnostics: store,
    scriptDispatch: { ...gate, async dispatch(...args) {
      const pending = gate.dispatch(...args)
      await new Promise(resolve => setImmediate(resolve))
      const offer = gate.claim('s', 'browser', true)
      const event = offer.event
      assert.ok(event)
      assert.equal(gate.start('s', event.id, offer.leaseToken, 'browser').started, true)
      // A rejection reported by console.warn does not reject the JS event itself.
      gate.complete('s', event.id, [0], 'browser', offer.leaseToken, '', [{ level: 'warn', scriptId: 'mvu', message: '目标容器尚未初始化' }])
      return await pending
    } }
  })
  const module = createMvuSettlementModule({ diagnostics: store, runtime: adapter, model: { async run(input) {
    await input.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
    await input.onToolCall({ name: 'mvu_submit_update', arguments: { analysis: '不要重复记录这段分析', operations: [{ op: 'add', path: '/角色', value: {} }] } })
    return { text: '{}', traceSessionId: 'bg' }
  } } })
  const result = await module.settleVariables({ operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0, storyText: '正文', currentVariables: {} })
  assert.equal(result.receipt.status, 'error')
  assert.equal(result.receipt.runtimeDiagnostics[0].message, '目标容器尚未初始化')
  const records = (await store.read('s')).records
  assert.deepEqual(records.map(r => r.stage), ['start', 'submitted', 'runtime-dispatch', 'runtime-completed', 'validation-rejected', 'result', 'finished'])
  assert.equal(new Set(records.map(r => r.diagnosticId)).size, 1)
  assert.equal(records.at(-1).traceSessionId, 'bg')
  assert.doesNotMatch(JSON.stringify(records), /不要重复记录这段分析|正文|可能被人物卡/)
  assert.equal(chat.messages[0].text, '正文')
})

test('诊断磁盘故障不会使已经成功的结算重试', async () => {
  let runs = 0
  const module = createMvuSettlementModule({
    diagnostics: { async record() { throw new Error('disk full') } },
    model: { async run(input) { runs++; await input.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } }); await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } }); return {} } },
    runtime: { async settleMvuUpdate() { return { context: { messages: [{ variables: {} }] } } } }
  })
  const result = await module.settleVariables({ operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0, storyText: '正文', currentVariables: {} })
  assert.equal(result.receipt.status, 'unchanged')
  assert.equal(runs, 1)
})

test('真实 iframe bootstrap 捕获 console.warn 和 toastr，带事件编号并限制洪泛', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  const client = descriptor.factory(() => ({}))
  const document = client.buildTavernHelperScriptDocument({ token: 'test', scripts: [{ id: 'guard' }], context: { messages: [] } })
  // Execute the production document, replacing only the unrelated packaged module import.
  const bootstrap = document.match(/<script data-dsh-tavern-helper-script>([\s\S]*?)<\/script>/)[1]
    .replace('import("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs")', 'Promise.resolve({})')
    .replace('import("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs")', 'Promise.resolve({})')
  const messages = [], listeners = new Map()
  const parent = { postMessage: value => messages.push(value) }
  const sandbox = { parent, console: { info() {}, warn() {}, error() {} }, structuredClone, setTimeout, clearTimeout,
    addEventListener(name, listener) { const list = listeners.get(name) || []; list.push(listener); listeners.set(name, list) }
  }
  sandbox.window = sandbox
  vm.runInNewContext(bootstrap, sandbox)
  sandbox.console.warn('initialization warning')
  assert.equal(messages.at(-1).type, 'dsh-tavern-helper-diagnostic')
  assert.equal(messages.at(-1).eventId, '')
  assert.equal(messages.at(-1).scriptId, '', 'unowned logs do not borrow the last script id')
  const deferredError = new Error('earlier callback')
  deferredError.stack = 'Error: earlier callback\n at run (dsh-tavern-script:previous:1:20)'
  sandbox.console.warn('deferred', deferredError)
  assert.equal(messages.at(-1).scriptId, 'previous')
  const initialDiagnostics = messages.filter(item => item.type === 'dsh-tavern-helper-diagnostic').length
  sandbox.eventOn('MESSAGE_RECEIVED', () => sandbox.toastr.warning('schema rejected'))
  for (const listener of listeners.get('message')) listener({ source: parent, data: { token: 'test', type: 'dsh-tavern-helper-event', eventId: 'event-1', name: 'MESSAGE_RECEIVED', args: [0] } })
  await new Promise(resolve => setImmediate(resolve))
  const warning = messages.find(item => item.message === 'schema rejected')
  assert.equal(warning.eventId, 'event-1')
  assert.equal(warning.scriptId, 'guard')
  const completed = messages.find(item => item.type === 'dsh-tavern-helper-event-complete')
  assert.equal(completed.error, undefined)
  for (let i = 0; i < 100; i++) sandbox.console.warn('repeated')
  assert.ok(messages.filter(item => item.type === 'dsh-tavern-helper-diagnostic').length <= initialDiagnostics + 50)
})

test('诊断包包含界面按钮错误并脱敏', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), displayDiagnostics: { frames: [{ turn: 1, console: [{ level: 'error', args: [{ message: 'journey failed', token: 'PRIVATE_TOKEN' }] }] }] } })
  assert.match(result.buffer.toString(), /display\/diagnostics.json/)
  assert.match(result.buffer.toString(), /journey failed/)
  assert.doesNotMatch(result.buffer.toString(), /PRIVATE_TOKEN/)
})

test('现有日志 ZIP 包含独立更新诊断，不要求当前会话触发更新', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), updateDiagnostics: { version: 1, records: [{ event: 'github.version.failed', cause: { code: 'ETIMEDOUT' } }] } })
  assert.match(result.buffer.toString(), /update\/diagnostics.json/)
  assert.match(result.buffer.toString(), /ETIMEDOUT/)
})

test('initialization timings retain bounded phase counters in exported logs without payloads', async () => {
  const input = { phase: 'initialization-timing', timings: { elapsedMs: 92000, dropped: 0, entries: [
    { stage: 'prompt-drain', scriptId: 'script-1', count: 15, pending: 1, oldestPendingMs: 90000, totalMs: 10, maxMs: 5, failures: 0, variables: 'PRIVATE' },
    { stage: 'invented', content: 'PRIVATE' }
  ], card: 'PRIVATE' } }
  const value = sanitizeMvuLoadDiagnostic(input)
  assert.equal(value.timings.entries.length, 1)
  assert.equal(value.timings.entries[0].oldestPendingMs, 90000)
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/)
  const store = createMvuDiagnosticStore(storage())
  await store.record('timing-session', { stage: 'mvu-load', diagnostic: value })
  const exported = await createMvuDiagnosticExport({ sessionId: 'timing-session', store })
  assert.ok(exported.buffer.toString().includes('prompt-drain'))
  assert.ok(exported.buffer.toString().includes('oldestPendingMs'))
})

test('diagnostic ZIP includes card scripts and bound worldbook with credential redaction', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), cardDiagnostics: {
    version: 1, source: 'export-time', card: { name: '测试卡', first_mes: '开场' },
    extensions: { helperScripts: [{ id: 'broken-script', content: 'const broken = {;' }], apiKey: 'PRIVATE_CARD_KEY' },
    worldbook: { document: { entries: { 0: { content: '世界书测试内容' } } } }
  } })
  const text = result.buffer.toString()
  assert.match(text, /card\/context.json/)
  assert.match(text, /const broken = \{;/)
  assert.match(text, /世界书测试内容/)
  assert.doesNotMatch(text, /PRIVATE_CARD_KEY/)
})

test('oversized card does not prevent exporting diagnostic logs', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), cardDiagnostics: { card: { first_mes: 'x'.repeat(8 * 1024 * 1024) } } })
  assert.match(result.buffer.toString(), /人物卡资料超过 8 MiB/)
  assert.match(result.buffer.toString(), /mvu\/diagnostics.json/)
  assert.ok(result.buffer.length < 100000)
})


test('模块加载详情只保留限量脱敏资源和 HTTP 状态', async () => {
  const detail = sanitizeModuleFailure({ phase:'module-load', reason:'http', message:'Bearer PRIVATE', source:'PRIVATE',
    references:['https://user:PRIVATE@cdn.example/a.js?token=PRIVATE#PRIVATE', 'data:PRIVATE'],
    resources:[{url:'https://cdn.example/b.js?key=PRIVATE',status:404,body:'PRIVATE'}, {url:'https://cdn.example/c.js',status:0}] });
  assert.deepEqual(detail.references,['https://cdn.example/a.js']);
  assert.deepEqual(detail.resources,[{url:'https://cdn.example/b.js',status:404}]);
  assert.doesNotMatch(JSON.stringify(detail),/PRIVATE/);
  const store=createMvuDiagnosticStore(storage());
  await store.record('s',{stage:'script-runtime',diagnostic:{moduleFailure:detail}});
  const zip=await createMvuDiagnosticExport({sessionId:'s',store});
  assert.match(zip.buffer.toString(),/module-load/);
  assert.match(zip.buffer.toString(),/404/);
  assert.doesNotMatch(zip.buffer.toString(),/PRIVATE/);
});
