// Figures lit by the background (route A of the art-style plan): each background picture is measured once (a small
// linear-light grid, cached on its texture); the light at a stage x is derived from it (surrounding colour, the brighter
// side, the key light's colour and strength) and one filter on the figure's container shades the composed figure with
// it, so mouth and blink frames are lit with it. Light from above the brighter side: a smooth wash across the figure
// plus a rim on its lit edge, no hard terminator (the outward normals are scaled by one constant and fade to zero inside).
function createStageFigureLight({document}) {
let disposed=false;const filters=new Set();
const LUMA=[0.2126,0.7152,0.0722], GRID_W=64, SAMPLES=11, STRIDE=12, SPRITE_LUMA=0.45;
const IDENTITY=[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0];
const lin=v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);
const enc=v=>v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;
const luma=(r,g,b)=>LUMA[0]*r+LUMA[1]*g+LUMA[2]*b;
const clip=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const grids=new WeakMap(),fields=new WeakMap();

// The picture's colours on a GRID_W-wide grid (sRGB 0..1). Videos and unreadable pictures measure as null: their figures
// keep the time grade.
function measure(texture) {
    const base=texture?.baseTexture;
    if(!base)return null;
    if(grids.has(base))return grids.get(base);
    const source=base.resource?.source,width=base.realWidth,height=base.realHeight;
    let grid=null;
    if(source&&source.tagName!=='VIDEO'&&width>0&&height>0){
        const w=GRID_W,h=Math.max(4,Math.round(GRID_W*height/width)),canvas=document.createElement('canvas');
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(source,0,0,w,h);
        try{
            const data=ctx.getImageData(0,0,w,h).data,rgb=new Float32Array(w*h*3);
            for(let i=0;i<w*h;i++){rgb[i*3]=data[i*4]/255;rgb[i*3+1]=data[i*4+1]/255;rgb[i*3+2]=data[i*4+2]/255;}
            grid={w,h,rgb};
        }catch(error){console.warn('[fork-gal-light] background not readable',error);}
    }
    grids.set(base,grid);return grid;
}
// One sample per stage x: [ambient rgb, key rgb, rim rgb, direction x, direction y, strength], ready for the shader.
function lightAt(cells,lum,w,h,x) {
    const col=c=>clip(c,0,w);
    const x0=col(Math.floor((x-0.2)*w)),x1=Math.max(x0+1,col(Math.ceil((x+0.2)*w)));
    const ambient=[0,0,0];let n=0;
    // colours are averaged as seen (sRGB), so a few bright lamps do not outweigh the scene around them (a moonlit
    // shrine reads blue, not the colour of its lit windows); the result is linear light again
    for(let y=0;y<h;y++)for(let c=x0;c<x1;c++){const i=(y*w+c)*3;for(let k=0;k<3;k++)ambient[k]+=enc(cells[i+k]);n++;}
    for(let k=0;k<3;k++)ambient[k]=lin(ambient[k]/n);
    const ambL=luma(...ambient),upper=Math.max(1,Math.floor(h*2/3)),mid=clip(Math.round(x*w),1,w-1);
    const mean=(a,b)=>{let s=0;for(let y=0;y<upper;y++)for(let c=a;c<b;c++)s+=lum[y*w+c];return s/((b-a)*upper);};
    const lb=mean(0,mid),rb=mean(mid,w),right=rb>=lb;
    let dx=clip((rb-lb)/(rb+lb+1e-6)*3,-1,1),dy=-0.6;const len=Math.hypot(dx,dy)+1e-6;dx/=len;dy/=len;
    // the key light: the bright end (85th-97th percentile) of the brighter side's upper part
    const side=[];
    for(let y=0;y<upper;y++)for(let c=right?mid:0;c<(right?w:mid);c++)side.push(y*w+c);
    const sorted=side.map(i=>lum[i]).sort((a,b)=>a-b),q=p=>sorted[Math.min(sorted.length-1,Math.floor(p*(sorted.length-1)))];
    const lo=q(0.85),hi=q(0.97),key=[0,0,0];let m=0;
    for(const i of side)if(lum[i]>=lo&&lum[i]<=hi){for(let k=0;k<3;k++)key[k]+=enc(cells[i*3+k]);m++;}
    for(let k=0;k<3;k++)key[k]=lin(key[k]/m);
    const keyL=luma(...key),ratio=clip(keyL/(ambL+1e-6),1,12);
    // a light's colour at unit brightness; a saturated scene (red lanterns) tints, it does not burn one channel out
    // (a scene's colour reads stronger than its average: the colour is pushed out 1.3 times, up to a channel 1.7 times the light)
    const hue=(c,l)=>{const h=c.map(v=>v/(l+1e-6)),top=Math.max(...h),k=Math.min(1.3,top>1?0.7/(top-1):1.3);return h.map(v=>Math.pow(1+(v-1)*k,0.9));};
    // exposure: partly matched to the scene, the figure stays readable; a bright neutral scene leaves it as drawn
    const exposure=clip(Math.pow(ambL/SPRITE_LUMA,0.7)*1.5,0.25,1.05),strength=clip((0.45-ambL)/0.25,0.15,1);
    const ah=hue(ambient,ambL),kh=hue(key,keyL),kr=key.map(v=>v/(keyL+1e-6));
    return [...ah.map(v=>exposure*0.55*v),...kh.map(v=>exposure*v*(0.5+0.06*Math.min(ratio,6))),
        ...kr.map(v=>v*exposure*0.35*strength*Math.min(ratio,4)/4),dx,dy,strength];
}
// The light field of a measured picture as shown (its stand-in correction, a colour matrix, applied first).
function field(grid,correction) {
    if(!grid)return null;
    const m=correction||IDENTITY,key=m.join(',');
    let byCorrection=fields.get(grid);
    if(!byCorrection)fields.set(grid,byCorrection=new Map());
    if(byCorrection.has(key))return byCorrection.get(key);
    const {w,h,rgb}=grid,cells=new Float32Array(rgb.length),lum=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){
        const r=rgb[i*3],g=rgb[i*3+1],b=rgb[i*3+2];
        for(let k=0;k<3;k++)cells[i*3+k]=lin(clip(m[k*5]*r+m[k*5+1]*g+m[k*5+2]*b+m[k*5+3]+m[k*5+4],0,1));
        lum[i]=luma(cells[i*3],cells[i*3+1],cells[i*3+2]);
    }
    const out=new Float32Array(SAMPLES*STRIDE);
    for(let s=0;s<SAMPLES;s++)out.set(lightAt(cells,lum,w,h,s/(SAMPLES-1)),s*STRIDE);
    byCorrection.set(key,out);return out;
}
// Fields blend with the background's transition; a missing side is the other one at strength 0.
function mix(a,b,t) {
    if(!a&&!b)return null;
    const from=a||unlit(b),to=b||unlit(a);
    if(t>=1)return to;
    const out=new Float32Array(from.length);
    for(let i=0;i<out.length;i++)out[i]=from[i]+(to[i]-from[i])*t;
    return out;
}
function unlit(f){const out=Float32Array.from(f);for(let s=0;s<SAMPLES;s++)out[s*STRIDE+11]=0;return out;}
function at(f,x) {
    if(!f)return null;
    const p=clip(x,0,1)*(SAMPLES-1),i=Math.min(SAMPLES-2,Math.floor(p)),t=p-i,out=new Float32Array(STRIDE);
    for(let k=0;k<STRIDE;k++)out[k]=f[i*STRIDE+k]+(f[(i+1)*STRIDE+k]-f[i*STRIDE+k])*t;
    return out;
}
// A flat colour matrix close to the light at the stage centre, for what cannot take the per-pixel light (the DOM UI).
function flat(f) {
    const v=at(f,0.5);
    if(!v)return IDENTITY.slice();
    const g=[0,1,2].map(k=>Math.pow(clip(1+(v[k]+0.5*v[3+k]-1)*v[11],0,1.5),1/2.2));
    return [g[0],0,0,0,0,0,g[1],0,0,0,0,0,g[2],0,0,0,0,0,1,0];
}

// The globals are shared with Pixi's highp filter vertex shader: their precision must match or the program fails to link.
const GLOBALS=`precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform highp vec4 inputSize;
uniform highp vec4 outputFrame;
uniform vec4 inputClamp;
float alphaAt(vec2 c) { vec2 q = clamp(c, inputClamp.xy, inputClamp.zw); return texture2D(uSampler, q).a * float(all(equal(q, c))); }
`;
// The silhouette's alpha box-averaged to an eighth of the resolution (4 x 4 taps over each output pixel's footprint): fine
// hair strands and gaps no longer alias into speckles that the normals below turned into blotches on the face.
const DOWN_FRAG=GLOBALS+`uniform float uFoot;
void main(void) {
    float a = 0.0;
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
        a += alphaAt(vTextureCoord + (vec2(float(x), float(y)) - 1.5) * 0.25 * uFoot * inputSize.zw);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a / 16.0);
}`;
// Outward normals of the smoothed silhouette at an eighth of the resolution: the alpha on four rings of 16 taps (out to a tenth of the
// figure's width) pushes away from where the figure is - a smooth blurred-silhouette gradient, 1 at the edge, fading to 0
// inside (sparse rings drew faceted patches over a slim figure's face).
const NORMAL_FRAG=GLOBALS+`void main(void) {
    vec2 r = 0.1 * outputFrame.z * inputSize.zw;
    vec2 n = vec2(0.0);
    for (int i = 0; i < 16; i++) {
        float a = float(i) * 0.392699 + 0.19635;
        vec2 d = vec2(cos(a), sin(a));
        n -= d * (alphaAt(vTextureCoord + d * r) + alphaAt(vTextureCoord + d * r * 0.75) + alphaAt(vTextureCoord + d * r * 0.5) + alphaAt(vTextureCoord + d * r * 0.25));
    }
    n /= 64.0 * 0.3183;
    n /= max(1.0, length(n));
    gl_FragColor = vec4(n * 0.5 + 0.5, 0.0, 1.0);
}`;
// The light (when uLight.z, its strength, is above 0), then the figure's colour matrix (time grade, figure light,
// speaker shade and alpha) exactly as Pixi's ColorMatrixFilter applies it.
const FIGURE_FRAG=GLOBALS+`uniform float m[20];
uniform vec3 uAmb;
uniform vec3 uKey;
uniform vec3 uRim;
uniform vec3 uLight;
uniform sampler2D uNormals;
uniform vec2 uNormalSize;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
void main(void) {
    vec4 src = texture2D(uSampler, vTextureCoord);
    vec4 c = src;
    if (c.a > 0.0) c.rgb /= c.a;
    if (uLight.z > 0.0) {
        vec2 px = vTextureCoord * inputSize.xy;
        vec2 n = texture2D(uNormals, px / uNormalSize).xy * 2.0 - 1.0;
        vec2 L = uLight.xy;
        float across = px.x / outputFrame.z * 2.0 - 1.0;
        float lam = clamp((0.55 * n.x + 0.45 * across) * L.x + 0.33 * n.y * L.y + 0.35, 0.0, 1.0);
        lam = lam * lam * (3.0 - 2.0 * lam);
        vec3 albedo = pow(max(c.rgb, 0.0), vec3(2.2));
        vec3 lit = mix(albedo, albedo * (uAmb + uKey * lam), uLight.z);
        vec2 e = 3.0 * inputSize.zw;
        float inner = min(min(alphaAt(vTextureCoord + vec2(e.x, 0.0)), alphaAt(vTextureCoord - vec2(e.x, 0.0))),
            min(alphaAt(vTextureCoord + vec2(0.0, e.y)), alphaAt(vTextureCoord - vec2(0.0, e.y))));
        lit += clamp(src.a - inner, 0.0, 1.0) * max(dot(n, L), 0.0) * uRim;
        // a painted shadow is richer, not greyer: chroma grows as the light dims the colour (a plain darkening read as dirt)
        float before = dot(albedo, W), after = dot(lit, W);
        lit = max(vec3(after) + (lit - vec3(after)) * (1.0 + 0.4 * clamp(1.0 - after / max(before, 1e-4), 0.0, 1.0)), 0.0);
        lit /= max(1.0, max(lit.r, max(lit.g, lit.b)));
        c.rgb = pow(max(lit, 0.0), vec3(1.0 / 2.2));
    }
    vec4 o;
    o.r = m[0] * c.r + m[1] * c.g + m[2] * c.b + m[3] * c.a + m[4];
    o.g = m[5] * c.r + m[6] * c.g + m[7] * c.b + m[8] * c.a + m[9];
    o.b = m[10] * c.r + m[11] * c.g + m[12] * c.b + m[13] * c.a + m[14];
    o.a = m[15] * c.r + m[16] * c.g + m[17] * c.b + m[18] * c.a + m[19];
    gl_FragColor = vec4(o.rgb * o.a, o.a);
}`;
// The figure's 'shade' filter: colour matrix plus light. Unlit it is one pass like a ColorMatrixFilter; lit it adds
// the two eighth-resolution passes (smoothed silhouette, normals).
function figureFilter(PIXI) {
    if(disposed)throw new Error('Figure light is disposed');
    const filter=new PIXI.Filter(undefined,FIGURE_FRAG,{m:new Float32Array(IDENTITY),uAmb:new Float32Array(3),uKey:new Float32Array(3),uRim:new Float32Array(3),
        uLight:new Float32Array(3),uNormals:PIXI.Texture.WHITE,uNormalSize:new Float32Array([1,1])});
    const down=new PIXI.Filter(undefined,DOWN_FRAG,{uFoot:8}),normals=new PIXI.Filter(undefined,NORMAL_FRAG,{}),apply=filter.apply,destroy=filter.destroy;let dead=false;
    filter.setMatrix=function(matrix){this.uniforms.m.set(matrix);};
    filter.setLight=function(v){
        const u=this.uniforms;
        if(!v){u.uLight[2]=0;return;}
        u.uAmb.set(v.subarray(0,3));u.uKey.set(v.subarray(3,6));u.uRim.set(v.subarray(6,9));u.uLight.set(v.subarray(9,12));
    };
    filter.apply=function(manager,input,output,clear,state){
        if(dead)return;
        if(!(this.uniforms.uLight[2]>0))return apply.call(this,manager,input,output,clear,state);
        const small=manager.getFilterTexture(input,input.resolution*0.125),tmp=manager.getFilterTexture(input,input.resolution*0.125);
        down.uniforms.uFoot=1/(input.resolution*0.125);
        manager.applyFilter(down,input,small,PIXI.CLEAR_MODES.CLEAR);
        manager.applyFilter(normals,small,tmp,PIXI.CLEAR_MODES.CLEAR);
        manager.returnFilterTexture(small);
        this.uniforms.uNormals=tmp;// both textures' coordinates are in the filter's (CSS) units: tmp.width, not its pixel size at an eighth of the resolution
        this.uniforms.uNormalSize[0]=tmp.width;this.uniforms.uNormalSize[1]=tmp.height;
        apply.call(this,manager,input,output,clear,state);
        this.uniforms.uNormals=PIXI.Texture.WHITE;
        manager.returnFilterTexture(tmp);
    };
    filter.destroy=function(...args){if(dead)return;dead=true;filters.delete(filter);down.destroy();normals.destroy();return destroy.apply(this,args);};
    filters.add(filter);return filter;
}
function dispose(){if(disposed)return;disposed=true;const errors=[];for(const filter of [...filters])try{filter.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure light cleanup failed');}
return {measure,field,mix,at,flat,figureFilter,dispose,STRIDE};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureLight};
