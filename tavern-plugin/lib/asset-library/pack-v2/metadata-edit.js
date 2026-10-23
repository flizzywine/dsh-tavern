import {canonicalJson} from '../asset-packs/common.js'

const without = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)))
const entryFields = ['name', 'description', 'remark', 'enabled', 'recall', 'directorNote', 'aliases', 'category', 'tags', 'usage', 'volume']
function resources(manifest) {
  return {...without(manifest, ['name', 'description', 'assets']), assets:manifest.assets.map(asset => without(asset, entryFields))}
}
// Only these author fields can bypass media validation/publication. Resource,
// identity, schema and capability changes still use the full write validator.
export function isMetadataEdit(before, manifest) {
  return canonicalJson(resources(before.manifest)) === canonicalJson(resources(manifest))
}
