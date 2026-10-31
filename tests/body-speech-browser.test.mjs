import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const sources = await Promise.all(['bubble-line.cjs', 'text-colors.js', 'features/speech.js', 'turn-actions.js'].map(name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')))
async function mount(t, text, enabled = true, narratorVoice = 'narrator-voice') {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.on('pageerror', error => assert.fail(error.message))
  page.setDefaultTimeout(3000)
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `
    const React=modules.react;
    const calls=[], utterances=[], errors=[], pending=[];
    const forkStageAudio={speechVolume:()=>1,voiceActivity(){},subscribe:()=>()=>{}};
    const forkForeground={isAudible:()=>true,subscribeAudio:()=>()=>{}};
    const tavernErrorHub={report:(...args)=>errors.push(args)};
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'chosen-voice',lang:'zh-CN'},{name:'narrator-voice',lang:'zh-CN'}],cancel(){},pause(){},resume(){},speak(u){utterances.push(u);u.onstart?.();}}});
    window.SpeechSynthesisUtterance=function(text){this.text=text;};
    async function rpc(method,args,sessionId){calls.push({method,args,sessionId});if(window.skipNarration&&args.narration)return {skip:true,reason:'narration'};const reply={browser:true,voice:args.narration?'narrator-voice':'chosen-voice',text:args.text};if(window.deferSpeech)return new Promise(resolve=>pending.push(()=>resolve(reply)));return reply;}
    const useTavernSessionMode=()=> 'story',isPlayMode=mode=>mode==='story';
    const latestTavernAssistantMessageId=()=> 'latest';
    const props={sessionId:'game',messageId:'older',useChat:select=>select({legacy:{nodes:[{kind:'assistant',messageId:'older',blocks:[{kind:'reasoning',text:'不能念的思考'},{kind:'text',text:${JSON.stringify(text)}}]}]}})};
    ${sources.join('\n')}
    ReceiptButton=()=>null;
    tavernSpeechSettings.set({enabled:${enabled},provider:'browser',providers:[{id:'browser',voice:'chosen-voice',narratorVoice:${JSON.stringify(narratorVoice)}}]});
    modules["react-dom/client"].createRoot(document.getElementById('root')).render(React.createElement(TurnActions,props));
    window.fixture={setNarrator:narratorVoice=>tavernSpeechSettings.set({...tavernSpeechSettings.get(),providers:[{id:'browser',voice:'chosen-voice',narratorVoice}]}),calls,utterances,errors,end(){utterances.at(-1).onend();},stop:()=>tavernSpeech.stop(),release:()=>pending.shift()()};
  ` })
  return page
}

test('每条正文都有朗读按钮，按所选声音完整分段播放，第二次点击停止后续段落', async t => {
  const text = '月光落在窗边。'.repeat(260) + '\n@bubble:lin|林月|喜悦|[你好。]\n<script>不能念的脚本</script>'
  const page = await mount(t, text)
  const button = page.getByRole('button', { name: '朗读正文', exact: true })
  await button.click()
  await page.getByRole('button', { name: '停止朗读', exact: true }).waitFor()
  let state = await page.evaluate(() => ({calls:fixture.calls,voices:fixture.utterances.map(u=>u.voice.name)}))
  assert.equal(state.calls[0].method, 'speechForLine')
  assert.equal(state.calls[0].sessionId, 'game')
  assert.equal(state.calls[0].args.speaker, '')
  assert.equal(state.calls[0].args.narration, true, '叙述段落使用旁白声音')
  assert.deepEqual(state.voices, ['narrator-voice'])
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => fixture.calls.length === 2)
  await page.getByRole('button', { name: '停止朗读', exact: true }).click()
  await button.waitFor()
  await page.waitForTimeout(30)
  state = await page.evaluate(() => ({calls:fixture.calls,errors:fixture.errors}))
  assert.equal(state.calls.length, 2)
  assert.deepEqual(state.errors, [])
  const said = state.calls.map(call=>call.args.text).join('')
  assert.ok(state.calls.every(call=>[...call.args.text].length<=1000))
  assert.ok(!/思考|脚本|@bubble|喜悦/.test(said))
  // Starting again can read to the final paragraph rather than silently truncating at 1000 characters.
  await button.click()
  await page.waitForFunction(() => fixture.calls.length === 3)
  for (let i=0;i<3;i++) { await page.evaluate(() => fixture.end()); await page.waitForTimeout(30) }
  await button.waitFor()
  assert.equal(await page.evaluate(() => fixture.calls.slice(2).map(c=>c.args.text).join('')), '月光落在窗边。'.repeat(260)+'你好。')
})

test('配音未开启时不显示不可用的正文朗读按钮', async t => {
  const page = await mount(t, '正文', false)
  await page.locator('.dsh-fork-turn-actions').waitFor({state:'attached'})
  assert.equal(await page.getByRole('button', {name:'朗读正文',exact:true}).count(),0)
})


test('准备语音时也能停止，合成返回后不会继续播放', async t => {
  const page = await mount(t, '正文。'.repeat(500))
  await page.evaluate(() => { window.deferSpeech = true })
  await page.getByRole('button', {name:'朗读正文',exact:true}).click()
  await page.waitForFunction(() => fixture.calls.length === 1)
  await page.getByRole('button', {name:'停止朗读',exact:true}).click()
  await page.evaluate(() => fixture.release())
  await page.getByRole('button', {name:'朗读正文',exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(() => [fixture.calls.length,fixture.utterances.length,fixture.errors.length]),[1,0,0])
})


test('旁白声音留空时只读对白，设置旁白声音后按原文顺序切换两种声音', async t => {
  const source = '窗外下着雨。她说：“早上好。”\n@bubble:lin|林月|喜悦|[你好。]\n@bubble:lin|林月||[*内心独白*]\n雨停了。'
  const page = await mount(t, source, true, '')
  await page.getByRole('button', {name:'朗读对白',exact:true}).click()
  await page.waitForFunction(() => fixture.utterances.length === 1)
  assert.equal(await page.evaluate(() => fixture.calls[0].args.text), '“早上好。” 你好。')
  assert.equal(await page.evaluate(() => fixture.calls[0].args.narration), false)
  await page.evaluate(() => fixture.setNarrator('narrator-voice'))
  await page.getByRole('button', {name:'朗读正文',exact:true}).click()
  await page.waitForFunction(() => fixture.utterances.length === 2)
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => fixture.utterances.length === 3)
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => fixture.utterances.length === 4)
  assert.deepEqual(await page.evaluate(() => fixture.calls.slice(1).map(c=>[c.args.text,c.args.narration])), [
    ['窗外下着雨。她说：',true], ['“早上好。” 你好。',false], ['内心独白 雨停了。',true]
  ])
  assert.deepEqual(await page.evaluate(() => fixture.utterances.slice(1).map(u=>u.voice.name)), ['narrator-voice','chosen-voice','narrator-voice'])
  await page.evaluate(() => fixture.setNarrator(''))
  await page.getByRole('button', {name:'朗读对白',exact:true}).waitFor()
})

test('旁白声音留空遇到纯旁白时禁用按钮，不误读整段正文', async t => {
  const page = await mount(t, '只有窗外的雨声。', true, '')
  const button = page.getByRole('button', {name:'朗读对白',exact:true})
  await button.waitFor()
  assert.equal(await button.isDisabled(), true)
  assert.equal(await button.getAttribute('title'), '本轮没有可朗读的对白')
  assert.equal(await page.evaluate(() => fixture.calls.length), 0)
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
