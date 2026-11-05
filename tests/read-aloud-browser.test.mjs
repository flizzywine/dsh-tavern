import {withVoiceCues} from './helpers/voice-cues-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

const sources = await Promise.all(['bubble-line.cjs', 'text-colors.js', 'pack-playback.cjs', 'browser-speech.cjs', 'voice.js', 'features/speech.js', 'features/read-aloud.js'].map(name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8').then(withVoiceCues)))
const OLD = '旧的一轮。'
const BODY = '夜色很深。'.repeat(240) + '\n@bubble:lin|林月|喜悦|[你好。]\n@bubble:lin|林月|平静|[*她在想什么呢*]\n她笑着说：“走吧。”'

async function mount(t, {auto = true, stepAside = false, nodes = [{kind:'assistant', messageId:'m1', blocks:[{kind:'text', text:OLD}]}]} = {}) {
  const browser = await chromium.launch({headless:true, args:['--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.on('pageerror', error => assert.fail(error.message))
  page.setDefaultTimeout(3000)
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({content: await browserReactScript()})
  await page.addScriptTag({content: `
    const React=modules.react;
    const calls=[], utterances=[], errors=[];
    const packListeners=new Set();
    function usePackRevision(select){return React.useSyncExternalStore(fn=>{packListeners.add(fn);return()=>packListeners.delete(fn);},select);}
    const ttsClient={apiVersion:1,available:()=>true,subscribe:()=>()=>{}};
    const forkForeground={now:()=>Date.now(),setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id),isAudible:()=>true,subscribeAudio:()=>()=>{},media(){}};
    const forkStageAudio={speechVolume:()=>1,prepareVoice(){},release(){},voice(){},keepAwake(){},diagnostics:()=>({speaking:true,prefs:{voice:1,master:1},ducking:{},tracks:[]})};
    const stageReading={get:()=>({voiceRate:1})};
    const tavernErrorHub={report:(...args)=>errors.push(args)};
    const galActive={subscribe:()=>()=>{},get:()=>''};
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'general-voice',lang:'zh-CN'}],
      cancel(){const last=utterances.at(-1);if(last&&!last.done){last.done=true;last.onerror?.();}},pause(){},resume(){},speak(u){utterances.push(u);}}});
    window.SpeechSynthesisUtterance=function(text){this.text=text;};
    let auto=${auto},stepAside=${stepAside};
    async function rpc(method,args,sessionId){calls.push({method,args,sessionId});
      if(method==='readAloudState')return {stepAside,auto};
      return {browser:true,voice:'general-voice',text:args.text};}
    function latestTavernAssistantMessageId(snapshot){const nodes=snapshot&&snapshot.legacy&&snapshot.legacy.nodes||[];
      for(let i=nodes.length-1;i>=0;i--)if(nodes[i].kind==='assistant'&&nodes[i].messageId)return nodes[i].messageId;return null;}
    ${sources.join('\n')}
    forkTtsScope={get:name=>name==='ttsClient'?ttsClient:undefined};
    voicePlayer.setEnabled(true);
    let chat={legacy:{nodes:${JSON.stringify(nodes)},partial:null}};
    const chatListeners=new Set();
    const useChat=select=>React.useSyncExternalStore(fn=>{chatListeners.add(fn);return()=>chatListeners.delete(fn);},()=>select(chat));
    // The chat: one action row under every finished reply, as the assistant-actions slot draws them.
    function Chat(){const ids=useChat(s=>s.legacy.nodes.filter(n=>n.kind==='assistant').map(n=>n.messageId).join(','));
      return ids.split(',').filter(Boolean).map(id=>React.createElement('div',{key:id,'data-message':id},React.createElement(TavernReadAloudAction,{sessionId:'game',messageId:id,useChat})));}
    let root=null;
    function render(){root=modules["react-dom/client"].createRoot(document.getElementById('root'));root.render(React.createElement(Chat));}
    render();
    window.fixture={calls,utterances,errors,
      lines:()=>calls.filter(c=>c.method==='readAloudLine'),
      set(next){chat={legacy:{...chat.legacy,...next}};chatListeners.forEach(fn=>fn());},
      nodes:()=>chat.legacy.nodes,
      remount(){root.unmount();render();},
      end(){const u=utterances.at(-1);u.done=true;u.onend();}};
  `})
  return page
}
const userTurn = (page, text = '出发') => page.evaluate(text => fixture.set({nodes:[...fixture.nodes(), {kind:'user', blocks:[{kind:'text', text}]}]}), text)
const stream = page => page.evaluate(() => fixture.set({partial:{turn:2, blocks:[{kind:'text', text:'夜色'}]}}))
const finish = (page, id = 'm2', text = BODY) => page.evaluate(([id, text]) => fixture.set({partial:null, nodes:[...fixture.nodes(), {kind:'assistant', messageId:id, blocks:[{kind:'reasoning', text:'不能念的思考'}, {kind:'text', text}]}]}), [id, text])
const lines = page => page.evaluate(() => fixture.lines())

test('流式结束的回复被完整朗读一次：全部按非旁白、无说话人交给宿主的通用声音，按段落分块', async t => {
  const page = await mount(t)
  await userTurn(page); await stream(page); await finish(page)
  await page.locator('[data-message="m2"]').getByRole('button', {name:'停止朗读', exact:true}).waitFor()
  const idle = page.locator('[data-message="m2"]').getByRole('button', {name:'朗读', exact:true})
  for (let n = 1; n < 10 && !await idle.count(); n++) {
    await page.waitForFunction(n => fixture.utterances.length === n, n)
    await page.evaluate(() => fixture.end())
    await page.waitForTimeout(30)
  }
  await idle.waitFor()
  const said = await lines(page)
  assert.ok(said.length >= 2, '超过 1000 字的正文分块请求')
  assert.ok(said.every(call => call.args.narration === false && call.args.speaker === '' && call.sessionId === 'game'))
  assert.ok(said.every(call => [...call.args.text].length <= 1000))
  const text = said.map(call => call.args.text).join('')
  for (const part of ['夜色很深。', '你好。', '她在想什么呢', '她笑着说：', '“走吧。”']) assert.ok(text.includes(part), part)
  assert.ok(!/思考|@bubble|喜悦|旧的一轮/.test(text))
  assert.equal(text.replace(/\s/g, '').length, ('夜色很深。'.repeat(240) + '你好。她在想什么呢她笑着说：“走吧。”').length)
  await page.evaluate(() => fixture.remount())
  await page.waitForTimeout(80)
  assert.equal((await lines(page)).length, said.length, '读完后重挂载不会再读')
  assert.deepEqual(await page.evaluate(() => fixture.errors), [])
})

test('刷新或重挂载一条已完成的回复都不朗读', async t => {
  const page = await mount(t, {nodes:[{kind:'assistant', messageId:'m1', blocks:[{kind:'text', text:OLD}]}, {kind:'user', blocks:[{kind:'text', text:'走'}]}, {kind:'assistant', messageId:'m2', blocks:[{kind:'text', text:BODY}]}]})
  await page.locator('[data-message="m2"]').getByRole('button', {name:'朗读', exact:true}).waitFor()
  await page.evaluate(() => fixture.remount())
  await page.locator('[data-message="m2"]').getByRole('button', {name:'朗读', exact:true}).waitFor()
  await page.waitForTimeout(80)
  assert.deepEqual(await lines(page), [])
})

test('全文朗读关闭时流式结束也不朗读', async t => {
  const page = await mount(t, {auto:false})
  await userTurn(page); await stream(page); await finish(page)
  await page.waitForFunction(() => fixture.calls.some(c => c.method === 'readAloudState'))
  await page.waitForTimeout(80)
  assert.deepEqual(await lines(page), [])
})

test('新一轮玩家输入停止正在进行的全文朗读', async t => {
  const page = await mount(t)
  await userTurn(page); await stream(page); await finish(page)
  await page.waitForFunction(() => fixture.utterances.length === 1)
  await userTurn(page, '再走')
  await page.locator('[data-message="m2"]').getByRole('button', {name:'朗读', exact:true}).waitFor()
  await page.waitForTimeout(50)
  assert.deepEqual(await page.evaluate(() => [fixture.utterances.length, fixture.utterances[0].done, fixture.lines().length]), [1, true, 1])
})

test('回复下的 🔊 停止正在进行的全文朗读', async t => {
  const page = await mount(t)
  await userTurn(page); await stream(page); await finish(page)
  await page.waitForFunction(() => fixture.utterances.length === 1)
  await page.locator('[data-message="m2"]').getByRole('button', {name:'停止朗读', exact:true}).click()
  await page.locator('[data-message="m2"]').getByRole('button', {name:'朗读', exact:true}).waitFor()
  await page.waitForTimeout(50)
  assert.deepEqual(await page.evaluate(() => [fixture.utterances[0].done, fixture.lines().length]), [true, 1])
})


test('plain prose reads once after a watched stream', async t => {
  const page = await mount(t)
  await userTurn(page); await stream(page); await finish(page,'m2','Only plain prose.')
  await page.waitForFunction(() => fixture.utterances.length === 1)
  await page.evaluate(() => fixture.end())
  await page.getByRole('button',{name:'朗读',exact:true}).last().waitFor()
  assert.equal((await lines(page)).length,1)
  assert.equal((await lines(page))[0].args.text,'Only plain prose.')
})

test('stage voicing shows only the character action and suppresses auto-read', async t => {
  const page = await mount(t,{stepAside:true})
  await userTurn(page); await stream(page); await finish(page)
  await page.locator('[data-message="m2"]').getByRole('button',{name:'朗读正文',exact:true}).waitFor()
  assert.equal(await page.locator('[data-message="m2"] button').count(),1)
  assert.deepEqual(await lines(page),[])
})