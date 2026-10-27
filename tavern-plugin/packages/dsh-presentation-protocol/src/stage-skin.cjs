'use strict';
// inert dsh.skin/1 contract, shared by importer and stage. No CSS input.
const skinColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const skinId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const skinNumber = (min,max,integer = false) => value => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const skinEnum = values => value => values.includes(value);
// Source kinds only; work names and attribution belong in license.notes.
const STAGE_SKIN_SOURCE_KINDS = ['official-asset','ai-generated','original'];
const skinArray = (item,min,max) => value => Array.isArray(value) && value.length >= min && value.length <= max && value.every(item);
const skinObject = (fields,required = []) => value => value !== null && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => Object.hasOwn(fields,key) && fields[key](value[key]));
const skinText = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const skinPaint = skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor},['bg','fg']);
const skinRings = (count,width) => skinArray(skinObject({width:skinNumber(1,width),color:skinColor},['width','color']),0,count);
const skinBand = skinObject({pattern:skinEnum(['staff','rule','dots','stripes','teeth','scanlines','fence','stained','lace','checker','chain']),colors:skinArray(skinColor,1,4),height:skinNumber(2,22),inset:skinNumber(0,60),offset:skinNumber(0,20)},['pattern','colors']);
// where 1..6 figures stand, per count, as ascending fractions of the stage width.
const skinSlots = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key,slots]) => /^[1-6]$/.test(key) && skinArray(skinNumber(0.1,0.9),Number(key),Number(key))(slots) && slots.every((x,i) => i === 0 || x > slots[i-1]));
const skinFile = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.(ogg|m4a|mp3|wav)$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
// bundle images drawn as the textbox and on-stage buttons.
// an image is a PNG / WebP or a static SVG (vector UI
// art, sharp at any density; the pack checks its bytes as inert drawing - asset-library pack-v2/skin-svg.js).
const skinImage = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.(png|webp|svg)$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const skinPx = skinNumber(-4096,4096);
// One loading mark: a static image (spin / sway / pulse / none) or an equal-cell sheet played at fps.
const skinSpinnerMark = {image:skinImage,motion:skinEnum(['spin','sway','none','pulse','frames']),period:skinNumber(.2,10),loop:skinEnum([true,false]),fps:skinNumber(.1,60),
    sheet:skinObject({columns:skinNumber(1,256,true),rows:skinNumber(1,256,true),frames:skinNumber(2,256,true)},['columns','rows','frames'])};
const skinSpinnerTiming = mark => mark.sheet ? !!mark.fps && mark.sheet.frames <= mark.sheet.columns * mark.sheet.rows && mark.period === undefined && (!mark.motion || mark.motion === 'frames') : mark.fps === undefined && mark.motion !== 'frames';
// design px per image px of an element's image - the original draws its sprites
// in UI units that are not the design px (measured on the original's frames); [x, y] when the original stretches the sprite
// (a widget a px taller than its sprite). Omitted = 1, the natural size.
const skinScale = value => skinNumber(.25,8)(value) || skinArray(skinNumber(.25,8),2,2)(value);
// a WOFF2 face shipped in the skin's own bundle,
// keyed by the id body / name / ui / film name; fallback = an installed library font for the glyphs it lacks.
// source: original = the game's own font file; tuned = a derived font face.
// A skin declares the font recipe that its design uses.
const skinFontFile = value => typeof value === 'string' && value.length <= 240 && /^[a-z0-9/._-]+\.woff2$/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const skinFontFace = skinObject({file:skinFontFile,weight:skinNumber(100,900,true),fallback:skinId,source:skinEnum(['original','tuned'])},['file','weight']);
const skinFontFaces = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 4 && Object.entries(value).every(([key,face]) => skinId(key) && skinFontFace(face));
// A button stands at exactly one of `top` / `bottom` and one of `left` / `right` (art px of the design screen, from the stage's
// edges); `on` is its lit image (AUTO on).
const skinQuickIcon = skinObject({image:skinImage,on:skinImage},['image']);
const skinQuickIcons = skinObject(Object.fromEntries(['auto','skip','hide','back','backlog','menu'].map(id => [id,skinQuickIcon])));
// The engine owns generic part shapes; skins supply their data.
// buttonArt: a drawn button body per state - normal, hover (under the pointer / keyboard focus), on (pressed: running, open),
// disabled (cannot act) - with the button's own glyph drawn in its glyph box [x, y, w, h] (fractions of the body).
const skinButtonArt = skinObject({normal:skinImage,hover:skinImage,on:skinImage,disabled:skinImage,
    glyph:value => skinArray(skinNumber(0,1),4,4)(value) && value[2] > 0 && value[3] > 0 && value[0] + value[2] <= 1 && value[1] + value[3] <= 1},['normal','glyph']);
// slice: a 9-slice of a slot's image - [top, right, bottom, left] image px drawn as they are, the rest stretched with the
// slot; or {edges} (the same). One shape for every slot that slices (box, plate, choice bars, menu rows); where the slot's
// content sits stays the slot's own layout.
const skinSliceEdges = skinArray(skinNumber(0,4096),4,4);
const skinSlice = value => skinSliceEdges(value) || skinObject({edges:skinSliceEdges},['edges'])(value);
// frames: a slot's image as a sheet of equal cells (columns x rows) played row-major at fps - count of them (default every
// cell), loop (default true; false = once, then the last frame stays). The frames are the slot's motion; reduced motion
// shows the rest frame (the first when looping, the last when played once). playable = an image slot that may hold one:
// the image, or {image, frames}.
const skinFrames = value => skinObject({columns:skinNumber(1,16,true),rows:skinNumber(1,16,true),count:skinNumber(2,256,true),fps:skinNumber(1,30),loop:skinEnum([true,false])},['columns','rows','fps'])(value)
    && value.columns * value.rows >= 2 && (value.count ?? 2) <= value.columns * value.rows;
const skinPlayable = value => skinImage(value) || skinObject({image:skinImage,frames:skinFrames},['image','frames'])(value);
// quickMenu.button: the icon row's controls drawn as one buttonArt body each, the action's icon in its glyph box. The icons
// are still the actions' own; a body needs them.
// narrow (§13): where a placed row stands on a phone - bottom (the default: its own strip under the lines) or top (its own
// strip at the box's top edge, right-aligned under the box image's top band, the lines below it).
// button.narrow: the phone's own bodies (a buttonArt set) - each control is drawn
// 44 CSS px tall at that body's aspect (a wide desktop chip set that small would shrink its label out of reading).
const skinQuickButton = value => skinButtonArt(Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'narrow'))) && (value.narrow === undefined || skinButtonArt(value.narrow));
const skinQuickMenu = value => skinObject({bg:skinColor,fg:skinColor,layout:skinEnum(['bar','capsule','orb']),place:skinEnum(['box-top-right','box-bottom-right']),narrow:skinEnum(['top','bottom','edge']),icons:skinQuickIcons,button:skinQuickButton},['bg','fg'])(value) && (!value.button || Boolean(value.icons)) && (!value.narrow || Boolean(value.place));
// rotate: the name turned this many degrees on that side (a tilted penlight), else nameplate.rotate.
const skinNameSide = skinObject({x:skinPx,align:skinEnum(['start','end']),rotate:skinNumber(-15,15)},['x']);
// the one pose vocabulary of skin motion. A pose moves its element
// by dx / dy (em of the element's text; design px for drawn menu parts), turns it rot degrees, scales it and brightens it
// (1 = as drawn) - never translucent (the UI standard's solid surfaces); a motion plays 2-6 key poses at `at` (0..1 of ms,
// the first at 0 and the last at 1).
// sx / sy: a pose's own horizontal / vertical scale (a card flipping in), times scale.
const skinPoseFields = {dx:skinNumber(-4096,4096),dy:skinNumber(-4096,4096),rot:skinNumber(-180,180),scale:skinNumber(0,4),sx:skinNumber(0,4),sy:skinNumber(0,4),bright:skinNumber(0,3)};
const skinPose = value => skinObject(skinPoseFields)(value) && Object.keys(value).length > 0;
const skinEase = skinEnum(['linear','out','in-out','back']);
const skinMotion = value => skinObject({ms:skinNumber(60,3000),ease:skinEase,keys:skinArray(skinObject({...skinPoseFields,at:skinNumber(0,1)},['at']),2,6)},['ms','keys'])(value)
    && value.keys[0].at === 0 && value.keys.at(-1).at === 1 && value.keys.every((key,i) => i === 0 || key.at > value.keys[i-1].at);
// A staged entrance or exit of a list (the Esc menu's items): every item from (enter) or to (leave) the pose over ms, the
// next one stagger ms later; fade: from / to nothing as well.
const skinStage = skinObject({pose:skinPose,ms:skinNumber(40,1500),stagger:skinNumber(0,200),ease:skinEase,fade:value => value === true},['pose','ms']);
// how each stage surface comes and goes - the loading veil, the
// stage itself (enter: the text box as the stage is revealed; leave: the whole stage before it closes), the Esc menu, CONFIG,
// the backlog, the turn-end choices (rows staggered; leave = after a pick) and the page turn (enter only: shapes over it).
// A transition is data only: a wipe (the surface revealed through a growing closed shape from `at`, 0..1 of the surface, or
// an edge wipe; leave shrinks it away), a pose (dx / dy % of the surface, rot, scale), a fade, and up to four flat shapes
// (circle / square / triangle / bar in one colour, size = share of the stage height) sweeping from -> to (0..1 of the stage,
// may start or end off it) turning rot degrees, delay = share of ms. Every surface at every width; CONFIG 减少动态 shows the end
// state at once and the system's reduced-motion preference replaces it with a short fade.
// speaker: like page - enter only, shapes only - played when the speaker changes to someone (narration
// or another speaker before); a page of the same speaker plays page.
const STAGE_SKIN_TRANSITION_SURFACES = Object.freeze(['loading','stage','menu','config','backlog','choices','page','speaker']);
const STAGE_SKIN_WIPES = Object.freeze(['circle','rect','diamond','triangle','left','right','up','down']);
// ring (§18 N9): a circle's outline (a twentieth of its size wide); grow = [from, to] its scale on the way (a ripple spreading);
// fade = it fades out on the way. anchor portrait: from / to are offsets from the shown speaker portrait's centre (its rest place,
// in fractions of the stage) - a ripple under the speaker's disc wherever the layout stands it; no portrait shown, not drawn.
// anchor box: y counts from the text box's top edge at rest (a box whose height follows its lines: where it is going), x from
// the stage's left - a glint along the rim at whatever height the page has it.
const skinTransitionShape = skinObject({shape:skinEnum(['circle','square','triangle','bar','ring']),color:skinColor,size:skinNumber(.02,1.5),from:skinArray(skinNumber(-1,2),2,2),to:skinArray(skinNumber(-1,2),2,2),
    rot:skinNumber(-720,720),delay:skinNumber(0,.9),grow:skinArray(skinNumber(0,8),2,2),fade:value => value === true,anchor:skinEnum(['portrait','box'])},['shape','color','size','from','to']);
// ease: the named curves (expo-out / quint-out = long decelerating tails;
// emphasized / emphasized-out / emphasized-in = Material 3's emphasized, its decelerate and accelerate; spring = a settle with
// a 3% overshoot) or a cubic Bezier [x1, y1, x2, y2] (x in 0..1).
const STAGE_SKIN_TX_EASES = Object.freeze(['linear','out','in-out','back','snap','expo-out','quint-out','emphasized','emphasized-out','emphasized-in','spring']);
const skinTxEase = value => skinEnum(STAGE_SKIN_TX_EASES)(value) || skinArray(skinNumber(-1,2),4,4)(value) && value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1;
const skinTxPose = skinObject({dx:skinNumber(-100,100),dy:skinNumber(-100,100),rot:skinNumber(-180,180),scale:skinNumber(0,4)});
// delay: ms before the surface itself moves (its parts or shapes lead). parts: the surface's own parts (its direct children,
// in order) moving as a second layer - enter: from pose / nothing to rest, delay ms after the transition starts, each next
// one stagger ms later; leave: from rest away, before the surface (inside its delay + ms).
const skinTransitionParts = value => skinObject({ms:skinNumber(60,1500),ease:skinTxEase,delay:skinNumber(0,1000),stagger:skinNumber(0,200),pose:skinTxPose,fade:value => value === true})(value)
    && (Object.hasOwn(value,'pose') || Object.hasOwn(value,'fade'));
const skinTransition = value => skinObject({ms:skinNumber(60,1500),ease:skinTxEase,delay:skinNumber(0,1000),wipe:skinObject({shape:skinEnum(STAGE_SKIN_WIPES),at:skinArray(skinNumber(0,1),2,2)},['shape']),
    pose:skinTxPose,fade:value => value === true,stagger:skinNumber(0,200),parts:skinTransitionParts,
    shapes:skinArray(skinTransitionShape,1,4),sameSpeaker:value => value === true},['ms'])(value) && ['wipe','pose','fade','shapes','parts'].some(key => Object.hasOwn(value,key));
// page: enter only, shapes only (the box's own page motion is textbox.motion.page); stagger only staggers the choice rows;
// the choice rows are the choices' parts already (no parts there). sameSpeaker: the page's shapes play only on a page that keeps the speaker - a change of speaker
// (to, from or between speakers) turns quietly.
const skinTransitions = value => skinObject(Object.fromEntries(STAGE_SKIN_TRANSITION_SURFACES.map(surface => [surface,skinObject({enter:skinTransition,leave:skinTransition})])))(value)
    && Object.keys(value).length > 0 && Object.entries(value).every(([surface,phases]) => Object.keys(phases).length > 0 && Object.values(phases).every(t => (surface === 'choices' || t.stagger === undefined) && (surface !== 'choices' || t.parts === undefined) && (surface === 'page' || t.sameSpeaker === undefined))
        && (!['page','speaker'].includes(surface) || !phases.leave && Object.keys(phases.enter).every(key => ['ms','ease','shapes','sameSpeaker'].includes(key)) && Boolean(phases.enter.shapes)));
// A glyph's pose on the reveal's step clock (textFx.poses): em offsets, degrees, scale (sx / sy per axis), skew, a blur in em
// and its ink (the flash colour, the body ink or the accent); held opaque like the reveals' own poses.
const skinWaitLines = skinArray(value => typeof value === 'string' && /^\S(?:[^\n\r]{0,22}\S)?$/u.test(value),1,64);
const skinGlyphPose = skinObject({dx:skinNumber(-1,1),dy:skinNumber(-1,1),rot:skinNumber(-45,45),scale:skinNumber(0,3),sx:skinNumber(0,3),sy:skinNumber(0,3),skew:skinNumber(-45,45),
    blur:skinNumber(0,.5),ink:skinEnum(['flash','fg','accent'])});
// the skin's sound palette - a file per stage cue, or {file, gain, every (type: one in
// every n glyphs), pitch (random rate spread)}; a cue the skin leaves out keeps the engine's sound (type / auto / skip
// have none).
// No 'page' and no 'name': a page turn and a speaker change never make a sound , so no skin can
// declare one.
const STAGE_SKIN_SFX_CUES = ['open','close','move','confirm','cancel','toggle','choice','type','auto','skip'];
const skinSfxCue = value => skinFile(value) || skinObject({file:skinFile,gain:skinNumber(0,2),every:skinNumber(1,8,true),pitch:skinNumber(0,.2)},['file'])(value);
const skinSfx = skinObject(Object.fromEntries(STAGE_SKIN_SFX_CUES.map(cue => [cue,skinSfxCue])));
const skinDuckDb = skinNumber(-24,0);
const skinDuck = value => skinObject({voice:skinObject({sfx:skinDuckDb,ambience:skinDuckDb,music:skinDuckDb}),sfx:skinObject({ambience:skinDuckDb,music:skinDuckDb})})(value) && Object.keys(value).length > 0;
const skinSfxFiles = sfx => Object.values(sfx || {}).map(cue => typeof cue === 'string' ? cue : cue.file);
// hint = the button image's own input prompt (its first `w` design px)
// is replaced by a key cap of the action's real key, read from the stage's binding table (stage shortcut bindings);
// `h` = the cap's height in design px. `action` defaults to the button's own.
const skinArtHint = skinObject({action:skinEnum(['backlog','auto','skip','menu']),w:skinNumber(1,512),h:skinNumber(8,256)},['w','h']);
// narrow = the button's own phone art (640px
// and less) - image / on at scale, its top and its left or right edge in the phones' touch unit (design px), instead of the
// design image hung from the top edge; no key cap there.
const skinArtButtonNarrow = value => skinObject({image:skinImage,on:skinImage,scale:skinScale,left:skinPx,right:skinPx,top:skinPx},['image','top'])(value)
    && Object.hasOwn(value,'left') !== Object.hasOwn(value,'right');
const skinArtButton = value => skinObject({image:skinImage,on:skinImage,tint:skinImage,scale:skinScale,hint:skinArtHint,narrow:skinArtButtonNarrow,left:skinPx,right:skinPx,top:skinPx,bottom:skinPx},['image'])(value)
    && Object.hasOwn(value,'left') !== Object.hasOwn(value,'right') && Object.hasOwn(value,'top') !== Object.hasOwn(value,'bottom');
// a still image placed like a button (the original's HUD print that
// has no action here, e.g. the Vita HELP label); never focusable; scale as a button's.
const skinArtDecor = value => skinObject({image:skinImage,scale:skinScale,left:skinPx,right:skinPx,top:skinPx,bottom:skinPx},['image'])(value)
    && Object.hasOwn(value,'left') !== Object.hasOwn(value,'right') && Object.hasOwn(value,'top') !== Object.hasOwn(value,'bottom');
// The name's ink in two bands (upper half, lower half) under its outline.
const skinInk = skinArray(skinColor,2,2);
// art.cast: per-figure art keyed by the figure id of the skin's own pack (the original draws some speakers in their own
// frame): box = the textbox image for every line of that speaker, plate = the name plate image (same size as
// nameplate.image), name = the name's two-band ink and outline colour.
const skinCastKey = key => /^[a-z0-9][a-z0-9-]{0,63}$/.test(key);
// The band under the name: its image drawn h px tall at its own aspect, its right edge `tail` px past the name's right edge and cut
// at x px past the plate's left - a printed pattern (dots, teeth) keeps its geometry at any name width.
// tint: the band painted in the speaker's colour through the image's alpha (needs a speaker colour; the
// image as drawn otherwise); sweep: ms the band takes to draw itself left to right when the speaker changes.
const skinNameBand = skinObject({image:skinImage,x:skinPx,y:skinPx,h:skinNumber(1,256),tail:skinPx,tint:value => value === true,sweep:skinNumber(40,2000)},['image','y','h']);
const skinCastEntry = skinObject({box:skinImage,plate:skinImage,band:value => value === false || skinObject({image:skinImage,tail:skinPx},['image'])(value),name:skinObject({fill:skinInk,border:skinColor})});
const skinCast = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key,entry]) => skinCastKey(key) && skinCastEntry(entry));
// the speaker's bust cut from their stage figure. head = where
// the figure's head box (crown to chin) lands on the design screen: its centre x, its top y and its height (px); crop = what
// of the figure shows, in head heights: above the crown, to each side of the head centre, below the chin (the design screen
// clips too); enter = the bust's first pose on a new subject (offset px, opacity) and how it reaches rest (hold = a cut after
// ms, out = an ease over ms).
const skinBust = skinObject({head:value => skinArray(skinPx,3,3)(value) && value[2] >= 16,crop:skinArray(skinNumber(0,8),3,3),
    enter:skinObject({dx:skinPx,alpha:skinNumber(0,1),ms:skinNumber(1,2000),curve:skinEnum(['hold','out'])},['ms'])},['head','crop']);
// The face window square (left / bottom / size); source bust draws the bust instead and keeps the square for a speaker
// without a figure on stage. A bust needs its framing and only a bust has one.
// frame = the original's
// portrait frame image (natural size) with its left / bottom on the design screen, drawn behind the face only while a face
// shows; window = [left, bottom, width, height], the rect the face (and what of the picture hangs below its square) is
// clipped to (default: the square).
// mood: a caption in the frame bound to the shown face's 差分 label -
// rect = [left, bottom, width, height] on the design screen, the label centred in it at font px in ink (weight, spacing em).
const skinPortraitMood = value => skinObject({rect:skinArray(skinPx,4,4),font:skinNumber(8,256),ink:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(-0.2,0.5)},['rect','font','ink'])(value)
    && value.rect[2] > 0 && value.rect[3] > 0;
// round / front / glass / back / speaking: round = the face clipped
// to the ellipse inside the window; front = the frame and face over the box image, the frame image in front of the face (an
// open frame); glass = an image laid over the face across the window (a sheen), under a front frame; back = an image under
// the face across the window (what the window shows around a cut-out avatar), clipped as the face; speaking = the frame
// image while the speaker's line is still being delivered (typing, or its voice playing). fill = the window's own face, opaque,
// under the back and the face: one colour, or [centre, edge] (a radial gradient) - what shows through a cut-out avatar's
// transparent parts instead of the stage behind; shaped as the face (the window's ellipse when round).
// tint = a mask the frame image's size whose alpha takes the speaker's colour (the box's speaker colour, the source
// textbox.tint uses), the frame's luminance kept; narration and a speaker without a colour keep the frame as drawn.
// name: the speaker's name set on the frame along a circle - arc = [x, bottom, r], the circle's centre on the design screen
// and its radius (design px; the glyphs' middles on it), the words centred on its lowest point (side bottom, the default) or
// its highest (top) within span degrees (default 90); font px, ink (one colour, or [top, bottom] down the glyphs), weight,
// spacing (em), engrave {light, dark} = the cut's edges (dark above the glyphs, light below: letters cut into the frame). A
// name (any live text) stays inside the span: set smaller, down to .72, then its tracking closed (to -.04em), then smaller again. While the face (and so the name) shows, the
// box's name plate steps aside - its words kept for screen readers, its voice control centred at voice [x, bottom] (default:
// just past the arc's right end); narration and a speaker without a face keep the plate as drawn.
// Legibility: stroke {color, width} = an outline round the glyphs, width design px outside
// their edge (on the ink itself, painted under its fill); shadow {color, dx?, dy} = one hard copy of the outlined glyphs offset
// by design px behind them (vector, no blur); bed {color, alpha, width?} = the channel darkened behind the run (a soft band,
// width design px across, default the font size); min = the smallest size the name is ever set at (design px, <= font): past
// it the run is pressed (narrower vector glyphs, same height).
const skinPortraitName = value => skinObject({arc:skinArray(skinPx,3,3),side:skinEnum(['bottom','top']),span:skinNumber(20,300),font:skinNumber(8,256),
    ink:ink => skinColor(ink) || skinArray(skinColor,2,2)(ink),weight:skinEnum([400,500,700,900]),spacing:skinNumber(-0.2,0.8),
    engrave:skinObject({light:skinColor,dark:skinColor},['light','dark']),voice:skinArray(skinPx,2,2),
    stroke:skinObject({color:skinColor,width:skinNumber(0.25,16)},['color','width']),shadow:skinObject({color:skinColor,dx:skinNumber(-8,8),dy:skinNumber(-8,8)},['color','dy']),
    bed:skinObject({color:skinColor,alpha:skinNumber(0,1),width:skinNumber(1,512)},['color','alpha']),min:skinNumber(4,256)},['arc','font','ink'])(value)
    && value.arc[2] > 0 && !(value.min > value.font);
// motion: the frame and its face enter together when a new speaker's face comes in
// (not a mood change of the same speaker): the pose vocabulary of nameplate.motion, dx / dy in % of the frame (dy 100 = one
// frame height down - e.g. risen from under the box image, which is drawn over a frame behind it). A click that finishes the
// page, skip, history and 减少动态 show the rest pose at once.
// layer face (§18 N12): the keys move the entering face alone (dx / dy in % of the face square, its window cut riding with it)
// while the frame image, its back and fill stay put - a face rising into a still disc; leave (face only, <= 400 ms) = the
// face it replaces plays these keys before it goes (e.g. sinking behind the box image) instead of vanishing at once.
const skinFrameMotionKeys = motion => motion.keys.every(key => Math.abs(key.dx || 0) <= 200 && Math.abs(key.dy || 0) <= 200);
const skinFrameMotion = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const {layer,leave,...motion}=value;
    return skinMotion(motion) && skinFrameMotionKeys(motion) && [undefined,'frame','face'].includes(layer)
        && (leave === undefined || layer === 'face' && skinMotion(leave) && skinFrameMotionKeys(leave) && leave.ms <= 400);
};
const skinPortraitFrame = value => skinObject({image:skinImage,left:skinPx,bottom:skinPx,window:skinArray(skinPx,4,4),mood:skinPortraitMood,
    round:round => round === true,front:front => front === true,glass:skinImage,back:skinImage,fill:fill => skinColor(fill) || skinArray(skinColor,2,2)(fill),speaking:skinImage,tint:skinImage,name:skinPortraitName,motion:skinFrameMotion,swap:skinEnum(['fade'])},['image','left','bottom'])(value)
    && (!value.window || value.window[2] > 0 && value.window[3] > 0)
    // swap fade: a new face crossfades in the still window (the one it
    // replaces fading under it) instead of the cut; frame.motion owns the entrance when there is one.
    && !(value.swap && value.motion);
// narrow (§13, stages of 640px and less): where the face side stands on a phone, in CSS px from the box's top-left corner -
// width (the frame's, or the square's without one; its height by the frame's aspect), x from the box's left edge, y from its
// top edge (negative: above it). The lines start clear of it whether a face shows or not (no reflow). name = how the frame's
// name reads at that size: below (one straight line centred under the side; the default) or arc (as drawn); nameMin = the arc's
// smallest glyph size there (CSS px): a name that would set smaller keeps that height and is condensed to its arc (vector). flow = how the lines clear the side:
// beside (a column right of it for every line; the default), wrap (beside it down to its bottom, then the full width) or below
// (all lines under its bottom, the full width); left = the lines' left inset from the box's left edge when they are not beside
// it (CSS px, default 12).
const skinPortraitNarrow = skinObject({width:skinNumber(32,240),x:skinNumber(-64,240),y:skinNumber(-240,240),name:skinEnum(['below','arc']),nameMin:skinNumber(6,24),flow:skinEnum(['beside','wrap','below']),left:skinNumber(0,120)},['width','x','y']);
// when: always (default) or off-stage = on wide stages a speaker drawn on stage shows no face (the
// figure speaks; the page is faceless), only one who is not on stage does; phones show every face. feather [top, right,
// bottom, left]: the face picture fades out over that share of its square from each edge (a soft mask, phones too).
// placeholder: a speaker the avatar resolver gives no face still shows one -
// initial = the engine's neutral disc (the displayed name's first glyph in nameplate.paint), {image} = the skin's own art.
// Undeclared: such a page stays faceless as before.
const skinPortrait = value => skinObject({left:skinPx,bottom:skinPx,size:skinNumber(32,4096),source:skinEnum(['avatar','bust']),bust:skinBust,frame:skinPortraitFrame,narrow:skinPortraitNarrow,
    when:skinEnum(['always','off-stage']),feather:skinArray(skinNumber(0,.5),4,4),placeholder:placeholder => placeholder === 'initial' || skinObject({image:skinImage},['image'])(placeholder)},['left','bottom','size'])(value)
    && (value.source === 'bust') === Object.hasOwn(value,'bust') && !(value.frame && value.source === 'bust') && !(value.narrow?.name && !value.frame?.name);
// how the items mod's card looks in this skin - the
// original's evidence frame. frame = its image, drawn as box [centre x, centre y, width, height] on the design screen; media =
// the item picture's [width, height], centred on the frame and drawn over it; enter = the card's rise from `rise` px below and
// fade over ms, mirrored as it leaves (the card keeps the items mod's own lifetime); narrow = on stages of 640px and less the
// frame centred, `width` of the stage wide, its centre `y` of the stage height down. gain = an item gained also hides the text
// box's words while it shows (hideText; the box art stays) and shows the original's toast: its image as [x, y, w, h] on the
// design screen with the words centred in it at font px (ink; default the stage HUD ink), fading over fadeMs.
const skinItemToast = value => skinObject({image:skinImage,box:skinArray(skinPx,4,4),text:value => typeof value === 'string' && value.length > 0 && value.length <= 40,font:skinNumber(8,256),ink:skinColor,fadeMs:skinNumber(0,1000)},['image','box','text','font'])(value)
    && value.box[2] > 0 && value.box[3] > 0;
const skinItem = value => skinObject({frame:skinImage,box:skinArray(skinPx,4,4),media:skinArray(skinNumber(1,4096),2,2),enter:skinObject({ms:skinNumber(0,1000),rise:skinNumber(0,1024)}),
    narrow:skinObject({width:skinNumber(.2,1),y:skinNumber(.05,.95)},['width','y']),gain:skinObject({hideText:item => typeof item === 'boolean',toast:skinItemToast})},['frame','box','media'])(value)
    && value.box[2] > 0 && value.box[3] > 0;
// a text's soft halo in design px - offset, blur, colour and
// its opacity (the original's TMP underlay: offset, dilate + softness, colour); a blurred underlay, not an outline.
const skinHalo = skinObject({x:skinNumber(-64,64),y:skinNumber(-64,64),blur:skinNumber(0,64),color:skinColor,alpha:skinNumber(0,1)},['blur','color']);
// The name set as the original's AuthorData: the family name's first glyph `lead` px in the speaker colour, the rest of it
// `rest` px, the given name's first glyph `given[0]`, its rest `given[1]`, `gap` px between the parts, small glyphs `drop` px low.
const skinInitials = skinObject({lead:skinNumber(8,512),rest:skinNumber(8,512),given:skinArray(skinNumber(8,512),2,2),gap:skinNumber(0,128),drop:skinNumber(-64,64)},['lead','rest','given']);
// A statement place: the block's centre on the design screen and its roll (degrees, counter-clockwise).
const skinPlace = value => skinArray(skinNumber(-4096,4096),3,3)(value) && Math.abs(value[2]) <= 45;
const skinStatement = skinObject({font:skinNumber(8,512),pitch:skinNumber(8,1024),width:skinNumber(64,8192),lines:skinNumber(1,8,true),stroke:skinNumber(0,32),
    halo:skinHalo,weight:skinEnum([400,500,600,700,800,900]),places:skinObject({plain:skinPlace,left:skinPlace,center:skinPlace,right:skinPlace},['plain'])},['font','pitch','width','lines','places']);
// quick actions the original draws only in this mode (the debate's fast-forward
// next to its clock), as art.buttons and placed the same way; shown while the mode is on.
const skinModeButtons = value => skinObject({backlog:skinArtButton,auto:skinArtButton,skip:skinArtButton,menu:skinArtButton})(value) && Object.keys(value).length >= 1;
// the HUD while the mode is on - hide: art.buttons put away;
// beside: the mode's buttons stand in one row just left of the stage timer while one shows (their own places otherwise),
// gap design px between the row and the timer (negative: the images' transparent margins overlap), centred on it.
const skinHudHide = value => skinArray(skinEnum(['backlog','auto','skip','menu']),1,4)(value) && new Set(value).size === value.length;
const skinModeHud = value => skinObject({hide:skinHudHide,
    beside:skinEnum(['timer']),gap:skinNumber(-512,512)})(value) && Boolean(value.hide || value.beside) && (value.gap === undefined || Boolean(value.beside));
// Keyed by the mode a performance declares (dsh.performance/1 `skinMode`, e.g. the debate's "debate").
const skinModes = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length >= 1 && Object.keys(value).length <= 4
    && Object.entries(value).every(([key,mode]) => skinId(key) && skinObject({statement:skinStatement,buttons:skinModeButtons,hud:skinModeHud},['statement'])(mode)
        && (!mode.hud?.beside || Boolean(mode.buttons)));
// art.menu - the stage menu as the original's own menu screen on
// wide stages (narrow ones keep the shared panel in the skin's palette). sheet = an image filling the design screen behind it;
// rows = every item as a bar image (plain; focus = the focused item; off = one that cannot act), 9-sliced [top, right, bottom,
// left] like the choice bars, its label in the text column [l, r] centred on y at `font` px (ink / focusInk, weight), the
// first bar's top-left at x, y with `gap` px between bars; cursor = an image beside the focused bar (top-left from the bar's).
// title / info / keys = a strip carrying the menu's title, the focused item's description or the key guide: its image at
// its natural size (none: text only, text[1] wide and 2 * text[2] high) with its top-left at x, y and the words in the text
// column [l, r] centred on y, aligned start | center | end. Positions in design px.
// vertical: the words run top to bottom, centred on [l, r] and on y (a hanging plaque).
// rule: a drawn rule hugging the words on both sides - the image as the right-hand one at its natural size (design px),
// mirrored on the left, gap design px from the words.
const skinMenuStrip = skinObject({image:skinImage,x:skinPx,y:skinPx,text:skinArray(skinNumber(0,8192),3,3),font:skinNumber(8,256),ink:skinColor,align:skinEnum(['start','center','end']),vertical:value => value === true,
    rule:skinObject({image:skinImage,gap:skinNumber(0,512)},['image'])},['x','y','text','font']);
// A highlight drawn behind an element (the current one, or the one under the pointer and keyboard focus): its image stretched
// over the element (irregular edges: the image's own), out = how far it overhangs the element
// [top, right, bottom, left] in design px (negative = inset). The original's stains and worn strips, never a flat fill.
const skinHighlight = skinObject({image:skinImage,out:skinArray(skinNumber(-1024,1024),4,4)},['image']);
// tiles = the menu as a grid of drawn tiles instead of bars. art = per action
// id (the menu's own ids) its tile image (focus = under the pointer and keyboard focus); at takes an always-present action out
// of the grid to its own top-left (its image's natural size, the original's close mark), bare = no visible label there. The
// grid: the first cell's top-left x, y, cells w x h every pitch [x, y] px, cols per row in the menu's order, each tile
// image centred on its cell + offset; fit = the grid's most height: more rows scale the whole grid down to it. label = the
// item's words centred in the cell at y (cell px) at font px, ink / focusInk, the first glyph lead times larger (the original's
// zh-Hans labels) and in focusInk under focus, outlined stroke px in its colour (the original's light glyph rim, under the
// ink); hover = a highlight behind the focused tile. plain = the tile of an action
// without its own image. frame = an image the menu stands on (a device: the original's phone) at its top-left x, y on the
// design screen, turned rotate degrees (clockwise) about its centre; with a frame, tiles and strips are in frame px and turn
// with it.
const SKIN_MENU_ACTIONS = ['resume','backlog','auto','skip','gallery','latest','regenerate','config','keys','leave'];
const SKIN_MENU_ALWAYS = ['resume','backlog','gallery','config','keys','leave'];
// label: this tile's own label y (a placed lens slot's caption under its image).
const skinMenuTile = skinObject({image:skinImage,focus:skinImage,at:skinArray(skinPx,2,2),bare:value => value === true,label:skinObject({y:skinPx},['y'])},['image']);
const skinMenuTileArt = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length >= 1
    && Object.entries(value).every(([key,tile]) => SKIN_MENU_ACTIONS.includes(key) && skinMenuTile(tile) && (!tile.at || SKIN_MENU_ALWAYS.includes(key)) && (!tile.bare || !!tile.at));
const skinMenuTiles = skinObject({x:skinPx,y:skinPx,w:skinNumber(16,2048),h:skinNumber(16,2048),pitch:skinArray(skinNumber(0,2048),2,2),cols:skinNumber(1,6,true),fit:skinNumber(16,4096),
    // number: the tiles numbered 01, 02, ... in the menu's order at x, y (cell px), font px, ink / focusInk, an
    // outline stroke; tilt: each tile's own small angle, cycled by its place in the menu; lift: the focused tile's scale and rise.
    offset:skinArray(skinPx,2,2),art:skinMenuTileArt,plain:skinImage,hover:skinHighlight,
    number:skinObject({x:skinPx,y:skinPx,font:skinNumber(8,512),ink:skinColor,focusInk:skinColor,stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width'])},['x','y','font']),
    tilt:skinArray(skinNumber(-10,10),1,8),lift:skinObject({scale:skinNumber(.8,1.3),dy:skinNumber(-64,64)}),
    label:skinObject({y:skinPx,font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,lead:skinNumber(1,3),weight:skinEnum([400,500,700]),halo:skinHalo,align:skinEnum(['start','center']),x:skinPx,
        stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width'])},['y','font'])},
    ['x','y','w','h','pitch','cols','art','label']);
const skinMenuFrame = skinObject({image:skinImage,x:skinPx,y:skinPx,scale:skinScale,rotate:skinNumber(-45,45)},['image','x','y']);
// dim = the menu's veil replaced by the stage dimmed to black at this opacity (0 = the menu over the live scene, as a device).
// motion: the menu's entrance and exit - its items (rows or tiles) staged from / to a pose in design
// px (enter / leave), the sheet and strips fading with them; reduced motion opens and closes at once.
// blur / grey: the stage behind the menu blurred (design px) and greyed (0..1) besides dim. signal: a small lamp
// image at x, y (frame px with a frame) that shows its alert image while one of the on actions has the focus.
const skinMenuSignal = skinObject({image:skinImage,alert:skinImage,x:skinPx,y:skinPx,on:skinArray(skinEnum(SKIN_MENU_ACTIONS),1,10)},['image','alert','x','y','on']);
const skinMenu = value => skinObject({sheet:skinImage,frame:skinMenuFrame,tiles:skinMenuTiles,dim:skinNumber(0,1),blur:skinNumber(0,64),grey:skinNumber(0,1),signal:skinMenuSignal,
    // frame / frameOut: the frame (the device) itself rising in and dropping out (a pose of the whole panel); decor: 'hide'
    // puts art.decor away while the menu is open (the HUD belongs to the stage the menu pauses).
    motion:skinObject({enter:skinStage,leave:skinStage,frame:skinStage,frameOut:skinStage}),decor:skinEnum(['hide']),
    rows:skinObject({images:skinObject({plain:skinImage,focus:skinImage,off:skinImage},['plain','focus']),slice:skinSlice,text:skinArray(skinNumber(0,4096),3,3),
        font:skinNumber(8,256),x:skinPx,y:skinPx,gap:skinNumber(0,512),ink:skinColor,focusInk:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(0,0.5),align:skinEnum(['start','center','end']),cursor:skinObject({image:skinImage,x:skinPx,y:skinPx},['image','x','y'])},
        ['images','slice','text','font','x','y','gap']),
    title:skinMenuStrip,info:skinMenuStrip,keys:skinMenuStrip})(value) && Object.hasOwn(value,'rows') !== Object.hasOwn(value,'tiles');
// the stage's own overlays drawn as the original's
// screens on wide stages. A placed image: its top-left at x, y on the design screen at `scale` design px per image px; focus
// = the image under the pointer and keyboard focus. Every overlay may carry a sheet (an image over the whole game area),
// the stage's dim behind it (black at this opacity), a title image (the overlay's name stays its accessible label) and a
// close image.
const skinArtPlaced = skinObject({image:skinImage,focus:skinImage,scale:skinScale,x:skinPx,y:skinPx},['image','x','y']);
const skinArtScreen = {sheet:skinImage,dim:skinNumber(0,1),title:skinArtPlaced,close:skinArtPlaced,ink:skinColor,font:skinNumber(8,256)};
const skinRect = skinArray(skinNumber(-4096,8192),4,4);
// backlog voice: where each spoken row's replay control stands - a box [x, y, w, h] from the entry's top-left, or {anchor,
// at, size}: row = its top-left at the entry's top-left + at; name = its left edge at the name's end + at[0], centred on the
// name + at[1]; text = its left edge at the text column's right end + at[0], centred on the first line + at[1]; size [w, h]
// (default a square growing with the lines). Omitted = right after the name, centred on it.
const skinBacklogVoice = value => skinRect(value) || skinObject({anchor:skinEnum(['row','name','text']),at:skinArray(skinPx,2,2),size:skinArray(skinNumber(1,1024),2,2)},['anchor'])(value);
// backlog (履历): list = the scroll viewport [x, y, w, h]; every entry's text at `font` px on `pitch` px lines in the column
// text [left, right] (px from the list's left edge), `top` px under the entry's head; entries `gap` px apart. voice = the
// row's voice control place (skinBacklogVoice; it draws art.voice); name = a spoken line's name: its left x, its
// baseline-box top y and height h in the entry, set at `font` px (with art.nameplate.initials the same parts and ratios),
// over a frame image and above a rule image placed in the entry; head = the height a named entry's head takes before its
// text (narration has none). scrollbar = a drawn indicator of the list's position (track and thumb images, x, y, w, h).
const skinBacklog = skinObject({...skinArtScreen,list:skinRect,pitch:skinNumber(8,512),text:skinArray(skinNumber(0,8192),2,2),top:skinNumber(0,512),gap:skinNumber(0,512),
    voice:skinBacklogVoice,name:skinObject({x:skinPx,y:skinPx,h:skinNumber(1,1024),font:skinNumber(8,512),head:skinNumber(0,1024),frame:skinArtPlaced,rule:skinArtPlaced},['x','y','h','font','head']),
    scrollbar:skinObject({track:skinImage,thumb:skinImage,x:skinPx,y:skinPx,w:skinNumber(1,256),h:skinNumber(16,4096)},['track','thumb','x','y','w','h']),
    // hover = the one highlight: behind the entry under the pointer / keyboard focus and the entry the stage stands on.
    hover:skinHighlight},['list','font','pitch','text','gap']);
// config (CONFIG): tabs = the tab images (plain, on = the open tab), stacked from x, y every `pitch` px, the label in the
// column text [left, right, middle] of the tab image at `font` px (its first glyph in the accent while open); page = the
// rows' rect [x, y, w, h], each row `row` px high at `font` px with its control column `control` px wide at the right;
// focus = the row's hover image (stretched over the row, overhanging one row height at each end); slider / toggle = the
// controls' images: the slider's track, fill, frame and thumb (focus = the thumb under the pointer; h = the track's height,
// thumbSize = the thumb's), and the cell of the segmented choices and switches (plain, on = chosen, focus = hover, frame =
// one cell's outline; h = its height).
const skinConfig = skinObject({...skinArtScreen,
    tabs:skinObject({images:skinObject({plain:skinImage,on:skinImage},['plain','on']),x:skinPx,y:skinPx,pitch:skinNumber(8,1024),text:skinArray(skinNumber(0,4096),3,3),font:skinNumber(8,256),scale:skinScale},['images','x','y','pitch','text','font']),
    page:skinRect,row:skinNumber(16,1024),control:skinNumber(64,4096),focus:skinImage,
    slider:skinObject({track:skinImage,fill:skinImage,frame:skinImage,thumb:skinImage,focus:skinImage,h:skinNumber(4,256),thumbSize:skinNumber(4,256)},['track','fill','thumb','h','thumbSize']),
    toggle:skinObject({plain:skinImage,on:skinImage,focus:skinImage,frame:skinImage,h:skinNumber(8,256)},['plain','on','h']),
    // select = the pickers (font, skin) as the original's drop-down bar (plain; focus = open / under the pointer; h = its height).
    select:skinObject({plain:skinImage,focus:skinImage,h:skinNumber(8,256),ink:skinColor},['plain','h'])},['page','font','row','control']);
// voice = every voice replay control's art (the backlog rows' and the box's replay): idle, focus (hover / keyboard) and
// active (playing) images, drawn in the control's box.
// box false = the textbox shows no replay control (the original's box has none): replay stays on its key (R) and in the backlog.
// backlog false = the backlog's rows show no replay control: replay stays on its key (R) and in the box.
// scale (skinScale): the images drawn at this many design px per image px (a raster made for a larger design screen).
const skinVoice = value => skinObject({image:skinImage,focus:skinImage,active:skinImage,box:box => box === false,backlog:backlog => backlog === false,scale:skinScale})(value)
    && (Object.hasOwn(value,'image') || value.box === false || value.backlog === false)
    && (Object.hasOwn(value,'image') || !value.focus && !value.active);
// confirm = the stage's confirm dialogs (重新生成 …) drawn as the original's dialog band on wide stages: band = the body image
// stretched over the band, top / bottom = the torn edges at the band's top and bottom (natural
// size, full width), h = the band's least height, pad [top, bottom], gap between its rows, width = the content column, dim =
// the stage's dim behind it; the words at font px in ink. button = the actions as the original's buttons: plain and focus
// images at their natural size, the label at font px (ink / focusInk), lead = the first glyph's colour under focus, gap px apart.
const skinConfirm = skinObject({band:skinImage,top:skinImage,bottom:skinImage,h:skinNumber(64,4096),pad:skinArray(skinNumber(0,2048),2,2),gap:skinNumber(0,1024),
    width:skinNumber(64,8192),dim:skinNumber(0,1),font:skinNumber(8,256),ink:skinColor,
    button:skinObject({plain:skinImage,focus:skinImage,font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,lead:skinColor,gap:skinNumber(0,1024)},['plain','focus','font'])},
    ['band','h','font','button']);
// the text box drawn as vector shapes
// in design px over view [x, y, w, h]. boxes = one box per text row count (the last for more rows), narration = the box of a
// narration page. A point [x, y] or [x, y, kx, ky] moves (kx, ky) per unit of the box's stretch: per axis max(min, base +
// width x the text's width + line x (rows - 1)), y as x when omitted. A part is a polygon (points) or an ellipse [x, y, kx,
// ky, rx, ry, degrees], filled in paint bg / border (textbox.paint) or name (nameplate.paint.bg, while a name shows), with an
// optional edge (an outline that wide in textbox.paint.bg). parts remount each page and turn by one of turn.deg (picked from
// the page text) about turn.pivot; origin = where the page's entrance grows from; still parts stay put.
const skinShapeNumber = skinNumber(-8192,8192);
const skinShapePoint = value => skinArray(skinShapeNumber,2,4)(value) && value.length !== 3;
const skinShapeStretch = skinObject({base:skinShapeNumber,width:skinNumber(-8,8),line:skinNumber(-1024,1024),min:skinShapeNumber},['base']);
const skinShapePart = value => skinObject({paint:skinEnum(['bg','border','name']),edge:skinNumber(0,64),points:skinArray(skinShapePoint,3,256),
    ellipse:item => skinArray(skinShapeNumber,7,7)(item) && item[4] > 0 && item[5] > 0},['paint'])(value) && Object.hasOwn(value,'points') !== Object.hasOwn(value,'ellipse');
const skinShapeBox = skinObject({stretch:skinObject({x:skinShapeStretch,y:skinShapeStretch},['x']),turn:skinObject({pivot:skinArray(skinShapeNumber,2,2),deg:skinArray(skinNumber(-45,45),1,8)},['pivot','deg']),
    origin:skinArray(skinShapeNumber,2,2),parts:skinArray(skinShapePart,1,32),still:skinArray(skinShapePart,1,32)},['parts']);
const skinShape = skinObject({view:value => skinArray(skinShapeNumber,4,4)(value) && value[2] > 0 && value[3] > 0,boxes:skinArray(skinShapeBox,1,6),narration:skinShapeBox},['view','boxes']);
const skinArtShape = skinObject({
    // screen = the design screen's height; screenWidth = its width. The game area is the largest rect of that aspect inside
    // the stage (a 16:9 original on a 4:3 or 16:10 window scales by its width, as the original letterboxes there).
    screen:skinNumber(240,4096),screenWidth:skinNumber(240,8192),
    // images: the box per speaker side (plain = narration / no drawn speaker); body = the box rect inside the image [x,y,w,h];
    // bottom = the image's bottom margin on the screen; text = column left, right and the text block's vertical centre;
    // font = body text size; lines = lines per page; cue = the page cue's centre x, resting bottom y and height; rise = its bob.
    // images.narration: the box image for narration pages (no speaker), else plain.
    textbox:value => skinObject({images:skinObject({plain:skinImage,left:skinImage,center:skinImage,right:skinImage,narration:skinImage},['plain']),body:skinArray(skinNumber(0,4096),4,4),
        // cue inline: the page cue (next image, else the cursor) follows the page's last glyph instead of a fixed place.
        // controls (§18 E2): the quick menu row on the box image - its right edge x, top y, each control size px square, gap
        // apart (the quickMenu.icons; hide / back only with an icon of their own). slice (§13 narrow): the edges [top, right,
        // bottom, left] (image px) the phone keeps when it 9-slices the box image narrower than drawn (default: around the
        // body's text column) - phones keep the body text at the reading size, so the image's middle gives way.
        bottom:skinNumber(0,4096),text:skinArray(skinNumber(0,4096),3,3),font:skinNumber(8,256),lines:skinNumber(1,3,true),cue:value => value === 'inline' || skinArray(skinNumber(0,4096),3,3)(value),rise:skinNumber(0,256),
        // readout: a live local clock printed on the box image - its label then HH:MM:SS, right-aligned at x
        // (or left at x with align start), centred on y, font px in ink (the engine's text, updated every second).
        // narrow (§13): its place on a phone, CSS px from the box (the drawn card): x in from its right edge (align end) or left
        // edge (start; default the readout's own align), y down from its top edge to the line's middle.
        // controls.rows (§18 N9): the controls in a grid of that many rows from y down (columns from x leftward) on wide stages.
        controls:skinObject({x:skinPx,y:skinPx,size:skinNumber(16,256),w:skinNumber(16,512),gap:skinNumber(0,256),rows:skinNumber(1,6,true)},['x','y','size']),
        readout:skinObject({kind:skinEnum(['clock']),x:skinPx,y:skinPx,font:skinNumber(8,256),ink:skinColor,label:value => skinText(value) && value.length <= 24,align:skinEnum(['start','end']),narrow:skinObject({x:skinNumber(0,240),y:skinNumber(0,240),align:skinEnum(['start','end'])},['x','y'])},['kind','x','y','font']),
        slice:skinSlice,
        // lamp.frames (skinFrames): the lamp played as a sheet - its motion, so neither motion nor period with it.
        pitch:skinNumber(8,512),align:skinEnum(['top','middle']),lamp:value => skinObject({image:skinImage,x:skinPx,y:skinPx,motion:skinEnum(['blink','spin']),period:skinNumber(.2,10),swap:value => value === true,scale:skinScale,frames:skinFrames},['image','x','y'])(value)
            && !(value.frames && (value.motion || value.period !== undefined)),
        // next (§18 E11): playable - {image, frames} plays the cue as a sheet (skinFrames), its motion instead of rise / dip / blink.
        span:skinEnum(['stage']),next:skinPlayable,bob:skinEnum(['dip','blink']),halo:skinHalo,
        tint:skinObject({by:skinEnum(['speaker']),masks:skinObject({plain:skinImage,left:skinImage,center:skinImage,right:skinImage},['plain']),cue:cue => cue === true,menu:menu => menu === true},['by','masks']),scale:skinScale,
        fit:skinNumber(.5,1),stroke:skinObject({color:skinColor,width:skinNumber(0,16)},['color','width']),
        // height (§2.3): fit lines = the box's height follows the page's line count between min and max lines - the body is
        // drawn for `lines` lines and each line more or fewer moves its top edge by one line pitch (the image 9-sliced, the
        // portrait riding the top edge); ms = the height's ease (0-1000, default 220; none under 减少动态). Not with tint
        // (its whole-image mask would not follow the slices) or span (that box keeps its own geometry).
        height:value => skinObject({fit:skinEnum(['lines']),min:skinNumber(1,3,true),max:skinNumber(1,3,true),ms:skinNumber(0,1000,true)},['fit','min','max'])(value) && value.min <= value.max},
        ['images','body','bottom','text','font','lines'])(value) && !(value.height && (value.tint || value.span)),
    // textbox.pitch = the line pitch (px); align top = text[2] is the first
    // line's top; lamp = an image shown on the box image while auto-advance runs (the original's AUTO lamp, not a button).
    // nameplate: the layout's name plate placed on the box image (px): its top-left x, y, height h, least width w, the name
    // size, its glyph outline (stroke, in nameplate.paint.border) and a drawn speaker's emblem disc (centre x, y, diameter).
    // lamp.motion blink | spin over lamp.period s, lamp.swap = it stands in
    // for the page cue while auto runs; textbox.span stage = the box image stretched across the stage (a bottom-stretch scrim);
    // no cue = the original has none; next = the page cue drawn from this image (not the cursor canvas); bob dip = the cue dips
    // `rise` px and returns  instead of rising; nameplate.image = the plate drawn from this image at its
    // natural size, the name text px in from its left, in weight.
    // scale (textbox: its box images and next cue; lamp; nameplate image; each button) = that element's images drawn at
    // scale design px per image px, the original's sprite scale (skinScale above); positions stay design px.
    // textbox.tint = the box images' trim (each mask's alpha: rim, glow, printed
    // tab) takes the speaker's own colour with its luminance kept; cue = the page cue's colours too. by: the colour's source.
    // menu = the stage menu's accent follows too (kept readable on the
    // panel); a button's tint = its own mask (the SKIP frame), the same blend as the box trim.
    // printed = the box images carry the plate (the original's
    // printed tab) - the layout draws the name only; sides = per speaker side, the name's x on the box image (align end = its
    // right edge there), the plain image keeping x.
    // textbox.fit = the share of the stage width the box image may take (default
    // .96; a box image as wide as the design screen's HUD row needs 1); textbox.stroke = an outline round the text (colour,
    // px); nameplate.fill = the name's two-band ink (upper, lower half); nameplate.shadow = its outline's drop shadow [dx, dy]
    // px; nameplate.spacing = the name's own letter spacing (em); nameplate.center = with an image plate, the name centred on
    // this x; nameplate.band = a strip under the name that follows its width (skinNameBand);
    // cast = per-figure art (skinCast; a cast box at textbox.scale, a cast plate at nameplate.scale); decor = still HUD prints.
    // lead (§18 N9): the plate leads the lines - on a page without a face (art bare) it moves with them to the face's place.
    // tint: the name's glyphs in the speaker's colour at nameplate.paint.fg's luminance (stageSkinTint, as the box trim).
    // slice (skinSlice): the image plate 9-sliced, growing along the name - down for a vertical plate, right for a level one -
    // up to grow design px past its drawn size before the name shrinks; the name keeps pad [start, end] (design px along that
    // axis; default the slice edges there) clear of the plate's two ends. Needs image; grow and pad need slice.
    nameplate:value => skinObject({x:skinPx,y:skinPx,w:skinNumber(0,4096),h:skinNumber(4,512),font:skinNumber(8,256),stroke:skinNumber(0,16),emblem:skinArray(skinPx,3,3),image:skinImage,text:skinNumber(0,4096),weight:skinEnum([400,500,700]),scale:skinScale,
        slice:skinSlice,grow:skinNumber(0,2048),pad:skinArray(skinNumber(0,4096),2,2),
        vertical:vertical => vertical === true,printed:printed => printed === true,sides:skinObject({left:skinNameSide,center:skinNameSide,right:skinNameSide}),
        halo:skinHalo,initials:skinInitials,lift:skinNumber(-256,256),fill:skinInk,shadow:skinArray(skinNumber(-32,32),2,2),spacing:skinNumber(-0.2,0.5),band:skinNameBand,center:skinNumber(0,4096),rotate:skinNumber(-15,15),narrow:skinEnum(['pill','level','under']),wide:skinEnum(['under']),lead:value => value === true,tint:value => value === true,axis:skinEnum(['portrait'])},['x','y','h','font'])(value) && !(value.printed && value.image) && !(value.slice && !value.image) && !((value.grow !== undefined || value.pad) && !value.slice)
        // axis portrait: a level plate's name centred on the
        // shown face's vertical axis, whatever its length (x stays the plate's place on a page without a face).
        && !(value.axis && (value.vertical || value.sides || value.printed))
        // wide under: on wide stages the plate stands just under the face window
        // on its axis while a face shows, the lines keeping the box's own top; it is the axis plate's place, so it needs axis.
        && !(value.wide && !value.axis),
        // level (§18 N9): on phones the drawn plate (hanging or level) is set as a level tag on the box's top edge at its left.
    cast:skinCast,
    decor:skinArray(skinArtDecor,1,8),
    // Narration without a box: centred lines (font and line pitch px) over a black veil of this opacity on the scene; y = the
    // block's vertical centre on the design screen (default its middle; the original's face can sit its lines off centre).
    narration:skinObject({font:skinNumber(8,256),pitch:skinNumber(8,512),veil:skinNumber(0,.9),y:skinNumber(0,4096),
        layout:skinEnum(['box','free','band']),ink:skinColor,halo:value => value === false || skinHalo(value),veilColor:skinColor,
        band:skinObject({font:skinNumber(8,256),pitch:skinNumber(8,512),veil:skinNumber(0,.9),bottom:skinNumber(0,4096)},[]),
        lines:skinObject({fade:skinNumber(0,5),stagger:skinNumber(0,5),rise:skinNumber(0,256)},['fade','stagger'])},['font','pitch','veil']),
    // The end-of-round menu as image bars: plain / off (cannot act) bar images, their 9-slice insets [top,right,bottom,left]
    // (a bar grows past its image height), the text column and its block centre in the bar, text size and line pitch, the
    // gap between bars and the stack's vertical centre on the design screen. tool: 重新生成 drawn as this image, `h` px high, centred at `x` px on the 自由输入 bar, which then takes the whole row.
    // tint / tool.tint: masks of the plain bar (sliced as the bar) and of the tool image whose
    // alpha takes the speaker colour as the box trim does (needs textbox.tint); the off bar stays as drawn. tool.send: the 自由输入 row's one control - image while empty (重新生成), send once it holds text.
    // a negative gap overlaps the bars (the original's layout spacing); ink / weight /
    // spacing = the words' colour, weight and letter spacing (em) on the plain bar; focus = the bar image and ink under the
    // pointer and keyboard focus (the original's highlighted sprite). band [top, bottom] = the image rows where every bar image
    // (plain, off, focus) keeps its fill under the text column's glyphs, around the middle; its edges lie in the end slices.
    // images.alt / focus.alt: the even rows' own bar and focus images (alternating colours); focus.ray: a laser line
    // from the focused bar's middle on to the stage's edges (color, alt = the even rows', width bar px); number.numerals kanji (§18 N9):
    // 一 二 三 seal numerals in the name face instead of 01 02 03; number.prefix: words
    // before the number (CALL 01).
    // anchor: where the stack stands on wide stages - stage = centred on the
    // game area's height, the box stepping aside while it shows (as center does); above-box = centred in the room above the box
    // image's top, the box (the line just read) staying in view. tool.button (instead of image / send): the 自由输入 row's control
    // drawn as a buttonArt body (normal, hover, disabled) with the action's own icon (重新生成 / 发送) in its glyph box, in ink
    // (one colour, or [at rest, under the pointer / focus] for a body that lights up).
    choices:value => skinObject({images:skinObject({plain:skinImage,off:skinImage,alt:skinImage},['plain']),slice:skinSlice,text:skinArray(skinNumber(0,4096),3,3),band:skinArray(skinNumber(0,4096),2,2),
        font:skinNumber(8,256),pitch:skinNumber(8,512),gap:skinNumber(-512,512),center:skinNumber(0,4096),anchor:skinEnum(['stage','above-box']),x:skinNumber(0,8192),align:skinEnum(['left','center','right']),tilt:skinArray(skinNumber(-15,15),2,2),stagger:skinArray(skinNumber(-512,512),2,2),tint:skinImage,
        tool:tool => skinObject({image:skinImage,x:skinNumber(0,4096),h:skinNumber(8,1024),tint:skinImage,send:skinImage,button:skinButtonArt,ink:ink => skinColor(ink) || skinArray(skinColor,2,2)(ink)},['x','h'])(tool)
            && (tool.button ? !tool.image && !tool.send && !tool.tint : Boolean(tool.image && tool.send) && !tool.ink),
        // number: each suggestion row numbered 01, 02, ... centred at x on the bar (its cell drawn in the bar images).
        ink:skinColor,weight:skinEnum([400,500,700]),spacing:skinNumber(0,.5),focus:skinObject({image:skinImage,ink:skinColor,dx:skinNumber(-256,256),alt:skinImage,ray:skinObject({color:skinColor,alt:skinColor,width:skinNumber(1,16)},['color','width'])},['image']),
        number:skinObject({x:skinNumber(0,4096),font:skinNumber(8,256),ink:skinColor,focusInk:skinColor,dy:skinNumber(-256,256),free:value => typeof value === 'string' && /^[^"\\]{1,3}$/.test(value),
            prefix:value => typeof value === 'string' && /^[^"\\]{1,8}$/.test(value),numerals:skinEnum(['kanji'])},['x','font'])},['images','slice','text','font','pitch','gap'])(value) && Object.hasOwn(value,'center') !== Object.hasOwn(value,'anchor'),
    // The existing quick actions drawn on the stage: backlog (LOG), auto and skip; menu = the stage menu (Esc), the one entry
    // to everything the original lacks (it replaces quickMenu's fold control on wide stages; narrow ones keep the fold).
    buttons:skinObject({backlog:skinArtButton,auto:skinArtButton,skip:skinArtButton,menu:skinArtButton}),
    // the stage menu drawn as the original's own menu screen (skinMenu above).
    menu:skinMenu,
    // the backlog, CONFIG and voice controls drawn as the original's (skinBacklog above).
    backlog:skinBacklog,config:skinConfig,voice:skinVoice,confirm:skinConfirm,
    // The speaker's portrait (the face window's mood avatar) for an ADV layout, which otherwise has none: a square `size` px
    // wide, its left edge at `left` and its bottom `bottom` px above the screen's bottom edge (Persona 5's bust).
    portrait:skinPortrait,
    // The text box drawn as vector shapes (skinShape above; Persona 5's measured box and thought cloud).
    shape:skinShape,
    // The items mod's card drawn as the original's own frame (skinItem above).
    item:skinItem,
    // A static image or equal-cell sheet replaces the entry wheel once the skin bundle arrives.
    // Frame timing and placement are declarative; bundled SVG remains inert.
    // `parts`: 2-4 marks drawn as one unit, each with its own image and motion,
    // placed by `box` [x, y, w, h] in one shared design frame (the original's own layout); the unit's height is 1.4em x scale.
    // With art.screenWidth the boxes are design-screen px: on wide stages the unit is drawn 1:1 in art px (scale not applied)
    // and, at `place: bottom-right`, keeps its own margins from the game area's corner.
    // `place`: `bottom-right` stands the loader in the stage's bottom-right corner on no
    // plate, as the original's loading mark (the slow-load line rides above it); default `center` (the centred group).
    // `words`: the loader art carries its own loading words, so the veil and the slow notice
    // draw no engine caption, step line or bar of their own (kept for screen readers only).
    spinner:skinObject({...skinSpinnerMark,at:skinArray(skinNumber(0,8192),3,3),scale:skinNumber(.1,8),place:skinEnum(['center','bottom-right']),words:skinEnum([true,false]),
        parts:skinArray(skinObject({...skinSpinnerMark,box:skinArray(skinNumber(0,8192),4,4)},['image','box']),2,4)},[])
},['screen']);
// how the core effects look in this skin - one entry per core
// effect id, each field optional and merged over the engine's default (card-local > skin > engine); the director only
// ever names the id. flash / flash-red / blackout: a full-screen colour, fade in `in` s to `peak`, hold, fade out, tail,
// `cycles` times (at most 3: never more than three flashes a second from one effect). shake-1..3: an amplitude (share of
// the stage height) over ms, or a step path [[x, y], ...] in px of a screen art.screen tall (576 without art), one linear
// `step` s per point; target screen or background. shock: its burst (a flash), the shockwave, the shake it adds.
// blur / bright / contrast / memory / vignette: the screen look's params (no images) and fades.
// transition: the scene change the director leaves unspecified, and the black / white cover's out / hold / in.
// thinking: the inner-monologue backdrop - an image from the bundle (else the engine's dim), its overscan and fades.
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
// A bust is placed on the design screen, so it needs the screen's width too.
// A tint mask (a button's, the choice bar's, the choice tool's) takes the colour the box trim takes (textbox.tint names its source).
const skinArt = value => skinArtShape(value) && (!value.portrait?.bust && !value.menu && !value.backlog && !value.config && !value.confirm && !value.item || Object.hasOwn(value,'screenWidth'))
    && [...Object.values(value.buttons || {}),value.choices || {},value.choices?.tool || {}].every(target => !target.tint || value.textbox?.tint)
    && (!value.choices?.band || value.choices.band[0] < value.choices.text[2] && value.choices.text[2] < value.choices.band[1])
    // A hinted button draws only its label part, so it carries no tint mask (the mask covers the whole image).
    && Object.values(value.buttons || {}).every(button => !(button.tint && button.hint));
// the 履历 drawn by entry role, not by mod. Every
// entry has one of a fixed set of roles (STAGE_BACKLOG_ROLES); a skin picks the panel's layout (list = the reading sheet with
// its title row, overlay = rows straight over the dimmed stage, closed from a corner button) and per role one look from that
// role's closed set. paint = the look's own plate: bg at opacity, fg the words, border its rim, line a thin outer line round
// the rim (default the textbox paint); corner = the outline's corners; name = the speaker name's ink (default the speaker's
// image colour); tint by speaker = the bubble's outer line and name in the speaker's image colour (the one colour authority,
// figureColor), fallback where the speaker has none (the player); wrap = the open / close marks round a band's or plaque's
// words. A role the skin leaves out takes the layout's default look (stageSkinBacklog in stage-skin.cjs).
const STAGE_BACKLOG_ROLES = Object.freeze({speech:['row','bubble'],player:['row','bubble'],narration:['row','band'],notice:['row','plaque','band'],divider:['rule','none']});
const skinBacklogPaint = skinObject({bg:skinColor,fg:skinColor,border:skinColor,line:skinColor},['bg','fg']);
const skinBacklogMark = value => typeof value === 'string' && value.length >= 1 && value.length <= 2;
const skinBacklogLook = looks => value => skinObject({look:skinEnum(looks),paint:skinBacklogPaint,opacity:skinNumber(.5,1),corner:skinEnum(['round','chamfer','square']),
    name:skinColor,tint:skinObject({by:skinEnum(['speaker']),fallback:skinColor},['by','fallback']),wrap:skinArray(skinBacklogMark,2,2)},['look'])(value)
    // A row is the engine's list row (its paint is the panel's); only a plate has paint, corner and opacity; only a bubble a name
    // or a tint; only a band or plaque wraps its words; a rule or none is just the look.
    && (value.look !== 'row' && value.look !== 'rule' && value.look !== 'none' || !value.paint && !value.corner && value.opacity === undefined)
    && (value.look === 'bubble' || value.name === undefined && value.tint === undefined) && (value.look === 'band' || value.look === 'plaque' || !value.wrap);
// metrics: the overlay's plates measured on the original, in design px of art.screen (so it needs art.screenWidth). The words'
// size sets the scale on a phone (the body at the reading size), so a plate keeps the original's proportions there.
// bubble: w x h (the least height; more lines grow it), inset = the outer edge's distance from the game area's side it stands
// on, corner, line + rim = the outer line and rim widths inward from the outer edge, tail [base top, base bottom, tip out,
// tip y] on the outer edge (y from the top, out past the side), name [x from the tail side's outer edge, top, font],
// text [left, right padding, the block's vertical centre from the top, font, line pitch], margin [above, below].
// band: w x h centred on the game area, corner, rim, text [font, pitch], margin. plaque: h, corner, rim, pad (each side),
// text [font, pitch], margin. close: the corner button's top-left x, y on the game area and its size.
const skinBacklogMargin = skinArray(skinNumber(0,512),2,2);
const skinBacklogPlate = {corner:skinNumber(0,128),rim:skinNumber(0,32),margin:skinBacklogMargin,text:skinArray(skinNumber(4,512),2,2)};
const skinBacklogMetrics = skinObject({
    bubble:value => skinObject({w:skinNumber(32,8192),h:skinNumber(16,2048),inset:skinNumber(0,4096),corner:skinNumber(0,128),line:skinNumber(0,32),rim:skinNumber(0,32),
        tail:skinArray(skinNumber(0,1024),4,4),name:skinArray(skinNumber(0,1024),3,3),text:skinArray(skinNumber(0,4096),5,5),margin:skinBacklogMargin},['w','h','name','text'])(value)
        && (!value.tail || value.tail[0] < value.tail[1]),
    band:skinObject({w:skinNumber(32,8192),h:skinNumber(16,2048),...skinBacklogPlate},['w','h','text']),
    plaque:skinObject({h:skinNumber(16,2048),pad:skinNumber(0,512),...skinBacklogPlate},['h','text']),
    close:skinObject({x:skinNumber(0,8192),y:skinNumber(0,8192),size:skinNumber(16,512)},['x','y','size'])});
const skinBacklogRoles = skinObject({
    layout:skinEnum(['list','overlay']),
    // anchor end (§18 N9): the list only as tall as its rows, standing at the panel's bottom (by the box) - no empty sheet above.
    anchor:skinEnum(['end']),
    // dim: the overlay's veil - black at this opacity over the stage (default the skin's panel veil).
    dim:skinNumber(0,1),
    roles:skinObject(Object.fromEntries(Object.entries(STAGE_BACKLOG_ROLES).map(([role,looks]) => [role,skinBacklogLook(looks)]))),
    metrics:skinBacklogMetrics,
    // close: where the one visible close stands (head = the title row's right end, corner = the overlay's bottom-left) and
    // the corner button's paint (its glyph in fg on the bg face inside a border frame).
    close:skinObject({place:skinEnum(['head','corner']),paint:skinBacklogPaint}),
    // badge: how a mod-declared line kind's badge (「手机」, its {line:{label}}) is drawn - the skin styles
    // every line kind alike, never one mod. look pill (outline capsule, the default) | solid (filled chip; needs bg) | bracket
    // (the word in 【】); place name (after the speaker's name, the default) | text (ahead of the words); paint fg, bg?, border?;
    // icon line (the kind's icon as declared, the default) | bold .
    badge:value => skinObject({show:value => value === false,look:skinEnum(['pill','solid','bracket']),place:skinEnum(['name','text']),icon:skinEnum(['line','bold']),
        paint:skinObject({fg:skinColor,bg:skinColor,border:skinColor},['fg'])})(value) && (value.look !== 'solid' || Boolean(value.paint?.bg)) && (value.look !== 'bracket' || !value.paint?.bg && !value.paint?.border)},['layout']);
const skinMap = (keyCheck,valueCheck,max) => value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= max && Object.entries(value).every(([key,item]) => keyCheck(key) && valueCheck(item));
const skinModId = value => /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value);
const skinModOptions = skinMap(key => key.length > 0 && key.length <= 128,() => true,128);
const skinMod = skinObject({enabled:value => typeof value === 'boolean',options:skinModOptions,locks:value => skinArray(key => typeof key === 'string' && key.length <= 128,0,128)(value) && new Set(value).size === value.length});
// the stage CONFIG screen's own
// look at every width - its frame, tab list, section heads, rows and one look per control type; a type the skin leaves out,
// or one the engine adds later, takes controls.other. Data only: closed words (the first of each list is the engine's look
// today), the panel's seed colours (checked like ui) and optional images. What the screen holds, its keys, its focus order and
// the settings themselves stay the engine's. A skin without `config` draws the screen exactly as before.
const STAGE_CONFIG_LOOKS = Object.freeze({frame:['sheet','drawer','full'],title:['word','vertical','hidden'],nav:['tabs','index','pills'],section:['caption','rule','band','numbered'],row:['plain','line','card'],
    controls:Object.freeze({segmented:['groove','chips','stamps'],toggle:['switch','lamp','word'],slider:['track','ticks','bar'],select:['field','plate'],text:['inline','plate'],colour:['swatch','ring'],picker:['row','tile'],other:['row','block']})});
const skinFlag = value => typeof value === 'boolean';
// plate = one image stretched over the part by its nine-slice (image px; scale = CSS px per image px at the edges);
// states = the same with the part's state images (plain; on = chosen / open; focus = pointer and keyboard focus).
const skinConfigPlate = skinObject({image:skinImage,slice:skinSlice,scale:skinNumber(.25,8)},['image']);
const skinConfigStates = skinObject({plain:skinImage,on:skinImage,focus:skinImage,slice:skinSlice,scale:skinNumber(.25,8)},['plain']);
// title.word: the CONFIG title is 设置 unless a skin names one replacement word - one
// word, no Latin letters (no CONFIG / OPTION), no spaces or separators, and never 设置 paired with anything (R25: no second label).
const skinConfigWordOne = value => !/[\p{Script=Latin}\s·・/|｜／—–-]/u.test(value) && (value === '设置' || !value.includes('设置'));
const skinConfigWord = value => typeof value === 'string' && [...value].length >= 1 && [...value].length <= 24 && !/[\r\n"\\]/.test(value) && skinConfigWordOne(value);
const skinConfigControls = skinObject(Object.fromEntries(Object.entries(STAGE_CONFIG_LOOKS.controls).map(([type,looks]) => [type,type === 'slider'
    ? skinObject({look:skinEnum(looks),track:skinConfigPlate,fill:skinConfigPlate,thumb:skinObject({image:skinImage,focus:skinImage,scale:skinNumber(.25,8)},['image'])})
    : skinObject({look:skinEnum(looks),plate:skinConfigStates})])));
const skinConfigSurface = skinObject({
    // frame: sheet = the centred sheet, drawer = a full-height panel from one side (the stage visible beside it), full = the
    // whole stage; side = the drawer's side; width = the sheet's / drawer's share of
    // the stage width; paint = the panel's own seed colours (opaque, R15); backdrop = what is drawn behind the frame.
    frame:skinObject({look:skinEnum(STAGE_CONFIG_LOOKS.frame),side:skinEnum(['start','end']),width:skinNumber(.3,1),paint:skinPaint,plate:skinConfigPlate,corner:skinNumber(0,48),
        texture:skinEnum(['halftone','hatch','ruled']),backdrop:skinObject({image:skinImage,veil:skinObject({color:skinColor,opacity:skinNumber(0,1)},['color','opacity'])})}),
    // title: word = one display word in place of 设置 (skinConfigWordOne; the accessible name stays 设置); plate = a drawn wordmark behind it.
    title:skinObject({look:skinEnum(STAGE_CONFIG_LOOKS.title),word:skinConfigWord,plate:skinConfigPlate}),
    // nav.paint: the tab list's own opaque ground and inks (a gold leaf beside a dark page), checked like
    // frame.paint: fg / bg and accent / bg >= 4.5, fgMuted / bg >= 3; the open tab's plate (nav.plate.on) may carry the page's.
    nav:skinObject({look:skinEnum(STAGE_CONFIG_LOOKS.nav),place:skinEnum(['start','end','top']),numerals:skinEnum(['none','arabic','roman','kanji']),plate:skinConfigStates,
        paint:skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onBg:skinColor},['bg','fg'])}),
    section:skinObject({look:skinEnum(STAGE_CONFIG_LOOKS.section),plate:skinConfigPlate,sticky:skinFlag}),
    row:skinObject({look:skinEnum(STAGE_CONFIG_LOOKS.row),label:skinEnum(['start','above']),density:skinEnum(['compact','regular','airy']),columns:skinNumber(1,2,true),plate:skinConfigStates}),
    controls:skinConfigControls,
    scroll:skinObject({fade:skinEnum(['none','edge'])}),
    motion:skinObject({rows:skinEnum(['none','rise','fade']),stagger:skinNumber(0,60,true)})});
// The images of the CONFIG surface (skinConfigSurface).
function stageSkinConfigFiles(config) {
    const plate=value => value ? [value.image,value.plain,value.on,value.focus].filter(Boolean) : [];
    return [config?.frame?.plate,config?.frame?.backdrop && {image:config.frame.backdrop.image},config?.title?.plate,config?.nav?.plate,config?.section?.plate,config?.row?.plate,
        ...Object.values(config?.controls || {}).flatMap(control => [control.plate,control.track,control.fill,control.thumb])].flatMap(plate);
}
const stageSkinShape = skinObject({
    schema:skinEnum(['dsh.skin/1']),id:skinId,label:skinText,
    assets:skinMap(skinId,value => skinImage(value) || skinFile(value),64),mods:skinMap(skinModId,skinMod,64),
    ui:skinObject({bg:skinColor,fg:skinColor,fgMuted:skinColor,accent:skinColor,onAccent:skinColor,border:skinColor,radius:skinNumber(0,40),textShadow:skinEnum(['none']),titleFont:skinId,veil:skinObject({color:skinColor,opacity:skinNumber(0,1)},['color','opacity']),texture:skinEnum(['halftone'])}),
    levels:value => value && typeof value === 'object' && !Array.isArray(value) && [1,2,3].includes(value.default) && Object.keys(value).every(key => ['1','2','3','default'].includes(key)),
    overlay:value => value && typeof value === 'object' && !Array.isArray(value),
    license:skinObject({privateUse:value => typeof value === 'boolean',notes:skinArray(skinText,0,32),derived:skinArray(skinEnum(STAGE_SKIN_SOURCE_KINDS),0,32)},['privateUse']),
    // layout scrim|card, frame/ui texture, nameplate ribbon|underline + tint,
    // cursors ring|star and quickMenu.layout are closed words; a skin without them renders exactly as before.
    // layout slash, nameplate ransom and cursor arrow join the same set.
    // bubble|panel|band are translucent ADV plates.
    // motion.page (§18 E4): the box's frame on every new page. bright is allowed ; a skin that turns
    // thousands of pages should not glow on each one , which is the skin's choice, not the engine's.
    textbox:skinObject({layout:skinEnum(['box','scrim','card','slash','bubble','panel','band']),paint:skinPaint,motion:skinObject({page:skinMotion},['page']),shape:skinObject({radius:skinNumber(0,40),borderWidth:skinNumber(0,8),rings:skinRings(3,12)}),frame:skinObject({top:skinBand,bottom:skinBand,corners:skinObject({kind:skinEnum(['none','diamond','rivet','bow','bracket','flourish']),colors:skinArray(skinColor,0,2)},['kind']),insets:skinArray(skinNumber(24,80),4,4),texture:skinEnum(['halftone'])})},['paint']),
    // motion (§18 E4): the plate's entrance when the speaker changes (dx / dy in em of the name; it turns about its top).
    nameplate:skinObject({shape:skinEnum(['pill','tag','torn','jagged','plate','plain','ribbon','underline','ransom','fade','emblem','chamfer','outline']),tint:skinEnum(['figure']),enter:skinEnum(['unfold']),paint:skinObject({bg:skinColor,fg:skinColor,border:skinColor},['bg','fg']),rotate:skinNumber(-3,3),size:skinNumber(18,40),letterSpacing:skinNumber(0,0.2),rings:skinRings(2,8),motion:skinMotion},['shape','paint']),
    // the skin's stage-mode fonts, every field optional. body = the stage role (text
    // box; name / ui fall back to it), film = cinematic subtitles (falls back to body).
    // faces: the skin's own font files (skinFontFaces above); an id in body / name / ui / film may name one of them.
    font:skinObject({body:skinId,name:skinId,ui:skinId,film:skinId,faces:skinFontFaces}),
    // textStyle.narration (§18 N9): the ink of narration pages (no speaker) in the box and the backlog, >= 7:1 on the box.
    textStyle:skinObject({weight:skinEnum([400,500,700]),sizeScale:skinNumber(0.85,1.2),lineHeight:skinNumber(1.4,1.9),letterSpacing:skinNumber(0,0.12),emphasis:skinColor,wrap:skinEnum(['phrase']),narration:skinColor}),
    // (§18 E1): the stepped reveals' glyph track on the fixed 12/s clock. poses = the glyph's own entrance poses
    // (step 0, 1, ...; then at rest), replacing the reveal's two; stepFps = how long each pose holds, in whole steps
    // (round(12 / stepFps)); emphasis = the entrance ink (none: the body ink; ink: the flash) or jitter: the flash plus a
    // seeded per-glyph offset of jitter x 0.05em while it enters.
    textFx:skinObject({reveal:skinEnum(['type','ink','pop','stutter','stamp','cut','scan','scrawl']),stepFps:skinNumber(6,14),charsPerStep:skinNumber(1,6,true),cps:skinNumber(10,80),from:skinEnum(['top','bottom']),flash:skinColor,emphasis:skinEnum(['none','jitter','ink']),jitter:skinNumber(0,1.5),
        poses:skinArray(skinGlyphPose,1,4)},['reveal']),
    cursor:skinObject({name:skinEnum(['triangle','wheel','lollipop','eye','rose','rec','candle','gear','light','bell','feather','needle','teacup','whale','ring','star','arrow','fleur','gem','sphere','play']),color:skinColor,accent:skinColor,fps:skinNumber(2,12)},['name']),
    quickMenu:skinQuickMenu,
    // duck (upstream stage core 37): how far (dB) a sounding voice / sound effect lowers each layer below it, over the
    // engine's amount (stage audio duck matrix).
    sfx:skinSfx,duck:skinDuck,photosensitive:value => typeof value === 'boolean',figureSlots:skinSlots,
    // at most this many figures drawn at once.
    maxFigures:skinNumber(1,6,true),
    // how the original frames its figures - a multiplier on the shared
    // ruler and where the tallest figure's head top stands (share of the stage height from the top). Presentation only;
    // relative heights stay the ruler's.
    // mode none: the stage draws no figures at all (presentation only; the cast and its state go on).
    // ruler: a fixed camera - the cast is sized on this height (cm) instead of
    // the scene's tallest figure, a figure this tall has its head top at `top`, and the size is the drawn count's.
    // spread: the share of the ruler curve's (log) height gap shown for figures of a metre and taller (1 = the shared ruler's).
    figures:skinObject({scale:skinNumber(0.2,4),top:skinNumber(-0.2,0.6),mode:skinEnum(['stage','none']),ruler:skinNumber(100,250),spread:skinNumber(0.2,1)}),
    // false = figures who are not speaking keep full light.
    dimListeners:value => value === false,
    art:skinArt,
    // the top bar (the registered stage entries) hides while
    // reading and reveals on demand (auto, the default) or always shows; the player's CONFIG 顶栏按钮 overrides it.
    // timer.hide - drawn art.buttons put away while the stage
    // shows a timer (the original's trial UI stands its clock where the menu gear was, in dialogue and debate alike).
    // hud.plate: an opaque ground of its own behind the top bar's chips (place, BGM, 声音 and the top-right buttons),
    // so their labels read over a bright scene; fg is their ink on it (>= 4.5:1).
        hud:skinObject({reveal:skinEnum(['auto','always']),timer:skinObject({hide:skinHudHide},['hide']),plate:skinObject({bg:skinColor,fg:skinColor},['bg','fg'])}),
    // the 履历's layout and its per-role looks (skinBacklogRoles above).
    backlog:skinBacklogRoles,
    effects:skinEffects,
    // while the stage's current performance
    // declares skinMode <id>, the text reads as modes.<id>'s statement (large words over the scene) instead of the box.
    modes:skinModes,
    // how the stage's surfaces come and go (skinTransitions above).
    transitions:skinTransitions,waitLines:skinWaitLines,
    // the stage CONFIG screen's own look (skinConfigSurface above).
    config:skinConfigSurface
},['schema','id','label','textbox','nameplate','font','textFx']);
function skinLuminance(color) {
    const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
function skinContrast(a,b) {const x=skinLuminance(a),y=skinLuminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
// the plate opacity of the translucent ADV layouts (stage theme uses the same shares).
const STAGE_SKIN_PLATE_ALPHA = Object.freeze({bubble:.86,panel:.8,band:.74});
function skinOver(front,back,alpha) {return '#'+[1,3,5].map(i => Math.round(parseInt(front.slice(i,i+2),16)*alpha+parseInt(back.slice(i,i+2),16)*(1-alpha)).toString(16).padStart(2,'0')).join('');}
const STAGE_NARRATION_INK = '#fbf8ff';
function stageSkinNarrationGrounds(narration) {
    if (!narration || narration.layout === 'box') return [];
    const veils=[...(narration.layout === 'band' ? [] : [narration.veil]),...(narration.layout === 'free' ? [] : [narration.band?.veil ?? 80/255])];
    const scenes=veils.flatMap(alpha => ['#000000','#ffffff'].map(scene => skinOver(narration.veilColor || '#000000',scene,alpha)));
    if (narration.halo === false) return scenes;
    return scenes.map(scene => skinOver(narration.halo?.color || '#000000',scene,narration.halo?.alpha ?? 1));
}
function validateStageSkin(value) {
    const word=value?.config?.title?.word;
    if (typeof word === 'string' && !skinConfigWordOne(word)) throw Object.assign(new Error('config.title.word ' + JSON.stringify(word) + ' is not one word: the CONFIG title is 设置 - omit title.word, or name one replacement word without Latin letters, spaces or separators and never paired with 设置'),{code:'INVALID_SKIN'});
    if (!stageSkinShape(value) || new TextEncoder().encode(JSON.stringify(value)).length > (value.overlay || value.levels ? 262144 : 32768)) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    if ((value.overlay || value.levels) && typeof module !== 'undefined' && typeof window === 'undefined') require('./skin-overlay.cjs').validateSkinOverlay(value);
    const spinner=value.art?.spinner;
    // A mark is either one image or a row of parts (each part owns its motion; at only places a single image, never with place).
    if (spinner && (spinner.at && spinner.place || spinner.parts ? ['image','motion','period','loop','fps','sheet','at'].some(key => Object.hasOwn(spinner,key)) || !spinner.parts.every(part => skinSpinnerTiming(part) && part.box[2] > 0 && part.box[3] > 0)
        : !spinner.image || !skinSpinnerTiming(spinner))) throw Object.assign(new Error('Invalid skin loading animation'),{code:'INVALID_SKIN'});
    const paint=value.textbox.paint, name=value.nameplate.paint;
    const ui={...paint,...value.ui};
    const pairs=[...(value.ui ? [[ui.fg,ui.bg,4.5],[ui.fgMuted,ui.bg,3],[ui.accent,ui.bg,4.5],[ui.onAccent,ui.accent,4.5]] : []),[paint.fg,paint.bg,4.5],[paint.fgMuted,paint.bg,3],[value.textStyle?.emphasis || paint.accent || paint.fg,paint.bg,4.5],...(value.textStyle?.narration ? [[value.textStyle.narration,paint.bg,7]] : []),[paint.onAccent,paint.accent,4.5],
        // The outlined names  take their contrast from the outline.
        [name.fg,['outline','chamfer'].includes(value.nameplate.shape) ? name.border : name.bg,4.5],[value.quickMenu?.fg,value.quickMenu?.bg,4.5],
        // the ransom plate also sets the name ink on its third block, paint.border.
        ...(value.nameplate.shape === 'ransom' ? [[name.fg,name.border,4.5]] : []),
        // The CONFIG surface's own panel  reads like ui.
        ...(value.config?.frame?.paint ? (cf => [[cf.fg,cf.bg,4.5],[cf.fgMuted,cf.bg,3],[cf.accent,cf.bg,4.5],[cf.onAccent,cf.accent,4.5]])(value.config.frame.paint) : []),
        // nav.paint: the tab list's inks on its own ground; onBg = the open tab's ink on its plate's ground (the panel's bg).
        ...(value.config?.nav?.paint ? (np => [[np.fg,np.bg,4.5],[np.fgMuted,np.bg,3],[np.accent,np.bg,4.5],[np.onBg,value.config.frame?.paint?.bg || ui.bg,4.5]])(value.config.nav.paint) : []),
        ...(value.hud?.plate ? [[value.hud.plate.fg,value.hud.plate.bg,4.5]] : [])];
    if (pairs.some(([a,b,min]) => a && (!b || skinContrast(a,b)+1e-6 < min))) throw Object.assign(new Error('Skin text contrast is unsafe'),{code:'SKIN_CONTRAST'});
    if (stageSkinNarrationGrounds(value.art?.narration).some(ground => skinContrast(value.art.narration.ink || STAGE_NARRATION_INK,ground)+1e-6 < 4.5)) throw Object.assign(new Error('Skin narration contrast is unsafe'),{code:'SKIN_CONTRAST'});
    // A scrim fades to the scene: its base must be dark enough that light text over the scene still has a dark ground.
    if (value.textbox.layout === 'scrim' && skinLuminance(paint.bg) > 0.03) throw Object.assign(new Error('Skin scrim must be dark'),{code:'SKIN_CONTRAST'});
    // The translucent plates (fixed opacity, STAGE_SKIN_PLATE_ALPHA) keep the body text at 4.5:1 over a black and a white scene.
    const alpha=STAGE_SKIN_PLATE_ALPHA[value.textbox.layout];
    if (alpha && ['#000000','#ffffff'].some(scene => skinContrast(paint.fg,skinOver(paint.bg,scene,alpha))+1e-6 < 4.5)) throw Object.assign(new Error('Skin plate text contrast is unsafe over the scene'),{code:'SKIN_CONTRAST'});
    // The 履历's role plates  keep their words at 4.5:1 over a black and a white scene at their
    // opacity; the corner close keeps its glyph at 3:1. Names are measured at runtime (data-figure-ink) like every image colour.
    for (const role of Object.values(value.backlog?.roles || {})) if (role.paint && ['#000000','#ffffff'].some(scene => skinContrast(role.paint.fg,skinOver(role.paint.bg,scene,role.opacity ?? 1))+1e-6 < 4.5))
        throw Object.assign(new Error('Skin backlog text contrast is unsafe over the scene'),{code:'SKIN_CONTRAST'});
    // The corner close is told by its frame on the dimmed stage: the frame keeps 3:1 against black.
    const close=value.backlog?.close?.paint;
    if (close && skinContrast(close.border || close.bg,'#000000')+1e-6 < 3) throw Object.assign(new Error('Skin backlog close contrast is unsafe'),{code:'SKIN_CONTRAST'});
    const badge=value.backlog?.badge?.paint;
    if (badge?.bg && skinContrast(badge.fg,badge.bg)+1e-6 < 4.5) throw Object.assign(new Error('Skin backlog badge contrast is unsafe'),{code:'SKIN_CONTRAST'});
    // Metrics are design px of the art's design screen.
    if (value.backlog?.metrics && !value.art?.screenWidth) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    // One authority per screen: CONFIG is either the original's wide-stage images (art.config)
    // or the skin's own surface (config), never both.
    if (value.config && value.art?.config) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    // A printed plate is the box image's own: there is no drawn plate for nameplate.tint to colour.
    if (value.art?.nameplate?.printed && value.nameplate.tint) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    // A statement is placed in design px: a mode needs the art's design screen.
    if (value.modes && !value.art) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    // A mode or the timer hides only buttons the skin draws.
    if ([value.hud?.timer,...Object.values(value.modes || {}).map(mode => mode.hud)].some(hud => hud?.hide?.some(action => !value.art?.buttons?.[action]))) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    // axis portrait centres the plate on the face window: there has to be one.
    if (value.art?.nameplate?.narrow === 'under' && !value.art.portrait?.narrow) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    if (value.art?.nameplate?.axis && !value.art.portrait) throw Object.assign(new Error('Invalid dsh.skin/1 document'),{code:'INVALID_SKIN'});
    const frame=value.textbox.frame;
    for (const [side,index,fallback] of [['top',0,42],['bottom',2,58]]) {
        const band=frame?.[side];
        if (band && (band.offset ?? 9)+(band.height ?? 14) > (frame.insets?.[index] ?? fallback)) throw Object.assign(new Error('Skin ornament overlaps content'),{code:'SKIN_GEOMETRY'});
    }
    if (value.levels) for (const key of ['1','2','3']) if (value.levels[key]) {const look=stageSkinAppearance(value,Number(key));if (look) validateStageSkin(look);}
    return value;
}
function stageSkinAppearance(value, level = value.levels?.default) {
    const {levels,overlay,...appearance}=value;
    if (!levels) return appearance;
    const selected=levels[level];
    if (!selected) throw Object.assign(new Error('Skin level is not declared'),{code:'INVALID_SKIN_LEVEL'});
    if (selected.look === 'theme') return null;
    for (const key of ['textbox','nameplate','font','textStyle','textFx','cursor','quickMenu','sfx','photosensitive','ui']) if (Object.hasOwn(selected,key)) appearance[key]=selected[key];
    return appearance;
}
function stageSkinArtFiles(art) {return [...(art?.spinner ? art.spinner.parts ? art.spinner.parts.map(part => part.image) : [art.spinner.image] : []),...Object.values(art?.textbox?.images || {}),...Object.values(art?.textbox?.tint?.masks || {}),...Object.values(art?.choices?.images || {}),...[art?.choices?.tint,art?.choices?.tool?.image,art?.choices?.tool?.tint,art?.choices?.tool?.send,art?.choices?.focus?.image,art?.choices?.focus?.alt].filter(Boolean),...stageSkinButtonFiles(art?.choices?.tool?.button),...(art?.textbox?.lamp ? [art.textbox.lamp.image] : []),...[stageSkinImageOf(art?.textbox?.next),art?.nameplate?.image].filter(Boolean),...Object.values(art?.buttons || {}).flatMap(button => [button.image,button.on,button.tint,button.narrow?.image,button.narrow?.on].filter(Boolean)),
    ...(art?.nameplate?.band ? [art.nameplate.band.image] : []),...Object.values(art?.cast || {}).flatMap(entry => [entry.box,entry.plate,entry.band?.image].filter(Boolean)),...(art?.decor || []).map(item => item.image),
    ...stageSkinScreenFiles(art),...(art?.portrait?.frame ? [art.portrait.frame.image,art.portrait.frame.glass,art.portrait.frame.back,art.portrait.frame.speaking,art.portrait.frame.tint].filter(Boolean) : []),...(art?.portrait?.placeholder?.image ? [art.portrait.placeholder.image] : []),...(art?.item ? [art.item.frame,art.item.gain?.toast?.image].filter(Boolean) : [])];}
// The images of the drawn overlays (art.menu / art.backlog / art.config / art.confirm) and of the voice controls (art.voice).
function stageSkinScreenFiles(art) {
    const placed=item => item ? [item.image,item.focus] : [], b=art?.backlog, c=art?.config, m=art?.menu, k=art?.confirm;
    return [...new Set([...(m ? [m.sheet,m.frame?.image,...Object.values(m.rows?.images || {}),m.rows?.cursor?.image,...['title','info','keys'].flatMap(key => [m[key]?.image,m[key]?.rule?.image]),
            ...Object.values(m.tiles?.art || {}).flatMap(tile => [tile.image,tile.focus]),m.tiles?.plain,m.tiles?.hover?.image,m.signal?.image,m.signal?.alert] : []),
        ...(k ? [k.band,k.top,k.bottom,k.button.plain,k.button.focus] : []),
        ...(b ? [b.sheet,b.hover?.image,...placed(b.title),...placed(b.close),...placed(b.name?.frame),...placed(b.name?.rule),b.scrollbar?.track,b.scrollbar?.thumb] : []),
        ...(c ? [c.sheet,...placed(c.title),...placed(c.close),c.tabs?.images.plain,c.tabs?.images.on,c.focus,...Object.values(c.slider || {}),...Object.values(c.toggle || {}),c.select?.plain,c.select?.focus] : []),
        ...Object.values(art?.voice || {})].filter(value => typeof value === 'string'))];
}
function stageSkinFontFiles(font) {return Object.values(font?.faces || {}).map(face => face.file);}
function stageSkinQuickFiles(menu) {return [...Object.values(menu?.icons || {}).flatMap(icon => [icon.image,icon.on].filter(Boolean)),...stageSkinButtonFiles(menu?.button),...stageSkinButtonFiles(menu?.button?.narrow)];}
// A buttonArt's state images (skinButtonArt).
function stageSkinButtonFiles(button) {return button ? [button.normal,button.hover,button.on,button.disabled].filter(Boolean) : [];}
// A playable slot's image file (skinPlayable): the image itself or its {image, frames}.image.
function stageSkinImageOf(value) {return value && typeof value === 'object' ? value.image : value;}
// A slice's edges (skinSlice): the array itself or its {edges}.
function stageSkinSliceEdges(value) {return Array.isArray(value) ? value : value?.edges;}
function stageSkinFiles(value) {return [...new Set([...Object.values(value.assets || {}),...stageSkinQuickFiles(value.quickMenu),...skinSfxFiles(value.sfx),...stageSkinArtFiles(value.art),...stageSkinConfigFiles(value.config),...Object.values(value.modes || {}).flatMap(mode => Object.values(mode.buttons || {}).flatMap(button => [button.image,button.on,button.tint].filter(Boolean))),...(value.effects?.thinking?.image ? [value.effects.thinking.image] : []),...stageSkinFontFiles(value.font),...Object.values(value.overlay?.sfx || {}),...Object.values(value.levels||{}).flatMap(level=>[...stageSkinQuickFiles(level?.quickMenu),...skinSfxFiles(level?.sfx),...stageSkinFontFiles(level?.font)])])];}
// built-in skin ids preserve the existing layout selectors, not a second theme preference.
const BUILTIN_STAGE_SKINS = Object.freeze(Object.fromEntries([
    ['classic','经典','沉静的深色阅读舞台','#0c0a14','#f5f2fa','#bcb8c6','#e9e4f3','neo-xihei-screen'],
    ['gothic','哥特','暗紫底色与浅金装饰','#0c0816','#f6f1fb','#c2b8cc','#e8d8a8','neo-zhisong-screen'],
    ['magical','魔法少女','明亮的奶油粉色舞台','#fffafd','#6b2f55','#80506d','#b7457b','resource-han-rounded'],
    // 显像管 phosphor tube: tight 4px glass corners and a dim phosphor rule.
    ['crt','显像管','深夜绿色荧光的显像管屏幕','#06110c','#c8f5d2','#7fbf95','#4dff88','neo-xihei-screen',4,'#1d5a33'],
    // 千禧晴空 Frutiger Aero: sky glass, Aero blue, a pale sky-white scrim
    // behind full sheets (optional 11th item: the ui.veil scene dimmer). No stage font: the stage falls back to the
    // system 微软雅黑 / Segoe UI stack of its era (stage fonts).
    ['aero','千禧晴空','晴朗午后的千禧年玻璃与天空','#f2f9ff','#0e2c48','#3b5f80','#0a5fae',null,16,'#8fbde3',{color:'#d4ebfb',opacity:.55}]
].map(([id,label,directorNote,bg,fg,fgMuted,accent,stage,radius=10,border=fgMuted,veil]) => [id,{schema:'dsh.skin/1',id,label,
    textbox:{paint:{bg,fg,fgMuted,accent,onAccent:bg,border},shape:{radius}},
    // Film subtitles stay 新晰黑 in every built-in (migrated from the old per-theme table).
    nameplate:{shape:'plain',paint:{bg,fg}},font:{...(stage ? {body:stage} : {}),film:'neo-xihei-screen'},textFx:{reveal:'type'},
    ui:{bg,fg,fgMuted,accent,onAccent:bg,border,radius,...(veil ? {veil} : {})}}])));
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = {STAGE_SKIN_SOURCE_KINDS,validateStageSkin,stageSkinFiles,stageSkinConfigFiles,STAGE_CONFIG_LOOKS,stageSkinScreenFiles,stageSkinImageOf,stageSkinSliceEdges,skinContrast,STAGE_SKIN_SFX_CUES,stageSkinAppearance,BUILTIN_STAGE_SKINS,STAGE_SKIN_PLATE_ALPHA,STAGE_BACKLOG_ROLES,STAGE_SKIN_TRANSITION_SURFACES,STAGE_SKIN_WIPES,STAGE_SKIN_TX_EASES};
