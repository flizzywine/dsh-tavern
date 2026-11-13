// Foreground tools a game may switch off individually. The settings panel shows
// this catalog; visibleTools filters the mode's list by the stored names.
export const FOREGROUND_TOOL_CATALOG = Object.freeze([
  { name: 'tavern_generate_body', label: '插件生成正文', description: '调用选定插件生成正文；需全局选择插件生成方式。', modes: ['story', 'script'] },
  { name: 'tavern_read_variables', label: '读取变量', description: '只读查询当前变量和结算状态。' },
  { name: 'skill', label: '加载 Skill', description: '按需加载写作或任务 Skill。' },
  { name: 'tavern_read_skill_reference', label: '读取 Skill 参考', description: '读取已加载 Skill 的参考文件。' },
  // 世界书检索走真实文件，所以 worldbook_list/worldbook_grep 与宿主 read 是一组：
  // 只给 worldbook_* 而不列 read，玩家就没有完整开关，模型也能被提示拉动去读正文。
  { name: 'worldbook_grep', label: '搜索世界书', description: '在本局世界书原文里全文搜索设定。', modes: ['story', 'script'] },
  { name: 'worldbook_list', label: '浏览世界书', description: '分页浏览本局世界书目录和标题。', modes: ['story', 'script'] },
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
  return [...new Set(value.filter(name => typeof name === 'string' && TOOL_NAME.test(name) && !SETTINGS_BOUND_STORY_TOOLS.has(name)))].slice(0, 200)
}

/** The mode's tools, in catalog order, for the per-game settings panel. */
export function foregroundToolCatalog(mode) {
  return FOREGROUND_TOOL_CATALOG.filter(tool => !tool.modes || tool.modes.includes(mode))
}

export const NO_FOREGROUND_TOOLS_PROMPT = '<output_method>本轮直接输出正文，不要调用任何工具。已提供的人物卡、世界书和历史就是全部资料。</output_method>'
