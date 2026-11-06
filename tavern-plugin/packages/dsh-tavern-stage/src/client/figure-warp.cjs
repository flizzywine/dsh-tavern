function createStageFigureWarp() {
let disposed=false;const filters=new Set();
// S2: one-pass warp filter on the figure container (sprite + mouth/blink children deform together): shoulders/chest
// rise with the breath and fade out by the waist, the chest widens a little, the head tilts around the neck with a
// smooth falloff (hair at head height follows; hair below the chin bends slightly — the secondary lag).
// The globals are shared with Pixi's highp filter vertex shader: their precision must match or the program fails to link.
const GAL_WARP_FRAGMENT = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform highp vec4 inputSize;
uniform highp vec4 outputFrame;
uniform vec4 inputClamp;
uniform vec3 uInvX;
uniform vec3 uInvY;
uniform vec4 uFwd;
uniform vec4 uBody;
uniform vec4 uMotion;
uniform float uAspect;
void main(void) {
    vec2 q = vTextureCoord * inputSize.xy + outputFrame.xy;
    vec3 h = vec3(q, 1.0);
    vec2 uv = vec2(dot(uInvX, h), dot(uInvY, h));
    float rise = (1.0 - smoothstep(uBody.z, uBody.w, uv.y)) * uMotion.x;
    float cy = (uv.y - uBody.z) / 0.09;
    float chestBand = exp(-cy * cy);
    vec2 d = vec2((uv.x - uMotion.w) * uMotion.y * chestBand, -rise);
    float headW = 1.0 - smoothstep(uBody.y - 0.015, uBody.y + 0.08, uv.y);
    float a = uMotion.z * headW;
    vec2 r = vec2((uv.x - uMotion.w) * uAspect, uv.y - uBody.y);
    vec2 rr = vec2(cos(a) * r.x + sin(a) * r.y, -sin(a) * r.x + cos(a) * r.y);
    d += vec2((r.x - rr.x) / uAspect, r.y - rr.y);
    vec2 src = q - vec2(uFwd.x * d.x + uFwd.z * d.y, uFwd.y * d.x + uFwd.w * d.y);
    vec2 coord = clamp((src - outputFrame.xy) * inputSize.zw, inputClamp.xy, inputClamp.zw);
    gl_FragColor = texture2D(uSampler, coord);
}`;
function galWarpFilter(PIXI) {
    if(disposed)throw new Error('Figure warp is disposed');
    const filter = new PIXI.Filter(undefined, GAL_WARP_FRAGMENT, {
        uInvX: new Float32Array([1, 0, 0]), uInvY: new Float32Array([0, 1, 0]), uFwd: new Float32Array([1, 0, 0, 1]),
        uBody: new Float32Array([0.05, 0.2, 0.32, 0.6]), uMotion: new Float32Array([0, 0, 0, 0.5]), uAspect: 1 });
    filter.forkSprite = null; filter.forkBody = null; filter.forkMotion = null;
    const apply = filter.apply, destroy=filter.destroy;let dead=false;
    filter.destroy=function(...args){if(dead)return;dead=true;filters.delete(filter);this.forkSprite=null;this.forkBody=null;this.forkMotion=null;return destroy.apply(this,args);};
    filters.add(filter);
    // Matrices from the sprite's world transform at render time (after this frame's transforms), not last frame's.
    filter.apply = function (manager, input, output, clear, state) {
        if(dead)return;
        const sprite = this.forkSprite, texture = sprite && sprite.texture;
        if (sprite && texture && !sprite.destroyed && this.forkMotion) {
            const m = sprite.worldTransform, w = texture.width, hgt = texture.height;
            const fa = m.a * w, fb = m.b * w, fc = m.c * hgt, fd = m.d * hgt, det = fa * fd - fc * fb || 1;
            const i00 = fd / det, i01 = -fc / det, i10 = -fb / det, i11 = fa / det, ax = sprite.anchor.x, ay = sprite.anchor.y;
            const u = this.uniforms;
            u.uInvX[0] = i00; u.uInvX[1] = i01; u.uInvX[2] = -i00 * m.tx - i01 * m.ty + ax;
            u.uInvY[0] = i10; u.uInvY[1] = i11; u.uInvY[2] = -i10 * m.tx - i11 * m.ty + ay;
            u.uFwd[0] = fa; u.uFwd[1] = fb; u.uFwd[2] = fc; u.uFwd[3] = fd;
            u.uAspect = w / (hgt || 1);
            u.uBody.set(this.forkBody);
            u.uMotion.set(this.forkMotion);
        }
        apply.call(this, manager, input, output, clear, state);
    };
    return filter;
}

function dispose(){if(disposed)return;disposed=true;const errors=[];for(const filter of [...filters])try{filter.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure warp cleanup failed');}

return {galWarpFilter, dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureWarp};
