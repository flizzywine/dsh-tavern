import assert from 'node:assert/strict'
import test from 'node:test'
import { accessSync, cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { installHostSessionPatch } from '../tavern-plugin/lib/domain/host-session-patch.js'

// 宿主路径由环境变量给出；补丁不分版本，同一组用例对任何 DSH 版本都适用。
const runtime = process.env.TAVERN_DSH_RUNTIME || process.env.TAVERN_DSH_015_RUNTIME || '/tmp/tavern-session-patch-npm-015.jv9SRv'
const runtimeReady = (() => { try { accessSync(join(runtime, 'package.json')); return true } catch { return false } })()

// 0.2.1 exports the plugin's apply() at the top level, 0.2.0 as the default export.
const jsonlPlugin = loaded => typeof loaded.apply === 'function' ? loaded : loaded.default

// A runtime where only `copies` are real copies (free to edit) and every other
// package is a symlink to the original, so a test never duplicates the whole host.
async function overlayRuntime(copies) {
  const work = await mkdtemp(join(tmpdir(), 'tavern-overlay-runtime-'))
  cpSync(join(runtime, 'package.json'), join(work, 'package.json'))
  const link = (relative) => {
    const from = join(runtime, 'node_modules', relative)
    const to = join(work, 'node_modules', relative)
    if (copies.includes(relative)) cpSync(from, to, { recursive: true, dereference: true })
    else symlinkSync(from, to)
  }
  mkdirSync(join(work, 'node_modules'))
  for (const entry of readdirSync(join(runtime, 'node_modules'))) {
    if (!entry.startsWith('@')) { link(entry); continue }
    mkdirSync(join(work, 'node_modules', entry))
    for (const child of readdirSync(join(runtime, 'node_modules', entry))) link(entry + '/' + child)
  }
  return work
}

test('补丁允许替换，未打补丁的读取仍拒绝，锚点漂移时明确失败', { skip: !runtimeReady }, async () => {
  const hostRequire = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(hostRequire.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Session } = await load('@deepseek-ai/dsh-session')
  const Jsonl = jsonlPlugin(await load('@deepseek-ai/dsh-session-persistence-jsonl'))
  const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
  const root = await mkdtemp(join(tmpdir(), 'tavern-host-patch-'))
  const blocked = new Context()
  await blocked.plugin(Jsonl, { root: join(root, 'blocked'), compression: 'none' }).await()
  const open = await blocked.sessionPersistence.create({ id: 'held', version: 4, createdAt: 1, isSeeded: false, delegationDepth: 0, cwd: root })
  const refused = await installHostSessionPatch({ hostRequire, persistence: blocked.sessionPersistence, query: new SessionQueryEngine(blocked) })
  assert.equal(refused.status, 'failed')
  assert.match(refused.reason, /已经打开/)
  await open.close()
  await blocked.fiber.dispose()

  const ctx = new Context()
  await ctx.plugin(Jsonl, { root: join(root, 'ready'), compression: 'none' }).await()
  const query = new SessionQueryEngine(ctx)
  const drifted = await overlayRuntime(['@deepseek-ai/dsh-session'])
  const driftedRequire = createRequire(join(drifted, 'package.json'))
  const surfacePath = driftedRequire.resolve('@deepseek-ai/dsh-session/surface')
  writeFileSync(surfacePath, readFileSync(surfacePath, 'utf8').replace("event.type === 'assistant/message' && raw !== undefined", "event.type === 'assistant/message' && undefined !== raw"))
  const mismatched = await installHostSessionPatch({ hostRequire: driftedRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(mismatched.status, 'failed')
  assert.match(mismatched.reason, /补丁锚点已变化/)

  const installed = await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(installed.status, 'ready')
  assert.equal(await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query }), installed)

  const session = Session.create('expanded-probe', undefined, { id: 'expanded-probe', version: 4, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 })
  const assistant = text => ({ turn: 1, step: 1, stream: [], message: { id: 'body-' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'tavern-patch', model: 'fixture' } } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { id: 'system', role: 'system', content: [{ type: 'text', text: 'Stable prefix' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: 'Player input' }], source: { kind: 'user' }, turn: 1, step: 1 }, { surfaceOp: 'append' })
  const old = session.append('assistant/message', assistant('original'), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const edited = session.append('assistant/message', { ...assistant('edited'), turn: 2 }, { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const writer = await ctx.sessionPersistence.create(session.header)
  try { await writer.append(session.snapshotEvents()); await writer.flush() } finally { await writer.close() }
  const reader = await ctx.sessionPersistence.open(session.id, 'read')
  try {
    const restored = Session.fromRestore(session.id, (await reader.read()).events, reader.header, 0, 'detached')
    assert.equal(restored.deriveMessages().at(-1).content.find(part => part.type === 'text').text, 'edited')
  } finally { await reader.close() }

  function evaluate(source) {
    let exports
    vm.runInNewContext(source, { window: { __ModuleLoader__: { load({ factory }) {
      exports = factory(name => name === '@deepseek-ai/cordis' ? { Service: class {} } : name === '@deepseek-ai/dsh-api-gateway/client' ? { RemoteJournalStream: class {} } : {})
    } } } })
    return exports
  }
  const client = evaluate(await readFile(hostRequire.resolve('@deepseek-ai/dsh-api-session-controller/client'), 'utf8'))
  const patched = evaluate(installed.clientSource)
  const stream = new client.SessionEventStream({ session: { page: async () => ({ ok: true, value: { records: [{ type: 'event', event: edited }], hasMore: false } }) } }, { sessionId: session.id }, { publish() {}, failed() {} })
  await assert.rejects(() => stream.readPage({}, edited.seq), /cannot carry sourceEventSeqs/)
  client.SessionEventStream.prototype.readPage = patched.SessionEventStream.prototype.readPage
  assert.equal((await stream.readPage({}, edited.seq)).records[0].event.type, 'assistant/message')
  await ctx.fiber.dispose()
})

test('Session patch handshakes stay isolated across authenticated page requests', async t => {
  const hostRequire = createRequire(process.env.DSH_BOOT_MODULE || join(runtime, "package.json"))
  const load = name => import(pathToFileURL(hostRequire.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const Jsonl = jsonlPlugin(await load('@deepseek-ai/dsh-session-persistence-jsonl'))
  const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
  const root = await mkdtemp(join(tmpdir(), 'tavern-page-patch-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Jsonl, { root, compression: 'none' }).await()
  const query = new SessionQueryEngine(ctx)
  const installed = await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(installed.status, 'ready', installed.reason)
  t.after(() => installed.dispose())
  const pageA = 'a'.repeat(32), pageB = 'b'.repeat(32)
  const installedReport = { protocol: 1, installed: true }
  const denied = { protocol: 1, installed: false, reason: "missing browser contract" }
  assert.equal(installed.replacementAllowed(), false)
  await Promise.all([
    installed.runForPage(pageA, async () => {
      installed.confirmClient(installedReport)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(installed.replacementAllowed(), true)
      assert.equal(installed.view().clientReady, true)
    }),
    installed.runForPage(pageB, async () => {
      installed.confirmClient(denied)
      await Promise.resolve()
      assert.equal(installed.replacementAllowed(), false)
      assert.equal(installed.view().reason, denied.reason)
    }),
  ])
  assert.equal(installed.replacementAllowed(), true, "host-owned jobs keep working")
  assert.equal(installed.runForPage(undefined, () => installed.replacementAllowed()), false)
  installed.runForPage("invalid", () => installed.confirmClient(installedReport))
  assert.equal(installed.runForPage("invalid", () => installed.replacementAllowed()), false)
  installed.runForPage(pageA, () => installed.confirmClient(denied))
  assert.equal(installed.replacementAllowed(), false)
  assert.equal(installed.runForPage(pageA, () => installed.replacementAllowed()), false)
})

test('issue #74: patched persistence rewrites dynamic import("koffi") to a file URL', () => {
  // Mirror compile()'s specifier rewrite without booting the full host patch.
  const sample = 'async function win32(){ const k = (await import("koffi")).default; return k }\nexport default {}\n'
  const resolve = specifier => 'file:///resolved/' + specifier + '/index.js'
  let modified = sample
  modified = modified.replace(/\bfrom\s+"([^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(resolve(specifier)))
  modified = modified.replace(/\bimport\s*\(\s*"([^"]+)"\s*\)/g, (_, specifier) => 'import(' + JSON.stringify(resolve(specifier)) + ')')
  assert.doesNotMatch(modified, /\bimport\s*\(\s*["']koffi["']\s*\)/)
  assert.match(modified, /\bimport\("file:\/\/\/resolved\/koffi\/index\.js"\)/)
})

// DSHA 会改写部分宿主文件（这里按 0.1.5-rc2 的改法合成）。补丁不校验文件指纹，
// 只要锚点仍在、自检通过就能装上。
test('DSHA 改写过的宿主文件仍可安装补丁并完成替换', { skip: !runtimeReady }, async () => {
  const work = await overlayRuntime(['@deepseek-ai/dsh-session-format-v2-to-v3', '@deepseek-ai/dsh-session-persistence-jsonl'])
  const formatPath = join(work, 'node_modules/@deepseek-ai/dsh-session-format-v2-to-v3/lib/index.js')
  const jsonlPath = join(work, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')
  const format = readFileSync(formatPath, 'utf8')
  const stage = 'return new ReleasedV2ToV3Stage(input);'
  assert.equal(format.split(stage).length, 2)
  writeFileSync(formatPath, '/* DSHA_LEGACY_SESSION_V1 */\nimport { wrapDshaLegacyStage } from "dsha-session-compat";\n' + format.replace(stage, 'return wrapDshaLegacyStage(new ReleasedV2ToV3Stage(input), input, remapEvent);'))
  const jsonl = readFileSync(jsonlPath, 'utf8')
  const importLine = jsonl.match(/^import \{([^}]+)\} from "node:fs\/promises";/m)
  assert.ok(importLine)
  const fields = importLine[1].split(',').map(item => item.trim()).filter(item => item && item !== 'link')
  writeFileSync(jsonlPath, jsonl.replace(importLine[0],
    '/* DSHA_ATOMIC_PUBLISH_V1 */\nimport { publishSessionExclusive as link } from "dsha-runtime-fs";\nimport { ' + fields.join(', ') + ' } from "node:fs/promises";'))
  for (const [name, source] of [
    ['dsha-session-compat', 'export function wrapDshaLegacyStage(stage) { return stage }\n'],
    ['dsha-runtime-fs', 'import { link } from "node:fs/promises";\nexport const publishExclusive = link;\nexport function publishSessionExclusive(source, target) { return link(source, target) }\n'],
  ]) {
    mkdirSync(join(work, 'node_modules', name), { recursive: true })
    writeFileSync(join(work, 'node_modules', name, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.js' }))
    writeFileSync(join(work, 'node_modules', name, 'index.js'), source)
  }

  const hostRequire = createRequire(join(work, 'package.json'))
  const load = name => import(pathToFileURL(hostRequire.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Session } = await load('@deepseek-ai/dsh-session')
  const Jsonl = jsonlPlugin(await load('@deepseek-ai/dsh-session-persistence-jsonl'))
  const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
  const root = await mkdtemp(join(tmpdir(), 'tavern-dsha-host-'))
  const ctx = new Context()
  await ctx.plugin(Jsonl, { root: join(root, 'ready'), compression: 'none' }).await()
  const query = new SessionQueryEngine(ctx)
  const installed = await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(installed.status, 'ready', installed.reason)

  const session = Session.create('dsha-probe', undefined, { id: 'dsha-probe', version: 4, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 })
  const assistant = text => ({ turn: 1, step: 1, stream: [], message: { id: 'body-' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'tavern-patch', model: 'fixture' } } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { id: 'system', role: 'system', content: [{ type: 'text', text: 'Stable prefix' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: 'Player input' }], source: { kind: 'user' }, turn: 1, step: 1 }, { surfaceOp: 'append' })
  const old = session.append('assistant/message', assistant('original'), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('assistant/message', { ...assistant('edited'), turn: 2 }, { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const writer = await ctx.sessionPersistence.create(session.header)
  try { await writer.append(session.snapshotEvents()); await writer.flush() } finally { await writer.close() }
  const reader = await ctx.sessionPersistence.open(session.id, 'read')
  try {
    const restored = Session.fromRestore(session.id, (await reader.read()).events, reader.header, 0, 'detached')
    assert.equal(restored.deriveMessages().at(-1).content.find(part => part.type === 'text').text, 'edited')
  } finally { await reader.close() }
  await ctx.fiber.dispose()
})
