import test from 'node:test'
import assert from 'node:assert/strict'
import {readVariables,registerVariableReadTool} from '../tavern-plugin/lib/domain/read-variables.js'
const chat=state=>({id:'game',mode:'story',_storageRevision:1,messages:[{turn:1,variables:[{stat_data:state}]}]})
test('默认目录分页且不泄露值，层级读取、null与缺失分开',()=>{
 const c=chat({角色:{体力:73,备注:null},...Object.fromEntries(Array.from({length:80},(_,i)=>['字段'+i,i])),$meta:{secret:true}})
 const first=readVariables(c);assert.equal(first.entries.length,20);assert.equal(first.entries[0].value,undefined)
 const paths=[...first.entries.map(x=>x.path)];let cursor=first.nextCursor
 while(cursor){const page=readVariables(c,{cursor});paths.push(...page.entries.map(x=>x.path));cursor=page.nextCursor}
 assert.equal(paths.length,81);assert.equal(new Set(paths).size,81)
 assert.equal(readVariables(c,{action:'read',path:'/角色/体力'}).value,73)
 assert.equal(readVariables(c,{action:'read',path:'/角色/备注'}).value,null)
 assert.equal(readVariables(c,{action:'read',path:'/不存在'}).found,false)
 assert.equal(readVariables(c,{action:'read',path:'/$meta'}).found,false)
})
test('搜索扫描有界且分页不丢结果，游标隔离快照、会话与查询',()=>{
 const c=chat(Object.fromEntries(Array.from({length:3001},(_,i)=>['字段'+i,i])))
 const first=readVariables(c,{action:'search',query:'3000'})
 assert.equal(first.entries.length,0);assert.ok(first.nextCursor)
 const next=readVariables(c,{action:'search',query:'3000',cursor:first.nextCursor})
 assert.deepEqual(next.entries,[{path:'/字段3000',type:'number'}])
 for(const changed of [{...c,id:'other'},{...c,_storageRevision:2}])assert.throws(()=>readVariables(changed,{action:'search',query:'3000',cursor:first.nextCursor}),/游标/)
 assert.throws(()=>readVariables(c,{cursor:first.nextCursor}),/游标/)
})
test('大文本、对象值和目录响应有总量限制，当前分支与结算状态正确',()=>{
 const text='长文本'.repeat(3000),c=chat({日志:text})
 let result=readVariables(c,{action:'read',path:'/日志'}),all=result.value
 while(result.nextCursor){result=readVariables(c,{action:'read',path:'/日志',cursor:result.nextCursor});all+=result.value}
 assert.equal(all,text)
 const wide=chat(Object.fromEntries(Array.from({length:50},(_,i)=>['x'.repeat(100)+i,'v'.repeat(500)])))
 result=readVariables(wide,{action:'read',limit:50});assert.ok(JSON.stringify(result).length<6000);assert.ok(result.nextCursor)
 c.messages.push({turn:2,swipeId:1,variables:[{stat_data:{值:'错误分支'}},{stat_data:{值:'正确分支'}}]});c.settleStatus='running'
 result=readVariables(c,{action:'read',path:'/值'});assert.equal(result.value,'正确分支');assert.equal(result.settlement,'running')
 c.messages.pop();assert.equal(readVariables(c,{path:'/值'}).found,false)
})
test('工具只定位调用会话，无快照不退回初值，卡片模式拒绝',async()=>{
 assert.equal(readVariables({...chat({}),messages:[],cardStateDefaults:{秘密:1}}).available,false)
 assert.throws(()=>readVariables({...chat({}),mode:'card'}),/游玩/)
 let tool,session
 registerVariableReadTool({tools:{register:value=>tool=value},defineTool:x=>x,chatForSession:async id=>{session=id;return chat({值:3})}})
 const result=await tool.execute({action:'read',path:'/值'},{agent:{session:{id:'current'}}})
 assert.equal(session,'current');assert.equal(result.report.value,3)
})
