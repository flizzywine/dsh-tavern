import { isDeepStrictEqual } from 'node:util'

const settingsPath = 'tavern-extension-settings.json'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function settingsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件设置必须是 JSON 对象')
  return JSON.parse(JSON.stringify(value))
}

/** Profile-owned plugin namespaces, separate from DSH settings and chat history. */
export function createTavernExtensionSettings(profileData) {
  async function read() { return settingsObject(await profileData.readJson(settingsPath) ?? {}) }

  async function save(settings, expectedSettings) {
    const next = settingsObject(settings)
    const base = settingsObject(expectedSettings)
    const changed = [...new Set([...Object.keys(base), ...Object.keys(next)])].filter(key =>
      own(base, key) !== own(next, key) || !isDeepStrictEqual(base[key], next[key]))
    return await profileData.updateJson(settingsPath, current => {
      const merged = settingsObject(current ?? {})
      for (const key of changed) {
        const unchanged = own(merged, key) === own(base, key) && isDeepStrictEqual(merged[key], base[key])
        const alreadySaved = own(merged, key) === own(next, key) && isDeepStrictEqual(merged[key], next[key])
        if (!unchanged && !alreadySaved) throw new Error('插件设置已被其他窗口修改，请重新加载后重试: ' + key)
        if (own(next, key)) Object.defineProperty(merged, key, { value: next[key], enumerable: true, configurable: true, writable: true })
        else delete merged[key]
      }
      return merged
    })
  }

  return Object.freeze({ read, save })
}
