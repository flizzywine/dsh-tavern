function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

import { normalizeResourcePath, resourceKind } from './file-resources.js'

const RESOURCE_KINDS = Object.freeze(['card', 'source', 'script'])

export function mentionedTavernResources(text) {
  const resources = []
  const mentions = []
  const legacyPattern = /@\[([^\]\r\n]*)\]\(tavern-file:([^\s)]+)\)/g
  const nativePattern = /@"([^"\r\n]+)"/g
  let match
  const input = str(text)
  while ((match = legacyPattern.exec(input)) !== null) {
    let decoded
    try { decoded = decodeURIComponent(match[2]) } catch { continue }
    mentions.push({ index: match.index, path: decoded, label: str(match[1]).trim() })
  }
  while ((match = nativePattern.exec(input)) !== null) {
    mentions.push({ index: match.index, path: match[1], label: match[1].split('/').filter(Boolean).at(-1) || match[1] })
  }
  mentions.sort(function (a, b) { return a.index - b.index })
  for (const mention of mentions) {
    let path
    try { path = normalizeResourcePath(mention.path) } catch { continue }
    const resource = { kind: resourceKind(path), path, label: mention.label || path }
    if (!resources.some(function (item) { return item.path === resource.path })) resources.push(resource)
  }
  return resources
}

export function rememberTavernResources(existing, text) {
  const resources = []
  for (const item of (Array.isArray(existing) ? existing : []).concat(mentionedTavernResources(text))) {
    if (item === null || typeof item !== 'object') continue
    const kind = str(item.kind)
    let path
    try { path = normalizeResourcePath(item.path, kind) } catch { continue }
    if (!RESOURCE_KINDS.includes(kind)) continue
    const resource = { kind, path, label: str(item.label).trim() || path }
    const previous = resources.find(function (entry) { return entry.path === path })
    if (previous === undefined) resources.push(resource)
    else if (resource.label !== path) previous.label = resource.label
  }
  return resources
}

export { RESOURCE_KINDS }
