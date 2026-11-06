function createStageSkinFrame({React,clock:forkForeground,Shape:StageSkinShape}) {
let disposed=false;
const releases=new Set();
function own(setup) {
    if(disposed)return ()=>{};
    let live=true;const cleanup=[];
    const release=()=>{if(!live)return;live=false;releases.delete(release);const errors=[];for(const fn of cleanup.reverse()){try{fn();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Skin decoration cleanup failed');};
    releases.add(release);
    try{setup(fn=>cleanup.push(fn),()=>live&&!disposed);}catch(error){try{release();}catch(other){throw new AggregateError([error,other],'Skin decoration setup failed');}throw error;}
    return release;
}
function dispose(){if(disposed)return;disposed=true;const errors=[];for(const release of [...releases]){try{release();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Skin decoration disposal failed');}
function stageSkinBand(b,side) {
    const c=b.colors,h=b.height||14,top=side==='top',style={left:b.inset??24,right:b.inset??24,[side]:b.offset??9,height:h};
    const paints={
        staff:`repeating-linear-gradient(${c[0]} 0 1px,transparent 1px ${Math.max(3,h/4|0)}px)`,
        rule:`linear-gradient(${c[0]},${c[0]})`,
        dots:`radial-gradient(circle,${c[0]} 0 ${h/4}px,transparent ${h/4+.5}px) 0 0/${h*1.4}px ${h}px repeat-x`,
        stripes:`repeating-linear-gradient(45deg,${c[0]} 0 8px,${c[1]||'transparent'} 8px 16px)`,
        teeth:`conic-gradient(from ${top?135:-45}deg at 50% ${top?0:100}%,${c[0]} 90deg,transparent 0) 0 0/${h*1.5}px ${h}px repeat-x`,
        scanlines:`repeating-linear-gradient(${c[0]} 0 2px,transparent 2px 5px)`,
        fence:`conic-gradient(from 150deg at 50% 0,${c[0]} 60deg,transparent 0) 0 0/${h}px ${h*.7}px repeat-x,linear-gradient(${c[0]},${c[0]}) 0 100%/100% 2px no-repeat`,
        stained:`repeating-linear-gradient(90deg,${c.map((color,i)=>`${color} ${i*34}px ${i*34+30}px,#000000 ${i*34+30}px ${i*34+34}px`).join(',')})`,
        lace:`radial-gradient(circle at 50% ${top?0:100}%,${c[0]} 0 ${h*.55}px,transparent ${h*.55+.5}px) 0 0/${h*1.2}px ${h}px repeat-x`,
        checker:`conic-gradient(${c[0]} 25%,${c[1]||'transparent'} 0 50%,${c[0]} 0 75%,${c[1]||'transparent'} 0) 0 0/${h}px ${h}px`,
        chain:`radial-gradient(circle,transparent 0 ${h*.22}px,${c[0]} ${h*.22}px ${h*.38}px,transparent ${h*.38+.5}px) 0 0/${h*.9}px ${h}px repeat-x`
    };
    style.background=paints[b.pattern];
    if(b.pattern==='rule'){style.height=1;style.boxShadow=`0 ${top?4:-4}px 0 ${c[1]||c[0]}`;}
    return style;
}
// art.textbox.readout (N2): a local clock printed on the box image - its label, then HH:MM:SS, updated every
// second (placed and styled by theme.css «art readout»). Pure text: hidden from assistive technology with the frame.
function stageSkinClock(date) { return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); }
function StageSkinReadout({readout}) {
    const [now, setNow] = React.useState(() => stageSkinClock(new Date()));
    React.useEffect(() => own((add,live) => {
        let timer = 0;
        const tick = () => { if(!live())return; setNow(stageSkinClock(new Date())); timer = forkForeground.setTimeout(tick, 1000 - Date.now() % 1000 + 5); };
        timer = forkForeground.setTimeout(tick, 1000 - Date.now() % 1000 + 5);
        add(()=>forkForeground.clearTimeout(timer));
    }), []);
    return React.createElement('b', {className: 'fork-skin-readout'}, (readout.label ? readout.label + '  ' : '') + now);
}
function StageSkinFrame({skin, page = '', narration = false}) {
    // A skin with art.shape draws its box as that SVG (shown on wide stages, theme.css「stage skin: art」); elsewhere the
    // same span keeps the layout's own CSS frame (P5's slash polygons on phones) and the SVG stays hidden.
    if (skin.art?.shape && page) return React.createElement(StageSkinShape, {shape: skin.art.shape, page, narration});
    const h=React.createElement,frame=skin.textbox.frame||{},corner=frame.corners,readout=skin.art?.textbox?.readout;
    const drawings={diamond:['M2 28V8Q2 2 8 2H28','M15 6l5 5-5 5-5-5z'],rivet:['M2 28V2H28','M15 11a4 4 0 1 0-8 0a4 4 0 1 0 8 0'],bow:['M15 15C3 3 3 21 15 15C27 3 27 21 15 15','M18 15a3 3 0 1 0-6 0a3 3 0 1 0 6 0'],bracket:['M3 27V3H27','M9 21V9H21'],
        // a fine filigree curl in two opposite corners only (top-right, bottom-left).
        flourish:['M4 26C4 13 10 5 24 4M9 17c0-5 4-8 8-6c3 2 1 6-2 5c-2-1-1-3 1-3','M24 2.5c3-1.5 6-.5 7 1.5c-3 1-5 1-7-1.5zM2.5 26c-1.5 3-.5 5.5 1.5 6c1-3 .5-5-1.5-6z']};
    const at=corner?.kind==='flourish'?['tr','bl']:['tl','tr','br','bl'], fine=corner?.kind==='flourish';
    return h('span',{className:'fork-skin-frame','aria-hidden':true},
        readout?h(StageSkinReadout,{key:'readout',readout}):null,
        ['top','bottom'].map(side=>frame[side]?h('i',{key:side,'data-band':side,style:stageSkinBand(frame[side],side)}):null),
        drawings[corner?.kind]?at.map(position=>h('svg',{key:position,className:'fork-skin-corner '+position,'data-corner':corner.kind,viewBox:'0 0 32 32',style:{rotate:['tl','tr','br','bl'].indexOf(position)*90+'deg'},fill:'none'},
            h('path',{d:drawings[corner.kind][0],stroke:corner.colors?.[0]||skin.textbox.paint.border||skin.textbox.paint.fg,strokeWidth:fine?1.6:3,strokeLinecap:fine?'round':undefined}),
            h('path',{d:drawings[corner.kind][1],fill:corner.colors?.[1]||skin.textbox.paint.accent||skin.textbox.paint.fg,stroke:corner.colors?.[0]||skin.textbox.paint.fg,strokeWidth:fine?.6:1.5}))):null);
}
return {Frame:StageSkinFrame, Readout:StageSkinReadout, band:stageSkinBand, dispose};
}
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={createStageSkinFrame};
