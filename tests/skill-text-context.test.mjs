import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSkillTextContext } from '../tavern-plugin/lib/domain/skill-text-context.js'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'
import { createTavernSkillProvider } from '../tavern-plugin/lib/domain/tavern-skill-provider.js'

const body = '---\r\nname: writing-probe\r\ndescription: 写作资料\r\nmetadata:\r\n  tavern:\r\n    purpose: writing\r\n---\r\n正文\uFEFF保留内部字符\r\n'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-bom-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'skills')
  const file = path.join(directory, 'writing-probe', 'SKILL.md')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, '\uFEFF' + body)
  const library = createTavernSkillModule({ directory, builtInDirectory: path.join(root, 'builtin') })
  return { root, directory, file, library }
}

test('原生文件 Provider 完整发现并读取 BOM 写作 Skill，更新和停用继续生效', {
  skip: !process.env.DSH_RUNTIME_ROOT && 'Set DSH_RUNTIME_ROOT to installed host node_modules'
}, async t => {
  const { FileSystemSkillProvider } = await import(pathToFileURL(path.join(process.env.DSH_RUNTIME_ROOT, '@deepseek-ai/dsh-skill-filesystem/lib/index.js')).href)
  const { root, directory, file, library } = await fixture(t)
  // Real disk I/O behind the public host filesystem contract; native discovery
  // and frontmatter parsing are the installed host implementation.
  const fs = {
    resolve: async displayPath => ({ displayPath }),
    processPath: target => target.displayPath,
    stat: async target => ({ type: (await stat(target.displayPath)).isFile() ? 'file' : 'directory' }),
    readText: (target, signal) => readFile(target.displayPath, { encoding: 'utf8', signal }),
    listDir: async target => Promise.all((await readdir(target.displayPath, { withFileTypes: true })).map(async entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', target: { displayPath: await realpath(path.join(target.displayPath, entry.name)) } })))
  }
  const warnings = []
  const ctx = { get: name => name === 'fs' ? fs : undefined, logger: { warn: message => warnings.push(message) } }
  const control = { signal: new AbortController().signal, invalidate() {} }
  const config = { includeDefaultRoots: false, customSkillDirs: [directory], watch: false }
  const raw = new FileSystemSkillProvider(ctx, control, config)
  const native = new FileSystemSkillProvider(createSkillTextContext(ctx), control, config)
  t.after(async () => { await raw.dispose(); await native.dispose() })
  const lookup = { cwd: root, scope: {} }
  assert.deepEqual(await raw.list(lookup), [], '确认旧宿主会拒绝 BOM')
  warnings.length = 0
  const provider = createTavernSkillProvider({ providers: [native], library, roleFor: async () => 'foreground' })
  const listed = await provider.list(lookup)
  assert.deepEqual(listed.candidates.map(item => item.name), ['writing-probe'])
  assert.equal((await provider.get(listed.candidates[0], lookup)).content, '正文\uFEFF保留内部字符')
  assert.deepEqual(warnings, [])
  assert.equal(await readFile(file, 'utf8'), '\uFEFF' + body)
  await writeFile(file, '\uFEFF' + body.replace('正文', '更新正文'))
  assert.match((await provider.get(listed.candidates[0], lookup)).content, /^更新正文/)
  await library.assign('writing-probe', [])
  assert.equal((await provider.list(lookup)).candidates.length, 0)
})
