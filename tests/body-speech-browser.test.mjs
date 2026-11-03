import {withVoiceCues} from './helpers/voice-cues-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

// The 🔊 on a reply: the host resolves each part (speechForLine) and the one stage voice player (voice.js) plays it.
const sources = await Promise.all(['bubble-line.cjs', 'text-colors.js', 'pack-playback.cjs', 'browser-speech.cjs', 'voice.js', 'features/speech.js', 'turn-actions.js'].map(name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8').then(withVoiceCues)))
async function mount(t, text, available = true) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.on('pageerror', error => assert.fail(error.message))
  page.setDefaultTimeout(3000)
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    const React=modules.react;
    const calls=[], utterances=[], errors=[], pending=[], audios=[], prepared=[];
    let ttsOn=${available};
    const packListeners=new Set();
    function usePackRevision(select){return React.useSyncExternalStore(fn=>{packListeners.add(fn);return()=>packListeners.delete(fn);},select);}
    const ttsClient={apiVersion:1,available:()=>ttsOn,subscribe:()=>()=>{}};
    const forkForeground={now:()=>Date.now(),setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id),isAudible:()=>true,subscribeAudio:()=>()=>{},media(){}};
    const forkStageAudio={speechVolume:()=>1,prepareVoice:(audio,blob,loudness)=>prepared.push([audio.src,loudness]),release(){},voice(){}};
    const stageReading={get:()=>({voiceRate:1})};
    const tavernErrorHub={report:(...args)=>errors.push(args)};
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'chosen-voice',lang:'zh-CN'},{name:'narrator-voice',lang:'zh-CN'}],
      cancel(){const last=utterances.at(-1);if(last&&!last.done){last.done=true;last.onerror?.();}},pause(){},resume(){},speak(u){utterances.push(u);}}});
    window.SpeechSynthesisUtterance=function(text){this.text=text;};
    window.Audio=class{constructor(src){this.src=src;this.paused=true;audios.push(this);}load(){}play(){this.paused=false;this.onplay?.();return Promise.resolve();}pause(){if(this.paused)return;this.paused=true;this.onpause?.();}};
    async function rpc(method,args,sessionId){calls.push({method,args,sessionId});
      if(window.skipNarration&&args.narration)return {skip:true,reason:'narration'};
      const reply=window.audioReply?{url:'/tts-audio?ticket='+calls.length,mediaType:'audio/wav',loudness:{gain:1.5}}:{browser:true,voice:args.narration?'narrator-voice':'chosen-voice',text:args.text};
      if(window.deferSpeech)return new Promise(resolve=>pending.push(()=>resolve(reply)));return reply;}
    const useTavernSessionMode=()=> 'story',isPlayMode=mode=>mode==='story';
    const latestTavernAssistantMessageId=()=> 'latest';
    const props={sessionId:'game',messageId:'older',useChat:select=>select({legacy:{nodes:[{kind:'assistant',messageId:'older',blocks:[{kind:'reasoning',text:'不能念的思考'},{kind:'text',text:${JSON.stringify(text)}}]}]}})};
    ${sources.join('\n')}
    ReceiptButton=()=>null;
    forkTtsScope={get:name=>name==='ttsClient'?ttsClient:undefined};
    voicePlayer.setEnabled(true);
    modules["react-dom/client"].createRoot(document.getElementById('root')).render(React.createElement(TurnActions,props));
    window.fixture={calls,utterances,audios,prepared,errors,
      setTts(on){ttsOn=on;packListeners.forEach(fn=>fn());},
      end(){const u=utterances.at(-1);u.done=true;u.onend();},
      endAudio(){const a=audios.at(-1);a.paused=true;a.onended();},
      release:()=>pending.shift()()};
  ` })
  return page
}

test('每条正文都有朗读按钮，经舞台语音播放器按原文顺序分段播放，第二次点击停止后续段落', async t => {
  const text = '月光落在窗边。'.repeat(260) + '\n@bubble:lin|林月|喜悦|[你好。]\n<script>不能念的脚本</script>'
  const page = await mount(t, text)
  const button = page.getByRole('button', { name: '朗读正文', exact: true })
  await button.click()
  await page.getByRole('button', { name: '停止朗读', exact: true }).waitFor()
  await page.waitForFunction(() => fixture.utterances.length === 1)
  let state = await page.evaluate(() => ({calls:fixture.calls,voices:fixture.utterances.map(u=>u.voice.name)}))
  assert.equal(state.calls[0].method, 'speechForLine')
  assert.equal(state.calls[0].sessionId, 'game')
  assert.equal(state.calls[0].args.speaker, '')
  assert.equal(state.calls[0].args.narration, true, '叙述段落交给宿主的旁白声音')
  assert.deepEqual(state.voices, ['narrator-voice'])
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => fixture.utterances.length === 2)
  await page.getByRole('button', { name: '停止朗读', exact: true }).click()
  await button.waitFor()
  await page.waitForTimeout(30)
  state = await page.evaluate(() => ({calls:fixture.calls,errors:fixture.errors,last:fixture.utterances.at(-1).done}))
  assert.equal(state.calls.length, 2)
  assert.equal(state.last, true, '停止取消正在说的那句')
  assert.deepEqual(state.errors, [])
  const said = state.calls.map(call=>call.args.text).join('')
  assert.ok(state.calls.every(call=>[...call.args.text].length<=1000))
  assert.ok(!/思考|脚本|@bubble|喜悦/.test(said))
  // Starting again reads to the final paragraph rather than silently truncating at 1000 characters.
  await button.click()
  for (let i=3;i<=5;i++) { await page.waitForFunction(n => fixture.utterances.length === n, i); await page.evaluate(() => fixture.end()) }
  await button.waitFor()
  assert.equal(await page.evaluate(() => fixture.calls.slice(2).map(c=>c.args.text).join('')), '月光落在窗边。'.repeat(260)+'你好。')
  assert.deepEqual(await page.evaluate(() => fixture.utterances.slice(2).map(u=>u.voice.name)), ['narrator-voice','narrator-voice','chosen-voice'])
})

test('语音服务未启用时不显示正文朗读按钮，启用后出现', async t => {
  const page = await mount(t, '正文', false)
  await page.locator('.dsh-fork-turn-actions').waitFor({state:'attached'})
  assert.equal(await page.getByRole('button', {name:'朗读正文',exact:true}).count(),0)
  await page.evaluate(() => fixture.setTts(true))
  await page.getByRole('button', {name:'朗读正文',exact:true}).waitFor()
})

test('准备语音时也能停止，合成返回后不会继续播放', async t => {
  const page = await mount(t, '正文。'.repeat(500))
  await page.evaluate(() => { window.deferSpeech = true })
  await page.getByRole('button', {name:'朗读正文',exact:true}).click()
  await page.waitForFunction(() => fixture.calls.length === 1)
  await page.getByRole('button', {name:'停止朗读',exact:true}).click()
  await page.evaluate(() => fixture.release())
  await page.getByRole('button', {name:'朗读正文',exact:true}).waitFor()
  await page.waitForTimeout(30)
  assert.deepEqual(await page.evaluate(() => [fixture.calls.length,fixture.utterances.length,fixture.errors.length]),[1,0,0])
})

test('服务端将旁白设为静音时，跳过旁白后仍继续朗读对白', async t => {
  const page = await mount(t, '她笑着说：“你好。”随后离开。')
  await page.evaluate(() => { window.skipNarration = true })
  await page.getByRole('button', {name:'朗读正文',exact:true}).click()
  await page.waitForFunction(() => fixture.utterances.length === 1)
  assert.equal(await page.evaluate(() => fixture.utterances[0].text), '“你好。”')
  await page.evaluate(() => fixture.end())
  await page.getByRole('button', {name:'朗读正文',exact:true}).waitFor()
  assert.equal(await page.evaluate(() => fixture.calls.length), 3)
  assert.equal(await page.evaluate(() => fixture.utterances.length), 1)
})

test('语音服务的音频按响度接入混音器播放，停止时暂停正在播放的音频', async t => {
  const page = await mount(t, '她说：“早上好。”雨停了。')
  await page.evaluate(() => { window.audioReply = true })
  await page.getByRole('button', {name:'朗读正文',exact:true}).click()
  await page.waitForFunction(() => fixture.audios.length === 1 && !fixture.audios[0].paused)
  await page.evaluate(() => fixture.endAudio())
  await page.waitForFunction(() => fixture.audios.length === 2 && !fixture.audios[1].paused)
  assert.deepEqual(await page.evaluate(() => fixture.prepared), [['/tts-audio?ticket=1',{gain:1.5}],['/tts-audio?ticket=2',{gain:1.5}]])
  await page.getByRole('button', {name:'停止朗读',exact:true}).click()
  await page.getByRole('button', {name:'朗读正文',exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(() => [fixture.audios[1].paused,fixture.calls.length,fixture.utterances.length]), [true,2,0])
})
