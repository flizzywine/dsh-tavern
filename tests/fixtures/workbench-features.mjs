import {mkdir,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetEngineSettings} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/asset-engine.js'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {createAssetGeneration} from '../../tavern-plugin/lib/domain/asset-generation.js'
import {createWorkbenchHost} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/host.js'
import {createCardBundleAdapter} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../../tavern-plugin/lib/domain/card-preparation.js'
import {registerWorkbenchTools,featureRequestSchema} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/tools.js'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'

export function requestFor(name,input) {
  function fit(schema) {
    if(schema.oneOf) {for(const option of schema.oneOf){const value=fit(option);if(value && !validateJsonSchemaValue(schema,value).length)return value}return null}
    if(schema.properties.action && !schema.properties.action.enum.includes(input.action))return null
    const result={}
    for(const key of Object.keys(schema.properties)) {
      if(key==='operation'){const value=fit(schema.properties[key]);if(!value)return null;result[key]=value}
      else if(Object.hasOwn(input,key))result[key]=input[key]
    }
    return validateJsonSchemaValue(schema,result).length?null:result
  }
  const request=fit(featureRequestSchema(name))
  if(!request)throw new Error('Cannot encode '+name+' '+JSON.stringify(input))
  return {request}
}
export async function workbenchFixture(options={}) {
  const parent=options.root || join(tmpdir(),'dsh-tavern-workbench-tests');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(parent+'/case-'),workspace=root+'/workspace';await mkdir(workspace)
  const preparation=createCardPreparation()
  let card=preparation.create({kind:'import',payload:{name:'Fixture card'}})
  const cardTransactions=createCardBundleAdapter({cardPreparation:preparation,authorizeTarget:async path=>({cardId:path}),readWorkspace:async()=>card,writeWorkspace:async(_path,value)=>{card=value},withCardLock:async(_path,task)=>task()})
  const library=createAssetPackService({assetRoot:root+'/packs',cardTransactions}),store=createProfileDataStore({dataRoot:root+'/data'})
  let engineValues,approvalOutcome='rejected',approvedHook,paidCalls=0
  const native={writable:true,installSection(_ctx,_name,_schema,defaults,hooks){engineValues=structuredClone(defaults);hooks.setSource(()=>engineValues)},async replace(_section,value){engineValues=value}}
  const settingsCtx={get:()=>native,inject:(_names,fn)=>fn(settingsCtx),effect:()=>{}}
  const engine=createAssetEngineSettings(settingsCtx),calls=[],approvals=[]
  // a ready image plugin channel (tavern.imageProvider) that must never be asked for a picture;
  // options.imageProvider replaces it with the 配图 plugin's image source (status/generate) the generation owner reads.
  const generation=createAssetGeneration({store,getLibrary:()=>library,imageProvider:options.imageProvider||(()=>({id:'fixture',label:'配图',status:()=>({ready:true,model:'fixture-image',maxReferences:4}),generate(){paidCalls++;throw new Error('No paid request permitted in fixture')}}))})
  let pack=(await library.createPack({name:'Workbench fixture',expectedRevision:null})).snapshot
  const created=await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,name:'Canonical figure',appearance:'sprite',outfits:[]}})
  pack=created.snapshot
  card=preparation.create({kind:'import',payload:{name:'Fixture card',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[pack.manifest.id]}}}}})
  const chat={id:'editor',mode:'card',cardPath:'cards/fixture.json',workspace:{mountedResources:[]}}
  const rpc=async(method,args)=>{
    calls.push({method,args})
    if(options.rpc){const result=await options.rpc(method,args);if(result!==undefined)return result}
    if(method==='getAssetPackDependencies')return {available:true,count:0,cards:[]}
    if(method==='getCardAssetBindings')return {path:args.path,revision:(await cardTransactions.snapshot({path:args.path})).revision,extension:card.raw.extensions.dsh_tavern}
    if(method==='getAssetEngineSettings')return engine.read()
    if(method==='saveAssetEngineSettings')return engine.save(args)
    const name={prepareAssetGeneration:'prepare',generateAssetCandidate:'generate',getAssetGenerationJob:'get',listAssetCandidates:'list',readAssetCandidate:'read',cancelAssetGenerationJob:'cancel',rejectAssetCandidate:'reject',retryAssetCandidateSave:'retrySave'}[method]
    if(name)return generation[name](args)
    throw new Error('Unexpected RPC '+method)
  }
  const host=createWorkbenchHost({chatForSession:async()=>chat,getLibrary:()=>library,getPackSettings:()=>({read:()=>({values:{globalEnabledPackIds:options.globalPack?[pack.manifest.id]:[]}})}),
    approval:()=>options.noApproval?undefined:options.approval || {effectivePolicy:()=>options.policy || 'ask',async request(input){approvals.push(input);await approvedHook?.();return approvalOutcome}},readChat:async()=>undefined,cardIdentity:async()=> 'fixture',rpc})
  const tools=new Map();registerWorkbenchTools({tools:{register:t=>tools.set(t.name,t)},host})
  const exec={callId:'fixture-call',agent:{session:{id:'fixture-session',header:{cwd:workspace}}},signal:new AbortController().signal}
  return {root,workspace,pack,figureId:created.figureId,library,cardTransactions,engine,generation,chat,host,tools,exec,calls,approvals,
    setApproval(value,hook){approvalOutcome=value;approvedHook=hook},get paidCalls(){return paidCalls},
    invoke:(name,input,execution=exec)=>tools.get('tavern_'+name).execute(requestFor(name,input),execution),
    async close(){host.dispose();await generation.dispose();await library.dispose();if(!options.keep&&!process.env.DSH_KEEP_TEST_DATA)await rm(root,{recursive:true,force:true})}}
}
