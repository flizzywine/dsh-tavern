import { createHash } from 'node:crypto'
import { canonicalJson } from './asset-pack-json.js'

// The one digest of an asset-pack record (binding, entries, catalogue); the stage and the core's import rebind and card speech all name records by it. Node only: the browser has no node:crypto.
export const assetPackDigest = (value, options) => createHash('sha256').update(canonicalJson(value, options)).digest('hex')
