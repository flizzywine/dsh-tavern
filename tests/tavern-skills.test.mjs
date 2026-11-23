import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createFileSymlink } from './helpers/file-symlink.mjs'

import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'
import { createSkillGatedTools } from '../tavern-plugin/lib/domain/skill-gated-tools.js'
import { registerSkillTools } from '../tavern-plugin/lib/tools/skills.js'

async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-skills-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const user = path.join(root, 'user')
  const builtin = path.join(root, 'builtin')
  return { root, user, builtin, skills: createTavernSkillModule({ directory: user, builtInDirectory: builtin }) }
}

test('工作台能读取并修改前台专用用户 Skill，无需更改分配', async t => {
  const { builtin, skills } = await harness(t)
  const name = 'dialogue'
  const original = await skills.write({ name, purpose: 'writing', description: '争执场景', body: '初始写法', modelInvocable: false })
  await skills.edit({
    name,
    content: original.content.replace('初始写法', '库中现行写法'),
    references: [{ path: 'references/lesson.md', content: '现行参考' }]
  })
  await mkdir(path.join(builtin, 'example'), { recursive: true })
  await writeFile(path.join(builtin, 'example', 'SKILL.md'), original.content.replace('name: dialogue', 'name: example'))

  const registered = new Map()
  registerSkillTools({
    chatForSession: async id => id === 'card' ? { mode: 'card' } : null,
    skillRoleFor: async agent => agent.session.id,
    skillEnabledFor: async () => true,
    tavernSkills: skills,
    tools: { register: tool => registered.set(tool.name, tool) }
  })
  const call = (tool, args, role = 'card') => registered.get(tool).execute(args, { agent: { session: { id: role } } })
  const read = (args, role) => call('tavern_read_skill', args, role)
  const visible = createSkillGatedTools()
  assert.deepEqual(visible(['tavern_read_skill'], { id: 'card', events: [] }), [])
  for (const skill of ['create-skill', 'create-writing-skill']) {
    const event = { type: 'tool/result', data: { content: '<skill_content name="' + skill + '">' } }
    assert.deepEqual(visible(['tavern_read_skill', 'tavern_save_skill'], { id: skill, events: [event] }), ['tavern_read_skill', 'tavern_save_skill'])
  }

  assert.match((await read({})).content, /^- dialogue · writing · 争执场景$/)
  assert.match((await read({ name })).content, /库中现行写法[\s\S]*references\/lesson\.md\n现行参考/)
  await assert.rejects(read({ name: 'example' }), /未找到可编辑/)
  await assert.rejects(read({ name }, 'background'), /卡片工作台/)
  await assert.rejects(read({ name }, 'foreground'), /卡片工作台/)

  await call('tavern_save_skill', { name, description: '争执场景', body: '改好的写法', overwrite: true })
  const saved = await skills.read(name)
  assert.deepEqual(saved.agents, ['foreground'])
  assert.equal(saved.modelInvocable, false)
  assert.match((await read({ name })).content, /改好的写法[\s\S]*现行参考/)
})

test('参考文件独立于素材，覆盖保留引用，拒绝路径越界与符号链接', { skip: process.platform === 'win32' ? 'Requires symlinks, which Windows only allows with extra privileges' : false }, async t => {
  const { skills, root, user } = await harness(t)
  const source = path.join(root, 'teaching.md')
  await writeFile(source, '现成教学方法')
  await skills.write({ name: 'dialogue', purpose: 'writing', description: '争执场景', body: '按需读 references/lesson.md', references: [{ path: 'references/lesson.md', content: await readFile(source, 'utf8') }] })
  await rm(source)
  assert.equal(await skills.readReference('dialogue', 'references/lesson.md'), '现成教学方法')
  await skills.write({ name: 'dialogue', description: '新的边界', body: '读 references/lesson.md', overwrite: true })
  assert.equal(await skills.readReference('dialogue', 'references/lesson.md'), '现成教学方法')
  assert.deepEqual((await skills.read('dialogue')).agents, ['foreground'])
  await assert.rejects(skills.readReference('dialogue', 'references/../../secret.md'), /相对/)
  await t.test('拒绝指向外部文件的符号链接', async t => {
    await writeFile(source, '外部')
    if (!createFileSymlink(t, source, path.join(user, 'dialogue', 'references', 'external.md'))) return
    await assert.rejects(skills.readReference('dialogue', 'references/external.md'), /目录之外/)
  })
  await skills.remove('dialogue')
  assert.equal(await skills.read('dialogue'), null)
})

test('并发创建同名 Skill 只有一个成功，非法参考文件不损坏已有版本', async t => {
  const { skills } = await harness(t)
  const input = { name: 'same', description: '旧', body: '旧正文' }
  const results = await Promise.allSettled([skills.write(input), skills.write(input)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  await assert.rejects(skills.write({ ...input, body: '新', overwrite: true, references: [{ path: '../escape.md', content: '逃逸' }] }))
  assert.match((await skills.read('same')).content, /旧正文/)
})

test('导入 Skill：单个 SKILL.md 或文件夹压缩包，带参考文件，同名先确认再覆盖，内置 Skill 不可覆盖', async t => {
  const { skills, builtin } = await harness(t)
  const skill = (name, body = '按步骤写作') => '---\nname: ' + name + '\ndescription: "导入的 Skill"\nmetadata:\n  tavern:\n    purpose: writing\n---\n\n' + body + '\n'
  const single = await skills.importBundle({ files: { 'SKILL.md': skill('imported') } })
  assert.equal(single.skill.name, 'imported')
  assert.deepEqual((await skills.read('imported')).agents, ['foreground'])

  const folder = { 'pack/SKILL.md': skill('pack'), 'pack/references/style.md': '风格', 'pack/scripts/run.md': '忽略', 'pack/notes.md': '忽略' }
  const zipped = await skills.importBundle({ files: folder })
  assert.deepEqual(zipped.skipped.sort(), ['notes.md', 'scripts/run.md'])
  assert.deepEqual(await skills.referenceFiles('pack'), [{ path: 'references/style.md', content: '风格' }])

  assert.deepEqual(await skills.importBundle({ files: { 'SKILL.md': skill('imported', '新版本') } }), { conflict: true, name: 'imported' })
  assert.match((await skills.read('imported')).content, /按步骤写作/)
  await skills.importBundle({ files: { 'SKILL.md': skill('imported', '新版本') }, overwrite: true })
  assert.match((await skills.read('imported')).content, /新版本/)

  await mkdir(path.join(builtin, 'builtin-one'), { recursive: true })
  await writeFile(path.join(builtin, 'builtin-one', 'SKILL.md'), skill('builtin-one'))
  await assert.rejects(skills.importBundle({ files: { 'SKILL.md': skill('builtin-one') }, overwrite: true }), /内置 Skill 不可覆盖/)
  await assert.rejects(skills.importBundle({ files: { 'readme.md': 'x' } }), /没有找到 SKILL\.md/)
  await assert.rejects(skills.importBundle({ files: { 'SKILL.md': skill('Bad Name') } }), /只允许小写字母/)
  await assert.rejects(skills.importBundle({ files: { 'SKILL.md': '没有开头' } }), /缺少 ---/)
})

 test('文件被占用时正文与用途读取待恢复快照，重启后仍生效且覆盖时清除旧快照', async t => {
  const { createDurableFilePromotion } = await import('../tavern-plugin/lib/durable-file-promotion.js')
  const { rename } = await import('node:fs/promises')
  const { user, builtin } = await harness(t)
  let locked = false
  const files = createDurableFilePromotion({ platform: 'win32', sleep: async () => {}, rename: async (...args) => {
    if (locked) throw Object.assign(new Error('locked'), { code: 'EPERM' })
    return rename(...args)
  } })
  const options = { directory: user, builtInDirectory: builtin, files }
  const skills = createTavernSkillModule(options)
  const original = await skills.write({ name: 'example', description: 'test', body: 'Original body' })
  locked = true
  const content = original.content.replace('Original body', 'Edited body')
  assert.equal((await skills.edit({ name: 'example', content, references: [{ path: 'references/a.md', content: 'edited reference' }] })).content, content)
  assert.deepEqual((await skills.assign('example', ['foreground'])).agents, ['foreground'])
  const restarted = createTavernSkillModule({ directory: user, builtInDirectory: builtin })
  assert.equal((await restarted.read('example')).content, content)
  assert.deepEqual((await restarted.read('example')).agents, ['foreground'])
  assert.equal(await restarted.readReference('example', 'references/a.md'), 'edited reference')
  locked = false
  await skills.write({ name: 'example', description: 'test', body: 'Replacement body', overwrite: true })
  assert.match((await restarted.read('example')).content, /Replacement body/)
  assert.equal(await files.read(path.join(user, '.edits', 'example.json')), undefined)
})
