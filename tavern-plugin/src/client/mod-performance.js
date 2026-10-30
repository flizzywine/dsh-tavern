// @include mod-stage-surface.cjs
// @include mod-stage-layers.js
// @include danmaku-stage.cjs
// @include danmaku-liveroom.cjs
// @include item-showcase.cjs
// @include core-item-presentation.cjs

// items float in front of the figures, no card. The showcase measures
// the stage (figure head/body boxes from the scene, textbox, top chrome) once per set of cards, places them with
// itemShowcasePlace and hands each card its slot through context. Shared by core and first-party
// mod presentations; no inventory behaviour here. Nothing in it takes pointer input: clicks reach the stage and advance.
let itemPlaceContext=null;
function itemPlaceSlot(){return itemPlaceContext || (itemPlaceContext=React.createContext(null));}
function itemStageGeometry(node) {
    const root=node.closest('.fork-gal-stage') || node.parentElement;if(!root)return null;
    // Stage units: a docked stage is only scaled (createModStageDock).
    const frame=root.getBoundingClientRect(),k=frame.width>0 && Math.abs(frame.width-root.offsetWidth)>=1 ? root.offsetWidth/frame.width : 1,rel=el=>{const r=el.getBoundingClientRect();return {x:(r.left-frame.left)*k,y:(r.top-frame.top)*k,width:r.width*k,height:r.height*k};};
    const blocked=[...root.querySelectorAll('.fork-gal-topbar,.fork-gal-side,.fork-gal-controls,.fork-gal-name,.fork-gal-letterbox i,.fork-widget-source-controls')].map(rel);
    const boxes=[...root.querySelectorAll('.fork-gal-box')].map(rel).filter(r=>r.width>0 && r.height>0);
    const figures=typeof galFigureSources!=='undefined' ? galFigureSources.get(root)?.() || [] : [];
    return {width:frame.width*k,height:frame.height*k,scale:k,blocked,boxTop:boxes.length ? Math.min(...boxes.map(r=>r.y)) : undefined,figures};
}
// Reads the decoded icon once: an opaque light border means a baked white background (shown on a paper tile), and a
// 失去 card takes its dust colours from the item's own pixels. Owned blob URLs are same-origin; anything else stays plain.
function itemImageLook(image,dust) {
    try {
        const n=40,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
        const context=canvas.getContext('2d',{willReadFrequently:true}),k=Math.min(n/image.naturalWidth,n/image.naturalHeight);
        const w=image.naturalWidth*k,h=image.naturalHeight*k,ox=(n-w)/2,oy=(n-h)/2;context.drawImage(image,ox,oy,w,h);
        const data=context.getImageData(0,0,n,n).data,at=(x,y)=>(Math.min(n-1,Math.max(0,Math.round(y)))*n+Math.min(n-1,Math.max(0,Math.round(x))))*4;
        let edge=0,light=0;
        for(let t=0;t<n;t++)for(const [x,y] of [[ox+t*w/n,oy],[ox+t*w/n,oy+h-1],[ox,oy+t*h/n],[ox+w-1,oy+t*h/n]]){const i=at(x,y);edge++;if(data[i+3]>=250 && Math.min(data[i],data[i+1],data[i+2])>=226)light++;}
        const tile=light/edge>0.8,specks=[];
        if(dust)for(let t=0;t<600 && specks.length<36;t++){const x=Math.random()*n,y=Math.random()*n,i=at(x,y);if(data[i+3]>200 && !(tile && Math.min(data[i],data[i+1],data[i+2])>=226))specks.push({x:x/n,y:y/n,color:'rgb('+data[i]+' '+data[i+1]+' '+data[i+2]+')',dx:(0.3+Math.random()*0.6).toFixed(3),dy:(-0.1-Math.random()*0.45).toFixed(3),delay:Math.round(950+x/n*900+Math.random()*120)+'ms'});}
        return {tile,dust:specks.length ? specks : null};
    } catch (_) {return {tile:false,dust:null};}
}
function StageCutinCard({tone,label,title,subtitle,amount,image,note,iconExpected}) {
    const h=React.createElement,slot=React.useContext(itemPlaceSlot()),ref=React.useRef(null);
    const place=slot?.place,spot=place?.items?.[slot.index],name=place?.names?.[slot.index],hasIcon=!!image || !!iconExpected;
    const [look,setLook]=React.useState({tile:false,dust:null});
    const sparks=React.useMemo(()=>Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2+Math.random()*0.4,d=0.5+Math.random()*0.25;
        return {'--fork-item-dx':(Math.cos(a)*d).toFixed(3),'--fork-item-dy':(Math.sin(a)*d*0.8).toFixed(3),'--fork-item-delay':Math.round((tone==='show' ? 900 : 330)+Math.random()*160)+'ms'};}),[tone]);
    React.useEffect(()=>{ // load does not bubble; a capturing listener also sees images that a child component mounts later
        const root=ref.current;if(!root)return undefined;
        let live=true;const read=img=>{if(live && img?.naturalWidth)setLook(itemImageLook(img,tone==='lose'));};
        const loaded=event=>{if(event.target.matches?.('.fork-item-ic img'))read(event.target);};
        root.addEventListener('load',loaded,true);
        const img=root.querySelector('.fork-item-ic img');if(img?.complete)read(img);
        return()=>{live=false;root.removeEventListener('load',loaded,true);};
    },[tone]);
    const src=image?.props?.src,count=amount!==undefined && amount!==null ? ' \u00d7'+amount : '';
    return h('div',{ref,className:'fork-item-show fork-item-'+tone+(hasIcon ? '' : ' is-text'),'data-tone':tone,'data-caption':place?.caption || 'above',
        style:spot ? {left:spot.x+'px',top:spot.y+'px','--fork-item-size':place.size+'px'} : undefined},
        hasIcon && h('i',{className:'fork-item-light','aria-hidden':true}),
        hasIcon && tone!=='lose' && h('i',{className:'fork-item-rays','aria-hidden':true}),
        hasIcon && h('div',{className:'fork-item-pic'},
            h('div',{className:'fork-item-bob'},h('div',{className:'fork-item-ic'+(look.tile ? ' is-tile' : '')},image,
                src && !look.tile ? h('i',{className:'fork-item-glint','aria-hidden':true,style:{'--fork-item-mask':'url("'+src+'")'}}) : null)),
            tone==='lose' && look.dust ? look.dust.map((speck,i)=>h('i',{key:i,className:'fork-item-dust','aria-hidden':true,style:{left:speck.x*100+'%',top:speck.y*100+'%','--fork-item-dust':speck.color,
                '--fork-item-dx':speck.dx,'--fork-item-dy':speck.dy,'--fork-item-delay':speck.delay}})) : null),
        hasIcon && tone!=='lose' && h('div',{className:'fork-item-sparks','aria-hidden':true},sparks.map((style,i)=>h('i',{key:i,className:i%3===0 ? 'is-star' : undefined,style}))),
        h('div',{className:'fork-item-cap',style:spot && name && hasIcon ? {left:name.x-spot.x+'px',top:name.y-spot.y+'px'} : undefined},h('strong',null,title),
            // The second line only when it says something: 获得 / 失去, the variant (浑浊), the count.
            label || subtitle || count ? h('small',null,label ? h('b',null,label) : null,label && subtitle ? ' ' : '',subtitle || '',count) : null,
            note && h('small',null,note),slot?.extra && h('small',null,slot.extra)));
}
// a skin that declares art.item draws the card as the
// original's frame at its declared place - no caption, spotlight, zoom or face avoidance - with the same finite lifetime
// (createModStageSurface). Only the newest card shows, in the one frame; gain adds the skin's toast. `item` = stageSkinArt's.
function forkSkinItemLayout(item,width,height) {
    const [cx,cy,w,h]=item.box,u=Math.min(height/item.screen,width/item.width);
    if(item.narrow && width<=640){const k=width*item.narrow.width/w;return {k,frame:{x:width/2-w*k/2,y:height*item.narrow.y-h*k/2,width:w*k,height:h*k}};}
    return {k:u,frame:{x:width/2+(cx-w/2-item.width/2)*u,y:height/2+(cy-h/2-item.screen/2)*u,width:w*u,height:h*u}};
}
function SkinItemShowcase({card,item}) {
    const h=React.createElement,ref=React.useRef(null),[size,setSize]=React.useState(null);
    React.useLayoutEffect(()=>{const g=ref.current && itemStageGeometry(ref.current);if(g)setSize([g.width,g.height]);},[]);
    const props=card.element.props,layout=size && forkSkinItemLayout(item,size[0],size[1]);
    let toast=null;
    if(layout && props.tone==='gain' && item.toast){
        const t=item.toast,[x,y,w,th]=t.box,frame=layout.frame;
        // Narrow: the toast keeps its design proportions and stands on the frame's top edge, from the stage's left.
        const k=item.narrow && size[0]<=640 ? layout.k*.9 : layout.k,box=item.narrow && size[0]<=640 ? {x:0,y:frame.y-th*k-6,width:w*k,height:th*k}
            : {x:size[0]/2+(x-item.width/2)*k,y:size[1]/2+(y-item.screen/2)*k,width:w*k,height:th*k};
        toast=h('div',{className:'fork-skin-item-toast',style:{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px',backgroundImage:'url("'+t.image+'")',
            fontSize:t.font*k+'px',...(t.ink ? {'--fork-skin-item-ink':t.ink} : null),'--fork-skin-item-fade':t.fadeMs+'ms'}},t.text);
    }
    return h('aside',{ref,className:'fork-item-showcase is-skin','aria-live':'polite'},layout && h(React.Fragment,{key:card.key},
        h('div',{className:'fork-skin-item','data-tone':props.tone,'aria-label':props.title,style:{left:layout.frame.x+'px',top:layout.frame.y+'px',width:layout.frame.width+'px',height:layout.frame.height+'px',
            '--fork-skin-item-ms':item.enter.ms+'ms','--fork-skin-item-rise':item.enter.rise*layout.k+'px'}},
            h('img',{className:'fork-skin-item-frame',src:item.frame,alt:''}),
            props.image && h('div',{className:'fork-skin-item-media',style:{width:item.media[0]*layout.k+'px',height:item.media[1]*layout.k+'px'}},props.image)),
        toast));
}
// cards: [{key, element}] where element renders StageCutinCard. First pass renders hidden to measure the names.
function ItemShowcase({cards,extra,accent,skinItem}) {
    if(skinItem)return React.createElement(SkinItemShowcase,{card:cards.at(-1),item:skinItem});
    return React.createElement(ItemCardShowcase,{cards,extra,accent});
}
function ItemCardShowcase({cards,extra,accent}) {
    const h=React.createElement,ref=React.useRef(null),Slot=itemPlaceSlot();
    const signature=cards.map(card=>card.key).join('|')+'|'+(extra || '');
    const [state,setState]=React.useState({signature:null,place:null});
    const place=state.signature===signature ? state.place : null;
    React.useLayoutEffect(()=>{
        if(place || !ref.current)return;
        const node=ref.current,geometry=itemStageGeometry(node),shows=[...node.querySelectorAll('.fork-item-show')];
        const k=geometry?.scale || 1,captions=shows.map(show=>{const r=show.querySelector('.fork-item-cap').getBoundingClientRect();return {width:r.width*k,height:r.height*k,textOnly:show.classList.contains('is-text')};});
        setState({signature,place:itemShowcasePlace({...(geometry || {width:node.clientWidth,height:node.clientHeight}),captions,show:shows.some(show=>show.dataset.tone==='show')})});
    });
    return h('aside',{ref,className:'fork-item-showcase'+(place ? '' : ' is-measuring'),'aria-live':'polite',style:accent ? {'--fork-item-accent':accent} : undefined},
        place?.dim ? h('i',{className:'fork-item-dim','aria-hidden':true,style:{left:place.dim.x+'px',top:place.dim.y+'px',width:place.dim.width+'px',height:place.dim.height+'px'}}) : null,
        cards.map((card,index)=>h(Slot.Provider,{key:card.key,value:{place,index,extra:index===cards.length-1 ? extra : null}},card.element)));
}
function useModPerformances(sessionId,{live,overlay}) {
    const h=React.createElement,[surface,setSurface]=React.useState({rows:[],busy:false,holds:[],regions:[]}),rows=surface.rows;
    const controller=React.useMemo(()=>{
        const pins=new Map();
        return createModStageSurface({definitions:[coreItemPresentation()],
            readMedia:async args=>{
                if(!args.coreItem)return rpc('readStageModMedia',args,sessionId);
                const view=await rpc('getStageItems',{turn:args.turn},sessionId),row=view.performances?.find(row=>row.id===args.performanceId);
                if(!row?.image || JSON.stringify(row.source)!==JSON.stringify(args.source))throw Error('Item source changed');
                const pin=await stageSessions.resourceOwner.acquire(row.image,sessionId);
                return {pin};
            },
            createURL:result=>{if(result.pin){const url=result.pin.handle.url;pins.set(url,[...(pins.get(url)||[]),result.pin]);return url;}
                return URL.createObjectURL(new Blob([Uint8Array.from(atob(result.data),character=>character.charCodeAt(0))],{type:result.mime}));},
            revokeURL:url=>{const values=pins.get(url);if(values){values.pop().release();if(!values.length)pins.delete(url);}else URL.revokeObjectURL(url);},onChange:(rows,status)=>setSurface({rows,...status}),
        });
    },[sessionId]);
    // The runtime cancels source/page/revocation changes before playing their events.
    // A later React render of the same accepted direction must not cancel its in-flight item image.
    React.useLayoutEffect(()=>{controller.reset(live && !overlay);return()=>controller.reset(false);},[controller,live,overlay]);
    React.useEffect(()=>()=>controller.dispose(),[controller]);
    // The stage passes the speaker's 形象色 as `accent` (React.cloneElement) once it knows who speaks.
    const visibleRows=live && !overlay ? rows.slice(0,2) : [];
    const node=visibleRows.length ? h(ItemShowcase,{
        cards:visibleRows.map(row=>({key:row.id,element:row.definition.render(React,row.performance,row.media,{CutinCard:StageCutinCard})})),
        extra:rows.length>2 ? '\u53e6\u6709 '+(rows.length-2)+' \u9879\u6f14\u51fa' : null}) : null;
    // Cancelling one page releases its cards; it must not disable later eligible events.
    return {play:controller.play,cancel:()=>controller.reset(live && !overlay),busy:surface.busy,holds:surface.holds,regions:surface.regions,node,visibleRows};
}
