import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { createPromptCatalog, prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const names = [
  'story',
  'script-story',
  'candidate-story',
  'candidate-script',
  'posture-settlement',
  'card-editor',
  'card-extractor'
]

test('固定提示词从独立 Markdown 文件完整加载', () => {
  for (const name of names) assert.ok(prompt(name).length > 20, name + ' 提示词为空')
  assert.match(prompt('story'), /小说续写引擎/)
  assert.match(prompt('story'), /本轮演出指引/)
  assert.match(prompt('story'), /不是已经发生的剧情/)
  assert.match(prompt('story'), /不得直接沿用.*句式|不得.*直接拼接/)
  assert.doesNotMatch(prompt('story'), /指令原文可以改写、拆散、融入叙述/)
  assert.match(prompt('script-story'), /Guide ＞ 剧本 ＞ 世界一致性 ＞ 本轮演出指引/)
  assert.match(prompt('candidate-script'), /tavern_read_script/)
  assert.match(prompt('candidate-script'), /tavern_point_script/)
  assert.match(prompt('card-editor'), /目录＋按需读取/)
  assert.match(prompt('card-editor'), /按编号或关键词调用 tavern_read_worldbook/)
  assert.match(prompt('card-editor'), /全面审查世界书.*分批读取/s)
  assert.match(prompt('card-editor'), /条目编号、关键词或想检查的问题/)
  assert.throws(() => prompt('worldbook-selector'), /未知提示词/)
  assert.throws(() => prompt('missing'), /未知提示词/)
})

test('修改提示词文件后无需重启即可在下一次读取时生效', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-prompts-'))
  t.after(async function () { await rm(directory, { recursive: true, force: true }) })
  const file = path.join(directory, 'story.md')
  await writeFile(file, '第一版提示词', 'utf8')
  const readPrompt = createPromptCatalog(pathToFileURL(directory + path.sep))

  assert.equal(readPrompt('story'), '第一版提示词')
  await writeFile(file, '第二版提示词', 'utf8')
  assert.equal(readPrompt('story'), '第二版提示词')
})

test('业务模块不再内嵌固定角色提示词', async () => {
  const sources = await Promise.all([
    '../tavern-plugin/lib/domain/context-planner.js',
    '../tavern-plugin/lib/domain/candidate-generation.js',
    '../tavern-plugin/lib/index.js'
  ].map(function (path) { return readFile(new URL(path, import.meta.url), 'utf8') }))
  const source = sources.join('\n')
  assert.doesNotMatch(source, /你是小说续写引擎|你是剧情候选项生成器|你是剧本候选项生成器|你是世界书条目检索器|你是剧情姿势结算器/)
})
