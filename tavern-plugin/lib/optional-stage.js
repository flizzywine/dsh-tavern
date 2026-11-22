import {cardStageChoice,effectiveCardStage} from './domain/card-stage-settings.js'
import {cardAssetExtensionView} from './domain/card-asset-bindings.js'
import {hasCardAssetBindings} from './card-asset-bindings.js'

const unavailable=()=>{throw Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})}
// Migration boundary: stable consumers survive an absent or failed runtime.
// The implementation is loaded only when enabled; this is not the final public plugin API.
export async function createOptionalStage(core,{enabled=true,load,onStatus=()=>{},warn=error=>console.warn('dsh-tavern: 舞台不可用',error?.message)}={}) {
  let runtime=null,cards=null,state=enabled?'loading':'disabled'
  function setState(next){if(state===next)return;state=next;try{onStatus(next)}catch(error){report(error)}}
  let loadImplementation=load
  const phases=new Map()
  let generation=0,prepared=false,disposed=false,enabling=null,draining=Promise.resolve()
  const report=error=>{try{warn(error)}catch{}}
  function release(old) {
    if(!old)return draining
    const cleanup=Promise.resolve(old.dispose()).catch(report)
    draining=Promise.all([draining,cleanup]).then(()=>{})
    return draining
  }
  function failed(error,expected=runtime) {
    if(runtime !== expected)return
    const old=runtime;runtime=null;cards=null;setState('failed')
    void release(old);report(error)
  }
  function disable() {
    generation++
    const old=runtime;runtime=null;cards=null;setState('disabled');enabling=null
    return release(old)
  }
  async function enable(loader) {
    if(loader !== undefined) {
      if(typeof loader !== 'function')throw new TypeError('Stage loader must be a function')
      loadImplementation=loader
    }
    if(disposed)throw Object.assign(new Error('Stage controller disposed'),{code:'STAGE_UNAVAILABLE'})
    if(!prepared)throw new Error('Stage host is not ready')
    if(enabling)return enabling
    if(runtime)return
    const version=++generation
    setState('loading')
    const work=(async()=>{
      await draining
      const implementation=await loadImplementation()
      if(disposed || version!==generation)return
      runtime=implementation.createStageRuntime(core)
      const installed=runtime
      setState('loaded')
      try {
        for(const [phase,args] of phases) {
          if(disposed || version!==generation || runtime!==installed)return
          await api[phase](...args)
        }
      } catch(error) {failed(error,installed)}
    })().catch(error=>{if(version===generation)failed(error)})
    enabling=work
    try {await work} finally {if(enabling===work)enabling=null}
  }
  if(enabled)try {runtime=(await loadImplementation()).createStageRuntime(core);setState('loaded')}catch(error){failed(error)}
  async function cardStageMode(cardPath) {
    const raw=(await core.readCardWorkspace(cardPath))?.raw
    const extension=raw && hasCardAssetBindings(raw) ? cardAssetExtensionView(raw) : null
    const effective=extension ? effectiveCardStage(extension,core.assetEngineSettings?.read().values) : null
    if (state !== 'ready' && (effective?.stage || effective?.dialogue && core.needsStageFeatures?.(raw, extension))) await core.ensureStage?.()
    return {dialogue:effective?.dialogue===true,
      stage:state==='ready' && effective?.stage===true,isStageCard:cardStageChoice(extension?.stage,'stage')==='on'}
  }
  const api = Object.freeze({assets:{cardStageMode},enable,disable,
    modPrompts:(...args) => state === 'ready' ? runtime.modPrompts(...args) : undefined,
    cards(bindings) {
      phases.set('cards',[bindings])
      if(runtime)try{cards=runtime.cards(bindings)}catch(error){failed(error)}
      return {get cardAssetBindings(){return cards?.cardAssetBindings},cardZipTargets:{
        async reserve(...args) {
          if (!cards) await core.ensureStage?.()
          return cards ? cards.cardZipTargets.reserve(...args) : unavailable()
        },
        release:(...args)=>cards ? cards.cardZipTargets.release(...args) : unavailable()
      }}
    },
    async start(bindings) {phases.set('start',[bindings]);const installed=runtime;if(installed)try{await installed.start(bindings)}catch(error){failed(error,installed)}},
    services(bindings) {phases.set('services',[bindings]);if(runtime)try{runtime.services(bindings)}catch(error){failed(error)}},
    requests(bindings,registry) {phases.set('requests',[bindings,registry]);prepared=true;if(runtime)try{runtime.requests(bindings,registry);setState('ready')}catch(error){failed(error)}},
    async dispose() {disposed=true;await disable();phases.clear()},
    status:()=>state
  })
  return api
}
