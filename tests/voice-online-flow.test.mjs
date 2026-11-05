import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import {mkdtemp} from './helpers/temp-directory.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createFigureVoiceAuthoring} from '../tavern-plugin/packages/dsh-tavern-stage/lib/figure-voice-authoring.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {createServiceSettings} from '../tavern-plugin/packages/dsh-tavern-tts/src/settings.js'
import {FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'

const source=await readFile(new URL('../tavern-plugin/src/client/asset-pack-voice-ui.js',import.meta.url),'utf8')
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)})
const nodes=tree=>tree&&typeof tree==='object'?[tree,...(tree.children||[]).flatMap(nodes)]:[]
function ui(){
  const ctx={h,structuredClone,React:{Fragment:'fragment',useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:()=>{}},Button:'button',Glyph:'glyph',Spinner:'spinner',SearchBox:'search',Segmented:'segmented',Popover:'popover',sessionStorage:{setItem:()=>{}}}
  vm.createContext(ctx);vm.runInContext(source,ctx)
  vm.runInContext('useVoiceModelStatus=()=>({value:{issues:[]}});useVoiceLoad=()=>({value:{voices:testVoices,models:[]}});this.rows=voiceWayRows;',ctx)
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
    settings=createServiceSettings({get:()=>({enabled:true,providers:[{id:'mm',kind,config:{url:`http://127.0.0.1:${server.address().port}`,model:'speech-02-turbo'}}],voices:[]}),replace:async()=>{},credentials:()=>({resolve:async()=>({value:'mock-key'})}),tts})
    settings.sync()
  }else tts.registerProvider('fixture',{id:'qw',kind,revision:'1',capabilities:{paid:false,serviceVoiceEngines:['qwen']},synthesize:async spec=>{calls.push({body:spec});return pcmWav(Buffer.alloc(100,1))}})
  const api=createFigureVoiceAuthoring({getLibrary:()=>library,getTts:()=>tts})
  t.after(async()=>{api.dispose();settings?.dispose();await tts.dispose();await library.dispose()})
  let pack=(await library.createPack({name:'测试',expectedRevision:null})).snapshot
  pack=(await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,id:FIGURE_ID,name:'新人物',enabled:true,outfits:[]}})).snapshot
  const figureId=pack.manifest.figures[0]
  assert.equal(pack.figures[figureId].voice,undefined)
  const ctx=ui(),voiceId=kind==='minimax'?'female-shaonv':'Cherry'
  // Run the actual source radio handler: opening online must not create a default provider.
  ctx.entry=()=>null;ctx.preview={stop:()=>{}};ctx.setOpen=id=>assert.equal(id,'online')
  ctx.writer={useSource:()=>assert.fail('online selection must wait for a voice')}
  vm.runInContext(source.slice(source.indexOf('  const use=way=>{'),source.indexOf('  const toggle=way=>'))+"\nuse(VOICE_WAY('online'));",ctx)
  ctx.testVoices=[{id:voiceId,label:'少女',languages:['zh']},{id:kind==='minimax'?'female-yujie':'Serena',label:'御姐',languages:['zh']}]
  const writer=ctx.useVoiceWriter({binding:{service:library},pack,figure:pack.figures[figureId],setError:message=>assert.equal(message,''),commitVoice:async job=>{const result=await job(pack);pack=result.snapshot;return result}})
  const tree=ctx.VoiceProviderVoices({binding:{},figure:pack.figures[figureId],row:{kind,name:kind,serviceId:kind==='minimax'?'mm':'qw',service:{voiceList:'preset'}},preview:{state:null,of:()=>null},choose:made=>writer.useSource(made)})
  const row=nodes(tree).find(n=>n.type===ctx.VoiceRow&&n.props.name==='少女')
  await row.props.onUse()
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

test('online header is generic for none, MiniMax only and Qwen only; yellow notice opens backend',async()=>{
  const ctx=ui(),opened=[]
  for(const kind of [null,'minimax','qwen']){
    const catalog={services:kind?[{id:'one',kind,sources:['preset'],state:'configured'}]:[]}
    const state=ctx.onlineHeaderState(catalog)
    assert.equal(state?.text,kind?undefined:'还没有配置在线 TTS')
    const way=ctx.rows(catalog,null).find(w=>w.id==='online')
    assert.ok(way)
    const tree=ctx.VoiceWay({way,state,onSetup:()=>ctx.openVoiceSettings({openTab:id=>opened.push(id)},null)})
    assert.doesNotMatch(JSON.stringify(tree),/MiniMax|通义千问/)
    if(!kind)await nodes(tree).find(n=>n.type==='button'&&n.props.className?.includes('is-warn')).props.onClick()
  }
  assert.deepEqual(opened,['dsh-tts:voice'])
  assert.match(source,/onSetup:way.id==='online'&&openSettings\?\(\)=>openSettings\(null\)/)
})

test('preview warning is per failed audition, not the selected provider',()=>{
  const ctx=ui()
  const failed=ctx.VoicePlay({state:{phase:'error',error:'账户余额不足'},label:'少女'})
  const untouched=ctx.VoicePlay({state:null,label:'御姐'})
  assert.equal(nodes(failed).find(n=>n.type==='glyph').props.name,'warning')
  assert.equal(failed.props.title,'账户余额不足')
  assert.equal(nodes(untouched).find(n=>n.type==='glyph').props.name,'play')
  for(const provider of ['minimax','qwen'])assert.match(ctx.voiceIssueText('SERVICE_REQUIRED',{provider}),/^这个声音绑定的服务商还没配置.*重新选择/)
})
