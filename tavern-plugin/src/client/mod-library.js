// A mod's page reads its release (getMod); the page's own settings go through the two-layer config (mod-config-pages.js).
const modText=(manifest,text)=>manifest.i18n?.messages?.[manifest.i18n.defaultLocale]?.[text]||text;
const modFailure=error=>({MOD_PERMISSION_DENIED:'\u9700\u8981\u6388\u6743',MOD_RESOURCE_UNAVAILABLE:'\u6a21\u7ec4\u4e0d\u53ef\u7528'}[error?.code]||'\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
function useModView(rpc,cardId,modId) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),life=React.useRef(0);
  const reload=async()=>{const own=life.current;try{const next=await rpc('getMod',{modId,...(cardId?{cardId}:{})});if(own===life.current){setData(next);setError('');}}catch(e){if(own===life.current)setError(modFailure(e));}};
  React.useEffect(()=>{life.current++;setData(null);reload();return()=>{life.current++;};},[rpc,cardId,modId]);
  return {data,error,reload};
}
// 舞台设置 › 模组 lists the managed mods with their text switches
// (ManagedModSection, mod-manager.js).
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
// mod-manager.js (ManagedModSection, ModManager, ModManagerEntry, useManagedModControls, modSwitchWord) ships in dsh-tavern-stage
// and binds through stageScope (asset-pack-ui.js).
// @include mod-page.js
// @include mod-config-pages.js
// @include mod-settings.js
