import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, redactDiagnostic, sanitizeMvuLoadDiagnostic } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createTavernHelperEventGate } from '../tavern-plugin/lib/domain/tavern-helper-event-gate.js'
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

test('真实日志 RPC 保留加载字段；诊断写盘失败不向运行路径抛错', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf("case 'recordMvuRuntimeDiagnostic':")
  const end = source.indexOf("case 'getPlayChatDebugTarget':", start)
  const store = createMvuDiagnosticStore(storage())
  const context = { chatForSession: async id => ({ sessionId: id }), str: String, sanitizeMvuLoadDiagnostic, mvuDiagnostics: store }
  const invoke = vm.runInNewContext('(async function(args){switch("recordMvuRuntimeDiagnostic"){' + source.slice(start, end) + '}})', context)
  const args = { sessionId: 's', diagnostic: { kind: 'mvu-load', phase: 'download-response', httpStatus: 403, contentType: 'text/plain' } }
  assert.equal((await invoke(args)).recorded, true)
  const row = (await store.read('s')).records[0]
  assert.equal(row.stage, 'mvu-load')
  assert.equal(row.diagnostic.httpStatus, 403)
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
  const gate = createTavernHelperEventGate()
  gate.touch('s', 'browser', true)
  const chat = { id: 'c', sessionId: 's', mode: 'story', mvu: { enabled: true, owner: 'official' }, messages: [{ role: 'assistant', text: '正文', swipes: ['正文'], swipeId: 0, variables: [{}] }] }
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => chat, writeChat: async () => {}, readCard: async () => ({}), worldBooks: { bound: async () => null }, diagnostics: store,
    eventGate: { ...gate, async dispatch(...args) {
      const pending = gate.dispatch(...args)
      await new Promise(resolve => setImmediate(resolve))
      const event = gate.poll('s', 'browser', true).event
      assert.ok(event)
      // A rejection reported by console.warn does not reject the JS event itself.
      gate.complete('s', event.id, [0], 'browser', '', [{ level: 'warn', scriptId: 'mvu', message: '目标容器尚未初始化' }])
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
  // Execute the production document, replacing only the unrelated CDN dependency.
  const bootstrap = document.match(/<script data-dsh-tavern-helper-script>([\s\S]*?)<\/script>/)[1]
    .replace(/import\(window\.__dshTavernStaticAssetUrl\([^\n]+?\)\)/, 'Promise.resolve({})')
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
  sandbox.eventOn('MESSAGE_RECEIVED', () => sandbox.toastr.warning('schema rejected'))
  for (const listener of listeners.get('message')) listener({ source: parent, data: { token: 'test', type: 'dsh-tavern-helper-event', eventId: 'event-1', name: 'MESSAGE_RECEIVED', args: [0] } })
  await new Promise(resolve => setImmediate(resolve))
  const warning = messages.find(item => item.message === 'schema rejected')
  assert.equal(warning.eventId, 'event-1')
  assert.equal(warning.scriptId, 'guard')
  const completed = messages.find(item => item.type === 'dsh-tavern-helper-event-complete')
  assert.equal(completed.error, undefined)
  for (let i = 0; i < 100; i++) sandbox.console.warn('repeated')
  assert.ok(messages.filter(item => item.type === 'dsh-tavern-helper-diagnostic').length <= 51)
})
