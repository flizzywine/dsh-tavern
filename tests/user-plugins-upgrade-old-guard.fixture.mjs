// Tavern 自动生成，请勿修改：插件加载或启动出错时只记日志，不影响 DSH 启动。
import { rmSync, writeFileSync } from 'node:fs'
const record = status => { try { writeFileSync(new URL("./.tavern-status.json", import.meta.url), JSON.stringify({ ...status, at: new Date().toISOString() })) } catch {} }
const clearRestart = () => { try { rmSync(new URL("./.tavern-restart.json", import.meta.url), { force: true }) } catch {} }
const report = (stage, error) => {
  console.warn("[Tavern 插件] plugins/card-dsh-tavern-mod-dice-aaaaaaaaaaaa" + ' ' + stage + '失败：' + (error && error.stack || error))
  record({ ok: false, stage, message: String(error && error.message || error).slice(0, 500) })
}
let plugin = null
try {
  const mod = await import(new URL("./index.mjs", import.meta.url).href)
  const value = typeof mod.apply === 'function' ? mod : mod.default
  plugin = typeof value === 'function' ? { apply: value } : value && typeof value.apply === 'function' ? value : null
  if (!plugin) report('加载', new Error('入口没有导出 apply 函数'))
} catch (error) { report('加载', error) }
export const name = plugin && typeof plugin.name === 'string' && plugin.name ? plugin.name : "dsh-tavern-mod-dice"
export const inject = plugin ? plugin.inject : undefined
export const Config = plugin ? plugin.Config : undefined
export async function apply(ctx, config) {
  if (!plugin) return
  let child
  try {
    // Cordis owns registrations/effects in this child scope and unwinds them
    // on failure. The guard remains alive so one broken plugin cannot stop DSH.
    child = ctx.plugin({ name, apply: childContext => plugin.apply(childContext, config) })
    await child.await()
    record({ ok: true })
    clearRestart()
  } catch (error) {
    if (child) await child.dispose()
    report('启动', error)
  }
}
