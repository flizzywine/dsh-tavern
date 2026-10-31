import {normalizeBubbleConfig} from './domain/dialogue-bubbles.js'

const unavailable=()=>{throw Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})}
const ordinaryBook=book=>book ? {...book,view:{...book.view,entries:(book.view?.entries || []).filter(entry=>!entry.foregroundCapability && !entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles)}} : book

// Migration boundary: stable consumers survive an absent or failed runtime.
// The implementation is loaded only when enabled; this is not the final public plugin API.
export async function createOptionalStage(core,{enabled=true,load=()=>import('./stage-runtime.js'),warn=error=>console.warn('dsh-tavern: 舞台不可用',error?.message)}={}) {
  let runtime=null,foreground=null,cards=null,state=enabled?'loading':'disabled'
  const report=error=>{try{warn(error)}catch{}}
  function failed(error) {
    const old=runtime;runtime=null;foreground=null;cards=null;state='failed'
    if(old)void old.dispose().catch(report)
    report(error)
  }
  if(enabled)try {runtime=(await load()).createStageRuntime(core);state='loaded'}catch(error){failed(error)}
  const emptyConfig=()=>normalizeBubbleConfig({enabled:false})
  const dialogueBubbles={
    read:(...args)=>runtime ? runtime.assets.dialogueBubbles.read(...args) : Promise.resolve(emptyConfig()),
    snapshot:(...args)=>runtime ? runtime.assets.dialogueBubbles.snapshot(...args) : Promise.resolve({config:emptyConfig(),requireAvailable:emptyConfig}),
    sync:(...args)=>runtime ? runtime.assets.dialogueBubbles.sync(...args) : Promise.resolve()
  }
  return Object.freeze({assets:{dialogueBubbles},
    cards(bindings) {
      if(runtime)try{cards=runtime.cards(bindings)}catch(error){failed(error)}
      return {get cardAssetBindings(){return cards?.cardAssetBindings},cardZipTargets:{
        reserve:(...args)=>cards ? cards.cardZipTargets.reserve(...args) : Promise.reject(Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})),
        release:(...args)=>cards ? cards.cardZipTargets.release(...args) : unavailable()
      }}
    },
    foreground(bindings) {
      if(runtime)try{foreground=runtime.foreground(bindings)}catch(error){failed(error)}
      return {
        project:(chat,book,...args)=>foreground ? foreground.project(chat,book,...args) : Promise.resolve(ordinaryBook(book)),
        preview:(...args)=>foreground ? foreground.preview(...args) : Promise.resolve([]),
        refresh:(...args)=>foreground ? foreground.refresh(...args) : Promise.reject(Object.assign(new Error('舞台模块未启用'),{code:'STAGE_UNAVAILABLE'})),
        rosterAddendum:(...args)=>foreground ? foreground.rosterAddendum(...args) : Promise.resolve('')
      }
    },
    async start(bindings) {if(runtime)try{await runtime.start(bindings)}catch(error){failed(error)}},
    services(bindings) {if(runtime)try{runtime.services(bindings)}catch(error){failed(error)}},
    requests(bindings,registry) {if(runtime)try{runtime.requests(bindings,registry);state='ready'}catch(error){failed(error)}},
    async dispose() {const old=runtime;runtime=null;foreground=null;cards=null;state='disabled';await old?.dispose()},
    status:()=>state
  })
}
