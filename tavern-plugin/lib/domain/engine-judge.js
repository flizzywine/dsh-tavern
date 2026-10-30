// reusable binary judge. Providers receive only the serialized preview body.
import {check, shape, assertJson} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

export const JUDGE_PROVIDERS = Object.freeze({jev:{model:'jev-1.13.0',keyName:'TYPESAFE_API_KEY'},openai:{model:'gpt-6-luna',keyName:'OPENAI_API_KEY'},'openai-compatible':{model:'gpt-6-luna',keyName:'OPENAI_API_KEY'}})
// 舞台模式 › 判断模型 › API Key takes either the key itself — stored in the host
// credential store under one fixed name per provider (never in settings, never read back, never logged) — or the name of an
// existing environment variable, kept as the judge's keyName. A stored key wins; without one the keyName credential is used.
export const JUDGE_KEY_REFS = Object.freeze({jev:'DSH_TAVERN_JUDGE_JEV_KEY',openai:'DSH_TAVERN_JUDGE_OPENAI_KEY','openai-compatible':'DSH_TAVERN_JUDGE_COMPATIBLE_KEY'})
export const JUDGE_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const JUDGE_RELEVANCE_THRESHOLD = 0.6
export const defaultJudgeConfig = () => ({enabled:true,provider:'unset',model:'',baseUrl:'',keyName:'',threshold:JUDGE_RELEVANCE_THRESHOLD,capPerKind:8,timeoutMs:1500,preamble:''})
export const judgeEnabled = config => !!config?.enabled && config.provider !== 'unset'
export function validateJudgeConfig(value) {
  assertJson(value)
  shape(value,Object.keys(defaultJudgeConfig()),[], '$.judge')
  const config = {...defaultJudgeConfig(),...JUDGE_PROVIDERS[value.provider],...value}
  check(typeof config.enabled === 'boolean','$.judge.enabled')
  check(['unset',...Object.keys(JUDGE_PROVIDERS)].includes(config.provider),'$.judge.provider')
  for (const key of ['model','baseUrl','keyName','preamble']) check(typeof config[key] === 'string','$.judge.' + key)
  check(config.provider === 'unset' || config.model.trim().length > 0,'$.judge.model')
  check(config.keyName === '' && config.provider === 'unset' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(config.keyName),'$.judge.keyName')
  check(Number.isFinite(config.threshold) && config.threshold >= 0 && config.threshold <= 1,'$.judge.threshold')
  check(Number.isSafeInteger(config.capPerKind) && config.capPerKind >= 0 && config.capPerKind <= 300,'$.judge.capPerKind')
  check(Number.isSafeInteger(config.timeoutMs) && config.timeoutMs >= 1 && config.timeoutMs <= 120000,'$.judge.timeoutMs')
  if (config.provider === 'openai-compatible') {
    let url
    try {url = new URL(config.baseUrl)} catch {}
    const loopback = url && (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname))
    check(url && (url.protocol === 'https:' || url.protocol === 'http:' && loopback) && !url.username && !url.password && !url.search && !url.hash,'$.judge.baseUrl')
  } else check(config.baseUrl === '', '$.judge.baseUrl')
  return config
}
const fixedJudgeUrl = provider => provider === 'jev' ? 'https://api.typesafe.ai/v1/systemone' : 'https://api.openai.com/v1/decisions'
const judgeUrl = config => config.provider === 'openai-compatible'
  ? new URL(config.baseUrl.replace(/\/$/,'').replace(/\/v1$/,'') + '/v1/decisions').href
  : fixedJudgeUrl(config.provider)
export function judgeRequests(config, {material, questions}) {
  if (!judgeEnabled(config) || !questions.length) return []
  const url = judgeUrl(config)
  const requests = []
  for (let i = 0; i < questions.length; i += 300) {
    const batch = questions.slice(i,i + 300)
    const body = JSON.stringify(config.provider === 'jev'
      ? {model:config.model,state:material,questions:Object.fromEntries(batch.map(q => [q.id,{type:'noul',instructions:q.text}]))}
      : {model:config.model,input:material,questions:batch.map(q => ({type:'predicate',name:q.id,instructions:q.text}))})
    requests.push({method:'POST',url,contentType:'application/json',body,bytes:Buffer.byteLength(body,'utf8')})
  }
  return requests
}
const error = code => Object.assign(new Error(code),{code})
// Published reference prices, not account billing; custom models/routes can have different rates.
function costEstimate(config,usage) {
  if (config.provider === 'jev') return usage.input_tokens * 0.042 / 1e6
  if (config.model !== 'gpt-6-luna') return null
  const cached = usage.input_tokens_details?.cached_tokens || 0, writes = usage.input_tokens_details?.cache_write_tokens || 0
  const long = usage.input_tokens > 272000
  return ((Math.max(0,usage.input_tokens-cached-writes)*0.1 + cached*0.01 + writes*0.125)*(long ? 2 : 1) + usage.output_tokens*0.5*(long ? 1.5 : 1)) / 1e6
}
export function createEngineJudge({getConfig,resolveConfig,credentials,fetch:send = globalThis.fetch,log = () => {}}) {
  async function execute(input, config) {
    const requests = judgeRequests(config,input), start = performance.now()
    if (!requests.length) return {probabilities:null,code:'JUDGE_INACTIVE',latencyMs:0}
    const controller = new AbortController(), usage = {input_tokens:0,output_tokens:0}
    let timer, hasUsage = false, costEstimateUSD = 0, knownCost = true
    const transport = []
    const stats = code => ({kind:'engine-judge',provider:config.provider,model:config.model,count:input.questions.length,latencyMs:Math.round(performance.now()-start),code,transport,
      ...(hasUsage ? {usage:{...usage},costEstimateUSD:knownCost ? costEstimateUSD : null} : {})})
    try {
      const probabilities = await Promise.race([
        new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(error('JUDGE_TIMEOUT'))},config.timeoutMs)}),
        (async () => {
          const credential = await credentials()?.resolve(JUDGE_KEY_REFS[config.provider]) || await credentials()?.resolve(config.keyName)
          if (!credential?.value) throw error('JUDGE_NO_KEY')
          const batches = await Promise.all(requests.map(async (request,index) => {
            if (controller.signal.aborted) throw error('JUDGE_TIMEOUT')
            const sentAt = performance.now()
            const response = await send(request.url,{method:request.method,headers:{Authorization:'Bearer ' + credential.value,'Content-Type':request.contentType},body:request.body,signal:controller.signal,redirect:'error'})
            if (!response.ok) throw error('JUDGE_HTTP_ERROR')
            const headersMs = performance.now() - sentAt
            const data = await response.json()
            const serverTimings = Object.fromEntries([...(response.headers?.get('server-timing') || '').matchAll(/([a-zA-Z0-9_-]+);dur=([\d.]+)/g)].map(match=>[match[1],Number(match[2])]))
            transport.push({headersMs,totalMs:performance.now()-sentAt,modelOnlyMs:serverTimings.model ?? serverTimings.inference ?? null})
            if (data.usage) {
              hasUsage = true
              for (const key of Object.keys(usage)) if (Number.isFinite(data.usage[key]) && data.usage[key] >= 0) usage[key] += data.usage[key]
              const cost = costEstimate(config,data.usage)
              if (cost !== null && Number.isFinite(cost) && cost >= 0) costEstimateUSD += cost
              else knownCost = false
            }
            const batch = input.questions.slice(index*300,(index+1)*300)
            const answers = config.provider === 'jev' ? data.answers : Object.fromEntries((Array.isArray(data.answers) ? data.answers : []).map(a => [a.name,a]))
            return batch.map(q => {
              const answer = answers?.[q.id], probability = config.provider === 'jev' ? answer?.noul : answer?.probability
              if (answer?.type !== (config.provider === 'jev' ? 'noul' : 'predicate') || !Number.isFinite(probability) || probability < 0 || probability > 1) throw error('JUDGE_INVALID_RESPONSE')
              return [q.id,probability]
            })
          }))
          return new Map(batches.flat())
        })(),
      ])
      const result = stats('OK'); log(result)
      return {...result,probabilities}
    } catch (cause) {
      controller.abort()
      // Never expose provider bodies, transport errors, or credential values.
      const result = stats(['JUDGE_TIMEOUT','JUDGE_NO_KEY','JUDGE_HTTP_ERROR','JUDGE_INVALID_RESPONSE'].includes(cause.code) ? cause.code : 'JUDGE_ERROR')
      log(result)
      return {...result,probabilities:null}
    } finally {clearTimeout(timer)}
  }
  return {
    enabled:() => judgeEnabled(getConfig()),
    preview:(input,config = getConfig()) => ({id:'judge',title:'判断模型',requests:judgeRequests(config,input)}),
    async judge(input) {return (await execute(input,resolveConfig ? await resolveConfig(input) : getConfig())).probabilities},
    async evaluate(input) {
      const result = await execute(input,resolveConfig ? await resolveConfig(input) : getConfig())
      return {...result,probabilities:result.probabilities ? Object.fromEntries(result.probabilities) : null}
    },
    // A stored key reads source 'stored'; otherwise the keyName reference ({source, keyName}) as before.
    async credentialStatus(provider, keyName) {
      check(Object.hasOwn(JUDGE_KEY_REFS,provider),'$.provider')
      check(typeof keyName === 'string' && (keyName === '' || JUDGE_KEY_NAME.test(keyName)),'$.keyName')
      const own = await credentials()?.describe(JUDGE_KEY_REFS[provider])
      if (own?.configured) return {configured:true,source:own.source === 'file' ? 'stored' : own.source || null}
      const info = keyName ? await credentials()?.describe(keyName) : null
      return info?.configured === true ? {configured:true,source:info.source || null,keyName} : {configured:false,source:null}
    },
    // An entered value is a reference when it is a variable name that resolves now; anything else is the key itself.
    async isReference(value) { return JUDGE_KEY_NAME.test(value) && (await credentials()?.describe(value))?.configured === true },
    // null clears the stored key. The caller validates the value once.
    async setKey(provider, key) {
      const store = credentials()
      if (!store?.set) throw error('JUDGE_KEY_STORE_UNAVAILABLE')
      await (key === null ? store.unset(JUDGE_KEY_REFS[provider]) : store.set(JUDGE_KEY_REFS[provider],key))
    },
    async test(config = getConfig()) {
      const saved = getConfig(), url = judgeUrl(config)
      // Testing a draft must not retarget a stored credential to a new server.
      if (url !== fixedJudgeUrl(config.provider) && !(saved.keyName === config.keyName && saved.provider !== 'unset' && judgeUrl(saved) === url)) {
        return {ok:false,latencyMs:0,error:{code:'JUDGE_KEY_URL_MISMATCH',message:'请先保存此服务地址与密钥名称，再测试连接。'}}
      }
      const result = await execute({material:'A cat sleeps.',questions:[{id:'test',text:'Is a cat sleeping?'}]}, {...config,enabled:true})
      return {ok:result.probabilities !== null,latencyMs:result.latencyMs,...(result.probabilities === null ? {error:{code:result.code,message:result.code}} : {})}
    },
  }
}
