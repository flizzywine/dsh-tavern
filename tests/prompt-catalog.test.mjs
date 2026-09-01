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
  'story-compaction',
  'card-mode',
  'card-mode-greeting',
  'card-task-edit',
  'card-task-extract',
  'card-task-script',
  'card-task-worldbook',
  'card-task-preset',
  'card-task-debug-play'
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
  assert.throws(() => prompt('play-mode'), /未知提示词/)
  assert.match(prompt('story-compaction'), /剧情记录压缩器/)
  assert.match(prompt('story-compaction'), /不续写剧情/)
  assert.match(prompt('story-compaction'), /角色所知、玩家所知与客观事实/)
  assert.doesNotMatch(prompt('story-compaction'), /Files and Code|AI coding assistant/)
  assert.ok(prompt('card-mode').startsWith('You are a helpful software engineer assistant.\n\n'))
  assert.doesNotMatch(prompt('card-mode'), /你具备 DSH 极简模式/)
  assert.match(prompt('card-mode'), /都是同一个 Agent 的不同起始任务/)
  assert.doesNotMatch(prompt('card-mode'), /使用完成任务所需的最简单路径/)
  assert.doesNotMatch(prompt('card-mode'), /tavern_read_card_raw.*JSON Pointer/)
  assert.doesNotMatch(prompt('card-mode'), /破限方案库/)
  assert.doesNotMatch(prompt('card-mode'), /世界书可以使用 `tavern_read_worldbook` 和 `tavern_update_worldbook`/)
  assert.doesNotMatch(prompt('card-mode'), /预设可以使用 `tavern_read_preset` 和 `tavern_update_preset`/)
  assert.doesNotMatch(prompt('card-mode'), /tavern_read_source/)
  assert.doesNotMatch(prompt('card-mode'), /tavern_read_script/)
  assert.doesNotMatch(prompt('card-mode'), /当前工作目录是 Tavern 资源根目录/)
  assert.doesNotMatch(prompt('card-mode'), /str_replace_editor\.path.*绝对路径/)
  assert.match(prompt('card-mode'), /结构化 `@资源`.*不代表正文已经读取/)
  assert.match(prompt('card-mode'), /Tavern 专用工具.*优先路径，不是权限边界/)
  assert.match(prompt('card-mode'), /明确的创建或修改请求就是操作授权/)
  assert.match(prompt('card-mode'), /目标清楚.*不需要再次要求用户确认/)
  assert.match(prompt('card-mode'), /加载 `tavern-advanced-capabilities`/)
  assert.match(prompt('card-mode'), /直接创建、读取、修改、重命名、组合和验证/)
  assert.match(prompt('card-mode'), /新建独立世界书.*有效的 SillyTavern 世界书 JSON/s)
  assert.doesNotMatch(prompt('card-mode'), /修改已经保存并生效/)
  assert.match(prompt('card-mode'), /tavern_restore_card.*灾难性损坏后的原版恢复/s)
  assert.match(prompt('card-mode'), /整体覆盖当前工作版.*明确确认/s)
  assert.doesNotMatch(prompt('card-mode'), /tavern_read_worldbook/)
  assert.match(prompt('card-mode'), /游玩历史不得被卡片工作台修改/)
  assert.doesNotMatch(prompt('card-mode'), /Cordis 动态插件.*进程重启后消失/s)
  assert.doesNotMatch(prompt('card-mode'), /tools\.cordis\.yml/)
  assert.doesNotMatch(prompt('card-mode'), /绑定和解绑.*手动操作，不通过 Agent 完成/)
  assert.doesNotMatch(prompt('card-mode'), /只有用户明确要求创建或修改 Skill/)
  assert.doesNotMatch(prompt('card-mode'), /可修改字段：/)
  assert.doesNotMatch(prompt('candidate-story'), /后续剧本/)
  assert.match(prompt('candidate-story'), /结合当前正文分析剧情走向/)
  assert.match(prompt('card-mode-greeting'), /卡片工作台已就绪/)
  assert.match(prompt('card-mode-greeting'), /人物卡、预设、世界书和剧本分别由右侧对应资源库管理/)
  assert.doesNotMatch(prompt('card-mode-greeting'), /自定义 Files/)
  assert.match(prompt('card-task-edit'), /明确确认后再保存最小变更/)
  assert.match(prompt('card-task-extract'), /新开一个空白卡片工作台/)
  assert.match(prompt('card-task-script'), /修改剧本/)
  assert.match(prompt('card-task-script'), /不改动导入时保留的原始备份/)
  assert.match(prompt('card-task-worldbook'), /修改世界书/)
  assert.match(prompt('card-task-worldbook'), /确认/)
  assert.match(prompt('card-task-preset'), /修改预设/)
  assert.match(prompt('card-task-preset'), /不会应用|无法使用/)
  assert.match(prompt('card-task-debug-play'), /tavern_read_play_chat/)
  assert.match(prompt('card-task-debug-play'), /不要一开始加载正文、日志或其他层/)
  assert.match(prompt('card-task-debug-play'), /最新一轮只是默认入口，不是读取边界/)
  assert.match(prompt('card-task-debug-play'), /其他轮次或整场 conversation/)
  assert.match(prompt('card-task-debug-play'), /iframe 的实际 DOM/)
  assert.match(prompt('card-task-debug-play'), /不得自动修正人物卡/)
  assert.throws(() => prompt('card-task-bind-script'), /未知提示词/)
  assert.throws(() => prompt('worldbook-selector'), /未知提示词/)
  assert.throws(() => prompt('missing'), /未知提示词/)
})

test('修改提示词文件后无需重启即可在下一次读取时生效', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-prompts-'))
  t.after(async function () { await rm(directory, { recursive: true, force: true }) })
  const file = path.join(directory, 'card-mode-greeting.md')
  await writeFile(file, '第一版欢迎语', 'utf8')
  const readPrompt = createPromptCatalog(pathToFileURL(directory + path.sep))

  assert.equal(readPrompt('card-mode-greeting'), '第一版欢迎语')
  await writeFile(file, '第二版欢迎语', 'utf8')
  assert.equal(readPrompt('card-mode-greeting'), '第二版欢迎语')
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
