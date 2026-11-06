function createStageLookShaders(){
// our own soft focus - a 5 x 5 Gaussian at a tap spacing of one sigma
// (GAL_SOFTEN_SIGMA x the stage height, so it reads the same in a small window and at 3840 x 2160), normalized;
// edges repeat. look.soften mixes it over the scene.
const GAL_SOFTEN_SIGMA = 0.0015;
const GAL_SOFTEN_TAPS = (() => {
    const taps = [-2, -1, 0, 1, 2].flatMap(y => [-2, -1, 0, 1, 2].map(x => [x, y, Math.exp(-(x * x + y * y) / 2)]));
    const sum = taps.reduce((total, tap) => total + tap[2], 0);
    return taps.map(([x, y, w]) => [x, y, w / sum]);
})();
const GAL_SOFTEN_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform vec2 uSoften;
vec4 tap(float x, float y) { return texture2D(uSampler, clamp(vTextureCoord + vec2(x, y) * uSoften.x * inputSize.zw, inputClamp.xy, inputClamp.zw)); }
void main(void) {
    vec4 src = texture2D(uSampler, vTextureCoord);
    vec4 sum = vec4(0.0);
${GAL_SOFTEN_TAPS.map(([x, y, w]) => `    sum += tap(${x}.0, ${y}.0) * ${w.toFixed(5)};`).join("\n")}
    gl_FragColor = mix(src, sum, uSoften.y);
}`;
// The shader uniforms of the grade pass for a look (matrix already combined with the weather tint).
const GAL_GRADE_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 uR;
uniform vec4 uG;
uniform vec4 uB;
uniform vec3 uGamma;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform vec2 uSplit;
uniform vec3 uKeep;
uniform vec3 uStyle;
uniform sampler2D uLutA;
uniform sampler2D uLutB;
uniform vec4 uLut;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec3 lutSample(sampler2D lut, vec3 c, float size) {
    float b = c.b * (size - 1.0);
    float s0 = floor(b);
    float s1 = min(s0 + 1.0, size - 1.0);
    float x = (c.r * (size - 1.0) + 0.5) / (size * size);
    float y = (c.g * (size - 1.0) + 0.5) / size;
    vec3 a = texture2D(lut, vec2(x + s0 / size, y)).rgb;
    vec3 d = texture2D(lut, vec2(x + s1 / size, y)).rgb;
    return mix(a, d, b - s0);
}
vec3 softLight(vec3 b, vec3 s) {
    vec3 lo = 2.0 * b * s + b * b * (1.0 - 2.0 * s);
    vec3 hi = sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s);
    return mix(lo, hi, step(0.5, s));
}
vec3 hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
void main() {
    vec4 src = texture2D(uSampler, vTextureCoord);
    if (src.a <= 0.0) { gl_FragColor = src; return; }
    vec3 c = src.rgb / src.a;
    c = vec3(dot(uR.xyz, c) + uR.w, dot(uG.xyz, c) + uG.w, dot(uB.xyz, c) + uB.w);
    c = pow(max(c, 0.0), uGamma);
    if (uSplit.x > 0.0) {
        float l = clamp(dot(c, W), 0.0, 1.0);
        float w = smoothstep(0.0, 1.0, clamp(l + uSplit.y * 0.5, 0.0, 1.0));
        c = mix(c, softLight(clamp(c, 0.0, 1.0), uShadows), (1.0 - w) * uSplit.x);
        c = mix(c, softLight(clamp(c, 0.0, 1.0), uHighlights), w * uSplit.x);
    }
    if (uKeep.z > 0.0) {
        vec3 q = hsv(clamp(c, 0.0, 1.0));
        float d = abs(fract(q.x - uKeep.x + 0.5) - 0.5);
        float keep = (1.0 - smoothstep(uKeep.y * 0.55, uKeep.y, d)) * smoothstep(0.08, 0.28, q.y);
        c = mix(vec3(dot(c, W)), c, mix(1.0, keep, uKeep.z));
    }
    if (uLut.x + uLut.y > 0.0) {
        vec3 k = clamp(c, 0.0, 1.0);
        vec3 o = c * (1.0 - uLut.x - uLut.y);
        if (uLut.x > 0.0) o += lutSample(uLutA, k, uLut.z) * uLut.x;
        if (uLut.y > 0.0) o += lutSample(uLutB, k, uLut.w) * uLut.y;
        c = o;
    }
    if (uStyle.x > 0.0) c = mix(c, 1.0 - c, uStyle.x);
    if (uStyle.y > 0.0) { float n = max(uStyle.z - 1.0, 1.0); c = mix(c, floor(clamp(c, 0.0, 1.0) * n + 0.5) / n, uStyle.y); }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}`;
const GAL_SCREEN_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;
uniform vec4 uLens;
uniform vec4 uFx;
uniform vec2 uWobble;
uniform sampler2D uDirtTex;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec2 tex(vec2 n) { return clamp(n * outputFrame.zw * inputSize.zw, inputClamp.xy, inputClamp.zw); }
float dots(vec2 p, float angle, float cell, float value) {
    float s = sin(angle), c = cos(angle);
    vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec2 f = mod(r, cell) - 0.5 * cell;
    float radius = sqrt(clamp(value, 0.0, 1.0)) * cell * 0.72;
    return 1.0 - smoothstep(radius - 0.7, radius + 0.7, length(f));
}
float lum(vec2 n) { return dot(texture2D(uSampler, tex(n)).rgb, W); }
void main() {
    vec2 size = outputFrame.zw;
    vec2 n0 = vTextureCoord * inputSize.xy / size;
    vec2 n = n0;
    vec2 aspect = vec2(size.x / size.y, 1.0);
    if (uLens.x != 0.0 || uWobble.x > 0.0) {
        vec2 d = (n - 0.5) * aspect;
        float r2 = dot(d, d) / dot(0.5 * aspect, 0.5 * aspect);
        float k = max(uLens.x, -0.3);
        n = 0.5 + (n - 0.5) * (1.0 + k * r2) / (1.0 + k);
        if (uWobble.x > 0.0) {
            float t = uWobble.y;
            vec2 wob = vec2(sin(n.y * 5.0 + t * 1.3) + 0.5 * sin(n.y * 11.0 - t * 2.1), cos(n.x * 4.0 + t * 1.1) + 0.5 * sin(n.x * 9.0 + t * 1.7));
            n += wob * uWobble.x * 0.006 * (0.4 + r2);
        }
    }
    if (uLens.z > 1.0) { vec2 cell = uLens.z / size; n = (floor(n / cell) + 0.5) * cell; }
    vec4 color = texture2D(uSampler, tex(n));
    if (uLens.y > 0.0) {
        vec2 dir = (n - 0.5) * size / (0.5 * length(size));
        vec2 off = (dir * uLens.y + vec2(uLens.y * 0.25, 0.0)) / size;
        color.r = texture2D(uSampler, tex(n + off)).r;
        color.b = texture2D(uSampler, tex(n - off)).b;
    }
    if (uLens.w > 0.0) {
        vec2 p = n * size;
        float cell = 5.5;
        vec3 cmy = 1.0 - clamp(color.rgb, 0.0, 1.0);
        float k = min(cmy.x, min(cmy.y, cmy.z));
        vec3 ink = (cmy - k) / max(1.0 - k, 1e-3);
        vec3 print = vec3(0.965, 0.945, 0.885);
        print *= 1.0 - dots(p, 0.2618, cell, ink.x) * vec3(0.88, 0.26, 0.06);
        print *= 1.0 - dots(p, 1.309, cell, ink.y) * vec3(0.1, 0.84, 0.3);
        print *= 1.0 - dots(p, 0.0, cell, ink.z) * vec3(0.02, 0.1, 0.84);
        print *= 1.0 - dots(p, 0.7854, cell, k) * 0.9;
        color.rgb = mix(color.rgb, print * color.a, uLens.w);
    }
    if (uFx.x > 0.0) {
        float y = n0.y * size.y;
        float line = 0.5 + 0.5 * cos(6.2831853 * y / 3.0);
        color.rgb *= 1.0 - uFx.x * 0.5 * (1.0 - line);
        float mx = mod(floor(n0.x * size.x * uFx.w), 3.0);
        vec3 mask = mx < 1.0 ? vec3(1.0, 0.78, 0.78) : mx < 2.0 ? vec3(0.78, 1.0, 0.78) : vec3(0.78, 0.78, 1.0);
        color.rgb *= mix(vec3(1.0), mask * 1.14, uFx.x * 0.4);
        float roll = fract(n0.y - uFx.z * 0.09) - 0.5;
        color.rgb *= 1.0 + uFx.x * 0.07 * exp(-roll * roll * 90.0);
    }
    if (uFx.y > 0.0) {
        vec2 r = vec2(0.07 / aspect.x, 0.07);
        float l = lum(n0) * 0.2;
        l += (lum(n0 + vec2(r.x, 0.0)) + lum(n0 - vec2(r.x, 0.0)) + lum(n0 + vec2(0.0, r.y)) + lum(n0 - vec2(0.0, r.y))) * 0.1;
        l += (lum(n0 + r * 1.4) + lum(n0 - r * 1.4) + lum(n0 + vec2(r.x, -r.y) * 1.4) + lum(n0 + vec2(-r.x, r.y) * 1.4)) * 0.1;
        float b = smoothstep(0.42, 0.95, l);
        vec3 dirt = texture2D(uDirtTex, n0).rgb;
        color.rgb += dirt * b * uFx.y * 1.8 * color.a * (1.0 - color.rgb * 0.5);
    }
    gl_FragColor = color;
}`;

// Generated overlay pictures: vignette (by softness), light leaks (by edge), flare parts, default lens dirt.

return {GAL_SOFTEN_SIGMA,GAL_SOFTEN_FRAG,GAL_GRADE_FRAG,GAL_SCREEN_FRAG};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageLookShaders};
