// 有声书 (the dsh-tavern-audiobook plugin on Tavern's reading API, story-reading.js) in a page: the switch shows the chip and
// takes the stage's voicing away (tavernUi.holdVoice), 播放 reads the story in order through the one voice player (reading voice for narration, the figure's own voice and cache key for a
// line), looks ahead, follows the sentence down the screen, and the owner's rule for where 播放 starts (11-16).
import {withVoiceCues} from './helpers/voice-cues-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8').then(withVoiceCues)
const sources = [await read('packages/dsh-presentation-protocol/src/figure-resolution.cjs'),
  ...await Promise.all(['bubble-line.cjs', 'voice-speech.cjs', 'pack-playback.cjs', 'browser-speech.cjs', 'voice.js', 'stage-page-index.cjs', 'gal-stage-helpers.cjs',
    'features/prose-layout.js', 'features/story-transcript-data.js', 'story-reading.js', 'story-reading.cjs'].map(name => read('src/client/' + name)))]
const plugin = await read('packages/dsh-tavern-audiobook/client.js')

// One reply of the story: narration and sayo's lines (her Japanese voice text), long enough for several screens.
const paragraphs = Array.from({ length: 14 }, (_, i) => i % 2
  ? `@bubble:sayo|小夜|喜悦|[第${i}句台词，小夜说。]|[だい${i}、さよ。]`
  : `第${i}段旁白，彩叶在灯下写着模拟卷。`)
const story = paragraphs.join('\n\n')

async function mount(t, { on = true } = {}) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.on('pageerror', error => assert.fail(error.message))
  page.setDefaultTimeout(4000)
  // an origin of its own: the reader keeps its settings and places in localStorage
  await page.route('http://audiobook.test/', route => route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><style>body{margin:0}</style><header id="head"></header><div id="box" data-conversation-scroll style="height:300px;overflow:auto;width:600px"><div id="rows"></div></div><main id="root"></main>` }))
  await page.goto('http://audiobook.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  // the plugin's client as Tavern's module loader receives it
  await page.addScriptTag({ content: `window.__ModuleLoader__={load({factory}){window.audiobookFactory=factory;}};\n` + plugin })
  await page.addScriptTag({ content: `
    const React=modules.react, ReactDOM=modules['react-dom'];
    localStorage.setItem('dsh-tavern-audiobook', ${JSON.stringify(on ? 'on' : 'off')});
    const calls=[], synths=[], audios=[];
    const packListeners=new Set();
    function usePackRevision(select){return React.useSyncExternalStore(fn=>{packListeners.add(fn);return()=>packListeners.delete(fn);},select);}
    const ttsClient={apiVersion:1,available:()=>true,subscribe:()=>()=>{},
      async synthesize(input){synths.push({...input,at:performance.now()});await new Promise(r=>setTimeout(r,window.synthMs||0));if(window.synthDown)throw Object.assign(new Error(window.synthDown),{code:window.synthDown});return {ticket:'t'+synths.length,key:'k'+synths.length};},
      async audio(){return new Blob(['x'],{type:'audio/wav'});}};
    const forkForeground={now:()=>Date.now(),setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:id=>clearInterval(id),media(){}};
    const forkStageAudio={prepareVoice(){},release(){},voice(){},mask(){},keepAwake(){}};
    const stageReading={get:()=>({voiceRate:1})};
    const galActive={subscribe:()=>()=>{},get:()=>''};
    var stageViews=null, packTransport=null, tavernSessionSignals=null;
    window.Audio=class{constructor(src){this.src=src;this.paused=true;this.volume=1;this.playbackRate=1;audios.push(this);}load(){}play(){this.paused=false;this.playedAt=performance.now();this.onplay?.();return Promise.resolve();}pause(){if(this.paused)return;this.paused=true;this.onpause?.();}};
    const config={voice:{enabled:true},characters:[{alias:'sayo',name:'小夜',voice:{voice:'v'},voiceKey:'sayo-voice',voiceLanguage:'ja'}]};
    const bubbleStore={get:()=>({config})};
    const bubbleMood=()=>null, bubbleMoodList=()=>[];
    const transcript={messages:[{key:'turn:1',floorNo:1,message:{role:'assistant',displayText:${JSON.stringify(story)}}}]};
    async function rpc(method,args,sessionId){calls.push({method,args,sessionId});
      if(method==='getStoryTranscript')return {storyTranscript:transcript};
      if(method==='openReadingVoice')return {available:true,voice:{source:'reading:r',id:'voice'},language:'zh',scope:'dsh-browser'};
      if(method==='openAssetPackVoice')return {available:true,voice:{source:'pack:'+args.alias,id:'voice'},language:'ja',scope:'card'};
      throw new Error(method);}
    const h=React.createElement, Icon=()=>null, Spinner=()=>null, EmptyState=()=>null, SearchBox=()=>null, Switch=()=>null;
    const Slider=props=>h('span',{'data-slider':props.label}), Segmented=props=>h('span',{'data-seg':props.label});
    ${sources.join('\n')}
    forkTtsScope={get:name=>name==='ttsClient'?ttsClient:undefined};
    voicePlayer.setEnabled(true);
    // the story as the page shows it: one row, a paragraph or a bubble per unit
    const rows=document.getElementById('rows');
    rows.innerHTML='<div data-story-row data-role="assistant" data-row-key="turn:1"><div class="dsh-tavern-story-floor-head">第 1 楼</div>'+${JSON.stringify(paragraphs)}.map(p=>{
      const line=/\\[(.*?)\\]/.exec(p);
      return line?'<div class="fork-bubble" style="height:70px"><div class="fork-bubble-head"><b class="fork-bubble-name">小夜</b></div><span class="fork-bubble-line">'+line[1]+'</span></div>':'<p style="height:70px;margin:0">'+p+'</p>';}).join('')+'</div>';
    const box=document.getElementById('box'), scrolls=[];
    const scrollTo=box.scrollTo.bind(box); box.scrollTo=options=>{scrolls.push(options.top);scrollTo({...options,behavior:'auto'});};
    function BubbleVoices(){window.bubbleHandles=Object.keys(useVoiceBubbles({sessionId:'game',voiceScope:'1:0'},[{kind:'bubble',alias:'sayo',name:'小夜',text:'你好。'}],'',config));return null;}
    // Tavern's public reading API (plugin-extensions.js apiVersion 9) over the real story-reading.js and voice channel
    const tools=[], effects=[];
    const ui={apiVersion:9, components:{Slider,Segmented,Switch,SearchBox,Icon,Spinner,EmptyState},
      registerHeaderTool(input){tools.push(input);return()=>{};},
      readingUnits:id=>tavernReading.units(id), readingVoices:()=>Promise.resolve([]), prepareReading:(id,key,o)=>tavernReading.prepare(id,key,o),
      playReading:(id,key,o)=>tavernReading.play(id,key,o), pauseReading:()=>tavernReading.pause(), resumeReading:()=>tavernReading.resume(),
      stopReading:()=>tavernReading.stop(), tuneReading:o=>tavernReading.tune(o), holdVoice:()=>voiceChannel.hold()};
    const audiobookPlugin=window.audiobookFactory(name=>({react:modules.react,'react-dom':modules['react-dom']})[name]);
    audiobookPlugin.apply({tavernUi:ui,effect(fn){effects.push(fn());}});
    const audiobook=tools[0].render({gameId:'game'}).props.reader, plain=audiobookPlugin.__test;
    function Tools(){return tools.map(tool=>h(React.Fragment,{key:'tool'},tool.render({gameId:'game'})));}
    modules['react-dom/client'].createRoot(document.getElementById('root')).render([h(Tools,{key:'chip'}),h(BubbleVoices,{key:'bubbles'})]);
    window.audiobook=audiobook; window.plain=plain;
    window.fixture={calls,synths,audios,scrolls,
      end(){const a=audios.find(a=>!a.paused);a.paused=true;a.onended();},
      state:()=>({...audiobook.get(),...audiobook.diagnostics()})};
  ` })
  return page
}
const state = page => page.evaluate(() => fixture.state())
const playingText = page => page.evaluate(() => fixture.audios.find(a => !a.paused) ? audiobook.get().unit.text : null)

test('有声书关着：没有小喇叭，气泡照常有配音；打开后出现小喇叭，气泡的配音全部停下', async t => {
  const page = await mount(t, { on: false })
  assert.equal(await page.locator('.fork-audiobook-chip').count(), 0)
  assert.ok((await page.evaluate(() => window.bubbleHandles)).length > 0, '关着时气泡有 ▶')
  await page.evaluate(() => plain.abSwitch.set('on'))
  await page.locator('.fork-audiobook-chip').waitFor()
  assert.deepEqual(await page.evaluate(() => window.bubbleHandles), [], '开着时舞台和气泡都不配音')
  assert.equal(await page.evaluate(() => stageVoicingAvailable()), false)
  await page.evaluate(() => plain.abSwitch.set('off'))
  await page.locator('.fork-audiobook-chip').waitFor({ state: 'detached' })
  assert.ok((await page.evaluate(() => window.bubbleHandles)).length > 0, '关掉后恢复')
})

test('播放从这一屏第一句开始，按顺序读：旁白用朗读声音，台词用角色自己的声音和配音文本，提前合成后面几句', async t => {
  const page = await mount(t)
  await page.evaluate(() => { const box = document.getElementById('box'); box.scrollTop = 70 * 4 + 60 })
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  assert.equal(await playingText(page), '第5句台词，小夜说。', '屏幕顶边以下的第一句（第 4 段的开头已在屏幕外）')
  const first = await page.evaluate(() => fixture.synths.slice(0, 4).map(s => [s.voice.source, s.text]))
  assert.deepEqual(first[0], ['pack:sayo', 'だい5、さよ。'], '按角色：角色的声音读她的日语配音文本')
  assert.ok(first.some(([source, text]) => source === 'reading:r' && text === '第6段旁白，彩叶在灯下写着模拟卷。'), '旁白用朗读声音')
  await page.waitForFunction(() => fixture.synths.length >= 4)
  assert.deepEqual(await page.evaluate(() => fixture.calls.filter(c => c.method === 'openAssetPackVoice').map(c => c.args)), [{ alias: 'sayo' }], '同一个角色的声音只打开一次')
  for (const want of ['第6段旁白，彩叶在灯下写着模拟卷。', '第7句台词，小夜说。']) {
    await page.evaluate(() => fixture.end())
    await page.waitForFunction(text => fixture.audios.some(a => !a.paused) && audiobook.get().unit.text === text, want)
  }
  const s = await state(page)
  assert.equal(s.status, 'playing')
  assert.equal(await page.evaluate(() => navigator.mediaSession?.metadata?.title || null), '第 1 楼')
})

test('一句还没合成时先合成它，后面几句排在它之后（配音服务一次只说一句）', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.waitForFunction(() => fixture.synths.length >= 2)
  await page.evaluate(() => { const box = document.getElementById('box'); box.scrollTop = 70 * 6 + 10 })
  const before = await page.evaluate(() => fixture.synths.length)
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(n => fixture.synths.length > n, before)
  const start = await page.evaluate(() => audiobook.get().unit.text)
  assert.equal(start, '第6段旁白，彩叶在灯下写着模拟卷。', '这一屏的第一句，打开面板时没有提前合成')
  assert.equal(await page.evaluate(n => fixture.synths[n].text, before), start, '这一句排在它后面几句之前')
})

test('提前合成一句接一句地要：前一句好了才要下一句，配音服务按顺序说', async t => {
  const page = await mount(t)
  await page.evaluate(() => { window.synthMs = 120 })
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.synths.length >= 4, null, { timeout: 5000 })
  const at = await page.evaluate(() => fixture.synths.slice(0, 4).map(s => s.at))
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 100, '第 ' + (i + 1) + ' 句在前一句合成完之后才要：' + JSON.stringify(at))
})

test('跟读：读到靠近屏幕底部的句子时正文往下翻，让它停在上方', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  for (let i = 0; i < 4; i++) { await page.evaluate(() => fixture.end()); await page.waitForTimeout(220) }
  const { top, scrolled } = await page.evaluate(() => {
    const box = document.getElementById('box'), range = CSS.highlights.get('dsh-audiobook')
    const rect = [...range][0].getBoundingClientRect(), view = box.getBoundingClientRect()
    return { top: rect.top - view.top, scrolled: fixture.scrolls.length }
  })
  assert.ok(scrolled > 0, '翻过页')
  assert.ok(top >= 0 && top < 300 * 0.5, '当前句在屏幕上半部：' + top)
})

test('暂停后没动过：接着读同一句；动过（滚动）：从这一屏第一句开始；朗读中滚走显示「回到朗读处」', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => audiobook.get().unit.n === 1 && fixture.audios.some(a => !a.paused))
  await page.getByRole('button', { name: '暂停' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'paused')
  const synths = await page.evaluate(() => fixture.synths.length)
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'playing')
  assert.equal((await state(page)).n ?? (await page.evaluate(() => audiobook.get().unit.n)), 1, '接着读刚才那句')
  assert.equal(await page.evaluate(() => fixture.synths.length), synths, '接着读不重新合成')
  // the reader scrolls (a wheel) while it reads: it reads on, stops following, offers 回到朗读处
  await page.mouse.move(300, 150)
  await page.mouse.wheel(0, 70 * 8)
  await page.waitForFunction(() => audiobook.get().following === false)
  await page.locator('.fork-audiobook-return[data-shown]').waitFor()
  assert.equal(await page.evaluate(() => audiobook.get().status), 'playing')
  await page.getByRole('button', { name: '暂停' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'paused')
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'playing' && audiobook.get().unit.n > 4)
  const { n, first } = await page.evaluate(() => {
    const box = document.getElementById('box'), view = box.getBoundingClientRect()
    const units = [...box.querySelectorAll('[data-story-row] > p, [data-story-row] > .fork-bubble')]
    return { n: audiobook.get().unit.n, first: units.findIndex(node => node.getBoundingClientRect().top >= view.top - 1) }
  })
  assert.ok(first > 4)
  assert.equal(n, first, '从这一屏的第一句开始')
})

// The brief's client-side numbers with an instant voice service: the time from 播放 to the first clip (locate + open the voice +
// submit + decode on this side), the gap between sentences (ended → next clip, minus the designed breath between
// paragraphs), and every sentence on screen when it starts (the page keeps up).
test('客户端用时：首句、句间间隔、每句开始时都在屏幕上', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.waitForTimeout(200)
  const first = await page.evaluate(async () => {
    const t0 = performance.now()
    ;[...document.querySelectorAll('.fork-audiobook button')].find(b => b.getAttribute('aria-label') === '播放').click()
    while (!fixture.audios.some(a => !a.paused)) await new Promise(r => setTimeout(r, 1))
    return performance.now() - t0
  })
  const rows = await page.evaluate(async () => {
    const out = [], box = document.getElementById('box')
    for (let i = 0; i < 13; i++) {
      const before = audiobook.get().unit
      const playing = fixture.audios.find(a => !a.paused)
      const t0 = performance.now()
      fixture.end()
      while (!fixture.audios.some(a => !a.paused && a !== playing)) await new Promise(r => setTimeout(r, 1))
      const gap = performance.now() - t0, unit = audiobook.get().unit
      await new Promise(r => setTimeout(r, 30))
      const range = [...CSS.highlights.get('dsh-audiobook')][0], rect = range.getBoundingClientRect(), view = box.getBoundingClientRect()
      out.push({ gap, breath: plain.abPause(before, unit), shown: rect.top >= view.top && rect.bottom <= view.bottom })
    }
    return out
  })
  const overhead = rows.map(r => r.gap - r.breath)
  t.diagnostic('first ' + Math.round(first) + ' ms; overhead per sentence max ' + Math.round(Math.max(...overhead)) + ' ms')
  assert.ok(first < 300, '首句（不含合成）' + first)
  assert.ok(overhead.every(ms => ms < 150), '句间开销 ' + overhead.map(Math.round))
  assert.ok(rows.every(r => r.shown), '每句开始时都在屏幕上')
})

test('结束朗读后再点播放：从刚才那句接着读', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  await page.evaluate(() => fixture.end())
  await page.waitForFunction(() => audiobook.get().unit?.n === 1 && fixture.audios.some(a => !a.paused))
  await page.getByRole('button', { name: '结束朗读' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'idle')
  assert.equal(await page.evaluate(() => fixture.audios.some(a => !a.paused)), false)
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'playing')
  assert.equal(await page.evaluate(() => audiobook.get().unit.n), 1)
})

test('结束朗读后翻到别处再点播放：从这一屏的第一句读', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  await page.getByRole('button', { name: '结束朗读' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'idle')
  await page.locator('#box').hover()
  await page.mouse.wheel(0, 70 * 6 + 10)
  await page.waitForFunction(() => document.getElementById('box').scrollTop > 400)
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'playing')
  assert.equal(await page.evaluate(() => audiobook.get().unit.text), '第6段旁白，彩叶在灯下写着模拟卷。')
})

test('配音服务断开时停在这一句并说明原因，不跳过后面的句子；服务回来后点播放从这一句读', async t => {
  const page = await mount(t)
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  const n = await page.evaluate(() => { window.synthDown = 'SERVICE_OFFLINE'; voicePlayer.invalidate(); return audiobook.get().unit.n })
  await page.getByRole('button', { name: '下一句' }).click()
  await page.waitForFunction(() => audiobook.get().error === 'SERVICE_OFFLINE')
  assert.equal(await page.evaluate(() => audiobook.get().unit.n), n + 1, '停在没读出来的那一句')
  await page.evaluate(() => { window.synthDown = null })
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => audiobook.get().status === 'playing' && fixture.audios.some(a => !a.paused))
  assert.equal(await page.evaluate(() => audiobook.get().unit.n), n + 1)
})

test('读过的句子再读一遍不再合成；读到最新回复的末尾停下', async t => {
  const page = await mount(t)
  await page.evaluate(() => { document.getElementById('box').scrollTop = 70 * 11 })
  await page.locator('.fork-audiobook-chip').click()
  await page.getByRole('button', { name: '播放' }).click()
  await page.waitForFunction(() => fixture.audios.some(a => !a.paused))
  const start = await page.evaluate(() => audiobook.get().unit.n)
  await page.waitForFunction(() => fixture.synths.length >= 14 - audiobook.get().unit.n)
  const synths = await page.evaluate(() => fixture.synths.length)
  await page.getByRole('button', { name: '上一句' }).click()
  await page.waitForFunction(n => audiobook.get().unit.n === n - 1 && fixture.audios.some(a => !a.paused), start)
  await page.getByRole('button', { name: '下一句' }).click()
  await page.waitForFunction(n => audiobook.get().unit.n === n && fixture.audios.some(a => !a.paused), start)
  assert.equal(await page.evaluate(() => fixture.synths.length) - synths, 1, '只有之前没读过的上一句是新合成的')
  for (let i = start; i < 14; i++) { await page.evaluate(() => fixture.end()); await page.waitForTimeout(200) }
  await page.waitForFunction(() => audiobook.get().status === 'idle')
})
