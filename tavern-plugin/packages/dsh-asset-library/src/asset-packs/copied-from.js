import {shape, check, validateUuid, validateShortId} from './common.js'

export function validateCopiedFrom(value, kind, path) {
  const ref = value?.dsh_tavern?.copiedFrom
  if (ref === undefined) return
  path += '.dsh_tavern.copiedFrom'
  const fields = kind === 'figures' ? ['packId','figureId'] : ['packId','kind','assetId']
  shape(ref,fields,fields,path)
  validateUuid(ref.packId,path + '.packId')
  if (kind === 'figures') validateUuid(ref.figureId,path + '.figureId')
  else {
    check(ref.kind === kind,path + '.kind','Copy origin must have the same kind')
    validateShortId(ref.assetId,path + '.assetId')
  }
}
