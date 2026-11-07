import {projectPackFigures} from '../../packages/dsh-asset-library/lib/pack-v2/service.js'
import resolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'

// Projection only: retain shared media, retire media owned solely by omitted figures.
export async function projectDshCard(card, packs, excludeFigures = []) {
  if (!Array.isArray(excludeFigures) || excludeFigures.some(id => typeof id !== 'string')) throw Object.assign(new Error('excludeFigures 必须是人物 ID 数组'), {code:'TAVERN_EXPORT_INVALID'})
  const excluded = new Set(excludeFigures), removedUris = new Set(), prefixes = []
  const {packs:projected, figures:rows} = await projectPackFigures(packs, excludeFigures)
  for (let index = 0; index < packs.length; index++) {
    const original = packs[index], {manifest, files} = projected[index]
    const from = 'embeded://assets/' + (original.sourceName || manifest.id) + '/', to = 'embeded://assets/' + manifest.id + '/'
    prefixes.push({from, to})
    for (const name of original.files.keys()) if (!files.has(name)) { removedUris.add(from + name); removedUris.add(to + name) }
  }
  const omittedName = name => {
    const found = resolution.resolveFigureName(rows, {name})
    return found.status === 'resolved' && excluded.has(found.ref.figureId)
  }
  const omittedRef = value => value && typeof value === 'object' && (excluded.has(value.figureId) || excluded.has(value.id) || omittedRef(value.figure) || omittedRef(value.ref))
  const prune = (value, roster = false) => {
    if (typeof value === 'string') {
      if (excluded.has(value) || removedUris.has(value) || roster && omittedName(value)) return undefined
      const prefix = prefixes.find(prefix => value.startsWith(prefix.from))
      return prefix ? prefix.to + value.slice(prefix.from.length) : value
    }
    if (!value || typeof value !== 'object') return value
    if (removedUris.has(value.uri) || omittedRef(value) || roster && typeof value.name === 'string' && omittedName(value.name)) return undefined
    if (Array.isArray(value)) return value.map(item => prune(item, roster)).filter(item => item !== undefined)
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (excluded.has(key) || roster && omittedName(key)) return []
      const next = prune(item, roster || /roster|cast|speakers|characters/i.test(key))
      return next === undefined ? [] : [[key, next]]
    }))
  }
  const document = prune(structuredClone(card))
  // Generated rosters may be stored as worldbook text. Remove only omitted roster lines,
  // not authored story prose or arbitrary unknown extension strings.
  const data = document.data || document
  for (const entry of data.character_book?.entries || []) if (/roster|名单|人物表/i.test(entry.comment || entry.name || '')) {
    entry.content = String(entry.content || '').split('\n').filter(line => ![...excluded].some(id => line.includes(id)) && !rows.some(row => excluded.has(row.ref.figureId) && omittedName(row.name) && line.includes(row.name))).join('\n')
    entry.keys = (entry.keys || []).filter(name => !omittedName(name))
  }
  return {card:document, packs:projected}
}

export function packArchiveEntries(pack) {
  const prefix = 'assets/' + pack.manifest.id + '/'
  return [{path:prefix + 'manifest.json', data:Buffer.from(JSON.stringify(pack.manifest))}, ...[...pack.files].map(([path, data]) => ({path:prefix + path, ...(data.file ? {file:data.file} : {data})}))]
}
