import assert from 'node:assert/strict'
import test from 'node:test'
import { zipText } from './fixtures/zip-text.mjs'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, redactDiagnostic, sanitizeModuleFailure, sanitizeMvuLoadDiagnostic } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

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
  assert.match(zipText(zip.buffer), /download-completed/)
  assert.match(zipText(zip.buffer), /verify-failed/)
  assert.doesNotMatch(zipText(zip.buffer), /PRIVATE_USER|DO_NOT_LOG/)
  assert.equal(sanitizeMvuLoadDiagnostic({ phase: 'invented', httpStatus: Infinity }), null)
  assert.ok(JSON.stringify(sanitizeMvuLoadDiagnostic({ phase: 'execution-failed', message: 'x'.repeat(1000000) })).length < 4200)
})

test('诊断记录持久化、限量，并移除凭据', async () => {
  const data = storage()
  const store = createMvuDiagnosticStore(data, { maxRecords: 3 })
  for (let n = 0; n < 5; n++) await store.record('s1', { stage: 'runtime', diagnosticId: 'op:1', n, apiKey: 'SECRET', message: 'Bearer SECRET https://host/x?token=SECRET' })
  await store.flush()
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
  const text = zipText(result.buffer)
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

test('诊断包包含界面按钮错误并脱敏', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), displayDiagnostics: { frames: [{ turn: 1, console: [{ level: 'error', args: [{ message: 'journey failed', token: 'PRIVATE_TOKEN' }] }] }] } })
  assert.match(zipText(result.buffer), /display\/diagnostics.json/)
  assert.match(zipText(result.buffer), /journey failed/)
  assert.doesNotMatch(zipText(result.buffer), /PRIVATE_TOKEN/)
})

test('diagnostic ZIP includes card scripts and bound worldbook with credential redaction', async () => {
  const result = await createMvuDiagnosticExport({ sessionId: 's', store: createMvuDiagnosticStore(storage()), cardDiagnostics: {
    version: 1, source: 'export-time', card: { name: '测试卡', first_mes: '开场' },
    extensions: { helperScripts: [{ id: 'broken-script', content: 'const broken = {;' }], apiKey: 'PRIVATE_CARD_KEY' },
    worldbook: { document: { entries: { 0: { content: '世界书测试内容' } } } }
  } })
  const text = zipText(result.buffer)
  assert.match(text, /card\/context.json/)
  assert.match(text, /const broken = \{;/)
  assert.match(text, /世界书测试内容/)
  assert.doesNotMatch(text, /PRIVATE_CARD_KEY/)
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
  assert.match(zipText(zip.buffer),/module-load/);
  assert.match(zipText(zip.buffer),/404/);
  assert.doesNotMatch(zipText(zip.buffer),/PRIVATE/);
});

test('诊断包包含本局预设与正则并脱敏，过大时仍可导出其他日志', async () => {
  const result = await createMvuDiagnosticExport({sessionId:'s',store:createMvuDiagnosticStore(storage()),presetDiagnostics:{
    preset:{presetName:'本局预设',apiKey:'PRIVATE_PRESET_KEY'},regex:{ordered:[{source:'preset',rule:{findRegex:'/x/g',replaceString:'<div>状态栏</div>'}}]}
  }})
  const text=zipText(result.buffer)
  assert.match(text,/preset\/context.json/)
  assert.match(text,/本局预设/)
  assert.match(text,/<div>状态栏<\/div>/)
  assert.doesNotMatch(text,/PRIVATE_PRESET_KEY/)
  const large=await createMvuDiagnosticExport({sessionId:'s',store:createMvuDiagnosticStore(storage()),presetDiagnostics:{preset:{content:'x'.repeat(8*1024*1024)}}})
  assert.match(zipText(large.buffer),/预设及正则资料超过 8 MiB/)
  assert.match(zipText(large.buffer),/mvu\/diagnostics.json/)
})
