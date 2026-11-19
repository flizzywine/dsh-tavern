import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 设置 › 模型: a provider's API 地址 gets the 最近用过的网址 picker (⏲) of the voice backend, the same capability
// (dsh-tavern-tts endpoint-history.js, its page part published as globalThis[Symbol.for('dsh.endpointHistory')]).
// One insertion right after the provider card's Base URL input; without the voice backend the card is as shipped.
// Written against @deepseek-ai/dsh-client-ui-settings-models 0.2.1-rc.2 (DSH Desktop runtime 44.7.0). A host whose
// card no longer has this shape answers `unmatched`: the start and install logs say so, and
// tests/settings-models-endpoints-patch.test.mjs fails on the installed runtime, so an upgrade never drops it silently.
export const SETTINGS_MODELS_PATCHED_VERSION = '0.2.1-rc.2'
const MARKER = '/* dsh-tavern:endpoint-history */'
// the end of the card's Base URL input: its onChange writes the draft's baseURL, then the jsx call closes.
const BASE_URL_INPUT_END = /setField\("baseURL", event\.target\.value === "" \? void 0 : event\.target\.value\);\s*\}\s*\}\)/g
const PICKER = MARKER + ', globalThis[Symbol.for("dsh.endpointHistory")]?.ModelEndpoints ? (0, react_jsx_runtime.jsx)(globalThis[Symbol.for("dsh.endpointHistory")].ModelEndpoints, '
  + '{ provider: props.provider, label: props.displayName ?? props.provider, ns: namespace.ns, path: settingsPath, keyRef, '
  + 'url: stringAt(fallback, "baseURL") ?? props.defaultBaseURL, disabled, onSwitched: () => props.onClose(true) }) : null'

export function patchSettingsModelsSource(text) {
  if (text.includes(MARKER)) return { status: 'patched', text }
  const found = [...text.matchAll(BASE_URL_INPUT_END)]
  if (found.length !== 1) return { status: 'unmatched', text }
  const at = found[0].index + found[0][0].length
  return { status: 'applied', text: text.slice(0, at) + PICKER + text.slice(at) }
}

/**
 * Patch the host's 设置 › 模型 client in place: true when written, false when already patched, null when this DSH's
 * provider card no longer has the shape (left untouched; the caller says so).
 */
export function patchSettingsModelsEndpoints(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-settings-models') throw new Error('最近网址补丁仅适用于 dsh-client-ui-settings-models')
  const file = path.join(directory, 'lib', 'client.js')
  const result = patchSettingsModelsSource(readFileSync(file, 'utf8'))
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(file, result.text)
  return true
}
