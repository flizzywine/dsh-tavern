'use strict';
// outlines are supplied by the private content pack, never generated as text art.
function createDecorativeScript(data, {Path = globalThis.Path2D, normalize = text => String(text), punctuation = '.,!?-\u0027:\u2026'} = {}) {
    if (data?.meta?.em !== 1000 || data.meta.fillRule !== 'evenodd' || !data.glyphs || Object.keys(data.glyphs).length > 256 || JSON.stringify(data).length > 1024*1024) throw new Error('Invalid decorative glyph set');
    const glyphs = new Map();
    for (const [char,glyph] of Object.entries(data.glyphs)) {
        if ([...char].length !== 1 || typeof glyph.d !== 'string' || glyph.d.length > 131072 || !/^M[-0-9 .MLZ]+$/.test(glyph.d) || !['w','h','adv'].every(key => Number.isFinite(glyph[key]) && glyph[key] >= 0 && glyph[key] <= 10000)) throw new Error('Invalid decorative glyph');
        glyphs.set(char,{...glyph,path:new Path(glyph.d)});
    }
    function layout(text, size, {tracking = 0.06,space = 0.42} = {}) {
        const items=[],dropped=new Set(),track=tracking*size,scale=size/data.meta.em;
        let x=0;
        for (const char of normalize(text)) {
            if (char === ' ') {x += size*space;continue;}
            const glyph=glyphs.get(char);
            if (glyph) {items.push({char,glyph,x});x += glyph.adv*scale+track;}
            else if (punctuation.includes(char)) {items.push({char,x});x += size*0.32+track;}
            else dropped.add(char);
        }
        return {items,width:Math.max(0,x-track),dropped:[...dropped]};
    }
    function random(index,step) {let n=Math.imul(index+1,374761393)+Math.imul(step,668265263);n=Math.imul(n^n>>>13,1274126177);return ((n^n>>>16)>>>0)/4294967296;}
    return {layout,measure:(text,size,options)=>layout(text,size,options).width,
        draw(ctx,text,x,y,{size=32,color='#111111',align='left',jitter=0,step=0,...options}={}) {
            const result=layout(text,size,options),scale=size/data.meta.em,origin=align === 'center' ? x-result.width/2 : x;
            ctx.save();ctx.fillStyle=color;
            result.items.forEach((item,index)=>{
                const dx=(random(index,step)-0.5)*2*jitter,dy=(random(index+101,step)-0.5)*2*jitter;
                if (!item.glyph) {ctx.font=`700 ${size*0.9}px Georgia,serif`;ctx.fillText(item.char,origin+item.x+dx,y+dy);return;}
                ctx.save();ctx.translate(origin+item.x+dx,y+dy);ctx.scale(scale,scale);ctx.fill(item.glyph.path,'evenodd');ctx.restore();
            });ctx.restore();return result;
        }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createDecorativeScript};
