function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

import { normalizeResourcePath, resourceKind } from './file-resources.js'

const RESOURCE_KINDS = Object.freeze(['card', 'source', 'script'])

export function mentionedTavernResources(text) {
  const resources = []
  const pattern = /@\[([^\]\r\n]*)\]\(tavern-file:([^\s)]+)\)/g
  let match
  while ((match = pattern.exec(str(text))) !== null) {
    let path
    try { path = normalizeResourcePath(decodeURIComponent(match[2])) } catch { continue }
    const resource = { kind: resourceKind(path), path, label: str(match[1]).trim() || path }
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
