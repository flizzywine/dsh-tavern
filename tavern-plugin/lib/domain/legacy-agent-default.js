// A Profile-private preset must not remain the default for every Profile.
// Inspect the raw user layer: the Tavern composition base intentionally stays tavern.
//
// 0.2.0-rc.2 适配（有意保留、不改行为）：0.2.0 移除了 `agent-presets` 这个 settings
// 命名空间（host 行 id 改成 agent-preset-registry，用户默认值改由该行 Config 的
// volatile 字段 selectedDefault 承载）。于是 settings.describe() 里找不到该 ns，
// 本函数返回 false —— 清理逻辑在 0.2.0 上是**无害的空转**：
//   • 旧档案里残留的 `agent-presets.default: tavern` 已无插件读取；
//   • 会话默认 preset 由 patch 行的 `default: tavern` 决定，不依赖该残留值。
// 不改成猜测 0.2.0 的新 ns/key：这条调用点没有 try/catch，猜错会让整个 dsh-tavern
// 激活失败（远重于一个失效的清理）。等宿主给出等价的“用户层默认 preset”读写接缝再改。
export async function clearLegacyTavernDefault(settings) {
  const descriptor = settings.describe().find(item => item.ns === 'agent-presets')
  if (descriptor?.user?.default !== 'tavern') return false
  await settings.mutate('agent-presets', [{ op: 'unset', path: ['default'] }], descriptor.revision)
  return true
}
