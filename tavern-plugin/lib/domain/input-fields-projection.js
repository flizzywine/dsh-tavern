import {createIndexedArrayApi} from './indexed-array.js'
import {createImmutableTurnFields} from './freeze-json.js'

export function createInputFieldsProjection({maxEntries=8,maxBytes=8*1024*1024,onIndexVisit=()=>{}}={}){
  const cache=new Map(),roles=createIndexedArrayApi({eligible:role=>role==='user',visit:onIndexVisit}),fields=createImmutableTurnFields({visit:onIndexVisit})
  function displayOf(message){const value=message.tavernPluginData?.template_display;return value && value.source===(message.sourceText??message.text) && value.swipe===(message.swipeId||0)?{value:value.html}:null}
  function project(chat,{baseRevision,indices,changedHeaderFields,runtimeInputChanges}={}){
    const previous=cache.get(chat.id),messages=Array.isArray(chat.messages)?chat.messages:[]
    const dirty=indices && [...indices]
    let reuse=previous && previous.revision===baseRevision && Array.isArray(changedHeaderFields) && (!changedHeaderFields.includes('runtimeInputs') || Array.isArray(runtimeInputChanges))
      && dirty && dirty.every(id=>Number.isSafeInteger(id)&&id>=0&&id<messages.length&&(id>=previous.roles.length || previous.roles[id]===messages[id]?.role))
    let sources,displays,roleRows,runtimeSources
    if(reuse){
      const appended=[]
      const positions=new Set(dirty)
      for(let id=previous.roles.length;id<messages.length;id++){appended.push([id,messages[id]?.role]);positions.add(id)}
      roleRows=appended.length || messages.length<previous.roles.length?roles.update(previous.roles,appended,messages.length):previous.roles
      runtimeSources=previous.runtimeSources
      const sourceSets=[],sourceRemoves=[],displaySets=[],displayRemoves=[]
      if(changedHeaderFields.includes('runtimeInputs')){
        for(const entry of runtimeInputChanges){
          const key=String(entry.key)
          if(entry.present)sourceSets.push([key,String((entry.value && entry.value.source)??'')]);else sourceRemoves.push(key)
          if(/^(0|[1-9]\d*)$/.test(key) && Number(key)>=2){const id=roles.select(roleRows,Number(key)-2);if(id>=0)positions.add(id)}
        }
        runtimeSources=fields.update(runtimeSources,sourceSets,sourceRemoves)
      }
      for(let turn=roles.info(roleRows).eligible+2;turn<=roles.info(previous.roles).eligible+1;turn++){
        const key=String(turn);displayRemoves.push(key)
        if(Object.hasOwn(runtimeSources,key))sourceSets.push([key,runtimeSources[key]])
        else sourceRemoves.push(key)
      }
      for(const id of positions){
        const message=messages[id];if(message?.role!=='user')continue
        const turn=String(1+roles.rank(roleRows,id+1)),display=displayOf(message)
        if(!display)displayRemoves.push(turn);else displaySets.push([turn,display.value])
        if(message.templateHistoryEdit || message.templateInputSource)sourceSets.push([turn,message.sourceText??message.text])
        else if(Object.hasOwn(runtimeSources,turn))sourceSets.push([turn,runtimeSources[turn]])
        else sourceRemoves.push(turn)
      }
      sources=fields.update(previous.inputSources,sourceSets,sourceRemoves)
      displays=fields.update(previous.inputTemplateDisplays,displaySets,displayRemoves)
    }else{
      const runtime={};for(const [turn,input] of Object.entries(chat.runtimeInputs && typeof chat.runtimeInputs==='object'?chat.runtimeInputs:{}))runtime[turn]=String((input && input.source)??'')
      runtimeSources=fields.from(runtime)
      const source={...runtime},display={},rowValues=[];let turn=1
      for(const message of messages){rowValues.push(message?.role);if(message?.role!=='user')continue;turn++
        const value=displayOf(message);if(value)display[turn]=value.value
        if(message.templateHistoryEdit || message.templateInputSource)source[turn]=message.sourceText??message.text
      }
      roleRows=roles.from(rowValues);sources=fields.from(source);displays=fields.from(display)
    }
    const value={inputSources:sources,inputTemplateDisplays:displays}
    const size=roles.info(roleRows).bytes+fields.bytes(sources)+fields.bytes(displays)+fields.bytes(runtimeSources)
    if(Number.isSafeInteger(chat._storageRevision) && maxEntries>0 && size<=maxBytes && (!previous || previous.revision<=chat._storageRevision)){
      cache.delete(chat.id)
      let bytes=[...cache.values()].reduce((sum,row)=>sum+row.size,0)
      while(cache.size && (cache.size>=maxEntries || bytes+size>maxBytes)){const key=cache.keys().next().value;bytes-=cache.get(key).size;cache.delete(key)}
      cache.set(chat.id,{...value,roles:roleRows,runtimeSources,revision:chat._storageRevision,size})
    }
    return value
  }
  return {project}
}
