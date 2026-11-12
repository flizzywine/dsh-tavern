// the page opens only in 舞台设置 (no 模组库 tab), so ‹ always reads 舞台设置.
// every page is ModPageHead (name, its (?) description, the global switch) over the mod's settings page: the one
// its client part registers (MOD_CONFIG_PAGES), else the page generated from its config schema (ModConfigList).
// `ctx` (the 舞台设置 page) gives the entry sections of the mod's admission kinds (ModEntries), placed last by the page.
function ModDetail({rpc,cardId,cardName,sessionId,modId,onBack,faceOf,ctx}) {
  const view=useModView(rpc,undefined,modId),data=view.data;
  const name=data?modText(data.manifest,data.manifest.name):'模组';
  // the head's text switch (全局 / 本卡) and this card's dependency notices.
  const managed=useManagedModControls({rpc,cardId,modId,name});
  const head=h(React.Fragment,null,h(ModPageHead,{modId,manifest:data?.manifest,name,onBack,toggle:managed.toggle}),managed.dialog);
  if(!data)return h('article',{className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},head,view.error?h(ErrorBox,{error:view.error,reload:view.reload}):h(Loading,{shape:'fields'}));
  const entries=ctx?h(ModEntrySections,{ctx,modId,manifest:data.manifest}):null;
  // no summary line under the title (mod-pages-ui: it is the head's (?)).
  const ConfigPage=MOD_CONFIG_PAGES[modId]||ModConfigList;
  return h('article',{className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},head,managed.notices,
    h(ConfigPage,{rpc,cardId,cardName,sessionId,modId,manifest:data.manifest,data,faceOf,entries,ctx}));
}
