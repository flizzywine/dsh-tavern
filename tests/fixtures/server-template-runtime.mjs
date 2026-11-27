import { createServerTemplateRuntime } from '../../tavern-plugin/lib/domain/server-template-runtime.js'

export function createServerTemplateFixture() {
  let current, tail = Promise.resolve()
  function snapshot(context = {}) {
    const book = context.worldBookEntries?.[0]?.world || 'book'
    const entries = Object.fromEntries((context.worldBookEntries || []).map((e,index) => [e.uid??e.id??index, {vectorized:false,group:'',...e,uid:e.uid??e.id??index,key:e.key||e.primaryKeys||e.keys||[],keysecondary:e.secondaryKeys||[],comment:e.comment||e.title||e.name||e.ref||'',disable:e.enabled===false,order:e.order||100,content:e.content||'',position:e.position||0}]))
    const chat = (context.transcript?.length ? context.transcript : [{role:'assistant',content:''}]).map(m => ({mes:m.content||'',name:context.charName||'',is_user:m.role==='user',variables:m.variables||[{}],swipe_id:0,swipes:[m.content||''],...m}))
    return {state:{sessionId:'fixture',chatId:'fixture',stateRevision:0,lifecycleRevision:0,chat,chat_metadata:{variables:context.chatVariables||{}}},environment:{characters:[{name:context.charName||'',mes_example:'',data:{name:context.charName||'',extensions:{world:book}}}],this_chid:'0',name1:context.userName||'你',name2:context.charName||'',extension_settings:{regex:[],variables:{global:context.globalVariables||{}},EjsTemplate:{enabled:true,...context.settings}},world_names:[book],selected_world_info:[],worldbooks:{[book]:{entries}},dsh:{model:'fixture',cardPath:'fixture',regexScripts:context.regexScripts||[]}}}
  }
  const runtime = createServerTemplateRuntime({rpc:async(method,args)=>{
    if(method==='getFullPromptTemplateState')return structuredClone(current)
    if(method==='saveFullPromptTemplateSettings'){current.environment.extension_settings.EjsTemplate=structuredClone(args.settings);return {updated:true,settings:args.settings}}
    if(method==='saveFullPromptTemplateGlobals')return {updated:true,variables:args.variables}
    if(method==='saveFullPromptTemplateState'){current.state=structuredClone(args.state);return {updated:true,state:args.state}}
    if(method==='countFullTemplateTokens')return {tokens:args.text.length}
    throw Error('Unexpected fixture RPC '+method)
  }})
  const engine=runtime.forSession('fixture')
  function run(method,args,context={}) {
    const next=tail.then(async()=>{current=snapshot(context);return method(...args)})
    tail=next.catch(()=>{});return next
  }
  return {
    projectionScopeChanges: true,
    dispose: () => runtime.dispose(),
    renderInput:(text,context={})=>run(engine.renderInput,[text,context],context),
    prepareWorldbook:(entries,context={})=>run(engine.prepareWorldbook,[entries,context],{...context,worldBookEntries:entries}),
    command:(text,context={})=>run(engine.command,[text],context),
    render:(template,context={},environmentEntries)=>run(engine.render,[template,context],environmentEntries?{...context,worldBookEntries:environmentEntries}:context),
    renderProjections:(items,context={},environmentEntries)=>run(engine.renderProjections,[items,context],environmentEntries?{...context,worldBookEntries:environmentEntries}:context),
    renderMessages:(messages,context={})=>run(engine.renderMessages,[messages,context],context),
    projectRequest:request=>run(engine.projectRequest,[request]),
    initializeVariables:(entries,context={})=>run(engine.initializeVariables,[entries,context],{...context,worldBookEntries:entries}),
    lifecycle:context=>run(async()=>{await runtime.synchronize('fixture');const first=structuredClone(current.state);await runtime.synchronize('fixture');return {first,second:structuredClone(current.state)}},[],context)
  }
}
