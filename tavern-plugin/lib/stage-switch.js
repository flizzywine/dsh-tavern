// Host-owned controls remain available when the optional stage cannot start.
export async function createStageSwitch({runtime,store,builtin=false,warn=error=>console.warn('舞台控制异常',error?.message)}) {
  const path='stage-preferences.json'
  let enabled=builtin,loader=null
  if(!builtin)try{enabled=(await store.readJson(path))?.enabled!==false}catch(error){try{warn(error)}catch{}}
  let pending=Promise.resolve()
  const snapshot=()=>({status:runtime.status(),enabled,installed:!!loader})
  const serial=work=>{const next=pending.then(work);pending=next.catch(()=>{});return next}
  return Object.freeze({
    read:snapshot,
    async install(load){loader=load;if(enabled)await runtime.enable(loader)},
    async uninstall(){loader=null;await runtime.disable()},
    setEnabled(value){
      if(typeof value!=='boolean')return Promise.reject(new TypeError('舞台启用状态必须是布尔值'))
      return serial(async()=>{
        if(value&&!loader)throw new Error('舞台插件未安装，无法启用')
        if(!builtin)await store.writeJson(path,{enabled:value})
        enabled=value
        // Do not hold the preference queue while activation waits on stage work.
        const operation=value ? runtime.enable(loader) : runtime.disable()
        // Activation must return control to the UI so a stuck load can be stopped.
        if(value){Promise.resolve(operation).catch(error=>{try{warn(error)}catch{}});return {operation:undefined}}
        return {operation}
      }).then(async({operation})=>{await operation;return snapshot()})
    }
  })
}
