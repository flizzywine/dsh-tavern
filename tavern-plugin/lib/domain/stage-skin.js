// dsh.skin/1: a stage skin is a data document - colours, closed words, numbers and bundle file names, never code, CSS
// or URLs. Every field means the same thing for every skin; the engine has no branch on a skin id. The check is closed:
// an unknown field, a value out of range or a word outside its list rejects the whole document. A skin is checked once,
// where it enters; the stage draws what it is given and a missing optional part only leaves that part out.
// Shared by the host and the browser (@include-domain): no imports, no host or DOM access.
const skinColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const skinId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const skinNumber = (min,max,integer = false) => value => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const skinEnum = values => value => values.includes(value);
const skinArray = (item,min,max) => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(item);
const skinObject = (fields,required = []) => value => value !== null && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => Object.hasOwn(fields,key) && fields[key](value[key]));
const skinText = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const skinPaint = skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor},['bg','fg']);
const skinRings = (count,width) => skinArray(skinObject({width:skinNumber(1,width),color:skinColor},['width','color']),0,count);
const skinBand = skinObject({pattern:skinEnum(['staff','rule','dots','stripes','teeth','scanlines','fence','stained','lace','checker','chain']),colors:skinArray(skinColor,1,4),height:skinNumber(2,22),inset:skinNumber(0,60),offset:skinNumber(0,20)},['pattern','colors']);
// figureSlots: where 1..6 figures stand, per count, as ascending fractions of the stage width.
const skinSlots = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key,slots]) => /^[1-6]$/.test(key) && skinArray(skinNumber(0.1,0.9),Number(key),Number(key))(slots) && slots.every((x,i) => i === 0 || x > slots[i-1]));
const skinFile = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.(ogg|m4a|mp3|wav)$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
// A bundle image: PNG / WebP or a static SVG, a lower-case path relative to skin.json. skinFile is a short audio cue.
const skinImage = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.(png|webp|svg)$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const skinPx = skinNumber(-4096,4096);
// art.spinner: a loading mark - one image (spin / sway / pulse / none) or an equal-cell sheet played at fps.
const skinSpinnerMark = {image:skinImage,motion:skinEnum(['spin','sway','none','pulse','frames']),period:skinNumber(.2,10),loop:skinEnum([true,false]),fps:skinNumber(.1,60),
    sheet:skinObject({columns:skinNumber(1,256,true),rows:skinNumber(1,256,true),frames:skinNumber(2,256,true)},['columns','rows','frames'])};
const skinSpinnerTiming = mark => mark.sheet ? !!mark.fps && mark.sheet.frames <= mark.sheet.columns * mark.sheet.rows && mark.period === undefined && (!mark.motion || mark.motion === 'frames') : mark.fps === undefined && mark.motion !== 'frames';
// scale: design px per image px of an element's image (one value, or [x, y]); omitted = natural size.
const skinScale = value => skinNumber(.25,8)(value) || skinArray(skinNumber(.25,8),2,2)(value);
// font.faces: up to four WOFF2 faces shipped with the skin; font.body / name / ui / film name a face or a library font.
const skinFontFile = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.woff2$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const skinFontFace = skinObject({file:skinFontFile,weight:skinNumber(100,900,true),fallback:skinId,source:skinEnum(['original','tuned'])},['file','weight']);
const skinFontFaces = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 4 && Object.entries(value).every(([key,face]) => skinId(key) && skinFontFace(face));
// The generic part shapes (the engine gives the shape, the skin fills it): quickMenu.icons, a buttonArt body per state
// (normal, hover, on, disabled) with the action's glyph in its glyph box [x, y, w, h] (fractions of the body), a 9-slice
// [top, right, bottom, left] (or {edges}) usable by every slot that slices, and frames: an image as a sheet of equal cells
// played row-major at fps (count, loop; reduced motion holds the rest frame). playable = an image or {image, frames}.
const skinQuickIcon = skinObject({image:skinImage,on:skinImage},['image']);
const skinQuickIcons = skinObject(Object.fromEntries(['auto','skip','hide','back','backlog','menu'].map(id => [id,skinQuickIcon])));
const skinButtonArt = skinObject({normal:skinImage,hover:skinImage,on:skinImage,disabled:skinImage,
    glyph:value => skinArray(skinNumber(0,1),4,4)(value) && value[2] > 0 && value[3] > 0 && value[0] + value[2] <= 1 && value[1] + value[3] <= 1},['normal','glyph']);
const skinSliceEdges = skinArray(skinNumber(0,4096),4,4);
const skinSlice = value => skinSliceEdges(value) || skinObject({edges:skinSliceEdges},['edges'])(value);
const skinFrames = value => skinObject({columns:skinNumber(1,16,true),rows:skinNumber(1,16,true),count:skinNumber(2,256,true),fps:skinNumber(1,30),loop:skinEnum([true,false])},['columns','rows','fps'])(value)
    && value.columns * value.rows >= 2 && (value.count ?? 2) <= value.columns * value.rows;
const skinPlayable = value => skinImage(value) || skinObject({image:skinImage,frames:skinFrames},['image','frames'])(value);
// quickMenu: the control row's paint and layout; place puts it on the text box, narrow (top / bottom / edge) where that
// row stands on phones (needs place); icons and button draw it from the bundle (button needs icons).
const skinQuickMenu = value => skinObject({bg:skinColor,fg:skinColor,layout:skinEnum(['bar','capsule','orb']),place:skinEnum(['box-top-right','box-bottom-right']),narrow:skinEnum(['top','bottom','edge']),icons:skinQuickIcons,button:skinButtonArt},['bg','fg'])(value) && (!value.button || Boolean(value.icons)) && (!value.narrow || Boolean(value.place));
const skinNameSide = skinObject({x:skinPx,align:skinEnum(['start','end']),rotate:skinNumber(-15,15)},['x']);
// The one pose vocabulary of skin motion: offsets, rotation, scale (sx / sy per axis) and brightness, never translucent.
// A motion plays 2-6 key poses at `at` (0..1 of ms); a stage (menu items) enters or leaves from one pose with a stagger.
const skinPoseFields = {dx:skinNumber(-4096,4096),dy:skinNumber(-4096,4096),rot:skinNumber(-180,180),scale:skinNumber(0,4),sx:skinNumber(0,4),sy:skinNumber(0,4),bright:skinNumber(0,3)};
const skinPose = value => skinObject(skinPoseFields)(value) && Object.keys(value).length > 0;
const skinEase = skinEnum(['linear','out','in-out','back']);
const skinMotion = value => skinObject({ms:skinNumber(60,3000),ease:skinEase,keys:skinArray(skinObject({...skinPoseFields,at:skinNumber(0,1)},['at']),2,6)},['ms','keys'])(value)
    && value.keys[0].at === 0 && value.keys.at(-1).at === 1 && value.keys.every((key,i) => i === 0 || key.at > value.keys[i-1].at);
const skinStage = skinObject({pose:skinPose,ms:skinNumber(40,1500),stagger:skinNumber(0,200),ease:skinEase,fade:value => value === true},['pose','ms']);
// textFx.poses: a glyph's entrance poses on the reveal's step clock (em, degrees, blur em, ink).
const skinGlyphPose = skinObject({dx:skinNumber(-1,1),dy:skinNumber(-1,1),rot:skinNumber(-45,45),scale:skinNumber(0,3),sx:skinNumber(0,3),sy:skinNumber(0,3),skew:skinNumber(-45,45),
    blur:skinNumber(0,.5),ink:skinEnum(['flash','fg','accent'])});
// sfx: the skin's sound palette, a short file per cue; a cue it leaves out keeps the engine's own sound.
const STAGE_SKIN_SFX_CUES = ['open','close','move','confirm','cancel','toggle','choice','page','type','auto','skip','name'];
const skinSfxCue = value => skinFile(value) || skinObject({file:skinFile,gain:skinNumber(0,2),every:skinNumber(1,8,true),pitch:skinNumber(0,.2)},['file'])(value);
const skinSfx = skinObject(Object.fromEntries(STAGE_SKIN_SFX_CUES.map(cue => [cue,skinSfxCue])));
// art.buttons / art.decor: images placed from the stage edges (exactly one of top / bottom and of left / right); a hint
// swaps the image's own key prompt for a key cap of the action's real key.
const skinArtHint = skinObject({action:skinEnum(['backlog','auto','skip','menu']),w:skinNumber(1,512),h:skinNumber(8,256)},['w','h']);
const skinArtButton = value => skinObject({image:skinImage,on:skinImage,tint:skinImage,scale:skinScale,hint:skinArtHint,left:skinPx,right:skinPx,top:skinPx,bottom:skinPx},['image'])(value)
    && Object.hasOwn(value,'left') !== Object.hasOwn(value,'right') && Object.hasOwn(value,'top') !== Object.hasOwn(value,'bottom');
const skinArtDecor = value => skinObject({image:skinImage,scale:skinScale,left:skinPx,right:skinPx,top:skinPx,bottom:skinPx},['image'])(value)
    && Object.hasOwn(value,'left') !== Object.hasOwn(value,'right') && Object.hasOwn(value,'top') !== Object.hasOwn(value,'bottom');
// art.cast: per-figure art of the skin's own pack, keyed by figure id (box, plate, band, name ink).
const skinInk = skinArray(skinColor,2,2);
const skinCastKey = key => /^[a-z0-9][a-z0-9-]{0,63}$/.test(key);
const skinNameBand = skinObject({image:skinImage,x:skinPx,y:skinPx,h:skinNumber(1,256),tail:skinPx,tint:value => value === true,sweep:skinNumber(40,2000)},['image','y','h']);
const skinCastEntry = skinObject({box:skinImage,plate:skinImage,band:value => value === false || skinObject({image:skinImage,tail:skinPx},['image'])(value),name:skinObject({fill:skinInk,border:skinColor})});
const skinCast = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key,entry]) => skinCastKey(key) && skinCastEntry(entry));
// art.portrait: the speaker's face window (left / bottom / size) or a bust cut from the stage figure, an optional frame
// image (round / front / glass / back / fill / speaking), a mood caption, the name set along an arc on the frame (stroke,
// shadow, bed and min keep it legible) and narrow: where the face side stands on phones.
const skinBust = skinObject({head:value => skinArray(skinPx,3,3)(value) && value[2] >= 16,crop:skinArray(skinNumber(0,8),3,3),
    enter:skinObject({dx:skinPx,alpha:skinNumber(0,1),ms:skinNumber(1,2000),curve:skinEnum(['hold','out'])},['ms'])},['head','crop']);
const skinPortraitMood = value => skinObject({rect:skinArray(skinPx,4,4),font:skinNumber(8,256),ink:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(-0.2,0.5)},['rect','font','ink'])(value)
    && value.rect[2] > 0 && value.rect[3] > 0;
const skinPortraitName = value => skinObject({arc:skinArray(skinPx,3,3),side:skinEnum(['bottom','top']),span:skinNumber(20,300),font:skinNumber(8,256),
    ink:ink => skinColor(ink) || skinArray(skinColor,2,2)(ink),weight:skinEnum([400,500,700,900]),spacing:skinNumber(-0.2,0.8),
    engrave:skinObject({light:skinColor,dark:skinColor},['light','dark']),voice:skinArray(skinPx,2,2),
    stroke:skinObject({color:skinColor,width:skinNumber(0.25,16)},['color','width']),shadow:skinObject({color:skinColor,dx:skinNumber(-8,8),dy:skinNumber(-8,8)},['color','dy']),
    bed:skinObject({color:skinColor,alpha:skinNumber(0,1),width:skinNumber(1,512)},['color','alpha']),min:skinNumber(4,256)},['arc','font','ink'])(value)
    && value.arc[2] > 0 && !(value.min > value.font);
const skinPortraitFrame = value => skinObject({image:skinImage,left:skinPx,bottom:skinPx,window:skinArray(skinPx,4,4),mood:skinPortraitMood,
    round:round => round === true,front:front => front === true,glass:skinImage,back:skinImage,fill:fill => skinColor(fill) || skinArray(skinColor,2,2)(fill),speaking:skinImage,name:skinPortraitName},['image','left','bottom'])(value)
    && (!value.window || value.window[2] > 0 && value.window[3] > 0);
const skinPortraitNarrow = skinObject({width:skinNumber(32,240),x:skinNumber(-64,240),y:skinNumber(-240,240),name:skinEnum(['below','arc']),nameMin:skinNumber(6,24),flow:skinEnum(['beside','wrap','below']),left:skinNumber(0,120)},['width','x','y']);
const skinPortrait = value => skinObject({left:skinPx,bottom:skinPx,size:skinNumber(32,4096),source:skinEnum(['avatar','bust']),bust:skinBust,frame:skinPortraitFrame,narrow:skinPortraitNarrow},['left','bottom','size'])(value)
    && (value.source === 'bust') === Object.hasOwn(value,'bust') && !(value.frame && value.source === 'bust') && !(value.narrow?.name && !value.frame?.name);
// art.item: how the items card looks in this skin (frame, media box, entrance, phone placement, gain toast).
const skinItemToast = value => skinObject({image:skinImage,box:skinArray(skinPx,4,4),text:value => typeof value === 'string' && value.length > 0 && value.length <= 40,font:skinNumber(8,256),ink:skinColor,fadeMs:skinNumber(0,1000)},['image','box','text','font'])(value)
    && value.box[2] > 0 && value.box[3] > 0;
const skinItem = value => skinObject({frame:skinImage,box:skinArray(skinPx,4,4),media:skinArray(skinNumber(1,4096),2,2),enter:skinObject({ms:skinNumber(0,1000),rise:skinNumber(0,1024)}),
    narrow:skinObject({width:skinNumber(.2,1),y:skinNumber(.05,.95)},['width','y']),gain:skinObject({hideText:item => typeof item === 'boolean',toast:skinItemToast})},['frame','box','media'])(value)
    && value.box[2] > 0 && value.box[3] > 0;
// A soft halo under text (offset, blur, colour, opacity); initials sets a name in parts of different sizes.
const skinHalo = skinObject({x:skinNumber(-64,64),y:skinNumber(-64,64),blur:skinNumber(0,64),color:skinColor,alpha:skinNumber(0,1)},['blur','color']);
const skinInitials = skinObject({lead:skinNumber(8,512),rest:skinNumber(8,512),given:skinArray(skinNumber(8,512),2,2),gap:skinNumber(0,128),drop:skinNumber(-64,64)},['lead','rest','given']);
// modes.<id>: while the current performance declares skinMode <id>, the text reads as a large statement over the scene,
// with optional mode-only buttons and HUD rules.
const skinPlace = value => skinArray(skinNumber(-4096,4096),3,3)(value) && Math.abs(value[2]) <= 45;
const skinStatement = skinObject({font:skinNumber(8,512),pitch:skinNumber(8,1024),width:skinNumber(64,8192),lines:skinNumber(1,8,true),stroke:skinNumber(0,32),
    halo:skinHalo,weight:skinEnum([400,500,600,700,800,900]),places:skinObject({plain:skinPlace,left:skinPlace,center:skinPlace,right:skinPlace},['plain'])},['font','pitch','width','lines','places']);
const skinModeButtons = value => skinObject({backlog:skinArtButton,auto:skinArtButton,skip:skinArtButton,menu:skinArtButton})(value) && Object.keys(value).length >= 1;
const skinHudHide = value => skinArray(skinEnum(['backlog','auto','skip','menu']),1,4)(value) && new Set(value).size === value.length;
const skinModeHud = value => skinObject({hide:skinHudHide,
    beside:skinEnum(['timer']),gap:skinNumber(-512,512)})(value) && Boolean(value.hide || value.beside) && (value.gap === undefined || Boolean(value.beside));
const skinModes = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length >= 1 && Object.keys(value).length <= 4
    && Object.entries(value).every(([key,mode]) => skinId(key) && skinObject({statement:skinStatement,buttons:skinModeButtons,hud:skinModeHud},['statement'])(mode)
        && (!mode.hud?.beside || Boolean(mode.buttons)));
// art.menu: the stage menu drawn as rows (9-sliced bars) or tiles, with title / info / key strips, a frame, motion and a
// signal lamp. art.backlog / art.config / art.confirm / art.voice draw the other stage overlays the same way.
const skinMenuStrip = skinObject({image:skinImage,x:skinPx,y:skinPx,text:skinArray(skinNumber(0,8192),3,3),font:skinNumber(8,256),ink:skinColor,align:skinEnum(['start','center','end']),vertical:value => value === true,
    rule:skinObject({image:skinImage,gap:skinNumber(0,512)},['image'])},['x','y','text','font']);
const skinHighlight = skinObject({image:skinImage,out:skinArray(skinNumber(-1024,1024),4,4)},['image']);
const SKIN_MENU_ACTIONS = ['resume','backlog','auto','skip','gallery','latest','regenerate','config','keys','leave'];
const SKIN_MENU_ALWAYS = ['resume','backlog','gallery','config','keys','leave'];
const skinMenuTile = skinObject({image:skinImage,focus:skinImage,at:skinArray(skinPx,2,2),bare:value => value === true,label:skinObject({y:skinPx},['y'])},['image']);
const skinMenuTileArt = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length >= 1
    && Object.entries(value).every(([key,tile]) => SKIN_MENU_ACTIONS.includes(key) && skinMenuTile(tile) && (!tile.at || SKIN_MENU_ALWAYS.includes(key)) && (!tile.bare || !!tile.at));
const skinMenuTiles = skinObject({x:skinPx,y:skinPx,w:skinNumber(16,2048),h:skinNumber(16,2048),pitch:skinArray(skinNumber(0,2048),2,2),cols:skinNumber(1,6,true),fit:skinNumber(16,4096),
    offset:skinArray(skinPx,2,2),art:skinMenuTileArt,plain:skinImage,hover:skinHighlight,
    number:skinObject({x:skinPx,y:skinPx,font:skinNumber(8,512),ink:skinColor,focusInk:skinColor,stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width'])},['x','y','font']),
    tilt:skinArray(skinNumber(-10,10),1,8),lift:skinObject({scale:skinNumber(.8,1.3),dy:skinNumber(-64,64)}),
    label:skinObject({y:skinPx,font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,lead:skinNumber(1,3),weight:skinEnum([400,500,700]),halo:skinHalo,align:skinEnum(['start','center']),x:skinPx,
        stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width'])},['y','font'])},
    ['x','y','w','h','pitch','cols','art','label']);
const skinMenuFrame = skinObject({image:skinImage,x:skinPx,y:skinPx,scale:skinScale,rotate:skinNumber(-45,45)},['image','x','y']);
const skinMenuSignal = skinObject({image:skinImage,alert:skinImage,x:skinPx,y:skinPx,on:skinArray(skinEnum(SKIN_MENU_ACTIONS),1,10)},['image','alert','x','y','on']);
const skinMenu = value => skinObject({sheet:skinImage,frame:skinMenuFrame,tiles:skinMenuTiles,dim:skinNumber(0,1),blur:skinNumber(0,64),grey:skinNumber(0,1),signal:skinMenuSignal,
    motion:skinObject({enter:skinStage,leave:skinStage,frame:skinStage,frameOut:skinStage}),decor:skinEnum(['hide']),
    rows:skinObject({images:skinObject({plain:skinImage,focus:skinImage,off:skinImage},['plain','focus']),slice:skinSlice,text:skinArray(skinNumber(0,4096),3,3),
        font:skinNumber(8,256),x:skinPx,y:skinPx,gap:skinNumber(0,512),ink:skinColor,focusInk:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(0,0.5),align:skinEnum(['start','center','end']),cursor:skinObject({image:skinImage,x:skinPx,y:skinPx},['image','x','y'])},
        ['images','slice','text','font','x','y','gap']),
    title:skinMenuStrip,info:skinMenuStrip,keys:skinMenuStrip})(value) && Object.hasOwn(value,'rows') !== Object.hasOwn(value,'tiles');
const skinArtPlaced = skinObject({image:skinImage,focus:skinImage,scale:skinScale,x:skinPx,y:skinPx},['image','x','y']);
const skinArtScreen = {sheet:skinImage,dim:skinNumber(0,1),title:skinArtPlaced,close:skinArtPlaced,ink:skinColor,font:skinNumber(8,256)};
const skinRect = skinArray(skinNumber(-4096,8192),4,4);
const skinBacklog = skinObject({...skinArtScreen,list:skinRect,pitch:skinNumber(8,512),text:skinArray(skinNumber(0,8192),2,2),top:skinNumber(0,512),gap:skinNumber(0,512),
    voice:skinRect,name:skinObject({x:skinPx,y:skinPx,h:skinNumber(1,1024),font:skinNumber(8,512),head:skinNumber(0,1024),frame:skinArtPlaced,rule:skinArtPlaced},['x','y','h','font','head']),
    scrollbar:skinObject({track:skinImage,thumb:skinImage,x:skinPx,y:skinPx,w:skinNumber(1,256),h:skinNumber(16,4096)},['track','thumb','x','y','w','h']),
    hover:skinHighlight},['list','font','pitch','text','gap']);
const skinConfig = skinObject({...skinArtScreen,
    tabs:skinObject({images:skinObject({plain:skinImage,on:skinImage},['plain','on']),x:skinPx,y:skinPx,pitch:skinNumber(8,1024),text:skinArray(skinNumber(0,4096),3,3),font:skinNumber(8,256),scale:skinScale},['images','x','y','pitch','text','font']),
    page:skinRect,row:skinNumber(16,1024),control:skinNumber(64,4096),focus:skinImage,
    slider:skinObject({track:skinImage,fill:skinImage,frame:skinImage,thumb:skinImage,focus:skinImage,h:skinNumber(4,256),thumbSize:skinNumber(4,256)},['track','fill','thumb','h','thumbSize']),
    toggle:skinObject({plain:skinImage,on:skinImage,focus:skinImage,frame:skinImage,h:skinNumber(8,256)},['plain','on','h']),
    select:skinObject({plain:skinImage,focus:skinImage,h:skinNumber(8,256),ink:skinColor},['plain','h'])},['page','font','row','control']);
const skinVoice = value => skinObject({image:skinImage,focus:skinImage,active:skinImage,box:box => box === false})(value) && (Object.hasOwn(value,'image') || value.box === false)
    && (Object.hasOwn(value,'image') || !value.focus && !value.active);
const skinConfirm = skinObject({band:skinImage,top:skinImage,bottom:skinImage,h:skinNumber(64,4096),pad:skinArray(skinNumber(0,2048),2,2),gap:skinNumber(0,1024),
    width:skinNumber(64,8192),dim:skinNumber(0,1),font:skinNumber(8,256),ink:skinColor,
    button:skinObject({plain:skinImage,focus:skinImage,font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,lead:skinColor,gap:skinNumber(0,1024)},['plain','focus','font'])},
    ['band','h','font','button']);
// art.shape: the text box as vector parts in design px; points stretch with the page's text width and line count, and
// each page may turn by one of turn.deg about turn.pivot.
const skinShapeNumber = skinNumber(-8192,8192);
const skinShapePoint = value => skinArray(skinShapeNumber,2,4)(value) && value.length !== 3;
const skinShapeStretch = skinObject({base:skinShapeNumber,width:skinNumber(-8,8),line:skinNumber(-1024,1024),min:skinShapeNumber},['base']);
const skinShapePart = value => skinObject({paint:skinEnum(['bg','border','name']),edge:skinNumber(0,64),points:skinArray(skinShapePoint,3,256),
    ellipse:item => skinArray(skinShapeNumber,7,7)(item) && item[4] > 0 && item[5] > 0},['paint'])(value) && Object.hasOwn(value,'points') !== Object.hasOwn(value,'ellipse');
const skinShapeBox = skinObject({stretch:skinObject({x:skinShapeStretch,y:skinShapeStretch},['x']),turn:skinObject({pivot:skinArray(skinShapeNumber,2,2),deg:skinArray(skinNumber(-45,45),1,8)},['pivot','deg']),
    origin:skinArray(skinShapeNumber,2,2),parts:skinArray(skinShapePart,1,32),still:skinArray(skinShapePart,1,32)},['parts']);
const skinShape = skinObject({view:value => skinArray(skinShapeNumber,4,4)(value) && value[2] > 0 && value[3] > 0,boxes:skinArray(skinShapeBox,1,6),narration:skinShapeBox},['view','boxes']);
// art: the art layer, in px of a design screen (screen high, screenWidth wide). Images come from the skin's bundle; a
// declared image missing there drops the whole art layer, never part of it.
const skinArtShape = skinObject({
    screen:skinNumber(240,4096),screenWidth:skinNumber(240,8192),
    textbox:value => skinObject({images:skinObject({plain:skinImage,left:skinImage,center:skinImage,right:skinImage,narration:skinImage},['plain']),body:skinArray(skinNumber(0,4096),4,4),
        bottom:skinNumber(0,4096),text:skinArray(skinNumber(0,4096),3,3),font:skinNumber(8,256),lines:skinNumber(1,3,true),cue:value => value === 'inline' || skinArray(skinNumber(0,4096),3,3)(value),rise:skinNumber(0,256),
        controls:skinObject({x:skinPx,y:skinPx,size:skinNumber(16,256),w:skinNumber(16,512),gap:skinNumber(0,256)},['x','y','size']),
        readout:skinObject({kind:skinEnum(['clock']),x:skinPx,y:skinPx,font:skinNumber(8,256),ink:skinColor,label:value => skinText(value) && value.length <= 24,align:skinEnum(['start','end'])},['kind','x','y','font']),
        slice:skinSlice,
        pitch:skinNumber(8,512),align:skinEnum(['top']),lamp:value => skinObject({image:skinImage,x:skinPx,y:skinPx,motion:skinEnum(['blink','spin']),period:skinNumber(.2,10),swap:value => value === true,scale:skinScale,frames:skinFrames},['image','x','y'])(value)
            && !(value.frames && (value.motion || value.period !== undefined)),
        span:skinEnum(['stage']),next:skinPlayable,bob:skinEnum(['dip','blink']),halo:skinHalo,
        tint:skinObject({by:skinEnum(['speaker']),masks:skinObject({plain:skinImage,left:skinImage,center:skinImage,right:skinImage},['plain']),cue:cue => cue === true,menu:menu => menu === true},['by','masks']),scale:skinScale,
        fit:skinNumber(.5,1),stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width'])},
        ['images','body','bottom','text','font','lines'])(value),
    nameplate:value => skinObject({x:skinPx,y:skinPx,w:skinNumber(0,4096),h:skinNumber(4,512),font:skinNumber(8,256),stroke:skinNumber(0,16),emblem:skinArray(skinPx,3,3),image:skinImage,text:skinNumber(0,4096),weight:skinEnum([400,500,700]),scale:skinScale,
        slice:skinSlice,grow:skinNumber(0,2048),pad:skinArray(skinNumber(0,4096),2,2),
        vertical:vertical => vertical === true,printed:printed => printed === true,sides:skinObject({left:skinNameSide,center:skinNameSide,right:skinNameSide}),
        halo:skinHalo,initials:skinInitials,lift:skinNumber(-256,256),fill:skinInk,shadow:skinArray(skinNumber(-32,32),2,2),spacing:skinNumber(-0.2,0.5),band:skinNameBand,center:skinNumber(0,4096),rotate:skinNumber(-15,15),narrow:skinEnum(['pill'])},['x','y','h','font'])(value) && !(value.printed && value.image) && !(value.slice && !value.image) && !((value.grow !== undefined || value.pad) && !value.slice),
    cast:skinCast,
    decor:skinArray(skinArtDecor,1,8),
    narration:skinObject({font:skinNumber(8,256),pitch:skinNumber(8,512),veil:skinNumber(0,.9),y:skinNumber(0,4096),
        band:skinObject({font:skinNumber(8,256),pitch:skinNumber(8,512),veil:skinNumber(0,.9),bottom:skinNumber(0,4096)},[]),
        lines:skinObject({fade:skinNumber(0,5),stagger:skinNumber(0,5),rise:skinNumber(0,256)},['fade','stagger'])},['font','pitch','veil']),
    choices:value => skinObject({images:skinObject({plain:skinImage,off:skinImage,alt:skinImage},['plain']),slice:skinSlice,text:skinArray(skinNumber(0,4096),3,3),band:skinArray(skinNumber(0,4096),2,2),
        font:skinNumber(8,256),pitch:skinNumber(8,512),gap:skinNumber(-512,512),center:skinNumber(0,4096),anchor:skinEnum(['stage','above-box']),x:skinNumber(0,8192),align:skinEnum(['left','center','right']),tilt:skinArray(skinNumber(-15,15),2,2),stagger:skinArray(skinNumber(-512,512),2,2),tint:skinImage,
        tool:tool => skinObject({image:skinImage,x:skinNumber(0,4096),h:skinNumber(8,1024),tint:skinImage,send:skinImage,button:skinButtonArt,ink:ink => skinColor(ink) || skinArray(skinColor,2,2)(ink)},['x','h'])(tool)
            && (tool.button ? !tool.image && !tool.send && !tool.tint : Boolean(tool.image && tool.send) && !tool.ink),
        ink:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(0,.5),focus:skinObject({image:skinImage,ink:skinColor,dx:skinNumber(-256,256),alt:skinImage,ray:skinObject({color:skinColor,alt:skinColor,width:skinNumber(1,16)},['color','width'])},['image']),
        number:skinObject({x:skinNumber(0,4096),font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,dy:skinNumber(-256,256),free:value => typeof value === 'string' && /^[^"\\]{1,3}$/.test(value),
            prefix:value => typeof value === 'string' && /^[^"\\]{1,8}$/.test(value)},['x','font'])},['images','slice','text','font','pitch','gap'])(value) && Object.hasOwn(value,'center') !== Object.hasOwn(value,'anchor'),
    buttons:skinObject({backlog:skinArtButton,auto:skinArtButton,skip:skinArtButton,menu:skinArtButton}),
    menu:skinMenu,
    backlog:skinBacklog,config:skinConfig,voice:skinVoice,confirm:skinConfirm,
    portrait:skinPortrait,
    shape:skinShape,
    item:skinItem,
    spinner:skinObject({...skinSpinnerMark,at:skinArray(skinNumber(0,8192),3,3),scale:skinNumber(.1,8),place:skinEnum(['center','bottom-right']),words:skinEnum([true,false]),
        parts:skinArray(skinObject({...skinSpinnerMark,box:skinArray(skinNumber(0,8192),4,4)},['image','box']),2,4)},[])
},['screen']);
// effects: how the core effects look in this skin, each merged over the engine's default; the director only names the id.
const skinFade = skinNumber(0,3);
const skinEffectFlash = value => skinObject({color:skinColor,peak:skinNumber(0,1),in:skinFade,hold:skinFade,out:skinFade,tail:skinFade,cycles:skinNumber(1,3,true),ease:skinEnum(['out','sine','linear'])})(value) && Object.keys(value).length > 0;
const skinEffectShake = value => skinObject({amp:skinNumber(0,.1),ms:skinNumber(50,3000),path:skinArray(skinArray(skinNumber(-200,200),2,2),1,24),step:skinNumber(.01,1),target:skinEnum(['screen','background'])})(value)
    && Object.keys(value).length > 0 && Object.hasOwn(value,'path') === Object.hasOwn(value,'step');
const STAGE_SKIN_LOOK_KEYS = ['exposure','contrast','saturation','temperature','tint','lift','gamma','gain','mixer','split','invert','keepHue','posterize','vignette','haze','grain','scratches','bloom','chroma','distortion','wobble','flare','scanlines','pixelate','halftone','backBlur','ui','soften'];
const skinLookValue = value => Number.isFinite(value) || typeof value === 'boolean' || skinColor(value) || Array.isArray(value) && value.length <= 9 && value.every(Number.isFinite)
    || value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 8 && Object.values(value).every(item => Number.isFinite(item) || skinColor(item) || Array.isArray(item) && item.length <= 3 && item.every(Number.isFinite));
const skinLookParams = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key,item]) => STAGE_SKIN_LOOK_KEYS.includes(key) && skinLookValue(item));
const skinEffectLook = value => skinObject({params:skinLookParams,fade:skinArray(skinFade,2,2)})(value) && Object.keys(value).length > 0;
const STAGE_SKIN_EFFECTS = Object.freeze({
    flash:skinEffectFlash,'flash-red':skinEffectFlash,blackout:skinEffectFlash,
    'shake-1':skinEffectShake,'shake-2':skinEffectShake,'shake-3':skinEffectShake,
    shock:value => skinObject({flash:skinEffectFlash,wave:item => typeof item === 'boolean',waveMs:skinNumber(100,3000),shake:item => item === null || ['shake-1','shake-2','shake-3'].includes(item)})(value) && Object.keys(value).length > 0,
    glitch:skinObject({ms:skinNumber(100,2000)},['ms']),
    heartbeat:value => skinObject({color:skinColor,vignette:skinNumber(0,1),zoom:skinNumber(0,.1),ms:skinNumber(300,3000)})(value) && Object.keys(value).length > 0,
    blur:skinEffectLook,bright:skinEffectLook,contrast:skinEffectLook,memory:skinEffectLook,vignette:skinEffectLook,
    transition:value => skinObject({default:skinEnum(['cut','fade','black','white','wipe','iris','blink','slash']),out:skinFade,hold:skinFade,in:skinFade})(value) && Object.keys(value).length > 0,
    thinking:value => skinObject({image:skinImage,over:skinNumber(1,1.5),dim:skinNumber(0,.6),vignette:skinNumber(0,1),fade:skinArray(skinNumber(0,2),2,2)})(value) && Object.keys(value).length > 0
});
const skinEffects = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key,effect]) => Object.hasOwn(STAGE_SKIN_EFFECTS,key) && STAGE_SKIN_EFFECTS[key](effect));
const skinArt = value => skinArtShape(value) && (!value.portrait?.bust && !value.menu && !value.backlog && !value.config && !value.confirm && !value.item || Object.hasOwn(value,'screenWidth'))
    && [...Object.values(value.buttons || {}),value.choices || {},value.choices?.tool || {}].every(target => !target.tint || value.textbox?.tint)
    && (!value.choices?.band || value.choices.band[0] < value.choices.text[2] && value.choices.text[2] < value.choices.band[1])
    && Object.values(value.buttons || {}).every(button => !(button.tint && button.hint));
// The document. schema, id, label, textbox, nameplate, font and textFx are required; everything else falls back to the
// engine's look.
const stageSkinShape = skinObject({
    schema:skinEnum(['dsh.skin/1']),id:skinId,label:skinText,
    ui:skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor,radius:skinNumber(0,40),textShadow:skinEnum(['none']),titleFont:skinId,veil:skinObject({color:skinColor,opacity:skinNumber(0,1)},['color','opacity']),texture:skinEnum(['halftone'])}),
    license:skinObject({privateUse:value => typeof value === 'boolean',notes:skinArray(skinText,0,32),derived:skinArray(skinText,0,32)},['privateUse']),
    textbox:skinObject({layout:skinEnum(['box','scrim','card','slash','bubble','panel','band']),paint:skinPaint,motion:skinObject({page:skinMotion},['page']),shape:skinObject({radius:skinNumber(0,40),borderWidth:skinNumber(0,8),rings:skinRings(3,12)}),frame:skinObject({top:skinBand,bottom:skinBand,corners:skinObject({kind:skinEnum(['none','diamond','rivet','bow','bracket','flourish']),colors:skinArray(skinColor,0,2)},['kind']),insets:skinArray(skinNumber(24,80),4,4),texture:skinEnum(['halftone'])})},['paint']),
    nameplate:skinObject({shape:skinEnum(['pill','tag','torn','jagged','plate','plain','ribbon','underline','ransom','fade','emblem','chamfer','outline']),tint:skinEnum(['figure']),enter:skinEnum(['unfold']),paint:skinObject({bg:skinColor,fg:skinColor,border:skinColor},['bg','fg']),rotate:skinNumber(-3,3),size:skinNumber(18,40),letterSpacing:skinNumber(0,0.2),rings:skinRings(2,8),motion:skinMotion},['shape','paint']),
    font:skinObject({body:skinId,name:skinId,ui:skinId,film:skinId,faces:skinFontFaces}),
    textStyle:skinObject({weight:skinEnum([400,500,700]),sizeScale:skinNumber(0.85,1.2),lineHeight:skinNumber(1.4,1.9),letterSpacing:skinNumber(0,0.12),emphasis:skinColor,wrap:skinEnum(['phrase'])}),
    textFx:skinObject({reveal:skinEnum(['type','ink','pop','stutter','stamp','cut','scan','scrawl']),stepFps:skinNumber(6,14),charsPerStep:skinNumber(1,6,true),cps:skinNumber(10,80),from:skinEnum(['top','bottom']),flash:skinColor,emphasis:skinEnum(['none','jitter','ink']),jitter:skinNumber(0,1.5),
        poses:skinArray(skinGlyphPose,1,4)},['reveal']),
    cursor:skinObject({name:skinEnum(['triangle','wheel','lollipop','eye','rose','rec','candle','gear','light','bell','feather','needle','teacup','whale','ring','star','arrow','fleur','gem','sphere','play']),color:skinColor,accent:skinColor,fps:skinNumber(2,12)},['name']),
    quickMenu:skinQuickMenu,
    sfx:skinSfx,photosensitive:value => typeof value === 'boolean',figureSlots:skinSlots,
    maxFigures:skinNumber(1,6,true),
    figures:skinObject({scale:skinNumber(0.2,4),top:skinNumber(-0.2,0.6),mode:skinEnum(['stage','none']),ruler:skinNumber(100,250),spread:skinNumber(0.2,1)}),
    dimListeners:value => value === false,
    art:skinArt,
    hud:skinObject({reveal:skinEnum(['auto','always']),timer:skinObject({hide:skinHudHide},['hide'])}),
    effects:skinEffects,
    modes:skinModes
},['schema','id','label','textbox','nameplate','font','textFx']);
// WCAG contrast. Readable text is part of the contract: unsafe pairs reject the skin.
function skinLuminance(color) {
    const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
function skinContrast(a,b) {const x=skinLuminance(a),y=skinLuminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
const STAGE_SKIN_PLATE_ALPHA = Object.freeze({bubble:.86,panel:.8,band:.74});
function skinOver(front,back,alpha) {return '#'+[1,3,5].map(i => Math.round(parseInt(front.slice(i,i+2),16)*alpha+parseInt(back.slice(i,i+2),16)*(1-alpha)).toString(16).padStart(2,'0')).join('');}
function validateStageSkin(value) {
    if (!stageSkinShape(value) || new TextEncoder().encode(JSON.stringify(value)).length > 32768) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    const spinner=value.art?.spinner;
    if (spinner && (spinner.at && spinner.place || spinner.parts ? ['image','motion','period','loop','fps','sheet','at'].some(key => Object.hasOwn(spinner,key)) || !spinner.parts.every(part => skinSpinnerTiming(part) && part.box[2] > 0 && part.box[3] > 0)
        : !spinner.image || !skinSpinnerTiming(spinner))) throw Object.assign(new Error('Invalid skin loading animation'),{code:'INVALID_SKIN'});
    const paint=value.textbox.paint, name=value.nameplate.paint;
    const ui={...paint,...value.ui};
    const pairs=[...(value.ui ? [[ui.fg,ui.bg,4.5],[ui.fgMuted,ui.bg,3],[ui.accent,ui.bg,4.5],[ui.onAccent,ui.accent,4.5]] : []),[paint.fg,paint.bg,4.5],[paint.fgMuted,paint.bg,3],[value.textStyle?.emphasis || paint.accent || paint.fg,paint.bg,4.5],[paint.onAccent,paint.accent,4.5],
        [name.fg,['outline','chamfer'].includes(value.nameplate.shape) ? name.border : name.bg,4.5],[value.quickMenu?.fg,value.quickMenu?.bg,4.5],
        ...(value.nameplate.shape === 'ransom' ? [[name.fg,name.border,4.5]] : [])];
    if (pairs.some(([a,b,min]) => a && (!b || skinContrast(a,b)+1e-6 < min))) throw Object.assign(new Error('Skin text contrast is unsafe'),{code:'SKIN_CONTRAST'});
    if (value.textbox.layout === 'scrim' && skinLuminance(paint.bg) > 0.03) throw Object.assign(new Error('Skin scrim must be dark'),{code:'SKIN_CONTRAST'});
    const alpha=STAGE_SKIN_PLATE_ALPHA[value.textbox.layout];
    if (alpha && ['#000000','#ffffff'].some(scene => skinContrast(paint.fg,skinOver(paint.bg,scene,alpha))+1e-6 < 4.5)) throw Object.assign(new Error('Skin plate text contrast is unsafe over the scene'),{code:'SKIN_CONTRAST'});
    if (value.art?.nameplate?.printed && value.nameplate.tint) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    if (value.modes && !value.art) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    if ([value.hud?.timer,...Object.values(value.modes || {}).map(mode => mode.hud)].some(hud => hud?.hide?.some(action => !value.art?.buttons?.[action]))) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    const frame=value.textbox.frame;
    for (const [side,index,fallback] of [['top',0,42],['bottom',2,58]]) {
        const band=frame?.[side];
        if (band && (band.offset ?? 9)+(band.height ?? 14) > (frame.insets?.[index] ?? fallback)) throw Object.assign(new Error('Skin ornament overlaps content'),{code:'SKIN_GEOMETRY'});
    }
    return value;
}
// Built-in skins are ordinary documents. 经典 (classic) is the default every stage falls back to. It names no font: the
// stage keeps the client's own type.
const BUILTIN_STAGE_SKINS = Object.freeze({
    classic:{schema:'dsh.skin/1',id:'classic',label:'经典',
        textbox:{paint:{bg:'#0c0a14',fg:'#f5f2fa',fgMuted:'#bcb8c6',accent:'#e9e4f3',onAccent:'#0c0a14',border:'#bcb8c6'},shape:{radius:10}},
        nameplate:{shape:'plain',paint:{bg:'#0c0a14',fg:'#f5f2fa'}},font:{},textFx:{reveal:'type'},
        ui:{bg:'#0c0a14',fg:'#f5f2fa',fgMuted:'#bcb8c6',accent:'#e9e4f3',onAccent:'#0c0a14',border:'#bcb8c6',radius:10}}
});

export { validateStageSkin, skinContrast, STAGE_SKIN_SFX_CUES, STAGE_SKIN_PLATE_ALPHA, BUILTIN_STAGE_SKINS }
