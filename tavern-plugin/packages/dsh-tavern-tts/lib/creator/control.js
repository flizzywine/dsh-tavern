import { fail } from '../core.js'

export const CREATOR_METHODS = Object.freeze({'creator.voiceDesign':'design', 'creator.voicePilot':'pilot'})

// One gate for every creator method, reached by HTTP and by ttsControl alike: the global creator.enabled switch, then
// the method's own action; the creator module is imported only on the first allowed call.
export function createCreatorControl({getEnabled, load}) {
  let creator
  return async (method, args = {}) => {
    const action = CREATOR_METHODS[method]
    if (!action) fail('UNKNOWN_METHOD')
    if (!getEnabled()) fail('CREATOR_DISABLED')
    if (args.action !== action) fail('INVALID_INPUT')
    creator ??= load()
    return (await creator).run(args)
  }
}
