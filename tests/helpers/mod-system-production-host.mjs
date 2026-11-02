import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createTavernPluginApi} from '../../tavern-plugin/lib/plugin-api.js'
import {registerTavernHttpRoutes} from '../../tavern-plugin/lib/http/routes.js'
import {createManagedModProduction} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/mod-system-production.js'
import {createCardPlugins} from '../../tavern-plugin/lib/domain/card-plugins.js'
import {createCardPreparation} from '../../tavern-plugin/lib/domain/card-preparation.js'
import {firstPartyDistributions} from '../../tavern-plugin/lib/mod-system-distributions.js'

export async function fixture(t,{root:shared,...options}={}) {
  const root=shared || await fs.mkdtemp(path.join(os.tmpdir(),'managed-rpc-'))
  if(!shared)t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const cardPreparation=createCardPreparation({id:()=> 'native-card-id',now:()=>1})
  const file=path.join(root,'card.json'),original=shared?null:cardPreparation.create({kind:'import',payload:{name:'Different name',description:'Story remains',extensions:{foreign:{value:42}}}})
  if(original)await fs.writeFile(file,JSON.stringify(original))
  const readWorkspace=async()=>JSON.parse(await fs.readFile(file,'utf8')),writeWorkspace=async(_,card)=>fs.writeFile(file,JSON.stringify(card))
  let revision=0,value,callbacks,handler
  const effects=[],settings={writable:true,describe:()=>[{ns:'tavern-mod-system',revision:String(revision)}],
    installSection(ctx,ns,schema,defaults,hooks){value=structuredClone(defaults);callbacks=hooks;hooks.setSource(()=>value)},
    async replace(ns,next,expected){if(String(revision)!==expected)throw Object.assign(new Error('Changed'),{code:'MOD_REVISION_CONFLICT'});value=structuredClone(callbacks.validate(next));revision++;callbacks.onChange()}}
  const connection={requestRejection:req=>req.headers.host!=='localhost:3081'?403:req.headers.cookie!=='fixture'?401:null}
  const services={settings,connection,webRuntime:{trustedHosts:[]},webServer:{register(spec){if(spec.path==='/api/dsh-tavern')handler=spec.handler;return ()=>{}}}}
  const ctx={get:name=>services[name],provide(name,value){services[name]=value},inject(deps,fn){fn(ctx)},effect(fn){effects.push(fn())}}
  t.after(()=>{for(const dispose of effects.reverse())dispose?.()})
  let cardTail=Promise.resolve()
  const withCardLock=(_,fn)=>{const task=cardTail.then(fn);cardTail=task.catch(()=>{});return task}
  const production=createManagedModProduction({ctx,cardPlugins:createCardPlugins({dataRoot:root,pluginsDir:path.join(root,'plugins')}),cardPreparation,listPaths:async()=>['card.json'],readWorkspace,writeWorkspace,withCardLock,distributions:()=>firstPartyDistributions(),...options})
  await production.ready
  registerTavernHttpRoutes({ctx,str:String,runtimeReadiness:Promise.resolve({ok:true}),performanceDiagnostics:{http(){}},fontLibrary:{serve:async()=>false},dispatch:(method,args,authority)=>production.call(method,args,authority)})
  async function request(method,args={},headers={cookie:'fixture',origin:'http://localhost:3081'}) {
    const response={}
    await handler({url:'/api/dsh-tavern/'+method,method:'POST',headers:{host:'localhost:3081',...headers},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(args))}},
      {writeHead(status){response.status=status},end(body){response.body=body}})
    if(response.status===200)response.json=JSON.parse(response.body)
    return response
  }
  const rpc=async(method,args)=>{const response=await request(method,args);assert.equal(response.status,200);assert.equal(response.json.ok,true,response.body);return response.json}
  const install=async id=>{const row=(await rpc('managedModsList',{})).mods.find(row=>row.id===id),release=row.versions[0],plan=await rpc('managedModPlan',{action:'install',modId:id,...release});return rpc('managedModApply',{token:plan.token,revision:plan.revision,answers:Object.fromEntries(plan.confirmations.map(row=>[row.id,'approve']))})}
  return {production,request,rpc,install,readWorkspace,root,services}
}


export async function installedFixture(t,{enabled=[]}={}) {
  const f=await fixture(t);await f.production.installBuiltins()
  const api=createTavernPluginApi({modHost:f.production.modHost}),disposers=new Map()
  for(const folder of (await fs.readdir(path.join(f.root,'plugins'))).filter(name=>!name.startsWith('.'))) {
    const plugin=await import(pathToFileURL(path.join(f.root,'plugins',folder,'plugin.mjs')).href)
    const ctx={fiber:{name:plugin.name},effect(fn){const dispose=fn();disposers.set(plugin.name,dispose);return dispose}}
    ctx.tavern=Object.assign(Object.create(api.service),{ctx});plugin.apply(ctx)
  }
  t.after(()=>[...disposers.values()].reverse().forEach(dispose=>dispose()))
  if(enabled.length) {
    const current=f.production.settings.read(),value=structuredClone(current.value)
    value.mods=Object.fromEntries(enabled.map(id=>[id,true]))
    await f.production.settings.compareAndSwap({expectedRevision:current.revision,expectedValue:current.value,value})
  }
  return {...f,unload:packageName=>{disposers.get(packageName)();disposers.delete(packageName)}}
}

export async function authoredPackage(root) {
  const {packageMod}=await import('../../bin/lib/mod-system-package.mjs')
  const source=path.join(root,'author');await fs.mkdir(source)
  const manifest={format:'dsh-mod',schemaVersion:4,performances:[],id:'example.author',name:'Authored',packageName:'example-author',version:'1.0.0',hostApi:'>=1.0.0 <2.0.0',dependencies:[],config:{version:1,schema:{type:'object',properties:{},additionalProperties:false},defaults:{}},preferences:{schema:{type:'object',properties:{},additionalProperties:false},defaults:{}},dataVersion:1,coreAssets:[],permissions:[],entry:'plugin.mjs'}
  await fs.writeFile(path.join(source,'mod.json'),JSON.stringify(manifest))
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:manifest.packageName,version:manifest.version,type:'module',exports:{'.':'./plugin.mjs'}}))
  await fs.writeFile(path.join(source,'plugin.mjs'),"throw new Error('Inspection must never execute');export const name='example-author',inject=['tavern'];export function apply(ctx){}")
  const file=path.join(root,'author.dshmod');await packageMod(source,file)
  return {file,bytes:await fs.readFile(file)}
}
