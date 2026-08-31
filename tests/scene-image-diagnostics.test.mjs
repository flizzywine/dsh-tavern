import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageDiagnostics, redactSceneDiagnostic } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'

function storage() {
  const values = new Map()
  return { values, async readJson(path) { return structuredClone(values.get(path)) }, async updateJson(path, update) { const value = await update(values.get(path)); values.set(path, structuredClone(value)); return value } }
}
const attempt = (n, stage = 'planning', status = 'running') => ({ requestId: 'request-' + n, targetKey: 'body-' + n, sessionId: 'parent', stage, status, createdAt: Date.now() - 10, details: { prompt: '画面' } })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')

test('attempt journal replaces snapshots without losing older attempts or stage events and survives a new reader', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  const first = attempt(1)
  await logs.record('chat', first)
  await logs.record('chat', { ...first, stage: 'generating' })
  await logs.record('chat', { ...first, stage: 'generating', status: 'failed', error: 'unconfirmed' })
  await logs.record('chat', attempt(2, 'completed', 'succeeded'))
  const result = await createSceneImageDiagnostics(disk).read('chat')
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.records[0].events.map(event => event.stage), ['planning', 'generating', 'generating'])
  assert.ok(result.records[0].stageDurationsMs.planning >= 0)
  assert.ok(result.records[0].durationMs >= 0)
  assert.equal(result.records[0].error, 'unconfirmed')
  assert.equal((await logs.read('other')).records.length, 0)
})

test('diagnostics redact known secrets, credentials, signed URLs and image bytes before persistence', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  const value = { ...attempt(1), details: { apiKey: 'key-content', prompt: 'plain known-token-value', nested: { password: 'pass-content' },
    address: 'https://user:password@host/image?signature=signed-query', headers: { authorization: 'Bearer auth-content' },
    picture: Buffer.from('IMAGE-BYTES'), base64: 'IMAGE-BASE64', uri: 'data:image/png;base64,OTHER-BYTES' } }
  await logs.record('chat', value, ['known-token-value'])
  const text = JSON.stringify([...disk.values.values()])
  for (const word of ['key-content', 'known-token-value', 'pass-content', 'signed-query', 'auth-content', 'IMAGE-BYTES', 'IMAGE-BASE64', 'OTHER-BYTES']) assert.ok(!text.includes(word), word)
  assert.match(text, /REDACTED/)
  assert.equal(redactSceneDiagnostic(new Uint8Array([1, 2])), '[image bytes omitted]')
})

test('journal bounds attempts and oversized workflows with explicit omissions', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  await logs.record('chat', { ...attempt(0), details: { workflow: 'x'.repeat(200000) } })
  assert.equal((await logs.read('chat')).records[0].truncated, true)
  for (let n = 1; n <= 105; n++) await logs.record('chat', attempt(n))
  const result = await logs.read('chat')
  assert.equal(result.records.length, 100)
  assert.equal(result.dropped, 6)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 2 * 1024 * 1024)
})

test('same log ZIP contains scene attempts and their native subagent without reading generated images', async () => {
  const disk = storage(), logs = createSceneImageDiagnostics(disk)
  await logs.record('chat', { ...attempt(1, 'completed', 'succeeded'), traceSessionId: 'image-child', details: { attachment: { attachmentId: 'generated' }, prompt: '雨中车站' } })
  const read = []
  const result = await createMvuDiagnosticExport({ sessionId: 'parent', store: createMvuDiagnosticStore(disk), sceneDiagnostics: await logs.read('chat'),
    persistence: { async readRaw(id) { read.push(id); return { content: JSON.stringify({ type: 'session', id }) } } },
    attachments: { readImage() { assert.fail('scene image bytes must not be included') } } })
  assert.deepEqual(read, ['parent', 'image-child'])
  const text = result.buffer.toString('utf8')
  assert.match(text, /scene-images\/diagnostics.json/)
  assert.match(text, /subagents\/image-child\/session.jsonl/)
  assert.match(text, /雨中车站/)
  assert.match(text, /分享前请检查隐私/)
})

test('provider observers report actual POST, download, IDs and timing but no auth or pixels; failures do not retry', async () => {
  const events = [], calls = []
  const input = { baseURL: 'https://host/v1', model: 'example', apiKey: 'plain-secret-key', prompt: 'single scene', onProviderRequest: async event => events.push(event) }
  await generateSceneImage(input, { validateDownload: async address => address, fetch: async (url, init) => {
    calls.push({ url, init })
    return init?.method === 'POST' ? Response.json({ data: [{ url: 'https://host/picture?signature=private-link' }] }, { headers: { 'x-request-id': 'remote-id' } }) : new Response(png)
  } })
  assert.equal(calls.length, 2)
  assert.deepEqual(events.map(event => event.phase), ['dispatch', 'response', 'dispatch', 'response'])
  assert.equal(events[0].body.prompt, 'single scene')
  assert.equal(events[1].providerRequestId, 'remote-id')
  assert.ok(events[1].durationMs >= 0)
  assert.doesNotMatch(JSON.stringify(events), /plain-secret-key|private-link|iVBORw/)
  let requests = 0
  await assert.rejects(generateSceneImage({ ...input, onProviderRequest() { throw Error('diagnostic disk full') } }, { fetch: async () => { requests++; return new Response('', { status: 503 }) } }), error => error.imageOutcome === 'unconfirmed')
  assert.equal(requests, 1)
})
