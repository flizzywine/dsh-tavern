// Opt-in paid real-model experiment. Fixed public CC0 demo; never loads player saves.
// Patch execution is an isolated string-field adapter, not browser/official MVU.
// Raw requests/responses contain public demo material only; credentials are not saved.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {card} from '../../examples/manual-demo/resources.mjs';
import {createMvuSettlementModule} from '../../tavern-plugin/lib/domain/mvu-background-settlement.js';
const dir=process.argv[2];
assert.ok(dir && process.env.DEEPSEEK_API_KEY, 'Usage: DEEPSEEK_API_KEY=... node docs/experiments/settlement-tool-protocol-ab.mjs OUTPUT_DIR');
await mkdir(dir, {recursive:true});
const entries=card.data.character_book.entries;
const initial={stat_data:JSON.parse(entries.find(e=>e.comment.startsWith('[initvar]')).content)};
const rules=entries.filter(e=>e.comment.startsWith('[mvu_update]')).map(e=>e.content);
const scenarios={clear:'当晚八点，雨已经停了。邮递员和林澄走进旧花店，停在柜台旁。邮递员把旧地址簿交给林澄保管，自己的邮差包里仍装着未署名的信。林澄站在柜台前，翻开地址簿，指着一行地址说：“蓝色鸢尾花印章属于这家花店，但寄信人还没有确定。”邮递员站在她左侧，低头查看那行字。',montage:'从第二天起，邮递员和林澄每天一起走访镇上的邻居。有时在邮局查旧地址簿，有时在码头询问旧花店的往事。几天过去，仍没有确认寄信人。最后一个傍晚，小雨再次落下，两人回到灯塔镇邮局。邮递员坐在柜台旁，邮差包、旧地址簿和未署名的信都放在自己面前；林澄站在窗边，收起湿雨伞。她说：“现在只能确定印章来自旧花店，其他还得继续查。”'};
const summaries=[];
for(let repeat=1;repeat<=2;repeat++)for(const [scenario,storyText] of Object.entries(scenarios))for(const arm of (repeat===1?['serial','joint']:['joint','serial'])){
 const id=`${scenario}-${repeat}-${arm}`,steps=[];let state=structuredClone(initial);
 const module=createMvuSettlementModule({model:{async run(input){
 let system=input.system;
 if(arm==='serial')system=system.replace('在同一次回复中同时调用 posture_submit 和 mvu_submit_update，分别提交本轮结束时可见的人物姿势与变量变化；两者互不依赖，无需等待前一个工具返回。不得在回复正文输出 JSON。','调用 mvu_submit_update 前必须调用 posture_submit 提交本轮结束时可见的人物姿势；不得输出 JSON。');
 const messages=[{role:'system',content:'你是与前台正文生成隔离的酒馆后台 Agent。严格按本次任务协议结算。'}, {role:'user',content:`【本轮权威状态】\n${input.turnContext}\n\n【最近剧情与本次任务】\n任务类型：状态结算\n[正文]\n${storyText}\n\n【DSH 后台任务协议（最终指令）】\n${system}`}];
 const tools=input.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}));
 for(let step=1;step<=4;step++){
 const body={model:'deepseek-v4-flash',messages,tools,temperature:0.1,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:20000,stream:false};
 const start=Date.now();const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
 if(!response.ok)throw Error(`HTTP ${response.status}: ${(await response.text()).slice(0,150)}`);
 const data=await response.json();const msg=data.choices[0].message;
 const row={step,ms:Date.now()-start,usage:data.usage,finish:data.choices[0].finish_reason,toolNames:(msg.tool_calls||[]).map(t=>t.function.name),reasoningChars:(msg.reasoning_content||'').length};steps.push(row);
 await writeFile(`${dir}/${id}-step${step}.json`,JSON.stringify({request:body,response:data},null,2));
 console.log(JSON.stringify({id,...row}));
 assert.notEqual(data.choices[0].finish_reason,'length');
 messages.push(msg);assert.ok(msg.tool_calls?.length,'model failed to submit tools');
 for(const call of msg.tool_calls){const answer=await input.onToolCall({name:call.function.name,arguments:JSON.parse(call.function.arguments)});messages.push({role:'tool',tool_call_id:call.id,content:answer});}
 if(input.stopToolsWhen() && input.acceptWithoutText())return {text:'',traceSessionId:id};
 }
 throw Error('step cap');
 }},runtime:{async settleMvuUpdate(input){
 const ops=JSON.parse(input.command.match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/)[1]);
 const before=structuredClone(state);
 try {
 for(const op of ops){const seg=op.path.split('/').slice(1).map(s=>s.replaceAll('~1','/').replaceAll('~0','~'));assert.equal(seg.length,1);assert.ok(Object.hasOwn(state.stat_data,seg[0]));assert.ok(['replace','add','insert'].includes(op.op));assert.equal(typeof op.value,'string');state.stat_data[seg[0]]=op.value;}
 } catch(error) { state=before; return {rejected:true,context:{messages:[{variables:state}]},validation:{changes:[],sideEffects:[],failures:[{message:'变量路径必须是初始快照已有字段，且值必须为字符串；请核对字段名。'}]}}; }
 const validation=input.validate({before,after:state});
 await writeFile(`${dir}/${id}-state.json`,JSON.stringify(state,null,2));
 return {context:{messages:[{variables:state}]},validation};
 }}});
 const result=await module.settleVariables({operationId:id,chatId:id,branchId:'test',basedOnRevision:1,sessionId:id,messageId:0,swipeId:0,storyText,currentVariables:structuredClone(initial),updateRules:rules,backgroundTasks:{posture:true,variables:true,characterDesign:false},system:await readFile(new URL('../../tavern-plugin/prompts/posture-settlement.md', import.meta.url),'utf8')});
 assert.ok(result.posture);assert.equal(result.receipt.failures.length,0,JSON.stringify(result.receipt));assert.deepEqual(JSON.parse(await readFile(`${dir}/${id}-state.json`,'utf8')),result.variables);
 const summary={id,steps:steps.length,input:steps.reduce((s,r)=>s+r.usage.prompt_tokens,0),output:steps.reduce((s,r)=>s+r.usage.completion_tokens,0),ms:steps.reduce((s,r)=>s+r.ms,0),toolNames:steps.map(s=>s.toolNames),receipt:result.receipt.status,posture:result.posture,state:result.variables};summaries.push(summary);await writeFile(`${dir}/summary.json`,JSON.stringify(summaries,null,2));console.log('DONE',JSON.stringify(summary));
}
