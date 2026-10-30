// New-input compiler only. Stored compound plans never pass through this compiler on replay.
import {INTENSITIES,MORPHS} from './presets.js'
export const TEXTCARD_COMPOUND_KIND='dsh.textcard.compound'
export const TEXTCARD_TEMPLATE_IDS=Object.freeze(['show','title','sequence','count','relate','compare','reveal','repeat','read'])
const markers={recall:['\u56de\u60f3','RECALL'],aside:['\u9591\u8a71\u4f11\u984c','DIGRESSION'],ad:['\u4ee5\u4e0b\u5ee3\u544a','COMMERCIAL'],next:['\u6b21\u56de','NEXT']}
const punct={'\u8d64\u9f63':'vermilion','\u9ed2\u9f63':'ink','\u9ed1\u9f63':'ink','\u767d\u9f63':'paper'}
const colourWords=[[/^[\u8d64\u7ea2\u7d05\u6731]/,'vermilion','RED'],[/^\u767d/,'paper','WHITE'],[/^[\u9ed1\u9ed2]/,'ink','BLACK'],[/^[\u91d1\u9ec4\u9ec3]/,'gold','GOLD']]
const fail=(path,message)=>{throw Object.assign(new Error(message),{code:'MOD_API_UNSUPPORTED',path})}
const length=value=>[...value].length

// Structural bounds/unknown fields belong to the installed command schema; these are its semantic constraints.
export function assertTextcardSemantics(commandId,params) {
  const nonblank=(value,path)=>{
    if(typeof value==='string' && !value.trim())fail(path,'Use nonblank text or omit this optional field.')
    else if(Array.isArray(value))value.forEach((item,i)=>nonblank(item,path+'['+i+']'))
    else if(value && typeof value==='object')for(const [key,item] of Object.entries(value))nonblank(item,path+'.'+key)
  }
  nonblank(params,'$.params')
  const max=(value,n,path)=>{if(length(value)>n)fail(path,`Use at most ${n} characters; shorten this text.`)}
  if(commandId==='show')max(params.text,{word:48,name:32,marker:24,vertical:96,punct:12}[params.preset || 'word'],'$.params.text')
  if(commandId==='sequence' && params.kind==='signal')params.words.forEach((word,i)=>max(word,24,'$.params.words['+i+']'))
  if(commandId==='relate') {
    const ids=new Set()
    params.people.forEach(({id},i)=>{
      if(ids.has(id))fail('$.params.people['+i+'].id','Duplicate node '+id+'; use a unique local ID for each person.')
      ids.add(id)
    })
    params.links.forEach((link,i)=>{
      for(const key of ['from','to'])if(!ids.has(link[key]))fail('$.params.links['+i+'].'+key,'Unknown node '+link[key]+'; use one of '+[...ids].join(', ')+'.')
      if(link.from===link.to)fail('$.params.links['+i+'].to','Use a different node from '+link.from+'; a relationship connects two people.')
    })
  }
}

const ink=bg=>bg==='figure'?'auto':['ink','vermilion'].includes(bg)?'paper':'ink'
const size=text=>length(text.replace(/\s/g,''))<=2?'xl':length(text.replace(/\s/g,''))<=8?'l':'m'
const frame=(style,layout,f,state,{bg='paper',face='mincho',size:fontSize='m',motif='reading',dir='h'}={})=>({style,layout,f,bg,fg:ink(bg),type:{face,size:fontSize},motif,dir,state})
const partition=(total,n)=>Array.from({length:n},(_,i)=>Math.floor((i+1)*total/n)-Math.floor(i*total/n))

export function compileTextcard(commandId,params,intensity='standard') {
  assertTextcardSemantics(commandId,params)
  const scaled=f=>Math.max(3,Math.round(f*INTENSITIES[intensity].scale))
  const frames=[],parts=[]
  let graph
  const add=(...args)=>frames.push(frame(...args))
  const remember=(...texts)=>parts.push(...texts.filter(text=>text!==undefined))
  const card=(style,text,sub)=>{
    const defaults={word:['card',20,'paper','auto'],kanji:['card',20,'paper','xl'],name:['name',18,'figure','l'],marker:['marker',30,'vermilion','l'],vertical:['card',30,'paper','m'],punct:['punct',12,punct[text] || 'ink','xs'],title:['title',58,'ink','m'],oversized:['card',20,'vermilion','crop']}
    const [layout,f,bg,fontSize]=defaults[style]
    const marker=style==='marker'?markers[text]:null
    const shown=marker?.[0] || text
    add(style,layout,scaled(f),{text:shown,sub:sub || '',size:fontSize==='auto'?size(shown):fontSize,...(marker?{roman:marker[1]}:{}),...(style==='oversized'?{anchor:'center'}:{})},{bg,size:fontSize,dir:style==='vertical'?'v':'h',motif:style==='title'?'frame':style==='name'?'rule':'reading'})
    return shown
  }
  switch(commandId) {
    case 'show': {
      let style=params.preset || 'word'
      if(style==='word' && length(params.text)===1)style='kanji'
      remember(card(style,params.text,params.sub),params.sub)
      break
    }
    case 'title': remember(card('title',params.text,params.sub),params.sub);break
    case 'sequence': {
      const signal=params.kind==='signal'
      if(!signal && params.words.length===1)card('word',params.words[0],params.sub)
      else {
        let other=0
        for(const text of params.words) {
          const match=signal?colourWords.find(([pattern])=>pattern.test(text)):null
          const bg=signal?(match?.[1] || (other++%2?'paper':'figure')):'ink'
          add(signal?'colour':'flash','flash',Math.max(signal?9:3,scaled(8)),{text,sub:params.sub || match?.[2] || '',size:size(text)},{bg,size:'auto',motif:signal?'english':'none'})
        }
      }
      remember(...params.words,params.sub)
      break
    }
    case 'count': {
      for(let n=params.from;n>=0;n--)add('count','flash',n===0?12:24,{text:String(n),sub:params.label || '',size:'xl'},{bg:'ink',size:'xl',motif:'none'})
      remember(...frames.map(row=>row.state.text),params.label)
      break
    }
    case 'relate': {
      const columns=Math.ceil(params.people.length/2),rows=Math.ceil(params.people.length/columns)
      const people=params.people.map((person,i)=>({...person,x:(i%columns+0.5)/columns,y:(Math.floor(i/columns)+0.5)/rows}))
      const links=params.links.map(link=>({...link}))
      // Store graph content once; frames record only reveal counts, not repeated copies of every label.
      graph={people,links,sub:params.heading || ''}
      const state=(visiblePeople,visibleLinks)=>({visiblePeople,visibleLinks})
      partition(scaled(24),people.length).forEach((f,i)=>add('relate','relate',f,state(i+1,0),{size:'s',motif:'lines'}))
      partition(scaled(24),Math.max(1,links.length)).forEach((f,i)=>add('relate','relate',f,state(people.length,Math.min(i+1,links.length)),{size:'s',motif:'lines'}))
      add('relate','relate',scaled(104),state(people.length,links.length),{size:'s',motif:'lines'})
      const names=new Map(people.map(person=>[person.id,person.name]))
      remember(params.heading,...people.map(person=>person.name),...links.map(link=>names.get(link.from)+' -> '+names.get(link.to)+': '+link.label))
      break
    }
    case 'compare': {
      const pair=params.sides.length===2,n=pair?{restrained:4,standard:6,intense:8}[intensity]:3
      for(let i=0;i<n;i++) {
        const bg=pair && Math.floor(i/2)%2?'paper':'ink'
        add(pair?'pair':'flash','flash',Math.max(pair?9:3,scaled(pair?4:8)),{text:params.sides[i%params.sides.length].name,sub:params.topic || '',size:size(params.sides[i%params.sides.length].name)},{bg,size:'auto',motif:pair?'invert':'none'})
      }
      add('split','split',scaled(72),{cells:params.sides.length,panes:params.sides.map(side=>side.text),names:params.sides.map(side=>side.name),sub:params.topic || ''},{size:'xl',motif:'rules'})
      remember(params.topic,...params.sides.map(side=>side.name+': '+side.text))
      break
    }
    case 'reveal': {
      const letters=[...params.answer],n=Math.min(8,letters.length)
      const steps=params.clues?[...params.clues,params.answer]:Array.from({length:n},(_,i)=>letters.slice(0,Math.ceil((i+1)*letters.length/n)).join(''))
      const total=scaled(82),early=Math.max(3,Math.floor(total/2/Math.max(1,steps.length-1)))
      steps.forEach((text,i)=>{
        const last=i===steps.length-1,previous=i?steps[i-1]:'',committed=last?text:text.startsWith(previous)?previous:''
        add('build','ime',last?total-early*(steps.length-1):early,{committed,typing:last?'':text.slice(committed.length),caret:!last,final:params.answer,sub:params.caption || ''},{motif:'caret'})
      })
      if(Object.hasOwn(MORPHS,params.answer)) {
        const total=scaled(48),first=Math.round(total*34/48)
        add('morph','morph',first,{parts:[...MORPHS[params.answer]],text:params.answer,converge:true,sub:params.caption || ''},{size:'xl',motif:'gloss'})
        add('morph','morph',total-first,{parts:[],text:params.answer,final:true,sub:params.caption || ''},{size:'xl',motif:'gloss'})
      }
      remember(...steps,params.caption)
      break
    }
    case 'repeat':
      add('pattern','wall',scaled(21),{text:params.word,fill:params.echo ?? params.word,sub:params.label || ''},{size:'s',motif:'drift'})
      card(length(params.word)<=12?'oversized':'word',params.word,params.label)
      remember(params.word,...(params.echo===undefined?[]:[params.echo]),params.label)
      break
    case 'read':
      add('code','code',scaled(41),{text:params.code,sub:params.heading || ''},{face:'mono',size:'l',motif:'bars'})
      add('page','page',scaled(30),{text:params.body,sub:params.heading || ''},{size:'s',dir:'v',motif:'margin'})
      remember(params.heading,params.code,params.body)
      break
    default: fail('$.commandId','Choose a textcard command: '+TEXTCARD_TEMPLATE_IDS.join(', ')+'.')
  }
  // A minute-long count shares its appearance, staying within the host's per-round JSON node budget.
  let view,storedFrames=frames
  if(commandId==='count') {
    const {f,state,...appearance}=frames[0]
    view={...appearance,state:{sub:state.sub,size:state.size}}
    storedFrames=frames.map(row=>({f:row.f,state:{text:row.state.text}}))
  }
  return {version:1,playback:'live-once',template:commandId,placement:params.placement || (commandId==='title'?'before':'after'),intensity,fps:24,minColourFrames:9,
    frames:storedFrames,...(view?{view}:{}),...(graph?{graph}:{}),text:parts.join(' / '),history:{kind:'textcard',style:commandId,parts:[...parts],text:parts.join(' / ')}}
}
