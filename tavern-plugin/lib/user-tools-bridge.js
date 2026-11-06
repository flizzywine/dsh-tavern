import { pathToFileURL } from 'node:url'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { ensureUserExtensions } from './domain/user-extensions.js'

export const inject = ['loader']

// 0.2.0-rc.2 适配：DSH 0.2.0 的 agent preset 是 `@deepseek-ai/dsh-agent-preset` 声明行，
// 其 config.plugins 里的 `name` 以**声明行所在配置文件的目录**（profile 目录）为解析基准，
// 不再像 0.1.5 的目录扫描模型那样以 preset 目录为基准。因此本模块从 presets/tavern/
// user-tools-bridge/ 移入 tavern-plugin 包，由 preset 用裸包说明符
// `dsh-tavern-plugin/user-tools-bridge` 引用（profile 已依赖 dsh-tavern-plugin）。
// Keep this Loader source in its own module. Request/package inventories must
// not mistake the bridge for a second active dsh-tavern-plugin installation.
export async function apply(ctx) {
  const paths = await ensureUserExtensions(resolveTavernDataRoot())
  await ctx.plugin(ctx.loader.builtins.include, { path: pathToFileURL(paths.config).href })
}
