// 世界书条目与整本默认注入通道定义：
//
// 'auto'   — 由引擎根据内容自动决定：常驻静态条目进稳定前缀，会变或非常驻条目按规则召回或进尾部。
// 'prefix' — 固定到稳定前缀（会话系统提示），跳过关键词/冷却/语义筛选且不计预算；动态/可执行内容仍走动态路径。
// 'tail'   — 固定到每轮尾部（紧贴最新消息），跳过关键词/冷却/语义筛选，但仍计入 Token 预算。
//
// 值保存在条目的 `extensions.tavern_channel` 中（整本默认保存在文档根的 `extensions.tavern_channel`），
// 以便 SillyTavern 导入导出往返保留；视图将其暴露为 `channel`。
const str = value => value == null ? '' : String(value)

export const WORLD_BOOK_CHANNELS = Object.freeze(['auto', 'prefix', 'tail'])

/**
 * 规范化世界书注入通道取值，未知或空值回退为 `'auto'`。
 */
export function worldBookChannelValue(value) {
  const text = str(value)
  return WORLD_BOOK_CHANNELS.includes(text) ? text : 'auto'
}

/**
 * 读取条目的有效注入通道，兼容视图投影（`channel` / `tavernChannel`）与原始文档条目（`extensions.tavern_channel`）。
 */
export function worldBookChannel(entry) {
  const extensions = entry?.extensions
  const extensionChannel = extensions && typeof extensions === 'object' ? extensions.tavern_channel : undefined
  return worldBookChannelValue(entry?.channel ?? entry?.tavernChannel ?? extensionChannel)
}

/**
 * 读取整本世界书的默认注入通道，存于文档根的 `extensions.tavern_channel`
 *（同时兼容手写世界书根级的 `channel` 字段）。
 */
export function worldBookDefaultChannel(book) {
  const extensions = book?.extensions
  const extension = extensions && typeof extensions === 'object' ? extensions.tavern_channel : undefined
  return worldBookChannelValue(book?.channel ?? extension)
}
