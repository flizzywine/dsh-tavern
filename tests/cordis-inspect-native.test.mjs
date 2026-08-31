// Uses installed DSH packages, but never starts a web server or calls a model.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

test('真实 preset 共存及重新挂载：检查服务唯一，工具和 Tavern Skill 保留', { skip: !process.env.DSH_BOOT_MODULE }, async (t) => {
  const bootUrl = pathToFileURL(path.resolve(process.env.DSH_BOOT_MODULE))
  const { boot } = await import(bootUrl.href)
  const { createScope } = await import(new URL('../../dsh-scope/lib/index.js', bootUrl))
  const { mountPreset } = await import(new URL('../../dsh-agent-presets/lib/index.js', bootUrl))
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-cordis-mount-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(() => { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome })
  const source = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')
  const entry = id => source.match(new RegExp('- id: ' + id + '\\n[\\s\\S]*?(?=\\n- id:|$)'))[0]
  const presetDir = path.join(root, 'tavern')
  await mkdir(presetDir)
  await cp(new URL('../presets/tavern/skills/', import.meta.url), path.join(presetDir, 'skills'), { recursive: true })
  const presetPath = path.join(presetDir, 'agent.cordis.yml')
  await writeFile(presetPath, source.replace('../../tavern-plugin/lib/user-tools.js',
    new URL('../tavern-plugin/lib/user-tools.js', import.meta.url).href))
  const officialPath = path.join(root, 'official.cordis.yml')
  await writeFile(officialPath, entry('tool-cordis'))
  const patch = await readFile(new URL('../tavern-plugin/cordis.patch.yml', import.meta.url), 'utf8')
  const adapter = patch.includes('id: tavern-cordis-inspect')
    ? `- id: tavern-cordis-inspect\n  name: ${new URL('../tavern-plugin/lib/cordis-inspect.js', import.meta.url).href}\n` : ''
  const config = path.join(root, 'host.yml')
  await writeFile(config, ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-skill', 'dsh-cordis-host-runner',
    'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-commands']
    .map(name => `- id: ${name}\n  name: ${new URL('../../' + name + '/lib/index.js', bootUrl).href}\n`).join('') + adapter)
  const ctx = await boot('tavern-cordis-test', config)
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = bootUrl.href
  const scopes = []
  const mount = async (id, file) => {
    const key = { id }
    const scope = createScope(ctx, key)
    scopes.push(scope)
    await mountPreset(scope.ctx, { id, path: file })
    scope.ctx.get('tools').register({
      name: 'marker_' + id.replaceAll('-', '_'), description: 'scope marker',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
      execute: async () => id,
    })
    return { ...scope, key }
  }
  t.after(async () => { for (const scope of scopes) await scope.dispose() })
  const official = await mount('cordis', officialPath)
  const first = await mount('tavern', presetPath)
  const second = await mount('tavern-reloaded', presetPath)
  const verify = async scope => {
    const tool = ctx.tools.get('cordis_inspect_list', scope.key)
    assert.ok(tool)
    const { providers } = await tool.execute({}, {})
    for (const id of ['Service', 'Event', 'Builtin', 'Tool']) {
      assert.equal(providers.filter(provider => provider.id === id).length, 1)
    }
    assert.ok(ctx.tools.get('cordis_define', scope.key))
    assert.ok(ctx.tools.get('skill', scope.key))
    const liveTools = await ctx.cordisInspect.query('host', 'Tool', 'listTools', {}, scope.key, new AbortController().signal)
    assert.ok(liveTools.tools.some(tool => tool.name === 'marker_' + scope.key.id.replaceAll('-', '_')))
    assert.ok(!liveTools.tools.some(tool => tool.name === 'marker_cordis'))
    const skills = await ctx.skills.list({ cwd: root, scope: scope.key })
    assert.ok(skills.some(skill => skill.name === 'tavern-card-to-mvu'))
    assert.ok(skills.some(skill => skill.name === 'tavern-create-skill'))
  }
  await verify(first)
  await official.dispose()
  await first.dispose()
  await verify(second)
  await second.dispose()
  assert.equal(ctx.cordisInspect.list().length, 0)
  const fresh = await mount('tavern-new', presetPath)
  const reverseOrder = await mount('cordis', officialPath)
  await verify(fresh)
  await reverseOrder.dispose()
  await verify(fresh)
})
