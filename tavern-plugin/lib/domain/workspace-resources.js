function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function resourceWorkspaceContext(value) {
  const root = str(value).trim()
  if (root === '') return ''
  return [
    '【当前 Tavern 资源工作区】',
    '- 资源根目录：' + JSON.stringify(root),
    '- 资源在 Tavern 界面、结构化引用和 Tavern 工具参数中仍使用 `materials/...`、`presets/...`、`cards/...` 等相对路径。',
    '- 调用 `str_replace_editor` 时，其 `path` 参数必须使用绝对路径：将上面的资源根目录与资源相对路径连接。',
    '- 不得把相对路径简单加 `/`，不得猜测 `/materials`、`/presets`、`/cards`；不得访问资源根目录之外的文件。',
    '- shell 工具默认位于当前资源工作区，可继续使用相对路径。'
  ].join('\n')
}

import { normalizeResourcePath, resourceKind } from './file-resources.js'

const RESOURCE_KINDS = Object.freeze(['card', 'preset', 'source', 'script', 'worldbook'])

export function mentionedTavernResources(text) {
  const resources = []
  const mentions = []
  const legacyPattern = /@\[([^\]\r\n]*)\]\(tavern-file:([^\s)]+)\)/g
  const worldBookPattern = /@\[([^\]\r\n]*)\]\(tavern-worldbook:([^\s)]+)\)/g
  const nativePattern = /@"([^"\r\n]+)"/g
  let match
  const input = str(text)
  while ((match = legacyPattern.exec(input)) !== null) {
    let decoded
    try { decoded = decodeURIComponent(match[2]) } catch { continue }
    mentions.push({ index: match.index, path: decoded, label: str(match[1]).trim() })
  }
  while ((match = worldBookPattern.exec(input)) !== null) {
    let decoded
    try { decoded = decodeURIComponent(match[2]) } catch { continue }
    mentions.push({ index: match.index, path: decoded, label: str(match[1]).trim(), kind: 'worldbook' })
  }
  while ((match = nativePattern.exec(input)) !== null) {
    mentions.push({ index: match.index, path: match[1], label: match[1].split('/').filter(Boolean).at(-1) || match[1] })
  }
  mentions.sort(function (a, b) { return a.index - b.index })
  for (const mention of mentions) {
    let path
    try { path = normalizeResourcePath(mention.path) } catch { continue }
    const resource = { kind: mention.kind || resourceKind(path), path, label: mention.label || path }
    if (resource.kind === 'worldbook' && resourceKind(path) !== 'worldbook' && resourceKind(path) !== 'card') continue
    if (!resources.some(function (item) { return item.kind === resource.kind && item.path === resource.path })) resources.push(resource)
  }
  return resources
}

export function rememberTavernResources(existing, text) {
  const resources = []
  for (const item of (Array.isArray(existing) ? existing : []).concat(mentionedTavernResources(text))) {
    if (item === null || typeof item !== 'object') continue
    const kind = str(item.kind)
    let path
    try {
      path = kind === 'worldbook' ? normalizeResourcePath(item.path) : normalizeResourcePath(item.path, kind)
      if (kind === 'worldbook' && resourceKind(path) !== 'worldbook' && resourceKind(path) !== 'card') continue
    } catch { continue }
    if (!RESOURCE_KINDS.includes(kind)) continue
    const resource = { kind, path, label: str(item.label).trim() || path }
    const previous = resources.find(function (entry) { return entry.kind === kind && entry.path === path })
    if (previous === undefined) resources.push(resource)
    else if (resource.label !== path) previous.label = resource.label
  }
  return resources
}

export { RESOURCE_KINDS }
