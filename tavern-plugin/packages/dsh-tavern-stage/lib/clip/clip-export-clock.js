// Serialized into the isolated export document before the application factory runs.
// reading: the export's reading preference (stage-auto-timing.cjs CLIP_READING), which the timing plan assumes.
export function installClipClock(reading) {
  let seed=0x6d2b79f5
  Math.random=()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
  localStorage.setItem('fork-stage-reading',JSON.stringify(reading))
  const frames=new Map(),raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame
  window.requestAnimationFrame=fn=>{const id=raf(time=>{frames.delete(id);fn(time)});frames.set(id,fn);return id}
  window.cancelAnimationFrame=id=>{frames.delete(id);caf(id)}
  window.clipFlushFrame=()=>{const list=[...frames];frames.clear();for(const [id,fn] of list){caf(id);fn(performance.now())}}
  const animations=new WeakMap()
  window.clipSeekAnimations=()=>{for(const animation of document.getAnimations()){
    if(!animations.has(animation))animations.set(animation,performance.now())
    animation.pause();animation.currentTime=performance.now()-animations.get(animation)
  }}
  window.clipFrame=-1;window.clipAudioEvents=[];window.clipMedia=new Set();window.clipBlobs=new Map();window.clipOriginalVoices=new Map()
  const createURL=URL.createObjectURL.bind(URL)
  URL.createObjectURL=blob=>{const url=createURL(blob);window.clipBlobs.set(url,blob);return url}
  const media=new WeakMap(),prototype=HTMLMediaElement.prototype
  const getters=Object.fromEntries(['currentTime','paused','ended','duration','volume'].map(key=>[key,Object.getOwnPropertyDescriptor(prototype,key)]))
  function state(node) {
    if(!media.has(node)){media.set(node,{paused:true,offset:0,started:performance.now()});window.clipMedia.add(node)}
    return media.get(node)
  }
  function time(node){const value=state(node);return value.offset+(value.paused?0:(performance.now()-value.started)/1000*(node.playbackRate||1))}
  const event=(node,kind)=>window.clipAudioEvents.push({kind,frame:window.clipFrame,url:node.currentSrc||node.src,id:node.clipId,voiceKey:node.clipVoiceKey,layer:node.clipLayer || 'sfx',loop:node.loop,volume:node.volume*(node.clipGain ?? 1),offset:time(node)})
  let sequence=0
  prototype.play=function(){const value=state(this);this.clipId ||= 'element-'+(++sequence);if(!value.paused)return Promise.resolve();value.started=performance.now();value.paused=false;event(this,'play');this.dispatchEvent(new Event('play'));return Promise.resolve()}
  prototype.pause=function(){const value=state(this);if(value.paused)return;value.offset=time(this);value.paused=true;event(this,'stop');this.dispatchEvent(new Event('pause'))}
  Object.defineProperty(prototype,'currentTime',{configurable:true,get(){return media.has(this)?time(this):getters.currentTime.get.call(this)},set(value){const own=state(this);own.offset=Number(value)||0;own.started=performance.now()}})
  Object.defineProperty(prototype,'paused',{configurable:true,get(){return media.has(this)?state(this).paused:getters.paused.get.call(this)}})
  Object.defineProperty(prototype,'duration',{configurable:true,get(){return this.clipDuration ?? getters.duration.get.call(this)}})
  Object.defineProperty(prototype,'ended',{configurable:true,get(){return media.has(this)?!this.loop&&time(this)>=this.duration:getters.ended.get.call(this)}})
  Object.defineProperty(prototype,'volume',{configurable:true,get(){return getters.volume.get.call(this)},set(value){getters.volume.set.call(this,value);if(this.clipId)window.clipAudioEvents.push({kind:'gain',id:this.clipId,frame:window.clipFrame,gain:value*(this.clipGain ?? 1)})}})
  const buffers=new Map()
  window.clipTickMedia=()=>{
    for(const node of window.clipMedia)if(!node.paused){
      if(node.ended){const value=state(node);value.offset=node.duration;value.paused=true;event(node,'stop');node.dispatchEvent(new Event('ended'))}
      else window.clipAudioEvents.push({kind:'gain',id:node.clipId,frame:window.clipFrame,gain:node.volume*(node.clipGain ?? 1)})
    }
    for(const [source,row] of buffers) {
      window.clipAudioEvents.push({kind:'gain',id:row.id,frame:window.clipFrame,gain:window.clipGraphGain(source)})
      if(!source.loop&&performance.now()/1000-row.started+row.offset>=source.buffer.duration){buffers.delete(source);window.clipAudioEvents.push({kind:'stop',id:row.id,frame:window.clipFrame});source.dispatchEvent(new Event('ended'))}
    }
  }
  if(window.AudioContext) {
    // Read the production mixer graph against virtual parameter automation, not native wall time.
    const links=new WeakMap(),parameters=new WeakMap(),audioValue=Object.getOwnPropertyDescriptor(AudioParam.prototype,'value')
    const parameter=p=>{if(!parameters.has(p))parameters.set(p,{base:audioValue.get.call(p),events:[]});return parameters.get(p)}
    const valueAt=(p,time)=>{
      const row=parameter(p);let value=row.base,last=0
      for(const event of row.events){
        if(event.kind==='linear'||event.kind==='exponential'){
          if(time<event.time)return event.kind==='linear'?value+(event.value-value)*Math.max(0,(time-last)/(event.time-last)):value*Math.pow(event.value/value,Math.max(0,(time-last)/(event.time-last)))
          value=event.value
        }else if(time<event.time)break
        else if(event.kind==='target')value=event.value+(event.from-event.value)*Math.exp(-(time-event.time)/event.constant)
        else value=event.value
        last=event.time
      }
      return value
    }
    Object.defineProperty(AudioParam.prototype,'value',{configurable:true,get(){return valueAt(this,performance.now()/1000)},set(value){parameter(this).base=value;audioValue.set.call(this,value)}})
    for(const [method,kind] of Object.entries({setValueAtTime:'set',linearRampToValueAtTime:'linear',exponentialRampToValueAtTime:'exponential',setTargetAtTime:'target'}))AudioParam.prototype[method]=function(value,time,constant){const row=parameter(this);row.events.push({kind,value,time,constant,from:valueAt(this,time)});row.events.sort((a,b)=>a.time-b.time);return this}
    for(const method of ['cancelScheduledValues','cancelAndHoldAtTime'])AudioParam.prototype[method]=function(time){const row=parameter(this);row.base=valueAt(this,time);row.events=[];return this}
    const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect
    AudioNode.prototype.connect=function(target,...args){const rows=links.get(this)||new Set();rows.add(target);links.set(this,rows);return connect.call(this,target,...args)}
    AudioNode.prototype.disconnect=function(target,...args){if(target)links.get(this)?.delete(target);else links.delete(this);return target?disconnect.call(this,target,...args):disconnect.call(this)}
    window.clipGraphGain=node=>node instanceof AudioDestinationNode?1:(node instanceof GainNode?node.gain.value:1)*[...(links.get(node)||[])].reduce((sum,next)=>sum+window.clipGraphGain(next),0)
    // prepareVoice binds internally, bypassing the exported mixer.bind wrapper. Capture its real gain graph too.
    const createElementSource=AudioContext.prototype.createMediaElementSource
    AudioContext.prototype.createMediaElementSource=function(node){
      const source=createElementSource.call(this,node)
      Object.defineProperty(node,'clipGain',{configurable:true,get:()=>window.clipGraphGain(source)})
      return source
    }

    // The export mixes its audio offline from these events, so the stage mixer's idle suspend (a device power saving) is a
    // no-op here: a suspended context would hold the next play() for a native resume and shift its event off its frame.
    AudioContext.prototype.suspend=function(){return Promise.resolve()}
    Object.defineProperty(AudioContext.prototype,'currentTime',{configurable:true,get(){return performance.now()/1000}})
    const create=AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource=function(){
      const source=create.call(this),connect=source.connect.bind(source)
      let target,id
      source.connect=function(node,...args){target=node;return connect(node,...args)}
      source.start=function(when,offset=0,duration){
        if(target?.clipMusic){id='buffer-'+(++sequence);const row=target.clipMusic;row.id=id;window.clipAudioEvents.push({kind:'play',frame:window.clipFrame,id,url:row.url,layer:'music',offset,loop:source.loop,loopStart:source.loopStart,loopEnd:source.loopEnd,volume:window.clipGraphGain(source)});buffers.set(source,{id,started:performance.now()/1000,offset})}
      }
      source.stop=function(){if(id)window.clipAudioEvents.push({kind:'stop',frame:window.clipFrame,id});buffers.delete(source)}
      return source
    }
  }
  window.clipBegin=()=>{
    window.clipFrame=0
    const active=new Map()
    for(const row of window.clipAudioEvents){if(row.kind==='play')active.set(row.id,row);else if(row.kind==='stop')active.delete(row.id)}
    window.clipAudioEvents=[...active.values()].filter(row=>row.loop).map(row=>({...row,frame:0,offset:0}))
  }
}
