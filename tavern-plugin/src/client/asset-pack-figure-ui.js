// figure-owned authoring (character v3). Every edit uses the pack modal's serialized CAS writer.
// Layout: desktop and phone are designed separately.
// Desktop: the list is its own column; the figure is one scrolling page — a fixed-size preview card pinned on its left
// (content scaled to fit, never cut), and beside it the name + lamp slot, one strip of labelled properties (身高 / 形象色 /
// 声音 / 语言), 服装 (head-and-shoulders tiles, each with its own lamp, then a dashed ＋ tile; the selected tile's 触发策略 and
// 触发词 are labelled properties under the grid, v3.1 r2) and 差分. Each outfit has three separate assets — Live2D, 立绘, 头像 — each with a variant per emotion of the one
// emotion list; the 差分 header switches which asset the roster, the open emotion and the preview show. Empty slots carry
// an upload badge (pick → frame / zoom → upload). Phone: a top bar (‹, the name, the lamp slot), the preview, then the
// properties as aligned rows. No raw JSON, no internal ids, no native controls.
function figureEditorEmotions(figure) {
  return (figure.emotions||[]).map(row=>({...row,label:row.label??'无差分',color:(typeof bubbleMoodBadge==='function'?bubbleMoodBadge(row.id,[row])?.color:null)||'var(--fork-ink-3)'}));
}
// the fallback is the token --fork-figure-fallback (same grey as before).
const figureColor=figure=>figure.imageColor??figure.autoColor??'var(--fork-figure-fallback)';
// no preset palette; the picker offers shades of the image colour (InlineColor).
// Outfit trigger words that only repeat an internal key (「mb-casual03」 of 「cocoa-mb-casual03」), the outfit's own name or
// the figure's name / aliases (default triggers already) are not shown; they stay in the data untouched (the editor never re-adds names or ids as words).
function outfitWordHidden(outfit,word,figure) {
  const w=String(word).toLowerCase(),key=String(outfit.key||'').toLowerCase();
  return w===key||key.endsWith('-'+w)||word===outfit.label||word===figure?.name||!!figure?.aliases?.includes(word);
}
// every outfit tile is head-and-shoulders by one rule, for static
// pictures and Live2D snapshots alike (LIVE2D_FRAMES.bust): a 3:4 box, the head (top → chin) 42% of its height
// starting at 12%, centred on the face. The static head box is the calm picture's calibrated anatomy (fractions), else its
// face crop; the picture's own size is read when it loads, so no manifest size is needed.
const OUTFIT_BUST={head:0.42,top:0.12,aspect:0.75};
// the cast faces (舞台设置 grid, 角色 sheet, figure picker) are one square head-and-shoulders
// frame by the same head anchor, whatever pack they come from (no mix of face circles, half bodies and chest crops).
// `below` caps what shows under the chin at a share of the figure's height. A chibi's head
// box is a third of its body, so 0.45 head below the chin showed the whole little body (大肥鱼) while everyone else showed
// shoulders; with the cap every proportion shows shoulders and a big head simply fills more of the frame.
const CAST_FACE={head:0.62,top:0.1,aspect:1,below:0.07};
function fitFrame(frame,headH,figureH) {
  if(!frame.below||!(figureH>headH))return frame;
  const need=(1-frame.top)/(1+frame.below*figureH/headH);
  return need>frame.head?{...frame,head:need}:frame;
}
// The head box of one sprite state (canvas fractions). Precedence (r4): calibrated anatomy → the author's crop (state or
// outfit) → estimated anatomy → automatic / default crop. An estimated head starts at the top of the figure, so big
// ribbons, wings or a hat shrank the face; the author's crop is where the face really is.
function spriteHead(outfit,stateId,hash) {
  const measured=outfit.extensions?.['dsh.avatar-heads']?.[stateId];
  if(hash&&measured?.media===hash)return {head:{top:measured.headTop,chin:measured.chin,cx:measured.faceRect[0]+measured.faceRect[2]/2,fig:measured.figureHeight},sure:true};
  const a=outfit.sprite?.anatomy?.[stateId]||outfit.sprite?.anatomy?.[outfit.defaultEmotion]||{},crop=spriteCropFor(outfit,stateId),cropX=crop.x+crop.w/2,manual=['state','outfit'].includes(cropSource(outfit,stateId));
  const cheeks=a.cheeks?.left&&a.cheeks?.right?(a.cheeks.left[0]+a.cheeks.right[0])/2:null,face=Array.isArray(a.faceRect)?a.faceRect[0]+a.faceRect[2]/2:null;
  // A head derived from the figure height alone (headTop = figureTop, one head of headsPerBody) does not locate the face.
  const per=Number(a.headsPerBody),feet=Number.isFinite(a.feet)?a.feet:a.visibleBottom,derived=per>0&&Number.isFinite(feet)&&Math.abs(a.headTop-a.figureTop)<0.002&&Math.abs((a.chin-a.headTop)-(feet-a.figureTop)/per)<0.004;
  const anatomy=Number.isFinite(a.headTop)&&Number.isFinite(a.chin)&&a.chin>a.headTop,calibrated=anatomy&&a.source!=='estimated'&&!derived;
  // The drawn figure's height (canvas fraction) lets CAST_FACE cap the body under the chin; unknown without anatomy.
  const fig=Number.isFinite(a.figureTop)&&Number.isFinite(feet)&&feet>a.figureTop?feet-a.figureTop:undefined;
  const fromCrop={...packCropHead(crop),cx:cropX,fig};
  if(calibrated)return {head:{top:a.headTop,chin:a.chin,cx:cheeks??face??cropX,fig},sure:true};
  if(manual)return {head:fromCrop,sure:true};
  if(anatomy)return {head:{top:a.headTop,chin:a.chin,cx:cheeks??face??cropX,fig},sure:false};
  return {head:fromCrop,sure:false};
}
function stateBust(outfit,state) {
  const src=state?.stage?.src||state?.src,hash=src&&outfit?.sprite?.assets?.[src];
  return hash?{hash,...spriteHead(outfit,state.id,hash)}:null;
}
// A still's picture: one leased image. `thumbnail` is a host thumbnail tier (256 / 512 / 1024) to try before the original.
function useStillPicture(binding,packId,hash,thumbnail=false) {
  return useLeasedMedia(binding,packId,hash,thumbnail);
}
function figureOutfitView(figure,outfit) { return outfit && outfit.defaultEmotion === undefined ? {...outfit,defaultEmotion:figure.emotions?.[0]?.id} : outfit; }
function outfitHead(outfit,manifest,emotion=outfit?.defaultEmotion) { return outfit?.sprite?stateBust(outfit,packAvatarState(outfit,manifest,emotion)):null; }
function bustStyle(head,W,H,frame=OUTFIT_BUST) {
  const box=bustBox(head,W,H,frame);
  return {position:'absolute',maxWidth:'none',width:100*W/box.w+'%',height:100*H/box.h+'%',left:-100*box.x/box.w+'%',top:-100*box.y/box.h+'%'};
}
// a leased picture that ends — the lease was refused
// (useLeasedUrl swallowed that, so the spinner never stopped) or the image itself fails to load — retries once with a
// fresh lease, then reports `failed`; the caller shows an empty dashed slot instead of an endless spinner.
function useLeasedMedia(binding,packId,hash,thumbnail=false) {
  const key=packId+'\n'+hash,cached=hash?peekMedia(binding,packId,hash):null,[state,setState]=React.useState(null),[attempt,setAttempt]=React.useState(0);
  React.useEffect(()=>{if(!hash||thumbnail&&attempt===0)return;if(!binding.previewMedia){setState({key,failed:true});return;}let active=true,release=null;
    holdMedia(binding,packId,hash).then(media=>{if(!active)media.release();else{release=media.release;setState({key,url:media.url});}}).catch(()=>{if(active)setState({key,failed:true});});
    return()=>{active=false;release?.();};},[binding,packId,hash,attempt,thumbnail]);
  const mine=state?.key===key?state:null,failed=!!mine?.failed;
  const broken=()=>{if(!thumbnail||attempt>0)dropMedia(binding,packId,hash);if(attempt<(thumbnail?2:1)){setState(null);setAttempt(attempt+1);}else setState({key,failed:true});};
  return {url:!hash||failed?null:thumbnail&&attempt===0?thumbUrl({packId,hash,size:thumbnail}):mine?.url||cached||null,failed,broken};
}
// a bust tile paints a small picture cut from the sprite once —
// the bytes decoded off the main thread (createImageBitmap on the fetched blob), the head-and-shoulders box drawn at tile
// size, encoded off-thread (toBlob) — instead of every tile scaling the full-size sprite (≈ 1 MB WebP, thousands of px)
// by CSS. Shared by picture + head + frame for the page's lifetime (bounded LRU); at most three are made at a time. A
// cached thumbnail paints in the tile's first frame without leasing the sprite. Without the APIs (tests, old hosts) the
// tile keeps the CSS crop of the full picture.
const BUST_THUMB={limit:240,jobs:3},bustThumbs=new Map(),bustThumbWait=[];let bustThumbActive=0;
const bustThumbsSupported=()=>typeof createImageBitmap==='function'&&typeof fetch==='function'&&typeof document!=='undefined'&&!!document.createElement&&typeof URL!=='undefined'&&typeof URL.createObjectURL==='function';
// The frame's box in picture pixels (the inverse of bustStyle).
function bustBox(head,W,H,frame) {
  if(head.whole){const h=Math.max(H,W/frame.aspect),w=h*frame.aspect;return {x:(W-w)/2,y:(H-h)/2,w,h,aspect:frame.aspect};}
  frame=fitFrame(frame,head.chin-head.top,head.fig);
  const s=frame.head/Math.max(1e-6,(head.chin-head.top)*H),w=frame.aspect/s,hgt=1/s;
  return {x:head.cx*W-w/2,y:head.top*H-frame.top/s,w,h:hgt,aspect:frame.aspect};
}
const bustThumbKey=(bust,frame,limit)=>bust&&limit?bust.hash+'\n'+[bust.head.top,bust.head.chin,bust.head.cx,bust.head.fig??'',bust.head.whole||false,frame.head,frame.top,frame.aspect,frame.below??'',limit].join(','):'';
// a bust is cut at its box's height in device pixels (in 64 px steps, so tiles of one size
// share it), from the host thumbnail tier whose height still holds that cut (the head box is a small share of a 立绘:
// a 256 px thumbnail left ~40 px of face for a 156 px tile). The box is the art's parent, measured once laid out; the last
// height per frame is remembered so a later tile finds its cached bust in its first frame.
const bustLimits=new Map();
function bustSource(bust,frame,limit) {
  if(bust.head.whole)return thumbTier(limit);
  const headH=bust.head.chin-bust.head.top,share=headH>0?headH/fitFrame(frame,headH,bust.head.fig).head:1;
  return thumbTier(limit/Math.min(1,share));
}
function useBustLimit(frame) {
  const probe=React.useRef(null),[limit,setLimit]=React.useState(()=>bustLimits.get(frame)||0);
  (React.useLayoutEffect||React.useEffect)(()=>{
    const next=Math.max(64,Math.ceil((probe.current?.parentElement?.offsetHeight||0)*screenDpr()/64)*64);bustLimits.set(frame,next);if(next!==limit)setLimit(next);},[frame]);
  return {probe,limit};
}
const peekBustThumb=key=>key&&bustThumbs.get(key)?.url||null;
// after a reload the first 舞台设置 open spent ~80 ms of main thread per tile on the high-quality
// downscale of the full sprite. A worker now decodes, crops, scales (the same box and smoothing as bustBox) and encodes on
// an OffscreenCanvas; the main thread only fetches the blob. Hosts without module-less blob workers keep the old path.
const BUST_THUMB_WORKER=`${fitFrame.toString()}\n${bustBox.toString()}\nself.onmessage=async({data:{id,blob,head,fit,limit}})=>{let bitmap=null;try{bitmap=await createImageBitmap(blob);
const {x,y,w,h}=bustBox(head,bitmap.width,bitmap.height,fit);
const outH=Math.max(1,Math.round(Math.min(limit,h))),outW=Math.max(1,Math.round(outH*fit.aspect)),canvas=new OffscreenCanvas(outW,outH),g=canvas.getContext('2d');
g.imageSmoothingQuality='high';g.drawImage(bitmap,x,y,w,h,0,0,outW,outH);self.postMessage({id,blob:await canvas.convertToBlob({type:'image/webp',quality:0.9})});}
catch(error){self.postMessage({id,error:String(error&&error.message||error)});}finally{if(bitmap)bitmap.close();}};`;
const bustThumbOffThread=(()=>{let worker=null,broken=typeof Worker!=='function'||typeof OffscreenCanvas!=='function',seq=0;const calls=new Map();
  const fail=error=>{broken=true;worker=null;for(const call of calls.values())call.no(error);calls.clear();};
  return (blob,head,frame,limit)=>{
    if(broken)return null;
    try{if(!worker){const source=URL.createObjectURL(new Blob([BUST_THUMB_WORKER],{type:'text/javascript'}));worker=new Worker(source);URL.revokeObjectURL(source);
      worker.onmessage=({data})=>{const call=calls.get(data.id);if(!call)return;calls.delete(data.id);data.blob?call.done(data.blob):call.no(new Error(data.error||'thumbnail failed'));};
      worker.onerror=event=>{event.preventDefault?.();fail(new Error('thumbnail worker unavailable'));};}}
    catch(error){fail(error);return null;}
    const id=++seq,fit=fitFrame(frame,head.chin-head.top,head.fig);
    return new Promise((done,no)=>{calls.set(id,{done,no});worker.postMessage({id,blob,head:{top:head.top,chin:head.chin,cx:head.cx,whole:head.whole},fit:{head:fit.head,top:fit.top,aspect:fit.aspect},limit});});
  };
})();
async function bustThumbOnMain(blob,head,frame,limit) {
  let bitmap=null;
  try{
    bitmap=await createImageBitmap(blob);
    const box=bustBox(head,bitmap.width,bitmap.height,frame),outH=Math.max(1,Math.round(Math.min(limit,box.h))),outW=Math.max(1,Math.round(outH*box.aspect));
    const canvas=document.createElement('canvas');canvas.width=outW;canvas.height=outH;const g=canvas.getContext('2d');g.imageSmoothingQuality='high';
    g.drawImage(bitmap,box.x,box.y,box.w,box.h,0,0,outW,outH);
    return await new Promise((done,no)=>canvas.toBlob(b=>b?done(b):no(new Error('thumbnail failed')),'image/webp',0.9));
  }finally{bitmap?.close?.();}
}
function bustThumb(key,url,head,frame,limit) {
  const hit=bustThumbs.get(key);if(hit){bustThumbs.delete(key);bustThumbs.set(key,hit);return hit.promise;}
  const entry={url:null};
  entry.promise=new Promise((ok,fail)=>{const run=async()=>{bustThumbActive++;
    try{
      const source=await (await fetch(url)).blob(),offThread=bustThumbOffThread(source,head,frame,limit);
      // A worker that cannot start (CSP, missing API) falls back for this and every later tile.
      const blob=offThread?await offThread.catch(()=>bustThumbOnMain(source,head,frame,limit)):await bustThumbOnMain(source,head,frame,limit);
      entry.url=URL.createObjectURL(blob);ok(entry.url);
    }catch(error){fail(error);}
    finally{bustThumbActive--;bustThumbWait.shift()?.();}};
    if(bustThumbActive<BUST_THUMB.jobs)run();else bustThumbWait.push(run);});
  entry.promise.catch(()=>{if(bustThumbs.get(key)===entry)bustThumbs.delete(key);});
  bustThumbs.set(key,entry);
  for(const [k,v] of bustThumbs){if(bustThumbs.size<=BUST_THUMB.limit)break;if(v.url){bustThumbs.delete(k);URL.revokeObjectURL(v.url);}}
  return entry.promise;
}
function useBustThumb(key,url,head,frame,limit) {
  const [state,setState]=React.useState(null),supported=bustThumbsSupported();
  React.useEffect(()=>{if(!supported||!key||!url||peekBustThumb(key))return;let live=true;
    bustThumb(key,url,head,frame,limit).then(thumb=>{if(live)setState({key,url:thumb});},()=>{if(live)setState({key,failed:true});});return()=>{live=false;};},[key,url]);
  const mine=state?.key===key?state:null;
  return {supported,url:peekBustThumb(key)||mine?.url||null,failed:!!mine?.failed};
}
// The picture's own size is read when it loads (no manifest size needed); until then the reserved box shows the spinner.
// Explicit whole-art framing is independent of height: tall non-humans need not have a human face crop.
function thumbnailHead(bust,figure) {
  const F=FIGURE_FIT,head=bust.head,cm=figure?.heightCm;
  const whole=figure?.extensions?.['dsh.thumbnail']?.framing==='whole'||figure?.extensions?.['dsh.height']?.heightSource==='none'||cm>0&&cm/F.refCm<=F.smallShare||bust.sure&&head.fig>0&&(head.chin-head.top)/head.fig>=F.chibiHead;
  return whole?{...head,whole:true}:head;
}
function BustArt({binding,packId,bust,figure,frame=OUTFIT_BUST}) {
  bust={...bust,head:thumbnailHead(bust,figure)};
  const {probe,limit}=useBustLimit(frame),key=bustThumbKey(bust,frame,limit),cached=!!peekBustThumb(key),wait=!limit||cached;
  // A thumbnail already made needs no lease of the full picture.
  const {url,failed,broken}=useStillPicture(binding,packId,wait?null:bust.hash,limit?bustSource(bust,frame,limit)||false:false),thumb=useBustThumb(key,url,bust.head,frame,limit);
  const [size,setSize]=React.useState(null),ready=!!url&&size?.url===url,mark=h('span',{key:'probe',ref:probe,hidden:true});
  if(thumb.supported&&!thumb.failed&&(thumb.url||!failed))return h(React.Fragment,null,!thumb.url&&h(Spinner,{key,fill:true}),
    thumb.url&&h(RevealImg,{src:thumb.url,alt:'',draggable:false,decoding:'async',className:'ap-bust-thumb'}),mark);
  if(failed)return h(React.Fragment,null,h('span',{className:'ap-art-missing',role:'img','aria-label':'图片未能载入',title:'图片未能载入'}),mark);
  return h(React.Fragment,null,!ready&&h(Spinner,{key:bust.hash,fill:true}),url&&h(RevealImg,{src:url,alt:'',draggable:false,style:ready?bustStyle(bust.head,size.w,size.h,frame):{visibility:'hidden'},
    onError:broken,onLoad:e=>{const img=e.currentTarget;setSize({url,w:img.naturalWidth,h:img.naturalHeight});}}),mark);
}
// One cast face: the opening outfit's calm picture framed by CAST_FACE when its head is known (calibrated or the author's
// crop); otherwise the figure's avatar (an uploaded avatar is already framed), else the silhouette.
function castFaceBust(figure,sprites) {
  if(!figure?.enabled)return null;
  const outfit=figure.outfits?.find(o=>o.enabled),bust=outfit&&outfitHead(outfit,sprites?.[outfit.sprite?.manifestKey]);
  return bust?.sure?bust:null;
}
// avatars, static sprites and Live2D are separate assets. The r5 Live2D-snapshot face
// (for a Live2D-only figure without an avatar) is gone: missing art gets made, not faked — such a figure shows the
// silhouette, and its editor shows the empty slots with their upload badge.
// Whether a figure has a picture for its face (pack rows only stack real faces).
const figureHasFace=(pack,figure)=>!!(castFaceBust(figure,pack?.sprites)||figureAvatar(figure,pack?.sprites));
function FigureCastFace({binding,packId,figure,sprites,avatar,label,className='ap-avatar',frame='cast'}) {
  const bust=frame==='cast'?castFaceBust(figure,sprites):null;
  if(bust)return h('span',{className:className+' ap-head-art'},h(BustArt,{binding,packId,bust,figure,frame:CAST_FACE}));
  if(avatar)return h(Thumb,{binding,packId,...avatar,label,className});
  return h(Silhouette,{figure:figure||{},className,empty:true});
}
// the figure's other names (data: `aliases`). Each one does both jobs (a
// line signed with it is this figure; the text mentioning it calls the figure in), so the separate figure 触发词 list was
// the same concept twice. Chips with an inline dashed ＋; a single character is a valid name (惠), up to 32 names.
// labelled 「触发词」 like every other recall word list — figure-recall's
// green trigger is the name plus these words, and the identity resolver maps the same words to this figure.
const ALIAS_HELP='人物的名字始终是触发词；这里添加其他叫法或昵称，正文提到其中任何一个都会带上这个人物，正文和台词署名里的这些叫法也会被认作这个人物。';
const splitAliases=value=>[...new Set(String(value||'').split(/[,，、\n]/).map(word=>word.trim()).filter(Boolean))];
// a lowercase code (「dafeiyu」, 「c8」, 「homura_long」) is an old actor key a migration
// kept as an alias so earlier chats still resolve; it is not a name a person reads, so the list does not show it (it stays
// in the data, untouched, like an outfit's key-like trigger words), and a typed one asks for the readable form instead.
const aliasHidden=word=>/^[a-z][a-z0-9_]*$/.test(String(word));
function aliasProblem(words) {
  if(words.length>32)return '触发词最多 32 个';
  const code=words.find(aliasHidden);
  if(code)return `「${code}」像内部代号，请写成人物的叫法，如 ${code[0].toUpperCase()+code.slice(1)}`;
  const bad=words.find(word=>[...word].length>40);
  return bad?`「${bad}」超过 40 字`:'';
}
const figureNames=figure=>(figure.aliases||[]).filter(word=>!aliasHidden(word));
// Hidden actor names remain identities; normalization happens once at the service write boundary.
function namesPatch(figure,names) {
  const old=figure.aliases||[];
  return {aliases:[...new Set([...old.filter(w=>aliasHidden(w)||names.includes(w)),...names.filter(w=>!old.includes(w))])]};
}
const OUTFIT_LAMPS={constant:'蓝灯',keyword:'绿灯',off:'关闭'};
const outfitLamp=outfit=>outfit.enabled===false?'off':outfit.recall?.mode==='constant'?'constant':'keyword';
// The glyph is drawn in the image colour: keep 3:1 on its tile (lightness only; the stored colour is unchanged).
function Silhouette({figure,className='',empty}) {
  const ref=React.useRef(null),color=figureColor(figure);
  useFigureTextContrast(React,ref,true,color);
  return h('span',{ref,className:'ap-figure-silhouette '+className,'data-empty':empty||undefined,'data-figure-ink':'3',style:{'--figure-color':color}},h(Glyph,{name:'figures'}));
}
// one missing-slot language for the three views and the large preview — an empty
// tile, a dashed ring in the theme accent (figure quick fixes: no per-差分 colour) and a ✦; no person icon, no label. `mark`: the ✦ is drawn here (a tile whose ✦
// is its own button lays that button over the same spot instead). Upload is the preview card's ⤒, never a per-tile badge.
function SlotMissing({className='',mark=true,style,children}) {
  return h('span',{className:('ap-slot-missing '+className).trim(),style},children||(mark?h(Glyph,{name:'spark'}):null));
}
// the 差分 an outfit offers — one list for Live2D, 立绘 and 头像: the built-ins plus the figure's
// custom 差分 this outfit owns (its 立绘 manifest has them). Same rule as figureOutfitEmotionRows (dsh-asset-library), which
// the director offers; the 头像 view used to list every custom 差分 of the figure (铁盆: 14 vs 11).
// no standard set any more — the grid lists exactly the 差分 the outfit declares,
// in its declared order: its 立绘 manifest's emotions, then (a Live2D model) its resting 平和 and mapped expressions, then
// its avatar files; each once. A declared 差分 without media for the view on show is a dashed ✦ tile. Names come from the
// figure's one resolver (figureEditorEmotions: the shared names for the built-in keys, the figure's own for the rest).
function outfitEmotionRows(figure,outfit,manifest) {
  if(!outfit)return [];
  return figureEditorEmotions(figure);
}
// an empty slot carries a small upload badge on its bottom-right corner;
// picking a file opens the framer (crop / zoom) before the upload. A label around a hidden file input, so it stays a
// keyboard stop of its own next to the slot's button.
function SlotUpload({label,disabled,onFile}) {
  return h('label',{className:'ap-slot-upload','data-disabled':disabled||undefined,title:label},h(Glyph,{name:'upload'}),
    h('input',{type:'file',accept:'image/png,image/webp,image/jpeg','aria-label':label,disabled,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file);}}));
}
// each outfit's 触发策略 is the lamp dot on its tile's top-right corner: 蓝灯 /
// 绿灯 / 关闭; 关闭 greys the tile and the dot. the dot is the one
// LampMenu (asset-pack-entry-ui.js; was its own copy, OutfitLamp) — same button, menu and names.
function OutfitLamp({outfit,onChange}) {
  return h(LampMenu,{mode:outfitLamp(outfit),label:'服装「'+outfit.label+'」的灯',anchorClassName:'ap-outfit-lamp-anchor',className:'ap-cast-lamp ap-outfit-lamp-button',onChange});
}
// the selection mark of a tile in a grid's delete mode — the house round check
// (.ap-check-mark, the 素材包 「导出」 / 素材库 selection's), on the tile's top-left corner.
function TileCheck({checked}) { return h('span',{className:'ap-check-mark ap-tile-check','aria-hidden':true},checked&&h(Glyph,{name:'check'})); }
// a tile is only its picture, name and lamp dot — its fields live in the
// selected outfit's block under the grid. Figure select: no 「默认」 badge (the opening outfit is chosen in
// 舞台设置 › 开场; the data rule — first enabled outfit — is unchanged); in the grid's delete mode (`picking`) the tile is a
// checkbox with the round check, its lamp a plain dot. Memoised: switching outfits re-renders the two tiles whose selection
// changed, not all of them (the callbacks are stable, keyed by the outfit).
const FigureOutfitTile=(React.memo||(c=>c))(function FigureOutfitTile({binding,pack,figure,outfit,selected,picking=false,checked=false,onSelect,onFlip,upload,onLamp}) {
  outfit=figureOutfitView(figure,outfit);
  const packId=pack.manifest.id,manifest=pack.sprites?.[outfit.sprite?.manifestKey],bust=outfitHead(outfit,manifest);
  const face=!bust?selectPackAvatar({outfit,manifest,emotion:outfit.defaultEmotion}):null;
  const art=bust?h(BustArt,{binding,packId,bust,figure}):face?h(Thumb,{binding,packId,hash:face.hash,crop:face.crop,label:outfit.label,className:'ap-outfit-face-art'}):h(Silhouette,{figure});
  const lamp=outfitLamp(outfit),empty=!outfit.sprite&&!outfit.live2d&&!outfit.spine&&!face;
  return h('span',{className:'ap-outfit-cell','data-selected':!picking&&selected||undefined},
    h('button',{type:'button',role:picking?'checkbox':'radio','aria-checked':picking?checked:selected,className:'ap-outfit-face','data-disabled':!outfit.enabled||undefined,title:outfit.label+' · '+OUTFIT_LAMPS[lamp],onClick:()=>picking?onFlip(outfit.key):onSelect(outfit.key)},
      // r5: one tile language with the 差分 faces — same corner radius, ring and selected ring.
      h('span',{className:'ap-outfit-art','data-kind':bust?'bust':face?'face':'none'},art,
        picking&&h(TileCheck,{checked}),
        (picking||!onLamp)&&h('span',{className:'ap-outfit-lamp','data-mode':lamp,'aria-hidden':true})),
      h('span',{className:'ap-outfit-name'},outfit.label)),
    !picking&&onLamp&&h(OutfitLamp,{outfit,onChange:mode=>onLamp(outfit.key,mode)}),
    !picking&&empty&&upload&&h('span',{className:'ap-slot-anchor'},h(SlotUpload,{label:'上传「'+outfit.label+'」的立绘',disabled:upload.disabled,onFile:file=>upload.pick(outfit,file)})));
});
// One labelled property: label above the control on desktop, a label column on the phone (CSS only).
function Prop({label,className,children,...rest}) {
  return h('div',{className:'ap-prop'+(className?' '+className:''),...rest},h('span',{className:'ap-prop-key'},label),h('div',{className:'ap-prop-value'},children));
}
// the preview's view controls. Wheel (or pinch) zooms around the pointer,
// drag (also Shift + drag, one finger) pans, double-click / 0 / Home resets; + / - and the arrow keys work on the focused
// card. A quiet cluster of translucent discs on the card's bottom-right edge — 放大 / 缩小 / 复原 — makes it
// discoverable, and a one-line hint shows while the pointer is over the card (desktop only; CSS).
const VIEW_ZOOM={min:0.25,max:4,step:1.25},VIEW_HOME={x:0,y:0,scale:1};
const viewMoved=v=>!!v&&(Math.abs(v.scale-1)>0.001||Math.abs(v.x)>0.5||Math.abs(v.y)>0.5);
// Zoom to `next` keeping the point `p` (offset from the box centre, px) where it is.
function zoomView(v,next,p={x:0,y:0},{min=VIEW_ZOOM.min,max=VIEW_ZOOM.max}={}) {
  const s=Math.min(max,Math.max(min,next)),k=s/v.scale;
  return {scale:s,x:p.x-(p.x-v.x)*k,y:p.y-(p.y-v.y)*k};
}
function ViewTools({view,min=VIEW_ZOOM.min,max=VIEW_ZOOM.max,onZoom,onReset,hint}) {
  const tool=(icon,label,title,disabled,onClick)=>h('button',{type:'button',className:'ap-view-tool','aria-label':label,title,disabled,onClick},h(Glyph,{name:icon}));
  return h(React.Fragment,null,
    hint&&h('span',{className:'ap-view-hint','aria-hidden':true},hint),
    h('div',{className:'ap-view-tools',role:'toolbar','aria-label':'预览视图'},
      tool('plus','放大','放大（+）',!!view&&view.scale>=max-0.001,()=>onZoom(VIEW_ZOOM.step)),
      tool('minus','缩小','缩小（-）',!!view&&view.scale<=min+0.001,()=>onZoom(1/VIEW_ZOOM.step)),
      tool('fit','复原','复原（双击或 0 也可）',!!view&&!viewMoved(view),onReset)));
}
function FigureStillPreview({children}) {
  const [view,setView]=React.useState(VIEW_HOME),drag=React.useRef(null),pointers=React.useRef(new Map()),root=React.useRef(null);
  const local=(x,y)=>{const r=root.current?.getBoundingClientRect?.();return r?{x:x-r.left-r.width/2,y:y-r.top-r.height/2}:{x:0,y:0};};
  // React delegates wheel passively; a local non-passive listener zooms around the pointer and keeps the page still.
  React.useEffect(()=>{const node=root.current;if(!node)return;const wheel=event=>{event.preventDefault();const p=local(event.clientX,event.clientY),d=Math.max(-120,Math.min(120,event.deltaY));setView(v=>zoomView(v,v.scale*Math.exp(-d*0.0015),p));};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[]);
  const start=()=>{const list=[...pointers.current.values()];
    drag.current=list.length>=2?{pinch:Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y)||1,mid:local((list[0].x+list[1].x)/2,(list[0].y+list[1].y)/2),view:null}:list.length?{x:list[0].x,y:list[0].y,view:null}:null;};
  const down=e=>{if(e.button>0)return;e.preventDefault();e.currentTarget.focus?.({preventScroll:true});e.currentTarget.setPointerCapture?.(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});start();};
  const move=e=>{const d=drag.current;if(!d||!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const list=[...pointers.current.values()];
    setView(v=>{const base=d.view||(d.view=v);
      if(d.pinch){if(list.length<2)return v;const mid=local((list[0].x+list[1].x)/2,(list[0].y+list[1].y)/2),z=zoomView(base,base.scale*(Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y)||1)/d.pinch,d.mid);return {...z,x:z.x+mid.x-d.mid.x,y:z.y+mid.y-d.mid.y};}
      return {...base,x:base.x+list[0].x-d.x,y:base.y+list[0].y-d.y};});};
  const up=e=>{pointers.current.delete(e.pointerId);start();};
  const key=e=>{const moves={ArrowLeft:[24,0],ArrowRight:[-24,0],ArrowUp:[0,24],ArrowDown:[0,-24]};
    if(moves[e.key]){e.preventDefault();setView(v=>({...v,x:v.x+moves[e.key][0],y:v.y+moves[e.key][1]}));}
    else if(e.key==='+'||e.key==='='){e.preventDefault();setView(v=>zoomView(v,v.scale*VIEW_ZOOM.step));}
    else if(e.key==='-'||e.key==='_'){e.preventDefault();setView(v=>zoomView(v,v.scale/VIEW_ZOOM.step));}
    else if(e.key==='0'||e.key==='Home'){e.preventDefault();setView(VIEW_HOME);}};
  return h(React.Fragment,null,
    h('div',{ref:root,className:'ap-still-canvas',tabIndex:0,role:'img','aria-label':'立绘预览：拖动平移，滚轮或双指缩放，+ / - 缩放，方向键平移，0 复位','data-moved':viewMoved(view)||undefined,
      onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up,onDoubleClick:()=>setView(VIEW_HOME),onKeyDown:key},
      h('div',{className:'ap-still-image',style:{transform:'translate('+view.x+'px,'+view.y+'px) scale('+view.scale+')'}},children)),
    h(ViewTools,{view,hint:'拖动平移 · 滚轮缩放 · 双击复位',onZoom:f=>setView(v=>zoomView(v,v.scale*f)),onReset:()=>setView(VIEW_HOME)}));
}
// The Live2D preview keeps its view in the model's own loop; the cluster drives it through `viewRef` and reads it back
// through `onView` (so 放大 / 缩小 / 复原 know when they apply). the same
// gestures as the 立绘 / 头像 previews — drag pans, the wheel zooms (no 「look at the cursor」 drag).

// 基础设定 is one InlineGrid of InlineField rows (inline-field.js):
// 身高 120 cm · 形象色 ● · 声音 大肥鱼（萌宝）› · 触发词 [chips] ＋ — label and value on one line, the value edited in place.
// 默认外观 left this grid: it is set from the 差分 header's ⋯ of the view on show (FigureViewMenu, same figure.appearance).
// the short values (身高 · 形象色 · 声音) share one row and
// 触发词 (any length) takes the whole width under them; labels sit in the editor's one label column (theme.css 基础设定).
const FIGURE_DESCRIPTION_MAX=1000;
function FigureBasics({figure,write,voice}) {
  const automatic=figure.autoColor??FIGURE_AUTO_NEUTRAL;
  return h(InlineGrid,{label:'人物资料',className:'ap-fe-basics'},
    h(InlineField,{kind:'number',label:'身高',className:'ap-height',hideEmpty:true,unit:'cm',integer:false,min:1,max:400,value:figure.heightCm||null,title:'用于在舞台上和其他角色比较高低',
      validate:v=>v>0&&v<=400?'':'身高需为 1–400 的数字',onCommit:v=>write(()=>({heightCm:v}))}),
    h(InlineField,{kind:'color',label:'形象色',className:'ap-color',auto:automatic,value:figure.imageColor||'',onCommit:v=>write(()=>({imageColor:v||null}))}),
    voice,
    h(InlineField,{kind:'chips',label:'触发词',controlLabel:'人物触发词',className:'is-aliases',wide:true,hideEmpty:true,help:h(Help,{text:ALIAS_HELP,label:'人物触发词 说明'}),value:figureNames(figure),split:splitAliases,validate:aliasProblem,onCommit:names=>write(f=>namesPatch(f,names))}),
    // figure.description is the line the story model reads for this figure in
    // <speaker_roster> (card-stage.js → dialogue-bubbles.js). A paragraph under 触发词; line breaks kept (Shift+Enter),
    // Enter / blur saves, Esc reverts; empty removes the field. The pack validates it (string ≤ 1000) on write.
    h(InlineField,{kind:'text',multiline:true,lines:true,count:true,maxLength:FIGURE_DESCRIPTION_MAX,label:'人物介绍',className:'is-description',wide:true,hideEmpty:true,
      help:h(Help,{text:'正文模型在说话人名单里看到的这个人物的介绍',label:'人物介绍 说明'}),value:figure.description||'',
      validate:v=>v.length<=FIGURE_DESCRIPTION_MAX?'':'人物介绍最多 '+FIGURE_DESCRIPTION_MAX+' 字',onCommit:v=>write(()=>({description:v||null}))}),
    // the owner's 备注 (`remark`, never sent) under 人物介绍; patchFigure merges top-level keys.
    remarkField({value:figure.remark,controlLabel:'人物备注',className:'is-remark',wide:true,onCommit:v=>write(()=>({remark:v}))}));
}
// the 声音 property and its voice page live in asset-pack-voice-ui.js.
// Live2D expression / motion names of a bundle, read once from its model3.json (null while unknown or unavailable).
const live2dNameCache=new Map();
function useLive2dNames(binding,packId,bundleKey) {
  const key=packId+'/'+bundleKey,[names,setNames]=React.useState(()=>live2dNameCache.get(key)||null);
  React.useEffect(()=>{
    const svc=binding.service;if(!bundleKey||live2dNameCache.has(key)||typeof fetch!=='function'||typeof svc?.leaseBundle!=='function'){setNames(live2dNameCache.get(key)||null);return;}
    let live=true,lease=null;
    (async()=>{lease=await svc.leaseBundle({packId,bundleKey});const doc=await (await fetch(lease.url)).json(),refs=doc?.FileReferences||{};
      const value={expressions:(refs.Expressions||[]).map(e=>e?.Name).filter(n=>typeof n==='string'),motions:Object.keys(refs.Motions||{})};live2dNameCache.set(key,value);if(live)setNames(value);})()
      .catch(()=>{}).finally(()=>{if(lease)svc.releaseLease?.(lease.ticket);});
    return()=>{live=false;};
  },[binding,key]);
  return names;
}
// ---------- 三种素材 (v3.1, UI comment 2) ----------
// Every outfit has three separate assets — Live2D, 立绘 (static sprite), 头像 (dialogue avatar) — and each has a variant per
// emotion of the figure's one emotion list (outfit.live2d.emotionMap, outfit.sprite.emotionMap + states, outfit.avatars).
// The 差分 header picks which asset the roster, the open emotion and the preview show. No asset stands in for another.
// the switch is 模型 / 立绘 / 头像. 模型 is the outfit's one model — Live2D, else
// Spine — so the view on show (`kind`) stays 'live2d' / 'spine' / 'sprite' / 'avatar'.
const ASSET_KINDS=[['model','模型'],['sprite','立绘'],['avatar','头像']];
const isModelKind=k=>k==='live2d'||k==='spine';
const outfitModelKind=outfit=>outfit?.spine&&!outfit.live2d?'spine':'live2d';
// a figure-level list (声音 per 差分) — every 差分 any of its outfits declares, first seen first.
function figureDeclaredRows(figure,pack) {
  const seen=new Map();
  for(const o of figure.outfits||[])for(const r of outfitEmotionRows(figure,o,pack.sprites?.[o.sprite?.manifestKey]))if(!seen.has(r.id))seen.set(r.id,r);
  return [...seen.values()];
}
function outfitHasAsset(outfit,kind) {
  if(!outfit)return false;
  // 头像 means avatar files — a 立绘 crop is not an avatar (owner: missing is missing).
  return kind==='model'?!!outfit.live2d||!!outfit.spine:kind==='live2d'?!!outfit.live2d:kind==='spine'?!!outfit.spine:kind==='sprite'?!!outfit.sprite:Object.keys(outfit.avatars||{}).length>0;
}
const defaultAssetKind=outfit=>outfit?.live2d?'live2d':outfit?.spine?'spine':outfit?.sprite?'sprite':Object.keys(outfit?.avatars||{}).length?'avatar':'sprite';
// Whether this emotion has its own variant of the asset (else the runtime shows 平和, and the slot is empty).
function emotionMapped(kind,outfit,manifest,id) {
  if(!outfit)return false;
  if(kind==='live2d')return !!outfit.live2d&&(id===outfit.defaultEmotion||!!outfit.live2d.emotionMap?.[id]);
  if(kind==='spine')return !!outfit.spine&&(id===outfit.defaultEmotion||!!outfit.spine.emotionMap?.[id]);
  if(kind==='sprite')return !!outfit.sprite&&!!emotionState(outfit,manifest,id);
  // the editor's 头像 view shows avatar files only; without one the slot is the
  // dashed ✦ (the runtime's 立绘-crop fallback, pack-avatar.cjs selectPackAvatar, is not shown here as if it were an avatar).
  return !!outfit.avatars?.[outfitImageId(outfit,id)];
}
// the one Segmented (roving Tab, ←→ Home End choose).
function AssetKindSwitch({kind,outfit,onChange}) {
  return h(Segmented,{className:'ap-asset-kinds',label:'素材种类',value:isModelKind(kind)?'model':kind,onChange,options:ASSET_KINDS.map(([k,label])=>{const has=outfitHasAsset(outfit,k);
    return [k,label,false,has?label:label+'：这套服装还没有',{'data-empty':!has||undefined}];})});
}
// a 差分 whose 立绘 talks / blinks (parts, mouth frames, blink patches, a
// talk frame — !spriteSlotTakesStill) is a 「动态立绘」 to the user. A single picture cannot replace it without dropping its
// mouth and eyes: 重画… / 替换为本地图片… ask first and delete it on the way (askReplace, variant-menu). LAYERED_TIP is the
// reason left on the few gates that cannot take that way (a generated batch, a retry).
const LAYERED_TIP='动态立绘不能直接换成单张图';
// One emotion's variant of the selected asset for the selected outfit. Uploads always go into this figure's own pack and
// pass through the framer first (`pick`).
function EmotionMedia({kind,binding,pack,figure,outfit,manifest,row,writeOutfit,upload,pick,layered=false,onCrop,onGen,close=()=>{}}) {
  const packId=pack.manifest.id,names=useLive2dNames(binding,packId,kind==='live2d'?outfit.live2d?.bundleKey:null);
  const live=outfit.live2d?.emotionMap?.[row.id];
  const setLive=(field,value)=>writeOutfit(o=>{const map={...(o.live2d.emotionMap||{})},entry=typeof map[row.id]==='string'?{expression:map[row.id]}:{...map[row.id]};if(value)entry[field]=value;else delete entry[field];if(Object.keys(entry).length)map[row.id]=entry;else delete map[row.id];return {...o,live2d:{...o.live2d,emotionMap:map}};});
  // no 「用平和」 / 「模型原样」 / 「自动」 chip. An emotion without its own choice
  // simply falls back to 平和 (平和 itself to the model / sprite default); clicking the selected choice again clears it
  // (the 差分 ? tooltip says so; the selected choice's tooltip repeats it).
  const UNSET='再点一次取消（取消后'+(row.id===outfit.defaultEmotion?'用默认':'显示首个差分')+'）';
  const choice=(on,label,onClick,key)=>h('button',{key:key||label,type:'button',role:'menuitemradio','aria-checked':on,className:'ap-map-choice',title:on?UNSET:undefined,onClick},label);
  // every media setting is an inline 「label value」 row under 使用情景
  // (InlineRow, the same label column), the choices wrapping in the value column.
  if(kind==='live2d')return outfit.live2d?h('div',{className:'ap-map-panel',role:'group','aria-label':'Live2D'},
    ['expression','motion'].map(field=>{const list=names?.[field==='expression'?'expressions':'motions'],value=field==='expression'?live2dExpression(live):live2dMotion(live);
      // 开场动作, the import sheet's name for the one-shot motion.
      return h(InlineRow,{key:field,label:field==='expression'?'表情':'开场动作',className:'ap-map-prop'},
        list?h('div',{className:'ap-map-choices',role:'group','aria-label':row.label+(field==='expression'?'表情':'开场动作')},list.map(n=>choice(value===n,n,()=>setLive(field,value===n?'':n),n))):
          h(CommitInput,{'aria-label':row.label+(field==='expression'?'表情':'开场动作'),value,maxLength:160,onCommit:v=>setLive(field,v.trim())}));})):null;
  if(kind==='spine')return outfit.spine?h(SpineEmotionMap,{binding,pack,outfit,row,writeOutfit}):null;
  // the roster already owns this emotion's picture and upload/generate actions.
  if(kind==='sprite')return null;
  // the 头像's upload / crop / ✦ / delete are its tile's menu — no separate 对白头像 row here.
  return null;
}
// the asset actions of the preview card — quiet translucent discs on its
// top-right edge, the zoom cluster's language (the mood chip keeps the top-left). Each action: {icon, label, onClick}
// or {icon, label, file: {folder?, onFiles}} (a disc that opens a hidden file input beside it, out of the tab order).
// `blocked`: shown but unavailable (aria-disabled, so it keeps its tooltip and stays reachable), the reason as tooltip.
function PreviewFileTool({action,disabled}) {
  const input=React.useRef(null),onFiles=files=>{if(files.length)action.file.onFiles(files);};
  return h(React.Fragment,null,h('button',{type:'button',className:'ap-view-tool','aria-label':action.label,title:action.label,disabled,onClick:()=>input.current?.click?.()},h(Glyph,{name:action.icon})),
    h('input',{ref:input,type:'file',tabIndex:-1,'aria-hidden':true,'data-for':action.label,disabled,...(action.file.folder?{multiple:true,webkitdirectory:''}:{accept:'image/png,image/webp,image/jpeg'}),
      onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';onFiles(action.file.folder?files:files.slice(0,1));}}));
}
function PreviewActions({actions,disabled}) {
  // a blocked action that knows how to explain itself (the gated ✦) leaves one ⚠ line
  // on the card when clicked; `genState` marks a request in flight / waiting / failed on the ✦ itself.
  const [note,say]=useGenNote();
  if(!actions.length)return null;
  const marks=a=>a.genState==='candidate'?h('span',{className:'ap-gen-dot','aria-hidden':true}):a.genState==='failed'?h('span',{className:'ap-gen-flag','aria-hidden':true},h(Glyph,{name:'warning'})):null;
  return h(React.Fragment,null,h('div',{className:'ap-preview-actions',role:'toolbar','aria-label':'素材操作'},actions.map(a=>a.blocked?
    h('button',{key:a.label,type:'button',className:'ap-view-tool','aria-label':a.label,'aria-disabled':true,title:a.blocked,onClick:e=>{e.preventDefault();if(a.explain)say(a.blocked);}},h(Glyph,{name:a.icon})):
    a.file?h(PreviewFileTool,{key:a.label,action:a,disabled}):
    h('button',{key:a.label,type:'button',className:'ap-view-tool','aria-label':a.label,title:a.title||a.label,disabled,'data-gen-state':a.genState,onClick:()=>{say('');a.onClick();}},
      a.genState==='running'?h(Spinner,{key:'gen',fill:true}):h(Glyph,{name:a.icon}),marks(a)))),
    h(GenGateNote,{text:note,className:'is-card'}));
}
// the 差分 header's ⋯ holds only what the preview card does not — 「设为默认外观」
// for the view on show (checked when it already is the figure's default, figure.appearance; Live2D when unset) and the
// view's batch requests (tile menus: per-差分 actions are on the tiles). One ⋯ in all three views, so the header row never changes shape.
// Named apart from the pack modal's 「更多」 KindMenu: both are declared in the same factory scope, and in r5 this one
// (declared later) replaced it, so opening 「更多」 rendered it without `actions` (「actions is not iterable」).
// only what concerns the whole view or the 差分 list — the picked 差分's own
// picture is its tile's menu (no 「清除上传的头像」 here); destructive items sit after a separator and name what they delete.
function FigureViewMenu({kind,isDefault,onDefault,extras=[],disabled}) {
  const view={live2d:'Live2D',spine:'Spine',sprite:'立绘',avatar:'头像'}[kind],name=(isModelKind(kind)?'模型':view)+' 操作';
  return h(Popover,{label:name,className:'ap-kind-menu-anchor',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:name,'aria-expanded':open,disabled,onClick:toggle}),
    content:close=>h(React.Fragment,null,
      h('button',{type:'button',role:'menuitemradio','aria-checked':isDefault,className:'ap-menu-item ap-default-look',title:isDefault?'舞台上默认用「'+view+'」显示这个人物':'舞台上默认改用「'+view+'」显示这个人物（缺少时依次退到立绘、头像）',
          onClick:()=>{close();if(!isDefault)onDefault();}},h('span',null,'设为默认外观'),isDefault&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))),
      // (variable bindings ui follow-up) an extra that does not apply right now stays listed, disabled, its reason as tooltip.
      extras.map((a,i)=>[a.danger&&!extras[i-1]?.danger&&h('div',{key:a.label+':sep',className:'ap-menu-sep',role:'separator'}),
        a.blocked?h(MenuItem,{key:a.label,disabled:true,danger:a.danger,title:a.blocked},h(Glyph,{name:a.icon}),h('span',null,a.menu||a.label)):
        h(MenuItem,{key:a.label,danger:a.danger,title:a.title,onClick:()=>{close();a.onClick();}},h(Glyph,{name:a.icon}),h('span',null,a.menu||a.label))]))});
}
// ---------- 调整图片 (v3.1, UI comment 8) ----------
// The framer between picking a file and uploading it: an avatar frame is square, a sprite frame keeps the picture's own
// ratio (zooming in trims it). Drag to move; wheel, pinch, ± or the keyboard (arrows, + / -, 0) to zoom 100–400%. The
// crop is a fraction of the largest frame-shaped region (`x`, `y` in −1…1 across the slack), so it never depends on the
// frame's on-screen size. Unchanged → the original file is uploaded as is; otherwise a canvas re-encodes the region
// (WebP keeps transparency; avatars at most 1024 px).
const FRAME_MAX_ZOOM=4;
// `start` ({x, y, w, h} fractions of the picture) opens on that region — 「从立绘裁切…」
// starts on the 立绘's head crop (spriteCropFor) instead of the whole picture.
function ImageFramer({file,square,start=null,onCancel,onDone}) {
  const [url,setUrl]=React.useState(null),[size,setSize]=React.useState(null),[view,setView]=React.useState({s:1,x:0,y:0}),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const frameRef=React.useRef(null),imgRef=React.useRef(null),drag=React.useRef(null),pointers=React.useRef(new Map());
  React.useEffect(()=>{let u=null;try{u=URL.createObjectURL(file);}catch(_){setError('无法读取这张图片');return;}setUrl(u);return()=>URL.revokeObjectURL?.(u);},[file]);
  const W=size?.w,H=size?.h,A=square?1:size?W/H:1,baseW=size?Math.min(W,H*A):1,baseH=baseW/A;
  const region=v=>{const w=baseW/v.s,h=baseH/v.s;return {w,h,x:(W-w)/2*(1-v.x),y:(H-h)/2*(1-v.y)};};
  const crop=size?region(view):null;
  const clampView=v=>({s:Math.min(FRAME_MAX_ZOOM,Math.max(1,v.s)),x:Math.max(-1,Math.min(1,v.x)),y:Math.max(-1,Math.min(1,v.y))});
  const zoom=f=>setView(v=>clampView({...v,s:v.s*f}));
  React.useEffect(()=>{const el=frameRef.current;if(!el||!size)return;const wheel=e=>{e.preventDefault();zoom(Math.exp(-Math.max(-60,Math.min(60,e.deltaY))*0.004));};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[size]);
  const pan=(v,dx,dy)=>{const box=frameRef.current?.getBoundingClientRect?.(),r=region(v),k=box&&box.width?box.width/r.w:1;
    return clampView({...v,x:W-r.w>0.5?v.x+2*dx/((W-r.w)*k):0,y:H-r.h>0.5?v.y+2*dy/((H-r.h)*k):0});};
  const down=e=>{if(!size||e.button>0)return;e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const list=[...pointers.current.values()];
    drag.current=list.length>=2?{pinch:Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y)||1,view}:{x:e.clientX,y:e.clientY,view};};
  const move=e=>{const d=drag.current;if(!d||!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(d.pinch){const list=[...pointers.current.values()];if(list.length<2)return;setView(clampView({...d.view,s:d.view.s*(Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y)||1)/d.pinch}));return;}
    setView(pan(d.view,e.clientX-d.x,e.clientY-d.y));};
  const up=e=>{pointers.current.delete(e.pointerId);if(!pointers.current.size)drag.current=null;else{const [p]=pointers.current.values();drag.current={x:p.x,y:p.y,view};}};
  const key=e=>{if(!size)return;const moves={ArrowLeft:[24,0],ArrowRight:[-24,0],ArrowUp:[0,24],ArrowDown:[0,-24]};
    if(moves[e.key]){e.preventDefault();setView(v=>pan(v,moves[e.key][0],moves[e.key][1]));}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}else if(e.key==='-'||e.key==='_'){e.preventDefault();zoom(0.8);}else if(e.key==='0'||e.key==='Home'){e.preventDefault();setView({s:1,x:0,y:0});}};
  React.useEffect(()=>{if(!size||!start)return;const side=Math.sqrt(start.w*W*start.h*H),s=Math.min(FRAME_MAX_ZOOM,Math.max(1,baseW/side)),w=baseW/s,hh=baseH/s;
    const at=(full,part,from)=>full-part>0.5?1-2*Math.max(0,Math.min(full-part,from-part/2))/(full-part):0;
    setView(clampView({s,x:at(W,w,(start.x+start.w/2)*W),y:at(H,hh,(start.y+start.h/2)*H)}));},[size]);
  const moved=view.s!==1||view.x!==0||view.y!==0,changed=!!size&&(moved||Math.abs(W/H-A)>0.005);
  async function done(){
    if(!changed)return onDone(file);
    setBusy(true);setError('');
    try{
      const scale=square?Math.min(1,1024/crop.w):1,outW=Math.max(1,Math.round(crop.w*scale)),outH=Math.max(1,Math.round(crop.h*scale));
      const c=document.createElement('canvas');c.width=outW;c.height=outH;c.getContext('2d').drawImage(imgRef.current,crop.x,crop.y,crop.w,crop.h,0,0,outW,outH);
      let blob=await new Promise(r=>c.toBlob(r,'image/webp',0.95)),ext='webp';
      if(!blob||blob.type!=='image/webp'){blob=await new Promise(r=>c.toBlob(r,'image/png'));ext='png';}
      if(!blob)throw new Error('无法处理这张图片');
      onDone(new File([blob],fileStem(file.name)+'.'+ext,{type:'image/'+ext}));
    }catch(e){setError(errorText(e));setBusy(false);}
  }
  const pct=v=>(100*v).toFixed(3)+'%';
  return h('div',{className:'ap-framer'},
    h('div',{className:'ap-framer-stage'},
      h('div',{ref:frameRef,className:'ap-framer-frame','data-shape':square?'square':'free',style:{'--frame-a':String(A)},tabIndex:0,role:'group','aria-label':'调整图片：拖动移动，滚轮或 + / - 缩放，0 复位',
          onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up,onKeyDown:key},
        url&&h('img',{ref:imgRef,src:url,alt:'',draggable:false,onLoad:e=>{const img=e.currentTarget;setSize({w:img.naturalWidth,h:img.naturalHeight});},onError:()=>setError('无法读取这张图片'),
          style:crop?{width:pct(W/crop.w),height:pct(H/crop.h),left:pct(-crop.x/crop.w),top:pct(-crop.y/crop.h)}:{visibility:'hidden'}}),
        !size&&!error&&h(Spinner,{key:'framer',fill:true}))),
    h('div',{className:'ap-framer-tools'},
      h(IconButton,{icon:'minus',label:'缩小',disabled:!size||view.s<=1,onClick:()=>zoom(0.8)}),
      h('output',{className:'ap-framer-zoom','aria-live':'polite'},Math.round(view.s*100)+'%'),
      h(IconButton,{icon:'plus',label:'放大',disabled:!size||view.s>=FRAME_MAX_ZOOM,onClick:()=>zoom(1.25)}),
      // 复位 is an icon button like 缩小 / 放大 (was a chip button).
      h(IconButton,{icon:'reset',label:'复位',disabled:!moved,onClick:()=>setView({s:1,x:0,y:0})})),
    error&&h('p',{className:'ap-alert',role:'alert'},error),
    h(Actions,null,h(Button,{disabled:busy,onClick:onCancel},'取消'),h(Button,{primary:true,disabled:busy||!size,onClick:done},busy?'正在处理…':'使用这张')));
}
// 差分: a roster of faces in the fixed order (平和 first with its 默认 mark — r4: 「默认」, the emotion shown when no other applies; was 「休息」 —, then the built-ins, then the figure's own),
// like a game's character roster. A face is the selected outfit's variant of the asset on show (Live2D expression, 立绘
// head, 头像) for that emotion; unmapped ones show 平和 greyed with a dashed ring, nothing at all is the silhouette, and
// both carry the upload badge where the asset takes a picture (v3.1). Clicking one previews it and expands just that emotion under the roster: the figure's
// 使用情景 and this outfit's media (expression / motion / sprite / uploads / crop). Clicking it again folds it.
const NEW_EMOTION=':new';
// the figure's per-差分 text (data key `guidance`, unchanged) reads
// 「使用情景」: it tells the AI when to use the 差分, so an empty one shows a situation as its placeholder (never helper text).
const guidanceExample=()=> '例：什么时候用这个差分';
const USAGE_HELP='告诉 AI 什么时候用这个差分，例如「被夸奖时」，留空就不发送。';
// the selected outfit's own 「使用情景」 (data key `guidance`, ≤ 80 字) — the
// 差分 row's field and (?) style; it goes to the director with the outfit, so the director knows when to switch to it.
const OUTFIT_USAGE_HELP='告诉导演什么时候换上这套服装，例如「在中转站工作时」，留空就不发送。';
// no title and no heading row — the roster already shows which 差分 is open.
// The open 差分 is inline 「label value」 rows (InlineField): 名称 (a custom
// 差分 only — the old title input), 使用情景 (multi-line, wrapping in the value column, borderless, edited on click), then
// the asset's media rows. Fold is a quiet icon at the end of the first row.
// no action line — 设为默认外观 is in the 差分 heading's ⋯; deleting the 差分
// (「删除差分…」) and its picture (「删除这张…」) are the tile's menu.
// the selected tile's request line comes first (待采用 / 生成中 / 生图失败 with its actions,
// GenCellStatus), and 「回退」 (owner U3) follows 使用情景 — one InlineField menu, every view alike.
function EmotionDetail({row,validName,save,onClose,media,stand=null,status=null}) {
  return h('div',{className:'ap-selection-detail ap-emotion-detail',role:'group','aria-label':row.label+'设置'},
    h('div',{className:'ap-emotion-fields'},
      status,
      h(InlineField,{kind:'text',label:'名称',controlLabel:row.label+'名称',className:'is-name',value:row.label,maxLength:4,validate:v=>validName(v,row.id),onCommit:v=>save(row.id,{label:v})}),
      h(InlineField,{kind:'text',multiline:true,label:'使用情景',controlLabel:row.label+'使用情景',help:h(Help,{text:USAGE_HELP,label:'使用情景 说明'}),className:'is-usage',
        value:row.guidance||'',placeholder:guidanceExample(row),maxLength:60,validate:v=>v.length<=60?'':'使用情景最多 60 字',onCommit:v=>save(row.id,{guidance:v})}),
      stand&&h(InlineField,{kind:'menu',label:'回退',controlLabel:row.label+'回退',help:h(Help,{text:STAND_HELP,label:'回退 说明'}),className:'is-stand',
        value:stand.value,options:stand.options,onCommit:stand.onCommit}),
      media),
    h('span',{className:'ap-emotion-tools'},
      h(IconButton,{icon:'close',label:'收起 '+row.label,onClick:onClose})));
}
// The 服装 heading's ⋯ (figure select): 「删除…」 enters the grid's delete mode. Same menu as the 差分 heading's ⋯.
// an outfit ×
// 差分 without its own picture is 'missing' (缺图: the stage falls back with a warning) or 'fallback' (缺图时用: a chosen
// 差分 stands in silently — outfit.fallbackEmotions + fallbackTo, set from the tile menu's 「设置回退 ›」 or the detail's
// 「回退」 field through setFigureEmotionFallback); 'covered' is a stale mark under a real picture (the picture wins).
// The corner ⚠ 「不需要」 disc is gone: one way to say it, with the stand-in named.
const FALLBACK_STATES={has:'有图',missing:'缺图',fallback:'回退',covered:'有图'};
const STAND_HELP='这套服装缺这个差分的图时，舞台上改用哪个差分的图；选「无回退」则用默认差分并提示缺图。';
// The 「回退」 choices of one 差分: '' (无回退), the default 差分, or any other declared 差分 (Live2D, 立绘 and 头像 alike).
function standInValue(outfit,id){return outfit?.fallbackEmotions?.includes(id)?outfit.fallbackTo?.[id]||outfit.defaultEmotion:'';}
function standInOptions(outfit,rows,id){
  return [{value:'',label:'无回退'},...rows.filter(r=>r.id!==id).sort((a,b)=>(b.id===outfit.defaultEmotion)-(a.id===outfit.defaultEmotion)).map(r=>({value:r.id,label:'回退为「'+r.label+'」'}))];
}
function OutfitMenu({count,disabled,onDelete}) {
  return h(Popover,{label:'服装操作',className:'ap-kind-menu-anchor ap-outfit-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'服装操作','aria-expanded':open,disabled,onClick:toggle}),
    content:close=>h(MenuItem,{danger:true,disabled:!count,title:count?undefined:'还没有服装',onClick:()=>{close();onDelete();}},h(Glyph,{name:'remove'}),h('span',null,'删除服装…'))});
}
// Author-only candidates; changing the preview or retiring a member never changes committed chat images.
function FigureStateImages({binding,pack,figure,outfit,manifest,state,writeOutfit,upload,uploadAvatar,confirm:confirmRetirement}) {
  const input=React.useRef(null),avatarInput=React.useRef(null),avatarImage=React.useRef(null),pool=outfit.sprite.imagePools[state.id];
  const update=make=>writeOutfit(o=>{
    const current=o.sprite.imagePools[state.id];
    if(!current)throw new Error('差分候选已变化，请刷新');
    return {...o,sprite:{...o.sprite,imagePools:{...o.sprite.imagePools,[state.id]:make(current)}}};
  });
  return h('section',{className:'ap-fe-section','aria-label':state.label+'候选图片'},
    h('h4',{className:'ap-sub'},state.label+' · 图片',h('span',null,pool?.imageIds.length||0)),
    h('p',null,'同一意义的图片；上传会追加，不新增差分。预览图只用于首次进入服装，已提交的聊天画面不变。'),
    h('div',{className:'ap-emotion-roster'},...(pool?.imageIds||[]).map((id,index)=>{
      const selected=pool.defaultImageId===id,bust=stateBust(outfit,spriteEmotionState(manifest,id));
      return h('div',{key:id,className:'ap-emotion-cell','data-selected':selected||undefined},
        h('button',{className:'ap-face',type:'button','aria-label':'图片 '+(index+1)+(selected?'，预览图':'，设为预览图'),onClick:()=>update(p=>{if(!p.imageIds.includes(id))throw new Error('图片已退出候选');return {...p,defaultImageId:id};})},
          h('span',{className:'ap-face-art'},bust&&h(BustArt,{binding,packId:pack.manifest.id,bust,figure,frame:CAST_FACE})),h('span',{className:'ap-face-name'},selected?'预览图':'图片 '+(index+1))),
        uploadAvatar&&h(Button,{onClick:()=>{avatarImage.current=id;avatarInput.current?.click();}},'上传头像'),
        h(Button,{disabled:pool.imageIds.length<2,onClick:()=>confirmRetirement({title:'让这张图片退出候选？',body:'历史聊天和逐图头像、嘴型及校准保留；今后重入差分不再选这张图。',confirmLabel:'退出候选',onConfirm:()=>update(p=>{const imageIds=p.imageIds.filter(value=>value!==id);if(!imageIds.length)throw new Error('至少保留一张候选图');return {imageIds,defaultImageId:p.defaultImageId===id?imageIds[0]:p.defaultImageId};})})},'退出候选'));
    })),
    uploadAvatar&&h('input',{ref:avatarInput,type:'file',accept:'image/png,image/webp,image/jpeg',hidden:true,onChange:event=>{const file=event.target.files?.[0];event.target.value='';if(file)uploadAvatar(file,avatarImage.current);}}),
    upload&&h(Button,{onClick:()=>input.current?.click()},'添加同义图片'),
    upload&&h('input',{ref:input,type:'file',accept:'image/png,image/webp,image/jpeg',hidden:true,onChange:event=>{const file=event.target.files?.[0];event.target.value='';if(file)upload(file);}}));
}
function FigureEmotions({binding,pack,figure,outfit,manifest,rows,faces,selected,onSelect,write,writeOutfit,upload,pick,layered=false,onGen,kind,setKind,kindMenu,genTools=null,notices=null,menuFor=null,statusFor=null,createCustom,addExisting,aimNew,onFallback=null}) {
  const [open,setOpen]=React.useState(null),[name,setName]=React.useState(''),[error,setError]=React.useState(''),[customFile,setCustomFile]=React.useState(null),[menuPage,setMenuPage]=React.useState('');
  const single=figure.emotions?.length===1 && figure.emotions[0].label===undefined;
  const singleId=single?figure.emotions[0].id:null;
  const validName=(value,id)=>{const v=value.trim();return !v||[...v].length>4?'名称需为 1–4 字':figureEditorEmotions(figure).some(row=>row.id!==id&&[row.id,row.label.toLowerCase()].includes(v.toLowerCase()))?'差分名称重复':'';};
  const save=(id,patch)=>write(f=>{const list=f.emotions||[],old=list.find(e=>e.id===id)||{id},next={...old,...patch};if(!next.guidance)delete next.guidance;return {emotions:list.map(row=>row.id===id?next:row)};});
  const reset=()=>{setName('');setError('');setCustomFile(null);};
  // a 差分 belongs to the outfit that declares it (outfitEmotionRows), in every view — so it is
  // always added with its 立绘 (a bare name would vanish from this outfit's list).
  // ＋ takes a typed name only. A name the figure already resolves (the
  // shared names of the built-in keys, or one of its own 差分) adds that 差分 to this outfit under its existing key
  // (addExisting: the same upload as filling a missing slot); a new name declares a new 差分 (createCustom).
  const known=label=>!single&&figureEditorEmotions(figure).find(row=>row.label===label||row.id===label.toLowerCase());
  const newProblem=label=>{if(!label||[...label].length>4)return '名称需为 1–4 字';const k=known(label);if(k)return rows.some(r=>r.id===k.id)?'这套服装已有这个差分':'';
    return '';};
  // ✦: no picture yet — 「生图」 aimed at the typed name (its existing key, or a new 差分 declared on the figure first).
  function aim(){const label=name.trim(),problem=newProblem(label);setError(problem);if(problem)return;
    if(single)return save(singleId,{label}).then(()=>{reset();setOpen(null);onGen?.dialog?.('sprite',singleId,'gen');}).catch(e=>setError(errorText(e)));
    const k=known(label),id=k?k.id:newResourceKey('e').slice(0,24);
    return aimNew(id,k?null:label).then(()=>{reset();setOpen(null);}).catch(e=>setError(errorText(e)));}
  function add(){const label=name.trim(),problem=newProblem(label);setError(problem);if(problem)return;
    if(single)return save(singleId,{label}).then(()=>customFile?addExisting(singleId,customFile):null).then(()=>{reset();setOpen(singleId);onSelect(singleId);}).catch(e=>setError(errorText(e)));
    const k=known(label),id=k?k.id:newResourceKey('e').slice(0,24);
    return (!customFile?aimNew(id,k?null:label,false):k?addExisting(id,customFile):createCustom({id,label},customFile)).then(()=>{reset();setOpen(id);onSelect(id);}).catch(e=>setError(errorText(e)));}
  const toggle=id=>{onSelect(id);setOpen(open===id?null:id);};
  const row=rows.find(r=>r.id===open);
  // 模型 is one model per outfit: without one, the roster's place is one short phrase (its 「导入模型」 is in the heading).
  const liveEmpty=isModelKind(kind)&&!!outfit&&!outfit.live2d&&!outfit.spine;
  // the ? says 使用情景 (the opened 差分's text).
  // the heading row is 「差分 N (?)」 with the ⋯ (or the delete mode's
  // 「已选 N」 · 取消 · 删除) at its right end, on PC and phone alike; the 模型 / 立绘 / 头像 switch is its own full-width row below.
  // the heading's tools carry the generation state of the view — 「✦ 生成缺失立绘」 / 「✦ 生成缺失头像」, 「生成中 a/b ·
  // 停止」 or 「N 张待采用 · 全部采用」 (genTools) — before the ⋯; the 模型 view puts 「导入模型」 there (model tab).
  const head=h(React.Fragment,null,h('h4',{className:'ap-sub ap-emotion-head'},single?'无差分':'差分',!single&&h('span',null,rows.length),h(Help,{text:'人物的所有服装共用一张差分名单，模型、立绘、头像各自制作。右键格子（手机上点一下）打开菜单：生成、重画、上传、删除、设置回退。',label:'差分 说明'}),
    outfit&&(kindMenu||genTools)&&h('span',{className:'ap-sub-tools'},genTools,kindMenu)),
    outfit&&h('div',{className:'ap-asset-kind-row'},h(AssetKindSwitch,{kind,outfit,onChange:k=>{setKind(k);}})),upload.lines,notices);
  // Escape folds the open emotion (from its face or inside it) before it would close the modal.
  return h('section',{className:'ap-fe-section','aria-label':'人物差分','data-asset':kind,onKeyDown:e=>{if(e.key!=='Escape'||e.defaultPrevented)return;
      if(open!==null){e.stopPropagation();reset();setOpen(null);}}},head,
    // no model = the empty phrase (R18); the heading's 「导入模型」 adds one.
    liveEmpty?h(EmptyState,{compact:true,noun:'模型'}):
    single?h('div',null,h(CatAddTile,{label:'添加差分',onClick:()=>{reset();setOpen(NEW_EMOTION);}})):
    h('div',{className:'ap-emotion-roster',role:'list'},
      // a missing slot is the same in every view — the dashed tile with a ✦
      // (SlotMissing). in 立绘 / 头像 a tile is the trigger of its own menu (right click
      // or Shift+F10; a tap on touch — cellMenuTrigger: 生成… / 重画… / 改图… / 上传 / 设置回退 › / 删除…, by its state — menuFor), and a request runs in the tile
      // itself: a ring and the time, 「排队」, the candidate with its dot and 「待采用」, ⚠ (GenFaceMarks). A 差分 the outfit
      // lets another stand in for (回退) shows that picture dimmed with ↩ and its name; a real picture always wins.
      rows.map(r=>{const face=faces[r.id]||{},isDefault=!!outfit&&r.id===outfit.defaultEmotion,marked=!!outfit&&!isDefault&&!!outfit.fallbackEmotions?.includes(r.id);
        const cell=face.cell,state=cell?.state||'idle',candidate=state==='candidate',gap=!!outfit&&!face.mapped&&!candidate;
        const missing=gap&&(!marked||state!=='idle'),fallback=gap&&marked&&state==='idle',use=fallback?outfit.fallbackTo?.[r.id]||outfit.defaultEmotion:null,useRow=use&&rows.find(x=>x.id===use);
        const fbState=!outfit?null:face.mapped?(marked?'covered':'has'):marked?'fallback':'missing';
        // A failed request says why on hover (「生图失败：<reason>」) instead of 「缺图」.
        const said=isDefault||!fbState||fbState==='has'||fbState==='covered'||state==='failed'?'':fbState==='fallback'?'回退为「'+(useRow?.label||'')+'」':'缺图',busy=state==='failed'?genFailText(cell.error):state!=='idle'?GEN_CELL_WORDS[state]:'';
        const tip=[r.label,said,busy].filter(Boolean).join(' · ');
        // one colour for every 差分 tile — the theme accent (no per-差分 rings).
        // no 「默认」 badge on 平和 (always the fallback, nothing to choose).
        const menu=!!menuFor&&!!outfit;
        const faceProps={'aria-expanded':menu?undefined:open===r.id,'aria-pressed':selected===r.id,title:tip,onClick:()=>toggle(r.id)};
        const art=h('span',{className:'ap-face-art'},candidate?h(GenFaceCandidate,{gen:onGen.gen,cell,kind}):missing?h(SlotMissing,{mark:state==='idle'}):
            fallback?h('span',{className:'ap-face-fallback-art'},faces[use]?.art||null):face.art||h('span',{className:'ap-art-missing'}),
          cell&&h(GenFaceMarks,{cell}),fallback&&useRow&&h('span',{className:'ap-face-use'},h(Glyph,{name:'fallback'}),h('span',null,useRow.label)));
        const button=extra=>h('button',{type:'button',className:'ap-face','aria-label':r.label,'aria-description':[said,busy].filter(Boolean).join(' · ')||undefined,
          'data-missing':missing||undefined,'data-fallback':fallback||undefined,'data-gen':state!=='idle'?state:undefined,'data-empty':!missing&&!fallback&&!candidate&&!face.art||undefined,...faceProps,...extra},art,h('span',{className:'ap-face-name'},r.label));
        return h('div',{key:r.id,role:'listitem',className:'ap-emotion-cell','data-selected':selected===r.id||undefined,'data-fallback-state':fbState||undefined,'data-gen-state':state!=='idle'?state:undefined},
          menu?h(Popover,{label:r.label+(isModelKind(kind)?'模型':kind==='avatar'?'头像':'立绘')+' 操作',className:'ap-face-menu-anchor',float:true,fit:true,limit:460,
            // a tap opens the menu; a mouse click selects the 差分 (its
            // preview and detail, like a tile of any grid) and the menu is on right click / Shift+F10 (cellMenuTrigger).
            trigger:({toggle:flipMenu,open:menuOpen})=>button(cellMenuTrigger({open:menuOpen,toggle:flipMenu,onPrimary:()=>{onSelect(r.id);setOpen(r.id);},
              onMenu:()=>{onSelect(r.id);setOpen(r.id);setMenuPage('');}})),
            content:close=>menuFor(r,close,menuPage,setMenuPage)}):button({}));}),
      createCustom&&h('div',{role:'listitem',className:'ap-emotion-cell'},
        h('button',{type:'button',className:'ap-face-add','aria-label':'添加差分','aria-expanded':open===NEW_EMOTION,title:'添加差分',onClick:()=>{reset();setOpen(open===NEW_EMOTION?null:NEW_EMOTION);}},
          h('span',{className:'ap-face-art'},h(Glyph,{name:'plus'}))))),
    open===NEW_EMOTION&&h('div',{className:'ap-selection-detail ap-emotion-new',role:'group','aria-label':'新差分'},
      h('div',{className:'ap-fe-line'},h('span',{className:'ap-fe-key'},'新差分'),
        h('div',{className:'ap-fe-value'},
          // InlineAdd's box (opened by the ＋ tile); Enter adds, Esc cancels.
          h(InlineAdd,{open:true,bare:true,inputClassName:'ap-emotion-new-name',label:'新差分名称',value:name,maxLength:4,invalid:!!error,onChange:v=>{setName(v);setError('');},onConfirm:()=>{add();},onCancel:()=>{reset();setOpen(null);}}),
          h('input',{type:'file',accept:'image/png,image/webp,image/jpeg','aria-label':'新差分立绘',onChange:e=>setCustomFile(e.target.files?.[0]||null)}),
          h(Button,{className:'ap-emotion-add',onClick:add},'添加差分'), // a quiet text button
          onGen?.dialog&&aimNew&&h(IconButton,{icon:'spark',label:'生成这个差分的立绘',onClick:aim}),h(IconButton,{icon:'close',label:'取消添加',onClick:()=>{reset();setOpen(null);}}))),
      error&&h('p',{className:'ap-field-error',role:'alert'},error)),
    !single&&!liveEmpty&&row&&h(EmotionDetail,{key:row.id,row,validName,save,onClose:()=>setOpen(null),
      // 「回退」 — which 差分 stands in while this outfit has no picture of it.
      stand:outfit&&onFallback&&row.id!==outfit.defaultEmotion?{value:standInValue(outfit,row.id),options:standInOptions(outfit,rows,row.id),
        onCommit:v=>onFallback(row.id,!!v,v&&v!==outfit.defaultEmotion?v:undefined)}:null,
      status:statusFor?.(row),
      media:outfit&&h(EmotionMedia,{key:outfit.key+':'+kind,kind,binding,pack,figure,outfit,manifest,row,writeOutfit,upload,pick,layered,onGen})}));
}
// ---------- The preview card (v3.1, UI comment 1 / 3) ----------
// A card sized by its column (desktop: the page's visible height, v3.1 r2 — CSS only), never by the picture. A still is
// first trimmed to its drawn pixels (the alpha bounds, measured once per picture on a canvas of at most 160px, plus a 2%
// margin, cached by URL) so the figure — not the canvas margin — is framed, and it stands on the card's floor; the
// framing itself is figureFit below (r4: height first, not contain). The calibrated anatomy is not used for this: its
// figureTop is the face, not the hair (that is what cut the head). An opaque or unreadable picture is shown whole.
const inkCache=new Map();
function pictureInk(img) {
  const key=img.currentSrc||img.src;if(inkCache.has(key))return inkCache.get(key);
  let ink={left:0,top:0,right:1,bottom:1};
  try{
    const k=Math.min(1,160/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*k)),hgt=Math.max(1,Math.round(img.naturalHeight*k));
    const c=document.createElement('canvas');c.width=w;c.height=hgt;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,w,hgt);
    const data=g.getImageData(0,0,w,hgt).data;let x0=w,y0=hgt,x1=-1,y1=-1;
    for(let y=0;y<hgt;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>16){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
    // `cut`: the drawing runs into the canvas's bottom edge (a bust / half-body sprite, or a figure cropped at the knees).
    if(x1>=x0&&y1>=y0){const m=0.02;ink={left:Math.max(0,x0/w-m),top:Math.max(0,y0/hgt-m),right:Math.min(1,(x1+1)/w+m),bottom:Math.min(1,(y1+1)/hgt+m),cut:(y1+1)/hgt>=0.985};}
  }catch(_){}
  if(inkCache.size>200)inkCache.delete(inkCache.keys().next().value);
  inkCache.set(key,ink);return ink;
}
// ---------- Default framing (figure-editor r4) ----------
// One deterministic rule for every sprite, on its opaque bounding box (never the canvas), computed once per picture
// (pictureInk is cached) and applied by CSS against the card's live size. Inputs: the drawn aspect a = ink width / ink
// height (px), whether the drawing is cut by the canvas's bottom edge, the figure's declared height (cm), its head share
// (head ÷ figure height, calibrated anatomy only) and the ink's natural height in px. Output:
//   share  — the figure's height on the card (1 = the full card; r7: no headroom, the controls float). A declared height
//            counts against a 160 cm adult (clamped 0.6–1: a 120 cm chibi stands at 0.75); without one, a chibi /
//            SD build (head ≥ 0.28 of the figure, ≈ 3.5 heads or fewer) stands at 0.78; anything else at 1.
//   spill  — how wide the drawing may be against the card (1 = exactly the card's width): 1.5 (a quarter cropped each
//            side) for a ≤ 0.7 aspect — normal, tall / slim, long robes; easing linearly to 1 at a ≥ 1.1 — wings, capes,
//            props, seated poses, mascots: the wider, the less is cropped, and landscape / lying / group sprites fit
//            whole. A drawing cut by the bottom edge (bust, half-body) always spills 1.5: it fills the height. A small
//            figure (share ≤ 0.8 — ≤ 128 cm declared — or a chibi / SD build) never spills (r4b): it is shown whole at its
//            smaller height, so a wide chibi (big tail, spread arms) is not blown up to crop at the sides — even when
//            its feet touch the canvas edge (a tightly cropped full body reads as `cut`; small wins).
//   maxPx  — crispness: never more than 2× the ink's own pixels (a tiny source stays small instead of blurring).
// Displayed height = min(share × card height, spill × card width ÷ a, maxPx); width = height × a; standing on the floor,
// centred on the ink box. The user zooms / pans from there. figureBox mirrors the CSS for tests.
const FIGURE_FIT={refCm:160,minShare:0.6,chibiHead:0.28,chibiShare:0.78,smallShare:0.8,spillMax:1.5,spillFrom:0.7,spillTo:1.1,maxUpscale:2};
function figureFit({aspect,cut=false,heightCm,headShare,inkPx}={}) {
  const F=FIGURE_FIT,a=aspect>0&&Number.isFinite(aspect)?aspect:0.5,cm=Number(heightCm);
  const share=cm>0?Math.min(1,Math.max(F.minShare,cm/F.refCm)):headShare>=F.chibiHead?F.chibiShare:1;
  const small=share<=F.smallShare||headShare>=F.chibiHead;
  const spill=small?1:cut?F.spillMax:F.spillMax-(F.spillMax-1)*Math.min(1,Math.max(0,(a-F.spillFrom)/(F.spillTo-F.spillFrom)));
  return {share,spill:+spill.toFixed(4),maxPx:inkPx>0?Math.round(inkPx*F.maxUpscale):null};
}
function figureBox(fit,aspect,W,H) {
  const height=Math.min(fit.share*H,fit.spill*W/aspect,fit.maxPx??Infinity),width=height*aspect;
  return {width,height,cropEachSide:Math.max(0,(width-W)/2/W),heightShare:height/H};
}
// The head share of a calibrated anatomy (an estimated / derived head says nothing about the build).
function anatomyHeadShare(a) {
  if(!a||a.source==='estimated'||!(a.chin>a.headTop))return undefined;
  const feet=Number.isFinite(a.feet)?a.feet:a.visibleBottom,top=Number.isFinite(a.figureTop)?Math.min(a.figureTop,a.headTop):a.headTop;
  return feet>top?(a.chin-a.headTop)/(feet-top):undefined;
}
// end figureFit
// `overlay(style)` (optional): an element laid exactly over the picture (same box), e.g. the talking mouth (SpriteMouth).
function StandArt({binding,packId,hash,label,heightCm,headShare,overlay}) {
  const {url,failed,broken}=useStillPicture(binding,packId,hash),[fit,setFit]=React.useState(null),ready=!!url&&fit?.url===url;
  if(failed)return h('span',{className:'ap-stand ap-stand-missing',role:'img','aria-label':label+'：图片未能载入',title:'图片未能载入'},h(Glyph,{name:'figures'}));
  const r=ready?fit.ink:{left:0,top:0,right:1,bottom:1},sw=r.right-r.left,sh=r.bottom-r.top,pct=v=>(100*v).toFixed(3)+'%',aspect=ready?fit.w*sw/(fit.h*sh):0.5;
  const rule=ready?figureFit({aspect,cut:!!r.cut,heightCm,headShare,inkPx:fit.h*sh}):null,place={left:pct(-r.left/sw),top:pct(-r.top/sh),width:pct(1/sw),height:pct(1/sh)};
  return h('span',{className:'ap-stand ap-stand-fit',role:'img','aria-label':label},
    !ready&&h(Spinner,{key:hash,fill:true}),
    url&&h('span',{className:'ap-stand-box',style:ready?{'--fit-a':aspect.toFixed(4),'--fit-share':rule.share.toFixed(3),'--fit-spill':String(rule.spill),...(rule.maxPx?{'--fit-max':rule.maxPx+'px'}:{})}:{visibility:'hidden'}},
      // the big picture decodes off the main thread (decoding async, then decode) before its
      // ink box is measured, so the measuring canvas never forces a synchronous decode of a full-size sprite.
      h(RevealImg,{src:url,alt:'',draggable:false,decoding:'async',style:place,onError:broken,
        onLoad:e=>{const img=e.currentTarget,measure=()=>setFit({url,w:img.naturalWidth,h:img.naturalHeight,ink:pictureInk(img)});
          if(typeof img.decode==='function')img.decode().then(measure,measure);else measure();}}),
      ready&&overlay?overlay(place):null));
}
// a talking 立绘's mouth while the editor plays a voice — the stage's
// own pieces end to end: the state's render inputs (packFigureRenderInputs: a layered state's atlas), the stage's
// per-frame step (layeredSpriteVoice) on forkLipSync's level of that audio element, and its painter (layeredSpritePaint). One canvas laid
// exactly over the still, hidden without a voice: the card is back at rest the moment playback ends or stops.
// The assets leased are the closure the stage leases for this state (asset-pack-presentation.js materialize).
function spriteMouthAssets(outfit,manifest,state) {
  const assets=outfit.sprite.assets||{},names=new Set();
  const collect=v=>{if(typeof v==='string'){if(Object.hasOwn(assets,v))names.add(v);}else if(v&&typeof v==='object')Object.values(v).forEach(collect);};
  if(manifest?.kind==='layered-static-sprites'){collect(state.stage);collect(state.mouthSet===undefined?manifest.mouthAtlas:manifest.mouthSets?.[state.mouthSet]);}
  else collect(state);
  return [...names];
}
function spriteMouthStage(packId,outfit,manifest,state,urls,key) {
  const view=manifest,map=v=>typeof v==='string'?urls[v]||v:Array.isArray(v)?v.map(map):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,map(x)])):v;
  return packFigureRenderInputs({alias:key,form:'sprite',manifest:view,state,spriteUrls:urls,spritePack:map(view),outfit,outfitKey:outfit.key,ref:{packId},
    geometry:{stage:key},media:{sprite:{identity:key}},views:{stage:true}},{}).stage;
}
function useHeldUrls(binding,packId,names,assets) {
  const key=names.map(n=>n+'='+assets[n]).join('\n'),[urls,setUrls]=React.useState(null);
  React.useEffect(()=>{let live=true;const held=[];setUrls(null);
    Promise.all(names.map(n=>holdMedia(binding,packId,assets[n]).then(m=>{if(live)held.push(m);else m.release();return [n,m.url];})))
      .then(list=>{if(live)setUrls(Object.fromEntries(list));},()=>{});
    return()=>{live=false;held.forEach(m=>m.release());};},[binding,packId,key]);
  return urls;
}
function SpriteMouth({binding,packId,outfit,manifest,state,audio,style}) {
  const assets=outfit.sprite.assets||{},urls=useHeldUrls(binding,packId,spriteMouthAssets(outfit,manifest,state),assets);
  const ref=React.useRef(null),voice=React.useRef(audio),[painted,setPainted]=React.useState(false);voice.current=audio;
  React.useEffect(()=>{
    if(!urls||typeof packFigureRenderInputs!=='function')return;
    const key='preview:'+packId+':'+outfit.key+':'+state.id;let stage=null;
    try{stage=spriteMouthStage(packId,outfit,manifest,state,urls,key);}catch(e){console.warn('[voice-preview] no talking sprite',e);return;}
    const bundle=stage?.spriteBundle;
    if(!bundle)return;
    let live=true,raf=0,last='';
    const sources=layeredSpriteUrls(bundle);
    Promise.all(sources.map(src=>{const img=new Image();img.src=src;return img.decode().then(()=>[src,img]);})).then(list=>{
      if(!live)return;const images=new Map(list),canvas=ref.current;
      const tick=()=>{
        if(!live)return;
        const a=voice.current;
        try{
          if(!a){if(last){last='';setPainted(false);}}
          else{const event=layeredSpriteVoice(key,a,true);if(event!==last){layeredSpritePaint(canvas,bundle,images,event);last=event;setPainted(true);}}
        }catch(e){console.warn('[voice-preview] talking sprite kept its still',e);return;}
        raf=forkForeground.requestAnimationFrame(tick);
      };
      tick();
    },e=>console.warn('[voice-preview] talking sprite kept its still',e));
    return()=>{live=false;forkForeground.cancelAnimationFrame(raf);};
  },[urls]);
  return h('canvas',{ref,className:'ap-stand-mouth','aria-hidden':true,'data-talking':painted&&!!audio||undefined,style:{...style,visibility:painted&&audio?'visible':'hidden'}});
}
// 「编辑」 is the figure as it plays; 「生图」 holds what only exists for image
// generation (外貌, 服装描述, 设定图). gen-tab redesign: 立绘 / 头像 are generated from 「编辑」, so a new 立绘 / 头像
// waiting for a decision dots 「编辑」 and a new 设定图 dots 「生图」.
function FigureTabs({tab,setTab,waiting}) {
  const tabs=[['edit','编辑'],['gen','生图']],go=next=>{if(next!==tab)setTab(next);};
  return h('div',{className:'ap-fe-tabs',role:'tablist','aria-label':'人物页面',onKeyDown:e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=tab==='edit'?'gen':'edit';go(next);e.currentTarget.querySelector?.('[data-tab="'+next+'"]')?.focus?.();}}},
    tabs.map(([value,label])=>h('button',{key:value,type:'button',role:'tab','data-tab':value,'aria-selected':tab===value,tabIndex:tab===value?0:-1,onClick:()=>go(value),
      title:waiting?.[value]?'有新图等你选':undefined},label,waiting?.[value]&&h('span',{className:'ap-fe-tab-dot','aria-label':'有新图'}))));
}
// the figure's own ⋯ at the right end of the name row (after the lamp), so
// every row of the page ends on the same edge as 服装 / 差分. 复制到… and 删除人物 use the pack modal's writers (`actions`:
// {packs, packId, copy(target), remove}), when it provides them. no 重命名 —
// the name is edited in place (R23), like the outfit's 服装名.
function FigureMoreMenu({figure,actions,onRemove}) {
  const [copying,setCopying]=React.useState(false);
  return h(Popover,{label:'人物操作',className:'ap-figure-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'人物操作 '+figure.name,'aria-expanded':open,onClick:()=>{setCopying(false);toggle();}}),
    content:close=>copying?h(PackTargetMenu,{packs:actions.packs||[],exclude:actions.packId,close,onPick:target=>actions.copy(target)}):h(React.Fragment,null,
      actions?.copy&&h(MenuItem,{onClick:()=>setCopying(true)},'复制到…'),
      actions?.remove&&h(MenuItem,{danger:true,onClick:()=>{close();onRemove();}},'删除人物…'))});
}
const BASIC_HELP='人物本身的资料，所有服装共用。';
function FigureDetail({binding,pack,figure,commitFigure,assignFigureVoice,commitVoice,importFigureImage,importModel,importFigureSpine,figureActions,ctx,narrow=false,onBack,onClose,backLabel='人物',gen,importSettei,removeFigureImage,identityBoard,tab:tabChoice,setTab,voiceOpen:voiceFirst=false}) {
  // the figure's default outfit is its first enabled one (asset-packs.md: no
  // defaultOutfit field, order is the default) — what the stage starts with and what an opening scene without its own
  // outfit uses. Figure select: the editor no longer shows or sets it (the opening outfit is chosen in
  // 舞台设置 › 开场); it only opens on that outfit. No data change.
  const packId=pack.manifest.id,list=figure.outfits.map(o=>figureOutfitView(figure,o)),defaultKey=list.find(o=>o.enabled)?.key;
  // 声音 is one compact property; its page replaces this column (the preview card stays).
  // `voiceOpen` opens the figure straight on its 声音 page (配角色 › 声音).
  // every voice the 声音 page plays speaks through the preview card (usePreviewSpeech).
  const [voiceOpen,setVoiceOpen]=React.useState(voiceFirst),voicePill=React.useRef(null),voiceStatus=useFigureVoiceStatus(binding,pack,figure),speech=usePreviewSpeech(),voicePreview=useVoicePreview(binding,speech);
  const closeVoice=()=>{voicePreview.stop();setVoiceOpen(false);setTimeout(()=>voicePill.current?.focus?.({preventScroll:false}),0);};
  const [key,setKey]=React.useState(defaultKey||list[0]?.key),[error,setError]=React.useState(''),[face,setFace]=React.useState(list.find(o=>o.enabled)?.defaultEmotion || figure.emotions?.[0]?.id||''),[confirm,setConfirm]=React.useState(null),[nameFocus,setNameFocus]=React.useState(null);
  const [kindChoice,setKindChoice]=React.useState(null),[framing,setFraming]=React.useState(null),[spineOpen,setSpineOpen]=React.useState(false),[modelOpen,setModelOpen]=React.useState(false);
  // the 服装 grid's delete mode — the shared multi-select (useSelection,
  // SelectBar: UI standard §三.15). 差分 have none: 「删除差分…」 is each tile's menu (variant-menu).
  const outfitSel=useSelection(),pickGrid=outfitSel.on?'outfits':null;
  const setPicking=v=>{if(v?.grid==='outfits')outfitSel.start();else outfitSel.stop();};
  const tab=gen&&tabChoice==='gen'?'gen':'edit';
  const tabs=gen&&setTab&&h(FigureTabs,{tab,setTab,waiting:{edit:gen.waiting(figure.id,['sprite','avatar','avatar-sheet']),gen:gen.waiting(figure.id,['settei'])}});
  const upload=useUpload();
  const outfit=list.find(o=>o.key===key)||list[0]||null;
  const pickOutfit=next=>{setKey(next);};
  // A new outfit's name field takes focus (and its text) once it is on show.
  const outfitNameRef=React.useRef(null);
  React.useEffect(()=>{if(!nameFocus||outfit?.key!==nameFocus)return;const input=outfitNameRef.current;setNameFocus(null);input?.focus?.();input?.select?.();},[nameFocus,outfit?.key]);
  const write=make=>{setError('');return commitFigure(figure.id,make).catch(e=>setError(errorText(e)));};
  const writeOutfit=update=>write(f=>({outfits:f.outfits.map(o=>o.key===outfit.key?update(o):o)}));
  const info={figure,outfit,pack,ref:{packId,figureId:figure.id},sprites:pack.sprites};
  const manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey];
  // a 立绘 / 头像 is made where it goes — a tile's menu, the preview card's ✦ and
  // 「生图」's rows all open the one dialog (GenDialog) aimed at this outfit, view and 差分 (`dialog`); the request then runs
  // in the tile (`cell`: genCell). Nothing jumps to another page. 「✦ 生成缺失…」 sends straight away (owner U2).
  const [genNotice,setGenNotice]=React.useState(''),[accepting,setAccepting]=React.useState(false);
  const openDialog=(k,id,mode='gen')=>gen.openDialog({packId,figureId:figure.id,outfitKey:outfit.key,kind:k,emotionId:id},{mode,onOutfit:pickOutfit});
  const onGen=gen&&outfit?{gen,cell:(k,id)=>genCell(gen,{packId,figureId:figure.id,outfitKey:outfit.key,kind:k,emotionId:id}),dialog:openDialog}:null;
  // The asset on show: the one picked in the 差分 header, else the outfit's first (模型 → 立绘 → 头像); 模型 is the outfit's
  // Live2D, else its Spine (model tab).
  const kind=kindChoice==='model'?outfitModelKind(outfit):kindChoice||defaultAssetKind(outfit),showLive=kind==='live2d'&&!!outfit?.live2d;
  // a Spine outfit previews live in its own view (no face snapshots).
  const spineSource=useSpineBundleSource(binding,pack,kind==='spine'?outfit:null),showSpine=kind==='spine'&&!!outfit?.spine&&!!spineSource;
  // one 差分 list per outfit, whatever the view (outfitEmotionRows: what the outfit declares).
  const rows=outfitEmotionRows(figure,outfit,manifest);
  // Model metadata stays portable; this build previews sprites, avatars and Spine only.
  // Uploads: a layered / lip-synced sprite cannot take a single picture (import the pack instead).
  const canSprite=!outfit?.sprite||!!simpleSpriteImages(outfit,manifest);
  // per 差分 — a missing (or still) 差分 of a layered / lip-synced /
  // hybrid 立绘 takes one picture too (spriteSlotTakesStill); only its animated states are locked.
  const takes=id=>spriteSlotTakesStill(outfit,manifest,id);
  const uploadable=k=>!!importFigureImage&&!!outfit&&(k==='avatar'||k==='sprite'&&canSprite);
  // `newState`: the 立绘 ＋ tile adds a picture as a new state instead of writing the emotion's own state (v3.1 r2).
  // Where a slot of this view can be generated: 立绘 (a still 差分) and 头像, when the controller is there.
  const genable=(k,id)=>!!onGen&&!!outfit&&(k==='avatar'||k==='sprite'&&takes(id));
  // `replace`: the slot holds a 动态立绘 that the framed picture replaces — it is deleted just before the upload.
  const pick=(k,emotion,file,o=outfit,{newState=false,replace=false,imageId}={})=>{if(o.key!==outfit?.key)pickOutfit(o.key);setFraming({file,kind:k,emotion,outfitKey:o.key,newState,replace,imageId});};
  // A re-crop of an existing 立绘 that was left unchanged uploads nothing (it would only duplicate the picture).
  const finishFraming=file=>{const f=framing;setFraming(null);if(f.recrop&&file===f.file)return;
    upload.run('正在上传…',async()=>{if(f.replace)await removeFigureImage(figure.id,f.outfitKey,f.emotion,'sprite');return importFigureImage(figure.id,f.outfitKey,f.emotion,file,f.kind,{newState:f.newState,imageId:f.imageId});});};
  // Empty outfits are drafts: author their materials and triggers before switching the lamp on.
  const addOutfit=()=>{const next=newResourceKey('outfit');write(f=>({outfits:[...f.outfits,{key:next,label:'新服装',enabled:false,defaultEmotion:f.emotions?.[0]?.id}]})).then(result=>{if(result){pickOutfit(next);setNameFocus(next);}});};
  const faces={};
  for(const row of rows){
    const mapped=emotionMapped(kind,outfit,manifest,row.id);
    let art=null;
    if(kind==='live2d'||kind==='spine'){/* no snapshots: the tile is the name; the preview card plays it */}
    else if(kind==='sprite'){const bust=outfit?.sprite&&stateBust(outfit,emotionState(outfit,manifest,row.id));if(bust)art=h(BustArt,{binding,packId,bust,figure,frame:CAST_FACE});}
    else if(outfit&&mapped)art=h(Thumb,{binding,packId,hash:outfit.avatars[outfitImageId(outfit,row.id)],crop:null,label:row.label,className:'ap-face-thumb'});
    faces[row.id]={mapped,art,gen:genable(kind,row.id),cell:onGen&&(kind==='sprite'||kind==='avatar')?onGen.cell(kind,row.id):null};
  }
  // A name is committed to the outfit before generation; empty outfits have no implicit preview slot.
  // while a voice of the 声音 page plays in a 差分 (试听's mood, a local pool), the card
  // shows that 差分 — the stage's own mood → expression / picture mapping — and returns to the picked one when it ends.
  const speaking=voiceOpen&&!!speech.audio,spoken=speaking&&speech.mood?rows.find(r=>r.id===speech.mood):null;
  const picked=spoken||rows.find(r=>r.id===face)||rows[0]||{id:'',label:''},pickedCell=faces[picked.id]?.cell||null;
  // The still for the picked emotion (立绘, or 头像 when that asset is on show); Live2D falls back to the 立绘 while loading.
  const state=outfit?.sprite&&emotionState(outfit,manifest,picked.id);
  const standing=state&&outfit.sprite.assets?.[state.stage?.src||state.src];
  // the 头像 view previews the avatar file itself, never a 立绘 crop.
  const avatarSlot=kind==='avatar'&&outfit&&emotionMapped('avatar',outfit,manifest,picked.id)?{hash:outfit.avatars[outfitImageId(outfit,picked.id)],crop:null}:null;
  // the large preview of a missing slot is the tile's empty dashed state; its ✦ opens the dialog
  // like the tile's 「生成…」 (模型 has nothing to generate: the dashed card alone; 「导入模型」 is in the 差分 heading).
  // a request in flight shows its ring and time there; a waiting candidate is shown
  // large on the checkerboard with 「待采用」 and the outfit's 设定图 in the corner to compare against.
  // with a roster the tile's menu is the one place for 生成… (R13), so the
  // card's ✦ is only a mark there; a figure without 差分 has no tiles, and its card keeps the ✦ button and the actions.
  const noRoster=figure.emotions?.length===1&&figure.emotions[0].label===undefined;
  const emptyGen=noRoster&&!isModelKind(kind)&&genable(kind,picked.id),drawing=!!pickedCell&&['running','queued'].includes(pickedCell.state);
  const empty=h(SlotMissing,{className:'ap-stand is-empty',mark:!emptyGen&&!drawing&&!isModelKind(kind)},drawing?h(GenStageWait,{cell:pickedCell}):
    emptyGen?h('button',{type:'button',className:'ap-slot-gen',tabIndex:-1,'aria-hidden':true,title:'生成…',onClick:()=>openDialog(kind,picked.id,'gen')},h(Glyph,{name:'spark'})):null);
  const candidatePreview=pickedCell?.state==='candidate'?h(GenStageCandidate,{gen,binding,packId,cell:pickedCell,kind,emotionId:picked.id,settei:outfit?.settei}):null;
  const headShare=anatomyHeadShare(outfit?.sprite?.anatomy?.[state?.id]||outfit?.sprite?.anatomy?.[outfit.defaultEmotion]),liveFit={share:figureFit({heightCm:figure.heightCm,headShare}).share,spill:aspect=>figureFit({aspect,heightCm:figure.heightCm,headShare}).spill};
  // a talking 立绘 (its 差分 has mouth frames: !takes) moves its mouth over the still
  // while the 声音 page is open and a voice plays; Live2D does it on its model. Anything else has no mouth to move.
  const talking=voiceOpen&&kind==='sprite'&&!!state&&!takes(picked.id),lipSynced=talking;
  const mouth=talking?place=>h(SpriteMouth,{key:outfit.key+':'+state.id,binding,packId,outfit,manifest,state,audio:speech.audio,style:place}):null;
  const sprite=standing?h(StandArt,{key:standing,binding,packId,hash:standing,label:figure.name,heightCm:figure.heightCm,headShare,overlay:mouth}):null;
  // a 差分 without its own picture that another stands in for (回退) previews what
  // the stage shows — the stand-in's picture, tagged 「回退为「X」」.
  const standUse=outfit&&(kind==='sprite'||kind==='avatar')&&!candidatePreview&&!drawing&&!(kind==='avatar'?avatarSlot:sprite)?standInValue(outfit,picked.id):'';
  const standRow=standUse?rows.find(r=>r.id===standUse):null;
  let standStill=null;
  if(standRow&&kind==='avatar'&&emotionMapped('avatar',outfit,manifest,standUse))standStill=h(Thumb,{key:'use'+outfit.avatars[standUse],binding,packId,hash:outfit.avatars[standUse],crop:null,label:figure.name,className:'ap-stand is-avatar'});
  if(standRow&&kind==='sprite'&&outfit.sprite){const s=emotionState(outfit,manifest,standUse),hash=s&&outfit.sprite.assets?.[s.stage?.src||s.src];
    if(hash)standStill=h(StandArt,{key:'use'+hash,binding,packId,hash,label:figure.name,heightCm:figure.heightCm,headShare:anatomyHeadShare(outfit.sprite.anatomy?.[s.id])||headShare});}
  const still=kind==='avatar'?(avatarSlot?h(Thumb,{key:avatarSlot.hash,binding,packId,hash:avatarSlot.hash,crop:avatarSlot.crop,label:figure.name,className:'ap-stand is-avatar'}):standStill||empty):kind==='sprite'?sprite||standStill||empty:showLive||showSpine?sprite||empty:empty;
  const previewEmpty=!candidatePreview&&!standStill&&(kind==='avatar'?!avatarSlot:kind==='sprite'?!sprite:kind==='spine'?!showSpine:!showLive);
  const recall=outfit?.recall||{mode:'keyword',keywords:[]},hidden=(recall.keywords||[]).filter(w=>outfitWordHidden(outfit,w,figure));
  // one place per action (R13) — a picture's 生成 / 重画 / 改图 / 上传 /
  // 裁切 / 删除 are its tile's menu (menuFor). The preview card keeps them only for a figure without 差分 (no tiles) and
  // Spine's 「模型与动画」 (nothing else opens it). 裁切 frames a still into a new picture through ImageFramer: 立绘 「重新裁切…」
  // re-frames this 差分's own 立绘; 头像 「从立绘裁切…」 cuts the avatar out of it (starting on its head crop) and saves it as
  // this 差分's avatar file — the one the editor and the stage show, replacing an uploaded one.
  // (figure-editor r5) the view's asset actions, for the picked emotion — icon buttons on the
  // preview card (PreviewActions), for every view (r6: the 差分 header's ⋯ no longer repeats them, FigureViewMenu):
  // 头像 上传 / 裁切 (from the 立绘) / ✦; 立绘 上传 (a new picture, picked for this emotion) / 裁切 (re-frame the shown
  // picture into a new one) / ✦; Spine 「模型与动画」 (model tab: 导入 / 替换 is the heading's 「导入模型」, 删除 its ⋯).
  const ownStill=id=>!!outfit&&genOwnSprite(outfit,manifest,id);
  const frameStill=async(row,k)=>{let media=null;
    try{media=await holdMedia(binding,packId,ownStill(row.id));const blob=await (await fetch(media.url)).blob(),ext=(blob.type.split('/')[1]||'png').replace('jpeg','jpg');
      const file=new File([blob],row.id+'.'+ext,{type:blob.type||'image/png'});
      setFraming(k==='avatar'?{file,kind:'avatar',emotion:row.id,outfitKey:outfit.key,start:spriteCropFor(outfit,row.id)}:{file,kind:'sprite',emotion:row.id,outfitKey:outfit.key,newState:true,recrop:true});}
    catch(e){setError(errorText(e));}finally{media?.release();}};
  const who='「'+picked.label+'」';
  // The preview card's ✦ for the picked emotion: 生成… (empty) or 重画… (has a picture or a waiting one) — the dialog, as the
  // tile's menu; a request behind it shows on the ✦. A 动态立绘 is replaced the tile menu's way (askReplace: asks, deletes it,
  // then opens the dialog on the empty slot).
  const dynamicPicked=kind==='sprite'&&!takes(picked.id)&&!!removeFigureImage;
  const genAction=(k,noun)=>{const cell=onGen.cell(k,picked.id),redo=emotionMapped(k,outfit,manifest,picked.id)||cell.state==='candidate',replace=k==='sprite'&&dynamicPicked&&cell.state==='idle';
    return {icon:'spark',label:(redo?'重画':'生成')+who+noun+'…',genState:['idle','queued'].includes(cell.state)?undefined:cell.state,
      onClick:()=>replace?askReplace(picked,'redraw'):openDialog(k,picked.id,redo?'redraw':'gen')};};
  const viewActions=!outfit||!picked.id&&!isModelKind(kind)||!noRoster&&!isModelKind(kind)?[]:kind==='avatar'?[
      uploadable('avatar')&&{icon:'upload',label:'上传'+who+'头像',menu:'上传头像…',file:{onFiles:([file])=>pick('avatar',picked.id,file)}},
      !!importFigureImage&&!!ownStill(picked.id)&&{icon:'crop',label:'从立绘裁切'+who+'头像',menu:'从立绘裁切…',onClick:()=>frameStill(picked,'avatar')},
      onGen&&genAction('avatar','头像')].filter(Boolean):
    // A 动态立绘 takes a single picture only through askReplace (asked first); it has nothing to re-crop.
    kind==='sprite'?[
      !!importFigureImage&&(dynamicPicked?{icon:'upload',label:'上传'+who+'立绘',onClick:()=>askReplace(picked,'upload')}:
        {icon:'upload',label:'上传'+who+'立绘',menu:'上传立绘…',blocked:!takes(picked.id)&&LAYERED_TIP,explain:true,file:{onFiles:([file])=>pick('sprite',picked.id,file,outfit,{newState:!!outfit.sprite})}}),
      !!importFigureImage&&!!standing&&takes(picked.id)&&{icon:'crop',label:'裁切'+who+'立绘',menu:'裁切立绘…',onClick:()=>frameStill(picked,'sprite')},
      onGen&&genAction('sprite','立绘')].filter(Boolean):
    kind==='spine'&&outfit.spine&&importFigureSpine&&spineKit?[{icon:'edit',label:'Spine 模型与动画',onClick:()=>setSpineOpen(true)}]:[];
  // the 差分 heading's ⋯ keeps 设为默认外观 (figure.appearance: whether the stage
  // shows this figure as Live2D, 立绘 or 头像 — set nowhere else) and the view's batch requests (「删除差分…」 is the tile's
  // menu, variant-menu). 「清除「X」上传的头像」 is gone — it wrote exactly what the
  // tile's 「删除这张头像…」 writes (outfit.avatars minus that 差分), only without a confirm and in a second place.
  const look=figure.appearance||'live2d';
  const kindExtras=[];
  // the heading's one generate button, by view. It only
  // fills what is missing — a 差分 with no picture of this view, no 回退 and nothing in flight or waiting — and never replaces
  // a picture already there. 立绘: 「✦ 生成缺失立绘」 sends one request per missing still 差分 straight away (its default
  // prompt, no dialog). 头像: 「✦ 生成缺失头像」 — when all eight base faces (GEN_SHEET_FACES) are missing, the eight-face
  // sheet (one picture cut in eight: consistent and one request); otherwise one single-avatar request per missing 差分 whose
  // own 立绘 is there, batched like 立绘. Never a crop of the 立绘. Nothing missing: no button. 模型: 「导入模型」 (modelTools below). Replacing
  // avatars that exist stays the tile's explicit 重画… / 改图…. While a batch runs the heading says 「生成中 a/b · 停止」;
  // candidates waiting add 「N 张待采用 · 全部采用」.
  const viewNoun=kind==='avatar'?'头像':'立绘',genView=!!onGen&&(kind==='sprite'||kind==='avatar'),basis=genView?genBasis(figure,outfit):'';
  // The tiles show requests of this pack (a reopened modal finds its 待采用 again): the controller's list is read once a
  // 立绘 / 头像 view is on show — a local read, nothing is requested.
  React.useEffect(()=>{if(genView)gen.open();},[genView]);
  React.useEffect(()=>{setGenNotice('');},[kind,outfit?.key]);
  const cellGate=(k,id)=>k==='sprite'?(!takes(id)?LAYERED_TIP:!genBasis(figure,outfit)?GEN_REASONS.basis:''):!genOwnSprite(outfit,manifest,id)?GEN_REASONS.avatar:'';
  const missing=genView?rows.filter(r=>{const c=faces[r.id]?.cell;return !faces[r.id]?.mapped&&(c?.state==='idle'||c?.state==='failed')&&!outfit.fallbackEmotions?.includes(r.id)&&(kind!=='sprite'||takes(r.id));}):[];
  const fillable=kind==='sprite'?missing:missing.filter(r=>!cellGate(kind,r.id));
  // The eight base faces, resolved by key first, then by name (a figure set up with its own ids keeps the shared names).
  const baseFaces=kind==='avatar'&&missing.length>=8?GEN_SHEET_FACES.map(([id,label])=>matchBubbleMood(id,rows)||matchBubbleMood(label,rows)):[];
  const sheetIds=baseFaces.length&&baseFaces.every(r=>r&&missing.includes(r))&&new Set(baseFaces.map(r=>r.id)).size===8?baseFaces.map(r=>r.id):null;
  const sheetTarget=sheetIds&&(genOwnSprite(outfit,manifest,outfit.defaultEmotion)||outfit.settei)?{packId,figureId:figure.id,outfitKey:outfit.key,kind:'avatar-sheet',emotionIds:sheetIds}:null;
  const fillGate=kind==='sprite'?(!basis?GEN_REASONS.basis:''):!sheetTarget&&!fillable.length?GEN_REASONS.avatars:'';
  const fill=()=>{setError('');if(sheetTarget){gen.startSlot(sheetTarget);return;}
    gen.batch(fillable.map(r=>({target:{packId,figureId:figure.id,outfitKey:outfit.key,kind,emotionId:r.id},input:{userPrompt:genPromptFor(outfit,kind,r)}}))).catch(e=>setError(errorText(e)));};
  const rest=n=>n>0?'；另有 '+n+' 个':'';
  const fillTip=fillGate||(sheetTarget?'八个基础表情都还没有头像：一次画出这八个，已有的头像不动'+(missing.length>8?rest(missing.length-8)+'之后再补':''):
    '只给 '+fillable.length+' 个没有'+viewNoun+'的差分各画一张，已有的'+(kind==='avatar'?'头像':'图')+'不动'+(kind==='avatar'?rest(missing.length-fillable.length)+(missing.length>fillable.length?'还没有立绘，先生成立绘':''):''));
  const waitingCells=genView?rows.map(r=>faces[r.id]?.cell).filter(c=>c?.state==='candidate'&&c.job&&!c.sheet):[];
  const acceptAll=()=>{setAccepting(true);setError('');gen.acceptAll(waitingCells.map(c=>c.job)).finally(()=>setAccepting(false));};
  const progress=gen?.progress,ours=!!progress&&!!outfit&&progress.keys.some(k=>{const p=k.split('/');return p[1]===figure.id&&p[2]===outfit.key;});
  const genTools=genView&&!pickGrid&&(ours||missing.length>0||waitingCells.length>0)&&h('span',{className:'ap-gen-tools'},
    ours?h('span',{className:'ap-gen-progress',role:'status'},h(Spinner,{key:'batch',delay:0}),h('span',null,'生成中 '+progress.done+'/'+progress.total),
        h('button',{type:'button',className:'ap-inline-link',onClick:()=>gen.stop()},'停止')):
      missing.length>0&&h(Button,{className:'ap-manage ap-gen-fill'+(kind==='avatar'?' ap-gen-avatars':''),'aria-disabled':!!fillGate||undefined,title:fillTip,
        onClick:()=>{if(fillGate){setGenNotice(fillGate);return;}setGenNotice('');fill();}},h(Glyph,{name:'spark'}),'生成缺失'+viewNoun),
    waitingCells.length>0&&h('span',{className:'ap-gen-waiting'},h('span',null,waitingCells.length+' 张待采用'),' · ',
      h('button',{type:'button',className:'ap-inline-link',disabled:accepting,onClick:acceptAll},accepting?'正在采用…':'全部采用')));
  const showProblem=genView&&!!gen.problem&&!gen.dialog&&!gen.sheet;
  const genNotices=(showProblem||genNotice)&&h('div',{className:'ap-gen-notices'},
    showProblem&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,GEN_PROBLEMS[gen.problem])),
    genNotice&&h(GenGateNote,{text:genNotice}));
  // every 差分 tile's menu, in 模型 / 立绘 / 头像 alike, by
  // its state (mock E2): 空 生成… / 上传图片… / 设置回退 ›; 有图 重画… / 改图… / 替换为本地图片…; 待采用 采用 / 不要 / 重画… /
  // 改图… / 查看大图; 生成中 取消; 生图失败 ⚠ the reason / 重试… / 上传 / 设置回退 ›. Without any 设定 the menu says so once
  // and offers the ways to make one (no gated 生成… under it). A 动态立绘 (talks / blinks) offers the same 重画… / 替换为本地图片…
  // as a still: each asks first, because the new picture replaces it without mouth and eyes. 「设置回退 ›」 turns the menu into
  // its choices (‹ back). A gated item stays listed, unavailable, its reason as the tooltip (no grey text under it).
  // One scope per place (R13): the red tail is 「删除这张立绘（头像）…」 (this outfit's picture in this view) and 「删除差分…」
  // (the 差分 itself: the figure's one 差分 list, so every outfit's media of it) — the only place for either.
  const tileFile=React.useRef(null),tileAim=React.useRef(null);
  // 查看大图 of a tile — {hash} (a still 立绘 / 头像) or {jobId} (a waiting
  // candidate, its 采用 / 不要 / 重画… / 改图… as the viewer's corner buttons).
  const [big,setBig]=React.useState(null);
  const bigHash=(k,id)=>!outfit?null:k==='avatar'?outfit.avatars?.[outfitImageId(outfit,id)]||null:k==='sprite'?ownStill(id)||null:null;
  const bigView=big&&(big.jobId?h(CandidateImageView,{gen,jobId:big.jobId,label:big.label,actions:big.actions,onClose:()=>setBig(null)}):
    h(PackImageView,{binding,packId,hash:big.hash,label:big.label,onClose:()=>setBig(null)}));
  const pickTile=aim=>{tileAim.current=aim;tileFile.current?.click?.();};
  const tileInput=!!outfit&&h('input',{ref:tileFile,type:'file',tabIndex:-1,'aria-hidden':true,hidden:true,accept:'image/png,image/webp,image/jpeg','aria-label':'选择图片',
    onChange:e=>{const file=e.target.files?.[0],aim=tileAim.current;e.target.value='';if(!file||!aim||!outfit)return;
      if(aim.k==='settei')upload.run('正在上传…',()=>importSettei(figure.id,outfit.key,file));else pick(aim.k,aim.id,file,outfit,{newState:aim.k==='sprite'&&!!outfit.sprite,replace:!!aim.replace});}});
  const setStand=(id,v)=>{setError('');return figureActions.setFallback(outfit.key,id,!!v,v&&v!==outfit.defaultEmotion?v:undefined).catch(e=>setError(errorText(e)));};
  const runTile=fn=>Promise.resolve().then(fn).catch(e=>{if(['ALIGNMENT_REQUIRED','TARGET_CHANGED'].includes(e?.code))return;setError(errorText(e));});
  const askRemoveImage=(r,k,dynamic=false)=>{const noun=k==='avatar'?'头像':'立绘',kept=k==='avatar'?'立绘、模型':'头像、模型';
    setConfirm({title:'删除「'+r.label+'」的'+noun+'？',body:'只删除「'+outfit.label+'」的这张'+(dynamic?'动态立绘，连同它的口型和眨眼':noun)+'；差分「'+r.label+'」和它的'+kept+'都保留，格子变回空位。',confirmLabel:'删除',danger:true,
    onConfirm:()=>removeFigureImage(figure.id,outfit.key,r.id,k)});};
  // A 动态立绘 replaced by one picture: 重画 deletes it first, then opens the dialog on the empty slot; 替换 deletes it only
  // once the new picture is framed (finishFraming), so cancelling the picker keeps it.
  const askReplace=(r,how)=>setConfirm(how==='redraw'?{title:'重画「'+r.label+'」？',body:'先删除「'+outfit.label+'」的这张动态立绘（连同口型和眨眼），再生成新图；新图不会动嘴、眨眼。',confirmLabel:'删除并重画',danger:true,
      onConfirm:async()=>{await removeFigureImage(figure.id,outfit.key,r.id,'sprite');openDialog('sprite',r.id,'gen');}}:
    {title:'替换「'+r.label+'」？',body:'选好的图会替换「'+outfit.label+'」的这张动态立绘，口型和眨眼随之删除；新图不会动嘴、眨眼。',confirmLabel:'选择图片',danger:true,onConfirm:()=>pickTile({k:'sprite',id:r.id,replace:true})});
  // 「删除差分…」: the confirm names what goes — the 差分 in every outfit, with the media it has there.
  const askRemoveEmotion=r=>{
    const goes=[['张立绘',o=>emotionMapped('sprite',o,o.sprite&&pack.sprites?.[o.sprite.manifestKey],r.id)],['张头像',o=>!!o.avatars?.[outfitImageId(o,r.id)]],['个模型表情',o=>!!(o.live2d?.emotionMap?.[r.id]||o.spine?.emotionMap?.[r.id])]]
      .map(([noun,has])=>[noun,list.filter(has).length]).filter(([,n])=>n).map(([noun,n])=>n+' '+noun);
    if(figure.voice?.emotionVariants?.[r.id])goes.push('声音设置');
    setConfirm({title:'删除差分「'+r.label+'」？',body:'从'+(list.length>1?'全部 '+list.length+' 套服装':'服装「'+outfit.label+'」')+'删除「'+r.label+'」'+(goes.length?'，连同 '+goes.join('、'):'')+'；其他差分不变。',confirmLabel:'删除',danger:true,
      onConfirm:async()=>{await figureActions.removeEmotion(r.id);if(r.id===face)setFace(rows.find(x=>x.id!==r.id)?.id||'');}});};
  const menuFor=outfit?(r,close,page,setPage)=>{
    const cell=faces[r.id]?.cell,state=cell?.state||'idle',k=kind,has=!!faces[r.id]?.mapped,target={packId,figureId:figure.id,outfitKey:outfit.key,kind:k,emotionId:r.id};
    const go=fn=>()=>{close();fn();},gate=genView?cellGate(k,r.id):'',dynamic=k==='sprite'&&has&&!takes(r.id);
    const item=(icon,text,onClick,extra={})=>h(MenuItem,{key:extra.key||text,danger:extra.danger,disabled:!!extra.off,title:extra.off||extra.title,onClick},h(Glyph,{name:icon}),
      h('span',{className:'ap-cell-menu-text'},h('span',null,text)),extra.hint&&h('span',{className:'ap-cell-menu-hint'},extra.hint),extra.more&&h(Glyph,{name:'chevRight'}));
    const stand=genView&&!!figureActions?.setFallback&&r.id!==outfit.defaultEmotion,standNow=standInValue(outfit,r.id),standOptions=standInOptions(outfit,rows,r.id);
    if(page==='stand')return h('div',{className:'ap-cell-menu',onKeyDown:genMenuKeys},
      h('button',{type:'button',className:'ap-menu-item ap-cell-menu-back',onClick:()=>setPage('')},h(Glyph,{name:'back'}),h('span',null,'「'+r.label+'」设置回退')),
      h('div',{className:'ap-menu-sep',role:'separator'}),
      standOptions.map(o=>h('button',{key:o.value||'none',type:'button',role:'menuitemradio','aria-checked':standNow===o.value,className:'ap-menu-item',
        onClick:go(()=>{if(standNow!==o.value)setStand(r.id,o.value);})},h('span',{className:'ap-cell-menu-text'},h('span',null,o.label)),standNow===o.value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})))));
    const standName=standNow?rows.find(x=>x.id===standNow)?.label||'':'';
    const head=h('div',{key:'head',className:'ap-cell-menu-head','aria-hidden':true},h('b',null,r.label));
    const noBasis=genView&&k==='sprite'&&!has&&!basis&&['idle','failed'].includes(state);
    const basisRows=noBasis?[h('p',{key:'basis',className:'ap-cell-menu-warn'},h(Glyph,{name:'warning'}),h('span',null,'还没有设定，无法生成')),
      importSettei&&item('upload','上传设定图…',go(()=>pickTile({k:'settei'})),{key:'settei-up'}),
      item('palette','生成设定图…',go(()=>gen.openDialog({packId,figureId:figure.id,outfitKey:outfit.key,kind:'settei'},{mode:'gen'}))),
      setTab&&item('note','去写设定文字',go(()=>setTab('gen'))),h('div',{key:'sep0',className:'ap-menu-sep',role:'separator'})]:[];
    // A 差分 slot takes a picture when the view does (头像 always, 立绘 unless this 差分's own 立绘 talks / blinks).
    const uploadItem=text=>!!importFigureImage&&(k==='avatar'||takes(r.id))&&item('upload',text,go(()=>pickTile({k,id:r.id})));
    // 裁切: 头像 from this 差分's own 立绘 (empty or not); 立绘 re-frames its own still picture.
    const cropItem=!!importFigureImage&&!!ownStill(r.id)&&(k==='avatar'?item('crop','从立绘裁切…',go(()=>frameStill(r,'avatar'))):has&&takes(r.id)&&item('crop','重新裁切…',go(()=>frameStill(r,'sprite'))));
    const tail=state==='running'||state==='queued'?[]:[
      (k==='sprite'||k==='avatar')&&has&&!!removeFigureImage&&item('remove','删除这张'+viewNoun+'…',go(()=>askRemoveImage(r,k,dynamic)),{danger:true}),
      !!figureActions?.removeEmotion&&item('remove','删除差分…',go(()=>askRemoveEmotion(r)),{key:'remove-emotion',danger:true,off:rows.length<2?'至少保留一个差分':''})].filter(Boolean);
    const standItem=stand&&item('fallback','设置回退',()=>setPage('stand'),{more:true,hint:standNow?standName:'无回退'});
    const items=!genView?[]:state==='candidate'?(cell.sheet?[item('eye','查看八个头像',go(()=>gen.openSheet(cell.sheet)))]:[
        cell.error&&h('p',{key:'why',className:'ap-cell-menu-warn'},h(Glyph,{name:'warning'}),h('span',null,'采用失败：'+cell.error)),
        item('check','采用',go(()=>runTile(()=>gen.accept(cell.job).catch(e=>{if(['ALIGNMENT_REQUIRED','TARGET_CHANGED'].includes(e?.code))gen.openSheet(target);throw e;})))),
        item('close','不要',go(()=>runTile(()=>gen.reject(cell.job)))),item('reset','重画…',go(()=>openDialog(k,r.id,'redraw'))),
        item('edit','改图…',go(()=>openDialog(k,r.id,'edit'))),item('eye','查看大图',go(()=>setBig({label:r.label,jobId:cell.job.jobId,actions:[
          {icon:'check',label:'采用',onClick:()=>{setBig(null);runTile(()=>gen.accept(cell.job).catch(e=>{if(['ALIGNMENT_REQUIRED','TARGET_CHANGED'].includes(e?.code))gen.openSheet(target);throw e;}));}},
          {icon:'remove',label:'不要',onClick:()=>{setBig(null);runTile(()=>gen.reject(cell.job));}},
          {icon:'reset',label:'重画…',onClick:()=>{setBig(null);openDialog(k,r.id,'redraw');}},
          {icon:'edit',label:'改图…',onClick:()=>{setBig(null);openDialog(k,r.id,'edit');}}]})))]):
      state==='running'||state==='queued'?[item('stop',state==='queued'?'取消排队':'取消',go(()=>runTile(()=>state==='queued'?gen.dequeue(target):cell.job&&gen.cancel(cell.job))),{off:cell.after?'采用前一张图后开始':state==='running'&&!cell.job?'正在发送…':''})]:
      state==='failed'?[cell.error&&h('p',{key:'why',className:'ap-cell-menu-warn'},h(Glyph,{name:'warning'}),h('span',null,cell.error)),...basisRows,
        !noBasis&&item('reset','重试…',go(()=>openDialog(k,r.id,'gen')),{off:gate}),uploadItem('上传图片…'),cropItem,standItem,
        item('close','清除这条提示',go(()=>runTile(()=>cell.job?gen.reject(cell.job):gen.clearError(cell.key))))]:
      dynamic?[item('reset','重画…',go(()=>askReplace(r,'redraw'))),!!importFigureImage&&item('upload','替换为本地图片…',go(()=>askReplace(r,'upload')))]:
      has?[bigHash(k,r.id)&&item('eye','查看大图',go(()=>setBig({label:r.label,hash:bigHash(k,r.id)}))),
        bigHash(k,r.id)&&item('export','下载',go(()=>runTile(()=>downloadPackMedia(binding,pack,bigHash(k,r.id),figure.name+'-'+outfit.label+'-'+r.label+viewNoun)))),item('reset','重画…',go(()=>openDialog(k,r.id,'redraw'))),item('edit','改图…',go(()=>openDialog(k,r.id,'edit'))),
        uploadItem('替换为本地图片…'),cropItem]:
      [...basisRows,!noBasis&&item('spark','生成…',go(()=>openDialog(k,r.id,'gen')),{off:gate}),uploadItem('上传图片…'),cropItem,standItem];
    const body=items.filter(Boolean);
    return h('div',{className:'ap-cell-menu',onKeyDown:genMenuKeys},head,body,tail.length>0&&body.length>0&&h('div',{key:'sep',className:'ap-menu-sep',role:'separator'}),tail);
  }:null;
  const statusFor=genView?row=>{const c=faces[row.id]?.cell;return c&&c.state!=='idle'?h(GenCellStatus,{key:c.key,gen,cell:c,outfit,onDialog:mode=>openDialog(kind,row.id,mode)}):null;}:null;
  // 模型's heading button 「导入模型」 opens the shared import sheet for this outfit
  // (Live2D or Spine, whatever the files are; a model already there is replaced) and its ⋯ 「删除模型…」 removes it.
  // 立绘 / 头像 have no model import.
  const modelTools=isModelKind(kind)&&!!importModel&&!!outfit&&!pickGrid&&h('span',{className:'ap-gen-tools'},
    h(Button,{className:'ap-manage ap-gen-fill',disabled:!!upload.busy,onClick:()=>setModelOpen(true)},h(Glyph,{name:'upload'}),'导入模型'));
  if(figure.emotions?.length===1 && figure.emotions[0].label!==undefined)kindExtras.push({icon:'reset',label:'设为无差分',onClick:()=>write(f=>({emotions:[{id:f.emotions[0].id}]}))});
  if(isModelKind(kind)&&outfit&&(outfit.live2d||outfit.spine)&&figureActions?.removeModel)kindExtras.push({icon:'remove',label:'删除模型',menu:'删除模型…',danger:true,
    onClick:()=>setConfirm({title:'删除「'+outfit.label+'」的模型？',body:'这套服装的 '+(outfit.live2d?'Live2D':'Spine')+' 模型会被移除；立绘和头像保留。',confirmLabel:'删除',danger:true,
      onConfirm:()=>figureActions.removeModel(outfit.key)})});
  const tool=h(PreviewActions,{key:(outfit?.key||'')+':'+kind+':'+picked.id,actions:viewActions,disabled:!!upload.busy});
  // deleting outfits is the 服装 grid's delete mode, entered from its heading's
  // ⋯ 「删除服装…」: tap tiles to check them, then 「删除」 asks (ConfirmDialog) and writes one commitFigure.
  const pickIn=()=>outfitSel.ids,flip=id=>outfitSel.flip(id);
  const pickedOutfits=list.filter(o=>outfitSel.ids?.has(o.key));
  const names=items=>items.map(x=>'「'+x.label+'」').join('');
  const deleteOutfits=()=>{const chosen=pickedOutfits,keys=new Set(chosen.map(o=>o.key));if(!chosen.length)return;
    setConfirm({title:chosen.length===1?'删除服装「'+chosen[0].label+'」？':'删除 '+chosen.length+' 套服装？',body:(chosen.length>1?names(chosen)+' 将':'')+'从素材包「'+pack.manifest.name+'」中删除，所有使用此人物的卡都会受影响。',confirmLabel:'删除',danger:true,
      onConfirm:async()=>{await commitFigure(figure.id,f=>figureOutfitRemoval(f,keys));setPicking(null);}});};
  const pickTools=()=>h(SelectBar,{count:pickedOutfits.length,action:'删除',danger:true,busy:!!upload.busy,onCancel:()=>setPicking(null),onAction:deleteOutfits});
  const kindMenu=h(FigureViewMenu,{kind,isDefault:look===kind,onDefault:()=>write(()=>({appearance:kind})),extras:kindExtras,disabled:!!upload.busy});
  // Leaving the editing page (生图, 声音) or the figure ends the mode; entering focuses 取消, leaving returns to the ⋯.
  React.useEffect(()=>{setPicking(null);},[tab,voiceOpen,figure.id]);
  const pickWas=React.useRef(null);
  React.useEffect(()=>{const grid=pickGrid,prev=pickWas.current;if(grid===prev)return;pickWas.current=grid;const root=paneRef.current;
    if(grid)root?.querySelector?.('[data-pick-grid="'+grid+'"] .ap-pick-cancel')?.focus?.({preventScroll:true});
    else if(prev)root?.querySelector?.('[data-pick-grid="'+prev+'"] .ap-sub-tools .ap-icon-button')?.focus?.({preventScroll:true});},[pickGrid]);
  // 触发策略 per outfit (r3): 蓝灯 / 绿灯 / 关闭 (灰灯). 关闭 is the outfit's own enabled flag; a lit lamp also
  // re-enables the outfit. The figure's own switch is the lamp slot by the name (figure lamps replace it, §4c).
  // r7: set from each tile's own lamp dot (OutfitLamp), for that outfit — not only the selected one.
  const setLamp=(key,mode)=>write(f=>({outfits:f.outfits.map(o=>o.key!==key?o:mode==='off'?{...o,enabled:false}:{...o,enabled:true,recall:{...(o.recall||{keywords:[]}),mode}})}));
  // Stable tile callbacks (FigureOutfitTile is memoised; the latest handlers are read through a ref).
  const tileLatest=React.useRef(null);tileLatest.current={pickOutfit,setLamp,pick,flip};
  const tileStable=React.useRef(null);
  if(!tileStable.current)tileStable.current={select:k=>tileLatest.current.pickOutfit(k),lamp:(k,mode)=>tileLatest.current.setLamp(k,mode),flip:k=>tileLatest.current.flip(k),pick:(target,file)=>tileLatest.current.pick('sprite',target.defaultEmotion,file,target),upload:null};
  const tileCalls=tileStable.current;
  if(!importFigureImage)tileCalls.upload=null;else if(tileCalls.upload?.disabled!==!!upload.busy)tileCalls.upload={disabled:!!upload.busy,pick:tileCalls.pick};
  const tileUpload=tileCalls.upload;
  const nameInput=h(CommitInput,{className:'ap-title-input','aria-label':'人物名称',value:figure.name,validate:v=>v.trim()?'':'名称不能为空',onCommit:v=>write(()=>({name:v.trim()}))});
  // one lamp replaces the figure's independent enabled switch.
  // the one LampMenu, read as 「● 绿灯 ⌄」 (was the segmented LampSwitch).
  const enable=h('span',{className:'ap-figure-lamp-slot'},h(LampMenu,{label:'人物灯',named:true,mode:outfitLamp(figure),onChange:mode=>write(f=>mode==='off'?{enabled:false}:{enabled:true,recall:{...f.recall,mode}})}));
  const paneRef=React.useRef(null);
  const removeFigure=()=>setConfirm({title:'删除人物「'+figure.name+'」？',body:'从素材包「'+pack.manifest.name+'」中删除，所有使用此人物的卡都会受影响。',confirmLabel:'删除',danger:true,onConfirm:()=>figureActions.remove()});
  const more=(figureActions?.copy||figureActions?.remove)&&h(FigureMoreMenu,{figure,actions:figureActions,onRemove:removeFigure});
  return h('div',{ref:paneRef,className:'ap-detail-pane ap-figure-pane ap-figure-editor','data-narrow':narrow||undefined,'data-tab':tab,'data-voice':voiceOpen||undefined,'data-disabled':figure.enabled===false||undefined,style:{'--figure-color':figureColor(figure)}},
    // Phone: one header only (r4) — ‹ · the name · lamp slot · × replaces the drawer's own title bar.
    narrow&&h('div',{className:'ap-fe-topbar'},onBack&&h(IconButton,{icon:'back',label:'返回'+backLabel+'列表',onClick:onBack}),nameInput,enable,more,onClose&&h(IconButton,{icon:'close',label:'关闭',onClick:onClose})),
    narrow&&!voiceOpen&&tabs,
    h('div',{className:'ap-figure-stage'},
      h('div',{className:'ap-stand-wrap','data-form':kind,'data-empty':previewEmpty||undefined,'data-stand-in':standStill?true:undefined,'data-speaking':speaking||undefined},
        // While a voice plays the 差分 label stays shown; a picture without a mouth only gets this small waveform (no fake mouth).
        h('span',{className:'ap-stage-mood','data-speaking':speaking||undefined},picked.label,speaking&&!lipSynced&&h('span',{className:'ap-stage-voice','aria-hidden':true},[0,1,2].map(i=>h('i',{key:i})))),
        standStill&&h('span',{className:'ap-stage-standin'},h(Glyph,{name:'fallback'}),h('span',null,'回退为「'+standRow.label+'」')),
        // the preview plays the stage's idle (Live2D: the Idle group + blink/breath; Spine: the
        // emotion's loop animation), not a still pose.
        // one card for every Live2D outfit (the model swaps on its canvas, no remount); a switch
        // paints first and the model loads 120 ms later, so outfits clicked past never load.
        showSpine?h(spineKit.Preview,{key:'spine',source:spineSource,config:outfit.spine,animation:spineEmotionAnimation(outfit.spine,picked.id,outfit.defaultEmotion).animation,label:figure.name}):
          candidatePreview||(previewEmpty?still:h(FigureStillPreview,{key:(outfit?.key||'')+kind},still)),
        outfit&&tab==='edit'&&!voiceOpen&&tool)),
    h('div',{className:'ap-figure-main'},
      voiceOpen?h(VoicePage,{binding,pack,figure,rows:figureDeclaredRows(figure,pack),status:voiceStatus,preview:voicePreview,speech,commitVoice,assignFigureVoice,ctx,onClose:closeVoice}):h(React.Fragment,null,
      h(ErrorBox,{error}),
      !narrow&&h('div',{className:'ap-detail-title'},nameInput,h('span',{className:'ap-title-tools'},enable,more)),
      !narrow&&tabs,
      // 「生图」 aims at the 差分 and view picked here (Live2D → 立绘); switching there switches here.
      // 「生图」 is 设定 and this outfit's 生成 records; a record picks its 差分 and view here.
      // gen-ui b5: 「生图」 is the outfits and this outfit's 差分 wall; a tile picks its 差分 in the preview.
      tab==='gen'?h(FigureGenTab,{binding,pack,figure,outfit,onOutfit:pickOutfit,write,writeOutfit,gen,identityBoard,removeFigureImage,
        settei:{upload:importSettei,remove:removeFigureImage?(figureId,outfitKey)=>removeFigureImage(figureId,outfitKey,null,'settei'):null},
        onPick:id=>{if(kind!=='sprite'&&kind!=='avatar')setKindChoice('sprite');setFace(id);},
        uploadSprite:importFigureImage&&outfit?id=>pickTile({k:'sprite',id}):null,
        setFallback:figureActions?.setFallback||null}):h(React.Fragment,null,
      // r5: the basic fields get their own small heading, in the 服装 / 差分 heading's style.
      h('section',{className:'ap-fe-section is-basic','aria-label':'基础设定'},
      h('h4',{className:'ap-sub ap-basic-head'},'基础设定',h(Help,{text:BASIC_HELP,label:'基础设定 说明'})),
      // 触发词 (data `aliases`) is one list of the figure's other names — each
      // one both names the speaker of a line and calls the figure in (the old separate list was the same thing).
      h(FigureBasics,{figure,write,voice:h(FigureVoiceField,{binding,pack,figure,status:voiceStatus,pillRef:voicePill,onOpen:()=>setVoiceOpen(true)})})),
      h('section',{className:'ap-fe-section'+(pickIn('outfits')?' is-picking':''),'aria-label':'服装','data-pick-grid':'outfits',
          onKeyDown:e=>{if(e.key==='Escape'&&!e.defaultPrevented&&pickIn('outfits')){e.preventDefault();e.stopPropagation();setPicking(null);}}},
        // v3.1 r2: the 触发策略 explanation moved to the section's ? (the rows below are plain labelled properties).
        // r7: no 蓝灯 / 绿灯 / 关闭 control by the heading — each tile's lamp dot is its own control.
        // Figure select: the heading row ends with its ⋯ (「删除…」), or the delete mode's 已选 N · 取消 · 删除.
        h('h4',{className:'ap-sub ap-outfit-head'},'服装',h('span',null,list.length),h(Help,{text:'每套服装一盏灯：蓝灯始终可选，绿灯在名称或触发词命中时可选，灰灯不会换上。',label:'服装 说明'}),
          h('span',{className:'ap-sub-tools'},pickIn('outfits')?pickTools('outfits'):h(OutfitMenu,{count:list.length,disabled:!!upload.busy,onDelete:()=>setPicking({grid:'outfits',ids:new Set()})}))),
        // v3.1 r2: one add language — the grid ends with a dashed ＋ tile (no 「＋ 添加服装」 pill in the header); none in the delete mode.
        h('div',{className:'ap-outfit-faces'},
          list.length>0&&h('div',{className:'ap-outfit-radios',role:pickIn('outfits')?'group':'radiogroup','aria-label':pickIn('outfits')?'选择要删除的服装':'服装'},list.map(o=>h(FigureOutfitTile,{key:o.key,binding,pack,figure,outfit:o,selected:o.key===outfit?.key,onSelect:tileCalls.select,
            picking:!!pickIn('outfits'),checked:!!pickIn('outfits')?.has(o.key),onFlip:tileCalls.flip,onLamp:tileCalls.lamp,upload:tileUpload}))),
          !pickIn('outfits')&&h('span',{className:'ap-outfit-cell'},h('button',{type:'button',className:'ap-outfit-add','aria-label':'添加服装',title:'添加服装',onClick:addOutfit},h('span',{className:'ap-outfit-art'},h(Glyph,{name:'plus'}))))),
        // r7: the selected outfit's 触发词 are their own inline row under the tiles — 「触发词」, the chips,
        // a dashed ＋ (the figure 触发词 row's language). Outfit polish: the block is the selected outfit's whole detail —
        // 服装名 (edited in place; replaces 重命名), 使用情景, 触发词 (figure select: no action line; hidden in the delete mode).
        !pickIn('outfits')&&outfit&&h(InlineGrid,{key:'props:'+outfit.key,className:'ap-outfit-props',columns:1,label:'所选服装设置'},
          h(InlineField,{key:'name:'+outfit.key,kind:'text',label:'服装名',controlLabel:'服装名称',className:'is-outfit-name',controlRef:outfitNameRef,value:outfit.label||'',placeholder:'未命名',
            validate:v=>v.trim()?'':'请填写服装名称',onCommit:v=>writeOutfit(o=>({...o,label:v.trim()}))}),
          // 「使用情景」 before 触发词 — when the director should switch to this outfit.
          h(InlineField,{key:'usage:'+outfit.key,kind:'text',multiline:true,label:'使用情景',controlLabel:'服装使用情景',help:h(Help,{text:OUTFIT_USAGE_HELP,label:'服装使用情景 说明'}),className:'is-usage',hideEmpty:true,
            value:outfit.guidance||'',placeholder:'例：在中转站工作时',maxLength:80,validate:v=>[...v].length<=80?'':'使用情景最多 80 字',
            onCommit:v=>writeOutfit(o=>{const next={...o};if(v)next.guidance=v;else delete next.guidance;return next;})}),
          remarkField({key:'remark:'+outfit.key,value:outfit.remark,controlLabel:'服装备注',className:'is-remark',onCommit:v=>writeOutfit(o=>withRemark(o,v))}),
          h(InlineField,{key:'words:'+outfit.key,kind:'chips',label:'触发词',controlLabel:'服装触发词',className:'is-words',hideEmpty:true,value:(recall.keywords||[]).filter(w=>!outfitWordHidden(outfit,w,figure)),split:splitKeywords,validate:keywordProblem,
            // the candidates are the outfit trigger words already used in this pack.
            suggest:entryWordCandidates(pack,'figures',a=>(a.outfits||[]).flatMap(o=>o.recall?.keywords||[])),
            onCommit:shown=>writeOutfit(o=>{const base=o.recall||{mode:'keyword',keywords:[]},keywords=[...hidden,...shown.filter(w=>!hidden.includes(w))],synonyms=Object.fromEntries(Object.entries(base.synonyms||{}).filter(([k])=>keywords.includes(k)));const next={...base,keywords};if(Object.keys(synonyms).length)next.synonyms=synonyms;else delete next.synonyms;return {...o,recall:next};})}))),
      outfit?.sprite?.imagePools&&h(FigureStateImages,{binding,pack,figure,outfit,manifest,state:picked,writeOutfit,upload:importFigureImage?file=>pick('sprite',picked.id,file):null,uploadAvatar:importFigureImage?(file,imageId)=>pick('avatar',picked.id,file,outfit,{imageId}):null,confirm:setConfirm}),
      h(FigureEmotions,{binding,pack,figure,outfit,manifest,rows,faces,selected:picked.id,onSelect:setFace,write,writeOutfit,upload,pick:importFigureImage&&outfit&&(kind!=='sprite'||canSprite)?pick:null,layered:!!importFigureImage&&!!outfit?.sprite&&!canSprite,onGen,kind,setKind:setKindChoice,kindMenu,genTools:genTools||modelTools,notices:genNotices,menuFor,statusFor,createCustom:importFigureImage&&outfit?(row,file)=>importFigureImage(figure.id,outfit.key,row.id,file,'sprite',{customEmotion:row}):null,
        addExisting:importFigureImage&&outfit&&canSprite?(id,file)=>importFigureImage(figure.id,outfit.key,id,file,'sprite',{newState:!!outfit.sprite}):null,
        onFallback:figureActions?.setFallback&&outfit?(id,on,use)=>{setError('');return figureActions.setFallback(outfit.key,id,on,use).catch(e=>setError(errorText(e)));}:null,
        aimNew:outfit?(id,label,generate=true)=>write(f=>({emotions:label?[...(f.emotions||[]),{id,label}]:f.emotions})).then(r=>{if(r&&generate&&onGen)openDialog('sprite',id,'gen');return r;}):null}),
      )),
      tileInput,bigView,voicePreview.dialog,
      framing&&h(Modal,{title:framing.kind==='avatar'?'调整头像':'调整立绘',className:'ap-framer-modal',closable:false,onClose:()=>setFraming(null)},h(ImageFramer,{key:framing.file.name+framing.file.size,file:framing.file,square:framing.kind==='avatar',start:framing.start||null,onCancel:()=>setFraming(null),onDone:finishFraming})),
      spineOpen&&outfit&&h(SpineDialog,{key:outfit.key,binding,pack,figure,outfit,onClose:()=>setSpineOpen(false),
        onSave:result=>importFigureSpine(figure.id,outfit.key,result).then(r=>{setKindChoice('model');return r;})}),
      modelOpen&&outfit&&h(ModelImportSheet,{key:outfit.key,binding,pack,fixed:{figureId:figure.id,outfitKey:outfit.key},onClose:()=>setModelOpen(false),
        onImport:result=>importModel(result).then(r=>{setKindChoice('model');return r;})}),
      confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)})));
}
