import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTavernSkillModule, normalizeTavernSkillName } from '../tavern-plugin/lib/domain/tavern-skills.js'

async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-skills-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const user = path.join(root, 'user')
  const builtin = path.join(root, 'builtin')
  return { root, user, builtin, skills: createTavernSkillModule({ directory: user, builtInDirectory: builtin }) }
}

test('Skill 名称拒绝路径与非 kebab-case 内容', () => {
  assert.equal(normalizeTavernSkillName('story-style'), 'story-style')
  assert.throws(() => normalizeTavernSkillName('../escape'), /名称只允许/)
  assert.throws(() => normalizeTavernSkillName('Story_Style'), /名称只允许/)
})

test('保存结构化 Skill 并按调用策略生成 frontmatter', async (t) => {
  const run = await harness(t)
  const saved = await run.skills.write({
    name: 'story-style',
    description: '提炼并应用故事文风。',
    body: '# 工作方式\n\n提炼可观察的语言规律。',
    userInvocable: false
  })

  const content = await readFile(saved.path, 'utf8')
  assert.match(content, /^---\nname: story-style\ndescription: "提炼并应用故事文风。"\nuser-invocable: false\n---/)
  assert.match(content, /# 工作方式/)
  assert.equal((await run.skills.read('story-style')).source, 'user')
})

test('同名用户 Skill 需要明确覆盖，内置 Skill 永远不可覆盖', async (t) => {
  const run = await harness(t)
  await run.skills.write({ name: 'custom-skill', description: '第一版', body: '第一版正文' })
  await assert.rejects(run.skills.write({ name: 'custom-skill', description: '第二版', body: '第二版正文' }), /明确覆盖/)
  const overwritten = await run.skills.write({ name: 'custom-skill', description: '第二版', body: '第二版正文', overwrite: true })
  assert.equal(overwritten.overwritten, true)
  assert.match(overwritten.content, /第二版正文/)

  const builtIn = path.join(run.builtin, 'reserved-skill')
  await mkdir(builtIn, { recursive: true })
  await writeFile(path.join(builtIn, 'SKILL.md'), 'builtin', 'utf8')
  await assert.rejects(run.skills.write({ name: 'reserved-skill', description: '覆盖', body: '覆盖' }), /内置 Skill 不可覆盖/)
})
