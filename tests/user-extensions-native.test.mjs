// Optional integration test against an installed DSH, without model/network calls.
// DSH_BOOT_MODULE=/path/to/dsh-app-boot/lib/index.js node --expose-internals --test tests/user-extensions-native.test.mjs
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'

test('真实 DSH 加载用户工具：首次调用、更新后冷启动、无效清单保留', { skip: !process.env.DSH_BOOT_MODULE }, async (t) => {
  const bootUrl = pathToFileURL(path.resolve(process.env.DSH_BOOT_MODULE))
  const { boot } = await import(bootUrl.href)
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-native-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const dataRoot = path.join(root, 'profile-data/tavern/data')
  const paths = await ensureUserExtensions(dataRoot)
  const code = `export const inject = ['tools'];
export function apply(ctx, config) {
  ctx.tools.register({
    name: 'user_echo', description: 'User persistent tool',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
    execute: async () => config.label,
  });
}\n`
  const manifest = '# 用户注释必须保留\n- id: user-echo\n  name: ./tools/echo.mjs\n  config:\n    label: 用户自创工具\n'
  await writeFile(path.join(paths.tools, 'echo.mjs'), code)
  await writeFile(paths.config, manifest)
  await mkdir(path.join(paths.skills, 'user-skill'), { recursive: true })
  const skillPath = path.join(paths.skills, 'user-skill/SKILL.md')
  await writeFile(skillPath, '# 用户 Skill\n')
  const preset = await readFile(new URL('../presets/tavern/agent.cordis.yml', import.meta.url), 'utf8')
  const include = preset.match(/- id: user-tools\n[\s\S]*?(?=\n- id:|$)/)?.[0]
  assert.ok(include)
  const systemPromptUrl = new URL('../../dsh-system-prompt/lib/index.js', bootUrl).href
  const toolsUrl = new URL('../../dsh-tools/lib/index.js', bootUrl).href
  for (const version of ['v1', 'v2']) {
    const app = path.join(root, 'apps', version)
    await mkdir(path.join(app, 'presets/tavern'), { recursive: true })
    await mkdir(path.join(app, 'tavern-plugin/lib/domain'), { recursive: true })
    await writeFile(path.join(app, 'tavern-plugin/package.json'), '{"type":"module"}')
    for (const file of ['user-tools.js', 'domain/user-extensions.js', 'domain/tavern-data.js', 'durable-file-promotion.js']) {
      await copyFile(new URL('../tavern-plugin/lib/' + file, import.meta.url), path.join(app, 'tavern-plugin/lib', file))
    }
    const config = path.join(app, 'presets/tavern/agent.cordis.yml')
    await writeFile(config, `- id: system-prompt\n  name: ${systemPromptUrl}\n- id: tools\n  name: ${toolsUrl}\n${include}\n`)
    await ensureUserExtensions(dataRoot)
    const ctx = await boot('tavern-user-tool-test', config)
    try {
      const tool = ctx.tools.get('user_echo')
      assert.ok(tool, 'user tool should be in the real DSH registry')
      assert.equal(await tool.execute({}), '用户自创工具')
    } finally { await ctx.fiber.dispose() }
    assert.equal(await readFile(paths.config, 'utf8'), manifest)
    assert.equal(await readFile(path.join(paths.tools, 'echo.mjs'), 'utf8'), code)
    assert.equal(await readFile(skillPath, 'utf8'), '# 用户 Skill\n')
  }
  await writeFile(paths.config, 'invalid: [')
  await ensureUserExtensions(dataRoot)
  await assert.rejects(boot('tavern-user-tool-test', path.join(root, 'apps/v2/presets/tavern/agent.cordis.yml')), /failed/)
  assert.equal(await readFile(paths.config, 'utf8'), 'invalid: [')
})
