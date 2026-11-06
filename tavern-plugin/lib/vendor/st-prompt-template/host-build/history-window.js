import {diffJson} from '../../../domain/json-mutation.js'
const windows=new WeakMap()
export const templateHistoryIndices=chat=>windows.get(chat)?.loaded()

// A real array preserves absolute floors and synchronous upstream reads. Internal
// snapshots contain loaded rows only, so bookkeeping never activates accessors.
export function createTemplateHistoryWindow({window,rows,read}) {
 const values=new Map(),base=new Map(),chat=new Array(window.messageCount)
 function install(id,row){base.set(id,structuredClone(row));values.set(id,structuredClone(row))}
 rows.forEach((row,index)=>install(window.from+index,row))
 for(let id=0;id<chat.length;id++)Object.defineProperty(chat,String(id),{
  enumerable:true,configurable:false,
  get(){if(!values.has(id))install(id,read(id,window));return values.get(id)},
  set(row){if(!values.has(id))install(id,read(id,window));values.set(id,row)}
 })
 // Upstream looks up message variables with `chat.slice(0,id+1).findLastIndex(...)`. The
 // native slice reads every floor it copies; this one copies accessors, so the search
 // still reads only the floors it reaches from the end.
 Object.defineProperty(chat,'slice',{enumerable:false,configurable:false,value(start,end){
  const at=(value,fallback)=>{const n=value===undefined?fallback:Math.trunc(Number(value))||0;return n<0?Math.max(0,chat.length+n):Math.min(n,chat.length)}
  const from=at(start,0),view=new Array(Math.max(0,at(end,chat.length)-from))
  for(let index=0;index<view.length;index++)Object.defineProperty(view,String(index),{enumerable:true,configurable:true,
   get:()=>chat[from+index],set:row=>Object.defineProperty(view,String(index),{value:row,writable:true,enumerable:true,configurable:true})})
  return view
 }})
 const api={chat,loaded:()=>[...values.keys()].sort((a,b)=>a-b),
  changes(){
   if(chat.length!==window.messageCount)throw Error('模板不能改变聊天楼层数量')
   return [...values].flatMap(([id,row])=>diffJson(base.get(id),row).map(change=>({...change,path:['chat',id,...change.path]})))
  },
  baseline(){const rows=new Array(chat.length);for(const [id,row] of base)rows[id]=structuredClone(row);return rows},
  materialize(){const rows=new Array(chat.length);for(const [id,row] of values)rows[id]=structuredClone(row);return rows},
  acknowledge(submitted,saved,reconcile){for(const id of values.keys()){
   if(!submitted[id])continue
   reconcile(values.get(id),submitted[id],saved[id]);base.set(id,structuredClone(saved[id]))
  }}
 }
 windows.set(chat,api)
 return api
}
