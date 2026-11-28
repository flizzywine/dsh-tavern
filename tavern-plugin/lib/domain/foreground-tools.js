export const READ_LOREBOOK_TOOL = 'read_lorebook'
export const LIST_LOREBOOK_TOOL = 'list_lorebook'
export const GREP_LOREBOOK_TOOL = 'grep_lorebook'
export const QUERY_LOREBOOK_TOOL = 'query_lorebook'
export const USE_SKILL_TOOL = 'tavern_use_skill'
export const WORKBENCH_READ_LOREBOOK_TOOL = 'tavern_read_lorebook'
export const WORKBENCH_UPDATE_LOREBOOK_TOOL = 'tavern_update_lorebook'
export const WORKBENCH_RUNTIME_TOOLS = Object.freeze(['tavern_read_runtime_health', 'working_directory'])
export const WORLDBOOK_ACCESS_TOOLS = Object.freeze(['read', LIST_LOREBOOK_TOOL, GREP_LOREBOOK_TOOL, READ_LOREBOOK_TOOL])

const RENAMED_LOREBOOK_TOOLS = new Map([
  ['worldbook_list', LIST_LOREBOOK_TOOL],
  ['worldbook_grep', GREP_LOREBOOK_TOOL],
  ['tavern_read_worldbook', WORKBENCH_READ_LOREBOOK_TOOL],
  ['tavern_update_worldbook', WORKBENCH_UPDATE_LOREBOOK_TOOL]
])

export const lorebookToolName = name => RENAMED_LOREBOOK_TOOLS.get(name) ?? name

const LOREBOOK_ACTIONS = new Map([
  [READ_LOREBOOK_TOOL, 'read'], [GREP_LOREBOOK_TOOL, 'search'], [LIST_LOREBOOK_TOOL, 'list']
])

export function lorebookQueryAction(name, args) {
  if (name === QUERY_LOREBOOK_TOOL) return ['read', 'search', 'list'].includes(args?.action) ? args.action : undefined
  return LOREBOOK_ACTIONS.get(lorebookToolName(name))
}

// Foreground tools a game may switch off individually. The settings panel shows
// this catalog; visibleTools filters the mode's list by the stored names.
export const FOREGROUND_TOOL_CATALOG = Object.freeze([
  { name: 'tavern_generate_body', label: '插件生成正文', description: '调用选定插件生成正文；需全局选择插件生成方式。', modes: ['story', 'script'] },
  { name: 'tavern_read_variables', label: '读取变量', description: '只读查询当前变量和结算状态。' },
  { name: USE_SKILL_TOOL, label: '使用 Skill', description: '按需加载 Skill 正文或读取当前可用 Skill 的参考文件。', modes: ['story', 'script'] },
  { name: QUERY_LOREBOOK_TOOL, label: '查询世界书', description: '读取条目正文、搜索全文或分页浏览本局世界书标题。', modes: ['story', 'script'] },
  { name: 'tavern_recall_history', label: '召回历史', description: '按关键词或轮次检索已压缩的历史正文。' },
  { name: 'web_search', label: '联网搜索', description: '联网查找资料；还需本局开启「联网搜索」。' },
  { name: 'web_fetch', label: '读取网页', description: '读取网页正文；需宿主提供网页读取工具，且本局开启联网搜索。' },
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
    .map(name => {
      // Preserve a previous opt-out when either legacy Skill tool was disabled.
      if (name === 'skill' || name === 'tavern_read_skill_reference') return USE_SKILL_TOOL
      return lorebookQueryAction(name) ? QUERY_LOREBOOK_TOOL : lorebookToolName(name)
    }))].slice(0, 200)
}

/** The mode's tools, in catalog order, for the per-game settings panel. */
export function foregroundToolCatalog(mode) {
  return FOREGROUND_TOOL_CATALOG.filter(tool => !tool.modes || tool.modes.includes(mode))
}

export function pluginToolModeAllows(modes, mode) {
  return !modes || modes.includes(mode) || (mode !== 'card' && modes.includes('play'))
}

export const NO_FOREGROUND_TOOLS_PROMPT = '<output_method>本轮直接输出正文，不要调用任何工具。已提供的人物卡、世界书和历史就是全部资料。</output_method>'
