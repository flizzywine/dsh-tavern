import { isDeepStrictEqual } from 'node:util'
import { assertPluginJson } from './tavern-chat-plugin-data.js'
const path = 'prompt-template-variables.json'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const globals = value => value?.global && typeof value.global === 'object' && !Array.isArray(value.global) ? value.global : {}
function validate(value) {
  assertPluginJson(value, '全局变量')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('全局变量必须是对象')
}
/** Shared Profile store; expected values merge changes atomically per variable. */
export function createPromptTemplateGlobalVariables(profileData) {
  return {
    async read() { return globals(await profileData.readJson(path)) },
    async save(variables, expected) {
      validate(variables)
      if (expected !== undefined) validate(expected)
      const next = structuredClone(variables), base = expected === undefined ? undefined : structuredClone(expected)
      const saved = await profileData.updateJson(path, current => {
        let merged = structuredClone(globals(current))
        if (base === undefined) merged = next
        else for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
          const equal = (a, b) => own(a, key) === own(b, key) && isDeepStrictEqual(a[key], b[key])
          if (equal(base, next)) continue
          if (!equal(merged, base) && !equal(merged, next)) {
            const error = new Error('全局变量已被其他对话修改，请重新加载后重试: ' + key)
            error.code = 'PROMPT_TEMPLATE_GLOBAL_CONFLICT'
            throw error
          }
          if (own(next, key)) Object.defineProperty(merged, key, {value: next[key], enumerable:true, writable:true, configurable:true})
          else delete merged[key]
        }
        if(isDeepStrictEqual(merged,globals(current)))return undefined
        return {...current, global:merged, updatedAt:Date.now()}
      })
      return globals(saved)
    }
  }
}
