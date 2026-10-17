import assert from 'node:assert/strict'
import test from 'node:test'
import { accessSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { installHostSessionPatch, PINNED_SHA256, SESSION_PATCH_VERSION } from '../tavern-plugin/lib/domain/host-session-patch.js'

// 0.2.0-rc.2 适配：本用例的宿主路径由环境变量给出（内容决定版本），断言跟随
// SESSION_PATCH_VERSION 与模块自己的引脚表，不再另抄一份 0.1.5-rc.2 的哈希/字符串。
const runtime = process.env.TAVERN_DSH_RUNTIME || process.env.TAVERN_DSH_015_RUNTIME || '/tmp/tavern-session-patch-npm-015.jv9SRv'
const runtimeReady = (() => { try { accessSync(join(runtime, 'package.json')); return true } catch { return false } })()

test(`${SESSION_PATCH_VERSION} 补丁允许替换，未打补丁的读取仍拒绝，官方文件不变`, { skip: !runtimeReady }, async () => {
  const hostRequire = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(hostRequire.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Session, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
  // 0.2.1-rc.2：JSONL 后端改成 cordis 插件模块（apply/Config），不再 default 导出实现类。
  const jsonlModule = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const Jsonl = jsonlModule.default ?? jsonlModule
  const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
  const root = await mkdtemp(join(tmpdir(), 'tavern-host-patch-'))
  const blocked = new Context()
  await blocked.plugin(Jsonl, { root: join(root, 'blocked'), compression: 'none' })
  const open = await blocked.sessionPersistence.create({ id: 'held', version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, delegationDepth: 0, cwd: root })
  const refused = await installHostSessionPatch({ hostRequire, persistence: blocked.sessionPersistence, query: new SessionQueryEngine(blocked) })
  assert.equal(refused.status, 'failed')
  assert.match(refused.reason, /已经打开/)
  await open.close()
  await blocked.fiber.dispose()

  const ctx = new Context()
  await ctx.plugin(Jsonl, { root: join(root, 'ready'), compression: 'none' })
  const query = new SessionQueryEngine(ctx)
  const mismatched = await installHostSessionPatch({
    hostRequire: { resolve: name => name.endsWith('/surface') ? fileURLToPath(import.meta.url) : hostRequire.resolve(name) },
    persistence: ctx.sessionPersistence,
    query,
  })
  assert.equal(mismatched.status, 'failed')
  assert.match(mismatched.reason, /补丁清单不一致/)

  const installed = await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(installed.status, 'ready')
  assert.equal(installed.replacementAllowed(), false)
  installed.confirmClient({ protocol: 1, installed: true })
  assert.equal(installed.replacementAllowed(), true)
  assert.equal(await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query }), installed)

  const session = Session.create('expanded-probe', undefined, { id: 'expanded-probe', version: SESSION_FORMAT_VERSION, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 })
  const assistant = (text, turn = 1, step = 1) => ({ turn, step, stream: [], message: { id: 'body-' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'tavern-patch', model: 'fixture' } } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { id: 'system', role: 'system', content: [{ type: 'text', text: 'Stable prefix' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: 'Player input' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const old = session.append('assistant/message', assistant('original'), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: 'completed' })
  // 0.2.1 适配（format v4）：surface 事件必须落在已开启的 turn/step 内，
  // 回退/重写要在新回合里写（tavern 侧对应 withSurfaceEditTurn）。
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const edited = session.append('assistant/message', assistant('edited', 2, 1), { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: 'completed' })
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
  const surfaceHash = createHash('sha256').update(readFileSync(hostRequire.resolve('@deepseek-ai/dsh-session/surface'))).digest('hex')
  assert.ok(PINNED_SHA256['@deepseek-ai/dsh-session/surface'].includes(surfaceHash),
    `宿主 surface 文件不在 ${SESSION_PATCH_VERSION} 引脚表内：${surfaceHash}`)
  await ctx.fiber.dispose()
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

// 0.2.0-rc.2 适配：本用例用 0.1.5-rc2 的 DSHA 打包改写合成样本，并断言那两个变体哈希
// （8e7cc1aa… / d387931d…）被引脚表接受。0.2.0 引脚表只含官方 npm 字节——目前没有
// 0.2.0 的 DSHA/Android 构建可供审计，合成样本也不再被接受，因此暂时显式跳过；
// 拿到 0.2.0 DSHA 构建后把它的两个变体哈希补进 host-session-patch.js 的 PINNED_SHA256，
// 再把这里的位置参数改成实际的运行时目录即可重新启用。
test('DSHA v0.1.5-rc2 改写的两份宿主文件仍可安装补丁并完成替换', { skip: !runtimeReady || 'DSHA 0.2.0 打包变体尚未审计，0.1.5-rc2 合成样本不再被 0.2.0 引脚接受' }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'tavern-dsha-runtime-'))
  cpSync(runtime, work, { recursive: true })
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
  assert.equal(createHash('sha256').update(readFileSync(formatPath)).digest('hex'),
    '8e7cc1aab2eef1099cbca390dd04c4a8ff3e6b3f64bd9e34e2357630b5e65af5')
  assert.equal(createHash('sha256').update(readFileSync(jsonlPath)).digest('hex'),
    'd387931d4ae848152411ec5f152064108b899bd9b5bd813c540afa2274703998')
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
  const { Session, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
  const jsonlModule = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const Jsonl = jsonlModule.default ?? jsonlModule
  const { SessionQueryEngine } = await load('@deepseek-ai/dsh-session-query')
  const root = await mkdtemp(join(tmpdir(), 'tavern-dsha-host-'))
  const ctx = new Context()
  await ctx.plugin(Jsonl, { root: join(root, 'ready'), compression: 'none' })
  const query = new SessionQueryEngine(ctx)
  const installed = await installHostSessionPatch({ hostRequire, persistence: ctx.sessionPersistence, query })
  assert.equal(installed.status, 'ready', installed.reason)
  installed.confirmClient({ protocol: 1, installed: true })
  const session = Session.create('dsha-probe', undefined, { id: 'dsha-probe', version: SESSION_FORMAT_VERSION, createdAt: Date.now(), isSeeded: false, delegationDepth: 0 })
  const assistant = text => ({ turn: 1, step: 1, stream: [], message: { id: 'body-' + text, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'tavern-patch', model: 'fixture' } } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { id: 'system', role: 'system', content: [{ type: 'text', text: 'Stable prefix' }], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: 'Player input' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const old = session.append('assistant/message', assistant('original'), { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: 'completed' })
  session.append('assistant/message', assistant('edited'), { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  const writer = await ctx.sessionPersistence.create(session.header)
  try { await writer.append(session.snapshotEvents()); await writer.flush() } finally { await writer.close() }
  const reader = await ctx.sessionPersistence.open(session.id, 'read')
  try {
    const restored = Session.fromRestore(session.id, (await reader.read()).events, reader.header, 0, 'detached')
    assert.equal(restored.deriveMessages().at(-1).content.find(part => part.type === 'text').text, 'edited')
  } finally { await reader.close() }
  await ctx.fiber.dispose()
})
