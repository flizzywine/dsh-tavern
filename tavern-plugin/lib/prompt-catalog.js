import { readFileSync } from 'node:fs'

export const SYSTEM_PROMPT_DEFINITIONS = Object.freeze([
  ['story', '正文 Agent 核心提示词', '控制普通游玩正文的续写规则。'],
  ['script-story', '剧本模式正文补充', '控制绑定剧本时追加给正文 Agent 的规则。'],
  ['candidate-story', '普通剧情候选项', '控制普通剧情候选项的数量、类型和输出格式。'],
  ['candidate-script', '剧本候选项', '控制剧本模式候选项及剧本推进规则。'],
  ['posture-settlement', '姿势状态结算', '控制后台姿势结算的 JSON 输出。'],
  ['story-compaction', '剧情记录压缩', '控制长对话压缩成剧情检查点的方式。'],
  ['play-mode', '游玩模式 Agent', '控制普通游玩前台 Agent 的基础工作方式。'],
  ['card-mode', '卡片工作台 Agent', '控制卡片工作台 Agent 的权限、工具与工作规则。'],
  ['card-mode-greeting', '卡片工作台欢迎语', '控制新建卡片工作台对话的开场内容。'],
  ['card-task-edit', '人物卡编辑任务', '控制“修改人物卡”任务的起始要求。'],
  ['card-task-extract', '人物卡抽取任务', '控制“从剧本抽取人物卡”任务的起始要求。'],
  ['card-task-script', '剧本编辑任务', '控制“修改剧本”任务的起始要求。'],
  ['card-task-worldbook', '世界书编辑任务', '控制“修改世界书”任务的起始要求。'],
  ['card-task-preset', '预设编辑任务', '控制“修改预设”任务的起始要求。'],
  ['card-task-debug-play', '游玩记录调试任务', '控制卡片 Agent 调试游玩记录时的读取边界。']
].map(function (item) { return Object.freeze({ name: item[0], label: item[1], description: item[2] }) }))

export const SYSTEM_PROMPT_NAMES = Object.freeze(SYSTEM_PROMPT_DEFINITIONS.map(function (item) { return item.name }))

const knownNames = new Set(SYSTEM_PROMPT_NAMES)

export function createPromptCatalog(directory = new URL('../prompts/', import.meta.url)) {
  return function promptFromFile(name) {
    if (!knownNames.has(name)) throw new Error('未知提示词: ' + String(name))
    const text = readFileSync(new URL(name + '.md', directory), 'utf8').trim()
    if (text === '') throw new Error('提示词文件不能为空: ' + name + '.md')
    return text
  }
}

export const prompt = createPromptCatalog()
