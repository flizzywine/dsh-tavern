// 卡片工作台的 polish-card 带着前台精修审稿标准的副本；两边必须一致，改了 prompts/polish.md 要同步复制。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'

const root = new URL('../presets/tavern/skills/', import.meta.url)

test('polish-card 的审稿标准与前台精修 prompts/polish.md 的「审稿标准」一致', async () => {
  const prompt = (await readFile(new URL('../tavern-plugin/prompts/polish.md', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
  const section = prompt.slice(prompt.indexOf('# 审稿标准'), prompt.indexOf('# 怎么提交修改')).replace(/\n+$/, '\n')
  const copy = (await readFile(new URL('polish-card/references/review-standards.md', root), 'utf8')).replaceAll('\r\n', '\n')
  assert.ok(section.startsWith('# 审稿标准') && copy === section, '改了 prompts/polish.md 的审稿标准后，复制到 presets/tavern/skills/polish-card/references/review-standards.md')
})

test('polish-card 可由卡片工作台读取，引用资源齐全且默认可调用', async () => {
  const skills = createTavernSkillModule({ directory: fileURLToPath(new URL('../data/skills/', import.meta.url)), builtInDirectory: fileURLToPath(root) })
  const skill = await skills.read('polish-card')
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1])
  assert.equal(metadata.name, 'polish-card')
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 500)
  const references = [...skill.content.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)].map(match => match[1])
  assert.deepEqual(references, ['references/review-standards.md'])
  for (const relative of references) assert.ok((await readFile(new URL(relative, new URL('polish-card/', root)), 'utf8')).length > 0)
})
