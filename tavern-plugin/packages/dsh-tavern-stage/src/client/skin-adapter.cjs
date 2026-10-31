function createStageSkinAdapter({contract:stageSkinContract,motion,backlog}) {
let disposed=false;const applications=new Set();
function apply(paint,args) {
    if(disposed)return ()=>{};
    const restore=paint(...args);let active=true;
    const release=()=>{if(!active)return;active=false;applications.delete(release);restore();};
    applications.add(release);return release;
}
function applyStageSkin(...args) {return apply(paintStageSkin,args);}
function applyStageSkinMode(...args) {return apply(paintStageSkinMode,args);}
function dispose() {
    if(disposed)return;disposed=true;const errors=[];
    for(const release of [...applications].reverse())try{release();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage skin cleanup failed');
}

const {stageSkinFrames,stageSkinFramePosition,STAGE_SKIN_FRAME_SLOTS,STAGE_SKIN_TX_EASE,stageSkinTxEase,stageSkinTransitionList,stageSkinTransitionTokens,stageSkinWipeClip,stageSkinTransitionKeyframes,STAGE_SKIN_EASE,stageSkinPoseScale,STAGE_SKIN_PAGE_RISE_MS,stageSkinPageFromRest,stageSkinMotionKeyframes,stageSkinGlyphPoses}=motion;
const {STAGE_BACKLOG_DEFAULTS,STAGE_BACKLOG_OPACITY,STAGE_BACKLOG_METRICS,stageSkinBacklog,stageSkinBacklogBadge,stageSkinBacklogOutline,stageSkinChamfer,stageSkinInset,stageSkinBacklogPlate,stageSkinBacklogPlateStyle,stageSkinBacklogClose}=backlog;
// One stage-local adapter; surface tokens and text roles share the skin paint. Skins are validated once, where they enter
// (install / import / a performance's theme at its install, AGENTS rule 8): every composition drawn here (a level's look, a
// mode, borrowed controls) is applied as composed, never re-validated, and a missing optional part only leaves that part out.
// The generic part shapes (skin-interface.md「通用部件能力」): a playable slot's image file, a slice's edges.
const stageSkinImage = value => stageSkinContract.stageSkinImageOf(value);
const stageSkinSlice = value => stageSkinContract.stageSkinSliceEdges(value);
// Fonts: the skin's `font` declaration through tavernFonts.resolve (user override first; `lead` = a director-applied
// performance skin, whose stage fonts beat the override while it is active, performance effects §11.6).
function stageSkinFont(document, fonts, theme, part, lead = false) {
    return fonts.resolve('stage',{theme,skin:part === 'title' ? {...document.font,title:document.ui?.titleFont} : document.font || {},part,skinWins:lead || part === 'title'}).family;
}
function stageSkinTokens(document, fonts, theme = 'classic', lead = false) {
    const p=document.textbox.paint, shape=document.textbox.shape || {}, n=document.nameplate;
    const frame=document.textbox.frame || {}, cornerGap = frame.corners && frame.corners.kind !== 'none' ? 36 : 0;
    const tokens = {'--gal-skin-pad-top':Math.max(cornerGap,frame.top ? (frame.top.offset ?? 9)+(frame.top.height || 14)+6 : 0)+'px',
        '--gal-skin-pad-bottom':Math.max(cornerGap,frame.bottom ? (frame.bottom.offset ?? 9)+(frame.bottom.height || 14)+6 : 0)+'px',
        '--gal-skin-bg':p.bg,'--gal-skin-fg':p.fg,'--gal-skin-muted':p.fgMuted || p.fg,'--gal-skin-accent':document.textStyle?.emphasis || p.accent || p.fg,
        '--gal-skin-border':p.border || p.fg,'--gal-skin-radius':(shape.radius ?? 8)+'px','--gal-skin-border-width':(shape.borderWidth ?? 1)+'px',
        '--gal-skin-name-bg':n.paint.bg,'--gal-skin-name-fg':n.paint.fg,'--gal-skin-name-rotate':(n.rotate || 0)+'deg',
        '--gal-skin-name-radius':n.shape === 'pill' ? '99px' : '2px',
        '--gal-skin-weight':String(document.textStyle?.weight || 400),'--gal-skin-spacing':(document.textStyle?.letterSpacing ?? 0.03)+'em',
        '--gal-skin-line-height':String(document.textStyle?.lineHeight || 1.7),
        '--gal-skin-flash':document.textFx.flash || document.textStyle?.emphasis || p.fg,
        ...(document.textStyle?.narration ? {'--gal-skin-narration':document.textStyle.narration} : {}),
        '--gal-skin-stamp-y':document.textFx.from === 'bottom' ? '16px' : '-16px',
        ...stageSkinGlyphPoses(document.textFx),...stageSkinQuickMenu(document),
        ...(document.textbox.motion ? {'--box-motion-ms':document.textbox.motion.page.ms + 'ms'} : {}),...(n.motion ? {'--name-motion-ms':n.motion.ms + 'ms'} : {}),
        ...stageSkinTransitionTokens(document),...stageSkinConfigSurface(document).tokens};
    // the ADV plates draw their outline or rule in this colour; the ransom plate paints
    // its third glyph block in it (P5: the red block under white ink).
    if (STAGE_SKIN_ADV_PLATES.includes(n.shape)) tokens['--gal-skin-name-border']=n.paint.border || n.paint.fg;
    let spread=0;
    tokens['--gal-skin-rings'] = (shape.rings || []).map(r => `0 0 0 ${spread+=r.width}px ${r.color}`).join(',') || 'none';
    for (const [role,part] of [['body',undefined],['name','name'],['ui','ui']]) tokens['--gal-skin-font-'+role]=stageSkinFont(document,fonts,theme,part,lead);
    // one skin owns every stage panel; chat and host surfaces stay untouched.
    Object.assign(tokens,stageSkinPanelTokens(document,fonts,theme,false,lead));
    for (const [name,value] of Object.entries({bg:p.bg,bgSolid:p.bg,scrim:p.bg,fg:p.fg,fgMuted:p.fgMuted || p.fg,icon:p.fg,border:p.border || p.fg,accent:tokens['--gal-skin-accent'],
        hover:tokens['--gal-skin-qm-hover'],selected:tokens['--gal-skin-qm-active']})) tokens['--fk-s-stage-textbox-'+name]=value;
    // User font size remains authoritative: authored size is not applied here.
    return tokens;
}
// the quick menu sits directly on the opaque textbox plate - no menu plate. Icons use
// the skin's own ink: the authored quickMenu.fg (else fgMuted/fg) at rest, the accent on hover/toggle, over solid
// accent-tinted chips. Every pair keeps >= 3:1 (WCAG non-text) against the plate or chip it sits on.
function stageSkinQuickMenu(document) {
    const contrast=stageSkinContract.skinContrast, p=document.textbox.paint, bg=p.bg;
    const mix=(a,b,t) => '#'+[1,3,5].map(i => Math.round(parseInt(a.slice(i,i+2),16)*t+parseInt(b.slice(i,i+2),16)*(1-t)).toString(16).padStart(2,'0')).join('');
    const ok=(ink,paint) => contrast(ink,paint)+1e-6 >= 3;
    const idle=[document.quickMenu?.fg,p.fgMuted,p.fg].find(ink => ink && ok(ink,bg)) || p.fg;
    const on=[document.textStyle?.emphasis,p.accent,p.fg].find(ink => ink && ok(ink,bg)) || p.fg;
    const chip=(t,ink) => {for (let k=t;k>0;k-=.02) {const paint=mix(on,bg,k);if (ok(ink,paint)) return paint;} return bg;};
    const hover=chip(.16,on), active=chip(.24,on);
    const tokens={'--gal-skin-qm-idle':idle,'--gal-skin-qm-on':on,'--gal-skin-qm-hover':hover,'--gal-skin-qm-active':active};
    // the folded menu's one control (capsule / orb) paints quickMenu.bg / fg (>= 4.5:1).
    const q=document.quickMenu;
    if (q?.layout === 'capsule' || q?.layout === 'orb') Object.assign(tokens,{'--gal-skin-qm-bg':q.bg,'--gal-skin-qm-fg':q.fg,'--gal-skin-qm-rim':mix(q.fg,q.bg,.28)});
    return tokens;
}
function stageSkinPanelTokens(document,fonts,theme,builtin=false,lead=false) {
    const p={...document.textbox.paint,...document.ui}, ink=p.fg;
    const contrast=stageSkinContract.skinContrast;
    const accent=[p.accent,document.textStyle?.emphasis,ink].find(value=>value && contrast(value,p.bg)>=4.5);
    const onAccent=p.onAccent && contrast(p.onAccent,accent)>=4.5 ? p.onAccent : contrast('#ffffff',accent)>=4.5 ? '#ffffff' : '#000000';
    const surface=p.bg, muted=p.fgMuted || ink, border=p.border || muted;
    // opaque accent-tinted states, bounded by both body and selected-accent text contrast.
    const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*t+parseInt(b.slice(i,i+2),16)*(1-t)).toString(16).padStart(2,'0')).join('');
    const tint=share=>{for(let t=share;t>0;t-=.01){const paint=mix(accent,surface,t);if([ink,accent].every(fg=>contrast(fg,paint)+1e-6>=4.5))return paint;}return surface;};
    const dark=contrast(surface,'#000000')<8, raised=tint(.06),hover=tint(dark?.10:.12),selected=tint(dark?.18:.16);
    const veil=document.ui?.veil;
    const veilColor=veil?.color || (dark?'#040818':'#0f1c46'),opacity=veil?.opacity ?? (dark?.68:.45);
    const dim='rgb('+[1,3,5].map(i=>parseInt(veilColor.slice(i,i+2),16)).join(' ')+' / '+opacity+')';
    return {'--gal-base-bg':surface,'--gal-base-ink':ink,'--gal-base-accent':accent,
        '--gal-ui-surface':surface,'--gal-ui-surface-2':raised,'--gal-ui-dim':dim,
        '--gal-ui-ink':ink,'--gal-ui-ink-2':muted,'--gal-ui-muted':muted,'--gal-ui-ink-disabled':mix(ink,surface,.42),'--gal-ui-accent':accent,
        '--gal-ui-accent-ink':onAccent,'--gal-ui-line':border,
        '--gal-ui-hover':hover,'--gal-ui-active':selected,
        // built-ins own their texture, typography and decoration in theme CSS.
        ...(!builtin ? {'--gal-ui-veil':raised,'--gal-ui-text-shadow':'none','--gal-ui-title-shadow':'none',
            '--gal-ui-shadow':dark?'0 10px 30px rgb(0 0 0 / .42)':'0 10px 28px rgb(15 28 70 / .16)',
            '--gal-ui-radius':(document.ui?.radius ?? document.textbox.shape?.radius ?? 10)+'px',
            '--gal-ui-font':stageSkinFont(document,fonts,theme,'ui',lead),
            // A title face is decoration, like the built-ins' CSS title fonts: it keeps winning over the override.
            '--gal-ui-title-font':stageSkinFont(document,fonts,theme,'title'),
            // opaque stage panels (the Esc menu's .fk-surface) paint the skin's own surface,
            // not the theme's stage-panel table, so a light skin never gets a dark menu.
            '--fk-s-stage-panel-bg':raised,'--fk-s-stage-panel-bgSolid':raised,'--fk-s-stage-panel-scrim':raised,'--fk-s-stage-panel-fg':ink,'--fk-s-stage-panel-fgMuted':muted,
            '--fk-s-stage-panel-fgDisabled':mix(ink,raised,.42),'--fk-s-stage-panel-icon':ink,'--fk-s-stage-panel-accent':accent,'--fk-s-stage-panel-onAccent':onAccent,
            '--fk-s-stage-panel-hover':hover,'--fk-s-stage-panel-selected':selected,'--fk-s-stage-panel-line':border,
            '--fk-s-stage-panel-border':'color-mix(in srgb, '+accent+' 24%, transparent)'} : {}),
        '--gal-ui-hud-plate':surface,'--gal-ui-hud-ink-idle':muted,'--gal-ui-hud-ink-on':ink,'--gal-ui-hud-active':accent,
        '--gal-ui-hud-hover':hover,'--gal-ui-hud-selected':selected,'--gal-ui-hud-line':border,
        // hud.plate (§18 N13): the top bar chips' own opaque ground and ink
        ...(document.hud?.plate ? {'--fk-hud-plate-bg':document.hud.plate.bg,'--fk-hud-plate-fg':document.hud.plate.fg} : {})};
}
// the closed ADV words become root attributes for the stage CSS; a skin that
// declares none of them gets none (its DOM and tokens are unchanged).
const STAGE_SKIN_ADV_PLATES = ['ribbon','underline','ransom','fade','emblem','chamfer','outline'];
function stageSkinMarks(document) {
    const marks={}, layout=document.textbox.layout, shape=document.nameplate.shape;
    if (layout && layout !== 'box') marks['data-fk-skin-layout']=layout;
    if (STAGE_SKIN_ADV_PLATES.includes(shape)) marks['data-fk-skin-plate']=shape;
    if (document.nameplate.tint) marks['data-fk-skin-tint']=document.nameplate.tint;
    if (document.nameplate.enter) marks['data-fk-skin-name-enter']=document.nameplate.enter;
    // textStyle.narration (§18 N9): narration's own ink in the box and the backlog
    if (document.textStyle?.narration) marks['data-fk-skin-narration-ink']='';
    if (document.textbox.frame?.texture) marks['data-fk-skin-texture']=document.textbox.frame.texture;
    if (document.ui?.texture) marks['data-fk-skin-ui-texture']=document.ui.texture;
    const menu=document.quickMenu?.layout;
    if (menu && menu !== 'bar') marks['data-fk-skin-menu']=menu;
    if ((!menu || menu === 'bar') && document.quickMenu?.place) marks['data-fk-skin-controls-place']=document.quickMenu.place;
    // narrow (§13): the placed row's own strip on a phone at the box's top edge instead of under the lines
    // (edge: centred on the box's top edge, on the box image's top line)
    if ((!menu || menu === 'bar') && document.quickMenu?.place && ['top','edge'].includes(document.quickMenu.narrow)) marks['data-fk-skin-controls-narrow']=document.quickMenu.narrow;
    if ((!menu || menu === 'bar') && document.quickMenu?.icons) marks['data-fk-skin-controls-icons']='';
    // textbox.motion / nameplate.motion (§18 E4): the box frame and the plate play the skin's motion (stageSkinMotionTokens).
    if (document.textbox.motion) marks['data-fk-skin-box-motion']='';
    if (document.nameplate.motion) marks['data-fk-skin-name-motion']='';
    if (document.hud?.plate) marks['data-fk-skin-hud-plate']='';
    // textStyle.wrap: phrase = the reading text breaks between phrases (theme.css「stage typewriter」).
    if (document.textStyle?.wrap) marks['data-fk-skin-wrap']=document.textStyle.wrap;
    // transitions (skin-interface.md §9.1): the surfaces with a declared enter / leave (theme.css «stage skin: transitions»).
    // (only the phases that move the surface itself or slide it: shapes-only phases are the sweep's alone; data-fk-tx-slide: the
    // phases whose panels slide - the choice rows' own slide, the menu's dim fading under its sliding panels)
    const tx=stageSkinTransitionList(document).filter(([surface,phase,t]) => t.slide || stageSkinTransitionKeyframes(surface,phase,t));
    if (tx.length) marks['data-fk-tx']=tx.map(([surface,phase]) => surface + '-' + phase).join(' ');
    const slides=tx.filter(([,,t]) => t.slide);
    if (slides.length) marks['data-fk-tx-slide']=slides.map(([surface,phase]) => surface + '-' + phase).join(' ');
    return Object.assign(marks,stageSkinConfigSurface(document).marks);
}
// the CONFIG surface's closed words as data-fk-cs-* marks on the stage root and
// its numbers / panel colours as --cs-* tokens (theme.css «stage skin: config surface»). Only words that differ from the
// engine look of today (the first of each closed list) are marked: a skin without `config` gets no mark and no token.
const STAGE_CONFIG_DEFAULT_LOOKS = Object.freeze({frame:'sheet',title:'word',nav:'tabs',section:'caption',row:'plain',
    segmented:'groove',toggle:'switch',slider:'track',select:'field',text:'inline',colour:'swatch',picker:'row',other:'row'});
// The panel colours a frame.paint replaces inside the CONFIG screen (the --gal-ui-* the screen and its popovers read).
const STAGE_CONFIG_PAINT_TOKENS = Object.freeze(['surface','surface-2','ink','ink-2','muted','ink-disabled','accent','accent-ink','line','hover','active','dim']);
function stageSkinConfigSurface(document) {
    const c=document?.config, marks={}, tokens={};
    if (!c) return {marks,tokens};
    marks['data-fk-cs']='';
    const mark=(name,value,fallback) => { if (value !== undefined && value !== fallback) marks['data-fk-cs-' + name]=String(value); };
    for (const part of ['frame','title','nav','section','row']) mark(part,c[part]?.look,STAGE_CONFIG_DEFAULT_LOOKS[part]);
    for (const [type,control] of Object.entries(c.controls || {})) mark('control-' + type,control.look,STAGE_CONFIG_DEFAULT_LOOKS[type]);
    mark('side',c.frame?.side); mark('texture',c.frame?.texture); mark('nav-place',c.nav?.place,'start'); mark('numerals',c.nav?.numerals,'none');
    // nav.paint (§18 N9): the tab list's own ground and inks; the open tab keeps the page's ink (onBg, else the panel's fg).
    if (c.nav?.paint) {
        const p=c.nav.paint;
        marks['data-fk-cs-nav-paint']='';
        Object.assign(tokens,{'--cs-nav-bg':p.bg,'--cs-nav-fg':p.fg,'--cs-nav-muted':p.fgMuted || p.fg,'--cs-nav-accent':p.accent || p.fg,'--cs-nav-on':p.onBg || c.frame?.paint?.fg || document.ui?.fg || document.textbox.paint.fg});
    }
    if (c.section?.sticky) marks['data-fk-cs-sticky']='';
    mark('label',c.row?.label,'start'); mark('density',c.row?.density,'regular'); mark('columns',c.row?.columns,1);
    mark('fade',c.scroll?.fade,'none'); mark('motion',c.motion?.rows,'none');
    if (c.title?.word) {marks['data-fk-cs-word']=''; tokens['--cs-word']=JSON.stringify(c.title.word);}
    if (c.frame?.width) tokens['--cs-width']=Math.round(c.frame.width * 1000) / 10 + '%';
    if (c.frame?.corner !== undefined) tokens['--cs-corner']=c.frame.corner + 'px';
    if (c.motion?.stagger !== undefined) tokens['--cs-stagger']=c.motion.stagger + 'ms';
    const veil=c.frame?.backdrop?.veil;
    if (veil) {marks['data-fk-cs-veil']=''; tokens['--cs-veil-color']=veil.color; tokens['--cs-veil-alpha']=Math.round(veil.opacity * 100) + '%';}
    // frame.paint: the engine derives the panel's shades from the seeds exactly as for ui (stageSkinPanelTokens), here as --cs-ui-*.
    if (c.frame?.paint) {
        marks['data-fk-cs-paint']='';
        const fonts={resolve:() => ({family:''})}, derived=stageSkinPanelTokens({...document,ui:{...document.ui,...c.frame.paint,veil:undefined}},fonts,'classic',true);
        for (const key of STAGE_CONFIG_PAINT_TOKENS) tokens['--cs-ui-' + key]=derived['--gal-ui-' + key];
    }
    return {marks,tokens};
}
// The CONFIG surface's images from the skin's bundle: each part's url, its nine-slice and the sliced edges' CSS width; one
// data-fk-cs-art mark lists the parts drawn. A missing image leaves only that part out (its look stays).
const STAGE_CONFIG_ART_PARTS = Object.freeze([['frame',c => c.frame?.plate],['backdrop',c => c.frame?.backdrop?.image && {image:c.frame.backdrop.image}],['title',c => c.title?.plate],
    ['nav',c => c.nav?.plate],['section',c => c.section?.plate],['row',c => c.row?.plate],
    ...['segmented','toggle','select','text','colour','picker','other'].map(type => [type,c => c.controls?.[type]?.plate]),
    ['track',c => c.controls?.slider?.track],['fill',c => c.controls?.slider?.fill],['thumb',c => c.controls?.slider?.thumb]]);
function stageSkinConfigArt(document, files, entry = '') {
    const c=document?.config;
    if (!c || !files) return null;
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '', file=name => files[dir + name];
    const url=name => 'url("' + file(name).url + '")';
    const marks={}, tokens={}, parts=[];
    for (const [part,of] of STAGE_CONFIG_ART_PARTS) {
        const plate=of(c);
        if (!plate) continue;
        const states=[['',plate.image || plate.plain],['-on',plate.on],['-focus',plate.focus]].filter(([,name]) => name);
        if (states.some(([,name]) => !file(name)?.url)) continue;
        parts.push(part);
        const p='--cs-art-' + part;
        for (const [suffix,name] of states) tokens[p + suffix]=url(name);
        const edges=stageSkinSlice(plate.slice) || [0,0,0,0], scale=plate.scale || 1;
        tokens[p + '-slice']=edges.join(' ') + ' fill';
        tokens[p + '-edge']=edges.map(n => Math.round(n * scale * 100) / 100 + 'px').join(' ');
        // A placed image (the slider thumb) keeps its natural size times scale.
        const image=file(plate.image || plate.plain).image;
        if (image) {tokens[p + '-w']=Math.round((image.naturalWidth || image.width) * scale * 100) / 100 + 'px'; tokens[p + '-h']=Math.round((image.naturalHeight || image.height) * scale * 100) / 100 + 'px';}
    }
    if (!parts.length) return null;
    marks['data-fk-cs-art']=parts.join(' ');
    return {marks,tokens};
}
function stageSkinControlIcons(document, files, entry = '') {
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '';
    const icons={};
    for (const [action,icon] of Object.entries(document?.quickMenu?.icons || {})) {
        const image=files?.[dir + icon.image], on=files?.[dir + icon.on];
        if (image?.url && image.image) icons[action]={image:image.url,on:on?.image ? on.url : null};
    }
    // quickMenu.button (buttonArt): the body every icon is drawn on, per state, with the glyph box and the body's aspect
    // (gal-stage.js controlIcon); a body whose normal image is not in the bundle leaves the icons as they are.
    const button=document?.quickMenu?.button, body=button && files?.[dir + button.normal];
    if (body?.url && body.image) {
        const state=(set,key) => set[key] && files[dir + set[key]]?.image ? files[dir + set[key]].url : null;
        const aspect=image => Math.round((image.naturalWidth || image.width) / (image.naturalHeight || image.height) * 10000) / 10000;
        const shared={normal:body.url,hover:state(button,'hover'),on:state(button,'on'),disabled:state(button,'disabled'),glyph:button.glyph,aspect:aspect(body.image)};
        // narrow (§18 N14): the phone's own bodies, drawn 44 px tall at their aspect (theme.css «box controls»)
        const small=button.narrow && files[dir + button.narrow.normal];
        if (small?.url && small.image) shared.narrow={normal:small.url,hover:state(button.narrow,'hover'),on:state(button.narrow,'on'),disabled:state(button.narrow,'disabled'),glyph:button.narrow.glyph,aspect:aspect(small.image)};
        for (const icon of Object.values(icons)) icon.button=shared;
    }
    return icons;
}
// the skin's art from its prepared bundle
// (`files`: bundle path -> {url, image}, `entry`: the skin document's bundle path). Returns the root marks and tokens for
// theme.css 「stage skin: art」 and the on-stage buttons with their natural sizes, or null when there is no art or a
// declared image is not in the bundle (the layout's drawn look stays). Sizes are art px of the design screen.
// the skin's own faces from its prepared bundle, [{id, blob, weight,
// fallback}] for tavernFonts.provide; a face whose file is not in the bundle is left out (its role falls back).
// the skin's sound palette as playable cues - cue -> {url, gain, every, pitch} for the
// bundle files that resolved (forkUiSfx.useSkin plays them in place of the engine's own; a missing file keeps the engine cue).
function stageSkinSfx(document, files, entry = '') {
    if (!document?.sfx || !files) return null;
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '', cues={};
    for (const [cue,spec] of Object.entries(document.sfx)) {
        const item=typeof spec === 'string' ? {file:spec} : spec, url=files[dir + item.file]?.url;
        if (url) cues[cue]={url,gain:item.gain ?? 1,every:item.every || 1,pitch:item.pitch || 0};
    }
    return Object.keys(cues).length ? cues : null;
}
function stageSkinFontFaces(document, files, entry = '') {
    const faces=document?.font?.faces;
    if (!faces || !files) return [];
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '';
    return Object.entries(faces).map(([id,face]) => ({id,blob:files[dir + face.file]?.blob,...(files[dir + face.file]?.load ? {load:files[dir + face.file].load} : {}),weight:face.weight,fallback:face.fallback || null})).filter(face => face.blob || face.load);
}
function stageSkinArt(document, files, entry = '') {
    const art=document?.art;
    if (!art || !files) return null;
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '', file=name => files[dir + name];
    const url=name => 'url("' + file(name).url + '")';
    const names=[...Object.values(art.textbox?.images || {}),...Object.values(art.textbox?.tint?.masks || {}),...Object.values(art.choices?.images || {}),...[art.choices?.tint,art.choices?.tool?.image,art.choices?.tool?.tint,art.choices?.tool?.send,art.choices?.focus?.image,art.choices?.focus?.alt,...(art.choices?.tool?.button ? [art.choices.tool.button.normal,art.choices.tool.button.hover,art.choices.tool.button.disabled] : [])].filter(Boolean),...(art.textbox?.lamp ? [art.textbox.lamp.image] : []),...[stageSkinImage(art.textbox?.next),art.nameplate?.image].filter(Boolean),...Object.values(art.buttons || {}).flatMap(button => [button.image,button.on,button.tint,button.narrow?.image,button.narrow?.on].filter(Boolean)),
        ...(art.nameplate?.band ? [art.nameplate.band.image] : []),...Object.values(art.cast || {}).flatMap(entry => [entry.box,entry.plate,entry.band?.image].filter(Boolean)),...(art.decor || []).map(item => item.image),
        ...stageSkinContract.stageSkinScreenFiles(art),...(art.portrait?.frame ? [art.portrait.frame.image,art.portrait.frame.glass,art.portrait.frame.back,art.portrait.frame.speaking,art.portrait.frame.tint].filter(Boolean) : []),...(art.portrait?.placeholder?.image ? [art.portrait.placeholder.image] : []),...(art.item ? [art.item.frame,art.item.gain?.toast?.image].filter(Boolean) : []),
        ...Object.values(document.modes || {}).flatMap(mode => Object.values(mode.buttons || {}).flatMap(button => [button.image,button.on,button.tint].filter(Boolean)))];
    if (!names.length && !art.portrait && !art.narration && !art.shape && art.voice?.box !== false || names.some(name => !file(name)?.url || !file(name).image)) return null;
    // An element's `scale` (design px per image px, or [x, y]; the original's sprite scale) sizes its images; 1 = natural size.
    const size=(name,scale = 1) => [file(name).image.naturalWidth || file(name).image.width,file(name).image.naturalHeight || file(name).image.height].map((n,i) => Math.round(n * [].concat(scale)[Math.min(i,[].concat(scale).length - 1)] * 1000) / 1000);
    // --art-screen-w: the width that bounds the art px. A declared design width fits the game area's aspect into the stage;
    // without it a box narrows to fit (the image over 96% of the stage width) and buttons alone follow the stage height.
    const marks={}, box=art.textbox, wide=art.screenWidth || (box ? size(box.images.plain,box.scale)[0] / (box.fit || .96) : 1e6);
    const tokens={'--art-screen':String(art.screen),'--art-screen-w':String(Math.round(wide * 1000) / 1000)};
    if (box) {
        const [w,h]=size(box.images.plain,box.scale), [x,y,bw,bh]=box.body, [left,right,middle]=box.text, cue=Array.isArray(box.cue) ? box.cue : [0,0,0];
        marks['data-fk-skin-art']='box';
        Object.assign(tokens,{'--art-img-w':String(w),'--art-img-h':String(h),'--art-body-x':String(x),'--art-body-y':String(y),'--art-body-w':String(bw),'--art-body-h':String(bh),
            '--art-bottom':String(box.bottom),'--art-text-l':String(left),'--art-text-r':String(right),'--art-text-y':String(middle),'--art-font':String(box.font),
            '--art-lines':String(box.lines),'--art-cue-x':String(cue[0]),'--art-cue-y':String(cue[1]),'--art-cue-h':String(cue[2]),'--art-rise':String(box.rise || 0)});
        for (const side of ['plain','left','center','right']) if (box.images[side]) tokens['--art-' + side]=url(box.images[side]);
        // narration: the narration page's own box image
        if (box.images.narration) {marks['data-fk-skin-art-narration-box']=''; tokens['--art-narration']=url(box.images.narration);}
        // no page cue when the original has none, the cue from the skin's own image
        // (bobbing as the original: rise, or dip), and the box image stretched across the stage (a bottom-stretch scrim).
        if (!box.cue) marks['data-fk-skin-art-cue']='none';
        else if (box.next) {
            const image=stageSkinImage(box.next), frames=box.next.frames && stageSkinFrames(box.next.frames,size(image,box.scale)), [nw,nh]=frames ? frames.cell : size(image,box.scale);
            marks['data-fk-skin-art-cue']=box.cue === 'inline' ? 'inline-image' : 'image';
            Object.assign(tokens,{'--art-next':url(image),'--art-next-w':String(nw),'--art-next-h':String(nh)});
            // frames (§18 E11): the cue is one cell of the sheet, played by stageSkinMotionKeyframes' fork-skin-frames-next
            if (frames) {marks['data-fk-skin-art-cue-frames']=''; Object.assign(tokens,{'--art-next-sheet':frames.size,'--art-next-t':frames.ms,'--art-next-loop':frames.loop,'--art-next-rest':frames.rest});}
        }
        else if (box.cue === 'inline') marks['data-fk-skin-art-cue']='inline';
        // controls (§18 E2): the quick menu row on the box image; slice (§13): the phone box 9-sliced from the same image.
        if (box.controls) {marks['data-fk-skin-art-controls']=''; Object.assign(tokens,{'--art-qc-x':String(box.controls.x),'--art-qc-y':String(box.controls.y),'--art-qc-size':String(box.controls.size),'--art-qc-w':String(box.controls.w || box.controls.size),'--art-qc-gap':String(box.controls.gap || 0)}); if (box.controls.rows > 1) {marks['data-fk-skin-art-controls']='grid'; tokens['--art-qc-rows']=String(box.controls.rows);}}
        // readout (N2): the live clock printed on the box image (StageSkinReadout, stage-skin-decoration.js)
        // narrow: its own phone place, CSS px in from the box's edge on its align side and down from its top edge.
        if (box.readout) {const r=box.readout; marks['data-fk-skin-art-readout']=r.align || 'end'; Object.assign(tokens,{'--art-ro-x':String(r.x),'--art-ro-y':String(r.y),'--art-ro-font':String(r.font)}); if (r.ink) tokens['--art-ro-ink']=r.ink;
            if (r.narrow) {marks['data-fk-skin-art-readout-narrow']=r.narrow.align || r.align || 'end'; Object.assign(tokens,{'--art-ro-nx':r.narrow.x + 'px','--art-ro-ny':r.narrow.y + 'px'});}}
        {
            // the phone 9-slice (theme.css «art on phones»): slice in the image's own px, widths in design px
            const [sx,sy]=[].concat(box.scale ?? 1).concat(box.scale ?? 1), round=n => String(Math.max(0,Math.round(n * 100) / 100));
            // default: everything outside the text block stays as drawn (the block centred on text[2], lines x the pitch)
            const block=box.lines * (box.pitch || box.font * 1.6), top=box.align === 'top' ? middle : middle - block / 2;
            // (never inside the body's own top / bottom edge: those stay as drawn too)
            const edges=stageSkinSlice(box.slice) || [Math.max(y,top) / sy,Math.max(0,w - right) / sx,Math.max(h - y - bh,h - top - block) / sy,Math.max(0,left) / sx];
            Object.assign(tokens,{'--art-sl':edges.map(round).join(' '),'--art-sl-t':round(edges[0] * sy),'--art-sl-r':round(edges[1] * sx),'--art-sl-b':round(edges[2] * sy),'--art-sl-l':round(edges[3] * sx)});
        }
        if (box.bob) marks['data-fk-skin-art-bob']=box.bob;
        // 「代表色」: the masked trim of each box image takes the speaker's own colour (theme.css
        // 「stage skin: art」, a luminosity blend); the cue's colours follow through stageSkinTint.
        if (box.tint) {
            marks['data-fk-skin-art-tint']=box.tint.by;
            // menu: the stage menu's accent follows too (stageSkinTintReadable, set by the stage).
            if (box.tint.menu) marks['data-fk-skin-art-tint-menu']='';
            for (const side of ['plain','left','center','right']) if (box.tint.masks[side]) tokens['--art-tint-' + side]=url(box.tint.masks[side]);
        }
        if (box.span) marks['data-fk-skin-art-span']=box.span;
        if (box.fit) tokens['--art-fit']=String(box.fit);
        // height fit lines (§2.3): the pager reads the line range (useGalSubtitles) and sets the page's block on the box.
        if (box.height) {marks['data-fk-skin-art-fit']='lines'; Object.assign(tokens,{'--art-fit-min':String(box.height.min),'--art-fit-max':String(box.height.max),'--art-fit-ms':(box.height.ms ?? 220) + 'ms'});}
        if (box.stroke) {marks['data-fk-skin-art-stroke']=''; Object.assign(tokens,{'--art-text-stroke':box.stroke.color,'--art-text-stroke-w':String(box.stroke.width)});}
        // the box text's soft halo (the original's TMP underlay).
        if (box.halo) {marks['data-fk-skin-art-halo']=''; tokens['--art-text-halo']=stageSkinHalo(box.halo);}
        // the line pitch, a top-aligned text block and the AUTO lamp.
        if (box.pitch) {marks['data-fk-skin-art-pitch']=''; tokens['--art-pitch']=String(box.pitch);}
        if (box.align) marks['data-fk-skin-art-align']=box.align;
        if (box.lamp) {
            const frames=box.lamp.frames && stageSkinFrames(box.lamp.frames,size(box.lamp.image,box.lamp.scale)), [lw,lh]=frames ? frames.cell : size(box.lamp.image,box.lamp.scale);
            marks['data-fk-skin-art-lamp']='';
            Object.assign(tokens,{'--art-lamp':url(box.lamp.image),'--art-lamp-x':String(box.lamp.x),'--art-lamp-y':String(box.lamp.y),'--art-lamp-w':String(lw),'--art-lamp-h':String(lh)});
            // frames: the lamp is one cell of its sheet, played by fork-skin-frames-lamp while it shows
            if (frames) {marks['data-fk-skin-art-lamp']='frames'; Object.assign(tokens,{'--art-lamp-sheet':frames.size,'--art-lamp-t':frames.ms,'--art-lamp-loop':frames.loop,'--art-lamp-rest':frames.rest});}
            // an ▶AUTO lamp blinks, an auto ring turns (period s); swap: it stands in for the page cue while auto runs.
            if (box.lamp.motion) {marks['data-fk-skin-art-lamp']=box.lamp.motion; tokens['--art-lamp-t']=String(box.lamp.period || 1) + 's';}
            if (box.lamp.swap) marks['data-fk-skin-art-lamp-swap']='';
        }
        const plate=art.nameplate;
        if (plate) {
            marks['data-fk-skin-art-name']='';
            if (plate.vertical) marks['data-fk-skin-art-name-vertical']='';
            Object.assign(tokens,{'--art-np-x':String(plate.x),'--art-np-y':String(plate.y),'--art-np-w':String(plate.w || 0),'--art-np-h':String(plate.h),'--art-np-font':String(plate.font),'--art-np-stroke':String(plate.stroke || 0)});
            // A plate from the skin's own image (a ribbon, a rule): its natural size, the name `text` px in.
            if (plate.image) {const [pw,ph]=size(plate.image,plate.scale); marks['data-fk-skin-art-name']='image'; Object.assign(tokens,{'--art-np-img':url(plate.image),'--art-np-w':String(pw),'--art-np-h':String(ph),'--art-np-text':String(plate.text || 0),'--art-np-weight':String(plate.weight || 500)});}
            if (plate.emblem) {marks['data-fk-skin-art-emblem']=''; Object.assign(tokens,{'--art-em-x':String(plate.emblem[0]),'--art-em-y':String(plate.emblem[1]),'--art-em-d':String(plate.emblem[2])});}
            // the plate printed on the box images (the name only, in weight), and the name's x
            // per speaker side (align end: its right edge there).
            if (plate.printed) {marks['data-fk-skin-art-name']='printed'; tokens['--art-np-weight']=String(plate.weight || 500);}
            // w on a printed plate: the printed tab's room for the name (from its x, or back from it when end-aligned); a longer
            // name is set smaller to fit (GalNamePlate --fk-name-fit), and on phones it keeps the image's scale (
            // 「名字文字会超出框架」).
            if (plate.printed && plate.w) marks['data-fk-skin-art-np-room']='';
            if (plate.sides) {
                marks['data-fk-skin-art-name-sides']=Object.keys(plate.sides).join(' ');
                for (const [side,at] of Object.entries(plate.sides)) Object.assign(tokens,{['--art-np-' + side]:String(at.x),['--art-np-' + side + '-end']:at.align === 'end' ? '1' : '0'});
            }
            // the name in a two-band ink under its outline, the outline's drop shadow, its own
            // letter spacing, centred on an image plate, and the band under it that follows its width (drawn at its own aspect,
            // anchored at the name's right edge plus tail, cut at x).
            if (plate.fill) {marks['data-fk-skin-art-fill']=''; Object.assign(tokens,{'--art-np-fill-a':plate.fill[0],'--art-np-fill-b':plate.fill[1]});}
            if (plate.shadow) {marks['data-fk-skin-art-np-shadow']=''; Object.assign(tokens,{'--art-np-sx':String(plate.shadow[0]),'--art-np-sy':String(plate.shadow[1])});}
            if (plate.spacing != null) tokens['--art-np-spacing']=plate.spacing + 'em';
            // narrow: pill: on phones the name leaves the drawn plate for a pill in the speaker's colour
            if (plate.narrow) marks['data-fk-skin-art-name-narrow']=plate.narrow;
            // wide under (§18 N16): on wide stages the plate under the face window on its axis (theme.css «art name wide under»)
            if (plate.wide) marks['data-fk-skin-art-name-wide']=plate.wide;
        if (plate.lead) marks['data-fk-skin-art-name-lead']='';
            // tint: the name in the speaker's colour at the plate ink's luminance (the stage sets --art-np-tint per speaker)
            if (plate.tint) marks['data-fk-skin-art-name-tint']='';
            // rotate: the name turned with its drawn plate (per side: sides.<side>.rotate)
            if (plate.rotate != null || Object.values(plate.sides || {}).some(at => at.rotate != null)) {
                marks['data-fk-skin-art-name-rot']='';
                tokens['--art-np-rot']=(plate.rotate || 0) + 'deg';
                for (const [side,at] of Object.entries(plate.sides || {})) tokens['--art-np-' + side + '-rot']=(at.rotate ?? plate.rotate ?? 0) + 'deg';
            }
            if (plate.image && plate.center != null && !plate.slice) {marks['data-fk-skin-art-np-center']=''; tokens['--art-np-center']=String(plate.center);}
            // slice (skinSlice): the image plate 9-sliced, growing along the name up to grow design px (theme.css «art name
            // slice»): the slice in image px, its widths and the name's pad in design px.
            if (plate.image && plate.slice) {
                const [sx,sy]=[].concat(plate.scale ?? 1).concat(plate.scale ?? 1), e=stageSkinSlice(plate.slice), k=plate.vertical ? sy : sx, round=n => String(Math.round(n * 100) / 100);
                const pad=plate.pad || (plate.vertical ? [e[0],e[2]] : [e[3],e[1]]).map(n => n * k);
                marks['data-fk-skin-art-np-slice']='';
                Object.assign(tokens,{'--art-np-sl':e.map(round).join(' '),'--art-np-sl-t':round(e[0] * sy),'--art-np-sl-r':round(e[1] * sx),'--art-np-sl-b':round(e[2] * sy),'--art-np-sl-l':round(e[3] * sx),
                    '--art-np-grow':round(plate.grow || 0),'--art-np-pad-a':round(pad[0]),'--art-np-pad-b':round(pad[1])});
            }
            if (plate.band) {
                const band=plate.band; marks['data-fk-skin-art-band']='';
                Object.assign(tokens,{'--art-band':url(band.image),'--art-band-x':String(band.x || 0),'--art-band-y':String(band.y),'--art-band-h':String(band.h),'--art-band-tail':String(band.tail || 0)});
                // N3: the band in the speaker's colour; sweep: drawn left to right per speaker (theme.css «art name band»)
                if (band.tint) marks['data-fk-skin-art-band-tint']='';
                if (band.sweep) {marks['data-fk-skin-art-band-sweep']=''; tokens['--art-band-sweep']=band.sweep + 'ms';}
            }
            // the name's halo, and the name set by part (GalNamePlate splits it, galNameParts).
            if (plate.lift) {marks['data-fk-skin-art-name-lift']=''; tokens['--art-np-lift']=String(plate.lift);}
            if (plate.halo) {marks['data-fk-skin-art-name-halo']=''; tokens['--art-np-halo']=stageSkinHalo(plate.halo);}
            if (plate.initials) {
                const i=plate.initials;
                marks['data-fk-skin-art-initials']='';
                Object.assign(tokens,{'--art-np-lead':String(i.lead),'--art-np-rest':String(i.rest),'--art-np-given-lead':String(i.given[0]),'--art-np-given-rest':String(i.given[1]),'--art-np-gap':String(i.gap || 0),'--art-np-drop':String(i.drop || 0)});
            }
        }
    }
    // art.cast: per-figure art - the speaker's own box and plate images and name inks, as tokens the box carries
    // (gal-stage.js sets them on the box of that figure's lines; theme.css reads them before the side images).
    const cast={};
    for (const [figure,entry] of Object.entries(box ? art.cast || {} : {})) {
        const style={};
        if (entry.box) style['--art-cast-box']=url(entry.box);
        if (entry.plate && art.nameplate?.image) style['--art-cast-plate']=url(entry.plate);
        if (entry.band === false && art.nameplate?.band) style['--art-cast-band']='none';
        if (entry.band && art.nameplate?.band) {
            style['--art-cast-band']=url(entry.band.image);
            if (entry.band.tail != null) style['--art-band-tail']=String(entry.band.tail);
        }
        if (entry.name?.fill) Object.assign(style,{'--art-np-fill-a':entry.name.fill[0],'--art-np-fill-b':entry.name.fill[1]});
        if (entry.name?.border) style['--gal-skin-name-border']=entry.name.border;
        cast[figure]={style,fill:Boolean(entry.name?.fill)};
    }
    // The end-of-round menu as image bars (theme.css 「stage skin: art choices」): every row is the bar image (9-slice),
    // stacked on its design centre on wide stages; narrow stages draw the same bars at the menu's text size.
    if (art.choices) {
        const c=art.choices, [w,h]=size(c.images.plain), [st,sr,sb,sl]=stageSkinSlice(c.slice), [left,right,middle]=c.text;
        marks['data-fk-skin-choices']='';
        Object.assign(tokens,{'--art-choice':url(c.images.plain),'--art-choice-off':url(c.images.off || c.images.plain),'--art-choice-w':String(w),'--art-choice-h':String(h),
            '--art-choice-st':String(st),'--art-choice-sr':String(sr),'--art-choice-sb':String(sb),'--art-choice-sl':String(sl),
            '--art-choice-l':String(left),'--art-choice-r':String(right),'--art-choice-y':String(middle),'--art-choice-font':String(c.font),
            '--art-choice-pitch':String(c.pitch),'--art-choice-gap':String(c.gap)});
        // center (design y) or anchor (skin-interface.md「通用部件能力」): stage = the game area's middle; above-box = the middle of
        // the room above the box image's top, the box staying in view (theme.css「art choices」).
        const boxTop=box ? art.screen - box.bottom - size(box.images.plain,box.scale)[1] : art.screen;
        tokens['--art-choice-center']=String(c.anchor === 'above-box' ? Math.round(Math.max(0,boxTop) / 2) : c.anchor === 'stage' ? art.screen / 2 : c.center);
        if (c.anchor === 'above-box') marks['data-fk-skin-choices-anchor']='above-box';
        // Optional design-space placement and alternating row poses; omitted fields preserve the centred stack.
        if (c.band) Object.assign(tokens,{'--art-choice-top':String(c.band[0]),'--art-choice-bottom':String(c.band[1])});
        if (c.x != null) tokens['--art-choice-x']=String(c.x);
        if (c.align) {
            tokens['--art-choice-align']=c.align;
            tokens['--art-choice-justify']=c.align === 'center' ? 'center' : c.align === 'left' ? 'flex-start' : 'flex-end';
        }
        for (const [index, side] of ['odd','even'].entries()) {
            if (c.tilt) tokens['--art-choice-tilt-'+side]=c.tilt[index]+'deg';
            if (c.stagger) tokens['--art-choice-shift-'+side]=String(c.stagger[index]);
        }
        // tool: 重新生成 as an image on the 自由输入 bar's row, its width from the image's aspect.
        // tool.button (buttonArt, skin-interface.md「通用部件能力」): the control drawn as a body per state, the action's own icon
        // (重新生成 / 发送) in its glyph box in the tool's ink - one body for both actions.
        if (c.tool) {
            const body=c.tool.button ? c.tool.button.normal : c.tool.image, [tw,th]=size(body);
            marks['data-fk-skin-choices-tool']=c.tool.button ? 'button' : '';
            Object.assign(tokens,{'--art-choice-tool':url(body),'--art-choice-tool-x':String(c.tool.x),'--art-choice-tool-h':String(c.tool.h),'--art-choice-tool-w':String(Math.round(c.tool.h * tw / th * 1000) / 1000)});
            if (c.tool.tint) tokens['--art-choice-tool-tint']=url(c.tool.tint);
            if (c.tool.button) {
                const b=c.tool.button, [gx,gy,gw,gh]=b.glyph;
                tokens['--art-choice-tool-send']=url(body);
                Object.assign(tokens,{'--art-choice-tool-gx':String(gx),'--art-choice-tool-gy':String(gy),'--art-choice-tool-gw':String(gw),'--art-choice-tool-gh':String(gh)});
                if (b.hover) tokens['--art-choice-tool-hover']=url(b.hover);
                if (b.disabled) {marks['data-fk-skin-choices-tool-disabled']=''; tokens['--art-choice-tool-disabled']=url(b.disabled);}
                if (c.tool.ink) Object.assign(tokens,{'--art-choice-tool-ink':[].concat(c.tool.ink)[0],'--art-choice-tool-ink-hover':[].concat(c.tool.ink).at(-1)});
            } else tokens['--art-choice-tool-send']=url(c.tool.send);
        }
        // tint: the bar's (and the tool's) gold takes the speaker colour, as the box trim.
        if (c.tint || c.tool?.tint) marks['data-fk-skin-choices-tint']='';
        if (c.tint) tokens['--art-choice-tint']=url(c.tint);
        // the words' own ink, weight and spacing on the bar, and the focused bar image and ink.
        if (c.ink) tokens['--art-choice-ink']=c.ink;
        if (c.weight) tokens['--art-choice-weight']=String(c.weight);
        if (c.spacing) tokens['--art-choice-spacing']=c.spacing + 'em';
        if (c.focus) {marks['data-fk-skin-choices-focus']=''; tokens['--art-choice-focus']=url(c.focus.image); if (c.focus.ink) tokens['--art-choice-focus-ink']=c.focus.ink; if (c.focus.dx) tokens['--art-choice-focus-dx']=String(c.focus.dx);}
        // ray: the focused bar's laser line on to the stage's edges
        if (c.focus?.ray) {marks['data-fk-skin-choices-ray']=''; Object.assign(tokens,{'--art-choice-ray':c.focus.ray.color,'--art-choice-ray-alt':c.focus.ray.alt || c.focus.ray.color,'--art-choice-ray-w':String(c.focus.ray.width)});}
        // alt: the even rows' own bar / focus images
        if (c.images.alt || c.focus?.alt) {
            marks['data-fk-skin-choices-alt']='';
            tokens['--art-choice-alt']=url(c.images.alt || c.images.plain);
            if (c.focus) tokens['--art-choice-focus-alt']=url(c.focus.alt || c.focus.image);
        }
        // number: the suggestion rows numbered 01, 02, ... (a CSS counter) centred at x on the bar.
        if (c.number) {
            marks['data-fk-skin-choices-number']=[c.number.free ? 'free' : '',c.number.numerals || ''].filter(Boolean).join(' ');
            if (c.number.free) tokens['--art-choice-num-free']=JSON.stringify(c.number.free);
            if (c.number.prefix) {marks['data-fk-skin-choices-number-prefix']=''; tokens['--art-choice-num-prefix']=JSON.stringify(c.number.prefix);}
            Object.assign(tokens,{'--art-choice-num-x':String(c.number.x),'--art-choice-num-font':String(c.number.font),'--art-choice-num-dy':String(c.number.dy || 0)});
            if (c.number.ink) tokens['--art-choice-num-ink']=c.number.ink;
            if (c.number.focusInk) tokens['--art-choice-num-focus-ink']=c.number.focusInk;
        }
    }
    // art.menu: the stage menu as the original's menu screen on wide stages (theme.css
    // 「stage skin: art menu」): the sheet, the item bars and the title / info / keys strips, in design px.
    if (art.menu) marks['data-fk-skin-art-menu']='';
    if (art.menu?.rows) {
        const m=art.menu, r=m.rows, [rw,rh]=size(r.images.plain), [st,sr,sb,sl]=stageSkinSlice(r.slice), [left,right,middle]=r.text;
        Object.assign(tokens,{'--art-mr':url(r.images.plain),'--art-mr-focus':url(r.images.focus),'--art-mr-off':url(r.images.off || r.images.plain),'--art-mr-w':String(rw),'--art-mr-h':String(rh),
            '--art-mr-st':String(st),'--art-mr-sr':String(sr),'--art-mr-sb':String(sb),'--art-mr-sl':String(sl),'--art-mr-l':String(left),'--art-mr-r':String(right),'--art-mr-y':String(middle),
            '--art-mr-font':String(r.font),'--art-mr-x':String(r.x),'--art-mr-top':String(r.y),'--art-mr-gap':String(r.gap),'--art-mr-weight':String(r.weight || 500)});
        if (r.align) tokens['--art-mr-justify']=r.align === 'center' ? 'center' : r.align === 'end' ? 'flex-end' : 'flex-start';
        if (r.ink) tokens['--art-mr-ink']=r.ink;
        if (r.focusInk) tokens['--art-mr-focus-ink']=r.focusInk;
        if (r.spacing !== undefined) tokens['--art-mr-spacing']=r.spacing + 'em';
        if (r.cursor) {
            const [cw,ch]=size(r.cursor.image);
            marks['data-fk-skin-art-menu-cursor']='';
            Object.assign(tokens,{'--art-mr-cursor':url(r.cursor.image),'--art-mr-cursor-x':String(r.cursor.x),'--art-mr-cursor-y':String(r.cursor.y),'--art-mr-cursor-w':String(cw),'--art-mr-cursor-h':String(ch)});
        }
    }
    // art.menu.tiles / frame (phone menu): the items as a grid of drawn tiles keyed by action id, on a
    // frame image (a device) turned about its centre; marks data-fk-skin-art-menu-tiles / -frame, tokens --art-mt-* / --art-mf-*.
    if (art.menu?.tiles) {
        const t=art.menu.tiles, l=t.label, p='--art-mt';
        marks['data-fk-skin-art-menu-tiles']='';
        Object.assign(tokens,{[p + '-x']:String(t.x),[p + '-y']:String(t.y),[p + '-w']:String(t.w),[p + '-h']:String(t.h),[p + '-px']:String(t.pitch[0]),[p + '-py']:String(t.pitch[1]),
            [p + '-cols']:String(t.cols),[p + '-fit']:String(t.fit || 1e5),[p + '-dx']:String(t.offset?.[0] || 0),[p + '-dy']:String(t.offset?.[1] || 0),
            [p + '-label-y']:String(l.y),[p + '-font']:String(l.font),[p + '-lead']:String(l.lead || 1),[p + '-weight']:String(l.weight || 500),
            [p + '-placed']:String(Object.values(t.art).filter(tile => tile.at).length)});
        if (l.ink) tokens[p + '-ink']=l.ink;
        if (l.focusInk) tokens[p + '-focus-ink']=l.focusInk;
        // align start: the words from label.x in the cell (a list row), not centred
        if (l.align === 'start') {marks['data-fk-skin-art-menu-label']='start'; tokens[p + '-label-x']=String(l.x || 0);}
        if (l.halo) tokens[p + '-halo']=stageSkinHalo(l.halo);
        // number / tilt / lift: numbered program cards, each at its own angle, the focused one lifted
        if (t.number) {
            const n=t.number; marks['data-fk-skin-art-menu-number']='';
            Object.assign(tokens,{[p + '-num-x']:String(n.x),[p + '-num-y']:String(n.y),[p + '-num-font']:String(n.font),[p + '-num-stroke']:n.stroke?.color || 'transparent',[p + '-num-stroke-w']:String(n.stroke?.width || 0)});
            if (n.ink) tokens[p + '-num-ink']=n.ink;
            if (n.focusInk) tokens[p + '-num-focus-ink']=n.focusInk;
        }
        if (t.tilt) {marks['data-fk-skin-art-menu-tilt']=''; for (let i=0; i < 8; i++) tokens[p + '-tilt-' + (i + 1)]=t.tilt[i % t.tilt.length] + 'deg';}
        if (t.lift) {marks['data-fk-skin-art-menu-lift']=''; Object.assign(tokens,{[p + '-lift-scale']:String(t.lift.scale ?? 1),[p + '-lift-dy']:String(t.lift.dy || 0)});}
        if (l.stroke) Object.assign(tokens,{[p + '-stroke']:l.stroke.color,[p + '-stroke-w']:String(l.stroke.width)});
        if (t.plain) {const [w,h]=size(t.plain); Object.assign(tokens,{[p + '-plain']:url(t.plain),[p + '-plain-w']:String(w),[p + '-plain-h']:String(h)});}
        for (const [id,tile] of Object.entries(t.art)) {
            const [w,h]=size(tile.image), q=p + '-' + id;
            Object.assign(tokens,{[q]:url(tile.image),[q + '-focus']:url(tile.focus || tile.image),[q + '-w']:String(w),[q + '-h']:String(h)});
            if (tile.at) {marks['data-fk-skin-art-menu-at']=[marks['data-fk-skin-art-menu-at'],id].filter(Boolean).join(' '); Object.assign(tokens,{[q + '-at-x']:String(tile.at[0]),[q + '-at-y']:String(tile.at[1])});}
            if (tile.label) tokens[q + '-label-y']=String(tile.label.y);
            if (tile.bare) marks['data-fk-skin-art-menu-bare']=[marks['data-fk-skin-art-menu-bare'],id].filter(Boolean).join(' ');
        }
        marks['data-fk-skin-art-menu-art']=Object.keys(t.art).join(' ');
        if (t.hover) {marks['data-fk-skin-art-menu-hover']=''; stageSkinHighlightTokens(tokens,p + '-hover',t.hover,url);}
    }
    if (art.menu?.frame) {
        const f=art.menu.frame, [w,h]=size(f.image,f.scale);
        marks['data-fk-skin-art-menu-frame']='';
        Object.assign(tokens,{'--art-mf':url(f.image),'--art-mf-x':String(f.x),'--art-mf-y':String(f.y),'--art-mf-w':String(w),'--art-mf-h':String(h),'--art-mf-rotate':(f.rotate || 0) + 'deg'});
    }
    if (art.menu) {
        const m=art.menu;
        if (m.sheet) {marks['data-fk-skin-art-menu-sheet']=''; tokens['--art-menu-sheet']=url(m.sheet);}
        // dim / blur / grey: the stage behind the menu darkened, blurred (design px) and greyed
        if (m.dim !== undefined || m.blur || m.grey) {marks['data-fk-skin-art-menu-dim']=''; Object.assign(tokens,{'--art-menu-dim':String(m.dim ?? 0),'--art-menu-blur':String(m.blur || 0),'--art-menu-grey':String(m.grey || 0)});}
        if (m.decor === 'hide') marks['data-fk-skin-art-menu-decor']='hide';
        // signal: the lamp on the frame, its alert image while one of its actions has the focus
        if (m.signal) {
            const [w,h]=size(m.signal.image);
            marks['data-fk-skin-art-menu-signal']=m.signal.on.join(' ');
            Object.assign(tokens,{'--art-msig':url(m.signal.image),'--art-msig-alert':url(m.signal.alert),'--art-msig-x':String(m.signal.x),'--art-msig-y':String(m.signal.y),'--art-msig-w':String(w),'--art-msig-h':String(h)});
        }
        const strips=['title','info','keys'].filter(key => m[key]);
        if (strips.length) marks['data-fk-skin-art-menu-strips']=strips.join(' ');
        if (strips.some(key => m[key].vertical)) marks['data-fk-skin-art-menu-vertical']=strips.filter(key => m[key].vertical).join(' ');
        // motion (§18 E3): the items' staged entrance and exit (theme.css «art menu: motion»; the stage keeps the menu
        // mounted through the exit, GalStage menuLeaving).
        for (const [key,stage] of Object.entries(m.motion || {})) {
            const p='--art-mm-' + key, pose=stage.pose;
            marks['data-fk-skin-art-menu-motion']=[marks['data-fk-skin-art-menu-motion'],key,stage.fade ? key + '-fade' : ''].filter(Boolean).join(' ');
            Object.assign(tokens,{[p + '-ms']:stage.ms + 'ms',[p + '-stagger']:(stage.stagger || 0) + 'ms',[p + '-ease']:STAGE_SKIN_EASE[stage.ease || 'out'],
                [p + '-dx']:String(pose.dx || 0),[p + '-dy']:String(pose.dy || 0),[p + '-rot']:(pose.rot || 0) + 'deg',[p + '-scale']:stageSkinPoseScale(pose),[p + '-f']:`brightness(${pose.bright ?? 1})`});
        }
        for (const key of strips) {
            const s=m[key], [sw,sh]=s.image ? size(s.image) : [s.text[1],s.text[2] * 2], p='--art-ms-' + key;
            Object.assign(tokens,{[p + '-img']:s.image ? url(s.image) : 'none',[p + '-x']:String(s.x),[p + '-y']:String(s.y),[p + '-w']:String(sw),[p + '-h']:String(sh),
                [p + '-l']:String(s.text[0]),[p + '-r']:String(s.text[1]),[p + '-m']:String(s.text[2]),[p + '-font']:String(s.font),
                [p + '-justify']:s.align === 'center' ? 'center' : s.align === 'end' ? 'flex-end' : 'flex-start'});
            // rule: the drawn rule on both sides of the words, at its natural size, gap from them
            if (s.rule) {
                const [rw,rh]=size(s.rule.image);
                marks['data-fk-skin-art-menu-rule']=[marks['data-fk-skin-art-menu-rule'],key].filter(Boolean).join(' ');
                Object.assign(tokens,{[p + '-rule']:url(s.rule.image),[p + '-rule-w']:String(rw),[p + '-rule-h']:String(rh),[p + '-rule-gap']:String(s.rule.gap || 0)});
            }
            if (s.ink) tokens[p + '-ink']=s.ink;
        }
    }
    // art.backlog / art.config / art.voice: the stage's own overlays drawn as the original's screens on
    // wide stages (theme.css 「stage skin: art screens」), in design px; a placed image as its top-left and natural size.
    const placed=(prefix,item) => {
        if (!item) return;
        const [w,h]=size(item.image,item.scale);
        Object.assign(tokens,{[prefix + '-img']:url(item.image),[prefix + '-focus']:url(item.focus || item.image),[prefix + '-x']:String(item.x),[prefix + '-y']:String(item.y),[prefix + '-w']:String(w),[prefix + '-h']:String(h)});
    };
    const screen=(key,s) => {
        const p='--art-' + key;
        marks['data-fk-skin-art-' + key]=['sheet','title','close'].filter(part => s[part]).join(' ');
        if (s.sheet) tokens[p + '-sheet']=url(s.sheet);
        tokens[p + '-dim']=String(s.dim ?? 0);
        tokens[p + '-font']=String(s.font);
        if (s.ink) tokens[p + '-ink']=s.ink;
        placed(p + '-title',s.title); placed(p + '-close',s.close);
    };
    if (art.backlog) {
        const b=art.backlog, p='--art-bl';
        screen('backlog',b);
        const [lx,ly,lw,lh]=b.list;
        Object.assign(tokens,{[p + '-list-x']:String(lx),[p + '-list-y']:String(ly),[p + '-list-w']:String(lw),[p + '-list-h']:String(lh),[p + '-pitch']:String(b.pitch),
            [p + '-text-l']:String(b.text[0]),[p + '-text-r']:String(b.text[1]),[p + '-top']:String(b.top || 0),[p + '-gap']:String(b.gap)});
        const parts=[];
        // voice: the skin's place for the replay control (a box from the entry's top-left = anchor row, or {anchor, at, size});
        // omitted = right after the name (the stylesheet's default). `voice` in parts = the skin sized it.
        if (b.voice) {
            const v=Array.isArray(b.voice) ? {anchor:'row',at:b.voice.slice(0,2),size:b.voice.slice(2)} : b.voice, [x,y]=v.at || [0,0];
            marks['data-fk-skin-art-backlog-voice']=v.anchor;
            Object.assign(tokens,{[p + '-voice-x']:String(x),[p + '-voice-y']:String(y)});
            if (v.size) {parts.push('voice'); Object.assign(tokens,{[p + '-voice-w']:String(v.size[0]),[p + '-voice-h']:String(v.size[1])});}
        }
        if (b.name) {
            parts.push('name');
            Object.assign(tokens,{[p + '-name-x']:String(b.name.x),[p + '-name-y']:String(b.name.y),[p + '-name-h']:String(b.name.h),[p + '-name-font']:String(b.name.font),[p + '-head']:String(b.name.head)});
            if (b.name.frame) {parts.push('frame'); placed(p + '-frame',b.name.frame);}
            if (b.name.rule) {parts.push('rule'); placed(p + '-rule',b.name.rule);}
        }
        if (b.scrollbar) {
            const s=b.scrollbar; parts.push('bar');
            Object.assign(tokens,{[p + '-bar']:url(s.track),[p + '-thumb']:url(s.thumb),[p + '-bar-x']:String(s.x),[p + '-bar-y']:String(s.y),[p + '-bar-w']:String(s.w),[p + '-bar-h']:String(s.h)});
        }
        // hover: the original's stain behind the entry under the pointer / focus and the current entry (one highlight).
        if (b.hover) {parts.push('hover'); stageSkinHighlightTokens(tokens,p + '-hover',b.hover,url);}
        marks['data-fk-skin-art-backlog-parts']=parts.join(' ');
    }
    if (art.config) {
        const c=art.config, p='--art-cf';
        screen('config',c);
        const [px,py,pw,ph]=c.page, parts=[];
        Object.assign(tokens,{[p + '-page-x']:String(px),[p + '-page-y']:String(py),[p + '-page-w']:String(pw),[p + '-page-h']:String(ph),[p + '-row']:String(c.row),[p + '-control']:String(c.control)});
        if (c.tabs) {
            const t=c.tabs, [tw,th]=size(t.images.plain,t.scale); parts.push('tabs');
            Object.assign(tokens,{[p + '-tab']:url(t.images.plain),[p + '-tab-on']:url(t.images.on),[p + '-tab-x']:String(t.x),[p + '-tab-y']:String(t.y),[p + '-tab-w']:String(tw),[p + '-tab-h']:String(th),
                [p + '-tab-pitch']:String(t.pitch),[p + '-tab-l']:String(t.text[0]),[p + '-tab-r']:String(t.text[1]),[p + '-tab-m']:String(t.text[2]),[p + '-tab-font']:String(t.font)});
        }
        if (c.focus) {parts.push('focus'); tokens[p + '-focus']=url(c.focus);}
        if (c.slider) {
            const s=c.slider; parts.push('slider');
            Object.assign(tokens,{[p + '-sl-track']:url(s.track),[p + '-sl-fill']:url(s.fill),[p + '-sl-frame']:s.frame ? url(s.frame) : 'none',[p + '-sl-thumb']:url(s.thumb),[p + '-sl-thumb-focus']:url(s.focus || s.thumb),
                [p + '-sl-h']:String(s.h),[p + '-sl-thumb-size']:String(s.thumbSize)});
        }
        if (c.toggle) {
            const s=c.toggle; parts.push('toggle');
            Object.assign(tokens,{[p + '-tg']:url(s.plain),[p + '-tg-on']:url(s.on),[p + '-tg-focus']:url(s.focus || s.on),[p + '-tg-frame']:s.frame ? url(s.frame) : 'none',[p + '-tg-h']:String(s.h)});
        }
        if (c.select) {
            const s=c.select; parts.push('select');
            Object.assign(tokens,{[p + '-sel']:url(s.plain),[p + '-sel-focus']:url(s.focus || s.plain),[p + '-sel-h']:String(s.h),[p + '-sel-w']:String(size(s.plain)[0] * s.h / size(s.plain)[1])});
            if (s.ink) tokens[p + '-sel-ink']=s.ink;
        }
        marks['data-fk-skin-art-config-parts']=parts.join(' ');
    }
    if (art.voice?.image) {
        marks['data-fk-skin-art-voice']='';
        const [vw,vh]=size(art.voice.image,art.voice.scale);
        Object.assign(tokens,{'--art-voice-w':String(vw),'--art-voice-h':String(vh),'--art-voice':url(art.voice.image),'--art-voice-focus':url(art.voice.focus || art.voice.image),'--art-voice-on':url(art.voice.active || art.voice.focus || art.voice.image)});
    }
    // box false: the textbox has no replay control (the original's has none); replay stays on R and in the backlog.
    if (art.voice?.box === false) marks['data-fk-skin-art-voice-box']='none';
    // art.confirm (lead 2026-10-20): the stage's confirm dialogs as the original's dialog band (theme.css 「stage skin: art
    // confirm」), marks data-fk-skin-art-confirm, tokens --art-cd-*.
    if (art.confirm) {
        const k=art.confirm, b=k.button, [bw,bh]=size(b.plain), p='--art-cd';
        marks['data-fk-skin-art-confirm']=['top','bottom'].filter(part => k[part]).join(' ');
        Object.assign(tokens,{[p + '-band']:url(k.band),[p + '-h']:String(k.h),[p + '-pt']:String(k.pad?.[0] || 0),[p + '-pb']:String(k.pad?.[1] || 0),
            [p + '-gap']:String(k.gap || 0),[p + '-width']:String(k.width || 2400),[p + '-dim']:String(k.dim ?? 0),[p + '-font']:String(k.font),
            [p + '-btn']:url(b.plain),[p + '-btn-focus']:url(b.focus),[p + '-btn-w']:String(bw),[p + '-btn-h']:String(bh),[p + '-btn-font']:String(b.font),[p + '-btn-gap']:String(b.gap || 0)});
        for (const part of ['top','bottom']) if (k[part]) {const [pw,ph]=size(k[part]); Object.assign(tokens,{[p + '-' + part]:url(k[part]),[p + '-' + part + '-w']:String(pw),[p + '-' + part + '-h']:String(ph)});}
        if (k.ink) tokens[p + '-ink']=k.ink;
        if (b.ink) tokens[p + '-btn-ink']=b.ink;
        if (b.focusInk) tokens[p + '-btn-focus-ink']=b.focusInk;
        if (b.lead) tokens[p + '-btn-lead']=b.lead;
    }
    if (art.narration) {
        if (box) marks['data-fk-skin-narration']='veil';
        Object.assign(tokens,{'--art-nar-font':String(art.narration.font),'--art-nar-pitch':String(art.narration.pitch),'--art-nar-veil':String(art.narration.veil),'--art-nar-y':String(art.narration.y ?? art.screen / 2)});
        for (const [key,value] of Object.entries(art.narration.band || {})) tokens['--art-nar-band-'+key]=String(value);
    }
    const placeButton=([action,button]) => {
        const [w,h]=size(button.image,button.scale);
        // hint: the image's own prompt gives way to a key cap of the action's real key (stage-skin-buttons.js).
        return {action,url:file(button.image).url,on:button.on ? file(button.on).url : null,tint:button.tint ? file(button.tint).url : null,width:w,height:h,
            hint:button.hint ? {action:button.hint.action || action,w:button.hint.w,h:button.hint.h} : null,...(Object.hasOwn(button,'top') ? {top:button.top} : {bottom:button.bottom}),...(Object.hasOwn(button,'left') ? {left:button.left} : {right:button.right}),
            // narrow: its own phone art and place (P5), in the phones' touch unit
            ...(button.narrow ? {narrow:(([nw,nh]) => ({url:file(button.narrow.image).url,on:button.narrow.on ? file(button.narrow.on).url : null,width:nw,height:nh,ntop:button.narrow.top,
                ...(Object.hasOwn(button.narrow,'left') ? {left:button.narrow.left} : {right:button.narrow.right})}))(size(button.narrow.image,button.narrow.scale))} : null)};
    };
    const buttons=Object.entries(art.buttons || {}).map(placeButton);
    // A mode's own buttons (modes.<id>.buttons, stage-skin-adv.md「modes」): drawn with the others while the mode is on.
    // hud.beside timer: one row ending at the timer's left edge, the last declared nearest; dock = the design px from the
    // timer's left edge to the button's right edge (stage-skin-buttons.js measures the timer; own place without one).
    const modeButtons=Object.fromEntries(Object.entries(document.modes || {}).map(([id,mode]) => {
        const row=Object.entries(mode.buttons || {}).map(entry => ({...placeButton(entry),mode:id}));
        if (mode.hud?.beside === 'timer') {let dock=mode.hud.gap || 0; for (const button of row.slice().reverse()) {button.dock=dock; dock+=button.width;}}
        return [id,row];
    }));
    // Hinted rows  are one column: cap, then label, every cap on one edge. The image
    // offsets were laid out for prompt glyphs of different widths, so hinted buttons that hang from the same corner share
    // its outermost row edge: from the left, the smallest `left`; from the right, `col` = the largest `right + width`
    // (the row's left edge, measured from the stage's right edge; the row then runs rightward, width by its content).
    // Used only while the cap shows (stage-skin-buttons.js); without it the image keeps its own place.
    const columns={};
    for (const button of buttons) if (button.hint) (columns[('left' in button ? 'l' : 'r') + ('top' in button ? 't' : 'b')] ||= []).push(button);
    for (const group of Object.values(columns)) {
        const col='left' in group[0] ? Math.min(...group.map(button => button.left)) : Math.max(...group.map(button => button.right + button.width));
        for (const button of group) button.col=col;
    }
    // art.decor: the original's still HUD prints (no action), placed like the buttons and drawn with them.
    const decor=(art.decor || []).map(item => {
        const [w,h]=size(item.image,item.scale);
        return {url:file(item.image).url,width:w,height:h,...(Object.hasOwn(item,'top') ? {top:item.top,ntop:item.top} : {bottom:item.bottom}),...(Object.hasOwn(item,'left') ? {left:item.left} : {right:item.right})};
    });
    if (decor.length) marks['data-fk-skin-decor']='';
    if (buttons.length) {
        marks['data-fk-skin-buttons']='';
        // A drawn menu button stands in for the folded menu control.
        if (art.buttons.menu) marks['data-fk-skin-menu']='';
        // Phones: the skin's own buttons stand there too, in one unit
        // that keeps the smallest a 36px touch target (--art-btn-min, theme.css「stage skin: art」), all hanging from the top
        // edge: the portrait screen's bottom is the text box. A top button keeps its place; the buttons placed from the bottom
        // keep their arrangement and hang under that side's top buttons, a quarter of the smallest button apart (ntop).
        // A button with its own phone art (narrow) stands at its own phone place; the others hang as before.
        const phone=buttons.map(button => button.narrow || button);
        const least=Math.min(...phone.map(button => button.height)), gap=least / 4;
        for (const side of ['left','right']) {
            const own=buttons.filter(button => side in button && !button.narrow), top=own.filter(button => 'top' in button), low=own.filter(button => !('top' in button));
            for (const button of top) button.ntop=button.top;
            if (!low.length) continue;
            const base=top.length ? Math.max(...top.map(button => button.top + button.height)) + gap : 0, reach=Math.max(...low.map(button => button.bottom + button.height));
            for (const button of low) button.ntop=base + reach - button.bottom - button.height;
        }
        tokens['--art-btn-min']=String(least);
        // The folded menu control (or the drawn menu button) and the runtime notices stand under the lowest top right-hand
        // button, on its right edge (buttons placed from the bottom edge leave the top right to them).
        const right=buttons.filter(button => 'right' in button && 'top' in button), low=right.reduce((a,b) => !a || b.top + b.height > a.top + a.height ? b : a,null);
        tokens['--art-hud-top']=String(low ? low.top + low.height : 0);
        tokens['--art-hud-right']=String(low ? low.right : 12);
        // the same on phones, where every button hangs from the top (ntop)
        const nlow=phone.filter(button => 'right' in button).reduce((a,b) => !a || b.ntop + b.height > a.ntop + a.height ? b : a,null);
        tokens['--art-hud-ntop']=String(nlow ? nlow.ntop + nlow.height : 0);
        tokens['--art-hud-nright']=String(nlow ? nlow.right : 12);
        // the revealed top bar on phones runs between the top row's buttons: each side's reach from its edge (the buttons
        // hanging higher than the smallest one is tall)
        for (const side of ['left','right']) tokens['--art-bar-' + side[0]]=String(Math.max(0,...phone.filter(button => side in button && button.ntop < least).map(button => button[side] + button.width)));
    }
    // art.shape (stage-skin-adv.md「art.shape」): the drawn box's SVG (StageSkinShape) over its view rect on the design screen.
    if (art.shape) {
        const [x,y,w,h]=art.shape.view;
        marks['data-fk-skin-shape']='';
        Object.assign(tokens,{'--art-shape-x':String(x),'--art-shape-y':String(y),'--art-shape-w':String(w),'--art-shape-h':String(h)});
    }
    // The portrait (art.portrait): the face window of an ADV layout, a square placed on the design screen.
    let faceName=null, placeholder=null;
    if (art.portrait) {
        marks['data-fk-skin-portrait']=art.portrait.source || 'avatar';
        Object.assign(tokens,{'--art-face-l':String(art.portrait.left),'--art-face-b':String(art.portrait.bottom),'--art-face-s':String(art.portrait.size)});
        // bare: a face square standing in the box's left gutter (inside the
        // body, left of text[0]) is a column only while a face shows; a page without one starts its lines where the face stands.
        if (box && art.portrait.left >= box.body[0] && art.portrait.left + art.portrait.size <= box.text[0]) {marks['data-fk-skin-art-bare']=''; tokens['--art-text-bare']=String(art.portrait.left);}
        // when off-stage (§2.7): wide stages show a face only for a speaker not drawn on stage (GalStage reads the mark).
        if (art.portrait.when === 'off-stage') marks['data-fk-skin-portrait-when']='off-stage';
        // placeholder (§18 N16): the stand-in face for a speaker the avatar resolver gives none (GalStage builds it per page):
        // the engine's initial disc, or the skin's own image.
        if (art.portrait.placeholder) {
            marks['data-fk-skin-portrait-placeholder']=art.portrait.placeholder === 'initial' ? 'initial' : 'image';
            placeholder=art.portrait.placeholder === 'initial' ? {initial:true} : {image:file(art.portrait.placeholder.image).url};
        }
        // feather (§2.7): the face picture's soft edges, shares of its square (theme.css «art portrait feather»).
        if (art.portrait.feather) {
            marks['data-fk-skin-portrait-feather']='';
            art.portrait.feather.forEach((share,i) => {tokens['--art-face-feather-' + 'trbl'[i]]=Math.round(share * 1000) / 10 + '%';});
        }
        // frame: the original's frame image behind the face, shown with it, and
        // the window the face is clipped to (default the square), in design px.
        const frame=art.portrait.frame;
        if (frame) {
            const [fw,fh]=size(frame.image), [wl,wb,ww,wh]=frame.window || [art.portrait.left,art.portrait.bottom,art.portrait.size,art.portrait.size];
            marks['data-fk-skin-portrait-frame']='';
            // motion (§18 N9): the frame and its face enter together with a new speaker's face (fork-skin-face-in-a / -b,
            // stageSkinMotionKeyframes; GalSide flips data-face-in between the two so each new face restarts it).
            // layer face (§18 N12): the face alone moves in the still frame (data-fk-skin-portrait-motion="face"); leave = the
            // face it replaces plays fork-skin-face-out before it goes.
            if (frame.motion) {marks['data-fk-skin-portrait-motion']=frame.motion.layer === 'face' ? 'face' : ''; tokens['--art-face-motion-ms']=frame.motion.ms + 'ms';}
            if (frame.motion?.leave) {marks['data-fk-skin-portrait-leave']=''; tokens['--art-face-leave-ms']=frame.motion.leave.ms + 'ms';}
            Object.assign(tokens,{'--art-face-frame':url(frame.image),'--art-face-fl':String(frame.left),'--art-face-fb':String(frame.bottom),'--art-face-fw':String(fw),'--art-face-fh':String(fh),
                '--art-face-wl':String(wl),'--art-face-wb':String(wb),'--art-face-ww':String(ww),'--art-face-wh':String(wh)});
            // round / front / glass / speaking (skin-interface.md「通用部件能力」): the window's shape, the frame's layer, the sheen over
            // the face and the frame while the line is delivered (theme.css「art portrait frame」).
            if (frame.round) marks['data-fk-skin-portrait-round']='';
            // swap fade (§18 N14): a new face crossfades in the still window instead of the cut (theme.css «art portrait frame swap»)
            if (frame.swap) marks['data-fk-skin-portrait-swap']=frame.swap;
            if (frame.front) marks['data-fk-skin-portrait-front']='';
            if (frame.glass) {marks['data-fk-skin-portrait-glass']=''; tokens['--art-face-glass']=url(frame.glass);}
            if (frame.back) {marks['data-fk-skin-portrait-back']=''; tokens['--art-face-back']=url(frame.back);}
            // fill: the window's own opaque face under the back and the face (a colour, or a radial [centre, edge]); round = the
            // window's ellipse (closest-side, cut a hair inside it so the frame's inner edge covers the cut)
            if (frame.fill) {
                const [inner,outer]=[].concat(frame.fill).concat([].concat(frame.fill));
                marks['data-fk-skin-portrait-fill']='';
                tokens['--art-face-fill']=frame.round ? `radial-gradient(closest-side, ${inner}, ${outer} 99%, transparent 100%)` : `radial-gradient(farthest-corner, ${inner}, ${outer})`;
            }
            if (frame.speaking) {marks['data-fk-skin-portrait-speaking']=''; tokens['--art-face-speaking']=url(frame.speaking);}
            // tint: the mask's part of the frame takes the box's speaker colour (--speaker-tint, the source textbox.tint uses),
            // drawn by the side's tint layer (GalSide, theme.css「art portrait frame tint」), so it scales with the side.
            if (frame.tint) {marks['data-fk-skin-portrait-tint']=''; tokens['--art-face-tint']=url(frame.tint);}
            // mood: the caption the stage fills with the shown face's 差分 label (GalSide).
            if (frame.mood) {
                const [ml,mb,mw,mh]=frame.mood.rect;
                marks['data-fk-skin-portrait-mood']='';
                Object.assign(tokens,{'--art-face-ml':String(ml),'--art-face-mb':String(mb),'--art-face-mw':String(mw),'--art-face-mh':String(mh),'--art-face-mfont':String(frame.mood.font),
                    '--art-face-mink':frame.mood.ink,'--art-face-mweight':String(frame.mood.weight || 500),'--art-face-mspacing':(frame.mood.spacing || 0) + 'em'});
            }
            // name (skin-interface.md「通用部件能力」): the speaker's name along a circle on the frame, drawn by the stage's face side
            // (GalSide) in the frame image's own px (faceName below); while it shows, the box's plate steps aside to its
            // voice control, centred at voice (default: 12° past the arc's right end).
            if (frame.name) {
                const n=frame.name, [ax,ab,r]=n.arc, span=n.span || 90, top=n.side === 'top';
                const [vx,vb]=n.voice || (() => {const a=(top ? 270 + span / 2 + 12 : 90 - span / 2 - 12) * Math.PI / 180; return [ax + r * Math.cos(a),ab - r * Math.sin(a)];})();
                marks['data-fk-skin-portrait-name']='';
                Object.assign(tokens,{'--art-face-nv-x':String(Math.round(vx * 10) / 10),'--art-face-nv-b':String(Math.round(vb * 10) / 10),'--art-face-nfont':String(n.font),
                    '--art-face-nink':[].concat(n.ink)[0],'--art-face-nweight':String(n.weight || 700),'--art-face-nspacing':(n.spacing || 0) + 'em'});
                if (n.engrave) Object.assign(tokens,{'--art-face-nlight':n.engrave.light,'--art-face-ndark':n.engrave.dark});
                // legibility: the outline's colour also rims the phone's caption line (theme.css)
                if (n.stroke) {marks['data-fk-skin-portrait-name-stroke']=''; tokens['--art-face-nstroke']=n.stroke.color;}
                faceName={view:[fw,fh],x:ax - frame.left,y:fh - (ab - frame.bottom),r,span,side:top ? 'top' : 'bottom',font:n.font,ink:[].concat(n.ink),
                    weight:n.weight || 700,spacing:n.spacing || 0,engrave:n.engrave || null,stroke:n.stroke || null,shadow:n.shadow ? {color:n.shadow.color,dx:n.shadow.dx || 0,dy:n.shadow.dy} : null,
                    bed:n.bed ? {color:n.bed.color,alpha:n.bed.alpha,width:n.bed.width || n.font} : null,min:n.min || n.font * .25};
            }
        }
        // narrow (§13): the side on a phone, CSS px from the box's top-left corner; the lines clear it face or not.
        if (art.portrait.narrow) {
            const nw=art.portrait.narrow, [sw,sh]=frame ? size(frame.image) : [art.portrait.size,art.portrait.size];
            marks['data-fk-skin-portrait-narrow']=nw.name === 'arc' || !frame?.name ? '' : nw.name || 'below';
            // flow (skin-interface.md §1.5 手机落位): how the lines clear the side - beside (its column), wrap (beside it to its bottom,
            // then the full width), below (under it, the full width) from left px; nameMin = the arc name's floor there (CSS px,
            // GalSideName: past it the run is condensed to its arc)
            marks['data-fk-skin-portrait-flow']=nw.flow || 'beside';
            tokens['--art-face-nleft']=String(nw.left ?? 12);
            if (faceName && nw.nameMin) faceName.narrowMin=nw.nameMin;
            Object.assign(tokens,{'--art-face-nw':String(nw.width),'--art-face-nh':String(Math.round(nw.width * sh / sw * 10) / 10),'--art-face-nx':String(nw.x),'--art-face-ny':String(nw.y),'--art-face-nsw':String(sw)});
        }
        // nameplate axis portrait (§18 N14): the face's vertical axis - the window's middle on the design screen, and on a phone
        // the narrow side's (CSS px from the box's left) - the plate's name is centred on (theme.css «art name axis»).
        if (art.nameplate?.axis) {
            const [wl,wb,ww]=frame?.window || [art.portrait.left,art.portrait.bottom,art.portrait.size], middle=wl + ww / 2;
            marks['data-fk-skin-art-name-axis']='';
            tokens['--art-np-axis']=String(middle);
            // wide under (§18 N16): the window's bottom on the design screen, the plate's top just below it
            tokens['--art-np-under']=String(wb);
            if (art.portrait.narrow) {
                const nw=art.portrait.narrow, [from,span]=frame ? [frame.left,size(frame.image)[0]] : [art.portrait.left,art.portrait.size];
                tokens['--art-np-naxis']=String(Math.round((nw.x + (middle - from) * nw.width / span) * 10) / 10);
            }
        }
    }
    // A bust portrait (stage-skin-adv.md「portrait source」) is drawn by the scene (gal-scene.js galBustFrame): the
    // design screen (centred, standing on the stage's bottom edge; `fit` = the width bounding one art px, as --art-u) and the
    // framing words, in its px.
    const bust=art.portrait?.bust ? {screen:art.screen,width:art.screenWidth,fit:Math.max(wide,box ? size(box.images.plain,box.scale)[0] / (box.fit || .96) : 0),
        head:art.portrait.bust.head,crop:art.portrait.bust.crop,enter:art.portrait.bust.enter || null} : null;
    // art.item (stage-skin-adv.md「art.item」): the items mod's card as the original's frame, placed by the showcase
    // (mod-performance.js ForkSkinItemShowcase) on this design screen.
    const item=art.item ? {screen:art.screen,width:art.screenWidth,frame:file(art.item.frame).url,box:art.item.box,media:art.item.media,enter:{ms:400,rise:0,...art.item.enter},
        narrow:art.item.narrow || null,hideText:art.item.gain?.hideText === true,
        toast:art.item.gain?.toast ? {...art.item.gain.toast,image:file(art.item.gain.toast.image).url,fadeMs:art.item.gain.toast.fadeMs ?? 300} : null} : null;
    // hud.timer.hide: the drawn buttons put away while the stage shows a timer (the stage leaves them out, as a mode's hud.hide).
    const timerHide=document.hud?.timer?.hide || [];
    // warm (bauhaus d2 review): every image a page swaps in - the box per side and for narration, the portrait frame's speaking
    // image - painted once, 2 px, by .fork-skin-art-warm while the skin is on stage, so a swap draws an image already decoded
    // (a first-use SVG left the box, plate and frame blank for two frames on a narration -> speaker change).
    const warm=[...new Set([...Object.values(box?.images || {}),art.portrait?.frame?.speaking].filter(Boolean))];
    if (warm.length > 1) tokens['--art-warm']=warm.map(url).join(',');
    return {marks,tokens,buttons,modeButtons,decor,cast,tintCue:Boolean(box?.tint?.cue),bust,item,timerHide,faceName,placeholder};
}
// the skin's loader art (art.spinner) belongs to the entry veil, not to the skin bundle: the
// veil leases its images itself (gal-entry.js) and mounts them on its first frame, before the background or any skin
// texture. `images`: image path -> {url, width, height} (decoded, natural size). Returns the overlay's marks and tokens for
// theme.css「stage skin: art spinner」, a row's parts (each its own tokens and motion) and the frame sheets' numeric
// keyframes (no imported CSS or scripts).
function stageSkinSpinnerMark(mark, {url, width, height}) {
    const sheet=mark.sheet, tokens={'--art-spinner':'url("' + url + '")'};
    if (mark.period) tokens['--art-spinner-t']=mark.period + 's';
    if (mark.loop === false) tokens['--art-spinner-loop']='1';
    if (!sheet) return {motion:mark.motion || 'spin',tokens};
    const {columns,rows,frames}=sheet, fw=width/columns, fh=height/rows, name=`fork-skin-sheet-${columns}-${rows}-${frames}`;
    const position=i => `${columns > 1 ? (i % columns) * 100 / (columns-1) : 0}% ${rows > 1 ? Math.floor(i/columns) * 100 / (rows-1) : 0}%`;
    // Discrete positions, including the held last frame for non-looping animations.
    const keyframes=`@keyframes ${name}{` + Array.from({length:frames},(_,i) => `${i*100/frames}%{background-position:${position(i)}}`).join('') + `100%{background-position:${position(frames-1)}}}`;
    Object.assign(tokens,{'--art-spinner-animation':name,'--art-spinner-t':frames/mark.fps+'s','--art-spinner-sheet':`${columns*100}% ${rows*100}%`,
        '--art-spinner-w':String(fw/Math.max(fw,fh)),'--art-spinner-h':String(fh/Math.max(fw,fh))});
    return {motion:'frames',tokens,keyframes};
}
// `screen`: the skin's design screen {height, width} (art.screen / art.screenWidth) - a row's boxes are drawn in its px.
function stageSkinSpinner(spinner, images, screen) {
    const tokens={}, marks={};
    if (spinner.scale) tokens['--art-spinner-scale']=String(spinner.scale);
    // place: bottom-right - the stage's corner on no plate (theme.css「art spinner: corner」).
    if (spinner.place === 'bottom-right') marks['data-fk-skin-spinner-place']='bottom-right';
    // words: the art says 「loading」 itself - no engine caption, step line or bar beside it (theme.css「art spinner: words」).
    if (spinner.words) marks['data-fk-skin-spinner-words']='';
    if (!spinner.parts) {
        const mark=stageSkinSpinnerMark(spinner,images[spinner.image]);
        marks['data-fk-skin-spinner']=mark.motion;
        if (spinner.at) {marks['data-fk-skin-spinner-at']=''; Object.assign(tokens,{'--art-spinner-x':String(spinner.at[0]),'--art-spinner-y':String(spinner.at[1]),'--art-spinner-size':String(spinner.at[2])});}
        return {marks,tokens:{...tokens,...mark.tokens},...(mark.keyframes ? {loadingKeyframes:mark.keyframes} : {})};
    }
    // A row: one unit 1.4em x scale high, each part at its box in the shared design frame (shifted to the union's origin).
    const x0=Math.min(...spinner.parts.map(part => part.box[0])), y0=Math.min(...spinner.parts.map(part => part.box[1]));
    const w=Math.max(...spinner.parts.map(part => part.box[0] + part.box[2])) - x0, h=Math.max(...spinner.parts.map(part => part.box[1] + part.box[3])) - y0;
    marks['data-fk-skin-spinner']='row'; Object.assign(tokens,{'--art-row-w':String(w),'--art-row-h':String(h)});
    // The boxes are design-screen px: wide stages draw the unit 1:1 in art px, its margins to the screen's right and bottom edges
    // kept (theme.css「art spinner: art px」).
    if (screen?.height && screen.width) {
        marks['data-fk-skin-spinner-art']='';
        Object.assign(tokens,{'--art-loader-screen':String(screen.height),'--art-loader-screen-w':String(screen.width),
            '--art-row-r':String(Math.max(0,screen.width - x0 - w)),'--art-row-b':String(Math.max(0,screen.height - y0 - h))});
    }
    const parts=spinner.parts.map(part => {
        const mark=stageSkinSpinnerMark(part,images[part.image]), [x,y,pw,ph]=part.box;
        return {motion:mark.motion,keyframes:mark.keyframes,tokens:{...mark.tokens,'--art-part-x':String(x-x0),'--art-part-y':String(y-y0),'--art-part-w':String(pw),'--art-part-h':String(ph)}};
    });
    const loadingKeyframes=[...new Set(parts.map(part => part.keyframes).filter(Boolean))].join('');
    return {marks,tokens,parts:parts.map(({keyframes,...part}) => part),...(loadingKeyframes ? {loadingKeyframes} : {})};
}
// A highlight (art.backlog.hover, art.menu.tiles.hover): its image and its overhang [t, r, b, l] design px, for
// theme.css's highlight rules (the image stretched behind the element).
function stageSkinHighlightTokens(tokens, p, h, url) {
    const [t,r,b,l]=h.out || [0,0,0,0];
    Object.assign(tokens,{[p + '-img']:url(h.image),[p + '-t']:String(t),[p + '-r']:String(r),[p + '-b']:String(b),[p + '-l']:String(l)});
}
// A skin text halo ({x, y, blur, color, alpha}, design px) as a CSS text-shadow in art px.
function stageSkinHalo(s) {
    const rgb=[1,3,5].map(i => parseInt(s.color.slice(i,i+2),16)).join(' ');
    return [s.x || 0,s.y || 0,s.blur].map(n => 'calc(' + n + ' * var(--art-u))').join(' ') + ' rgb(' + rgb + ' / ' + (s.alpha ?? 1) + ')';
}
// the skin's mode for the skinMode the stage's
// current performance declares (null = none) - {id, marks, tokens} for theme.css「stage skin: modes」, or null. Places a
// skin leaves out take `plain`.
function stageSkinMode(document, skinMode) {
    const mode=skinMode && document?.art && Object.hasOwn(document.modes || {},skinMode) ? document.modes[skinMode] : null;
    if (!mode) return null;
    const id=skinMode, s=mode.statement, tokens={'--mode-font':String(s.font),'--mode-pitch':String(s.pitch),'--mode-width':String(s.width),'--mode-lines':String(s.lines),
        '--mode-stroke':String(s.stroke || 0),'--mode-halo':s.halo ? stageSkinHalo(s.halo) : 'none',...(s.weight ? {'--mode-weight':String(s.weight)} : {})};
    for (const side of ['plain','left','center','right']) {
        const [x,y,roll]=s.places[side] || s.places.plain;
        Object.assign(tokens,{['--mode-' + side + '-x']:String(x),['--mode-' + side + '-y']:String(y),['--mode-' + side + '-roll']:-roll + 'deg'});
    }
    // hide: the drawn art.buttons this mode puts away (hud.hide; the stage leaves them out while the mode is on).
    return {id,marks:{'data-fk-skin-mode':id,'data-fk-skin-mode-layout':'statement'},tokens,hide:mode.hud?.hide || []};
}
function paintStageSkinMode(root, mode) {
    const before=[...Object.keys(mode.marks).map(name => [name,root.getAttribute(name)])], previous=Object.keys(mode.tokens).map(name => [name,root.style.getPropertyValue(name)]);
    for (const [name,value] of Object.entries(mode.marks)) root.setAttribute(name,value);
    for (const [name,value] of Object.entries(mode.tokens)) root.style.setProperty(name,value);
    return () => {
        for (const [name,value] of before) {if (value === null) root.removeAttribute(name); else root.setAttribute(name,value);}
        for (const [name,value] of previous) {if (value) root.style.setProperty(name,value); else root.style.removeProperty(name);}
    };
}
// the skin's `effects` table for the one resolver (stage-effects.cjs), with
// its thinking image decoded from the prepared bundle (`files`, as stageSkinArt); screen = the design screen height its
// shake paths are measured in (576 without art). A thinking image not in the bundle is left out (the engine's dim stays).
function stageSkinEffects(document, files, entry = '') {
    const effects=document?.effects;
    if (!effects) return null;
    const dir=entry.includes('/') ? entry.replace(/[^/]*$/,'') : '', image=effects.thinking?.image ? files?.[dir + effects.thinking.image]?.image || null : null;
    const thinking=effects.thinking ? {...effects.thinking,image} : undefined;
    return {effects:thinking ? {...effects,thinking} : effects,screen:document.art?.screen || 576};
}
// The speaker's colour on a drawn colour with that colour's luminance kept: the W3C luminosity blend (SetLum(tint, Lum(base))),
// the same rule theme.css applies to the box trim, so the cue and the trim match. A non-hex tint keeps the base.
function stageSkinTint(base, tint) {
    const hex=/^#[\da-f]{6}$/i, rgb=c => [1,3,5].map(i => parseInt(c.slice(i,i+2),16)/255), lum=([r,g,b]) => .3*r+.59*g+.11*b;
    if (!hex.test(base) || !hex.test(tint || '')) return base;
    const target=lum(rgb(base)), source=rgb(tint), d=target-lum(source), c=source.map(v => v+d), l=lum(c), n=Math.min(...c), x=Math.max(...c);
    const clipped=c.map(v => n < 0 ? l+(v-l)*l/(l-n) : x > 1 ? l+(v-l)*(1-l)/(x-l) : v);
    return '#'+clipped.map(v => Math.round(Math.min(1,Math.max(0,v))*255).toString(16).padStart(2,'0')).join('');
}
// The stage menu for a speaker (art.textbox.tint.menu): the skin's accent in the speaker's hue (stageSkinTint), mixed toward
// black until it reads at 4.5:1 on the skin's surface, and the menu's accent-tinted paints (raised panel, hover, selected)
// rebuilt from it by the rule stageSkinPanelTokens uses - each share lowered until the ink and the accent keep 4.5:1 on it.
// Root tokens --speaker-menu-* (theme.css maps them on .fork-gal-menu); {} without a hex speaker colour or skin paint.
function stageSkinMenuTint(document, tint) {
    const hex=/^#[\da-f]{6}$/i, p={...document?.textbox?.paint,...document?.ui}, ink=p.fg, surface=p.bg;
    if (!hex.test(tint || '') || ![p.accent,ink,surface].every(c => hex.test(c || ''))) return {};
    const contrast=stageSkinContract.skinContrast;
    const mix=(a,b,k)=>'#'+[1,3,5].map(n=>Math.round(parseInt(a.slice(n,n+2),16)*k+parseInt(b.slice(n,n+2),16)*(1-k)).toString(16).padStart(2,'0')).join('');
    let accent=stageSkinTint(p.accent,tint);
    const shade=(c,k)=>'#'+[1,3,5].map(n=>Math.round(parseInt(c.slice(n,n+2),16)*k).toString(16).padStart(2,'0')).join('');
    for (let k=.95; contrast(accent,surface) < 4.5 && k > .2; k-=.05) accent=shade(stageSkinTint(p.accent,tint),k);
    const paint=share=>{for(let k=share;k>0;k-=.01){const c=mix(accent,surface,k);if([ink,accent].every(fg=>contrast(fg,c)+1e-6>=4.5))return c;}return surface;};
    const dark=contrast(surface,shade(surface,0))<8;
    return {'--speaker-menu-accent':accent,'--speaker-menu-raised':paint(.06),'--speaker-menu-hover':paint(dark?.10:.12),'--speaker-menu-selected':paint(dark?.18:.16)};
}
// the 履历 by role. The layout's default look per role, the
// skin's declared looks over it, the plates' measures (the skin's metrics in design px, else the engine's at a 16 px reading
// size) and each plate drawn as one SVG from the look's paint: the outline (corners, the bubble's tail) with its outer line and
// rim inward from the outer edge and the fill at the look's opacity, used as a 9-slice border image (the corners and tail keep
// their size, the middle stretches with the words). A role the skin does not style takes the layout's default; no skin (or
// film mode) is the list with today's rows.
// configArt: the CONFIG surface's images (stageSkinConfigArt), apart from `art` (they need no art layer).
function paintStageSkin(root, document, fonts, theme, lead = false, art = null, configArt = null) {
    const tokens={...stageSkinTokens(document,fonts,theme,lead),...art?.tokens,...configArt?.tokens}, previous=new Map();
    const old=root.getAttribute('data-fk-skin');
    for (const [name,value] of Object.entries(tokens)) {previous.set(name,[root.style.getPropertyValue(name),root.style.getPropertyPriority(name)]); root.style.setProperty(name,value);}
    root.setAttribute('data-fk-skin',document.id);
    const marks={...stageSkinMarks(document),...art?.marks,...configArt?.marks},before=Object.keys(marks).map(name => [name,root.getAttribute(name)]);
    for (const [name,value] of Object.entries(marks)) root.setAttribute(name,value);
    return () => {
        for (const [name,[value,priority]] of previous) {if (value) root.style.setProperty(name,value,priority); else root.style.removeProperty(name);}
        if (old === null) root.removeAttribute('data-fk-skin'); else root.setAttribute('data-fk-skin',old);
        for (const [name,value] of before) {if (value === null) root.removeAttribute(name); else root.setAttribute(name,value);}
    };
}

return {dispose,STAGE_SKIN_EASE,STAGE_SKIN_TX_EASE,stageSkinTxEase,stageSkinWipeClip,stageSkinTransitionList,STAGE_BACKLOG_DEFAULTS,stageSkinBacklog,stageSkinBacklogPlate,stageSkinBacklogPlateStyle,stageSkinBacklogOutline,stageSkinInset,stageSkinSfx,stageSkinMotionKeyframes,stageSkinGlyphPoses,stageSkinEffects,stageSkinTokens,stageSkinPanelTokens,stageSkinQuickMenu,stageSkinMarks,stageSkinConfigSurface,stageSkinConfigArt,STAGE_CONFIG_DEFAULT_LOOKS,stageSkinControlIcons,stageSkinArt,stageSkinSpinner,stageSkinTint,stageSkinMenuTint,stageSkinFontFaces,applyStageSkin,stageSkinMode,applyStageSkinMode};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSkinAdapter};
