// shared figure image, preview and crop authoring; no card-level character editor.
const IMAGE_LIMIT=6*1024*1024, IMAGE_TYPES={'image/png':'png','image/webp':'webp','image/jpeg':'jpeg'};
const DEFAULT_AVATAR_CROP={x:0.3,y:0,w:0.4,h:0.21};
// sample only at explicit authoring ingress, never in a thumbnail/read effect.
async function figureAutoValue(binding,pack,figure,imported) {
  const source=figureAutoSource(figure,pack.sprites);
  if(!source)return FIGURE_AUTO_NEUTRAL;
  if(imported?.hash===source.hash&&imported.sprite===source.sprite){
    if(imported.autoColor)return imported.autoColor;
    const bitmap=await createImageBitmap(new Blob([imported.bytes],{type:imported.mime}));
    try{return figureBitmapAutoColor(bitmap,source.sprite,document.createElement('canvas'));}finally{bitmap.close();}
  }
  const media=await binding.previewMedia({packId:pack.manifest.id,hash:source.hash});
  try {
    const response=await fetch(media.url);if(!response.ok)throw new Error('无法读取自动取色图片');
    const bitmap=await createImageBitmap(await response.blob());
    try{return figureBitmapAutoColor(bitmap,source.sprite,document.createElement('canvas'));}finally{bitmap.close();}
  }finally{media.release();}
}
async function figureAutoPatch(binding,pack,before,after,imported) {
  if(JSON.stringify(figureAutoSource(before,pack.sprites))===JSON.stringify(figureAutoSource(after,pack.sprites)))return {};
  return {autoColor:await figureAutoValue(binding,pack,after,imported)};
}
// One CAS metadata publication per imported pack; a partial calculation is never saved.
async function fillImportedFigureColors(binding,pack) {
  const fileUpdates=new Map();
  for(const figure of Object.values(pack.figures))if(!figure.autoColor){
    const next={...figure,autoColor:await figureAutoValue(binding,pack,figure)};
    fileUpdates.set('figures/'+figure.id+'.json',new TextEncoder().encode(JSON.stringify(next)));
  }
  return fileUpdates.size?binding.service.patchPack({packId:pack.manifest.id,expectedRevision:pack.revision,fileUpdates}):{snapshot:pack};
}
// Browser image intake: PNG/WebP pass through; JPEG is re-encoded (WebP, else PNG) because sprite sources
// only admit PNG/WebP. Dimensions, alpha and size are measured here for the §7.2 warnings.
async function browserPrepareImage(file,kind,sampleColor=true) {
  const type=IMAGE_TYPES[file?.type]||(/\.png$/i.test(file?.name)?'png':/\.webp$/i.test(file?.name)?'webp':/\.jpe?g$/i.test(file?.name)?'jpeg':'');
  if(!type)throw new Error('请选择 PNG、WebP 或 JPEG 图片');
  if(file.size>IMAGE_LIMIT)throw new Error('图片过大（上限 6 MB）');
  const bitmap=await createImageBitmap(file),width=bitmap.width,height=bitmap.height;
  try {
  if(width>8192||height>8192||width*height>32*1024*1024)throw new Error('图片尺寸过大（上限 8192 像素、总计 32 MP）');
  const canvas=(w,hgt)=>{const c=document.createElement('canvas');c.width=w;c.height=hgt;return c;};
  let blob=file,ext=type==='jpeg'?'':type,alpha=false;
  if(type==='jpeg'){
    const c=canvas(width,height);c.getContext('2d').drawImage(bitmap,0,0);
    blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',0.92));ext='webp';
    if(!blob||blob.type!=='image/webp'){blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));ext='png';}
    if(!blob)throw new Error('无法转换这张 JPEG 图片');
    if(blob.size>IMAGE_LIMIT)throw new Error('图片转换后过大（上限 6 MB）');
  }
  const side=64,c=canvas(side,side),g=c.getContext('2d');g.drawImage(bitmap,0,0,side,side);
  const data=g.getImageData(0,0,side,side).data;for(let i=3;i<data.length;i+=4)if(data[i]<250){alpha=true;break;}
  let autoColor;
  if(sampleColor&&(kind==='avatar'||kind==='sprite')){
    // Sample the committed encoding, so JPEG intake and a later offline fill agree.
    const sample=blob===file?bitmap:await createImageBitmap(blob);
    try{autoColor=figureBitmapAutoColor(sample,kind==='sprite',canvas(1,1));}finally{if(sample!==bitmap)sample.close();}
  }
  const warnings=[];
  if(kind==='sprite'&&!alpha)warnings.push('这张图没有透明背景，舞台上会显示整块底色');
  if(kind==='sprite'&&height<800)warnings.push('图片较小（高 '+height+'px），舞台上可能发糊');
  if(kind==='avatar'&&width!==height)warnings.push('头像不是正方形，显示时会居中裁切');
  return {bytes:new Uint8Array(await blob.arrayBuffer()),descriptor:{ext,mime:'image/'+ext,size:blob.size},width,height,warnings,autoColor,hasAlpha:alpha};
  } finally { bitmap.close?.(); }
}
const newResourceKey=prefix=>prefix+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
// A sprite this page can rewrite: a mouthless layered static manifest whose states are single stage images.
const imagePublisher=assetImagePublication.create({emotionState,newResourceKey});
const {simpleSpriteImages,spriteStateStatic,spriteSlotTakesStill,spriteManifestPaths,addSpriteStill,removeSpriteEmotion,ownSpriteDefinition,replaceOutfitSprite}=imagePublisher;
// Which image an emotion slot shows (pack-avatar.cjs precedence, without fallbacks to other slots): its uploaded
// avatar (already framed), else the crop of its own sprite state (manual state > manual outfit > auto > default).
function spriteCropFor(outfit,stateId) { return packSpriteCrop(outfit,stateId)||DEFAULT_AVATAR_CROP; }
function outfitImageId(outfit,id) { return outfit?.sprite?.imagePools ? outfit.sprite.imagePools[id]?.defaultImageId : id; }
function emotionState(outfit,manifest,id) {
  if(outfit?.sprite?.imagePools){const pool=outfit.sprite.imagePools[id];return pool?spriteEmotionState(manifest,pool.defaultImageId):null;}
  const own=manifest?.emotions?.[id];return own?{id,...own}:null;
}
function emotionSlot(figure,sprites,id,outfit=figure?.outfits?.find(o=>o.enabled)) {
  if(!outfit)return null;
  const imageId=outfit.sprite?.imagePools?.[id]?.defaultImageId||id;
  if(outfit.avatars?.[imageId])return {hash:outfit.avatars[imageId],crop:null,avatar:true};
  const state=emotionState(outfit,sprites?.[outfit.sprite?.manifestKey],id);
  const hash=state&&outfit.sprite.assets?.[state.stage?.src||state.src];
  if(hash)return {hash,stateId:state.id,crop:spriteCropFor(outfit,state.id)};
  if(outfit.live2d?.emotionMap?.[id])return {live2d:true};
  return null;
}

// ---------- Live2D (panel-ui-design.md §六之三) ----------
// library preview prefers Live2D; cast appearance never mutates the figure.
function figureForm(info) {
  const o=info.outfit;if(!o)return null;
  return o.live2d?'live2d':o.sprite?'sprite':null;
}
// A pack Live2D emotionMap entry is an expression name or {expression?, motion?} (asset-packs.md).
const live2dExpression=entry=>typeof entry==='string'?entry:entry&&typeof entry.expression==='string'?entry.expression:'';
const live2dMotion=entry=>entry&&typeof entry==='object'&&typeof entry.motion==='string'?entry.motion:'';
// The one row grammar of the modal: icon + short name in a fixed label column, the control fills the rest
// (same height and left edge for every control). `htmlFor` makes the name the label of the first native control.
function Row({icon,label,htmlFor,help,className,children,...rest}) {
  return h('div',{className:'ap-form-row'+(className?' '+className:''),...rest},
    h('span',{className:'ap-form-label'},icon&&h(Glyph,{name:icon}),htmlFor?h('label',{htmlFor},label):h('span',null,label),help&&h(Help,{text:help,label:label+' 说明'})),
    h('div',{className:'ap-form-control'},children));
}
// the shared `fork-edit` look (plain text at rest; tint, caret and ✎ on hover).
function CommitInput({value,onCommit,validate,multiline,count,...props}) {
  const [draft,setDraft]=React.useState(value),[error,setError]=React.useState(''),last=React.useRef(value);
  React.useEffect(()=>{if(value!==last.current){last.current=value;setDraft(value);}},[value]);
  function commit(){const problem=validate?.(draft)||'';setError(problem);if(problem||draft===value)return;last.current=draft;onCommit(draft);}
  return h(React.Fragment,null,h(multiline?'textarea':'input',{...props,className:'fork-edit'+(props.className?' '+props.className:''),value:draft,'aria-invalid':!!error||undefined,onChange:e=>{setDraft(e.target.value);setError('');},onBlur:commit,
    onKeyDown:e=>{if(!multiline&&e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'&&draft!==value){e.stopPropagation();setDraft(value);setError('');}}}),count&&h('span',{className:'ap-counter','data-over':[...String(draft||'')].length>count||undefined},[...String(draft||'')].length+' / '+count),error&&h('span',{className:'ap-field-error',role:'alert'},error));
}
// `text` (optional) is a shorter visible caption; the input keeps the full accessible name.
function UploadButton({label,text,onFile,disabled,primary}) {
  return h('label',{className:'ap-file-button'+(primary?' is-accent':''),'data-disabled':disabled||undefined,title:text?label:undefined},text?h(React.Fragment,null,h(Glyph,{name:'upload'}),text):label,h('input',{type:'file',accept:'image/png,image/webp,image/jpeg','aria-label':label,disabled,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file);}}));
}
function useUpload() {
  const [busy,setBusy]=React.useState(''),[error,setError]=React.useState(''),[warnings,setWarnings]=React.useState([]);
  async function run(label,fn){setBusy(label);setError('');setWarnings([]);try{const result=await fn();if(Array.isArray(result))setWarnings(result);return true;}catch(e){setError(errorText(e));return false;}finally{setBusy('');}}
  const lines=h(React.Fragment,null,busy&&h('p',{className:'ap-loading',role:'status'},h(Spinner),busy),
    warnings.map(w=>h('p',{key:w,className:'ap-warn'},w)),error&&h('p',{className:'ap-alert',role:'alert'},error));
  return {busy,run,lines};
}
// the old 头像裁切 editor (a crop rectangle stored on the 立绘, shown only
// while no avatar file existed) is gone; 「从立绘裁切…」 frames the 立绘 into an avatar file (figure editor, ImageFramer).
// Where a stored crop came from (the figure editor's head box trusts an author's crop over estimated anatomy).
function cropSource(outfit,stateId){const s=outfit?.sprite;if(s?.avatarCrop?.[stateId])return 'state';if(outfit?.avatarCrop)return 'outfit';if(s?.avatarCropAuto?.[stateId])return 'auto';return 'default';}
// A thumbnail with small round icon buttons pinned to its corners (`pos`: br / bl / tr). An action with `onFile` is an
// image upload (a label around a hidden file input, so it stays keyboard-reachable); the rest are icon buttons.
function MediaTile({className,actions=[],children}) {
  return h('span',{className:'ap-media'+(className?' '+className:'')},children,
    actions.filter(Boolean).map(a=>a.onFile?h(IconUpload,{key:a.label,...a}):
      h(Button,{key:a.label,className:'ap-overlay','data-pos':a.pos,'aria-label':a.label,title:a.label,disabled:a.disabled,onClick:a.onClick},h(Glyph,{name:a.icon}))));
}
// Image upload as an icon: pinned to a thumbnail corner (`pos`) or a plain icon button in a tool group.
function IconUpload({label,onFile,disabled,pos,icon='upload'}) {
  return h('label',{className:(pos?'ap-overlay':'ap-icon-button')+' ap-file-button','data-pos':pos,'data-disabled':disabled||undefined,title:label},h(Glyph,{name:icon}),
    h('input',{type:'file',accept:'image/png,image/webp,image/jpeg','aria-label':label,disabled,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file);}}));
}