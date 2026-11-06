import { isDeepStrictEqual } from 'node:util'

export const inject = ['cordisInspect']
const INSTALLED = Symbol.for('dsh-tavern.cordis-inspect-shared.v1')
// 0.2.0-rc.2 适配：dsh-tool-cordis 的一方 provider 表换成 Service/Event/Config/Tool
// —— `Builtin`/`listBuiltins` 已消失，新增 `Config`/`listConfigs`。表里缺项只会让
// isFirstPartyShape 返回 false（走原生 register 路径），不会报错，但会重新引入重复注册。
const FIRST_PARTY_METHODS = Object.freeze({
  Service: 'listService', Event: 'listEvents', Config: 'listConfigs', Tool: 'listTools',
})

function isFirstPartyShape(manifest) {
  return Object.hasOwn(FIRST_PARTY_METHODS, manifest?.id)
    && manifest.methods?.length === 1
    && manifest.methods[0].name === FIRST_PARTY_METHODS[manifest.id]
}

// dsh-tool-cordis alpha.2 publishes process-global providers from each preset.
// Keep one registration and a lease per live mount. Queries use a live owner's
// context (especially Tool.listTools), never the context of a disposed preset.
// 0.2.0-rc.2 适配：上游已把 provider 注册移到 host 平面（dsh-web-app 的
// cordis-inspect-providers 行），重复注册的动机消失；这里继续保留去重外壳，
// 它对 host 平面的一次性注册是无害的 no-op，也仍保护多 profile 混载的场景。
export function shareCordisInspectProviders(registry) {
  if (registry[INSTALLED]) return
  const register = registry.register.bind(registry)
  const shared = new Map()
  registry.register = function (provider) {
    if (!isFirstPartyShape(provider?.manifest)) return register(provider)
    const id = provider.manifest.id
    let slot = shared.get(id)
    if (slot && !isDeepStrictEqual(slot.manifest, provider.manifest)) {
      // Preserve the native conflict error for different implementations/contracts.
      return register(provider)
    }
    const lease = { provider }
    if (!slot) {
      slot = { manifest: structuredClone(provider.manifest), owners: new Set([lease]) }
      slot.dispose = register({
        ...provider,
        query(...args) {
          const owner = slot.owners.values().next().value
          if (!owner) throw new Error(`Cordis inspect provider "${id}" has no live owner`)
          return owner.provider.query(...args)
        },
      })
      shared.set(id, slot)
    } else slot.owners.add(lease)
    return () => {
      if (!slot.owners.delete(lease) || slot.owners.size > 0) return
      slot.dispose()
      shared.delete(id)
    }
  }
  // This adapter belongs to the host registry's lifetime, not one preset/plugin
  // reload. Reapplying the host plugin must not wrap register a second time.
  Object.defineProperty(registry, INSTALLED, { value: true })
}

export function apply(ctx) {
  shareCordisInspectProviders(ctx.cordisInspect)
}
