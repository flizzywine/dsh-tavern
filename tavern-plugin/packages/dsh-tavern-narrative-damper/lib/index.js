/**
 * 叙事阻尼器插件的宿主半：把面板的读写转发给宿主。
 *
 * 引擎（每轮生成前的裁定、后半段的 MVU 钳制）在宿主的关键路径上，设置与密钥也归宿主管：
 * 这里只做一层薄转发，读写都走 tavern.damperSettings（lib/domain/damper-settings.js），
 * 与宿主旧 RPC 共用同一份校验与凭据存储。密钥明文不出宿主，只回
 * { configured, source, keyName }。
 *
 * 宿主没有这套接口时（老版本），每次调用如实报错，面板自己显示「当前宿主不支持」。
 */
export const name = 'dsh-tavern-narrative-damper'
export const inject = ['tavern']

const SETTINGS_UNAVAILABLE = '当前宿主不支持叙事阻尼器设置接口，请更新 DSH Tavern'

function requireApi(tavern) {
  if (typeof tavern?.readDamperSettings !== 'function' || typeof tavern?.updateDamperSettings !== 'function') {
    throw Object.assign(new Error(SETTINGS_UNAVAILABLE), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
  }
  return tavern
}

export function apply(ctx) {
  const tavern = ctx?.tavern
  if (!tavern || typeof tavern.handle !== 'function') return undefined
  // Cordis 把 apply 的返回值当 effect：只返回清理函数，注册返回的 disposer 一并收好。
  const disposers = []
  const handle = (rpcName, fn) => {
    try {
      const dispose = tavern.handle(rpcName, fn)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      try { console.warn('[dsh-tavern-narrative-damper] 处理函数注册失败：' + rpcName, error && error.message) } catch {}
    }
  }

  // 面板打开时读一次：全局配置 + 凭据状态（不含明文）
  handle('narrative-damper:read', async () => requireApi(tavern).readDamperSettings())

  // 保存一处或多处设置（服务端照旧校验，非法值带 DAMPER_INVALID_CONFIG 回来）
  handle('narrative-damper:update', async ({ values } = {}) => requireApi(tavern).updateDamperSettings({ patch: values }))

  // 保存（value 为字符串）或清除（value 为 null）决策模型密钥；环境变量名会转成键名引用
  handle('narrative-damper:set-key', async ({ provider, value } = {}) => requireApi(tavern).setDamperKey({ provider, value }))

  // 用当前（或草稿）设置真发一次决策请求
  handle('narrative-damper:test', async ({ config } = {}) => requireApi(tavern).testDamperConnection({ config }))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch {}
    }
  }
}

export default { name, inject, apply }
