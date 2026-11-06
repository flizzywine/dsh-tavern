// origin-independent card storage with atomic, acknowledged batches.
const storagePath = 'frame-storage.json'
const MAX_KEY = 4096 // Includes the encoded card/session namespace (logical keys: 512 bytes).
const MAX_VALUE = 256 * 1024
const MAX_TOTAL = 2 * 1024 * 1024
const bytes = value => Buffer.byteLength(value, 'utf8')

function project(value) {
  const out = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true })
  return out
}

export function createFrameStorage(profileData) {
  async function read() { return project(await profileData.readJson(storagePath)) }
  async function update(ops) {
    if (!Array.isArray(ops) || ops.length > 500) throw new Error('frame storage batch must contain at most 500 ops')
    // Validate the entire batch before touching storage; malformed operations must
    // not be silently acknowledged. Legacy unscoped keys remain readable on disk.
    for (const op of ops) {
      if (!op || !['set', 'remove', 'clear'].includes(op.op)) throw new Error('Invalid frame storage operation')
      if (op.op === 'clear') {
        if (typeof op.namespace !== 'string' || !/^dsh-card:%5B.*%5D:$/.test(op.namespace) || bytes(op.namespace) > 3072) throw new Error('Invalid frame storage namespace')
      } else {
        if (typeof op.key !== 'string' || !op.key || bytes(op.key) > MAX_KEY) throw new Error('Invalid frame storage key')
        if (op.op === 'set' && (typeof op.value !== 'string' || bytes(op.value) > MAX_VALUE)) throw new Error('Invalid frame storage value')
      }
    }
    const saved = await profileData.updateJson(storagePath, current => {
      const next = project(current)
      for (const op of ops) {
        if (op.op === 'clear') { for (const key of Object.keys(next)) if (key.startsWith(op.namespace)) delete next[key] }
        else if (op.op === 'set') Object.defineProperty(next, op.key, { value: op.value, enumerable: true, writable: true, configurable: true })
        else delete next[op.key]
      }
      if (bytes(JSON.stringify(next)) > MAX_TOTAL) throw new Error('卡片存储超过 2 MB 上限')
      return next
    })
    return { ok: true, applied: ops.length, values: project(saved) }
  }
  return Object.freeze({ read, update })
}
