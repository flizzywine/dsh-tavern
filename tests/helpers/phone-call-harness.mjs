// A scripted call for turn-taking measurements: the production phone-call.js on a page with Chromium's fake microphone
// (a WAV of timed sound bursts), a scripted recognizer (one transcript per utterance, for the pause snapshot and the
// live line alike), a scripted model (segments per turn, optionally late) and her voice streamed as float WAV tones.
// Returns the probe events, RPC calls and the metrics turn-taking is judged by (phone-call.md「轮换与插话」).
import {stageHelpersSource} from './stage-helpers-source.mjs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {mkdtemp} from './temp-directory.mjs'

const RATE = 16000
// `parts`: [seconds, amplitude] bursts; amplitude 0.3 is speech-like noise with a 4 Hz syllable envelope.
export function micWav(parts) {
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
// Her line as dsh-tavern-tts streams it: `seconds` of a 220 Hz tone after 20 ms of silence, 100 ms per chunk every 10 ms (a fast
// synthesis: the whole reply is complete, and so may play, well before the player's scripted sound); `rtf` 3 sends a
// chunk every 300 ms (a voice slower than real time).
function serveLine(res, seconds, rtf = 0.1) {
  const rate = 44100, head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(0xFFFFFFFF, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(3, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 4, 28)
  head.writeUInt16LE(4, 32); head.writeUInt16LE(32, 34); head.write('data', 36); head.writeUInt32LE(0xFFFFFFFF - 36, 40)
  res.writeHead(200, {'Content-Type':'audio/wav'})
  let sent = 0
  const chunk = () => {
    if (res.destroyed) return
    const n = Math.round(rate * 0.1), out = Buffer.alloc(n * 4)
    for (let i = 0; i < n; i++) out.writeFloatLE(sent * n + i < rate * 0.02 ? 0 : 0.3 * Math.sin((sent * n + i) / rate * 2 * Math.PI * 220), i * 4)
    res.write(sent === 0 ? Buffer.concat([head, out]) : out)
    if (++sent * 0.1 >= seconds) res.end(); else setTimeout(chunk, 100 * rtf)
  }
  chunk()
}

// Her cached greeting as the host sends it with phoneCallStart: a 16-bit WAV, `seconds` of a 330 Hz tone after 20 ms of silence.
export function greetingWav(seconds) {
  const rate = 44100, count = Math.round(rate * seconds), data = Buffer.alloc(count * 2), head = Buffer.alloc(44)
  for (let i = 0; i < count; i++) data.writeInt16LE(i < rate * 0.02 ? 0 : Math.round(9000 * Math.sin(i / rate * 2 * Math.PI * 330)), i * 2)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data]).toString('base64')
}

/**
 * scenario: {
 *   mic: [[seconds, amplitude], ...]                     the player's microphone
 *   utterances: [{text, ending?, probability?}, ...]     the recognizer's answer for each utterance (by order of speech start)
 *   turns: {t1:{segments:[{say, sub?, seconds, rtf?, voiceDelayMs?}], delayMs?}, ...}  the model's reply per turn id (t1 =
 *                                                        greeting); a segment's voice streams at `rtf` after `voiceDelayMs`
 *   greeting: {say, sub, seconds}?                       her cached pick-up greeting sent with phoneCallStart
 *   waitMs                                               how long the call runs before it is read out
 * }
 * `source`: a phone-call.js to run instead of the worktree's (BEFORE/AFTER comparisons).
 */
export async function runCall(t, scenario, {source} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-call-turns-'))
  const mic = path.join(dir, 'mic.wav')
  await writeFile(mic, micWav(scenario.mic))
  const code = await readFile(source || new URL('../../tavern-plugin/src/client/phone-call.js', import.meta.url), 'utf8')
  const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to))
  const helpers = between(await readFile(new URL('../../tavern-plugin/src/client/bubble-line.cjs', import.meta.url), 'utf8'), 'function bubbleSpeechCut', 'function createBubbleStream')
    + stageHelpersSource
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/tts') return serveLine(res, Number(url.searchParams.get('seconds')) || 1, Number(url.searchParams.get('rtf')) || undefined)
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
    window.scenario = ${JSON.stringify({utterances:scenario.utterances, turns:scenario.turns,
      greeting:scenario.greeting ? {say:scenario.greeting.say, sub:scenario.greeting.sub, mood:'default', loudness:{gain:1}, audio:greetingWav(scenario.greeting.seconds)} : null})};
    window.calls = []; window.gains = [];
    const voicePlayer = {subscribe() { return () => {}; }, get: () => null, stopPlayback() {}};
    const forkLipSync = {wake() {}};
    const forkForeground = {keepAudio() { return () => {}; }};
    const forkStageAudio = {
      voiceStream() {
        const context = new AudioContext(), input = context.createGain(); input.connect(context.destination);
        // The call's own gain on its voice: every target it is given is kept (ducking evidence).
        const set = input.gain.setTargetAtTime.bind(input.gain);
        input.gain.setTargetAtTime = (value, at, constant) => { gains.push({at:performance.now(), value, constant}); return set(value, at, constant); };
        window.voiceInput = input;
        return {input, context, paused:true, ended:false, muted:false, volume:1, currentTime:0};
      },
      voice() {}, release() {}, call() {}, voiceLevel() {},
      callInput() { const context = new AudioContext(), input = context.createGain(); input.connect(context.destination); return {input, context}; },
    };
    const voices = {};
    for (const turn of Object.values(scenario.turns)) for (const segment of turn.segments) voices[segment.say] = segment;
    const ttsClient = {
      available: () => true,
      async synthesize(input, {signal, onStream}) {
        calls.push({method:'synthesize', at:performance.now(), text:input.text});
        const voice = voices[input.text] || {};
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 50 + (voice.voiceDelayMs || 0));
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('ABORTED'), {code:'ABORTED'})); }, {once:true});
        });
        if (signal.aborted) throw Object.assign(new Error('ABORTED'), {code:'ABORTED'});
        onStream({url:'/tts?seconds=' + (voice.seconds || 1) + (voice.rtf ? '&rtf=' + voice.rtf : ''), loudness:{gain:1}});
        await new Promise(resolve => setTimeout(resolve, 200));
        return {ticket:'t', loudness:{gain:1}};
      },
    };
    const forkTtsScope = {get: name => name === 'ttsClient' ? ttsClient : null};
    let turns = 0;
    const bytesOf = audio => atob(audio).length;
    // Which utterance is being heard: the count of speech starts so far (the greeting asks nothing).
    const utterance = () => scenario.utterances[Math.max(0, phoneModCallProbe.events.filter(event => event.name === 'speech-start').length - 1)] || {text:''};
    const asr = {sessions:new Map(), serial:0};
    const snap = row => ({id:row.id, revision:row.revision, text:row.text, language:'zh', done:false, error:null, timing:null});
    async function host(method, args) {
      if (method === 'phoneCallHear') { const u = utterance(); return {text:u.text, ending:u.ending || 'complete', asrMs:40, endpoint:{probability:u.probability ?? (u.ending === 'open' ? 0.3 : 0.98)}}; }
      // The live line: each appended chunk is decoded 120 ms later, two characters per 400 ms of audio heard so far.
      if (method === 'startSpeechRecognition') { const row = {id:'r' + ++asr.serial, bytes:0, revision:0, text:'', cancelled:false, words:utterance().text}; asr.sessions.set(row.id, row); return snap(row); }
      if (method === 'appendSpeechRecognition') {
        const row = asr.sessions.get(args.id); row.bytes += bytesOf(args.audio);
        const bytes = row.bytes; setTimeout(() => { if (!row.cancelled) { row.revision++; row.text = Array.from(row.words).slice(0, Math.round(bytes / 6400)).join(''); } }, 120);
        return snap(row);
      }
      if (method === 'pollSpeechRecognition') return snap(asr.sessions.get(args.id));
      if (method === 'cancelSpeechRecognition') { asr.sessions.get(args.id).cancelled = true; return {cancelled:true}; }
      if (method === 'phoneCallPoll') {
        const turn = scenario.turns[args.turnId] || {segments:[]};
        if (turn.delayMs) await new Promise(resolve => setTimeout(resolve, turn.delayMs));
        return {segments:turn.segments.map((segment, index) => ({index, say:segment.say, sub:segment.sub ?? segment.say, mood:null})), done:true, timing:{totalMs:1}};
      }
    }
    async function rpc(method, args) {
      calls.push({method, at:performance.now(), args:method === 'phoneCallHear' ? {seconds:bytesOf(args.audio) / 32000} : method === 'appendSpeechRecognition' ? {...args, audio:bytesOf(args.audio)} : args});
      const answer = await host(method, args);
      if (answer !== undefined) return answer;
      if (method === 'phoneCallStart') return {callId:'c1', language:'zh', contact:{id:args.contactId, name:'她'}, ...(scenario.greeting ? {greeting:scenario.greeting} : {})};
      if (method === 'phoneCallTurn') return {turnId:'t' + ++turns, elapsedMs:0};
      if (method === 'openAssetPackVoice') return {available:true, voice:{id:'v'}, scope:'s', language:'zh'};
      if (method === 'phoneCallThreads') return {threads:{}};
      return {};
    }
    ${helpers}
    ${code}
    phoneModCallProbe.ring = {minMs:0, maxMs:15000};
    window.phoneModCall = phoneModCall;
    window.phases = [];
    phoneModCall.subscribe(() => { const s = phoneModCall.get(), last = phases.at(-1); if (!last || last.status !== s.status) phases.push({at:performance.now(), status:s.status}); });
  `})
  await page.evaluate(() => phoneModCall.command({sessionId:'s', action:'start', contactId:'anon'}))
  await page.waitForTimeout(scenario.waitMs)
  const result = await page.evaluate(() => ({calls, gains, phases, events:phoneModCallProbe.events, attempts:phoneModCallProbe.attempts.map(row => ({turnId:row.turnId, outcome:row.outcome, cue:row.cue})), state:phoneModCall.get()}))
  return {...result, errors, metrics:metricsOf(result)}
}

// The judge's numbers for one scenario.
export function metricsOf(result) {
  const events = result.events, starts = events.filter(event => event.name === 'speech-start')
  const bargeIns = events.filter(event => event.name === 'barge-in')
  // Time to yield: from each speech start to the barge-in it led to (before the next speech start).
  const yields = starts.map((start, index) => { const next = starts[index + 1]?.at ?? Infinity, cut = bargeIns.find(event => event.at >= start.at && event.at < next); return cut ? Math.round(cut.at - start.at) : null }).filter(value => value !== null)
  const requests = result.calls.filter(call => call.method === 'phoneCallTurn' && !call.args.cue)
  const ducks = result.gains.filter(gain => gain.value < 1)
  return {
    speechStarts:starts.length,
    bargeIns:bargeIns.length,
    requests:requests.map(call => call.args.said),
    yieldsMs:yields,
    duckedMs:ducks.length ? ducks.map(duck => Math.round(duck.at - (starts.findLast(start => start.at <= duck.at)?.at ?? duck.at))) : [],
    ignored:events.filter(event => event.name === 'ignored').map(event => event.kind),
    outcomes:result.attempts.map(row => row.outcome),
    completed:result.attempts.filter(row => row.outcome === 'completed').length,
  }
}
