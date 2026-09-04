import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = relative => readFile(new URL('../' + relative, import.meta.url), 'utf8')
const cardMode = await read('tavern-plugin/prompts/card-mode.md')
const editTask = await read('tavern-plugin/prompts/card-task-edit.md')
const extractTask = await read('tavern-plugin/prompts/card-task-extract.md')
const worldBookTask = await read('tavern-plugin/prompts/card-task-worldbook.md')
const presetTask = await read('tavern-plugin/prompts/card-task-preset.md')
const scriptTask = await read('tavern-plugin/prompts/card-task-script.md')
const advancedSkill = await read('presets/tavern/skills/tavern-advanced-capabilities/SKILL.md')
const mvuSkill = await read('presets/tavern/skills/tavern-card-to-mvu/SKILL.md')

test('卡片 Agent 可按任务自由组合基础工具，不把 Tavern 专用工具设为优先或权限边界', () => {
  assert.match(cardMode, /Shell、文件读写与编辑等基础工具可以自由组合/)
  assert.match(cardMode, /选择成本最低、最可靠的实现路径/)
  assert.doesNotMatch(cardMode, /专用工具是方便操作资源的优先路径/)
  assert.doesNotMatch(cardMode, /专用工具不能完成[\s\S]*才.*文件工具/)
  assert.doesNotMatch(cardMode, /先通过 `skill` 加载 `tavern-advanced-capabilities`/)
  assert.doesNotMatch(advancedSkill, /普通 Tavern 资源能由专用工具完成时，仍优先走专用工具/)
})

test('任务提示继承用户已有授权，不强制重复确认或禁止适合任务的整体读取', () => {
  for (const prompt of [editTask, extractTask, worldBookTask, presetTask, scriptTask]) {
    assert.doesNotMatch(prompt, /得到(?:我|用户)明确确认后/)
    assert.doesNotMatch(prompt, /不要一次读取(?:整张卡|全文|整本世界书|整个大型预设)/)
  }
  assert.match(cardMode, /用户已经明确要求创建或修改时，不重复索取同一授权/)
})

test('MVU 转换优先采用无损的批量文件操作，禁止逐块转录大型 JSON', () => {
  assert.match(mvuSkill, /大文件复制或批量变换优先使用 Shell 与脚本/)
  assert.match(mvuSkill, /禁止通过分块读取和分块插入来手工转录整份 JSON/)
  assert.match(mvuSkill, /复制后生成独立资源 ID/)
  assert.doesNotMatch(mvuSkill, /若工具只会修改当前卡/)
})

test('剧本任务不把现有界面路径描述成 Agent 的能力禁令', () => {
  assert.doesNotMatch(scriptTask, /绑定或解绑人物卡是剧本库中的手动操作，不通过 Agent 完成/)
})
