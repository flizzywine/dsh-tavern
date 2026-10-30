import {check, shape} from '../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import {validateJudgeConfig, JUDGE_KEY_REFS} from './domain/engine-judge.js'

// RPC admission is the sole config write boundary; the settings owner keeps CAS.
export function createJudgeRpc(settings,judge) {
  const result = value => ({config:value.values.judge,revision:value.revision,writable:value.writable})
  return {
    getJudgeConfig(args = {}) {shape(args,[],[]);return result(settings.read())},
    async saveJudgeConfig(args) {
      shape(args,['config','expectedRevision'],['config','expectedRevision'])
      shape(args.config,Object.keys(settings.read().values.judge),[],'$.config')
      return result(await settings.save({patch:{judge:args.config},expectedRevision:args.expectedRevision}))
    },
    getJudgeCredentialStatus(args) {shape(args,['provider','keyName'],['provider','keyName']);return judge.credentialStatus(args.provider,args.keyName)},
    // 「API Key」 — validated once here (printable ASCII without spaces, ≤ 4096; null
    // clears the stored key). A resolving variable name becomes the judge's keyName (CAS) and drops a stored key; any other
    // value is stored as the key. Only the status (and, for a reference, the saved settings) comes back — never the key.
    async setJudgeKey(args) {
      shape(args,['provider','value','expectedRevision'],['provider','value','expectedRevision'])
      check(Object.hasOwn(JUDGE_KEY_REFS,args.provider),'$.provider')
      check(args.value === null || typeof args.value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(args.value),'$.value')
      let saved
      if (args.value !== null && await judge.isReference(args.value)) {
        const current = settings.read().values.judge
        saved = await settings.save({patch:{judge:{...current,keyName:args.value}},expectedRevision:args.expectedRevision})
        await judge.setKey(args.provider,null)
      } else await judge.setKey(args.provider,args.value)
      return {status:await judge.credentialStatus(args.provider,settings.read().values.judge.keyName),...(saved ? {settings:saved} : {})}
    },
    evaluateJudge(args) {
      shape(args,['sessionId','material','questions'],['material','questions'])
      check(args.sessionId === undefined || typeof args.sessionId === 'string','$.sessionId')
      check(typeof args.material === 'string' && Buffer.byteLength(args.material,'utf8') <= 65536,'$.material')
      check(Array.isArray(args.questions) && args.questions.length > 0 && args.questions.length <= 300,'$.questions')
      for (const question of args.questions) {
        shape(question,['id','text'],['id','text'])
        check(typeof question.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(question.id),'$.questions.id')
        check(typeof question.text === 'string' && question.text.length <= 4000,'$.questions.text')
      }
      check(new Set(args.questions.map(row=>row.id)).size === args.questions.length,'$.questions.id')
      return judge.evaluate(args)
    },
    testJudgeConnection(args = {}) {shape(args,['config'],[]);return judge.test(args.config === undefined ? undefined : validateJudgeConfig(args.config))},
  }
}
