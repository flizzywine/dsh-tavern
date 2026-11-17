import { DAMPER_KEY_REFS, validateNarrativeDamperConfig } from './narrative-damper.js'

/**
 * 叙事阻尼器的全局设置：读取、保存、密钥与连接测试的唯一实现。
 *
 * 设置界面已经搬到内置插件 dsh-tavern-narrative-damper 的面板里，插件通过
 * tavern.damperSettings 走这里；宿主旧 RPC 名保留给仍在用它们的调用方。两条入口共用
 * 同一份代码，键的存取与校验只有一处，不会分叉出互相矛盾的规则。
 *
 * 密钥只回 `{ configured, source, keyName }`：明文在宿主安全存储里，设置文件与
 * 任何返回给浏览器的结构都不含它。
 */
export function createDamperSettings({ readTavernSettings, updateTavernSettings, damper, str = value => String(value ?? '') } = {}) {
  if (typeof readTavernSettings !== 'function') throw new TypeError('叙事阻尼器设置需要 readTavernSettings')
  if (typeof updateTavernSettings !== 'function') throw new TypeError('叙事阻尼器设置需要 updateTavernSettings')

  // 没有安全存储（或服务未就绪）时如实回答「没配置」，不伪造一个已配置的状态。
  async function credentialOf(config, provider = config.provider, keyName = config.keyName) {
    if (!damper) return { configured: false, source: null, keyName }
    return damper.credentialStatus(provider, keyName)
  }

  return Object.freeze({
    async read() {
      const settings = await readTavernSettings()
      const config = settings.narrativeDamper
      return { config, credential: await credentialOf(config) }
    },

    async update(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('叙事阻尼器设置补丁无效')
      const updated = await updateTavernSettings({ narrativeDamper: patch })
      const config = updated.narrativeDamper
      return { config, credential: await credentialOf(config) }
    },

    async setKey({ provider, value } = {}) {
      if (!damper) throw new Error('叙事阻尼器服务未就绪')
      const id = str(provider)
      const next = value === undefined ? null : value
      if (!Object.hasOwn(DAMPER_KEY_REFS, id)) throw new Error('决策模型提供方无效')
      if (next !== null && (typeof next !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(next))) {
        throw new Error('API Key 须为不含空格或中文的可见 ASCII 字符')
      }
      // 环境变量引用是一种「键名」设置：保存键名、清掉同 provider 下已存的明文，两者不会互相盖住。
      let settings = await readTavernSettings()
      if (next !== null && await damper.isReference(next)) {
        settings = await updateTavernSettings({ narrativeDamper: { ...settings.narrativeDamper, provider: id, keyName: next } })
        await damper.setKey(id, null)
      } else {
        await damper.setKey(id, next)
      }
      const config = settings.narrativeDamper
      return { config, credential: await damper.credentialStatus(id, id === config.provider ? config.keyName : '') }
    },

    async test(config) {
      if (!damper) throw new Error('叙事阻尼器服务未就绪')
      const draft = config === undefined ? undefined : validateNarrativeDamperConfig(config)
      return damper.test(draft)
    }
  })
}
