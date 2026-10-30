// 写插件的 Skill 带着接口文档，Agent 只读得到 references/ 里的这些文件（原文在社区 Wiki）。
// SKILL.md 列出的文件都要在，references/ 里的文件也都要在 SKILL.md 里列出，否则 Agent 找不到或读不到。
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const skill = new URL('../presets/tavern/skills/tavern-plugin/', import.meta.url)

test('tavern-plugin Skill 列出的参考文件与 references/ 一一对应', async () => {
  const index = await readFile(new URL('SKILL.md', skill), 'utf8')
  const named = new Set([...index.matchAll(/`([\w-]+\.md)`/g)].map(match => match[1]))
  const files = new Set((await readdir(new URL('references/', skill))).filter(name => name.endsWith('.md')))
  assert.deepEqual([...named].filter(name => !files.has(name)), [], 'SKILL.md 提到但 references/ 里没有')
  assert.deepEqual([...files].filter(name => !named.has(name)), [], 'references/ 里有但 SKILL.md 没有列出')
})
