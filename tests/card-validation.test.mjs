import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCardText, validateCardFile } from '../tavern-plugin/lib/domain/card-validation.js'
import { validatePresetText } from '../tavern-plugin/lib/domain/resource-validation.js'
const check = value => validateCardText(JSON.stringify(value))

test('preset structure: syntax location, prompt and order shapes, regex compile; real-world variants pass', () => {
  const preset = value => validatePresetText(JSON.stringify(value, null, 2))
  assert.match(validatePresetText('{\n  "prompts": [\n    {"content": "秘密"},,\n  ]\n}').errors[0].message, /第 3 行/)
  assert.doesNotMatch(JSON.stringify(validatePresetText('{"a": "秘密正文"')), /秘密正文/)
  for (const value of [[], { prompts: {} }, { prompts: ['x'] }, { prompts: [{ content: 1 }] }, { prompts: [], prompt_order: [{ order: {} }] }, { prompts: [], prompt_order: [{ order: [{ enabled: true }] }] }, { prompts: [], extensions: { regex_scripts: [{ findRegex: '/(/g' }] } }]) {
    assert.equal(preset(value).valid, false, JSON.stringify(value))
  }
  const ok = preset({ prompts: [{ identifier: 'main', role: 'model', content: 'x', enabled: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }], extensions: { regex_scripts: [{ scriptName: 'r', findRegex: '/a+/g' }] } })
  assert.equal(ok.valid, true, JSON.stringify(ok.errors))
  assert.equal(preset({ temperature: 1 }).valid, true)
  assert.ok(preset({ temperature: 1 }).warnings.some(item => /prompts/.test(item.message)))
})

test('production tool reads disk through native DSH schema and rejects play-mode or escaped paths', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createFileResourceStore } = await import('../tavern-plugin/lib/domain/file-resources.js')
  const { registerCardReadingTools } = await import('../tavern-plugin/lib/tools/card-reading.js')
  const { createCardValidationCheck } = await import('../tavern-plugin/lib/tools/card-validation-check.js')
  const root = await mkdtemp(join(tmpdir(), 'tavern-validate-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createFileResourceStore({ dataRoot: root })
  await files.ensure()
  const path = 'cards/test.json'
  await writeFile(files.absolute(path), '<开局>')
  let tool, mode = 'card'
  registerCardReadingTools({
    tools: { register(value) { if (value.name === 'tavern_validate_card') tool = value } },
    chatForSession: async () => ({ mode, cardPath: path }),
    str: value => String(value || ''), fileResources: files,
    cardMemory: { recordValidation: async () => {} },
    checkCard: createCardValidationCheck({ cardMemory: { recordValidation: async () => {} }, fileResources: files })
  })
  const exec = { agent: { session: { id: 'test' } } }
  const broken = await tool.execute({}, exec)
  assert.equal(broken.valid, false)
  assert.ok(tool.output.render({}, broken))
  await writeFile(files.absolute(path), JSON.stringify({ name: '已修复' }))
  assert.equal((await tool.execute({}, exec)).valid, true)
  await assert.rejects(tool.execute({ path: '../private.json' }, exec))
  await writeFile(files.absolute('presets/p.json'), '{"prompts": [}')
  assert.match((await tool.execute({ path: 'presets/p.json' }, exec)).errors[0].message, /JSON 语法错误（第 1 行/)
  await writeFile(files.absolute('presets/p.json'), JSON.stringify({ prompts: [{ identifier: 'main', content: 'x' }] }))
  assert.equal((await tool.execute({ path: 'presets/p.json' }, exec)).valid, true)
  await writeFile(files.absolute('worldbooks/w.json'), JSON.stringify({ entries: { 0: { key: ['a'], content: 'x' } } }))
  assert.equal((await tool.execute({ path: 'worldbooks/w.json' }, exec)).valid, true)
  assert.equal((await tool.execute({ path: 'worldbooks/missing.json' }, exec)).valid, false)
  mode = 'story'
  await assert.rejects(tool.execute({}, exec), /卡片工作台/)
})
