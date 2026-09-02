import { createImageConfiguration } from './configuration.js'

export const IMAGE_MODULE_CONFIGURATION = 'scene-images/providers.json'
const fields = ['provider', 'openaiBaseURL', 'openaiModel', 'grokBaseURL', 'grokModel',
  'googleEndpoint', 'googleModel', 'seedreamBaseURL', 'seedreamModel',
  'dashscopeEndpoint', 'dashscopeModel', 'tavernChannels']
function configuration(value) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('生图配置损坏，请检查配置文件')
  return Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
}

/** In-process module. No Cordis registration, Studio route, tools or attachments.
 * Tavern supplies storage, credentials and (optionally) the legacy settings reader.
 * Existing credential references stay unchanged; plaintext keys are never persisted.
 */
export function createImageGenerationModule({ store, credentials, readLegacyConfiguration = async () => ({}), fetchImpl, generateImpl }) {
  async function read() {
    const saved = await store.readJson(IMAGE_MODULE_CONFIGURATION)
    return configuration(saved ?? await readLegacyConfiguration())
  }
  const { serial: _internalQueue, ...imageModule } = createImageConfiguration({ read,
    write: async patch => {
      const previous = await read()
      await store.updateJson(IMAGE_MODULE_CONFIGURATION, current => ({ ...configuration(current ?? previous), ...configuration(patch) }))
    },
    restore: previous => store.updateJson(IMAGE_MODULE_CONFIGURATION, () => configuration(previous)),
    credentials: {
      resolve: ref => credentials()?.resolve(ref),
      describe: ref => credentials()?.describe?.(ref),
      set: (ref, value) => {
        const target = credentials()
        if (typeof target?.set !== 'function') throw new Error('当前 DSH 不支持保存凭据')
        return target.set(ref, value)
      },
    }, fetchImpl, generateImpl,
  })
  return Object.freeze(imageModule)
}
