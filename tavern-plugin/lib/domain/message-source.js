// DSH 0.2.0（session format v4）取消了裸 `kind: 'plugin'` + `plugin` 字段的写法：
// 写入侧 dsh-session-format 的 source() 校验要求「producer-owned source kind」
// （kind 必须是非空字符串且不等于 'plugin'，否则报
// 「format v4 message requires a producer-owned source kind」）；历史 V3 行则由
// dsh-session-format-v3-to-v4 的 rewritePluginSource 推导成 `plugin:<name>`。
//
// Tavern 只写一种形态（`plugin:<name>`），读取侧同时兼容迁移前的旧行，避免
// 切换期间读写不一致导致识别不到自己注入的消息。

const PLUGIN_KIND_PREFIX = 'plugin:'

// 与 DSH v3→v4 的 RENAMED_PRODUCERS 保持一致：这些生产者换了名字。
const RENAMED_PRODUCERS = Object.freeze({
  '@deepseek-ai/dsh-system-prompt': 'runtime-context'
})

/** 与 DSH v3→v4 迁移一致地推导 producer kind。 */
export function producerKind(name, role) {
  if (name === '@deepseek-ai/dsh-system-prompt' && role === 'system') return 'system-prompt'
  const renamed = Object.prototype.hasOwnProperty.call(RENAMED_PRODUCERS, name) ? RENAMED_PRODUCERS[name] : undefined
  if (renamed !== undefined) return renamed
  return PLUGIN_KIND_PREFIX + name
}

/** 写入用：生产者自有的 message source。 */
export function producerSource(name, extra, role) {
  const source = { kind: producerKind(name, role) }
  return extra === undefined ? source : { ...source, ...extra }
}

/** 读出消息的生产者名；无法归属（user/model/system-prompt 等原生 kind）返回 ''。 */
export function sourceProducerName(source) {
  const kind = source === null || typeof source !== 'object' ? undefined : source.kind
  if (typeof kind !== 'string' || kind === '') return ''
  if (kind.startsWith(PLUGIN_KIND_PREFIX)) return kind.slice(PLUGIN_KIND_PREFIX.length)
  if (kind === 'plugin') return typeof source.plugin === 'string' ? source.plugin : ''
  return ''
}

/** 是否为插件注入的消息（含迁移前不带名字的旧行）。 */
export function isPluginSource(source) {
  const kind = source === null || typeof source !== 'object' ? undefined : source.kind
  if (kind === 'plugin') return true
  if (typeof kind !== 'string' || kind === '') return false
  return kind.startsWith(PLUGIN_KIND_PREFIX)
}

/** 是否由指定生产者写入。 */
export function isProducerSource(source, name) {
  return sourceProducerName(source) === name
}

/** DSH 原生 system-prompt 行：迁移前是插件包装，迁移后是自有 kind。 */
export function isSystemPromptSource(source) {
  const kind = source === null || typeof source !== 'object' ? undefined : source.kind
  if (kind === 'system-prompt') return true
  return kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt'
}
