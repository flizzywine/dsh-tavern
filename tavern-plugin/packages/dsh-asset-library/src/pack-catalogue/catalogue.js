// catalogue wire validation is an ingress boundary, not a pack validator.
import { createHash } from 'node:crypto'
import { check, validateUuid, parseJson } from '../asset-packs/common.js'
export const CATALOGUE_BYTES = 2 * 1024 ** 2
export const FEATURES = Object.freeze(['asset-pack-schema:1'])
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function httpsUrl(value) {
  check(typeof value === 'string' && value.length <= 2048, '$.url', 'HTTPS URL required')
  let url
  try { url = new URL(value) } catch { check(false, '$.url', 'Invalid URL') }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash, '$.url', 'Absolute HTTPS URL without credentials or fragment required')
  return url.href
}
const text = (v, max = 200) => check(typeof v === 'string' && v.length > 0 && v.length <= max, '$.text', 'Invalid catalogue text')
const object = (v, allowed, required = allowed) => {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v,k)), '$.catalogue', 'Unknown or missing catalogue field')
}
const array = (v, max) => check(Array.isArray(v) && v.length <= max, '$.catalogue', 'Catalogue array exceeds limit', 'LIMIT_EXCEEDED')
export function versionParts(value) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value) && value.length <= 100, '$.version', 'Stable SemVer required')
  return value.split('+')[0].split('.').map(BigInt)
}
export function compareVersions(a,b) { const x=versionParts(a), y=versionParts(b); for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1; return 0 }
function extensions(value) {
  if (value === undefined) return
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => /^[a-z][a-z0-9.-]*:[A-Za-z0-9._-]+$/.test(k)), '$.extensions', 'Namespaced extension keys required')
  check(Buffer.byteLength(JSON.stringify(value)) <= 16384, '$.extensions', 'Extension budget exceeded', 'LIMIT_EXCEEDED')
}
export function parseCatalogue(bytes) {
  check(bytes instanceof Uint8Array && bytes.length <= CATALOGUE_BYTES, '$.catalogue', 'Catalogue exceeds 2 MiB', 'LIMIT_EXCEEDED')
  const c = parseJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  object(c,['format','schemaVersion','id','title','updatedAt','packs','extensions'],['format','schemaVersion','id','title','updatedAt','packs'])
  check(c.format === 'dsh-pack-catalogue' && c.schemaVersion === 1, '$.schemaVersion', 'Unsupported catalogue version')
  text(c.id); text(c.title); text(c.updatedAt,64)
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(c.updatedAt) && Number.isFinite(Date.parse(c.updatedAt)), '$.updatedAt')
  array(c.packs,2000); extensions(c.extensions)
  const ids = new Set()
  for (const p of c.packs) {
    object(p,['id','title','version','size','preview','licence','credits','requires','sha256','downloads','extensions'],['id','title','version','size','licence','credits','requires','sha256','downloads'])
    validateUuid(p.id); check(!ids.has(p.id),'$.id','Duplicate catalogue UUID'); ids.add(p.id)
    text(p.title); versionParts(p.version)
    check(Number.isSafeInteger(p.size) && p.size > 0,'$.size')
    check(typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sha256),'$.sha256')
    if (p.preview !== undefined) httpsUrl(p.preview)
    object(p.licence,['id','url'],['id']); text(p.licence.id,100)
    check(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(p.licence.id),'$.licence.id')
    if (p.licence.id.startsWith('LicenseRef-')) check(!!p.licence.url,'$.licence.url','Custom licence needs a URL')
    if (p.licence.url !== undefined) httpsUrl(p.licence.url)
    array(p.credits,64); for (const credit of p.credits) { object(credit,['name','url'],['name']); text(credit.name); if(credit.url!==undefined) httpsUrl(credit.url) }
    array(p.requires,32); p.requires.forEach(v=>text(v,100))
    array(p.downloads,8); check(p.downloads.length > 0,'$.downloads')
    const downloads = new Set()
    for (const d of p.downloads) { object(d,['id','label','url']); text(d.id,100); text(d.label); httpsUrl(d.url); check(!downloads.has(d.id),'$.downloads','Duplicate download ID'); downloads.add(d.id) }
    extensions(p.extensions)
  }
  return c
}
export function compatibility(pack) { const unsupported=pack.requires.filter(v=>!FEATURES.includes(v)); return {supported:!unsupported.length,unsupported} }
