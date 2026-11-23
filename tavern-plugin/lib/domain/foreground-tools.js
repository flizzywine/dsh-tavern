export const READ_LOREBOOK_TOOL = 'read_lorebook'
export const LIST_LOREBOOK_TOOL = 'list_lorebook'
export const GREP_LOREBOOK_TOOL = 'grep_lorebook'
export const WORKBENCH_READ_LOREBOOK_TOOL = 'tavern_read_lorebook'
export const WORKBENCH_UPDATE_LOREBOOK_TOOL = 'tavern_update_lorebook'
export const WORLDBOOK_ACCESS_TOOLS = Object.freeze(['read', LIST_LOREBOOK_TOOL, GREP_LOREBOOK_TOOL, READ_LOREBOOK_TOOL])

const RENAMED_LOREBOOK_TOOLS = new Map([
  ['worldbook_list', LIST_LOREBOOK_TOOL],
  ['worldbook_grep', GREP_LOREBOOK_TOOL],
  ['tavern_read_worldbook', WORKBENCH_READ_LOREBOOK_TOOL],
  ['tavern_update_worldbook', WORKBENCH_UPDATE_LOREBOOK_TOOL]
])

export const lorebookToolName = name => RENAMED_LOREBOOK_TOOLS.get(name) ?? name

// Foreground tools a game may switch off individually. The settings panel shows
// this catalog; visibleTools filters the mode's list by the stored names.
export const FOREGROUND_TOOL_CATALOG = Object.freeze([
  { name: 'tavern_generate_body', label: '插件生成正文', description: '调用选定插件生成正文；需全局选择插件生成方式。', modes: ['story', 'script'] },
  { name: 'tavern_read_variables', label: '读取变量', description: '只读查询当前变量和结算状态。' },
  { name: 'skill', label: '加载 Skill', description: '按需加载写作或任务 Skill。' },
  { name: 'tavern_read_skill_reference', label: '读取 Skill 参考', description: '读取已加载 Skill 的参考文件。' },
  { name: READ_LOREBOOK_TOOL, label: '按关键词读取世界书', description: '按标题、别名或关键词直接读取本局世界书条目。', modes: ['story', 'script'] },
  { name: GREP_LOREBOOK_TOOL, label: '搜索世界书', description: '在本局世界书原文里全文搜索设定。', modes: ['story', 'script'] },
  { name: LIST_LOREBOOK_TOOL, label: '浏览世界书', description: '分页列出本局世界书条目标题。', modes: ['story', 'script'] },
  { name: 'read', label: '读取文件', description: '读取世界书、Skill 等资源的文件正文。', modes: ['story', 'script'] },
  { name: 'style_reference_submit', label: '文风联想', description: '前台记录本轮笔调参考；还需本局开启文风联想。', modes: ['story'] },
  { name: 'tavern_recall_history', label: '召回历史', description: '按关键词或轮次检索已压缩的历史正文。' },
  { name: 'web_search', label: '联网搜索', description: '联网查找资料；还需本局开启「联网搜索」。' },
  { name: 'web_fetch', label: '读取网页', description: '读取网页正文；需全局开启网页读取，且本局开启联网搜索。' },
  { name: 'tavern_read_script', label: '读取剧本', description: '读取剧本后续内容。', modes: ['script'] }
])

// Story submission tools are bound directly to global settings (`storyInputToolCall` /
// `storyOutputToolCall`) and never exposed or disabled via per-game foreground tool switches.
export const SETTINGS_BOUND_STORY_TOOLS = new Set(['submit_story', 'read_story_context'])

// Plugin tools are not in the static catalog, so these names are accepted as
// tool-name strings; a removed plugin's stale name is harmless.
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,120}$/

export function normalizeDisabledForegroundTools(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(name => typeof name === 'string' && TOOL_NAME.test(name) && !SETTINGS_BOUND_STORY_TOOLS.has(name))
    .map(lorebookToolName))].slice(0, 200)
}

/** The mode's tools, in catalog order, for the per-game settings panel. */
export function foregroundToolCatalog(mode) {
  return FOREGROUND_TOOL_CATALOG.filter(tool => !tool.modes || tool.modes.includes(mode))
}

export const NO_FOREGROUND_TOOLS_PROMPT = '<output_method>本轮直接输出正文，不要调用任何工具。已提供的人物卡、世界书和历史就是全部资料。</output_method>'
