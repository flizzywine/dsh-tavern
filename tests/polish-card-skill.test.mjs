// 卡片工作台的 polish-card 带着前台精修审稿标准的副本；两边必须一致，改了 prompts/polish.md 要同步复制。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'

const root = new URL('../presets/tavern/skills/', import.meta.url)

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
