import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'
import { registerWorldbookFileTools } from '../tavern-plugin/lib/tools/worldbook-files.js'
import { virtualHash, virtualScope } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'
import { installWorldbookSkillRead } from '../tavern-plugin/lib/domain/worldbook-skill-read.js'

// Opt-in official-source integration: native registry, Cordis, skill catalog,
// read definition and full tool dispatch/permission/schema/render pipeline.
// Session and working-directory data are synthetic; reference IO uses real files. No model calls.
test('native list, grep and read pipeline isolates files and background leases without worldbook Skills', {
  skip: !process.env.DSH_SOURCE_ROOT && !process.env.DSH_RUNTIME_ROOT && 'Set DSH_RUNTIME_ROOT to installed node_modules or DSH_SOURCE_ROOT to an official checkout',
}, async t => {
  const native = process.env.DSH_RUNTIME_ROOT
    ? await (await import('./helpers/native-skill-runtime.mjs')).nativeSkillRuntime(process.env.DSH_RUNTIME_ROOT)
    : await (await import('./helpers/native-skill-source.mjs')).nativeSkillSource(process.env.DSH_SOURCE_ROOT)
  t.after(native.close)
  const ctx = new native.Context()
  for (const plugin of [native.SkillRegistry, native.SystemPrompt, native.ToolsService, native.nativeToolExecutor].filter(Boolean)) {
    const fiber = ctx.plugin(plugin, {})
    await fiber
    t.after(() => fiber.dispose())
  }
  const signal = new AbortController().signal
  function agent(id) {
    const events = []
    return { session: { id, surface: { nodes: [] }, get seq() { return events.length }, eventAt: i => events[i],
      append(message) { const seq = events.length; events.push({ seq, type: 'user/message', data: message }); this.surface.nodes.push(seq) }
    } }
  }
  function state(id, title, content) {
    return { chat: { sessionId: id, id: id + '-chat', worldbookStrategy: 'native-skills' }, card: {}, worldBook: { view: { displayName: '测试书', entries: [
      { ref: 'book:entry-42', sourceUid: 42, sourcePath: 'worldbooks/test.json', title, primaryKeys: ['港口'], enabled: true, content }
    ] } } }
  }
  const a = agent('game-a'), b = agent('game-b'), background = agent('background')
  const states = new Map([[a, state(a.session.id, 'A 港口', 'SECRET BODY A')], [b, state(b.session.id, 'B 港口', 'SECRET BODY B')]])
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-worldbook-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const provider = createWorldbookFiles({ directory, load: async scope => states.get(scope) || null })
  registerWorldbookFileTools(ctx.tools, provider)
  t.after(ctx.skills.register({ name: 'core-skill', description: 'Core remains', content: 'CORE BODY', source: 'runtime' }))
  const workingDirectory = { ensure: async () => '/same-workspace' }
  const listeners = []
  native.skillTool.apply({ skills: ctx.skills, tools: ctx.tools, workingDirectory,
    on: (name, listener) => { assert.equal(name, 'agent/pre-step'); listeners.push(listener) } })
  let filesystemReads = 0
  native.readTool.applyReadTool({ tools: ctx.tools, systemPrompt: ctx.systemPrompt, workingDirectory,
    emit: (...args) => ctx.emit(...args),
    fs: {
      resolve: async path => ({ displayPath: path, targetKey: path }),
      stat: async target => { const s = await fs.stat(target.displayPath); return { type: 'file', size: s.size, version: String(s.mtimeMs) } },
      readText: async target => { filesystemReads++; return fs.readFile(target.displayPath, 'utf8') },
      processPath: target => target.displayPath,
    },
  }, { limit: 2000, maxLineLength: 2000, maxBytes: 50 * 1024, streamMinSize: 10 * 1024 * 1024 })
  t.after(installWorldbookSkillRead(ctx, provider, { virtualOnly: async () => true }))
  let callId = 0
  const execute = async (caller, name, args, customSignal = signal) => {
    const id = `native-${++callId}`
    if (typeof ctx.tools.selectExecutor === 'function') {
      const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }], agent: caller, signal: customSignal })
      return batch.results[0].result
    }
    return ctx.tools.execute({ agent: caller, signal: customSignal, callId: id, name, arguments: args })
  }
  const read = (caller, path, extras = {}) => execute(caller, 'read', { file_path: path, ...extras })
  const output = result => result.content.map(block => block.text || '').join('\n')
  function success(result) { assert.equal(result.isError, false, output(result)); return result.value }
  function failure(result) { assert.equal(result.isError, true, output(result)); return output(result) }
  async function discover(caller) {
    return (await provider.inspect({ scope: caller })).files[0].path
  }
  assert.equal(ctx.tools.get('worldbook_list', a), undefined)
  assert.equal(ctx.tools.get('worldbook_grep', a), undefined)
  const [pa, pb] = await Promise.all([discover(a), discover(b)])
  assert.notEqual(pa, pb)
  const found = await execute(a, 'grep_lorebook', { query: 'SECRET' })
  success(found)
  assert.equal(output(found), 'A 港口\nSECRET BODY A')
  const titleOnly = await execute(a, 'grep_lorebook', { query: '港口' })
  success(titleOnly)
  assert.equal(output(titleOnly), 'A 港口')
  assert.deepEqual(titleOnly.meta.lorebookGrepIds, [])
  const direct = async (caller, keyword) => {
    const result = await execute(caller, 'read_lorebook', { keyword })
    success(result)
    return result
  }
  const directBody = await direct(a, 'A 港口')
  assert.equal(output(directBody), 'SECRET BODY A')
  assert.equal(directBody.meta.worldbookRead.title, 'A 港口')
  assert.deepEqual(found.meta.lorebookGrepIds, [directBody.meta.worldbookRead.id])
  assert.equal(output(await direct(b, directBody.meta.worldbookRead.id)), '没有匹配的世界书条目。')
  assert.equal(filesystemReads, 0, 'no native file read is needed')
  const body = await read(a, pa, { offset: 3, limit: 1 })
  assert.deepEqual(success(body).lines, [{ number: 3, text: 'SECRET BODY A' }])
  assert.equal(filesystemReads, 1, 'actual native filesystem reader executes')
  assert.equal(body.meta.path, pa)
  for (const caller of [b, background, undefined]) failure(await read(caller, pa))
  failure(await execute(background, 'list_lorebook', {}))
  failure(await execute(background, 'read_lorebook', { keyword: '港口' }))
  assert.deepEqual((await ctx.skills.list()).map(item => item.name), ['core-skill'])
  const ordinary = path.join(directory, '..', path.basename(directory) + '-ordinary.txt')
  await fs.writeFile(ordinary, 'ORDINARY FILE')
  t.after(() => fs.rm(ordinary, { force: true }))
  failure(await read(a, ordinary))
  states.set(background, { ...states.get(a), authorizedSessionId: background.session.id })
  assert.equal(await discover(background), pa)
  const backgroundTitles = await execute(background, 'list_lorebook', {})
  success(backgroundTitles)
  assert.equal(output(backgroundTitles), 'A 港口')
  assert.equal(output(await direct(background, 'A 港口')), 'SECRET BODY A')
  success(await read(background, pa))
  failure(await read(background, pb))
  states.delete(background)
  failure(await execute(background, 'grep_lorebook', { query: 'SECRET' }))
  failure(await execute(background, 'read_lorebook', { keyword: 'A 港口' }))
  failure(await read(background, pa))
  states.get(a).worldBook.view.entries[0].content = 'UPDATED BODY\nUPDATED HOURS'
  failure(await read(a, pa))
  const updated = await discover(a)
  assert.notEqual(updated, pa)
  assert.match(output(await read(a, updated)), /UPDATED BODY/)
  const grouped = await execute(a, 'grep_lorebook', { query: 'UPDATED' })
  success(grouped)
  assert.equal(output(grouped), 'A 港口\nUPDATED BODY\nUPDATED HOURS')
  const page = await execute(a, 'grep_lorebook', { query: 'UPDATED', offset: 1, limit: 1 })
  success(page)
  assert.equal(output(page), 'A 港口\nUPDATED HOURS')
  states.get(a).chat.worldbookStrategy = 'legacy'
  assert.match(output(await read(a, updated)), /UPDATED BODY/)
  states.get(a).worldBook.view.entries.push({ ref: 'test:more', title: '薛姨妈', enabled: true, content: '第二条正文' })
  const list = async args => {
    const result = await execute(a, 'list_lorebook', args)
    success(result)
    return output(result)
  }
  assert.equal(await list({}), 'A 港口\n薛姨妈')
  assert.equal(await list({ offset: 1, limit: 1 }), '薛姨妈')
  const aborted = new AbortController(); aborted.abort()
  failure(await execute(b, 'grep_lorebook', { query: 'SECRET' }, aborted.signal))
})
