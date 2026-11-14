import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  normalizeVertexProject,
  patchPiAiGoogleSharedSource,
  patchPiAiGoogleVertexModelsJson,
  patchPiAiGoogleVertexSource,
  vertexProjectFromBaseUrl,
} from '../tavern-plugin/lib/domain/pi-ai-vertex-stream.js'

/**
 * The project a Vertex route points at, from the places the host already records it.
 * Vertex's global endpoint is a resource path (`/v1/projects/<project>/locations/global`),
 * so the catalog cannot describe it without one; Expression mode falls back to the
 * region bound to the API key, which answers 404 for every global-only model.
 * @param candidates - profile text (its `google-vertex` baseURL names the project), plus any
 *   explicit environment values, most specific first.
 */
export function resolveVertexProject({ profileText = '', env = process.env } = {}) {
  const explicit = [env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT]
  for (const value of explicit) {
    const project = normalizeVertexProject(value)
    if (project !== null) return project
  }
  return vertexProjectFromBaseUrl(profileText)
}

/** true when written, false when all files are already up to date, null when host shape is unknown. */
export function patchPiAiVertexStream({ sdkDirectory, project }) {
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
  const modelsResult = patchPiAiGoogleVertexModelsJson(modelsSource, { project })
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
