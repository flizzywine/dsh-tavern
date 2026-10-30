// First-party management shares the workbench primitives, not the legacy widget transport.
const modViewListeners=new Set();
const modText=(manifest,text)=>manifest.i18n?.messages?.[manifest.i18n.defaultLocale]?.[text]||text;
const modFailure=error=>({MOD_REVISION_CONFLICT:'\u5185\u5bb9\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u8bd5',MOD_PERMISSION_DENIED:'\u9700\u8981\u6388\u6743',MOD_DEPENDENCY_MISSING:'\u6240\u9700\u529f\u80fd\u5c1a\u4e0d\u53ef\u7528',MOD_RESOURCE_UNAVAILABLE:'\u6a21\u7ec4\u4e0d\u53ef\u7528'}[error?.code]||'\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
// kind 'packs' reads the mod's own pack scopes (listModPacks); otherwise getMod, or listMods without a modId.
function useModView(rpc,cardId,modId,kind) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[saving,setSaving]=React.useState(false);
  const queue=React.useRef(Promise.resolve()),life=React.useRef(0),sequence=React.useRef(0);
  const read=async()=>kind==='packs'?await rpc('listModPacks',{modId,...(cardId?{cardId}:{})}):modId?await rpc('getMod',{modId,...(cardId?{cardId}:{})}):await rpc('listMods',cardId?{cardId}:{});
  const reload=async()=>{const own=life.current,ticket=++sequence.current;try{const next=await read();if(own===life.current&&ticket===sequence.current){setData(next);setError('');}return next;}catch(e){if(own===life.current&&ticket===sequence.current)setError(modFailure(e));}};
  React.useEffect(()=>{life.current++;setData(null);setSaving(false);reload();modViewListeners.add(reload);return()=>{life.current++;sequence.current++;modViewListeners.delete(reload);};},[rpc,cardId,modId,kind]);
  function write(operation,detail) {
    const own=life.current;
    const task=queue.current.catch(()=>{}).then(async()=>{
      if(own!==life.current)return;
      setSaving(true);setError('');
      try {
        for(let attempt=0;attempt<2;attempt++) {
          const current=await read();if(own!==life.current)return;
          try{await operation(current);break;}catch(e){if(e.code!=='MOD_REVISION_CONFLICT'||attempt)throw e;}
        }
        for(const notify of [...modViewListeners])notify();
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed',{detail}));
      }catch(e){if(own===life.current)setError(modFailure(e));throw e;}
      finally{if(own===life.current)setSaving(false);}
    });
    queue.current=task;return task;
  }
  return {data,error,saving,reload,write};
}
// A mod's own asset pack: the pack state tag (全局 / 本卡 / 关闭) over setModPackScope.
function useModScope({rpc,view,row,cardId,packId,modId}) {
  const change=next=>view.write(current=>rpc('setModPackScope',{modId,packId,...(cardId?{cardId}:{}),scope:next,expectedRevision:current.revision})).catch(()=>{});
  const scope={type:cardId?'card':'global',pending:{[row.id]:view.saving},stateOf:()=>row.scope,users:()=>[],options:()=>cardId?PACK_STATE_ORDER:['global','off'],set:(_,next)=>change(next)};
  return {scope};
}
function ModScope(props) {
  const {row}=props,{scope}=useModScope(props);
  return h(PackStateTag,{scope,id:row.id,name:row.name});
}
// 舞台设置 › 模组 lists the managed mods with their text switches
// (ManagedModSection, mod-manager.js); an internal first-party mod (manifest ui.internal) is never listed.
// a figure's face for the mod pages (the phone's contacts) — the panel's one
// avatar resolver (FigureCastFace + figureAvatar: the calm avatar) over the card's packs the stage settings already read.
const stageModFace=ctx=>(ref,label)=>{const pack=ctx.writer?.pack?.(ref.packId),figure=pack?.figures?.[ref.figureId];
  return figure?h(FigureCastFace,{binding:ctx.binding,packId:ref.packId,pack,figure,sprites:pack.sprites,avatar:figureAvatar(figure,pack.sprites),label:label||figure.name,className:'fork-phone-face',frame:'face'}):null;};
// a mod's page opens in place in 舞台设置 (StagePage, ‹ 舞台设置 and Esc go back),
// from 舞台设置 › 模组 and from 提示词 › 模组 (ctx.openMod).
// Entry lists come from ctx (ModEntries, mod-page.js), so the page needs no per-kind props.
function StageModPage({ctx,cardId,modId,onBack}) {
  return h(ModDetail,{key:modId,rpc:ctx.binding.engineRpc,cardId,cardName:ctx.cardName,sessionId:ctx.sessionId,modId,faceOf:stageModFace(ctx),ctx,onBack});
}
function StageModSection({ctx,cardId}) {
  return ctx.openMod&&ctx.binding.engineRpc?h(ManagedModSection,{rpc:ctx.binding.engineRpc,cardId,onOpen:ctx.openMod,takeFocus:ctx.takeModFocus}):null;
}
// @include mod-manager.js
// @include mod-page.js
// @include mod-config-pages.js
// @include danmaku-pages.js
// @include mod-settings.js
// @include mod-assets.js
