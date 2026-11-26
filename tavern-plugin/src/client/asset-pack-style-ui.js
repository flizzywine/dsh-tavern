  // 画风: one chain 素材包 → 角色卡 → 配图插件. The pack
  // window's head carries the pack's 画风 tag, a menu: 跟随角色卡 (a card's 自动素材 pack only) / 跟随配图插件 / 无画风, then the
  // styles by where they come from (角色卡自带, 素材包自带, 配图插件), and last 「按用途分别设 ›」, which opens the five rows
  // (全部 + 人物 / 设定图 / 背景 / CG), each the same full menu. The figure 生图 tab, a background and a CG show the style their
  // pictures get on one quiet line that opens the same menu. The card's own value is a row of the card detail (CardGenStyleRow).
  // What each place resolves to, and from where, is the host's (listAssetGenStyles); the client only lists and writes values.
  const GEN_STYLE_USE_NAMES={figure:'人物',sheet:'设定图',background:'背景',cg:'CG'};
  const GEN_STYLE_LAYER_NAMES={all:'全部',...GEN_STYLE_USE_NAMES};
  const GEN_STYLE_FROM={request:'只用这一次',pack:'来自素材包',card:'来自卡',plugin:'来自配图插件'};
  const GEN_STYLE_FOLLOW_PLUGIN='follow-plugin',GEN_STYLE_PER_USE='\u0000per-use';
  const genStyleFromText=from=>GEN_STYLE_FROM[from]||'';
  // listAssetGenStyles answers {ok, data} | {ok:false, error}.
  async function genStyleLoad(rpc,args){
    const reply=await rpc('listAssetGenStyles',args);
    if(reply&&reply.ok===false)throw Object.assign(new Error(reply.error?.message||'读不到画风'),{code:reply.error?.code});
    return reply&&reply.ok===true?reply.data:reply;
  }
  // A stored value with one layer set (a style id) or cleared (''): only 「全部」 is a plain id, nothing is null (removes it).
  function genStyleWith(value,layer,style){
    const next={...(typeof value==='string'?{all:value}:value||{})};
    if(style)next[layer]=style;else delete next[layer];
    const keys=Object.keys(next);
    return !keys.length?null:keys.length===1&&keys[0]==='all'?next.all:next;
  }
  // One menu's options. place: 'pack' | 'card'; layer: 'all' or a use. '' is no value (follow the next link).
  function genStyleOptions(menu,{place,layer,perUse=false,value=''}){
    const auto=place==='pack'&&!!menu.pack?.automatic,all=layer==='all',seen=new Set(),options=[];
    const add=row=>{if(seen.has(row.value))return;seen.add(row.value);options.push(row);};
    // 「全部」 with no value follows the card (a card's 自动素材 pack) or the plugin; a use with no value follows 「全部」.
    if(!all)add({value:'',label:'跟随「全部」'});
    else if(auto)add({value:'',label:'跟随角色卡',note:menu.follow?.card?.figure?.name});
    add({value:all&&!auto?'':GEN_STYLE_FOLLOW_PLUGIN,label:'跟随配图插件',note:menu.plugin?.name});
    add({value:'no-style',label:'无画风'});
    for(const style of menu.card?.styles||[])add({value:style.id,label:style.name,group:'角色卡自带'});
    for(const style of menu.pack?.styles||[])add({value:style.id,label:style.name,group:'素材包自带'});
    for(const style of menu.options||[])add({value:style.id,label:style.name+(style.experimental?'（实验）':''),group:'配图插件'});
    if(value&&!seen.has(value))add({value,label:'这个画风不在了，请另选',group:'配图插件'});
    if(perUse)options.push({value:GEN_STYLE_PER_USE,label:'按用途分别设 ›'});
    return options;
  }
  // A short face for a value: what 「全部」 resolves to for 人物, and whether the uses differ.
  function genStyleFace(menu,place){
    const value=(place==='pack'?menu.pack?.value:menu.card?.value)||{},shown=menu.resolved?.figure,name=shown?.name||'无画风';
    const lead=value.all===undefined?(place==='pack'&&menu.pack?.automatic?'跟随角色卡：':'跟随配图插件：'):value.all===GEN_STYLE_FOLLOW_PLUGIN?'跟随配图插件：':'';
    return lead+name+(Object.keys(value).some(key=>key!=='all')?' · 按用途':'');
  }
  // The one picker: a full menu for one layer. `chip` draws its own face; a pick of 「按用途分别设 ›」 calls onPerUse.
  function GenStylePicker({menu,place,layer='all',value,onPick,onPerUse,chip,name='画风',disabled}){
    const options=genStyleOptions(menu,{place,layer,perUse:!!onPerUse,value:value||''});
    return h(InlineMenu,{name,value:value||'',options,disabled,chip,placeholder:'跟随',
      onCommit:next=>{if(next===GEN_STYLE_PER_USE){onPerUse?.();return;}onPick(layer,next);}});
  }
  // 「按用途分别设」: five rows, each the same menu; the grey text after a use is what it paints in now.
  function GenStyleUseRows({menu,place,onPick,disabled}){
    const value=(place==='pack'?menu.pack?.value:menu.card?.value)||{};
    return h(InlineGrid,{label:'按用途分别设画风',columns:1,className:'ap-style-uses'},
      ['all','figure','sheet','background','cg'].map(layer=>h(InlineField,{key:layer,kind:'menu',label:GEN_STYLE_LAYER_NAMES[layer],value:value[layer]||'',disabled,
        options:genStyleOptions(menu,{place,layer,value:value[layer]||''}),onCommit:next=>onPick(layer,next),
        trail:layer!=='all'&&menu.resolved?.[layer]?h('span',{className:'ap-style-said'},menu.resolved[layer].name+' · '+genStyleFromText(menu.resolved[layer].from)):null})));
  }
  // The pack window's 画风: read on open and after each change of the pack, written through the window's queue (CAS).
  // The open pack window publishes its 画风 here; its head tag, the 生图 tab, a background and a CG read it (one window at a time).
  const genStyleNow={value:null,listeners:new Set()};
  function publishGenStyle(value){genStyleNow.value=value;genStyleNow.listeners.forEach(listen=>listen(value));}
  function useGenStyleNow(){
    const [value,setValue]=React.useState(genStyleNow.value);
    React.useEffect(()=>{genStyleNow.listeners.add(setValue);setValue(genStyleNow.value);return()=>{genStyleNow.listeners.delete(setValue);};},[]);
    return value;
  }
  function usePackGenStyle({binding,pack,enqueue}){
    const packId=pack?.manifest.id,[menu,setMenu]=React.useState(null),[error,setError]=React.useState(''),[uses,setUses]=React.useState(false);
    React.useEffect(()=>{
      if(!packId||typeof binding?.rpc!=='function'||pack.privateConfig)return;
      let live=true;
      genStyleLoad(binding.rpc,{packId}).then(next=>{if(live){setMenu(next);setError('');}},e=>{if(live){setMenu(null);setError(errorText(e));}});
      return()=>{live=false;};
    },[packId,pack?.revision]);
    const pick=(layer,style)=>enqueue(c=>binding.service.patchPack({packId,expectedRevision:c.revision,patch:{genStyle:genStyleWith(c.manifest.genStyle,layer,style)}}))
      .catch(e=>setError(errorText(e)));
    const style={menu,error,pick,uses,openUses:()=>setUses(true),closeUses:()=>setUses(false)};
    React.useEffect(()=>{publishGenStyle(style);},[menu,error,uses,pack?.revision]);
    React.useEffect(()=>()=>publishGenStyle(null),[]);
    return style;
  }
  // The head's tag (always shown once read).
  function PackGenStyleTag(){
    const style=useGenStyleNow();
    if(!style?.menu)return null;
    const face=genStyleFace(style.menu,'pack');
    return h(GenStylePicker,{menu:style.menu,place:'pack',value:style.menu.pack?.value?.all,onPick:style.pick,onPerUse:style.openUses,
      chip:{props:{className:'ap-style-tag',title:'画风','aria-label':'画风：'+face},
        children:[h('span',{key:'k',className:'ap-style-tag-key'},'画风'),h('span',{key:'v',className:'ap-style-tag-value'},face),h(Glyph,{key:'g',name:'chevDown'})]}});
  }
  // 「按用途分别设」 of the pack window.
  function PackGenStyleUses(){
    const style=useGenStyleNow();
    if(!style?.menu||!style.uses)return null;
    return h(Modal,{title:'画风 · 按用途',className:'ap-style-uses-modal',onClose:style.closeUses},
      h(GenStyleUseRows,{menu:style.menu,place:'pack',onPick:style.pick}),style.error&&h(ErrorBox,{error:style.error}));
  }
  // One quiet line: the style the pictures of these uses get, and from where; a click opens the pack's menu. A 设定图
  // style different from the 人物 one is said too.
  // `row`: the same as a row of an entry's InlineGrid (a background, a CG).
  function GenStyleLine({uses=['figure'],className,row=false}){
    const style=useGenStyleNow();
    if(!style?.menu)return null;
    const [first,...rest]=uses.map(use=>[use,style.menu.resolved?.[use]]).filter(([,row])=>row);
    if(!first)return null;
    const said=([use,row],named)=>(named?GEN_STYLE_USE_NAMES[use]+'：':'')+row.name+' · '+genStyleFromText(row.from);
    const extra=rest.filter(([,row])=>row.id!==first[1].id||row.from!==first[1].from);
    const text=[said(first,extra.length>0),...extra.map(row=>said(row,true))].join('　');
    const picker=h(GenStylePicker,{menu:style.menu,place:'pack',value:style.menu.pack?.value?.all,onPick:style.pick,onPerUse:style.openUses,
      chip:{props:{className:'ap-style-line-value','aria-label':'画风：'+text},children:[h('span',{key:'t'},text),h(Glyph,{key:'g',name:'chevDown'})]}});
    if(row)return h(InlineRow,{label:'画风',className},picker);
    return h('div',{className:'ap-style-line'+(className?' '+className:'')},h('span',{className:'ap-style-line-key'},'画风'),picker);
  }
  // The card detail's 画风 row (the card's own value: its 自动素材 pack and the pictures the image plugin draws for it) and
  // 「按用途 ›」 under it. rpc: the host's (getCardAssetBindings / saveCardAssetBindings, listAssetGenStyles).
  function CardGenStyleRow({cardPath,rpc}){
    const [menu,setMenu]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[open,setOpen]=React.useState(false),[stamp,setStamp]=React.useState(0);
    React.useEffect(()=>{let live=true;setError('');
      genStyleLoad(rpc,{cardPath}).then(next=>{if(live)setMenu(next);},e=>{if(live){setMenu(null);setError(errorText(e));}});
      return()=>{live=false;};},[cardPath,stamp]);
    const pick=async(layer,style)=>{
      setBusy(true);setError('');
      try{
        const card=await rpc('getCardAssetBindings',{path:cardPath,metadataOnly:true});
        await rpc('saveCardAssetBindings',{path:cardPath,expectedRevision:card.revision,patch:{genStyle:genStyleWith(card.extension?.genStyle,layer,style)}});
        setStamp(n=>n+1);
      }catch(e){setError(errorText(e));}finally{setBusy(false);}
    };
    if(!menu)return error?h(HintLine,{text:error}):null;
    const value=menu.card?.value||{};
    return h('div',{className:'ap-card-style'},
      h(InlineGrid,{label:'画风',columns:1,className:'ap-card-style-grid'},
        h(InlineRow,{label:'画风',help:h(Help,{label:'画风 说明',text:'这张卡的自动素材包新画的图、游戏里配的插图都用它；素材包自己设了画风的，以素材包为准。'})},
          h('span',{className:'ap-card-style-value'},
            h(GenStylePicker,{menu,place:'card',value:value.all,onPick:pick,disabled:busy}),
            h('button',{type:'button',className:'ap-inline-link ap-card-style-uses','aria-expanded':open,onClick:()=>setOpen(!open)},'按用途',h(Glyph,{name:open?'chevDown':'chevRight'}))))),
      open&&h(GenStyleUseRows,{menu,place:'card',onPick:pick,disabled:busy}),
      error&&h(HintLine,{text:error}));
  }
