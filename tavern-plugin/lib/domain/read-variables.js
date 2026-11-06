import {createHash} from 'node:crypto'
const object=value=>value!==null&&typeof value==='object'
const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value
const escape=value=>value.replace(/~/g,'~0').replace(/\//g,'~1')
const visible=key=>!key.startsWith('$')&&!key.startsWith('__')
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function readVariables(chat,args={}) {
  if(!chat||!['story','script'].includes(chat.mode||'story'))throw Error('变量查询仅用于当前游玩会话')
  const action=args.action||'list',path=args.path||'',query=args.query||''
  if(!['list','read','search'].includes(action))throw Error('action 必须是 list、read 或 search')
  if(typeof path!=='string'||path.length>1024||path&&!path.startsWith('/')||/~(?![01])/u.test(path))throw Error('path 必须是变量根下的 JSON Pointer；根目录用空字符串')
  if(typeof query!=='string'||query.length>100||action==='search'&&!query.trim())throw Error('search 需要 1–100 字符的 query')
  const limit=args.limit===undefined?20:args.limit
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('limit 范围为 1–50')
  let snapshot,turn
  for(const message of [...(chat.messages||[])].reverse()){
    if(message.role==='tavern-helper')continue
    const value=message.variables?.[message.swipeId||0]
    if(object(value?.stat_data)){snapshot=value.stat_data;turn=message.turn;break}
  }
  if(!snapshot)return {available:false,message:'当前会话尚无已保存的变量快照',settlement:chat.settleStatus||'idle'}
  const revision=digest([chat.id,chat._storageRevision,snapshot])
  const identity=digest([revision,action,path,query])
  let offset=0
  if(args.cursor!==undefined){
    try{if(typeof args.cursor!=='string'||args.cursor.length>400)throw Error();const value=JSON.parse(Buffer.from(args.cursor,'base64url').toString());if(value.identity!==identity||!Number.isSafeInteger(value.offset)||value.offset<0)throw Error();offset=value.offset}catch{throw Error('游标无效或变量已变化，请从当前路径重新查询')}
  }
  const cursor=offset=>Buffer.from(JSON.stringify({identity,offset})).toString('base64url')
  const base={available:true,action,path,revision,turn:turn??null,settlement:chat.settleStatus||'idle'}
  let value=snapshot
  for(const key of path?path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~')):[]){
    if(!visible(key)||key==='constructor'||!object(value)||!Object.hasOwn(value,key))return {...base,found:false}
    value=value[key]
  }
  if(action==='read'&&!object(value)){
    if(typeof value==='string')return {...base,found:true,type:'string',value:value.slice(offset,offset+1000),truncated:offset+1000<value.length,nextCursor:offset+1000<value.length?cursor(offset+1000):null}
    return {...base,found:true,type:type(value),value,nextCursor:null}
  }
  function* children(root,rootPath,recursive){
    const stack=[{value:root,path:rootPath,keys:object(root)?Object.keys(root).filter(visible):[],index:0}]
    while(stack.length){
      const frame=stack.at(-1)
      if(frame.index===frame.keys.length){stack.pop();continue}
      const key=frame.keys[frame.index++],child=frame.value[key],childPath=frame.path+'/'+escape(key)
      yield {path:childPath,type:type(child),value:child}
      if(recursive&&object(child))stack.push({value:child,path:childPath,keys:Object.keys(child).filter(visible),index:0})
    }
  }
  const entries=[],iterator=children(value,path,action==='search');let scanned=0,index=0,bytes=0,more=false
  for(const child of iterator){
    if(index++<offset)continue
    if(scanned>=2000||entries.length>=limit){more=true;break}
    scanned++
    if(action==='search'&&!child.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()))continue
    if(child.path.length>1024)throw Error('变量路径过长，无法安全分页；请缩短字段名')
    const entry={path:child.path,type:child.type}
    if(action==='read'&&!object(child.value)){entry.value=typeof child.value==='string'?child.value.slice(0,200):child.value;if(typeof child.value==='string'&&child.value.length>200)entry.truncated=true}
    const size=JSON.stringify(entry).length
    if(bytes+size>4000){scanned--;more=true;break}
    entries.push(entry);bytes+=size
  }
  return {...base,found:true,type:type(value),entries,truncated:more,nextCursor:more?cursor(offset+scanned):null}
}

export function registerVariableReadTool({tools,defineTool,chatForSession}){
 tools.register(defineTool({name:'tavern_read_variables',description:'只读查询当前游玩存档变量。默认 list 仅列顶层路径和类型，每页20项；path 分层展开。search 按路径名搜索，结果分页；read 读取路径值，对象只返回一层，长文本分段。路径相对于 stat_data，不含 /stat_data。nextCursor 非空可续读，续页保留 action/path/query；变量变化则重新查询。settlement 表示当前结算状态，pending/running/waiting-runtime 时结果可能仍为上一轮已保存值。仅按需查询，不修改变量。',parameters:{action:{type:'string',enum:['list','search','read']},path:{type:'string'},query:{type:'string'},cursor:{type:'string'},limit:{type:'integer'}},output:{schema:{type:'object',additionalProperties:false,properties:{report:{type:'json',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value.report)}]},isConcurrencySafe:()=>true,async execute(args,exec){return {report:readVariables(await chatForSession(exec?.agent?.session?.id||''),args)}}}))
}
