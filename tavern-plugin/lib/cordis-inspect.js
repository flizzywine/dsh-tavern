import { isDeepStrictEqual } from 'node:util'

export const inject = ['cordisInspect']
const INSTALLED = Symbol.for('dsh-tavern.cordis-inspect-shared.v1')
const FIRST_PARTY_METHODS = Object.freeze({
  Service: 'listService', Event: 'listEvents', Builtin: 'listBuiltins', Tool: 'listTools',
})

function isFirstPartyShape(manifest) {
  return Object.hasOwn(FIRST_PARTY_METHODS, manifest?.id)
    && manifest.methods?.length === 1
    && manifest.methods[0].name === FIRST_PARTY_METHODS[manifest.id]
}

// dsh-tool-cordis alpha.2 publishes process-global providers from each preset.
// Keep one registration and a lease per live mount. Queries use a live owner's
// context (especially Tool.listTools), never the context of a disposed preset.
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
