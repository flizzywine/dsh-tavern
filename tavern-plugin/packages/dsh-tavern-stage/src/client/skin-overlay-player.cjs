'use strict';
const skinOverlayPlayerMotion = typeof module !== 'undefined' && typeof window === 'undefined' ? require('./skin-overlay-phase.cjs') : null;
const skinOverlayPlayerGeometry = typeof module !== 'undefined' && typeof window === 'undefined' ? require('./skin-overlay-motion.cjs') : null;
const skinOverlayPlayerTiming = typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../lib/client/skin-overlay-timing.cjs') : null;
// the skin resource owner supplies decoded content handles, not network/lease URLs.
function createSkinOverlayPlayer({definition, intensity = 2, textures, script, rects, foreground, owner, under, over, reducedMotion = false, calm = false, snap = false, changed = () => {}, onCue = () => {}, onSkinSwap = () => {}, onError = () => {}}) {
    const make = skinOverlayPlayerMotion?.createPhasedSkinOverlayMotion || createPhasedSkinOverlayMotion;
    // calm: the OS reduced-motion preference softens (slower stepping; shake/strobe are dropped by the layer).
    // reducedMotion: the explicit in-app CONFIG choice, the only mode that freezes the collage.
    const tempo=() => calm ? 0.6 : 1;
    let motion = make({id:definition.id,pieces:definition.pieces,intensity,reducedMotion,snap,tempo:tempo()});
    const sizes = Object.fromEntries(Object.entries(textures).map(([id,images]) => [id,{w:images[0].width,h:images[0].height}]));
    let start = foreground.now(), phase='entry', cueOrdinal=0, cueSent=false, swapSent=false;
    const contexts = [under.getContext('2d'),over.getContext('2d')];
    const timing=() => (skinOverlayPlayerTiming?.skinOverlayTiming || skinOverlayTiming)(definition,phase);
    function texture(context,image,x,y,w,h) {
        if (!image) return;
        if (image.image) {const f=image.frame;context.drawImage(image.image,f.x,f.y,f.w,f.h,x,y,w,h);}
        else context.drawImage(image,x,y,w,h);
    }
    function fill(context,value,x,y,w,h) {
        const [kind,a,b]=String(value || '#111111').split(':');
        if (!a) {context.fillStyle=kind;context.fillRect(x,y,w,h);return;}
        context.save();context.beginPath();context.rect(x,y,w,h);context.clip();
        if(kind!=='halftone') {context.fillStyle=a;context.fillRect(x,y,w,h);}
        context.fillStyle=kind==='halftone' ? a : b;
        const size=kind==='checker' ? 24 : kind==='dots' ? 34 : 10;
        if(kind==='stripes') {
            context.strokeStyle=b;context.lineWidth=10;
            for(let col=x-h;col<x+w;col+=20) {context.beginPath();context.moveTo(col,y);context.lineTo(col+h,y+h);context.stroke();}
        } else for(let row=Math.floor(y/size);row<(y+h)/size;row++) for(let col=Math.floor(x/size);col<(x+w)/size;col++) {
            if(kind==='checker') {if((row+col)%2===0)context.fillRect(col*size,row*size,size,size);}
            else if(kind==='dots') {
                context.beginPath();context.arc(col*size+8,row*size+8,5.5,0,Math.PI*2);context.fill();
                context.beginPath();context.arc(col*size+25,row*size+25,5.5,0,Math.PI*2);context.fill();
            } else {context.beginPath();context.arc(col*size+5,row*size+5,1.6,0,Math.PI*2);context.fill();}
        }
        context.restore();
    }
    function noise(seed,i) {const n=Math.sin(seed*127.1+i*311.7)*43758.5453;return n-Math.floor(n);}
    function torn(context,r,jag,seed,step) {
        const per=2*(r.w+r.h),count=Math.max(12,Math.round(per/16));context.beginPath();
        for(let i=0;i<count;i++) {
            const d=i/count*per,o=(noise(seed+step*7,i)-.3)*jag;let x,y;
            if(d<r.w){x=r.x+d;y=r.y-o;}
            else if(d<r.w+r.h){x=r.x+r.w+o;y=r.y+d-r.w;}
            else if(d<2*r.w+r.h){x=r.x+r.w-(d-r.w-r.h);y=r.y+r.h+o;}
            else {x=r.x-o;y=r.y+r.h-(d-2*r.w-r.h);}
            if(i)context.lineTo(x,y);else context.moveTo(x,y);
        }
        context.closePath();
    }
    function paper(time,geometry) {
        const context=contexts[0],unit=height/900,cue=definition.cues?.[phase] || {};
        const paperAt=phase==='entry' ? cue.paperAt ?? cue.ritual?.revealAt ?? 0 : 0;
        if(!snap && phase==='entry' && time<paperAt)return;
        const spec=(intensity>=3 && phase!=='entry' && (snap || time >= (definition.cues?.turn?.paperAt || 0)) ? definition.cues?.turn?.paper : null) || definition.paper;
        if(!spec)return;
        const k=Math.floor(time*(spec.fps || 7)/1000),boil=reducedMotion ? 0 : Math.floor(k*tempo()/(spec.boilEvery || 2))%3;
        const e=snap || reducedMotion || phase==='idle' || phase==='turn' ? 1 : phase==='exit' ? Math.max(0,1-(k+1)/3) : Math.min(1,(Math.floor((time-paperAt)*(spec.fps || 7)/1000)+1)/3);
        if(e<=0)return;
        context.save();context.scale(unit,unit);const W=width/unit,H=900;
        const sheet=(r,jag,seed,color,halftone)=>{context.save();torn(context,r,jag,seed,boil);context.clip();fill(context,color,r.x-jag,r.y-jag,r.w+jag*2,r.h+jag*2);if(halftone)fill(context,'halftone:rgba(10,20,40,.3)',r.x-jag,r.y-jag,r.w+jag*2,r.h+jag*2);context.restore();};
        for(const b of spec.bands || []) {
            const size=b.size*(intensity===1?.6:1),r=b.side==='top'?{x:-20,y:-20-80*(1-e),w:W+40,h:size}:b.side==='left'?{x:-20-120*(1-e),y:-20,w:size,h:H+40}:b.side==='right'?{x:W+20-size+120*(1-e),y:-20,w:size,h:H+40}:{x:-20,y:H+20-size+80*(1-e),w:W+40,h:size};
            sheet(r,b.jag ?? 14,b.seed || 11,b.fill,b.halftone!==false);
        }
        if(geometry.box && spec.mat) {
            const B=geometry.box,[po,pi]=spec.mat.pad || [26,14],g=pi*e;
            sheet({x:B.x/unit-po*e,y:B.y/unit-(po+4)*e,w:B.w/unit+2*po*e,h:B.h/unit+60},16,21,spec.mat.outer,false);
            sheet({x:B.x/unit-g,y:B.y/unit-g,w:B.w/unit+2*g,h:B.h/unit+40},10,22,spec.mat.inner,false);
        }
        context.restore();
    }
    function cover(context,ritual,time,final) {
        const cv=ritual.cover;fill(context,cv.fill,0,0,1600,900);
        if(cv.halftone)fill(context,'halftone:rgba(10,20,40,.3)',0,0,1600,900);
        for(const item of cv.items || []) {
            const at=item.at || 0;if(!final && time<at || item.until!==undefined && (final || time>=item.until))continue;
            const frame=(item.swap || []).filter(change=>final || time>=change.at).at(-1)?.frame || item.frame,image=textures[frame]?.[0];
            const k=final?99:Math.floor((time-at)/125),n=item.steps || 1,f=Math.min(1,(k+1)/n);
            const dx=item.from==='left'?-1700*(1-f):item.from==='right'?1700*(1-f):0,dy=item.from==='top'?-1000*(1-f):item.from==='bottom'?1000*(1-f):0;
            const scale=item.from==='pop' && k+1<n ? [.4,1.18,1][Math.min(2,k)] : 1;
            context.save();context.translate(item.x+dx,item.y+dy);context.rotate((item.rot || 0)*Math.PI/180);context.scale(scale,scale);
            if(item.runes && script)script.draw(context,item.runes,0,(item.size || 48)*.42,{size:item.size || 48,align:'center',color:item.color || '#111111',tracking:.1});
            else if(image) {const h=item.h || image.height,w=item.w || h*image.width/image.height;texture(context,image,-w/2,-h/2,w,h);}
            context.restore();
        }
    }
    function nameTag(time,geometry) {
        const tag=definition.nameTag,text=tag?.names?.[geometry.nameText];
        if(!script || !text || !geometry.name || phase==='exit' || !snap && phase==='entry' && time<(definition.cues?.entry?.ritual?.revealAt || 0))return;
        const unit=height/900,size=tag.size || 16,w=script.measure(text,size)+size,h=size*1.8;
        const pose={x:geometry.name.x+14*unit,y:geometry.name.y-h*unit+12*unit,rot:-2.5,s:1,sx:1,sy:1};
        if(!(skinOverlayPlayerGeometry?.skinOverlayPoseSafe || skinOverlayPoseSafe)(pose,{w:w*unit,h:h*unit},[0,0],geometry))return;
        const context=contexts[1],colors=intensity>=3 && phase!=='entry' ? {...tag,...tag.turn} : tag;
        context.save();context.translate(pose.x,pose.y);context.rotate(pose.rot*Math.PI/180);context.scale(unit,unit);
        context.save();torn(context,{x:0,y:0,w,h},2,41,reducedMotion ? 0 : Math.floor(time*tempo()/280)%3);context.clip();fill(context,colors.paper || '#efe4cc',-4,-4,w+8,h+8);context.restore();
        script.draw(context,text,size/2,size*1.2,{size,color:colors.ink || '#1a1410',tracking:.12});context.restore();
    }
    // Draw each transformed sheet directly from borrowed textures: no unbudgeted cover canvas.
    function ritual(time) {
        const r=definition.cues?.[phase]?.ritual;
        if(!r?.cover || snap || reducedMotion)return;
        const RV=r.revealAt || 0,N=r.reveal.steps || 5;if(time>=RV+125*N)return;
        const context=contexts[1],rv=r.reveal;context.save();context.scale(width/1600,height/900);
        if(time<RV) {
            const f=Math.min(1,(Math.floor(time/125)+1)/(r.cover.inSteps || 2));
            context.translate(0,r.cover.in==='bottom'?900*(1-f):r.cover.in==='pop'?0:-900*(1-f));cover(context,r,time,false);context.restore();return;
        }
        const f=Math.min(1,(Math.floor((time-RV)/125)+1)/N),ff=f*f;
        const half=(points,dx,dy,rot)=>{context.save();context.translate(dx,dy);context.rotate(rot*Math.PI/180);context.beginPath();points.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y));context.closePath();context.save();context.clip();cover(context,r,time,true);context.restore();if(rv.edge!=='smooth'){context.lineWidth=6;context.strokeStyle=rv.ring || '#fffaf0';context.stroke();}context.restore();};
        if(rv.kind==='tear' || rv.kind==='split-v') {
            const line=Array.from({length:41},(_,i)=>[i*40,(rv.y ?? (rv.kind==='tear'?470:450))+(rv.kind==='tear' && rv.edge!=='smooth' ? (noise(77,i)-.5)*(rv.amp ?? 70)+(i%2?1:-1)*(rv.amp ?? 70)/5:0)]);
            half([[-40,-40],[1640,-40],...line.slice().reverse()],0,-620*ff,-6*f);half([[-40,940],[1640,940],...line.slice().reverse()],0,560*ff,3.6*f);
        } else if(rv.kind==='split-h') {
            const line=Array.from({length:25},(_,i)=>[800+(rv.edge==='smooth'?0:(noise(31,i)-.5)*(rv.amp ?? 50)),i*37.5]);
            half([[-40,-40],...line,[-40,940]],-900*ff,0,0);half([[1640,-40],...line,[1640,940]],900*ff,0,0);
        } else if(rv.kind==='quarters') {
            for(const [x,y,dx,dy] of [[0,0,-1,-1],[800,0,1,-1],[0,450,-1,1],[800,450,1,1]]) {
                context.save();context.translate(x+400+dx*900*ff*.9,y+225+dy*900*ff*.7+900*ff*.4);context.rotate(dx*dy*f*.35);context.translate(-x-400,-y-225);context.beginPath();context.rect(x,y,800,450);context.clip();cover(context,r,time,true);context.restore();
            }
        } else if(rv.kind==='iris') {
            context.save();context.beginPath();context.rect(0,0,1600,900);context.arc(800,400,1000*ff,0,Math.PI*2,true);context.clip('evenodd');cover(context,r,time,true);context.restore();
            if(rv.ring){context.lineWidth=10;context.strokeStyle=rv.ring;context.beginPath();context.arc(800,400,1000*ff,0,Math.PI*2);context.stroke();}
        } else if(rv.kind==='scanline') {
            const a=Math.min(1,f*2),b=Math.max(0,f*2-1),h=Math.max(2,900*(1-a)),w=1600*(1-b);
            if(w>1){context.save();context.translate(800-w/2,450-h/2);context.scale(w/1600,h/900);cover(context,r,time,true);context.restore();if(a>=1){context.fillStyle=rv.ring || '#ffffff';context.fillRect(800-w/2,448,w,4);}}
        } else if(rv.kind==='fall-up') {context.translate(800,450-1100*ff);context.rotate(-8*f*Math.PI/180);context.translate(-800,-450);cover(context,r,time,true);}
        context.restore();
    }
    let frame = null, disposed = false, exiting = false, ended = false, allocation = null, width = 0, height = 0, last = '', dirty = true, nextPaint = 0;
    function paint() {
        frame = null; if (disposed) return;
        // Independent piece clocks can change on every high-refresh vsync. Sample at most
        // 60 times/s, keeping elapsed presentation time (no slowed steps or catch-up burst).
        const now = foreground.now(), interval = 1000 / 60;
        if (!dirty && now + 0.5 < nextPaint) {frame=foreground.requestAnimationFrame(paint);return;}
        nextPaint = now > nextPaint + interval ? now + interval : nextPaint + interval;
        const geometry = rects.getSnapshot();
        if (geometry.screen.w > 0 && geometry.screen.h > 0) {
            const w = Math.ceil(geometry.screen.w), h = Math.ceil(geometry.screen.h);
            if (w !== width || h !== height) {
                // Reserve replacement before releasing old surfaces; no unaccounted resize peak.
                let next;
                try {next = owner.reserveBytes(w*h*4*2);} catch (error) {onError(error);return;}
                for (const canvas of [under,over]) {canvas.width=w;canvas.height=h;}
                allocation?.release(); allocation=next; width=w; height=h; dirty=true;
            }
            const poses=motion.sample(foreground.now()-start,geometry,sizes);
            if (exiting && !poses.length && foreground.now()-start>=timing().durationMs) ended = true;
            const key=geometry.revision + ':' + (definition.paper || definition.cues?.[phase]?.ritual ? Math.min(timing().durationMs,Math.floor((foreground.now()-start)/125)*125) : '') + ':' + poses.map(({piece:p,pose:v}) => [p.id,v.k,v.x,v.y,v.rot,v.s,v.sx,v.sy,v.alpha,v.frame,v.variant].join(',')).join(';');
            if (dirty || key !== last) {
                last=key; dirty=false;
                for (const context of contexts) context.clearRect(0,0,width,height);
                paper(foreground.now()-start,geometry);
                for (const {piece,pose,w,h} of poses) {
                    const context=contexts[piece.layer === 'over' || piece.layer === 'front' ? 1 : 0];
                    const images=textures[piece.frames ? piece.frames[pose.frame] : piece.img], image=images[pose.variant] || images[0], pivot=piece.pivot || [0.5,0.5];
                    context.save(); context.globalAlpha=pose.alpha; context.translate(pose.x,pose.y); context.rotate(pose.rot*Math.PI/180); context.scale(pose.s*pose.sx,pose.s*pose.sy);
                    texture(context,image,-w*pivot[0],-h*pivot[1],w,h); context.restore();
                }
                nameTag(foreground.now()-start,geometry);
                ritual(foreground.now()-start);
                changed({poses,geometry,time:foreground.now()-start});
            }
        }
        const elapsed=foreground.now()-start, finite=timing();
        if (!snap && !reducedMotion) {
            if (!swapSent && finite.skinSwapAt !== null && elapsed>=finite.skinSwapAt) {swapSent=true;onSkinSwap();}
            if (!cueSent && finite.cues[0] && elapsed>=finite.cues[0].at) {cueSent=true;onCue({...finite.cues[0],ordinal:[cueOrdinal,'cue',0],atMs:finite.cues[0].at});}
        }
        // History/seek snaps keep looping: idle stepping is sustained state, only one-shots are skipped.
        if (!disposed && !ended && !reducedMotion) frame=foreground.requestAnimationFrame(paint);
    }
    function invalidate() {dirty=true;if (frame === null && !disposed && !ended) frame=foreground.requestAnimationFrame(paint);}
    const off=rects.subscribe(invalidate);
    invalidate();
    return {setSafety({reducedMotion:next,calm:soft=calm}) {
            if(reducedMotion===!!next && calm===!!soft)return;
            reducedMotion=!!next;calm=!!soft;cueSent=swapSent=true;
            motion=make({id:definition.id,pieces:definition.pieces,intensity,reducedMotion,snap,tempo:tempo()});
            motion.setPhase({phase:'idle',level:intensity,snap:reducedMotion || snap});invalidate();
        },setPhase({phase:next,level=intensity,elapsedMs=0,snap:seek=false,ordinal=0}) {
            phase=next;intensity=level;snap=seek;cueOrdinal=ordinal;cueSent=swapSent=false;start=foreground.now()-elapsedMs;
            exiting=next==='exit';ended=false;motion.setPhase({phase:next,level,snap});invalidate();
        },turn() {this.setPhase({phase:'turn',level:3});},exit() {this.setPhase({phase:'exit'});},
        dispose() {if (disposed) return;disposed=true;off();if (frame !== null) foreground.cancelAnimationFrame(frame);for (const context of contexts) context.clearRect(0,0,width,height);for (const canvas of [under,over]) canvas.width=canvas.height=0;allocation?.release();}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createSkinOverlayPlayer};
