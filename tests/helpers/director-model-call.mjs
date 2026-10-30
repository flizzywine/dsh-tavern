// legacy scenarios author canonical expectations; fake models send only advertised handles.
// Resolve the fixed identity digest against this request, never call the internal canonical submit seam.
import {createHash} from 'node:crypto'
import {assetRefKey} from '../../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'

export function modelHandle(request, value) {
  const key = value && typeof value === 'object' && value.packId ? assetRefKey(value) : value
  if (typeof key !== 'string') return value
  const digest = BigInt('0x' + createHash('sha256').update(key).digest('hex').slice(0,10)).toString(36)
  const handles = JSON.stringify({system:request.system,messages:request.messages,tools:request.tools}).match(/[\p{L}\p{N}-]+~[a-z0-9]+/gu) || []
  return handles.find(handle => handle.endsWith('~' + digest)) || value
}
export function modelArguments(request, args) {
  const identity = value => modelHandle(request,value)
  const result = structuredClone(typeof args === 'string' ? JSON.parse(args) : args)
  for (const beat of result?.beats || []) for (const op of beat.ops || []) {
    for (const key of ['actor','after','background','timeLook','ref','cg','contact']) if (Object.hasOwn(op,key)) op[key] = identity(op[key])
    if (Array.isArray(op.refs)) op.refs = op.refs.map(identity) // ambience handles.
    if (Array.isArray(op.actors)) op.actors = op.actors.map(identity)
    if (op.target?.actor) op.target.actor = identity(op.target.actor)
    if (op.op === 'outfit.set') op.outfit = identity(op.outfit)
  }
  return result
}
export const modelCall = (request, call) => request.onToolCall({...call, arguments:modelArguments(request,call.arguments)})
export const modelRequest = request => ({...request,onToolCall:call => modelCall(request,call)})
