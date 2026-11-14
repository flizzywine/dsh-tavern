import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  normalizeVertexProject,
  patchPiAiGoogleSharedSource,
  patchPiAiGoogleVertexModelsJson,
  patchPiAiGoogleVertexSource,
  vertexGlobalBaseUrl,
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
  // The vertex adapter now carries its own thinking-level dispatch, so a shared-helper
  // shape this build does not recognise is no longer a reason to skip the whole patch —
  // that used to leave an older pi-ai sending `thinkingBudget` to Gemini 4.
  if (vertexResult.status === 'unmatched' || modelsResult.status === 'unmatched') {
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
  } else if (sharedResult.status === 'unmatched') {
    console.log('pi-ai 的 google-shared.js 与已知版本不同，跳过该处补丁；Vertex 适配器已自带 thinkingLevel 判定。')
  }
  if (modelsResult.status === 'applied') {
    writeFileSync(modelsFile, modelsResult.text)
    wrote = true
  }
  return wrote
}

/**
 * The Vertex API key this install already holds, so a host whose profile names no project
 * can still be repaired. Stored credentials win over the environment, matching the
 * adapter's own resolution order for a route that names `apiKeyEnv`.
 */
export function vertexApiKeyFrom({ env = process.env, credentialsText = '' } = {}) {
  // Both credential layouts are in the wild: block style (`key: value`) and the flow
  // mapping the tavern home writes (`{ key: value, ... }`, so a trailing comma).
  const stored = String(credentialsText).match(/^\s*GOOGLE_VERTEX_API_KEY:\s*["']?([A-Za-z0-9._-]+)["']?,?\s*$/m)
  if (stored) return stored[1]
  for (const name of ['GOOGLE_VERTEX_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'GOOGLE_API_KEY']) {
    const value = typeof env[name] === 'string' ? env[name].trim() : ''
    if (value) return value
  }
  return null
}

/**
 * The project behind an API key, read from Vertex's own answer: a key issued for a region
 * addresses `v1/publishers/google/models/<id>`, and the resulting 404 names the project it
 * resolved to (`projects/<project>/locations/<region>`). That is the only place a
 * key-only install can learn its project, and the catalog needs one to spell out
 * `locations/global`, which Gemini 3/4 live at exclusively.
 * @returns the project, or null when the request fails or answers nothing project-shaped.
 */
export async function discoverVertexProject({ apiKey, model = 'gemini-4-carbon', request = fetch, timeoutMs = 8000 } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key) return null
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`
  try {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    // The 404 quotes the resolved resource name between backticks or slashes, so the
    // project is matched with or without a leading separator.
    const match = text.match(/(?:^|[^A-Za-z0-9])projects\/([A-Za-z0-9.:-]+)\/locations\//)
    return match ? normalizeVertexProject(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Point a profile's `google-vertex` route at the same global endpoint the catalog now
 * carries. A route-level baseURL wins over the catalog, so a profile still holding
 * `locations/asia-southeast1` keeps the 404 no matter what the catalog says.
 *
 * Only a single-line, plainly written `baseURL:` is touched: a folded/quoted scalar or a
 * missing block is reported instead of edited, because rewriting it from text can corrupt
 * a YAML document this function cannot parse.
 * @returns `{ status, text }` where status is `current`, `repaired`, `absent`, `unsafe` or `project-less`.
 */
export function repairVertexRouteBaseUrl({ profileText, project }) {
  const text = String(profileText)
  const globalBaseUrl = vertexGlobalBaseUrl(project)
  if (globalBaseUrl === null) return { status: 'project-less', text }
  const lines = text.split('\n')
  const providerLine = lines.findIndex(line => /^\s*google-vertex:\s*$/.test(line))
  if (providerLine < 0) return { status: 'absent', text }
  const indent = lines[providerLine].match(/^\s*/)[0].length
  let end = lines.length
  for (let index = providerLine + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (line.match(/^\s*/)[0].length <= indent) {
      end = index
      break
    }
  }
  const baseLine = lines.slice(providerLine + 1, end).findIndex(line => /^\s*baseURL:\s*\S/.test(line))
  if (baseLine < 0) {
    const inserted = ' '.repeat(indent + 2) + `baseURL: ${globalBaseUrl}`
    lines.splice(providerLine + 1, 0, inserted)
    return { status: 'repaired', text: lines.join('\n') }
  }
  const index = providerLine + 1 + baseLine
  const line = lines[index]
  const raw = line.replace(/^\s*baseURL:\s*/, '').trim()
  const quoted = /^(['"])(.*)\1$/.exec(raw)
  const unfinished = raw.endsWith('\\') || (/^['"]/.test(raw) && (quoted === null || quoted[2].includes('\\')))
  if (unfinished) return { status: 'unsafe', text }
  const value = quoted ? quoted[2] : raw
  if (value === globalBaseUrl) return { status: 'current', text }
  lines[index] = line.replace(/^(\s*baseURL:\s*).*$/, `$1${globalBaseUrl}`)
  return { status: 'repaired', text: lines.join('\n') }
}
