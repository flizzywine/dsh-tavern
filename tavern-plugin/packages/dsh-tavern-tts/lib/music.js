// 音乐生成, the ctx service 'musicGeneration' (types/index.d.ts MusicGeneration): a saved service whose kind is a music
// kind (params.js PROVIDER_KINDS, category 'music') generates with its adapter (MUSIC_ADAPTERS). The first such service
// with its key is the one used. Other plugins (the stage's 自动 BGM) ask through it and never see the key.
import { providerKind } from './providers/params.js'
import { createLyriaAdapter } from './providers/lyria.js'
import { loadSpend as defaultSpend } from './providers/spend.js'

export const MUSIC_ADAPTERS = Object.freeze({lyria:createLyriaAdapter})
export const isMusicKind = kind => providerKind(kind).category === 'music'

// providers() → the saved services; key(provider) → its API Key or undefined.
export function createMusicGeneration({providers, key, fetch = globalThis.fetch, loadSpend = defaultSpend}) {
  const adapters = Object.fromEntries(Object.entries(MUSIC_ADAPTERS).map(([kind, create]) => [kind, create({fetch})]))
  async function chosen() {
    for (const p of providers().filter(p => isMusicKind(p.kind) && adapters[p.kind])) {
      const secret = await key(p)
      if (secret) return {p, secret:{key:secret}, adapter:adapters[p.kind]}
    }
    return null
  }
  return Object.freeze({
    async available() { return !!await chosen() },
    // → {bytes, mimeType, model}; null when no service is set up or the request was cancelled first. A paid request passes
    // the spend guard first; a request the service refused (HTTP 4xx) gives its reservation back, any other failure keeps it
    // (the service may have billed it).
    async generate({prompt, signal, purpose = '生成背景音乐'}) {
      const use = await chosen()
      if (!use || signal?.aborted) return null
      const {p, secret, adapter} = use
      const spend = await loadSpend()
      const hold = await spend?.check({category:'music', purpose, channel:`${p.kind}:${p.id}:${p.config.model}`, estimatedUsd:adapter.estimateUsd(p)})
      try {
        return await adapter.generate(p, secret, {prompt, signal})
      } catch (error) {
        if (hold?.id && error.status >= 400 && error.status < 500) await spend.release(hold.id)
        throw error
      }
    },
  })
}
