import test from 'node:test'
import assert from 'node:assert/strict'

import { createWorldbookRecallLog } from '../tavern-plugin/lib/domain/worldbook-recall-log.js'

test('独立日志不覆盖同轮其他操作，关联实际 Frame 请求；不存在的旧轮次不伪造', async () => {
 const data=new Map();const clone=v=>v===undefined?undefined:structuredClone(v)
 const store={readJson:async p=>clone(data.get(p)),writeJson:async(p,v)=>data.set(p,clone(v)),updateJson:async(p,fn)=>data.set(p,clone(await fn(clone(data.get(p)))))}
 const logs=createWorldbookRecallLog({store,now:()=>100})
 const chat={id:'chat-1',sessionId:'test-1',timeline:{branchId:'branch-1'},foregroundFrames:{}}
 const frame={turn:2,operationId:'op-1',frameId:'frame-1',branchId:'branch-1',basedOnRevision:1,source:{worldBook:{}}}
 const log={entries:[],outputs:[{ref:'a',text:'实际正文',location:'foreground'}]}
 frame.source.worldBook.recallLog=await logs.record({chat,frame,log});chat.foregroundFrames[frame.operationId]=frame
 await logs.requested(chat,{messages:[{source:{form:'foreground-frame',trace:{frameId:'frame-1'}},content:[{type:'text',text:'前缀\n实际正文'}]}]},'request-1')
 const result=await logs.read(chat,2)
 assert.equal(result.log.status,'requested');assert.deepEqual(result.log.requestIds,['request-1'])
 assert.equal(result.log.outputs[0].requestContainsText,true)
 assert.equal((await logs.read(chat,1)).log,null)
 await logs.record({chat,frame:{...frame,operationId:'op-2'},log})
 assert.equal(data.get('worldbook-recalls/chat-1/index.json').records.length,2)
 assert.equal((await logs.read(chat,2)).log.operationId,'op-2')
 await assert.rejects(logs.record({chat:{...chat,id:'../escape'},frame,log}),/标识/)
})
