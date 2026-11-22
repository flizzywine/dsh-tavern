import {createHash} from 'node:crypto'
import {canonicalJson} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const assetPackDigest = (value, options) => createHash('sha256').update(canonicalJson(value, options)).digest('hex')
