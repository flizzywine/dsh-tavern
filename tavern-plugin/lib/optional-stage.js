import {normalizeBubbleConfig} from './domain/dialogue-bubbles.js'

const unavailable=()=>{throw Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})}
const ordinaryBook=book=>book ? {...book,view:{...book.view,entries:(book.view?.entries || []).filter(entry=>!entry.foregroundCapability && !entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles)}} : book

// Migration boundary: stable consumers survive an absent or failed runtime.
// The implementation is loaded only when enabled; this is not the final public plugin API.
export async function createOptionalStage(core,{enabled=true,load,warn=error=>console.warn('dsh-tavern: 舞台不可用',error?.message)}={}) {
  let runtime=null,foreground=null,cards=null,state=enabled?'loading':'disabled'
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
    const old=runtime;runtime=null;foreground=null;cards=null;state='failed'
    void release(old);report(error)
  }
  function disable() {
    generation++
    const old=runtime;runtime=null;foreground=null;cards=null;state='disabled';enabling=null
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
    state='loading'
    const work=(async()=>{
      await draining
      const implementation=await loadImplementation()
      if(disposed || version!==generation)return
      runtime=implementation.createStageRuntime(core)
      const installed=runtime
      state='loaded'
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
  if(enabled)try {runtime=(await loadImplementation()).createStageRuntime(core);state='loaded'}catch(error){failed(error)}
  const emptyConfig=()=>normalizeBubbleConfig({enabled:false})
  const dialogueBubbles={
    read:(...args)=>runtime ? runtime.assets.dialogueBubbles.read(...args) : Promise.resolve(emptyConfig()),
    snapshot:(...args)=>runtime ? runtime.assets.dialogueBubbles.snapshot(...args) : Promise.resolve({config:emptyConfig(),requireAvailable:emptyConfig}),
    sync:(...args)=>runtime ? runtime.assets.dialogueBubbles.sync(...args) : Promise.resolve()
  }
  const api = Object.freeze({assets:{dialogueBubbles},enable,disable,
    cards(bindings) {
      phases.set('cards',[bindings])
      if(runtime)try{cards=runtime.cards(bindings)}catch(error){failed(error)}
      return {get cardAssetBindings(){return cards?.cardAssetBindings},cardZipTargets:{
        reserve:(...args)=>cards ? cards.cardZipTargets.reserve(...args) : Promise.reject(Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})),
        release:(...args)=>cards ? cards.cardZipTargets.release(...args) : unavailable()
      }}
    },
    foreground(bindings) {
      phases.set('foreground',[bindings])
      if(runtime)try{foreground=runtime.foreground(bindings)}catch(error){failed(error)}
      return {
        project:(chat,book,...args)=>foreground ? foreground.project(chat,book,...args) : Promise.resolve(ordinaryBook(book)),
        preview:(...args)=>foreground ? foreground.preview(...args) : Promise.resolve([]),
        refresh:(...args)=>foreground ? foreground.refresh(...args) : Promise.reject(Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})),
        rosterAddendum:(...args)=>foreground ? foreground.rosterAddendum(...args) : Promise.resolve('')
      }
    },
    async start(bindings) {phases.set('start',[bindings]);const installed=runtime;if(installed)try{await installed.start(bindings)}catch(error){failed(error,installed)}},
    services(bindings) {phases.set('services',[bindings]);if(runtime)try{runtime.services(bindings)}catch(error){failed(error)}},
    requests(bindings,registry) {phases.set('requests',[bindings,registry]);prepared=true;if(runtime)try{runtime.requests(bindings,registry);state='ready'}catch(error){failed(error)}},
    async dispose() {disposed=true;await disable();phases.clear()},
    status:()=>state
  })
  return api
}
