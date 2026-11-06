import { assertJson, check, object, jsonHash, compareCodePoints, array, shape, integer, unique, validateHash, relativePath, sha256 } from './common.js'
export { canonicalJson, parseJson, sha256, jsonHash } from './common.js'
// Machine state is not manifest data. Never silently strip arbitrary author fields.
export const LOCAL_ONLY_FIELDS = Object.freeze(['revision', 'globalEnabledPackIds', 'leases', 'cache', 'calibration', 'placement', 'authorization', 'exportedAt'])
export function contentHashInput(manifest) {
  assertJson(manifest); check(object(manifest), '$')
  for (const key of LOCAL_ONLY_FIELDS) check(!Object.hasOwn(manifest, key), '$.' + key, 'Machine state is not portable', 'UNKNOWN_FIELD')
  const { contentHash, ...portable } = manifest
  return portable
}
export const computeContentHash = manifest => jsonHash(contentHashInput(manifest))
export function validateFiles(files, path = '$.files') {
  array(files, path)
  for (const [i, file] of files.entries()) {
    const p = `${path}[${i}]`
    shape(file, ['path', 'size', 'sha256'], ['path', 'size', 'sha256'], p)
    relativePath(file.path, p + '.path'); integer(file.size, p + '.size'); validateHash(file.sha256, p + '.sha256')
  }
  unique(files.map(file => file.path.toLowerCase()), path)
  const entries = new Set(files.map(file => file.path.toLowerCase())), spelling = new Map()
  for (const file of files) {
    const parts = file.path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), folded = prefix.toLowerCase()
      check(!spelling.has(folded) || spelling.get(folded) === prefix, path, 'Case-colliding path', 'INVALID_PATH')
      check(i === parts.length || !entries.has(folded), path, 'File/directory path collision', 'INVALID_PATH')
      spelling.set(folded, prefix)
    }
  }
  return files
}
export function computeBundleHash(files) {
  validateFiles(files)
  return jsonHash([...files].sort((a, b) => compareCodePoints(a.path, b.path)))
}
// Input is an exact file map excluding root manifest; callers own all I/O.
export async function verifyPackFiles(manifest, files) {
  validateFiles(manifest.files)
  check(files instanceof Map && files.size === manifest.files.length, '$.files', 'File closure mismatch', 'FILE_CLOSURE_MISMATCH')
  for (const file of manifest.files) {
    const bytes = files.get(file.path)
    check(bytes instanceof Uint8Array && bytes.byteLength === file.size, '$.files.' + file.path, 'Missing file or size mismatch', 'FILE_CLOSURE_MISMATCH')
    check(await sha256(bytes) === file.sha256, '$.files.' + file.path, 'File content hash mismatch', 'CONTENT_HASH_MISMATCH')
  }
  return manifest
}
export async function verifyContentHash(manifest) {
  validateHash(manifest.contentHash, '$.contentHash')
  check(await computeContentHash(manifest) === manifest.contentHash, '$.contentHash', 'Content hash mismatch', 'CONTENT_HASH_MISMATCH')
  return manifest
}
