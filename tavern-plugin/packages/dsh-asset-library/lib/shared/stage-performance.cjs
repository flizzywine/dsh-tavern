// Generated from dsh-presentation-protocol/src/performance-contract.cjs by build.mjs; do not edit.
'use strict';
// Host-side inert authoring contract; no executable assets or player state.
const schema=require('../schema/performance.schema.json');
const {validateSkinSchema}=require('./skin-overlay.cjs');
const {validateStageSkin}=require('./stage-skin.cjs');
function check(ok,message) {if(!ok)throw Object.assign(new Error(message),{code:'INVALID_PERFORMANCE'});}
function validateStagePerformance(document) {
    check(new TextEncoder().encode(JSON.stringify(document)).length<=131072,'Performance document exceeds 128 KiB');
    try {validateSkinSchema(schema,document);} catch(error) {throw Object.assign(new Error(error.message),{code:'INVALID_PERFORMANCE'});}
    // levels/overlays use the shared skin format, not another renderer.
    if(document.theme) validateStageSkin(document.theme);
    check(document.legacySkinId === undefined || document.legacySkinId === document.theme?.id,'Historical skin alias must match embedded theme');
    check(!document.theme?.license?.privateUse || document.license.privateUse,'Private theme cannot be relabelled public');
    check(!Object.hasOwn(document.packs,'self'),'self is the owning pack, not an overridable alias');
    for (const id of Object.values(document.packs)) check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),'Invalid performance pack UUID');
    check(!document.levels || Object.hasOwn(document.levels,String(document.levels.default)),'Default performance level must be declared');
    check([...document.label].length<=120,'Performance label exceeds 120 characters');
    if(document.shot) {
        check(document.shot.head.left || document.shot.head.right,'A shot declares head.left or head.right');
        for(const [x,,height] of Object.values(document.shot.head)) check(x>=0 && x<=1 && height>0,'A shot head is centred on the stage and has a height');
    }
    for(const phase of Object.values(document.timeline)) {
        let at=-1;
        for(const event of phase.events) {
            check(event.at>=at,'Performance events must be ordered');at=event.at;
            if(event.slot!==undefined)check(/^[a-z][a-z0-9-]{0,47}$/.test(event.slot),'Invalid widget slot');
        }
        if(phase.every)check(phase.every[0]<=phase.every[1]&&phase.every[1]<=300000,'Invalid idle interval');
        const flashes=phase.events.filter(event=>event.do==='flash');
        for(let i=3;i<flashes.length;i++) check(flashes[i].at-flashes[i-3].at>=1000,'At most three flashes per second');
    }
    if(document.interop?.length) check(document.keyframes?.playback==='persistent','Countdown control requires a persistent presentation phase source');
    if(document.keyframes) validateKeyframes(document);
    for(const {alias} of performanceReferences(document,null)) check(alias==='self'||Object.hasOwn(document.packs,alias),'Undeclared performance pack alias: '+alias);
    return document;
}
// These authoring checks run at ingress, never in the frame sampler or projection.
function validateKeyframes(document) {
    const value=document.keyframes,layers=new Map();
    const bounds={x:[-16000,16000],y:[-16000,16000],scaleX:[-100,100],scaleY:[-100,100],rotation:[-36000,36000],alpha:[0,1],red:[0,1],green:[0,1],blue:[0,1],threshold:[0,1],gain:[0,8]};
    const has=(object,key)=>Object.hasOwn(object,key);
    check(value.playback==='persistent' ? !!value.exit : !value.exit,'Persistent keyframes require exit; once keyframes cannot have exit');
    if(value.playback==='once') {
        check(!document.theme && !document.bgm && !document.timeline.idle && !document.timeline.turn,'Once keyframes cannot hold theme, music, idle or turn state');
        check(document.timeline.exit.events.length===0 && document.timeline.entry.events.every(event=>['sfx','flash','shake'].includes(event.do)),'Once keyframes only allow entry SFX, flash and shake');
    }
    for(const layer of value.layers) {
        check(!layers.has(layer.id),'Duplicate keyframe layer: '+layer.id);layers.set(layer.id,layer);
        check(['image','particles'].includes(layer.kind)===has(layer,'image') && (layer.kind==='text')===has(layer,'text') && (layer.kind==='particles')===has(layer,'particles'),'Keyframe layer source differs from kind: '+layer.id);
        check(!has(layer,'threshold') || layer.dissolve,'Threshold requires a dissolve texture: '+layer.id);
        check(!has(layer,'gain') || layer.glow,'Gain requires a glow layer: '+layer.id);
        if(layer.glow) check(layer.blend==='add' && ['image','solid','particles'].includes(layer.kind),'Glow layer must be an additive image, solid or particle layer: '+layer.id);
        if(layer.particles) {
            const p=layer.particles,ordered=(range,min,max)=>!range || range[0]<=range[1] && range[0]>=min && range[1]<=max;
            check(!layer.mask && !layer.maskOnly && !layer.dissolve,'Particle layers cannot mask or dissolve: '+layer.id);
            check(ordered(p.lifeMs,1,20000) && ordered(p.size,0,4096) && ordered(p.emitMs,0,20000) && ordered(p.speed,-20000,20000) && ordered(p.rotation,-3600,3600) && ordered(p.spin,-3600,3600),'Particle range out of order or bounds: '+layer.id);
            check(!p.rate || p.emitMs,'Particle rate requires an emission window: '+layer.id);
            const emitted=(p.rate || 0)*(p.emitMs ? p.emitMs[1]-p.emitMs[0] : 0)/1000+(p.bursts || []).reduce((sum,burst)=>sum+burst.count,0);
            check(emitted>=1 && emitted<=4096,'Particle layer must emit 1..4096 particles: '+layer.id);
            for(const curve of [p.sizeOverLife,p.alphaOverLife,p.colorOverLife]) if(curve) check(curve.every((key,i)=>!i || key.t>curve[i-1].t),'Particle curve times must increase: '+layer.id);
            check(!p.alphaOverLife || p.alphaOverLife.every(key=>key.value<=1),'Particle alpha must be within 0..1: '+layer.id);
        }
        if(layer.maskOnly) check(layer.kind==='image' && !layer.mask && !layer.dissolve && !layer.flash,'Mask-only layer must be an unmasked image: '+layer.id);
        if(layer.text) check(!/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(layer.text.value),'Text contains control characters: '+layer.id);
    }
    for(const layer of value.layers) if(layer.mask) {
        const mask=layers.get(layer.mask);
        check(mask?.maskOnly===true && mask.id!==layer.id && (mask.placement || 'below-dialogue')===(layer.placement || 'below-dialogue'),'Mask must reference a mask-only layer in the same placement: '+layer.id);
    }
    let keyCount=0;
    for(const name of ['entry','exit']) {
        const phase=value[name];if(!phase)continue;
        const tracks=new Set();
        for(const track of phase.tracks) {
            const layer=layers.get(track.layer),identity=track.layer+':'+track.property;
            check(layer && !tracks.has(identity),'Unknown layer or duplicate keyframe track: '+identity);tracks.add(identity);
            check(track.property!=='threshold' || layer.dissolve,'Threshold track requires a dissolve texture: '+identity);
            check(track.property!=='gain' || layer.glow,'Gain track requires a glow layer: '+identity);
            let at=-1;
            const [min,max]=bounds[track.property];
            for(const key of track.keys) {
                check(key.at>at && key.at<=phase.durationMs,'Keyframe times must increase within phase duration: '+identity);at=key.at;
                check(key.value>=min && key.value<=max,'Keyframe value outside property range: '+identity);
                if(Array.isArray(key.ease)) check(key.ease[0]>=0 && key.ease[0]<=1 && key.ease[2]>=0 && key.ease[2]<=1,'Bezier x controls must be within 0..1: '+identity);
                keyCount++;
            }
        }
        for(const event of document.timeline[name].events) check(event.at+(['flash','shake'].includes(event.do)?event.ms:0)<=phase.durationMs,'Timeline event exceeds keyframe phase duration: '+name);
    }
    check(keyCount<=8192,'Keyframe document exceeds 8192 keys');
}
function performanceKeyframeFiles(document) {
    return [...new Set((document.keyframes?.layers || []).flatMap(layer=>[layer.image,layer.dissolve?.image].filter(Boolean)))];
}
function performanceReferences(document,ownerPackId) {
    const rows=[],kinds={skin:'skins',sfx:'sfx',bgm:'music',look:'looks',ambience:'ambience',widget:'widgets'};
    function add(value,kind) {
        const reference=typeof value==='string'?value:value.ref,[alias,assetId]=reference.split(':');
        if(kind==='skins' && alias==='self' && assetId===document.theme?.id) return;
        rows.push({alias,ref:{packId:alias==='self'?ownerPackId:document.packs[alias],kind,assetId}});
    }
    if(document.bgm)add(document.bgm,'music');
    for(const value of Object.values(document.sfxMap||{}))add(value,'sfx');
    for(const block of Object.values(document.timeline))for(const event of block.events)if(event.ref)add(event,kinds[event.do]);
    return rows;
}
// an explicit migrated alias is only used to resolve old normalized skin refs.
function performanceThemeOwner(pack,skinId,{historical=false}={}) {
    return Object.values(pack?.performances || {}).find(document=>document.theme?.id===skinId && (!historical || document.legacySkinId===skinId));
}
function performanceSkinDocument(pack,skinId) {return pack?.skins?.[skinId] || performanceThemeOwner(pack,skinId)?.theme;}
if(typeof module!=='undefined'&&typeof window === 'undefined'&&module.exports)module.exports={validateStagePerformance,performanceReferences,performanceThemeOwner,performanceSkinDocument,performanceKeyframeFiles};
