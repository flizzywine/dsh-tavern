// Frame medians / individually measured events from the approved sample TIMING.md (24 fps).
export const INTENSITIES=Object.freeze({restrained:{cap:5,scale:1.3},standard:{cap:8,scale:1},intense:{cap:12,scale:0.75}})
export const MORPHS=Object.freeze({
  '\u660e':['\u65e5','\u6708'], '\u6797':['\u6728','\u6728'], '\u68ee':['\u6728','\u6728','\u6728'],
  '\u4f11':['\u4eba','\u6728'], '\u597d':['\u5973','\u5b50'], '\u87f9':['\u89d2','\u5200','\u725b','\u866b'],
})
export const PRESETS=Object.freeze({
  punct:{category:1,frames:12,help:'small punctuation card',maxLength:12},
  title:{category:2,frames:58,help:'framed chapter title',maxLength:48},
  name:{category:3,frames:18,help:'spaced character name',maxLength:32},
  kanji:{category:4,frames:20,help:'one giant glyph',maxLength:1},
  word:{category:5,frames:20,help:'short phrase with whitespace',maxLength:48},
  vertical:{category:6,frames:30,help:'vertical columns; newline separates columns',maxLength:96},
  page:{category:7,frames:30,help:'dense paragraph page',maxLength:800},
  pattern:{category:8,frames:21,help:'repeated text wall; sub is background word',maxLength:32},
  split:{category:9,frames:72,help:'2-3 white divided panes',minItems:2,maxItems:3,maxLength:24},
  morph:{category:10,frames:48,help:'components assemble preset glyph',maxLength:1,enum:Object.keys(MORPHS)},
  pair:{category:11,frames:4,help:'two words alternate; inversion is safety gated',minItems:2,maxItems:2,maxLength:12,sequence:true,colour:true},
  build:{category:12,frames:82,help:'progressive input; final state held',maxItems:8,maxLength:96,build:true},
  count:{category:13,frames:4,help:'countdown; one digit auto expands, or explicit number words',maxItems:8,maxLength:12,sequence:true},
  code:{category:14,frames:41,help:'code with dots and bars',maxLength:48},
  diagram:{category:15,frames:152,help:'2-8 connected label nodes',minItems:2,maxItems:8,maxLength:32},
  marker:{category:16,frames:30,help:'recall/aside/ad/next or custom scene marker',maxLength:24},
  colour:{category:22,frames:8,help:'same layout with semantic palette',maxItems:8,maxLength:24,sequence:true,colour:true},
  oversized:{category:23,frames:20,help:'giant cropped word',maxLength:12},
  flash:{category:5,frames:8,help:'short word sequence on stable ink ground',minItems:2,maxItems:8,maxLength:48,sequence:true},
})
export const intensityOf=settings=>Object.hasOwn(INTENSITIES,settings?.values?.intensity)?settings.values.intensity:'standard'

export function textcardHistory({style,text,sub}) {
  return {kind:'textcard',style,text:text.join(' / '),parts:[...text],...(sub?{sub}:{})}
}
export function textcardPayload(params,intensity='standard') {
  const preset=PRESETS[params.style],scale=INTENSITIES[intensity].scale
  let steps=[...params.text]
  if(preset.build && steps.length===1) {
    const letters=[...steps[0]],count=Math.min(8,letters.length)
    steps=Array.from({length:count},(_,i)=>letters.slice(0,Math.ceil((i+1)*letters.length/count)).join(''))
  }
  if(params.style==='count' && steps.length===1 && /^[0-7]$/.test(steps[0]))steps=Array.from({length:Number(steps[0])+1},(_,i)=>String(Number(steps[0])-i))
  // Full-screen transitions need 9-frame spacing even at the strongest intensity.
  const base=Math.max(preset.colour?9:3,Math.round(preset.frames*scale))
  let stepFrames
  if(preset.sequence)stepFrames=steps.map(()=>base)
  else if(preset.build) {
    const first=Math.max(3,Math.floor(base/2/Math.max(1,steps.length-1)))
    stepFrames=steps.map((_,i)=>i===steps.length-1?Math.max(9,base-first*(steps.length-1)):first)
  } else stepFrames=[Math.max(9,base)]
  const markers={recall:'\u56de\u60f3',aside:'\u9591\u8a71\u4f11\u984c',ad:'\u4ee5\u4e0b\u5ee3\u544a',next:'\u6b21\u56de'}
  const shown=preset.build?[steps.at(-1)]:preset.sequence?steps:params.style==='marker'?[markers[params.text[0]] || params.text[0]]:params.text
  const history=textcardHistory({...params,text:shown})
  return {version:1,playback:'live-once',...(params.placement?{placement:params.placement}:{}),style:params.style,parts:[...params.text],...(params.sub?{sub:params.sub}:{}),text:history.text+(params.sub?' / '+params.sub:''),intensity,steps,frames:stepFrames.reduce((a,b)=>a+b,0),stepFrames,fps:24,minColourFrames:9,history}
}
