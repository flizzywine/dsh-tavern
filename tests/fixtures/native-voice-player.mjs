// native TTS descriptor/synthesis/audio boundary; no host queue facade.
import { createRequire } from 'node:module'
const {createPackVoicePlayer} = createRequire(import.meta.url)('../../tavern-plugin/src/client/pack-playback.cjs')
export const tick = () => new Promise(resolve => setImmediate(resolve))
export function voiceFixture({play, audio: readAudio, maxClips, maxBytes} = {}) {
  let now = 0, serial = 0, rate = 1
  const timers = new Map(), audios = [], synths = [], reads = [], revoked = []
  class Audio {
    paused = true; volume = 1; currentTime = 0
    constructor(url) { this.src = url; audios.push(this) }
    load() { this.loadedAt = now }
    play() { this.playedAt = now; this.paused = false; this.onplay?.(); return play ? play(this) : Promise.resolve() }
    pause() { this.paused = true; this.onpause?.() }
  }
  const client = {apiVersion:1,available:()=>true,subscribe:()=>()=>{},
    async synthesize(input, options) { synths.push({input,options}); return {key:input.text,ticket:input.text} },
    async audio(ticket, options) { reads.push({ticket,options}); return readAudio ? readAudio(ticket,options) : {size:1000} }}
  const descriptor = {available:true,voiceId:'work/actor',scope:'dsh-browser',language:'en',readings:[]}
  const player = createPackVoicePlayer({maxClips,maxBytes,getClient:()=>client,createAudio:url=>new Audio(url),
    prepareAudio(audio, _blob, result) { audio.preservesPitch=true;audio.playbackRate=rate;audio.loudness=result?.loudness },
    disposeAudio(audio) { audio.graphDisposed = true },
    urls:{createObjectURL:()=>'blob:'+serial++,revokeObjectURL:url=>revoked.push(url)},now:()=>now,
    schedule(fn,delay) { const id=++serial;timers.set(id,{fn,delay,at:now+delay});return id },cancel:id=>timers.delete(id)})
  player.setEnabled(true)
  const input = id => ({owner:'owner',id,text:id,mood:'calm'})
  return {player,client,descriptor,input,audios,synths,reads,revoked,timers,
    prefetch:id=>player.prefetch(descriptor,input(id)),play:(id,extra={})=>player.play(descriptor,{...input(id),...extra}),
    rate(value) { rate=value;player.setRate(value) },
    advance(ms) { const end=now+ms;for (;;) {const next=[...timers.values()].filter(t=>t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;now=next.at;next.at+=next.delay;next.fn()}now=end }}
}
