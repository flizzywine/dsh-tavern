import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import {inspect} from 'node:util'
import {mkdtemp} from './helpers/temp-directory.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createFigureVoiceAuthoring} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {createServiceSettings} from '../tavern-plugin/packages/dsh-tavern-tts/src/settings.js'
import {FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
import {createRequire} from 'node:module'
const figureResolution=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')

const source=await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js',import.meta.url),'utf8')
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)})
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children||[]).flatMap(nodes)]:[]
function ui(){
  const ctx={h,structuredClone,figureResolution,PackSearchBox:'search',InlineGrid:'inline-grid',React:{Fragment:'fragment',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{}},Button:'button',Glyph:'glyph',Spinner:'spinner',SearchBox:'search',Segmented:'segmented',Popover:'popover',InlineRow:'inline-row',InlineGrid:'inline-grid',InlineField:'inline-field',EmptyState:'empty',sessionStorage:{setItem:()=>{}}}
  vm.createContext(ctx);vm.runInContext(source,ctx)
  vm.runInContext('useVoiceLoad=()=>({value:{voices:testVoices,models:[]}});this.catalogServices=catalogServices;',ctx)
  return ctx
}

for(const kind of ['minimax','qwen'])test(`${kind} only: new figure -> online voice -> saved preview keeps selected provider`,async t=>{
  const calls=[]
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk
    calls.push({path:req.url,body:JSON.parse(text||'{}')})
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({base_resp:{status_code:0},data:{audio:'01000200'}}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const root=new URL('../.tmp/',import.meta.url);await mkdir(root,{recursive:true})
  const library=createAssetPackService({assetRoot:await mkdtemp(fileURLToPath(new URL('online-flow-',root))),authorizeLease:async()=>true})
  const tts=createTts({profileId:'online-flow'})
  let settings
  if(kind==='minimax'){
    const mockUrl=`http://127.0.0.1:${server.address().port}`
    t.diagnostic(`MiniMax mock URL=${mockUrl} port=${server.address().port}`)
    const diagnosticFetch=async(...args)=>{
      try{return await globalThis.fetch(...args)}catch(error){
        t.diagnostic(`MiniMax fetch URL=${args[0]} port=${server.address().port} error=${inspect(error)} cause=${inspect(error.cause)}`)
        throw error
      }
    }
    settings=createServiceSettings({fetch:diagnosticFetch,get:()=>({enabled:true,providers:[{id:'mm',kind,config:{url:mockUrl,model:'speech-02-turbo'}}],voices:[]}),replace:async()=>{},credentials:()=>({resolve:async()=>({value:'mock-key'}),describe:async()=>({configured:true,writable:true})}),tts})
    settings.sync()
  }else tts.registerProvider('fixture',{id:'qw',kind,revision:'1',capabilities:{paid:false,serviceVoiceEngines:['qwen']},synthesize:async spec=>{calls.push({body:spec});return pcmWav(Buffer.alloc(100,1))}})
  const api=createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts})
  t.after(async()=>{api.dispose();settings?.dispose();await tts.dispose();await library.dispose()})
  let pack=(await library.createPack({name:'测试',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'新人物',enabled:true,outfits:[]}})).snapshot
  const figureId=pack.manifest.figures[0]
  assert.equal(pack.figures[figureId].voice,undefined)
  const ctx=ui(),voiceId=kind==='minimax'?'female-shaonv':'Cherry'
  // 新建声音 › this service: its voices are rows; 「使用」 makes the picked one a new voice of the pack the figure speaks with.
  const serviceId=kind==='minimax'?'mm':'qw'
  ctx.testVoices=[{id:voiceId,label:'少女',languages:['zh']},{id:kind==='minimax'?'female-yujie':'Serena',label:'御姐',languages:['zh']}]
  const writer=ctx.useVoiceWriter({binding:{service:library},pack,figure:pack.figures[figureId],setError:message=>assert.equal(message,''),commitVoice:async job=>{const result=await job(pack);pack=result.snapshot;return result}})
  const list=ctx.VoiceAddVoices({binding:{},service:{id:serviceId,kind,voiceList:'preset'},serviceKind:kind,bind:{},language:'zh',preview:{of:()=>null},candidate:spec=>spec,picked:null,onPick(){},withParams:spec=>spec})
  const row=list.props.rows.find(r=>r.name==='少女')
  await writer.createVoice(row.spec)
  const saved=await library.getPackSnapshot({packId:pack.manifest.id}),binding=saved.figures[figureId].voice,spec=saved.manifest.voiceLibrary.voices[binding.voice]
  assert.equal(spec.sources[binding.source??spec.defaultSource].provider,kind)
  assert.equal(spec.sources[binding.source??spec.defaultSource].voiceName,voiceId)
  assert.equal(spec.defaultSource,kind)
  assert.deepEqual((await api.editor({packId:pack.manifest.id,figureId})).issues,[])
  const input={packId:pack.manifest.id,figureId,expectedRevision:pack.revision}
  let preview=await api.preview(input,'http://localhost')
  if(preview.status==='confirmation-required')preview=await api.preview({...input,confirmToken:preview.confirmToken},'http://localhost')
  assert.equal(preview.status,'submitted')
  const result=await tts.jobs.wait(preview.requestId,'dsh-browser')
  assert.equal(result.state,'ready',JSON.stringify(result))
  assert.equal(calls.length,1)
  assert.equal(kind==='minimax'?calls[0].body.voice_setting.voice_id:calls[0].body.params.voice,voiceId)
  api.close({scope:preview.scope})
})

// 新建声音 / 编辑声音 list the services set up in 语音后端 (浏览器朗读 is its own); a service that offers no source kind is not listed.
test('新建声音 services: the catalog order, without 浏览器朗读 or a service with nothing to offer',()=>{
  const ctx=ui()
  assert.equal(ctx.catalogServices({services:[{id:'browser',kind:'browser',sources:['preset']}]}).length,0)
  const listed=ctx.catalogServices({services:[{id:'q',kind:'qwen',sources:['preset']},{id:'x',kind:'minimax',sources:[]},{id:'m',kind:'minimax',sources:['preset']}]})
  assert.deepEqual(listed.map(s=>s.id),['q','m'])
})

test('preview warning is per failed audition, not the selected provider',()=>{
  const ctx=ui()
  const failed=ctx.VoicePlay({state:{phase:'error',error:'账户余额不足'},label:'少女'})
  const untouched=ctx.VoicePlay({state:null,label:'御姐'})
  assert.equal(nodes(failed).find(n=>n.type==='glyph').props.name,'warning')
  assert.equal(failed.props.title,'账户余额不足')
  assert.equal(nodes(untouched).find(n=>n.type==='glyph').props.name,'play')
  for(const provider of ['minimax','qwen'])assert.match(ctx.voiceIssueText('SERVICE_REQUIRED',{provider}),/^这个声音绑定的语音服务还没设置.*重新选择/)
})

// 编辑声音's 保存 (useVoiceWriter saveVoice): the figure's voice becomes what the editor showed — the same voice, moved to
// another service, its other sources kept — and the figure speaks with it as it is (no source or language of its own left).
test('编辑声音 保存: the same voice is rewritten as the editor showed it; the figure speaks with it as it is',async t=>{
  const root=new URL('../.tmp/',import.meta.url);await mkdir(root,{recursive:true})
  const library=createAssetPackService({assetRoot:await mkdtemp(fileURLToPath(new URL('service-switch-',root))),authorizeLease:async()=>true})
  t.after(()=>library.dispose())
  let pack=(await library.createPack({name:'测试',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'新人物',enabled:true,outfits:[]}})).snapshot
  const figureId=pack.manifest.figures[0],ctx=ui()
  const commitVoice=async job=>{const result=await job(pack);pack=result.snapshot;return result}
  const writer=()=>ctx.useVoiceWriter({binding:{service:library},pack,figure:pack.figures[figureId],setError:message=>assert.equal(message,''),commitVoice})
  const voiceId='a'.repeat(32),fish={kind:'voice-id',provider:'fish-audio',voiceId,serviceId:'local',model:'drama-3'}
  await writer().createVoice({name:'声音',language:'ja',defaultSource:'fish',sources:{fish}})
  const id=pack.figures[figureId].voice.voice
  pack=(await library.saveFigureVoiceBinding({packId:pack.manifest.id,figureId,expectedRevision:pack.revision,binding:{voice:id,source:'fish',language:'zh'}})).snapshot
  const azure={kind:'preset',provider:'azure',voiceName:'ja-JP-NanamiNeural'}
  await writer().saveVoice({name:'新名字',language:'ja',defaultSource:'azure',sources:{fish:{...fish,serviceId:'cloud'},azure},variants:{normal:{name:'原声',tuning:{azure:{rate:10}}}}})
  const saved=pack.manifest.voiceLibrary.voices[id]
  assert.deepEqual([saved.name,saved.defaultSource,saved.sources.azure,saved.sources.fish.serviceId],['新名字','azure',azure,'cloud'])
  assert.deepEqual(saved.variants.normal.tuning,{azure:{rate:10}},'the parameters stay with the voice')
  assert.deepEqual(pack.figures[figureId].voice,{voice:id},'the same voice; the source and language the figure had chosen before are gone')
})
