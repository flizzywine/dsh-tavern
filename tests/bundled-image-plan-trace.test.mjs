import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { createDiagnostics } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/diagnostics.js'

const source = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url))
const SECRET = 'sk-SUPERSECRET-123456'
const DEFINITIONS = { characters: [
  { id: 'm', name: '阿梅', match: 'A Mei', enabled: true, traits: { face: 'black long hair, dark brown eyes', negative: 'glasses, beard, short hair' }, outfits: [{ id: 'o1', name: '常服', upper: 'cream cardigan', lower: 'blue skirt', full: 'cream cardigan over a blue skirt', negative: 'jeans' }] },
  { id: 'mf', name: '阿梅（狐形）', match: 'A Mei fox form', enabled: true, traits: { face: 'silver-white long hair, pale ice-blue eyes, white fox ears' }, outfits: [] },
] }
const story = '雨夜，阿梅和他共撑一把伞。' + SECRET
const PLANNER_TEXT = '<image><regex>阿梅和他共撑一把伞</regex><title>雨夜</title><prompts>${"name":"A Mei","outfit":"常服"}$, A Mei and a man with short black hair share an umbrella in the rain</prompts></image>'

async function runtime(t, { diagnostics, definitions = DEFINITIONS, plannerText = PLANNER_TEXT, setup, text = story } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfy-test-'))
  await mkdir(join(root, 'lib')); await mkdir(join(root, 'workflows'))
  await cp(join(source, 'lib'), join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: 'test', entries: [] }))
  await writeFile(join(root, 'definitions.json'), JSON.stringify(definitions))
  if (diagnostics !== undefined) {
    if (diagnostics === 'broken') { await writeFile(join(root, 'diagnostics.json'), JSON.stringify({ enabled: true })); await writeFile(join(root, 'diagnostics'), 'not a dir') }
    else await writeFile(join(root, 'diagnostics.json'), JSON.stringify(diagnostics))
  }
  await writeFile(join(root, 'workflows', 'test.json'), JSON.stringify({
    format: 'dsh-tavern-comfy-v1', outputNode: '9',
    prompt: { '1': { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: '' } }, '2': { class_type: 'CLIPTextEncode', _meta: { title: '负面提示词' }, inputs: { text: 'lowres' } }, '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 28, positive: ['1', 0], negative: ['2', 0] } }, '9': { class_type: 'SaveImage', inputs: { images: ['3', 0] } } },
    bindings: { positive: [{ node: '1', input: 'text' }], negative: [{ node: '2', input: 'text' }], seed: [{ node: '3', input: 'seed' }] },
  }))
  if (setup) await setup(root)
  const routes = new Map(), disposes = [], bodies = [], llmCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/prompt') { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ prompt_id: 'comfy-' + bodies.length }), { status: 200 }) }
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 })
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    llm: { stream: args => { llmCalls.push(structuredClone({ ...args, signal: undefined })); return (async function* () { yield { type: 'text-delta', text: plannerText } })() } },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    inject(names, install) { if (names.every(name => this[name])) install(this) },
    effect(install) { const off = install(); if (typeof off === 'function') disposes.push(off); return off },
  }
  const { apply } = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?' + Math.random())
  apply(ctx, { plannerProvider: 'mock', plannerModel: 'mock', plannerCount: 1, comfyAuthToken: SECRET, negativeMode: 'plugin', promptMode: 'tags', injectWeight: 1 })
  t.after(async () => {
    for (const dispose of disposes.splice(0).reverse()) dispose()
    globalThis.fetch = originalFetch
    await delay(40)
    assert.ok(resolve(root).startsWith(resolve(tmpdir())) && basename(root).startsWith('dsh-comfy-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const request = (path, body) => new Promise((ok, fail) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    Object.assign(req, { method: 'POST', url: '/plugins/dsh-tavern-image/' + path, headers: { host: 'localhost', 'content-type': 'application/json' } })
    routes.get(req.url)(req, { headersSent: false, writeHead(s) { this.status = s }, end(b) { try { ok({ status: this.status, body: JSON.parse(String(b)) }) } catch (e) { fail(e) } } })
  })
  const plan = () => request('plan', { text, messageId: 'm1', sessionId: 'game-1', count: 1, manual: true })
  const events = async () => {
    const dir = join(root, 'diagnostics')
    try { if (!(await stat(dir)).isDirectory()) return [] } catch { return [] }
    const out = []
    for (const id of await readdir(dir)) out.push(...(await readFile(join(dir, id, 'events.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l)))
    return out
  }
  return { root, plan, request, bodies, llmCalls, events }
}


test('开着诊断时规划照常出图，并记录宏展开结果（以前引用不存在的变量，每张图都提交失败）', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, contentMode: 'full' } })
  const r = await f.plan(); await delay(30)
  assert.equal(r.status, 200)
  assert.equal(f.bodies.length, 1, 'image reaches ComfyUI')
  const ev = await f.events()
  const macro = ev.find(e => e.stage === 'macro-expansion')
  assert.match(JSON.stringify(macro.data.expanded), /cream cardigan/)
})

test('挂载句只差 Markdown 记号或换行时照样出图（以前逐字比对，整张图静默不画）', async t => {
  const f = await runtime(t, { text: '雨夜，**阿梅**和他\r\n共撑一把伞。' })
  const r = await f.plan(); await delay(30)
  assert.equal(r.status, 200)
  assert.equal(f.bodies.length, 1)
  assert.equal(r.body.characterWarnings, undefined)
})

test('ComfyUI 对照重绘只替换提示词，沿用原图种子和采样设置', async t => {
  const f = await runtime(t)
  const original = await f.plan()
  const jobId = original.body.plans[0].jobId
  const redrawn = await f.request('redraw', { jobId, prompt: 'a red umbrella', sameSeed: true })
  assert.equal(redrawn.status, 200)
  assert.equal(redrawn.body.ok, true)
  const [first, second] = f.bodies.map(entry => entry.prompt)
  assert.match(second['1'].inputs.text, /red umbrella/)
  assert.deepEqual(second['3'], first['3'])
})

test('诊断容量按多个追踪的 UTF-8 字节计量，作业终止后释放追踪', async t => {
  const f = await runtime(t, { diagnostics: { enabled: true, nextTraceOnly: false, maxTotalBytes: 900 } })
  const diag = createDiagnostics({ root: f.root })
  const first = diag.begin()
  const second = diag.begin()
  diag.bindJob('job', first, 0)
  diag.end(first)
  diag.recordJob('job', 'job-done', { note: '图'.repeat(100) })
  diag.finishJob('job')
  assert.equal(diag.status().active, 1)
  diag.record(second, 'too-large', { note: '图'.repeat(100) })
  diag.end(second)
  assert.equal(diag.status().active, 0)
  const events = await f.events()
  assert.ok(events.some(event => event.stage === 'job-done'))
  assert.ok(!events.some(event => event.stage === 'too-large'))
})
