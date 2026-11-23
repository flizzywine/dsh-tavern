import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patchPiAiAdapterSource, patchPiAiOpenAICompletionsSource } from '../tavern-plugin/lib/domain/pi-ai-nonstream.js'
import { patchPiAiOpenAIStoreSource } from '../tavern-plugin/lib/domain/pi-ai-openai-store.js'
import { patchPiAiGoogleStopReasonSource } from '../tavern-plugin/lib/domain/pi-ai-google-stop-reason.js'
import { patchPiAiGoogleToolModeSource } from '../tavern-plugin/lib/domain/pi-ai-google-tool-mode.js'

/** One pi-ai dist file through one source patch: true when written, false when already patched, null when this pi-ai shape is unknown. */
function patchPiAiFile(sdkDirectory, file, patchSource) {
  const apiFile = path.join(sdkDirectory, 'dist', 'api', file)
  let api
  try {
    if (JSON.parse(readFileSync(path.join(sdkDirectory, 'package.json'), 'utf8')).name !== '@earendil-works/pi-ai') return null
    api = readFileSync(apiFile, 'utf8')
  } catch { return null }
  const result = patchSource(api)
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(apiFile, result.text)
  return true
}

export const patchPiAiOpenAIStore = ({ sdkDirectory }) => patchPiAiFile(sdkDirectory, 'openai-completions.js', patchPiAiOpenAIStoreSource)
export const patchPiAiGoogleStopReason = ({ sdkDirectory }) => patchPiAiFile(sdkDirectory, 'google-shared.js', patchPiAiGoogleStopReasonSource)
export const patchPiAiGoogleToolMode = ({ sdkDirectory }) => patchPiAiFile(sdkDirectory, 'google-shared.js', patchPiAiGoogleToolModeSource)

/** true when written, false when both files are already patched, null when this host shape is unknown. */
export function patchPiAiNonStream({ adapterDirectory, sdkDirectory }) {
  const adapterFile = path.join(adapterDirectory, 'lib', 'index.js')
  const apiFile = path.join(sdkDirectory, 'dist', 'api', 'openai-completions.js')
  let adapter, api
  try {
    const adapterManifest = JSON.parse(readFileSync(path.join(adapterDirectory, 'package.json'), 'utf8'))
    const sdkManifest = JSON.parse(readFileSync(path.join(sdkDirectory, 'package.json'), 'utf8'))
    if (adapterManifest.name !== '@deepseek-ai/dsh-llm-pi-ai' || sdkManifest.name !== '@earendil-works/pi-ai') return null
    adapter = readFileSync(adapterFile, 'utf8')
    api = readFileSync(apiFile, 'utf8')
  } catch { return null }
  const adapterResult = patchPiAiAdapterSource(adapter)
  const apiResult = patchPiAiOpenAICompletionsSource(api)
  if (adapterResult.status === 'unmatched' || apiResult.status === 'unmatched') return null
  let wrote = false
  if (adapterResult.status === 'applied') {
    writeFileSync(adapterFile, adapterResult.text)
    wrote = true
  }
  if (apiResult.status === 'applied') {
    writeFileSync(apiFile, apiResult.text)
    wrote = true
  }
  return wrote
}
