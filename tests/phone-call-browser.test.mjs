// the page side of a call with a synthetic microphone (Chromium's
// fake capture device, muted). A pause the words say is mid-sentence keeps listening; a finished sentence is answered
// after a short pause; each clause starts only once its whole audio has arrived.
// Speaking over her stops her voice at once and keeps only the audio-clock caption prefixes.
import {stageHelpersSource} from './helpers/stage-helpers-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import vm from 'node:vm'
import os from 'node:os'
import path from 'node:path'
import {readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {mkdtemp} from './helpers/temp-directory.mjs'

const RATE = 16000
function wav(parts) {
  const samples = []
  let seed = 7
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1 }
  for (const [seconds, amplitude] of parts)
    for (let i = 0; i < seconds * RATE; i++) samples.push(Math.round(32767 * amplitude * noise() * (amplitude > 0.01 ? 0.6 + 0.4 * Math.sin(i / RATE * 2 * Math.PI * 4) : 1)))
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((value, i) => data.writeInt16LE(value, i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
// Her synthesized line as dsh-tavern-tts streams it: a float WAV of unknown length, 100 ms of audio every 100 ms.
const LINES = {'だって、':[0.4,0], 'たのしいんだもん。':[0.8,0,0.3], '因为，':[0.4,0], '好玩呀。':[0.8,0], '第一句，':[4,0], '一。':[4,0], 'Slow synthesis needs enough buffered audio.':[3, 0, 0.02, 180], '我是辉夜。':[1.5, 0, 0.8], 'silent':[0.4, 0, 1], 'もしもし':[0.4, 0], 'うん、':[0.3, 0], '会いたい。':[0.8, 0], '二つ目':[2.5, 2000], 'だって、たのしいんだもん。':[1.2, 0], '最後の一言。':[0.6, 0]}
function serveLine(res, text) {
  if (text === 'VOICE_FAILED') { res.writeHead(503).end(); return }
  const [seconds, delay, silentLead = 0.02, chunkMs = 100] = LINES[text] || [1, 0], rate = 44100
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(0xFFFFFFFF, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(3, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 4, 28)
  head.writeUInt16LE(4, 32); head.writeUInt16LE(32, 34); head.write('data', 36); head.writeUInt32LE(0xFFFFFFFF - 36, 40)
  res.writeHead(200, {'Content-Type':'audio/wav'})
  let sent = 0
  const chunk = () => {
    if (res.destroyed) return
    const n = Math.round(rate * 0.1), out = Buffer.alloc(n * 4)
    // 20 ms of leading silence, then a tone.
    for (let i = 0; i < n; i++) out.writeFloatLE(sent * n + i < rate * silentLead ? 0 : 0.3 * Math.sin((sent * n + i) / rate * 2 * Math.PI * 220), i * 4)
    res.write(sent === 0 ? Buffer.concat([head, out]) : out)
    if (++sent * 0.1 >= seconds) res.end(); else setTimeout(chunk, chunkMs)
  }
  setTimeout(chunk, delay)
}

// A page with the call module, a fake microphone playing `parts` and the host answering through `handlers` (the body of
// `async function host(method, args)`, returning undefined for the shared phone answers below).
// `ring`: how long her phone rings at least / at most (the page's own default is two rings; the tests pick up at once).
// `fakeClock`: her voice goes to an output whose clock only moves by `audioClock.t` (her audio is scheduled, never played).
async function openCall(t, parts, handlers, ring = {minMs:0, maxMs:15000}, {fakeClock = false, outputLatency = 0} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-phone-call-'))
  const mic = path.join(dir, 'mic.wav')
  await writeFile(mic, wav(parts))
  const source = await readFile(process.env.PHONE_CALL_TEST_SOURCE || new URL('../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  // The clause cut of the speech stream and the stage pager's voice share, which her captions use.
  const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to))
  const helpers = between(await readFile(new URL('../tavern-plugin/src/client/bubble-line.cjs', import.meta.url), 'utf8'), 'function bubbleSpeechCut', 'function createBubbleStream')
    + stageHelpersSource
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/tts') return serveLine(res, url.searchParams.get('text'))
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>call</title>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close())
  const browser = await chromium.launch({headless:true, args:['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=' + mic, '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--explicitly-allowed-ports=' + server.address().port]})
  t.after(() => browser.close())
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port + '/')
  await page.addScriptTag({content:`
    window.calls = []; window.stops = 0; window.stageStops = 0; window.gainNodes = [];
    const voicePlayer = {subscribe() { return () => {}; }, get: () => null, stopPlayback() { stageStops++; }};
    const forkLipSync = {wake() {}};
    // a live call holds its audio while the app is in the background.
    window.holds = 0; const forkForeground = {keepAudio() { holds++; return () => { holds--; }; }};
    window.audioClock = {t:0};
    const fakeContext = {get currentTime() { return audioClock.t; }, state:'running', baseLatency:0, outputLatency:${outputLatency}, resume: async () => {},
      createBuffer(channels, length, rate) { const data = new Float32Array(length); return {duration:length / rate, sampleRate:rate, length, copyToChannel(samples) { data.set(samples); }, getChannelData: () => data}; },
      createGain() { const node={gain:{value:1},connect(){},disconnect(){}};gainNodes.push(node);return node; },
      createBufferSource: () => ({connect() {}, disconnect() {}, start() {}, stop() {}, onended:null})};
    const forkStageAudio = {
      voiceStream() {
        if (${fakeClock}) return {input:{}, context:fakeContext, paused:true, ended:false, muted:false, volume:1, currentTime:0};
        const context = new AudioContext(), gain = context.createGain.bind(context);
        context.createGain = () => { const node=gain(); gainNodes.push(node); return node; };
        const input = context.createGain(); input.connect(context.destination); return {input, context, paused:true, ended:false, muted:false, volume:1, currentTime:0};
      },
      voice() {}, release() {},
      // The ringback's bus: each tone is counted (window.rings) and plays muted into the page's own output.
      callInput() { window.rings = (window.rings || 0) + 1; const context = new AudioContext(), input = context.createGain(); input.connect(context.destination); return {input, context}; },
      // the call ducks the stage from dialling to hang-up; her voice plays at its measured level.
      call(on) { window.mix.push(['call', on]); }, voiceLevel(handle, loudness) { window.mix.push(['level', loudness?.gain]); },
    };
    window.mix = [];
    // dsh-tts: the line becomes playable 50 ms after it is asked for; the promise settles once it is complete.
    const ttsClient = {
      available: () => true,
      async synthesize(input, {signal, onStream}) {
        calls.push({method:'synthesize', at:performance.now(), text:input.text, mood:input.mood});
        await new Promise(resolve => setTimeout(resolve, 50));
        if (signal.aborted) throw Object.assign(new Error('ABORTED'), {code:'ABORTED'});
        onStream({url:'/tts?text=' + encodeURIComponent(input.text), loudness:{gain:2}});
        await new Promise(resolve => setTimeout(resolve, 3000));
        return {ticket:'t', loudness:{gain:2.5}};
      },
    };
    const forkTtsScope = {get: name => name === 'ttsClient' ? ttsClient : null};
    window.turns = 0;
    const bytesOf = audio => atob(audio).length;
    async function host(method, args) { ${handlers} }
    async function rpc(method, args) {
      const seconds = method === 'phoneCallHear' ? bytesOf(args.audio) / 32000 : null;
      calls.push({method, at:performance.now(), args:method === 'phoneCallHear' ? {seconds, ...('language' in args ? {language:args.language} : {})} : method === 'appendSpeechRecognition' ? {...args, audio:bytesOf(args.audio)} : args});
      const answer = await host(method, args, seconds);
      if (answer !== undefined) return answer;
      if (method === 'phoneCallStart') return {callId:'c1', language:'ja', contact:{id:args.contactId, name:'爱音'}};
      if (method === 'phoneCallTurn') return {turnId:'t' + ++turns, elapsedMs:0};
      if (method === 'openAssetPackVoice') return {available:true, voice:{id:'v'}, scope:'s', language:'ja'};
      if (method === 'phoneCallThreads') return {threads:{}};
      return {};
    }
    ${helpers}
    ${source}
    phoneModCallProbe.ring = ${JSON.stringify(ring)};
    window.phoneModCall = phoneModCall;
    window.lipSync = [];
    phoneModCall.subscribe(() => { const voice = phoneModCall.speaking(); if (voice?.audio) lipSync.push(voice.alias); });
    // What the phone page is handed, each time the live line, the lines or the notice change.
    window.states = [];
    phoneModCall.subscribe(() => {
      const s = phoneModCall.get(), row = {at:performance.now(), partial:s.partial, lines:(s.lines || []).map(line => line.role === 'player' ? line.text : line.say), notice:s.notice || null};
      const last = states.at(-1);
      if (!last || last.partial !== row.partial || last.notice !== row.notice || JSON.stringify(last.lines) !== JSON.stringify(row.lines)) states.push(row);
    });
    // The call's own course: status, picked up, clock, mute.
    window.phases = [];
    phoneModCall.subscribe(() => {
      const s = phoneModCall.get(), row = {at:performance.now(), status:s.status, connected:s.connected === true, elapsed:s.elapsed ?? null, muted:s.muted === true}, last = phases.at(-1);
      if (!last || ['status', 'connected', 'elapsed', 'muted'].some(key => last[key] !== row[key])) phases.push(row);
    });
  `})
  await page.evaluate(() => phoneModCall.command({sessionId:'s', action:'start', contactId:'anon'}))
  return {page, errors}
}

// The page's recognition sessions (BACKEND-CONTRACT): each appended chunk is decoded 120 ms later, one character per
// 400 ms of audio heard so far; `texts` are the words of each session in order.
const FAKE_RECOGNITION = texts => `
  window.asr ||= {sessions:new Map(), serial:0};
  const snap = row => ({id:row.id, revision:row.revision, text:row.text, language:'zh', done:false, error:null, timing:null});
  if (method === 'startSpeechRecognition') { const row = {id:'r' + ++asr.serial, bytes:0, revision:0, text:'', cancelled:false, words:${JSON.stringify(texts)}[asr.serial - 1] || ''}; asr.sessions.set(row.id, row); return snap(row); }
  if (method === 'appendSpeechRecognition') {
    const row = asr.sessions.get(args.id); row.bytes += atob(args.audio).length;
    const bytes = row.bytes; setTimeout(() => { if (!row.cancelled) { row.revision++; row.text = Array.from(row.words).slice(0, Math.round(bytes / 12800)).join(''); } }, 120);
    return snap(row);
  }
  if (method === 'pollSpeechRecognition') {
    const row = asr.sessions.get(args.id);
    // A poll answer that arrives after the player finished must not land anywhere.
    if (row.id === 'r1') { await new Promise(resolve => setTimeout(resolve, 200)); if (row.cancelled) return {...snap(row), revision:row.revision + 50, text:'OLD-LATE'}; }
    // One stale answer (an older revision) must be ignored.
    if (row.revision === 2 && !row.staled) { row.staled = true; return {...snap(row), revision:1, text:'STALE'}; }
    return snap(row);
  }
  if (method === 'cancelSpeechRecognition') { asr.sessions.get(args.id).cancelled = true; return {cancelled:true}; }
`

test('a call ends the player\'s turn by the words, speaks after synthesis completes and is cut off by the player speaking over her', async t => {
  // Quiet room; the player says a sentence with a 0.5 s pause in the middle; she answers; the player talks over her
  // (a short burst while her second clause plays: she is cut at its first words - the 120 ms pause probe - before the third clause).
  const {page, errors} = await openCall(t, [[1.0, 0.001], [0.8, 0.3], [0.5, 0.001], [0.6, 0.3], [1.4, 0.001], [0.3, 0.3], [6, 0.001]], `
    ${FAKE_RECOGNITION([])}
    // The words so far: before the pause the sentence goes on; with the rest it is a finished question.
    if (method === 'phoneCallHear') return arguments[2] < 1.6 ? {text:'我刚到家然后', ending:'open', asrMs:40, endpoint:{probability:0.6}} : {text:'我刚到家然后突然很想你？', ending:'complete', asrMs:40, endpoint:{probability:0.98}};
    if (method === 'phoneCallPoll') return args.turnId === 't1'
      ? {segments:[{index:0, say:'もしもし', sub:'喂'}], done:true}
      : {segments:[{index:0, say:'うん、', sub:'嗯，', part:true}, {index:1, say:'会いたい。', sub:'想见你。'}, {index:2, say:'二つ目', sub:'第二句'}], done:true};
  `)
  await page.waitForFunction(() => calls.filter(call => call.method === 'phoneCallInterrupt').length >= 2, null, {timeout:20000})
  await page.waitForTimeout(300)
  const result = await page.evaluate(() => ({calls, events:phoneModCallProbe.events, attempts:phoneModCallProbe.attempts, lipSync, stageStops, state:phoneModCall.get(), states}))
  assert.deepEqual(errors, [])
  const names = result.events.map(event => event.name)
  // The greeting; the mid-sentence pause starts a held reply that the player's next words retract; the finished
  // sentence is answered early; her voice; the player talking over her.
  assert.deepEqual(names.filter(name => ['connected', 'utterance', 'heard', 'audio-start', 'barge-in', 'retract'].includes(name)).slice(0, 7),
    ['connected', 'audio-start', 'retract', 'utterance', 'heard', 'audio-start', 'barge-in'])
  const endings = result.events.filter(event => event.name === 'ending').map(event => event.ending)
  assert.equal(endings[0], 'open', 'the pause inside the sentence kept listening'); assert.ok(endings.includes('complete'))
  const said = result.calls.filter(call => call.method === 'phoneCallTurn' && !call.args.cue)
  // (The words spoken over her may already have started a third, held reply by now: she is cut at the first words, not at the first sound.)
  assert.deepEqual(said.slice(0, 2).map(call => call.args.said), ['我刚到家然后', '我刚到家然后突然很想你？'], 'the held reply was paid for, then retracted')
  // The retracted reply and its words never reached the screen; the host forgets both.
  assert.ok(result.states.every(row => !row.lines.includes('我刚到家然后')), 'the held words never showed')
  const [retract, cut] = result.calls.filter(call => call.method === 'phoneCallInterrupt')
  assert.deepEqual({...retract.args, timing:undefined}, {callId:'c1', turnId:'t2', heard:[], retract:true, timing:undefined})
  assert.equal(retract.args.timing.interruptions,1)
  assert.equal(retract.args.timing.outcome,3)
  assert.equal(result.attempts.find(row => row.turnId === 't2').outcome, 'retracted')
  const utterance = result.events.find(event => event.name === 'utterance')
  assert.equal(utterance.early, true, 'the finished sentence did not wait for a fixed silence')
  // Every probe hears the whole pause so far: the sentence with its pre-roll and 120 ms of silence.
  const turn = result.calls.filter(call => call.method === 'phoneCallHear'), longest = Math.max(...turn.map(call => call.args.seconds))
  assert.ok(turn.length >= 3 && longest > 1.9 && longest < 2.7, 'one utterance with its pre-roll: ' + turn.map(call => call.args.seconds))
  // Endpoint: pause probe at 120 ms of silence (the fixed endpoint was 600 ms).
  const reply = result.events.filter(event => event.name === 'audio-start')[1]
  const stopped = result.events.filter(event => event.name === 'pause' && event.mark === 120)[1].at - 120
  assert.ok(utterance.at - stopped < 350, 'decided ' + Math.round(utterance.at - stopped) + ' ms after the player stopped')
  // The first clause is complete; the reserve predicts later clauses, not a whole-reply barrier.
  // (Her reply to the finished sentence: the words spoken over her may have started a further held reply by now.)
  const firstSynth = result.calls.filter(call => call.method === 'synthesize' && call.text === 'うん、').find(call => call.at >= utterance.at)
  const replyTiming = result.attempts.find(row => row.turnId === 't3').timing
  assert.ok(Math.abs(replyTiming.startBufferSeconds - 0.3) < 0.005, 'started with the whole clause buffered: ' + replyTiming.startBufferSeconds + ' s')
  assert.ok(reply.at - firstSynth.at >= 250, 'the first clause finishes before the first sound')
  assert.ok(reply.latencyMs > 0 && reply.latencyMs < 6000, 'first audible ' + reply.latencyMs + ' ms after the player stopped')
  assert.equal(cut.args.callId, 'c1'); assert.equal(cut.args.turnId, 't3')
  assert.deepEqual(cut.args.heard, [0, 1], 'no receipt for the unplayed third piece')
  const interrupted = result.attempts.find(row => row.turnId === 't3')
  assert.equal(interrupted.outcome, 'interrupted', 'cut attempts remain measurable instead of disappearing from latency samples')
  assert.ok(Number.isFinite(interrupted.timing.decidedAt))
  assert.ok(Number.isFinite(interrupted.timing.audibleAt))
  assert.notEqual(result.state.status, 'speaking', 'her voice stopped')
  // Her first clause and the rest of the line are one line on screen, in the words the story reads (her Japanese voice's
  // own words never show); the piece she never started is gone.
  assert.deepEqual(result.state.lines.map(line => line.text), ['喂', '我刚到家然后突然很想你？', '嗯，想见你。'])
  assert.ok(result.lipSync.includes('anon'), 'the stage figure is handed the call voice')
  assert.ok(result.stageStops >= 1, 'the call took the voice line from the stage')
  await page.evaluate(() => phoneModCall.command({action:'end'}))
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallEnd'))
  // The call ducked the stage from dialling to hang-up; her streamed line took its voice's measured level, the complete one its own.
  const mix = await page.evaluate(() => window.mix)
  assert.deepEqual(mix.filter(([kind]) => kind === 'call'), [['call', true], ['call', false]])
  assert.ok(await page.evaluate(() => gainNodes.some(node => node.gain.value === 2)), 'each streamed clip keeps its own gain')
  assert.ok(!mix.some(([kind]) => kind === 'level'), 'completion of a future clip never retargets the current voice')
})

test('a short answer judged open at 120 ms starts her reply at once, held until the 300 ms probe calls it a handoff', async t => {
  // The greeting; a 0.6 s answer; silence. The judge reads the whole pause: open at 120 ms, a handoff at 300 ms.
  const {page, errors} = await openCall(t, [[1.0, 0.001], [0.6, 0.3], [6, 0.001]], `
    ${FAKE_RECOGNITION(['嗯。'])}
    if (method === 'phoneCallHear') { window.hears = (window.hears || 0) + 1; return {text:'嗯。', ending:hears === 1 ? 'open' : 'complete', asrMs:20, endpoint:{probability:hears === 1 ? 0.7 : 0.97}}; }
    if (method === 'phoneCallPoll') return args.turnId === 't1' ? {segments:[{index:0, say:'もしもし', sub:'喂'}], done:true} : {segments:[{index:0, say:'うん、', sub:'嗯，', part:true}, {index:1, say:'会いたい。', sub:'想见你。'}], done:true, timing:{firstSayMs:30, totalMs:60}};
  `)
  await page.waitForFunction(() => phoneModCallProbe.attempts.some(row => row.turnId === 't2' && row.outcome === 'completed'), null, {timeout:20000})
  const result = await page.evaluate(() => ({calls, events:phoneModCallProbe.events, attempts:phoneModCallProbe.attempts, states, state:phoneModCall.get()}))
  assert.deepEqual(errors, [])
  const probes = result.events.filter(event => event.name === 'ending').map(event => [event.mark, event.ending])
  assert.deepEqual(probes, [[120, 'open'], [300, 'complete']], 'the pause was judged again at 300 ms, not at 1.1 s')
  // One paid request, made at the first probe; the words and her voice waited for the second.
  const turns = result.calls.filter(call => call.method === 'phoneCallTurn' && !call.args.cue)
  assert.deepEqual(turns.map(call => call.args.said), ['嗯。'])
  const ending = result.events.filter(event => event.name === 'ending')
  assert.ok(turns[0].at < ending[1].at && turns[0].at - ending[0].at < 60, 'started ' + Math.round(turns[0].at - ending[0].at) + ' ms after the open judgement')
  const attempt = result.attempts.find(row => row.turnId === 't2')
  assert.equal(attempt.outcome, 'completed')
  const receipt = result.calls.findLast(row => row.method === 'phoneCallHeard' && row.args.turnId === 't2').args.timing
  assert.equal(receipt.origin,0); assert.equal(receipt.speechEndMs,0); assert.equal(receipt.endpoint,1)
  for (const key of ['endpointMs','asrFinalMs','rpcSentMs','hostStartMs','clockErrorMs','ttsRequestMs','firstPcmMs','scheduledMs','audibleMs','outputLatencyMs','interruptions','stalls']) assert.ok(Number.isFinite(receipt[key]),key)
  assert.ok(receipt.firstPcmMs >= receipt.ttsRequestMs)
  assert.ok(receipt.audibleMs >= receipt.scheduledMs)
  assert.ok(Object.values(receipt).every(Number.isFinite))
  assert.equal(attempt.timing.speculative, true)
  assert.ok(attempt.timing.releasedAt >= ending[1].at && attempt.timing.decidedAt >= ending[1].at, 'released by the handoff judgement')
  assert.ok(attempt.timing.audioScheduled >= attempt.timing.releasedAt, 'no sound before the release')
  assert.deepEqual(attempt.timing.model, {firstSayMs:30, totalMs:60}, 'the host timing travels with the turn')
  const shown = result.states.find(row => row.lines.includes('嗯。'))
  assert.ok(shown && shown.at >= attempt.timing.releasedAt, 'the player\'s words showed at the release, not at the first probe')
  assert.ok(result.states.every(row => row.at >= attempt.timing.releasedAt || !row.lines.includes('うん、')), 'her words never showed while held')
  const reply = result.events.filter(event => event.name === 'audio-start')[1]
  assert.ok(reply.latencyMs > 0 && reply.latencyMs < 1800, 'first audible ' + reply.latencyMs + ' ms after the player stopped')
  await page.evaluate(() => phoneModCall.command({action:'end'}))
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallEnd'))
})

test('the final pause snapshot replaces a corrected speculative transcript before any reply is released', async t => {
  const {page, errors} = await openCall(t, [[1.0, 0.001], [0.6, 0.3], [6, 0.001]], `
    ${FAKE_RECOGNITION(['小圆你还没睡吗'])}
    if (method === 'phoneCallHear') { window.hears = (window.hears || 0) + 1; return {text:hears === 1 ? '小袁你还没睡吗' : '小圆你还没睡吗', ending:hears === 1 ? 'open' : 'complete', asrMs:20, endpoint:{probability:hears === 1 ? 0.7 : 0.97}}; }
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'もしもし', sub:'喂'}], done:true};
  `)
  await page.waitForFunction(() => phoneModCallProbe.attempts.some(row => row.turnId === 't3' && row.outcome === 'completed'), null, {timeout:20000})
  const result = await page.evaluate(() => ({calls, states, attempts:phoneModCallProbe.attempts, state:phoneModCall.get()}))
  assert.deepEqual(errors, [])
  assert.deepEqual(result.calls.filter(row => row.method === 'phoneCallTurn' && !row.args.cue).map(row => row.args.said), ['小袁你还没睡吗', '小圆你还没睡吗'])
  assert.equal(result.attempts.find(row => row.turnId === 't2').outcome, 'retracted')
  assert.ok(result.calls.some(row => row.method === 'phoneCallInterrupt' && row.args.turnId === 't2' && row.args.retract))
  assert.ok(result.states.every(row => !row.lines.includes('小袁你还没睡吗')), 'the obsolete decode never becomes a visible line')
  assert.ok(result.state.lines.some(row => row.role === 'player' && row.text === '小圆你还没睡吗'))
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})

test('while the player talks the words recognized so far show as one live line, replaced by each revision and never kept', async t => {
  const first = '今天天气真好我们出去走走吧', second = '等一下'
  // The greeting; a 2.4 s sentence; she answers slowly; a short second utterance.
  const {page, errors} = await openCall(t, [[1.0, 0.001], [2.4, 0.3], [2.0, 0.001], [0.8, 0.3], [6, 0.001]], `
    ${FAKE_RECOGNITION([first, second])}
    if (method === 'phoneCallHear') return arguments[2] > 1.5 ? {text:'今天天气真好，我们出去走走吧。', ending:'complete', asrMs:40} : {text:'等一下。', ending:'complete', asrMs:40};
    if (method === 'phoneCallPoll') return {t1:{segments:[{index:0, say:'もしもし', sub:'喂'}], done:true}, t2:{segments:[{index:0, say:'二つ目', sub:'第二句'}], done:true}}[args.turnId] || {segments:[{index:0, say:'うん、', sub:'嗯'}], done:true};
  `)
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallTurn' && call.args.said === '等一下。'), null, {timeout:20000})
  await page.waitForTimeout(400)
  await page.evaluate(() => phoneModCall.command({action:'end'}))
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallEnd'))
  const {calls, states, final} = await page.evaluate(() => ({calls, states, final:phoneModCall.get()}))
  assert.deepEqual(errors, [])
  const of = method => calls.filter(call => call.method === method)
  // One recognition session per utterance, in the language the recognition service is set to (the page names none).
  assert.deepEqual(of('startSpeechRecognition').map(call => call.args), [{}, {}], 'one recognition session per utterance')
  assert.ok(of('phoneCallHear').every(call => !('language' in call.args)))
  // Contract: sequence from 1, non-empty PCM16 every 400 ms (20 frames of 20 ms at 16 kHz), no final flag needed.
  const appends = of('appendSpeechRecognition').filter(call => call.args.id === 'r1')
  assert.ok(appends.length >= 4, 'appends: ' + appends.length)
  assert.deepEqual(appends.map(call => call.args.sequence), appends.map((_, i) => i + 1))
  assert.ok(appends.every(call => call.args.audio === 12800 && !('final' in call.args)), JSON.stringify(appends.map(call => call.args)))
  const gaps = appends.slice(1).map((call, i) => call.at - appends[i].at).sort((a, b) => a - b)
  assert.ok(gaps[gaps.length >> 1] > 300 && gaps[gaps.length >> 1] < 600, 'append spacing ' + gaps.map(Math.round))
  // The live line is the latest whole revision: prefixes of the words, never a stale or late answer, never stitched.
  const shown = [...new Set(states.map(row => row.partial).filter(Boolean))]
  assert.ok(shown.filter(text => first.startsWith(text)).length >= 3, 'revisions shown: ' + shown)
  assert.ok(shown.some(text => second.startsWith(text)), 'the second utterance has its own live line: ' + shown)
  assert.ok(shown.every(text => first.startsWith(text) || second.startsWith(text)), 'only current revisions: ' + shown)
  // It is never a line of the call: the player's line is the pause snapshot, and it replaces the live line at once.
  assert.ok(states.every(row => !row.lines.some(line => shown.includes(line))))
  const answered = states.find(row => row.lines.includes('今天天气真好，我们出去走走吧。'))
  assert.equal(answered.partial, '', 'the live line leaves when the player\'s line appears')
  const cancels = of('cancelSpeechRecognition').map(call => call.args.id)
  assert.deepEqual(cancels, ['r1', 'r2'], 'each session is released')
  assert.ok(of('cancelSpeechRecognition')[0].at < of('startSpeechRecognition')[1].at, 'released before the next utterance')
  assert.equal(final.partial, '')
})

test('a recognition failure shows the notice once and the call goes on with the pause snapshot', async t => {
  const {page, errors} = await openCall(t, [[1.0, 0.001], [1.6, 0.3], [6, 0.001]], `
    if (method === 'startSpeechRecognition') return {id:'e1', revision:0, text:'', language:'zh', done:false, error:null, timing:null};
    if (method === 'appendSpeechRecognition') throw new Error('ASR_FAILED');
    if (method === 'cancelSpeechRecognition') return {cancelled:true};
    if (method === 'phoneCallHear') return {text:'你在干嘛？', ending:'complete', asrMs:40};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:args.turnId === 't1' ? 'もしもし' : 'うん、', sub:'喂'}], done:true};
  `)
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallTurn' && call.args.said === '你在干嘛？'), null, {timeout:20000})
  await page.waitForTimeout(300)
  const {calls, states} = await page.evaluate(() => ({calls, states}))
  assert.deepEqual(errors, [])
  assert.equal(calls.filter(call => call.method === 'appendSpeechRecognition').length, 1, 'no retry, no other channel')
  assert.ok(states.some(row => row.notice === '通话暂时不顺畅，请稍后再试'))
  assert.ok(states.every(row => !String(row.notice || '').includes('ASR_FAILED')))
  assert.ok(states.every(row => !row.partial))
  assert.deepEqual(calls.filter(call => call.method === 'cancelSpeechRecognition').map(call => call.args.id), ['e1'])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})

// iOS (owner 2026-10-26 「打电话之前怎么没有嘟嘟两声」「挂断也不够还原 ios」): 呼叫中… with the ringback until she picks up -
// at least the shortest ring, and her greeting (asked for while it rings) ready to sound - then the clock; a hang-up is
// 通话结束 at once and lets the call go about 1.5 s later.
test('her phone rings before she picks up, the clock starts when she does, and a hang-up holds 通话结束 before the call goes', async t => {
  const {page, errors} = await openCall(t, [[10, 0.001]], `
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'もしもし', sub:'喂'}], done:true};
  `, {minMs:1500, maxMs:15000})
  await page.waitForFunction(() => phoneModCallProbe.events.some(event => event.name === 'audio-start'), null, {timeout:15000})
  const result = await page.evaluate(() => ({calls, events:phoneModCallProbe.events, phases, rings:window.rings}))
  assert.deepEqual(errors, [])
  const names = result.events.map(event => event.name)
  assert.ok(names.indexOf('ring') >= 0 && names.indexOf('ring') < names.indexOf('connected') && names.indexOf('connected') < names.indexOf('audio-start'), names.join(','))
  assert.equal(result.rings, 1, 'one ringback on the call voice bus')
  const ring = result.events.find(event => event.name === 'ring'), connected = result.events.find(event => event.name === 'connected')
  assert.ok(connected.at - ring.at >= 1500 && connected.rangMs >= 1500 && connected.rangMs < 2500, 'rang ' + connected.rangMs + ' ms')
  const greeting = result.calls.find(call => call.method === 'phoneCallTurn' && call.args.cue)
  assert.ok(greeting && greeting.at < ring.at + 300, 'her greeting is written while it rings')
  // While it rings: calling, not picked up, the clock at zero; nothing the microphone hears counts.
  // The phases before pick-up (the 'connected' note follows the listening phase in the same task, so compare by order).
  const ringing = result.phases.slice(0, result.phases.findIndex(row => row.connected))
  assert.ok(ringing.length && ringing.every(row => row.status === 'connecting' && !row.connected && row.elapsed === 0), JSON.stringify(ringing))
  assert.ok(!result.calls.some(call => call.method === 'phoneCallHear' && call.at < connected.at))
  const picked = result.phases.find(row => row.connected)
  assert.equal(picked.elapsed, 0)
  assert.ok(result.events.find(event => event.name === 'audio-start').at >= connected.at, 'her greeting sounds once she has picked up')
  // Hang up: 通话结束 at the press, the call let go about 1.5 s later.
  const pressed = await page.evaluate(() => { phoneModCall.command({action:'end'}); return performance.now(); })
  await page.waitForFunction(() => phoneModCall.get().status === 'idle', null, {timeout:5000})
  const after = await page.evaluate(() => ({phases, calls}))
  const ended = after.phases.find(row => row.status === 'ended'), idle = after.phases.find(row => row.status === 'idle' && row.at > ended.at)
  assert.ok(ended.at - pressed < 50, 'ended at the press')
  assert.ok(idle.at - ended.at >= 1400 && idle.at - ended.at < 2500, 'held ' + Math.round(idle.at - ended.at) + ' ms')
  assert.ok(after.calls.some(call => call.method === 'phoneCallEnd'))
})

test('hanging up while it rings stops the ring and the greeting; she never picks up', async t => {
  const {page, errors} = await openCall(t, [[10, 0.001]], `
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'もしもし', sub:'喂'}], done:true};
  `, {minMs:4000, maxMs:15000})
  await page.waitForFunction(() => phoneModCallProbe.events.some(event => event.name === 'ring'))
  await page.waitForTimeout(600)
  await page.evaluate(() => phoneModCall.command({action:'end'}))
  await page.waitForFunction(() => phoneModCall.get().status === 'idle', null, {timeout:5000})
  await page.waitForTimeout(300)
  const result = await page.evaluate(() => ({calls, events:phoneModCallProbe.events, attempts:phoneModCallProbe.attempts, phases}))
  assert.deepEqual(errors, [])
  assert.ok(!result.events.some(event => ['connected', 'audio-start'].includes(event.name)))
  assert.ok(result.phases.every(row => !row.connected))
  assert.equal(result.attempts[0].outcome, 'aborted', 'the greeting goes with the call')
  assert.ok(result.calls.some(call => call.method === 'phoneCallEnd'))
})

test('静音: while muted the player\'s words go unheard; unmuted, the next words are heard', async t => {
  // The greeting; words at 1.0-1.8 s (muted) and 3.4-4.2 s (unmuted) of the microphone.
  const {page, errors} = await openCall(t, [[1.0, 0.001], [0.8, 0.3], [1.6, 0.001], [0.8, 0.3], [6, 0.001]], `
    if (method === 'phoneCallHear') return {text:'喂？', ending:'complete', asrMs:20, endpoint:{probability:0.99}};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:args.turnId === 't1' ? 'もしもし' : 'うん。', sub:'喂'}], done:true};
  `)
  await page.waitForFunction(() => phoneModCall.get().connected)
  const muted = await page.evaluate(() => { phoneModCall.command({action:'mute', muted:true}); return performance.now(); })
  await page.waitForTimeout(2000)
  const unmuted = await page.evaluate(() => { phoneModCall.command({action:'mute', muted:false}); return performance.now(); })
  await page.waitForFunction(() => calls.some(call => call.method === 'phoneCallTurn' && call.args.said === '喂？'), null, {timeout:10000})
  const result = await page.evaluate(() => ({calls, events:phoneModCallProbe.events, phases}))
  assert.deepEqual(errors, [])
  assert.ok(result.phases.some(row => row.muted) && !result.phases.at(-1).muted)
  const starts = result.events.filter(event => event.name === 'speech-start').map(event => event.at)
  assert.ok(starts.every(at => at < muted || at > unmuted), 'nothing heard while muted')
  assert.ok(starts.some(at => at > unmuted), 'the next words were heard')
  assert.equal(result.calls.filter(call => call.method === 'phoneCallTurn' && !call.args.cue).length, 1)
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})

test('foreign captions reveal each whole subtitle only when its independently synthesized clause starts', async t => {
  // Her greeting is two lines that arrive at once; her audio clock stands still until the test moves it.
  const {page, errors} = await openCall(t, [[8, 0.001]], `
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'だって、', sub:'因为，', mood:'m04', part:true}, {index:1, say:'たのしいんだもん。', sub:'好玩呀。', mood:'m00'}, {index:2, say:'最後の一言。', sub:'最后一句。', mood:'m04'}], done:true};
  `, undefined, {fakeClock:true})
  // Both lines are synthesized and their whole audio (1.2 s, 0.6 s) is scheduled from 0.02 s before the clock moves.
  await page.waitForFunction(() => calls.filter(call => call.method === 'synthesize').length === 3, null, {timeout:20000})
  assert.deepEqual(await page.evaluate(() => calls.filter(call => call.method === 'synthesize').map(call => call.mood)), ['m04','m00','m04'])
  await page.waitForTimeout(1600)
  const at = async seconds => {
    await page.evaluate(value => { audioClock.t = value; }, seconds)
    await page.waitForTimeout(150)
    return page.evaluate(() => phoneModCall.get().lines.map(line => [line.text, line.revealing === true]))
  }
  assert.deepEqual(await page.evaluate(() => phoneModCall.get().lines), [], 'words that arrived but are not spoken yet are not shown')
  // The first clause lasts 0.4 s; the second has its own 0.3 s silent lead. Text proportions are irrelevant.
  assert.deepEqual(await at(0.1), [['因为，', true]], 'the first clause while it is being said')
  assert.deepEqual(await at(0.45), [['因为，', true]], 'the next clause is scheduled but still silent')
  assert.deepEqual(await at(0.6), [['因为，', true]], 'no duration proportion can reveal the second clause')
  assert.deepEqual(await at(0.8), [['因为，好玩呀。', true]], 'the whole second subtitle appears at its own audible start')
  assert.deepEqual(await at(1.1), [['因为，好玩呀。', true]], 'her last line waits for its own audio')
  assert.deepEqual(await at(1.3), [['因为，好玩呀。', false], ['最后一句。', true]], 'the last line once she says it')
  assert.deepEqual(await at(2), [['因为，好玩呀。', false], ['最后一句。', false]], 'whole once said')
  assert.equal(await page.evaluate(() => phoneModCall.get().status), 'listening', 'her reply is over when its audio is')
  assert.deepEqual(errors, [])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})

test('a Chinese voice\'s caption is her spoken line itself, clause by clause with the audio', async t => {
  const {page, errors} = await openCall(t, [[8, 0.001]], `
    if (method === 'phoneCallStart') return {callId:'c1', language:'zh', contact:{id:args.contactId, name:'爱音'}};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'因为，', sub:'因为，', part:true}, {index:1, say:'好玩呀。', sub:'好玩呀。'}], done:true};
  `, undefined, {fakeClock:true})
  await page.waitForFunction(() => calls.filter(call => call.method === 'synthesize').length === 2, null, {timeout:20000})
  await page.waitForTimeout(1600)
  const at = async seconds => {
    await page.evaluate(value => { audioClock.t = value; }, seconds)
    await page.waitForTimeout(150)
    return page.evaluate(() => phoneModCall.get().lines.map(line => [line.text, line.revealing === true]))
  }
  assert.deepEqual(await at(0.1), [['因为，', true]])
  assert.deepEqual(await at(2), [['因为，好玩呀。', false]])
  assert.deepEqual(errors, [])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})
test('a silent lead and device latency never reveal the answer before the first audible sample', async t => {
  const {page, errors} = await openCall(t, [[10, 0.001]], `
    if (method === 'phoneCallStart') return {callId:'c1', language:'zh', contact:{id:args.contactId, name:'辉夜'}};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'我是辉夜。', sub:'我是辉夜。'}], done:true};
  `, undefined, {fakeClock:true, outputLatency:0.2})
  await page.waitForTimeout(1900)
  await page.evaluate(() => { audioClock.t = 0.7 })
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => phoneModCall.get().lines), [], '0.8 s of silent PCM is not her speaking')
  await page.evaluate(() => { audioClock.t = 0.95 })
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(() => phoneModCall.get().lines), [], 'samples still in the output device are not heard yet')
  await page.evaluate(() => { audioClock.t = 2 })
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => phoneModCall.get().lines[0]?.text), '我是辉夜。')
  const timing = await page.evaluate(() => calls.findLast(row => row.method === 'phoneCallHeard').args.timing)
  assert.equal(timing.origin,1); assert.equal(timing.endpointMs,0)
  assert.equal(timing.outputLatencyMs,200)
  assert.ok(Number.isFinite(timing.ringToFirstPcmMs) && timing.ringToFirstPcmMs >= 0)
  assert.equal(await page.evaluate(() => calls.filter(row => row.method === 'phoneCallTtsRequested').length),1)
  assert.ok(timing.audibleMs - timing.scheduledMs >= 990, 'silent lead plus device latency are retained')
  assert.deepEqual(errors, [])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})

test('a failed or wholly silent voice never falls back to showing unspoken text', async t => {
  const {page, errors} = await openCall(t, [[10, 0.001]], `
    if (method === 'phoneCallStart') return {callId:'c1', language:'zh', contact:{id:args.contactId, name:'辉夜'}};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'VOICE_FAILED', sub:'秘密'}, {index:1, say:'silent', sub:'秘密'}], done:true};
  `, undefined, {fakeClock:true})
  await page.waitForTimeout(1000)
  await page.evaluate(() => { audioClock.t = 3 })
  await page.waitForTimeout(150)
  assert.deepEqual(await page.evaluate(() => phoneModCall.get().lines), [])
  assert.deepEqual(errors, [])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})
test('RTF 1.8 streams wait for completion and then play without stalls', async t => {
  const {page, errors} = await openCall(t, [[20, 0.001]], `
    if (method === 'phoneCallStart') return {callId:'c1', language:'zh', contact:{id:args.contactId, name:'辉夜'}};
    if (method === 'phoneCallPoll') return {segments:[{index:0, say:'Slow synthesis needs enough buffered audio.', sub:null}], done:true};
  `)
  await page.waitForFunction(() => phoneModCallProbe.attempts[0]?.outcome === 'completed', null, {timeout:15000})
  const timing = await page.evaluate(() => phoneModCallProbe.attempts[0].timing)
  const requestedAt = await page.evaluate(() => calls.find(row => row.method === 'synthesize').at)
  assert.ok(timing.audibleAt - requestedAt >= 5200, 'wait for the complete slow stream')
  assert.equal(timing.gaps || 0, 0)
  assert.ok(timing.startBufferSeconds >= 2.99, 'the entire utterance is buffered')
  assert.deepEqual(errors, [])
  await page.evaluate(() => phoneModCall.command({action:'end'}))
})
for (const language of ['zh','ja']) test(`${language}: an incomplete audio stream cannot use a guessed duration to reveal its later clauses`, async t => {
  const say=language==='zh'?'第一句，':'一。'
  const {page, errors}=await openCall(t,[[10,0.001]],`
    if(method==='phoneCallStart')return {callId:'c1',language:'${language}',contact:{id:args.contactId,name:'辉夜'}};
    if(method==='phoneCallPoll')return {segments:[{index:0,say:'${say}',sub:'第一句，',part:true},{index:1,say:'${language==='zh'?'最后的秘密。':'二。'}',sub:'最后的秘密。'}],done:true};
  `,undefined,{fakeClock:true})
  await page.waitForTimeout(4300)
  await page.evaluate(()=>{audioClock.t=0.8})
  await page.waitForTimeout(100)
  assert.deepEqual(await page.evaluate(()=>phoneModCall.get().lines.map(line=>line.text)),['第一句，'])
  assert.deepEqual(errors,[])
  await page.evaluate(()=>phoneModCall.command({action:'end'}))
  await page.waitForFunction(()=>calls.some(row=>row.method==='phoneCallEnd'))
  assert.deepEqual(await page.evaluate(()=>calls.find(row=>row.method==='phoneCallEnd').args.heard),[0], 'hang-up retains the started clause, never the queued suffix')
})
// Virtual-clock acceptance: real scheduler, decoder-sized bursts split into HTTP fragments, no wall-clock jitter.
for (const rtf of [0.5, 1, 1.8]) test(`gapless call buffer: RTF ${rtf}, complete synthesis before speaking`, async t => {
  const source = await readFile(new URL('../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  let now = 0
  const context = {get currentTime() { return now }, state:'running', baseLatency:0, outputLatency:0,
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
    createBufferSource:()=>({connect(){},start(){},disconnect(){}})}
  const timers = new Map()
  let timerId = 0
  const sandbox = {performance:{now:()=>now*1000},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {at:now+ms/1000,fn}); return id },
    clearTimeout:id=>timers.delete(id),
    forkStageAudio:{voice(){}}, rpc:async()=>({})}
  const advance = to => {
    for (;;) {
      const next = [...timers].filter(([, timer])=>timer.at<=to).sort((a,b)=>a[1].at-b[1].at)[0]
      if (!next) break
      timers.delete(next[0]); now=next[1].at; next[1].fn()
    }
    now=to
  }
  vm.runInNewContext(source.replace('probe.command = command;', 'probe.test = {learn, schedule, state: () => state, attach(c) { call = c; }}; probe.command = command;'), sandbox)
  const api = sandbox.phoneModCallProbe.test
  const line = {role:'contact',turn:'t',say:'x'.repeat(50),sub:null,started:false}
  const piece = {line,buffers:[],ended:false,startAt:null,requestedAt:0,arrivals:[],seconds:0,spans:[],scheduled:0}
  const turn = {id:'t',pieces:[piece],segments:[line],sources:new Set(),timing:{said:0,stoppedAt:0},started:0,playerLine:{cue:false},measure:{outcome:'pending'}}
  const c = {turn,language:'zh',lines:[line],playhead:0,out:{context,input:{}}}
  api.attach(c)
  const arrivals = [{at:0.42,seconds:0.186}]
  let total = 0.186, at = 0.42
  for (let size = 0.371; total < 8; size = 0.743) {
    const seconds = Math.min(size,8-total)
    at += seconds*rtf; total += seconds
    // Network reads in a decoder burst are not independent synthesis measurements.
    arrivals.push({at,seconds:seconds/2}, {at:at+0.001,seconds:seconds/2})
  }
  let oldHead = 0, oldStart, oldStalls = 0
  for (const [index, arrival] of arrivals.entries()) {
    advance(arrival.at)
    const dry = oldHead > 0 && oldHead < now + 0.02
    if (dry) oldStalls++
    const oldAt = Math.max(oldHead,now+(dry?0.12:0.02));oldStart ??= oldAt;oldHead=oldAt+arrival.seconds
    const samples = Float32Array.of(0.2)
    const buffer = {duration:arrival.seconds,sampleRate:44100,getChannelData:()=>samples}
    piece.arrivals.push([now*1000,piece.seconds]);piece.seconds+=arrival.seconds
    api.learn(c,piece,now*1000);piece.buffers.push(buffer)
    if(index===arrivals.length-1) { piece.ended=true; turn.done=true; }
    api.schedule(c,turn)
    if (!turn.done) {
      assert.equal(piece.startAt, null, 'no partial utterance is scheduled')
      assert.equal(api.state().status, 'thinking')
    }
  }
  const result={rtf,oldFirstSoundMs:Math.round(oldStart*1000),firstSoundMs:Math.round(piece.audibleAt*1000),oldStalls,stalls:turn.timing.gaps||0,startBufferSeconds:turn.timing.startBufferSeconds,estimatedRtf:c.rtf}
  t.diagnostic(JSON.stringify(result))
  assert.equal(result.firstSoundMs, Math.round((arrivals.at(-1).at + 0.02)*1000))
  assert.ok(Math.abs(c.rtf-rtf)<0.03, 'HTTP fragmentation must not corrupt the smoothed RTF')
  assert.equal(result.stalls,0, 'no synthesis underruns at any measured rate')
  if(rtf===1.8) t.diagnostic('single 8 s utterance, a3a0e3ced baseline retained: 14506 ms, 0 stalls')
})
// Same eight seconds as the single-utterance baseline, now three TTS clauses (2 + 3 + 3 seconds).
for (const rtf of [0.5, 1.8]) for (const slowdown of [false, true]) test(`sentence prediction RTF ${rtf}, slowdown ${slowdown}`, async t => {
  const source = await readFile(new URL('../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  let now = 0
  const context = {get currentTime() { return now }, state:'running', baseLatency:0, outputLatency:0,
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
    createBufferSource:()=>({connect(){},start(){},disconnect(){}})}
  const sandbox = {performance:{now:()=>now*1000},setTimeout:()=>1,clearTimeout(){},forkStageAudio:{voice(){}},rpc:async()=>({})}
  vm.runInNewContext(source.replace('probe.command = command;', 'probe.test = {learn, schedule, attach(c) { call = c; }}; probe.command = command;'), sandbox)
  const api = sandbox.phoneModCallProbe.test
  const pieces = [2,3,3].map(seconds => ({line:{role:'contact',turn:'t',say:'x'.repeat(seconds),sub:null,started:false},buffers:[],ended:false,startAt:null,requestedAt:0,arrivals:[],seconds:0,spans:[],scheduled:0}))
  const turn = {id:'t',pieces,segments:pieces.map(p=>p.line),sources:new Set(),timing:{said:0},started:0,playerLine:{cue:false},measure:{outcome:'pending'}}
  const c = {turn,rate:1,language:'zh',lines:turn.segments,playhead:0,out:{context,input:{}}}
  api.attach(c)
  let oldHead = 0, oldStart, oldIntra = 0, oldInter = 0, oldPauseMs = 0, pending = []
  const oldSchedule = () => {
    if (now < 1.98) return
    for (const entry of pending.splice(0)) {
      const at = Math.max(oldHead, now + 0.02)
      if (oldHead && at > oldHead + 1e-8) {
        if (entry.first) oldInter++; else oldIntra++
        oldPauseMs += (at-oldHead)*1000
      }
      oldStart ??= at; oldHead = at + entry.seconds
    }
  }
  let total = 0, slowed = false
  for (const [index,piece] of pieces.entries()) {
    const duration = [2,3,3][index]
    while (piece.seconds < duration - 1e-8) {
      const seconds = Math.min(total === 0 ? 0.186 : 0.371, duration-piece.seconds)
      const delay = slowdown && !slowed && index === 2 && turn.timing.firstScheduledAt !== undefined ? 5 : 0
      if (delay) slowed = true
      const arrival = total === 0 ? 0.42 : now + seconds*rtf + delay
      if (now < 1.98 && arrival > 1.98) { now = 1.98; oldSchedule() }
      now = arrival
      pending.push({seconds,first:piece.seconds===0});oldSchedule()
      piece.arrivals.push([now*1000,piece.seconds]);piece.seconds += seconds;total += seconds
      api.learn(c,piece,now*1000)
      piece.buffers.push({duration:seconds,sampleRate:44100,getChannelData:()=>Float32Array.of(0.2)})
      piece.ended = piece.seconds >= duration-1e-8
      // Deliberately leave the model open until the last audio: first start must not depend on model done.
      if (index===2 && piece.ended) turn.done=true
      api.schedule(c,turn)
      if (!piece.ended) assert.equal(piece.startAt,null,'no partial sentence may start')
    }
  }
  let intra = 0, inter = 0, pauseMs = 0, end
  for (const piece of pieces) {
    if (end !== undefined && piece.startAt > end+1e-8) { inter++;pauseMs+=(piece.startAt-end)*1000 }
    for (const [index,[at,seconds]] of piece.spans.entries()) {
      if (index && at > end+1e-8) intra++
      end=at+seconds
    }
  }
  const result={rtf,slowdown,firstVoiceMs:Math.round(pieces[0].audibleAt*1000),intra,inter,pauseMs:Math.round(pauseMs),oldFirstVoiceMs:Math.round(oldStart*1000),oldIntra,oldInter,oldPauseMs:Math.round(oldPauseMs)}
  t.diagnostic(JSON.stringify(result))
  assert.equal(intra,0)
  assert.ok(pieces[0].startAt < now,'do not wait for the whole reply')
  if (!slowdown) { assert.equal(inter,0);assert.equal(pauseMs,0) }
  else assert.ok(inter>0,'unexpected slowdown pauses only between sentences')
})

test('call setup never displays a raw host exception to the player', async t => {
  const {page} = await openCall(t, [[1, 0]], `
    if (method === 'phoneCallStart') throw new TypeError("Cannot read properties of undefined (reading 'id')");
  `)
  const state = await page.evaluate(() => phoneModCall.get())
  assert.equal(state.status, 'error')
  assert.equal(state.error, '暂时无法接通，请稍后再试')
})