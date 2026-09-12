// Opt-in paid real-model experiment. Public repository Avra demo; never loads player saves.
// Patch execution is an isolated typed-field adapter, not browser/official MVU.
// Raw requests/responses contain public demo material only; credentials are not saved.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const card=JSON.parse(await readFile(new URL('../../demo/cards/avra-complete.json', import.meta.url),'utf8'));
import {createMvuSettlementModule} from '../../tavern-plugin/lib/domain/mvu-background-settlement.js';
const dir=process.argv[2];
assert.ok(dir && process.env.DEEPSEEK_API_KEY, 'Usage: DEEPSEEK_API_KEY=... node docs/experiments/settlement-three-round-play.mjs OUTPUT_DIR');
await mkdir(dir, {recursive:true});
const initial={stat_data:{时间:'雨夜 · 二更',地点:'金麦穗酒馆',天气:'暴雨封城',线索:'乌鸦黑蜡信封',信任:18,状态:'冷静观察'}};
const rules=[card.data.description,card.data.personality,card.data.scenario,
 '保持奇幻悬疑基调。阿芙拉只有在确认黑蜡信封或其他可信凭证后，才谈银铃商队的核心线索。信任必须是 0 到 100 的整数。',
 '依据本轮正文维护时间、地点、天气、线索、信任、状态六个字段；原卡状态栏通过变量工具提交，不再输出状态块。'];
const actions=[
 '我把乌鸦黑蜡信封放到吧台上，请阿芙拉检查真伪；先不追问她的过去。',
 '我按她刚才透露的情况回应，帮她收拾漏雨的门边，承诺不把今晚的谈话告诉其他客人。',
 '第二天傍晚我再次来到酒馆，问她是否愿意告诉我一条能安全核实的银铃商队线索。不要强迫她答应。'
];
const foreground=[{role:'system',content:[card.data.description,card.data.personality,card.data.scenario,...card.data.character_book.entries.filter(e=>e.enabled).map(e=>e.content),'你负责小说正文续写。遵守人物设定和已有剧情，写200到400字；不输出状态栏或变量协议，变量由后台工具维护。'].join('\n\n')},{role:'assistant',content:card.data.first_mes.replace(/<avra_status>[\s\S]*?<\/avra_status>/g,'').trim()}];
const summaries=[];
let carried=structuredClone(initial);
await writeFile(`${dir}/current-state.json`,JSON.stringify(carried,null,2));
for(let turn=1;turn<=3;turn++){
 const id=`round-${turn}`,steps=[],toolCalls=[];
 const baseline=JSON.parse(await readFile(`${dir}/current-state.json`,'utf8'));
 assert.deepEqual(baseline,carried);
 let state=structuredClone(baseline);
 foreground.push({role:'user',content:'【最新结算状态】\n'+JSON.stringify(baseline)+'\n【玩家行动】\n'+actions[turn-1]});
 const fgBody={model:'deepseek-v4-flash',messages:structuredClone(foreground),temperature:0.8,thinking:{type:'enabled'},reasoning_effort:'high',max_tokens:6000,stream:false};
 const fgResponse=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(fgBody),signal:AbortSignal.timeout(240000)});
 assert.ok(fgResponse.ok,`foreground HTTP ${fgResponse.status}`);
 const fgData=await fgResponse.json();assert.equal(fgData.choices[0].finish_reason,'stop');
 const storyText=fgData.choices[0].message.content;assert.ok(storyText?.trim());
 foreground.push({role:'assistant',content:storyText});
 await writeFile(`${dir}/${id}-foreground.json`,JSON.stringify({request:fgBody,response:fgData},null,2));
 await writeFile(`${dir}/${id}-story.md`,storyText);
 console.log('STORY',JSON.stringify({turn,chars:storyText.length,usage:fgData.usage}));
 const module=createMvuSettlementModule({model:{async run(input){
 const system=input.system;
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
 for(const call of msg.tool_calls){const answer=await input.onToolCall({name:call.function.name,arguments:JSON.parse(call.function.arguments)});toolCalls.push({name:call.function.name,feedback:JSON.parse(answer)});messages.push({role:'tool',tool_call_id:call.id,content:answer});}
 if(input.stopToolsWhen() && input.acceptWithoutText())return {text:'',traceSessionId:id};
 }
 throw Error('step cap');
 }},runtime:{async settleMvuUpdate(input){
 const ops=JSON.parse(input.command.match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/)[1]);
 const before=structuredClone(state);

 try {
 for(const op of ops){const seg=op.path.split('/').slice(1).map(s=>s.replaceAll('~1','/').replaceAll('~0','~'));assert.equal(seg.length,1);assert.ok(Object.hasOwn(state.stat_data,seg[0]));assert.ok(['replace','add','insert','delta'].includes(op.op));const value=op.op==='delta'?state.stat_data[seg[0]]+op.value:op.value;if(seg[0]==='信任'){assert.ok(Number.isInteger(value)&&value>=0&&value<=100)}else{assert.equal(typeof value,'string')}state.stat_data[seg[0]]=value;}
 } catch(error) { state=before; return {rejected:true,context:{messages:[{variables:state}]},validation:{changes:[],sideEffects:[],failures:[{message:'变量路径必须是已有字段；信任必须是0到100整数，其余字段必须为字符串。'}]}}; }
 const validation=input.validate({before,after:state});
 await writeFile(`${dir}/${id}-state.json`,JSON.stringify(state,null,2));
 return {context:{messages:[{variables:state}]},validation};
 }}});
 const result=await module.settleVariables({operationId:id,chatId:'three-round-game',branchId:'test',basedOnRevision:turn,sessionId:'three-round-game',messageId:0,swipeId:0,storyText,currentVariables:structuredClone(baseline),updateRules:rules,backgroundTasks:{posture:true,variables:true,characterDesign:false},system:await readFile(new URL('../../tavern-plugin/prompts/posture-settlement.md', import.meta.url),'utf8')});
 assert.ok(result.posture);assert.equal(result.receipt.failures.length,0,JSON.stringify(result.receipt));assert.deepEqual(JSON.parse(await readFile(`${dir}/${id}-state.json`,'utf8')),result.variables);
 assert.equal(toolCalls.filter(x=>x.name==='posture_submit').length,1,'successful posture must not be repeated');
 assert.equal(toolCalls.filter(x=>x.name==='mvu_submit_update').length,1);
 carried=JSON.parse(await readFile(`${dir}/${id}-state.json`,'utf8'));
 await writeFile(`${dir}/current-state.json`,JSON.stringify(carried,null,2));
 const summary={id,baseline,foregroundUsage:fgData.usage,storyText,toolCalls,reasoning:steps.reduce((s,r)=>s+(r.usage.completion_tokens_details?.reasoning_tokens||0),0),steps:steps.length,input:steps.reduce((s,r)=>s+r.usage.prompt_tokens,0),output:steps.reduce((s,r)=>s+r.usage.completion_tokens,0),ms:steps.reduce((s,r)=>s+r.ms,0),toolNames:steps.map(s=>s.toolNames),receipt:result.receipt.status,posture:result.posture,state:result.variables};summaries.push(summary);await writeFile(`${dir}/summary.json`,JSON.stringify(summaries,null,2));console.log('DONE',JSON.stringify(summary));
}
