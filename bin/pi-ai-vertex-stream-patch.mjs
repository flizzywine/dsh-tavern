import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  patchPiAiGoogleSharedSource,
  patchPiAiGoogleVertexModelsJson,
  patchPiAiGoogleVertexSource,
} from '../tavern-plugin/lib/domain/pi-ai-vertex-stream.js'

/** true when written, false when all files are already up to date, null when host shape is unknown. */
export function patchPiAiVertexStream({ sdkDirectory }) {
  const vertexFile = path.join(sdkDirectory, 'dist', 'api', 'google-vertex.js')
  const sharedFile = path.join(sdkDirectory, 'dist', 'api', 'google-shared.js')
  const modelsFile = path.join(sdkDirectory, 'dist', 'providers', 'data', 'google-vertex.json')
  let vertexSource, sharedSource, modelsSource
  try {
    const sdkManifest = JSON.parse(readFileSync(path.join(sdkDirectory, 'package.json'), 'utf8'))
    if (sdkManifest.name !== '@earendil-works/pi-ai') return null
    vertexSource = readFileSync(vertexFile, 'utf8')
    sharedSource = readFileSync(sharedFile, 'utf8')
    modelsSource = readFileSync(modelsFile, 'utf8')
  } catch {
    return null
  }
  const vertexResult = patchPiAiGoogleVertexSource(vertexSource)
  const sharedResult = patchPiAiGoogleSharedSource(sharedSource)
  const modelsResult = patchPiAiGoogleVertexModelsJson(modelsSource)
  if (
    vertexResult.status === 'unmatched' ||
    sharedResult.status === 'unmatched' ||
    modelsResult.status === 'unmatched'
  ) {
    return null
  }
  let wrote = false
  if (vertexResult.status === 'applied') {
    writeFileSync(vertexFile, vertexResult.text)
    wrote = true
  }
  if (sharedResult.status === 'applied') {
    writeFileSync(sharedFile, sharedResult.text)
    wrote = true
  }
  if (modelsResult.status === 'applied') {
    writeFileSync(modelsFile, modelsResult.text)
    wrote = true
  }
  return wrote
}
