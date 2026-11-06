import { isDeepStrictEqual } from 'node:util'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * Global rules are stored in the SillyTavern-compatible extension settings
 * (`tavern-extension-settings.json` → `regex`), the same array card scripts read
 * and write. Writes are compare-and-swap: `expected` is the array the caller
 * last read, so a script editing the list concurrently is never overwritten
 * silently.
 */
export function createTavernRegexSettings({ extensionSettings }) {
  async function readDocument() {
    const all = await extensionSettings.read()
    return { all, regexes: Array.isArray(all.regex) ? all.regex : [] }
  }

  async function read() {
    return clone((await readDocument()).regexes)
  }

  async function write(regexes, expected) {
    if (!Array.isArray(regexes)) throw new Error('正则列表无效')
    const { all, regexes: current } = await readDocument()
    if (expected !== undefined && !isDeepStrictEqual(current, expected)) {
      throw new Error('正则已被其他窗口修改，请刷新后重试')
    }
    const saved = await extensionSettings.save({ ...all, regex: regexes }, all)
    return Array.isArray(saved.regex) ? clone(saved.regex) : []
  }

  async function mutate(update) {
    if (typeof update !== 'function') throw new Error('正则更新函数无效')
    const { regexes } = await readDocument()
    const next = await update(clone(regexes))
    return await write(next, regexes)
  }

  return Object.freeze({ read, write, mutate })
}
