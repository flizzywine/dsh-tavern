// Test-only file transport into the actual server runtime; never exposes an HTTP control API.
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
export const inject=['tavernStageControl']
export function apply(ctx) {
  const directory=process.env.TAVERN_E2E_STAGE_CONTROL
  if(!directory)throw Error('Missing isolated stage lifecycle directory')
  const control=ctx.get('tavernStageControl')
  let busy=false,last=null,closed=false
  const timer=setInterval(async()=>{
    if(busy||closed)return
    busy=true
    try {
      const request=JSON.parse(await readFile(join(directory,'stage-command.json'),'utf8'))
      if(request.id===last)return
      last=request.id
      let error
      try {
        if(request.action==='disable')await control.disable()
        else if(request.action==='enable')await control.enable()
        else throw Error('Unknown lifecycle action')
      }catch(cause){error=String(cause.message)}
      await writeFile(join(directory,'stage-result.json'),JSON.stringify({id:request.id,status:control.status(),error}))
    }catch(error){if(error.code!=='ENOENT')console.warn('Stage lifecycle test transport:',error.message)}
    finally{busy=false}
  },100)
  ctx.effect(()=>()=>{closed=true;clearInterval(timer)})
}
