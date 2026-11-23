import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
// Use only an isolated synthetic Session. stateFile contains {url,state} from
// Playwright storageState(); connectionFile contains the isolated runtime {url}.
// node tests/fixtures/long-conversation-native-perf.mjs STATE_JSON CONNECTION_JSON OUTPUT_DIR
const [stateFile,connectionFile,root]=process.argv.slice(2);
if(!stateFile||!connectionFile||!root)throw new Error('Expected STATE_JSON CONNECTION_JSON OUTPUT_DIR for an isolated synthetic session');
const count=365,rate=1,mode='fixed';
const saved=JSON.parse(await readFile(stateFile));saved.url=JSON.parse(await readFile(connectionFile)).url;
for(const origin of saved.state.origins)origin.origin=new URL(saved.url).origin;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({storageState:saved.state,viewport:{width:1440,height:1000},locale:'zh-CN'});
const page=await context.newPage(),cdp=await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate',{rate});
await cdp.send('Performance.enable');
await page.addInitScript(()=>{window.perf={long:[],keys:[],frames:[]};new PerformanceObserver(list=>{for(const x of list.getEntries())window.perf.long.push({start:x.startTime,duration:x.duration})}).observe({type:'longtask',buffered:true});document.addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>window.perf.keys.push(performance.now()-t)))},true)});
const start=Date.now();
try{
await page.goto(saved.url);
const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息或做任务|Message or run a task/});
await composer.waitFor({timeout:120000});
await page.getByText('长对话性能测试',{exact:true}).first().waitFor();
await page.waitForTimeout(3000);
const openMs=Date.now()-start-3000;
console.log(JSON.stringify({stage:'opened',count,rate,openMs}));
const loadStart=Date.now();let pages=0;
const older=page.getByRole('button',{name:'加载更早',exact:true});
while(await older.count()){
 if(pages++>40)throw new Error('history load did not finish');
 await older.click({timeout:120000});
 await page.getByRole('button',{name:'加载中…',exact:true}).waitFor({state:'hidden',timeout:120000});await page.waitForTimeout(200);console.log(JSON.stringify({page:pages,rows:await page.locator('[data-chat-flow-key]').count()}));
}
await composer.scrollIntoViewIfNeeded();
await page.waitForTimeout(1000);
const historyLoadMs=Date.now()-loadStart;console.log(JSON.stringify({stage:'loaded',pages,loadMs:historyLoadMs}));
console.log(JSON.stringify(await page.evaluate(()=>({rows:document.querySelectorAll('[data-chat-flow-key]').length,flow:document.querySelector('[data-chat-flow]')?.outerHTML.slice(0,220),scrolls:Array.from(document.querySelectorAll('*')).filter(e=>e.clientHeight>100&&e.scrollHeight>e.clientHeight+500&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({tag:e.tagName,cls:e.className,h:e.clientHeight,sh:e.scrollHeight}))}))));
await page.waitForTimeout(500);
const before=await cdp.send('Performance.getMetrics');
await page.evaluate(()=>{window.perf.long=[];window.perf.keys=[];window.perf.frames=[];window.recording=true;let prev=performance.now();function tick(now){window.perf.frames.push(now-prev);prev=now;if(window.recording)requestAnimationFrame(tick)}requestAnimationFrame(tick)});
await composer.click();
const typing=[];
for(let i=0;i<30;i++){const t=Date.now();await page.keyboard.type('a');typing.push(Date.now()-t);await page.waitForTimeout(35)}
await composer.fill('');
await page.mouse.move(750,450);
for(let i=0;i<30;i++){await page.mouse.wheel(0,-650);await page.waitForTimeout(35)}
for(let i=0;i<30;i++){await page.mouse.wheel(0,650);await page.waitForTimeout(35)}
await page.waitForTimeout(500);
const after=await cdp.send('Performance.getMetrics');
const result=await page.evaluate(()=>{window.recording=false;return {...window.perf,rows:document.querySelectorAll('[data-chat-flow-key]').length,dom:document.querySelectorAll('*').length,iframes:document.querySelectorAll('iframe').length,chars:document.querySelector('[data-chat-flow]')?.textContent.length}});
const stat=xs=>{const a=xs.slice().sort((a,b)=>a-b);return {n:a.length,p50:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0,max:a.at(-1)||0}};
const metrics=Object.fromEntries(after.metrics.map(m=>[m.name,m.value-(before.metrics.find(x=>x.name===m.name)?.value||0)]));
const report={verdict:Math.max(...typing)>200||result.long.some(x=>x.duration>200)?'STALL':'PASS',count,rate,mode,openMs,historyLoadMs,rows:result.rows,dom:result.dom,iframes:result.iframes,chars:result.chars,inputPaintMs:stat(result.keys),typeRoundtripMs:stat(typing),frameMs:stat(result.frames),framesOver50:result.frames.filter(x=>x>50).length,longTasks:stat(result.long.map(x=>x.duration)),metrics};
if(process.argv.includes('--navigation')) {
 const t=Date.now();await page.getByRole('tab',{name:'轨迹',exact:true}).click();await page.locator('[data-chat-flow]').waitFor({state:'hidden'});const trajectoryMs=Date.now()-t;
 const back=Date.now();await page.getByRole('tab',{name:'对话',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-chat-flow-key]').length>=900);await composer.waitFor();
 await page.waitForFunction(()=>Array.from(CSS.highlights.values()).some(highlight=>highlight.size>0));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 report.navigation={trajectoryMs,conversationMs:Date.now()-back};
 if(report.navigation.conversationMs>3000)report.verdict='STALL';
}
await writeFile(root+`/result-${count}-${rate}-${mode}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
await page.screenshot({path:root+`/measure-${count}-${rate}-${mode}.png`});
if(result.rows<900)throw new Error('The full synthetic history was not mounted');
if(report.verdict==='STALL')throw new Error('Long conversation exceeds the input/scroll (200 ms) or remount (3000 ms) budget');
}catch(e){console.log(String(e).replace(/https?:\/\/[^\s\"]+/g,'[test URL]'));process.exitCode=1}finally{await browser.close()}
