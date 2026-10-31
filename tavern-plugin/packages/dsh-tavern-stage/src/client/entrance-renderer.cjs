function entranceRenderer(canvas, doc, options) {
    let disposed = false;
    const gl = canvas.getContext('webgl2', {alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: !!(options && options.preserve)});
    if (!gl) throw new Error('WebGL2 unavailable');
    const VERT = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
    const HASH = 'float h12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\n' +
        'vec2 h22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}\n';
    // Polar frame units around the focus: r = distance / frame height (the 16:9 frame that covers the screen), lr = log r, u = turns.
    // Log-polar cells are square on screen and grow with r, so motion along lr reads as flying through a tunnel.
    const SCENE = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec2 uFocus;
uniform float uH, uTime, uTravel, uTurn, uSpeed, uZoom, uExposure;
uniform vec3 uVoid;
uniform float uLight, uLightSize, uLightMix, uLightEdge, uLightRadius, uLightHalo, uLightLobes, uLightDisc, uLightDiscSize;
uniform vec3 uLightColor, uLightCore, uLightDiscColor;
uniform float uDust, uDustDensity, uDustSize, uDustTrail, uDustCluster, uDustSpread;
uniform vec3 uDustColor;
uniform float uFil, uFilDensity, uFilCurl, uFilWidth, uFilLength;
uniform vec3 uFilColor;
uniform float uRings, uRingSize, uRingRadius, uRingWidth, uRingCount;
uniform vec3 uRingColor;
uniform float uStreams, uStreamCount, uStreamLength, uStreamWidth;
uniform vec3 uStreamColor;
uniform float uWalls, uWallScale;
uniform vec3 uWallColor, uWallDeep;
uniform float uCaustics, uCausticScale;
uniform vec3 uCausticColor;
uniform float uShards, uShardSize, uShardDensity, uShardScale, uShardWarp, uShardFill;
uniform vec3 uShardColor, uShardEdge;
uniform float uFilm, uFilmScale, uFilmSat, uFilmCoverage;
uniform float uFlare, uFlareRays;
uniform vec3 uFlareColor;
out vec4 outColor;
const float TAU = 6.28318531;
${HASH}
float n3(vec3 p){ return texture(uNoise, p * 0.015625).r; }
float fbm(vec3 p){ return (0.5 * n3(p) + 0.25 * n3(p * 2.03 + vec3(17.1, 3.7, 9.2)) + 0.125 * n3(p * 4.11 + vec3(5.3, 21.7, 1.1))) * 1.142857; }
float dust(float N, float rate, float seed, float u, float lr, float r0) {
    float x = fract(u) * N, y = (lr - uTravel * rate) * N / TAU, cx = floor(x);
    float cellPx = TAU * r0 * uH / N, stretch = 1.0 + uDustTrail * abs(uSpeed) * 0.8;
    float size = uDustSize * (0.7 + 2.0 * r0) * uH / 1080.0, acc = 0.0;
    for (int j = -1; j <= 1; j++) {
        vec2 id = vec2(cx, floor(y) + float(j));
        if (h12(id * 1.37 + seed) > uDustDensity) continue;
        vec2 rnd = h22(id + seed);
        vec2 d = vec2(x - (cx + 0.2 + 0.6 * rnd.x), (y - (id.y + 0.2 + 0.6 * rnd.y)) / stretch) * cellPx;
        float s = size * (0.5 + h12(id + seed + 9.7));
        acc += exp(-dot(d, d) / (s * s)) * (0.6 + 0.4 * sin(uTime * (1.5 + 5.0 * rnd.x) + rnd.y * TAU)) * (0.35 + 0.65 * rnd.y);
    }
    return acc;
}
vec3 streams(float u, float lr, float r0) {
    float N = uStreamCount, x = fract(u) * N, id = floor(x);
    float ha = h12(vec2(id, 7.7)), hb = h12(vec2(id, 19.3)), hc = h12(vec2(id, 31.1));
    if (hb > 0.8) return vec3(0.0);
    float dpx = abs(fract(x) - (0.2 + 0.6 * ha)) * TAU * r0 * uH / N, w = uStreamWidth * (0.6 + 1.6 * r0) * uH / 1080.0;
    float f = fract((lr - uTravel * (0.8 + 0.7 * hb)) / uStreamLength + hc * 13.0);
    float seg = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.18, 0.75, f));
    return mix(uStreamColor, uDustColor, step(0.72, hc)) * exp(-dpx * dpx / (w * w)) * seg * (0.45 + 0.55 * hc);
}
float filaments(vec2 dir, float z) {
    // Fine curling strands: iso-lines of a noise field on the tunnel wall (constant pixel width), shown in patches.
    vec3 q = vec3(dir * 2.2 * uFilCurl, z * 0.6 * uFilCurl + uTravel * 0.8 + uTime * 0.04);
    float v = 0.65 * n3(q) + 0.35 * n3(q * 2.1 + 7.3), w = fwidth(v) * uFilWidth * uH / 1080.0 + 1e-4;
    float line = exp(-pow((v - 0.5) / w, 2.0));
    float zone = smoothstep(1.0 - uFilDensity, 1.15 - uFilDensity, n3(vec3(dir * 1.5 / uFilLength, z * 0.4 / uFilLength + uTravel * 0.5) + 13.0));
    return line * zone;
}
float rings(vec2 dir, float r) {
    float acc = 0.0, R0 = uRingRadius * uRingSize;
    for (int k = 0; k < 4; k++) {
        float fk = float(k);
        if (fk >= uRingCount) break;
        float wob = 1.0 + 0.16 * (n3(vec3(dir * 1.7 + fk * 3.1, uTime * 0.22 + fk * 1.7)) - 0.5);
        float d = (r - R0 * (1.0 + 0.42 * fk) * wob) / (uRingWidth * uRingSize * (1.0 + 0.7 * fk));
        float arc = smoothstep(0.3, 0.7, n3(vec3(dir * 2.3, fk * 5.1 + uTurn * 0.7 + uTime * 0.12)));
        acc += exp(-d * d) * (0.3 + 0.7 * arc) / (1.0 + fk * 0.9);
    }
    return acc + 0.10 * (1.0 - smoothstep(R0 * 0.2, R0 * 1.02, r));
}
void main() {
    vec2 p = (gl_FragCoord.xy - uFocus) / uH;
    float r0 = max(length(p), 1e-4), r = r0 * exp(-uZoom), a = atan(p.y, p.x) + uTurn;
    vec2 dir = vec2(cos(a), sin(a));
    float u = a / TAU, lr = log(r), z = 0.32 / (r + 0.05);
    float st = n3(vec3(dir * 24.0, lr * 0.6 - uTravel * 0.8));
    vec3 col = uVoid * (0.7 + 0.8 * st * smoothstep(0.0, 0.6, r0));
    if (uWalls > 0.001) {
        float wv = fbm(vec3(dir * 1.6 * uWallScale, z * 0.9 * uWallScale + uTravel * 0.45));
        col += mix(uWallDeep, uWallColor, smoothstep(0.25, 0.75, wv)) * wv * wv * (0.55 + 0.9 * st) * smoothstep(0.02, 0.4, r) * uWalls;
    }
    float cau = 0.0;
    if (uCaustics > 0.001 || uShards > 0.001) {
        vec3 q = vec3(dir * 2.4 * uCausticScale, z * 1.1 * uCausticScale + uTravel * 0.7);
        cau = pow(1.0 - abs(n3(q) * 2.0 - 1.0), 8.0) * 0.8 + pow(1.0 - abs(n3(q * 2.13 + 4.7) * 2.0 - 1.0), 10.0) * 0.6;
        col += uCausticColor * cau * uCaustics * smoothstep(0.03, 0.45, r);
    }
    if (uFilm > 0.001) {
        // Oil-film sheen as a fibrous sheet: thin curling hairs (ridges of a domain-warped noise, fine across the rush and
        // long along it) carry thin-film colours over drifting patches.
        float th = fbm(vec3(dir * 1.4 * uFilmScale, z * 0.5 * uFilmScale + uTravel * 0.3) + 11.0);
        float edge0 = mix(0.72, 0.4, uFilmCoverage);
        float mask = smoothstep(edge0, edge0 + 0.14, fbm(vec3(dir * 1.3, lr * 1.1 - uTravel * 0.6) + 23.0)) * smoothstep(0.08, 0.45, r);
        vec3 fq = vec3(dir * 2.6 * uFilmScale, lr * 1.4 - uTravel * 0.7);
        fq += (vec3(n3(fq * 0.9 + 2.0), n3(fq * 0.9 + 9.0), n3(fq * 0.9 + 4.0)) - 0.5) * 1.7;
        float hair = pow(1.0 - abs(2.0 * n3(vec3(fq.xy * 3.2, fq.z * 4.0)) - 1.0), 10.0)
            + 0.7 * pow(1.0 - abs(2.0 * n3(vec3(fq.xy * 7.0, fq.z * 6.0) + 3.0) - 1.0), 14.0);
        vec3 irid = 0.5 + 0.5 * cos(TAU * (th * 3.0 + hair * 0.5 + r * 1.2 + vec3(0.0, 0.33, 0.67)));
        col += mix(vec3(dot(irid, vec3(0.333))), irid, uFilmSat) * mask * (0.08 + 1.5 * hair) * uFilm * 0.55;
    }
    if (uStreams > 0.001) col += streams(u, lr, r0) * uStreams * smoothstep(0.015, 0.2, r0);
    if (uFil > 0.001) col += uFilColor * filaments(dir, z) * uFil * smoothstep(0.07, 0.3, r0);
    if (uDust > 0.001) {
        float cluster = mix(1.0, smoothstep(0.35, 0.7, n3(vec3(dir * 1.4, lr * 0.3 - uTravel * 0.3 + 5.0))), uDustCluster);
        col += uDustColor * (dust(150.0, 0.55, 0.0, u, lr, r0) + 0.8 * dust(340.0, 0.9, 17.0, u, lr, r0)) * cluster * uDust * smoothstep(0.012, 0.06, r0) * exp(-r0 * uDustSpread);
    }
    if (uRings > 0.001) col += uRingColor * rings(dir, r) * uRings;
    if (uShards > 0.001) {
        // Glass / water shards: a domain-warped field on the tunnel wall; above its threshold is liquid (a translucent body
        // with glints), the threshold itself a thin bright rim of constant pixel width.
        // Log-polar is conformal: the blobs keep their shape on screen and stream outward at the rush's speed.
        float k = 2.4 * uShardScale;
        vec3 q = vec3(dir * k, (lr - log(uShardSize) - uTravel) * k);
        vec3 wq = q + (vec3(n3(q * 0.8 + 1.3), n3(q * 0.8 + 7.1), n3(q * 0.8 + 4.2)) - 0.5) * uShardWarp * 1.6;
        float v = 0.6 * n3(wq) + 0.4 * n3(wq * 2.2 + 3.1), th = mix(0.72, 0.42, uShardDensity), w = fwidth(v) * 1.6 + 1e-4;
        float body = smoothstep(th - w, th + w, v), rim = exp(-pow((v - th) / (w * 1.4), 2.0));
        float glint = clamp((v - th) * 5.0, 0.0, 1.0) * pow(n3(wq * 3.1 + 9.0), 5.0) * 5.0;
        float alpha = clamp(uShards, 0.0, 1.0) * smoothstep(0.1, 0.42, r0);
        vec3 tint = uShardColor * (0.25 + 0.9 * n3(wq * 1.7 + 2.0)) + uCausticColor * cau * 0.5;
        col = mix(col, tint, alpha * uShardFill * body) + uShardEdge * (rim * 1.1 + glint * body) * alpha * max(uShards, 1.0);
    }
    if (uLight > 0.001) {
        // A growing light is a growing disc; its glow tail keeps the base size, so the frame around it stays dark.
        // lightEdge sharpens the disc's rim; lightMix turns its glow from the colour to the core's.
        float lobe = 1.0 + uLightLobes * 0.5 * (n3(vec3(dir * 1.3, uTime * 0.5)) - 0.5);
        float d = r / (uLightRadius * uLightSize * lobe), g = r / (uLightRadius * sqrt(max(uLightSize, 1e-3)) * lobe);
        vec3 glow = mix(uLightColor, uLightCore, uLightMix);
        // lightDisc: a flat lens disc behind the core, offset down-right, with a crisp rim.
        if (uLightDisc > 0.001) {
            float Rd = uLightRadius * uLightSize * uLightDiscSize;
            vec2 pz = p * exp(-uZoom), o = vec2(0.385, -0.323) * Rd;
            float dd = length(pz - o) / Rd;
            col += uLightDiscColor * smoothstep(1.0, 0.965, dd) * (0.8 + 0.2 * dd) * uLightDisc;
            glow *= 1.0 - 0.6 * min(uLightDisc, 1.0);
        }
        col += (uLightCore * exp(-pow(d * 1.26, 2.0 + 6.0 * uLightEdge)) * 2.6 + glow * (exp(-g * 0.9) * 0.9 + 0.35 / (1.0 + pow(r / (uLightRadius * uLightHalo * 3.0), 2.0)))) * uLight;
    }
    if (uFlare > 0.001) {
        float rays = pow(abs(cos(atan(p.y, p.x) * uFlareRays * 0.5 + uTurn * 0.25)), 28.0);
        col += uFlareColor * (exp(-r0 * r0 * 35.0) * 2.4 + exp(-r0 * 4.0) * 0.5 + rays * exp(-r0 * 2.2) * 1.1) * uFlare;
    }
    outColor = vec4(1.0 - exp(-col * uExposure), 1.0);
}`;
    // Compositing: zoom blur along the rush, chromatic aberration, bloom and light shafts (a screen-like add, so the glow
    // rolls off instead of clipping), vignette, grain, the cover's colour and the opacity.
    const POST = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom, uShafts;
uniform vec2 uRes, uFocus;
uniform float uBlur, uAb, uGrain, uVig, uFlash, uFade, uTime, uBloomAmt, uShaftAmt;
uniform vec3 uVigColor, uFlashColor, uBloomColor, uShaftColor;
out vec4 outColor;
${HASH}
void main() {
    vec2 uv = gl_FragCoord.xy / uRes, fc = uFocus / uRes, d = uv - fc;
    // Zoom blur with a per-pixel jittered start: evenly spaced taps would ghost sharp highlights into parallel copies.
    int taps = uBlur > 0.002 ? 10 : 1;
    float jitter = taps > 1 ? h12(gl_FragCoord.xy) : 0.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
        if (i >= taps) break;
        vec2 q = d * (1.0 - uBlur * 0.09 * (float(i) + jitter) / 10.0);
        acc += vec3(texture(uScene, fc + q * (1.0 + uAb)).r, texture(uScene, fc + q).g, texture(uScene, fc + q * (1.0 - uAb)).b);
    }
    vec3 col = acc / float(taps);
    // The glow is dispersed a little too: red spreads wider than blue, as through a real lens.
    vec3 glow = vec3(0.0);
    if (uBloomAmt > 0.001) glow += vec3(texture(uBloom, fc + d * (1.0 + 2.0 * uAb)).r, texture(uBloom, uv).g, texture(uBloom, fc + d * (1.0 - 2.0 * uAb)).b) * uBloomColor * uBloomAmt;
    if (uShaftAmt > 0.001) glow += texture(uShafts, uv).rgb * uShaftColor * uShaftAmt;
    col = 1.0 - (1.0 - col) * exp(-glow);
    vec2 ar = vec2(uRes.x / uRes.y, 1.0);
    col = mix(col, uVigColor, uVig * smoothstep(0.35, 1.0, length((uv - 0.5) * ar) / length(0.5 * ar)));
    col += (h12(gl_FragCoord.xy + fract(uTime * 7.31) * 391.0) - 0.5) * uGrain * min(1.0, dot(col, vec3(0.333)) * 8.0);
    col = mix(col, uFlashColor, uFlash);
    outColor = vec4(clamp(col, 0.0, 1.0) * uFade, uFade);
}`;
    // Water over the scene, lit as 2.5D surfaces. A liquid layer is a thickness field in tunnel space (conformal, so bodies
    // keep their shape while they fly out past the camera); its signed pixel distance gives each body a rounded rim and its
    // gradient the surface normal. The scene behind is refracted through the body and tinted by it, a Fresnel term mixes in
    // a studio reflection and the light behind, and a Blinn-Phong term adds pinpoint highlights. Emitters (low-frequency
    // angular masks) make the splash come from some sides only. Droplets sit in three depth layers around a focal depth:
    // in focus a small refracting ball with a highlight, out of focus their light spread over the circle of confusion
    // (bokeh), all streaked along the rush. The orb is a glass ball at the focus that shows the scene inverted.
    const WATER = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uScene;
uniform vec2 uRes, uFocus;
uniform float uH, uTime, uTravel, uTurn, uSpeed, uZoom, uLight;
uniform vec3 uLightCore;
uniform float uLiq, uLiqSize, uLiqDensity, uLiqScale, uLiqDetail, uLiqGloss, uLiqRefr, uLiqSpread, uLiqTear, uLiqOpacity, uLiqLayers, uLiqLean, uLiqAngle, uLiqFoam, uLiqCrinkle;
uniform vec3 uLiqColor, uLiqEdge;
uniform float uSpl, uSplSize, uSplDensity, uSplScale, uSplDetail, uSplGloss, uSplRefr, uSplSpread, uSplTear, uSplOpacity, uSplFoam, uSplLean, uSplAngle, uSplCrinkle, uSplCells;
uniform vec3 uSplColor, uSplEdge;
uniform float uLump, uLumpSize, uLumpRadius, uLumpWobble, uLumpRefr;
uniform vec2 uLumpAt, uLumpMove;
uniform vec3 uLumpColor, uLumpEdge;
uniform float uDrop, uDropDensity, uDropSize, uDropFocus, uDropBokeh, uDropTrail;
uniform vec3 uDropColor, uDropGlint;
uniform float uOrb, uOrbSize, uOrbRadius, uOrbRefr, uOrbGlitter;
uniform vec3 uOrbColor;
out vec4 outColor;
const float TAU = 6.28318531;
const vec3 KEY = vec3(-0.3713, 0.5835, 0.7222);
${HASH}
// Smooth (C1) value noise interpolated here in full precision: surface normals come from its differences, and hardware
// filtering (linear, 8-bit weights) would leave flat facets that read as broken glass and a stepped, cross-hatched sheen.
float n3(vec3 p){
    vec3 u = p - 0.5, i = floor(u), f = fract(u);
    f = f * f * (3.0 - 2.0 * f);
    ivec3 a = ivec3(mod(i, 64.0)), b = ivec3(mod(i + 1.0, 64.0));
    float c000 = texelFetch(uNoise, a, 0).r, c100 = texelFetch(uNoise, ivec3(b.x, a.y, a.z), 0).r;
    float c010 = texelFetch(uNoise, ivec3(a.x, b.y, a.z), 0).r, c110 = texelFetch(uNoise, ivec3(b.x, b.y, a.z), 0).r;
    float c001 = texelFetch(uNoise, ivec3(a.x, a.y, b.z), 0).r, c101 = texelFetch(uNoise, ivec3(b.x, a.y, b.z), 0).r;
    float c011 = texelFetch(uNoise, ivec3(a.x, b.y, b.z), 0).r, c111 = texelFetch(uNoise, b, 0).r;
    return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y), mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
vec3 tun(vec2 frag) {
    vec2 p = (frag - uFocus) / uH;
    float a = atan(p.y, p.x) + uTurn;
    return vec3(cos(a), sin(a), log(max(length(p), 1e-4)) - uZoom);
}
// One liquid layer at a tunnel point: x = thickness (> 0 inside), y = surface ripple. ribbon 0: bodies and sheets with
// holes; 1: thin curling ribbons. rush: how much faster than the camera the layer flies. tear: fine noise stretched
// along the rush cuts the outline into filaments, holes and loose drops, more the nearer the water is. lean: the share
// of water toward aim (a tunnel-space direction).
vec2 field(vec3 t, float k, float size, float density, float detail, float spread, float seed, float ribbon, float rush, float tear, float lean, vec2 aim, out vec3 wo) {
    float s = (t.z - log(size) - uTravel * (1.0 + 0.35 * ribbon) * rush) * k;
    vec3 q = vec3(t.xy * k, s * mix(1.0, 0.5, ribbon)) + seed;
    vec3 wq = q + (vec3(n3(q * 0.55 + 1.3), n3(q * 0.55 + 7.1), n3(q * 0.55 + 4.2)) - 0.5) * 2.2;
    float v = 0.55 * n3(wq) + 0.3 * n3(wq * 2.3 + 3.1) + 0.15 * n3(wq * 5.1 + 7.7), th = mix(0.7, 0.44, density);
    if (ribbon > 0.5) {
        v = 1.0 - abs(v * 2.0 - 1.0); th = mix(0.97, 0.86, density);
        // Cells: a sheet blown full of holes - the membranes between warped Voronoi cells, thickest where they meet.
        if (uSplCells > 0.001) {
            float N = floor(6.2831853 * k * 1.2) + 1.0, wrap = atan(t.y, t.x) / 6.2831853 + 0.5;
            vec2 X = vec2(wrap * N, s * 1.2) + (wq.xz - q.xz) * 0.8, c = floor(X);
            float F1 = 9.0, F2 = 9.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
                vec2 id = c + vec2(float(i), float(j)), o = id + 0.15 + 0.7 * h22(vec2(mod(id.x, N), id.y) + seed);
                float dd = length(X - o);
                if (dd < F1) { F2 = F1; F1 = dd; } else if (dd < F2) F2 = dd;
            }
            // Membranes swell where they meet (far from every cell centre) and pinch between, so they break into
            // pointed, star-like shards; in places they thin out altogether.
            float w = (0.04 + 0.2 * density) * smoothstep(0.4, 0.8, n3(wq * 0.8 + 13.0)) * 1.8 * (0.25 + 1.6 * smoothstep(0.3, 0.75, F1));
            v = mix(v, 0.5 + w - (F2 - F1), uSplCells); th = mix(th, 0.5, uSplCells);
        }
    }
    v -= detail * 0.3 * smoothstep(0.56, 0.72, n3(wq * 3.3 + 11.0));
    float emit = n3(vec3(t.xy * 0.42 + seed * 0.37, s * 0.04 + uTime * 0.05 + seed)) + dot(t.xy, vec2(0.34, -0.06)) * ribbon;
    v -= spread * 0.5 * (1.0 - smoothstep(0.34, 0.66, emit));
    v += lean * 0.3 * (dot(t.xy, aim) - 0.25);
    if (tear > 0.001) {
        vec3 fq = vec3(t.xy * k * 5.0, s * mix(1.3, 4.0, ribbon)) + wq * 0.6 + seed * 1.7;
        float fine = 0.62 * n3(fq) + 0.38 * n3(fq * vec3(2.6, 2.6, 1.6) + 5.0);
        v -= tear * (0.07 + 0.2 * smoothstep(-2.4, -0.3, t.z)) * ((fine - 0.5) * 2.4 + 0.25);
    }
    wo = wq;
    return vec2(v - th, n3(wq * 2.7 + 5.0));
}
// A screen direction (degrees, 0 = right, 90 = up) in the turning tunnel frame.
vec2 aimAt(float degrees) { float a = radians(degrees) + uTurn; return vec2(cos(a), sin(a)); }
// opacity: the body's own colour against the light through it (0: clear water, only refraction, rims and glints);
// foam: the body turns white and crumpled. The rim is a hairline that catches the light.
vec3 liquid(vec3 col, vec2 frag, vec2 uv, float amount, float k, float size, float density, float detail, float spread, float seed,
        float ribbon, float gloss, float refr, vec3 tint, vec3 edge, float r0, vec2 toLight, float rush, float tear, float opacity, float foam, float crinkle, float lean, vec2 aim, float clear) {
    // An amount above 1 floods: more of the field turns to liquid.
    density = min(density + max(amount - 1.0, 0.0) * 0.25, 1.4);
    float px = uH / 1080.0, feat = r0 * uH / k;
    vec3 wq, wx;
    vec2 f0 = field(tun(frag), k, size, density, detail, spread, seed, ribbon, rush, tear, lean, aim, wq), g, rip;
    // Normals: at high resolution the pixel quad's derivatives (one field per pixel); otherwise differences over a step
    // that scales a little with the feature.
    if (uH > 1600.0) {
        g = vec2(dFdx(f0.x), dFdy(f0.x)); rip = vec2(dFdx(f0.y), dFdy(f0.y));
        if (f0.x < -0.12) return col;
    } else {
        if (f0.x < -0.12) return col;
        float E = clamp(feat * 0.01, 1.0, 4.0 * px);
        vec2 fx = field(tun(frag + vec2(E, 0.0)), k, size, density, detail, spread, seed, ribbon, rush, tear, lean, aim, wx);
        vec2 fy = field(tun(frag + vec2(0.0, E)), k, size, density, detail, spread, seed, ribbon, rush, tear, lean, aim, wx);
        g = vec2(fx.x - f0.x, fy.x - f0.x) / E; rip = vec2(fx.y - f0.y, fy.y - f0.y) / E;
    }
    float gl = length(g) + 1e-6, d = f0.x / gl;
    float W = (2.0 + mix(24.0, 8.0, tear) * smoothstep(0.06, 0.9, r0)) * px * mix(1.0, 0.6, ribbon);
    float blur = 0.75 + ribbon * mix(5.0, 1.5, foam) * px * smoothstep(0.5, 1.2, r0);
    // clear: the radius around the focus the layer leaves open (the sheets fly past the light, the debris stays in it).
    float cov = smoothstep(-blur, blur, d) * clamp(amount, 0.0, 1.0) * smoothstep(0.01 + 0.4 * clear, 0.07 + clear, r0);
    if (cov <= 0.002) return col;
    float e = clamp(d / W, 0.0, 1.0);
    // Relief: the rounded rim, the body's own swell and fine ripples, each scaled to the feature size on screen; a
    // thin (torn) sheet bulges less at its rim.
    vec2 out2 = -g / gl, nxy = out2 * pow(1.0 - e, 1.5) * mix(2.0, 0.9, tear) - g * feat * 0.9 - rip * feat * mix(0.22, 0.4, tear);
    vec3 n = normalize(vec3(nxy, 1.0));
    vec2 off = n.xy * refr * (0.01 + 0.03 * e) * vec2(uRes.y / uRes.x, 1.0);
    vec3 behind = vec3(texture(uScene, uv - off * 1.08).r, texture(uScene, uv - off).g, texture(uScene, uv - off * 0.92).b);
    float F = 0.03 + 0.97 * pow(1.0 - n.z, 5.0);
    vec3 R = vec3(2.0 * n.z * n.xy, 2.0 * n.z * n.z - 1.0);
    float near = exp(-r0 * 2.6) * uLight;
    // HDR lights: a studio key and fill (bright, so a few percent of Fresnel reflection still clips to white), the light
    // behind seen in reflection, and that light through the thin rims (transmission).
    vec3 env = vec3(0.01, 0.025, 0.03) + tint * 0.3 * (0.5 + 0.5 * R.y)
        + edge * (smoothstep(0.86, 0.97, dot(R, KEY)) * 22.0 + smoothstep(0.9, 0.98, dot(R, normalize(vec3(0.6, -0.35, 0.72)))) * 9.0)
        + uLightCore * pow(max(dot(R, normalize(vec3(toLight, 0.5))), 0.0), 10.0) * (0.3 + near) * 8.0;
    float spec = pow(max(dot(n, normalize(KEY + vec3(0.0, 0.0, 1.0))), 0.0), 300.0) * 6.0;
    float back = pow(max(dot(out2, toLight), 0.0), 2.0) * pow(1.0 - e, 4.0) * (0.15 + 1.4 * near);
    float thick = clamp(f0.x * 6.0, 0.0, 1.0), mottle = smoothstep(0.3, 0.8, f0.y);
    vec3 body = behind * mix(vec3(1.0), tint * 1.4, (0.2 + 0.4 * e) * mix(0.5, 1.0, opacity)) * (1.0 - 0.2 * e * opacity)
        + tint * (0.1 + 0.75 * thick * (0.3 + 0.7 * mottle) + 0.35 * near * e) * (1.0 - ribbon * 0.7) * opacity
        + edge * ribbon * (0.06 + 0.12 * mottle + near * (0.1 + 0.7 * mottle * mottle)) * (0.3 + 0.7 * e);
    // The crumples of foam, shaded by a light from the upper left.
    float shade = 0.55 + 0.45 * clamp(dot(normalize(nxy + 1e-4), normalize(vec2(-0.5, 0.8))) * 0.5 + 0.5, 0.0, 1.0);
    // Crinkles: the surface broken into fine ripples - thin curved glints and specks, in patches (they fly with the water).
    if (crinkle > 0.001) {
        vec3 cq = wq * vec3(16.0, 16.0, 8.0) + vec3(0.0, 0.0, uTime * 0.6);
        float c1 = 1.0 - abs(2.0 * n3(cq) - 1.0), c2 = 1.0 - abs(2.0 * n3(cq * 2.3 + 4.0) - 1.0);
        float web = pow(c1, 14.0) * 0.7 + pow(c2, 18.0) * 0.7, zone = smoothstep(0.3, 0.7, n3(wq * 1.3 + 19.0));
        body += mix(tint * 2.5, edge, 0.55) * web * crinkle * (0.2 + 0.8 * zone) * (0.5 + 0.5 * e);
    }
    // Foam: in patches on a sheet, all over a ribbon.
    float foamy = foam * (ribbon > 0.5 ? 1.0 : smoothstep(0.6, 0.78, n3(wq * 0.9 + 31.0)));
    body = mix(body, edge * (0.8 + 0.6 * mottle) * shade * (1.0 + 0.6 * near), foamy * smoothstep(0.0, 2.0 * px, d));
    float rim = exp(-pow((d - 1.2 * px) / (0.9 * px), 2.0)) * (0.35 + 0.65 * pow(max(dot(out2, toLight), 0.0), 2.0)) * tear;
    vec3 lit = body * (1.0 - F) + env * F * gloss + edge * (spec * gloss + back * 1.3 + rim * (0.4 + 0.6 * gloss)) * max(amount, 1.0);
    return mix(col, lit, cov);
}
// A crumpled water lump at uLumpAt (frame heights from the focus): a refracting ball with a wobbling outline and
// crumpled glints, a milky core where it is thick.
vec3 lump(vec3 col, vec2 frag, float R) {
    vec2 c = uFocus + (uLumpAt + uLumpMove) * uH, d = frag - c;
    float dl0 = length(d) / R;
    if (dl0 > 1.6) return col;
    vec2 dir = d / max(length(d), 1e-3);
    float wob = 1.0 + uLumpWobble * (0.7 * (n3(vec3(dir * 1.6, uTime * 0.7)) - 0.5) + 0.35 * (n3(vec3(dir * 4.2 + 3.0, uTime * 1.1)) - 0.5));
    float dl = dl0 / wob, aa = 1.5 / R, cov = smoothstep(1.0, 1.0 - aa, dl);
    if (cov <= 0.0) return col;
    vec3 q = vec3(d / R * 1.6, uTime * 0.8);
    vec2 crum = vec2(n3(q + vec3(0.06, 0.0, 0.0)) - n3(q - vec3(0.06, 0.0, 0.0)), n3(q + vec3(0.0, 0.06, 0.0)) - n3(q - vec3(0.0, 0.06, 0.0))) * 7.0 * uLumpWobble;
    vec3 n = normalize(vec3(d / R / wob + crum, sqrt(max(0.0, 1.0 - dl * dl)) + 0.15));
    vec2 rs = vec2(textureSize(uScene, 0)), src = c - n.xy * R * (0.6 + 1.2 * uLumpRefr);
    vec3 behind = vec3(texture(uScene, (src + n.xy * R * 0.05) / rs).r, texture(uScene, src / rs).g, texture(uScene, (src - n.xy * R * 0.05) / rs).b);
    float F = pow(1.0 - n.z, 3.0), spec = pow(max(dot(n, normalize(KEY + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
    float milk = smoothstep(0.2, 0.9, n3(q * 0.7 + 7.0)) * (1.0 - dl * dl) * 0.5;
    // Milky and thick: it scatters much of the light behind it, so its soft folds read against a bright disc.
    float fold = clamp(dot(n.xy, vec2(-0.6, 0.8)) * 0.5 + 0.5, 0.0, 1.0), glint = pow(1.0 - abs(2.0 * n3(q * 2.0 + 3.0) - 1.0), 18.0);
    vec3 body = mix(behind * (0.75 - 0.3 * F), uLumpEdge * (0.45 + 0.55 * fold) + uLumpColor * 0.35, 0.6 + 0.35 * milk) + uLumpEdge * (spec * 1.5 + glint * 0.5);
    return mix(col, body, cov * clamp(uLump, 0.0, 1.0));
}
vec3 drops(vec3 col, vec2 uv, float u, float lr, float r0, float N, float rate, float seed, float depth) {
    float x = fract(u) * N, y = (lr - uTravel * rate) * N / TAU;
    vec2 c = floor(vec2(x, y));
    float cellPx = TAU * r0 * uH / N, stretch = 1.0 + uDropTrail * abs(uSpeed) * 0.3 * depth;
    float coc = uDropBokeh * abs(depth - uDropFocus) * cellPx * 0.07, amount = clamp(uDrop, 0.0, 1.0), density = uDropDensity * mix(1.0, 0.3, depth);
    float cluster = smoothstep(0.25, 0.62, n3(vec3(cos(u * TAU) * 1.3, sin(u * TAU) * 1.3, lr * 0.4 - uTravel * 0.3) + seed));
    float fade = smoothstep(0.015, 0.08, r0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 id = c + vec2(float(i), float(j)), key = vec2(mod(id.x, N), id.y);
        if (h12(key * 1.31 + seed) > density * (0.2 + 0.8 * cluster)) continue;
        vec2 rnd = h22(key + seed);
        vec2 dv = vec2(x - (id.x + 0.25 + 0.5 * rnd.x), (y - (id.y + 0.25 + 0.5 * rnd.y)) / stretch) * cellPx;
        float R = uDropSize * cellPx * (0.025 + 0.09 * h12(key + seed + 3.7)) + 0.5, Rb = R + coc, dl = length(dv);
        if (dl > Rb + 1.5) continue;
        float tone = h12(key + seed + 9.1), b = clamp(coc / (R * 1.5), 0.0, 1.0);
        vec3 tint = mix(uDropColor, uDropGlint, step(0.8, tone));
        float dd = dl / R;
        if (dd < 1.0 && b < 0.99) {
            vec3 n = vec3(dv / R, sqrt(1.0 - dd * dd));
            vec3 inside = texture(uScene, uv - dv * 4.0 / vec2(textureSize(uScene, 0))).rgb;
            float F = 0.04 + 0.96 * pow(1.0 - n.z, 4.0), spec = pow(max(dot(n, normalize(KEY + vec3(0.0, 0.0, 1.0))), 0.0), 50.0) * 3.0;
            vec3 s = inside * 0.2 + tint * (0.55 + 0.45 * n.z) + vec3(spec * 1.5);
            col = mix(col, s, smoothstep(1.0, 1.0 - 1.6 / R, dd) * (1.0 - b) * amount * fade);
        }
        if (b > 0.01) {
            float e = R / Rb, disc = smoothstep(Rb, Rb - 1.3, dl);
            col += tint * disc * (0.7 + 0.3 * smoothstep(0.5 * Rb, Rb, dl)) * max(e * e * 3.0, 0.3) * b * uDrop * 0.9 * fade;
        }
    }
    return col;
}
vec3 orb(vec3 col, vec2 frag, float R) {
    vec2 d = frag - uFocus;
    float dl = length(d) / R;
    if (dl > 1.2) return col;
    float aa = 1.5 / R, cov = smoothstep(1.0, 1.0 - aa, dl);
    vec3 n = vec3(d / R, sqrt(max(0.0, 1.0 - dl * dl)));
    vec2 src = uFocus - d * (0.9 + 0.9 * uOrbRefr) * (1.0 + 0.6 * dl * dl), rs = vec2(textureSize(uScene, 0));
    vec3 inside = vec3(texture(uScene, (src + d * 0.02) / rs).r, texture(uScene, src / rs).g, texture(uScene, (src - d * 0.02) / rs).b);
    float F = pow(1.0 - n.z, 3.0), spec = pow(max(dot(n, normalize(KEY + vec3(0.0, 0.0, 1.0))), 0.0), 500.0) * 0.8;
    vec2 gq = d / R * 11.0, gi = floor(gq), gr = h22(gi + floor(uTime * 8.0)), gd = fract(gq) - 0.2 - 0.6 * gr;
    float glit = exp(-dot(gd, gd) * 220.0) * step(0.6, h12(gi + 3.0 + floor(uTime * 3.0))) * uOrbGlitter * (1.0 - dl * 0.5);
    float rim = exp(-pow((dl - 1.0) / (aa * 1.3), 2.0)) * pow(n3(vec3(d / R * 2.4, uTime * 0.4)), 2.0) * 1.6;
    vec3 ball = inside * (0.9 - 0.3 * F) + uOrbColor * F * 0.8 + vec3(glit * 1.6 + spec);
    return mix(col, mix(col, ball, cov) + (uOrbColor * 0.6 + 0.25) * rim, clamp(uOrb, 0.0, 1.0));
}
void main() {
    vec2 frag = gl_FragCoord.xy, uv = frag / uRes;
    vec3 col = texture(uScene, uv).rgb;
    vec2 p = (frag - uFocus) / uH;
    float r0 = max(length(p), 1e-4), u = (atan(p.y, p.x) + uTurn) / TAU, lr = log(r0) - uZoom;
    vec2 toLight = -p / r0;
    if (uOrb > 0.001) col = orb(col, frag, uOrbRadius * uOrbSize * uH);
    // Liquid at 1..3 depths, drawn far to near: the sheets; a second, nearer layer (larger, faster, thinner); a third of
    // fine torn debris behind them.
    if (uLiq > 0.001) for (int i = 2; i >= 0; i--) {
        float fi = float(i), near = i == 1 ? 1.0 : 0.0, fine = i == 2 ? 1.0 : 0.0;
        if (fi >= uLiqLayers) continue;
        col = liquid(col, frag, uv, uLiq * (1.0 - 0.25 * near - 0.4 * fine), 2.0 * uLiqScale * (1.0 - 0.47 * near + 1.4 * fine), uLiqSize * (1.0 + near), uLiqDensity - 0.08 * near - 0.2 * fine, uLiqDetail, uLiqSpread, fi * 31.0, 0.0,
            uLiqGloss, uLiqRefr, uLiqColor, uLiqEdge, r0, toLight, 1.0 + 0.45 * near + 0.2 * fine, min(uLiqTear + 0.45 * fine, 1.0), uLiqOpacity * (1.0 - 0.35 * near - 0.5 * fine), uLiqFoam, uLiqCrinkle * (1.0 - fine), uLiqLean, aimAt(uLiqAngle), min(uLiqTear * 3.0, 1.0) * (0.22 + 0.1 * near) * (1.0 - fine));
    }
    if (uLump > 0.001) col = lump(col, frag, uLumpRadius * uLumpSize * uH);
    if (uDrop > 0.001) {
        col = drops(col, uv, u, lr, r0, 240.0, 1.0, 0.0, 0.05);
        col = drops(col, uv, u, lr, r0, 100.0, 1.25, 17.0, 0.45);
        col = drops(col, uv, u, lr, r0, 36.0, 1.6, 41.0, 1.0);
    }
    if (uSpl > 0.001) col = liquid(col, frag, uv, uSpl, 2.6 * uSplScale, uSplSize, uSplDensity, uSplDetail, uSplSpread, 23.0, 1.0, uSplGloss, uSplRefr, uSplColor, uSplEdge, r0, toLight,
        1.0, uSplTear, uSplOpacity, uSplFoam, uSplCrinkle, uSplLean, aimAt(uSplAngle), 0.0);
    outColor = vec4(col, 1.0);
}`;
    // Spray: `count` instanced quads, stateless - each particle's path is a function of its id and the clock. It leaves the
    // focus along a direction (a `lean` share inside the `spread` fan around `angle`), flies out exponentially (the rush's
    // perspective), grows with it and shrinks as it breaks up (`fall`), and is reborn after its life. Sizes follow a power
    // law (many fine drops, few large). In focus: a small refracting drop with a bright rim; fast ones are streaked along
    // their path by the shutter (`streak`); a `bokeh` share near the lens is a soft disc. The `spray` track shows that
    // share of the particles (above 1 they stay), `spraySize` scales them.
    const SPRAY_VERT = `#version 300 es
precision highp float;
uniform vec2 uRes, uFocus;
uniform float uH, uTime, uAmt, uSizeK, uCount, uSize, uFall, uSpeed, uStart, uLife, uSpread, uLean, uAngle, uStreak, uBokeh, uMist, uClump;
out vec2 vQ;
flat out vec4 vS;
flat out float vTone;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd(uint i, uint k) { return float(pcg(i * 16u + k)) / 4294967295.0; }
void main() {
    uint id = uint(gl_InstanceID);
    vS = vec4(0.0); vQ = vec2(0.0); vTone = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    if (float(gl_InstanceID) >= uCount * min(uAmt, 1.0)) return;
    // A clump: 32 particles torn off together - one birth, one direction, a spread of speeds (a jet that breaks up).
    uint g = rnd(id, 12u) < uClump ? 65536u + id / 32u : id;
    float life = uLife * (0.6 + 0.8 * rnd(g, 1u)), age = fract(rnd(g, 0u) + uTime / life) * life, f = age / life;
    bool mist = rnd(id, 2u) < uMist;
    float th = (rnd(g, 3u) < uLean ? radians(uAngle) + (rnd(g, 4u) - 0.5) * 6.2831853 * uSpread : rnd(g, 4u) * 6.2831853) + (g == id ? 0.0 : (rnd(id, 4u) - 0.5) * 0.12);
    float v = uSpeed * (0.35 + 1.3 * rnd(id, 5u) * rnd(id, 5u)) * (mist ? 0.3 : 1.0), grow = exp(v * age);
    float r = uStart * (0.25 + 0.75 * rnd(id, 6u)) * (mist ? 0.7 : 1.0) * grow;
    vec2 dir = vec2(cos(th), sin(th)), pos = uFocus + dir * r * uH;
    float px = uH / 1080.0;
    float R = uSize * uSizeK * px * min(pow(max(rnd(id, 7u), 1e-3), -1.0 / 2.2), 12.0) * (mist ? 0.5 : 1.0) * pow(grow, 0.3) * exp(-uFall * f);
    float L = v * r * uH / 48.0 * uStreak, hl = L > 2.0 * R ? 0.5 * L : 0.0;
    float coc = rnd(id, 8u) < uBokeh ? (5.0 + 9.0 * rnd(id, 9u)) * uSizeK * px : 0.0;
    if (coc > 0.0) { hl = 0.0; R = max(R, px); }
    float a = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.7, 1.0, f)) * smoothstep(0.02, 0.09, r) * (1.0 - smoothstep(0.9, 1.3, r)) * (0.25 + 0.75 * pow(rnd(id, 11u), 2.0));
    if (a <= 0.002) return;
    vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
    vec2 local = corner * vec2(hl + R + coc + 2.0, R + coc + 2.0);
    vec2 P = pos + dir * local.x + vec2(-dir.y, dir.x) * local.y;
    gl_Position = vec4(P / uRes * 2.0 - 1.0, 0.0, 1.0);
    vQ = local; vS = vec4(R, hl, coc, a); vTone = rnd(id, 10u);
}`;
    const SPRAY_FRAG = `#version 300 es
precision highp float;
uniform vec3 uColor, uGlint;
in vec2 vQ;
flat in vec4 vS;
flat in float vTone;
out vec4 outColor;
void main() {
    float R = vS.x, hl = vS.y, coc = vS.z, a = vS.w, d = length(vec2(max(abs(vQ.x) - hl, 0.0), vQ.y)), al;
    vec3 tint = mix(uColor, uGlint, step(0.85, vTone)), c;
    if (coc > 0.0) {
        float Rb = R + coc;
        al = smoothstep(Rb + 0.8, Rb - 0.8, d) * clamp(2.0 * R * R / (Rb * Rb) + 0.16, 0.0, 0.5);
        c = tint * (0.8 + 0.5 * smoothstep(0.6 * Rb, Rb, d));
    } else if (R < 3.0) {
        // A fine drop: a lit point (energy kept below a pixel).
        float s = max(R, 0.65);
        al = exp(-d * d / (s * s)) * min(1.0, 0.35 + 0.65 * R);
        c = tint * 1.2;
    } else {
        // A large drop: a refracting ball, lit at its rim and with a highlight.
        float dd = d / R, rim = smoothstep(0.5, 1.0, dd);
        float spec = exp(-pow(length(vQ - vec2(-0.3, 0.35) * R) / (0.3 * R), 2.0));
        al = smoothstep(1.0 + 0.8 / R, 1.0 - 0.8 / R, dd) * (0.6 + 0.4 * rim);
        c = tint * (0.45 + 0.7 * rim) + vec3(spec * 1.2);
    }
    // A streak spreads the drop's light along its path.
    if (hl > 0.0) al *= clamp(2.5 * R / (hl + R), 0.3, 1.0);
    al *= a;
    outColor = vec4(c * al, al * 0.55);
}`;
    // The baked plate over the scene: the scene is stored tone-mapped (1 - exp(-L)), so it is read back to light, refracted
    // through the plate (its shift image, with a little dispersion), held back by the plate's coverage (tinted where thick),
    // the plate's own light added (stored as L / (1 + L): HDR highlights survive 8 bits) and tone-mapped again.
    const PLATE = `#version 300 es
precision highp float;
uniform sampler2D uScene, uColor, uShift;
uniform vec2 uRes;
uniform vec4 uRect;
uniform float uH, uAmt, uRefr, uExp, uHasShift, uShiftMax, uShiftTexel;
uniform vec3 uTint;
out vec4 outColor;
vec3 lin(vec3 s) { return -log(max(1.0 - s, vec3(1.0 / 512.0))); }
void main() {
    vec2 frag = gl_FragCoord.xy, uv = frag / uRes, q = (frag - uRect.xy) / uRect.zw;
    vec3 s = texture(uScene, uv).rgb;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { outColor = vec4(s, 1.0); return; }
    vec2 t = vec2(q.x, 1.0 - q.y);
    vec4 c = texture(uColor, t);
    float k = min(uAmt, 1.0), a = clamp(c.a, 0.0, 1.0) * k;
    vec3 behind = lin(s);
    if (uHasShift > 0.5) {
        float x = clamp(t.x * 0.5, uShiftTexel, 0.5 - uShiftTexel);
        vec2 off = (vec2(texture(uShift, vec2(x, t.y)).r, texture(uShift, vec2(x + 0.5, t.y)).r) * 2.0 - 1.0) * uShiftMax * uRefr * k;
        vec2 o = off * uH / uRes;
        if (dot(o, o) > 1e-10) behind = vec3(lin(texture(uScene, uv + o * 1.07).rgb).r, lin(texture(uScene, uv + o).rgb).g, lin(texture(uScene, uv + o * 0.93).rgb).b);
    }
    vec3 T = (1.0 - a) * mix(vec3(1.0), uTint, a);
    vec3 L = behind * T + c.rgb / max(1.0 - c.rgb, vec3(1.0 / 96.0)) * uExp * uAmt;
    outColor = vec4(1.0 - exp(-L), 1.0);
}`;
    // Bloom: a bright pass, then a dual-filter (Kawase) pyramid down and back up; the up passes add into each level.
    const BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uTh;
out vec4 outColor;
void main() {
    vec2 uv = gl_FragCoord.xy * uTexel;
    vec3 s = texture(uSrc, uv).rgb;
    float l = max(s.r, max(s.g, s.b));
    outColor = vec4(s * smoothstep(uTh, uTh + 0.3 * (1.0 - uTh) + 0.02, l), 1.0);
}`;
    const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel, uSrcTexel;
out vec4 outColor;
void main() {
    vec2 uv = gl_FragCoord.xy * uTexel, h = uSrcTexel;
    vec3 s = texture(uSrc, uv).rgb * 4.0 + texture(uSrc, uv + vec2(-h.x, -h.y)).rgb + texture(uSrc, uv + vec2(h.x, -h.y)).rgb
        + texture(uSrc, uv + vec2(-h.x, h.y)).rgb + texture(uSrc, uv + h).rgb;
    outColor = vec4(s / 8.0, 1.0);
}`;
    const UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel, uSrcTexel;
uniform float uGain;
out vec4 outColor;
void main() {
    vec2 uv = gl_FragCoord.xy * uTexel, h = uSrcTexel;
    vec3 s = texture(uSrc, uv + vec2(-2.0 * h.x, 0.0)).rgb + texture(uSrc, uv + vec2(2.0 * h.x, 0.0)).rgb
        + texture(uSrc, uv + vec2(0.0, -2.0 * h.y)).rgb + texture(uSrc, uv + vec2(0.0, 2.0 * h.y)).rgb
        + (texture(uSrc, uv + vec2(-h.x, h.y)).rgb + texture(uSrc, uv + vec2(h.x, h.y)).rgb + texture(uSrc, uv + vec2(-h.x, -h.y)).rgb + texture(uSrc, uv + vec2(h.x, -h.y)).rgb) * 2.0;
    outColor = vec4(s / 12.0 * uGain, 1.0);
}`;
    // Light shafts: the bright quarter-resolution image near the focus, gathered along the ray toward it with a decaying weight
    // (jittered per pixel, so it reads as scattered light rather than as distinct rays). Whatever covers the light holds
    // its shafts back, the gaps between let them through.
    const SHAFTS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel, uLight;
uniform float uLength, uAspect;
out vec4 outColor;
${HASH}
void main() {
    vec2 uv = gl_FragCoord.xy * uTexel, d = (uv - uLight) * uLength / 32.0, p = uv - d * h12(gl_FragCoord.xy);
    vec3 acc = vec3(0.0);
    float w = 1.0;
    for (int i = 0; i < 32; i++) {
        vec2 r = (p - uLight) * vec2(uAspect, 1.0);
        acc += texture(uSrc, p).rgb * w * exp(-dot(r, r) * 9.0);
        w *= 0.94; p -= d;
    }
    outColor = vec4(acc / 12.0, 1.0);
}`;
    function program(source, vertex) {
        const id = gl.createProgram();
        for (const [type, text] of [[gl.VERTEX_SHADER, vertex || VERT], [gl.FRAGMENT_SHADER, source]]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, text); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('Entrance shader: ' + gl.getShaderInfoLog(shader));
            gl.attachShader(id, shader); gl.deleteShader(shader);
        }
        gl.linkProgram(id);
        if (!gl.getProgramParameter(id, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Entrance program: ' + gl.getProgramInfoLog(id));
        return {id, locs: new Map()};
    }
    const layersIn = name => Object.prototype.hasOwnProperty.call(doc.layers, name);
    const wet = ['orb', 'liquid', 'splash', 'droplets', 'lump', 'spray'].some(layersIn);
    const scene = program(SCENE), post = program(POST), water = wet ? program(WATER) : null, spray = layersIn('spray') ? program(SPRAY_FRAG, SPRAY_VERT) : null;
    const plateDoc = layersIn('plate') ? doc.layers.plate : null, plate = plateDoc ? program(PLATE) : null;
    const glowing = layersIn('bloom') || layersIn('shafts');
    const bright = glowing ? program(BRIGHT) : null, down = glowing ? program(DOWN) : null, up = glowing ? program(UP) : null, shafts = layersIn('shafts') ? program(SHAFTS) : null;
    function uniforms(target, values) {
        for (const [name, value] of Object.entries(values)) {
            if (!target.locs.has(name)) target.locs.set(name, gl.getUniformLocation(target.id, name));
            const at = target.locs.get(name);
            if (at === null) continue;
            if (typeof value === 'number') gl.uniform1f(at, value);
            else if (value.length === 2) gl.uniform2f(at, value[0], value[1]);
            else if (value.length === 4) gl.uniform4f(at, value[0], value[1], value[2], value[3]);
            else gl.uniform3f(at, value[0], value[1], value[2]);
        }
    }
    // A tiling 64^3 value-noise volume (fixed seed): one trilinear fetch per octave. Half-float, so the filtered value is
    // not stepped to 8 bits (the water pass takes surface normals from 1-pixel differences of it).
    const noise = gl.createTexture(), cells = new Float32Array(64 * 64 * 64);
    let seed = 0x2f6b3a1d;
    for (let i = 0; i < cells.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; cells[i] = (seed >>> 24) / 255; }
    gl.bindTexture(gl.TEXTURE_3D, noise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 64, 64, 64, 0, gl.RED, gl.FLOAT, cells);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // scene -> frame; the plate and then the water pass (when the document has them) ping-pong between frame and wetFrame;
    // bloom and shafts read the result at lower resolutions; post -> the canvas.
    const pingPong = wet || !!plateDoc;
    const frame = gl.createTexture(), fbo = gl.createFramebuffer(), wetFrame = pingPong ? gl.createTexture() : null, wetFbo = pingPong ? gl.createFramebuffer() : null;
    // Bloom levels at 1/2 .. 1/64 (half-float where it can be rendered to: no banding in the soft tails).
    const halfFloat = glowing && !!gl.getExtension('EXT_color_buffer_float');
    const levels = glowing ? Array.from({length: 6}, () => ({texture: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0})) : [];
    const shaftTarget = shafts ? {texture: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0} : null;
    let width = 0, height = 0;
    function target(texture, buffer, w, h, float) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }
    function size(w, h) {
        if (w === width && h === height) return;
        width = w; height = h; canvas.width = w; canvas.height = h;
        target(frame, fbo, w, h);
        if (pingPong) target(wetFrame, wetFbo, w, h);
        levels.forEach((level, i) => { level.w = Math.max(1, w >> (i + 1)); level.h = Math.max(1, h >> (i + 1)); target(level.texture, level.fbo, level.w, level.h, halfFloat); });
        if (shaftTarget) { shaftTarget.w = levels[1].w; shaftTarget.h = levels[1].h; target(shaftTarget.texture, shaftTarget.fbo, shaftTarget.w, shaftTarget.h, halfFloat); }
    }
    // The plate's frames: `media` decodes them ahead (entrancePlateFrames); the frame shown is uploaded once when it
    // changes. A frame not decoded in time keeps the last one on screen.
    let media = null, plateShown = -1, shiftWidth = 2;
    const plateColor = plateDoc ? gl.createTexture() : null, plateShift = plateDoc && plateDoc.shift !== undefined ? gl.createTexture() : null;
    function upload(texture, image, gray) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (gray) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, image.width, image.height, 0, gl.RED, gl.UNSIGNED_BYTE, image);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
        for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    function plateFrame(index) {
        const ready = media ? media.want(index) : null;
        if (ready && index !== plateShown) {
            upload(plateColor, ready.color, false);
            if (plateShift && ready.shift) { upload(plateShift, ready.shift, true); shiftWidth = ready.shift.width; }
            plateShown = index;
        }
        return plateShown >= 0;
    }
    const hex = name => [1, 3, 5].map(i => parseInt(doc.palette[name].slice(i, i + 2), 16) / 255);
    const layers = doc.layers;
    const num = (layer, key, fallback) => layers[layer] && typeof layers[layer][key] === 'number' ? layers[layer][key] : fallback;
    const color = (layer, key, fallback) => layers[layer] && layers[layer][key] ? hex(layers[layer][key]) : fallback;
    const white = [1, 1, 1], wall = color('walls', 'color', white);
    const fixed = {uVoid: hex(doc.background),
        uLightColor: color('light', 'color', white), uLightCore: color('light', 'core', color('light', 'color', white)), uLightRadius: num('light', 'radius', 0.03), uLightHalo: num('light', 'halo', 1), uLightLobes: num('light', 'lobes', 0),
        uDustColor: color('dust', 'color', white), uDustDensity: num('dust', 'density', 0.3), uDustSize: num('dust', 'size', 1), uDustTrail: num('dust', 'trail', 1), uDustCluster: num('dust', 'cluster', 0), uDustSpread: num('dust', 'spread', 0),
        uFilColor: color('filaments', 'color', white), uFilDensity: num('filaments', 'density', 0.4), uFilCurl: num('filaments', 'curl', 1), uFilWidth: num('filaments', 'width', 1), uFilLength: num('filaments', 'length', 0.6),
        uRingColor: color('rings', 'color', white), uRingRadius: num('rings', 'radius', 0.15), uRingWidth: num('rings', 'width', 0.01), uRingCount: num('rings', 'count', 2),
        uStreamColor: color('streams', 'color', white), uStreamCount: num('streams', 'count', 96), uStreamLength: num('streams', 'length', 0.4), uStreamWidth: num('streams', 'width', 1),
        uWallColor: wall, uWallDeep: color('walls', 'deep', wall.map(v => v * 0.3)), uWallScale: num('walls', 'scale', 1),
        uCausticColor: color('caustics', 'color', white), uCausticScale: num('caustics', 'scale', 1),
        uShardColor: color('shards', 'color', white), uShardEdge: color('shards', 'edge', white), uShardDensity: num('shards', 'density', 0.4), uShardScale: num('shards', 'scale', 1), uShardWarp: num('shards', 'warp', 0.6), uShardFill: num('shards', 'fill', 0.6),
        uFilmScale: num('film', 'scale', 1), uFilmSat: num('film', 'saturation', 1), uFilmCoverage: num('film', 'coverage', 0.5), uFlareColor: color('flare', 'color', white), uFlareRays: num('flare', 'rays', 8),
        uLightDiscColor: color('light', 'disc', color('light', 'core', color('light', 'color', white))), uLightDiscSize: num('light', 'discSize', 1.3)};
    const wetFixed = {uLightCore: fixed.uLightCore,
        uLiqColor: color('liquid', 'color', white), uLiqEdge: color('liquid', 'edge', white), uLiqDensity: num('liquid', 'density', 0.5), uLiqScale: num('liquid', 'scale', 1), uLiqDetail: num('liquid', 'detail', 0.5), uLiqGloss: num('liquid', 'gloss', 1), uLiqRefr: num('liquid', 'refraction', 1), uLiqSpread: num('liquid', 'spread', 0.5),
        uLiqTear: num('liquid', 'tear', 0), uLiqOpacity: num('liquid', 'opacity', 1), uLiqLayers: num('liquid', 'layers', 1), uLiqLean: num('liquid', 'lean', 0), uLiqAngle: num('liquid', 'angle', 0), uLiqFoam: num('liquid', 'foam', 0), uLiqCrinkle: num('liquid', 'crinkle', 0),
        uSplColor: color('splash', 'color', white), uSplEdge: color('splash', 'edge', white), uSplDensity: num('splash', 'density', 0.5), uSplScale: num('splash', 'scale', 1), uSplDetail: num('splash', 'detail', 0.3), uSplGloss: num('splash', 'gloss', 1.5), uSplRefr: num('splash', 'refraction', 1), uSplSpread: num('splash', 'spread', 0.5),
        uSplTear: num('splash', 'tear', 0), uSplOpacity: num('splash', 'opacity', 1), uSplFoam: num('splash', 'foam', 0), uSplLean: num('splash', 'lean', 0), uSplAngle: num('splash', 'angle', 0), uSplCrinkle: num('splash', 'crinkle', 0), uSplCells: num('splash', 'cells', 0),
        uLumpColor: color('lump', 'color', white), uLumpEdge: color('lump', 'edge', white), uLumpRadius: num('lump', 'radius', 0.1), uLumpAt: [num('lump', 'x', 0), num('lump', 'y', 0)], uLumpWobble: num('lump', 'wobble', 0.5), uLumpRefr: num('lump', 'refraction', 1),
        uDropColor: color('droplets', 'color', white), uDropGlint: color('droplets', 'glint', color('droplets', 'color', white)), uDropDensity: num('droplets', 'density', 0.4), uDropSize: num('droplets', 'size', 1), uDropFocus: num('droplets', 'focus', 0.3), uDropBokeh: num('droplets', 'bokeh', 1), uDropTrail: num('droplets', 'trail', 1),
        uOrbColor: color('orb', 'color', white), uOrbRadius: num('orb', 'radius', 0.15), uOrbRefr: num('orb', 'refraction', 1), uOrbGlitter: num('orb', 'glitter', 0.5)};
    const sprayFixed = {uColor: color('spray', 'color', white), uGlint: color('spray', 'glint', color('spray', 'color', white)), uCount: num('spray', 'count', 1024), uSize: num('spray', 'size', 1),
        uFall: num('spray', 'fall', 1), uSpeed: num('spray', 'speed', 1), uStart: num('spray', 'start', 0.08), uLife: num('spray', 'life', 1.5), uSpread: num('spray', 'spread', 0.25), uLean: num('spray', 'lean', 0),
        uAngle: num('spray', 'angle', 0), uStreak: num('spray', 'streak', 1), uBokeh: num('spray', 'bokeh', 0.05), uMist: num('spray', 'mist', 0), uClump: num('spray', 'clump', 0)};
    const finish = {uGrain: num('grain', 'amount', 0), uVig: num('vignette', 'amount', 0), uVigColor: color('vignette', 'color', hex(doc.background)), uFlashColor: color('flash', 'color', white),
        uBloomColor: color('bloom', 'color', white), uShaftColor: color('shafts', 'color', white)};
    const plateFixed = plateDoc ? {uRefr: num('plate', 'refraction', 1), uExp: num('plate', 'exposure', 1), uHasShift: plateShift ? 1 : 0, uShiftMax: num('plate', 'shift', 0.1),
        uTint: color('plate', 'tint', white)} : null;
    const aberration = num('aberration', 'amount', 0);
    let fixedSet = false, wetSet = false, spraySet = false;
    // One full-screen pass of `prog` into `fbo` (null: the canvas) of w x h with its textures on units 0.. and its uniforms.
    function pass(prog, buffer, w, h, textures, values) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer); gl.viewport(0, 0, w, h); gl.useProgram(prog.id);
        textures.forEach(([name, texture], unit) => {
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
            if (!prog.locs.has(name)) prog.locs.set(name, gl.getUniformLocation(prog.id, name));
            gl.uniform1i(prog.locs.get(name), unit);
        });
        uniforms(prog, values);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
    }
    // Bloom and shafts from `source` (the composited frame): leaves the bloom in levels[0], the shafts in shaftTarget.
    function glow(source, v, focus, frameH) {
        const th = num('bloom', 'threshold', num('shafts', 'threshold', 0.75)), radius = num('bloom', 'radius', 0.06) * frameH;
        // As many levels as the radius needs (each doubles the reach), at least two.
        const count = Math.max(2, Math.min(levels.length, Math.ceil(Math.log2(Math.max(4, radius)))));
        pass(bright, levels[0].fbo, levels[0].w, levels[0].h, [['uSrc', source]], {uTexel: [1 / levels[0].w, 1 / levels[0].h], uTh: th});
        for (let i = 1; i < count; i++) {
            const from = levels[i - 1], to = levels[i];
            pass(down, to.fbo, to.w, to.h, [['uSrc', from.texture]], {uTexel: [1 / to.w, 1 / to.h], uSrcTexel: [0.5 / from.w, 0.5 / from.h]});
            if (i === 1 && shafts && v.shafts > 0.001) {
                const s = shaftTarget;
                pass(shafts, s.fbo, s.w, s.h, [['uSrc', to.texture]], {uTexel: [1 / s.w, 1 / s.h], uLight: [focus[0] / width, focus[1] / height],
                    uLength: num('shafts', 'length', 0.5), uAspect: width / height});
            }
        }
        if (layersIn('bloom') && v.bloom > 0.001) {
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
            for (let i = count - 1; i > 0; i--) {
                const from = levels[i], to = levels[i - 1];
                // The finest level is replaced, not added to: the glow is all blur, the sharp bright pass is not doubled.
                if (i === 1) gl.disable(gl.BLEND);
                pass(up, to.fbo, to.w, to.h, [['uSrc', from.texture]], {uTexel: [1 / to.w, 1 / to.h], uSrcTexel: [0.5 / from.w, 0.5 / from.h], uGain: 1});
            }
            gl.disable(gl.BLEND);
        }
    }
    function draw(shown) {
        const v = shown.values, frameH = Math.max(height, width * 9 / 16);
        const focus = [width / 2 + (doc.focus[0] + (v.panX || 0) - 0.5) * frameH * 16 / 9, height / 2 - (doc.focus[1] + (v.panY || 0) - 0.5) * frameH], time = shown.clock / 1000;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, width, height); gl.useProgram(scene.id);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, noise);
        if (!fixedSet) { uniforms(scene, fixed); gl.uniform1i(gl.getUniformLocation(scene.id, 'uNoise'), 0); }
        uniforms(scene, {uFocus: focus, uH: frameH, uTime: time, uTravel: shown.travel, uTurn: shown.turn, uSpeed: v.speed, uZoom: v.zoom, uExposure: v.exposure,
            uLight: v.light, uLightSize: v.lightSize, uLightMix: v.lightMix, uLightEdge: v.lightEdge, uLightDisc: v.lightDisc || 0, uDust: v.dust, uFil: v.filaments, uRings: v.rings, uRingSize: v.ringSize, uStreams: v.streams,
            uWalls: v.walls, uCaustics: v.caustics, uShards: v.shards, uShardSize: v.shardSize, uFilm: v.film, uFlare: v.flare});
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // The ping-pong: `source` holds the frame so far, `other` is the next target.
        let source = frame;
        const other = () => source === frame ? [wetFrame, wetFbo] : [frame, fbo];
        if (plate && plateFrame(shown.plateFrame || 0) && v.plate > 0.001) {
            // The plate covers the 16:9 frame like the scene and follows the camera's pan by its parallax.
            const frameW = frameH * 16 / 9, k = num('plate', 'parallax', 1);
            const rect = [(width - frameW) / 2 + (v.panX || 0) * k * frameW, (height - frameH) / 2 - (v.panY || 0) * k * frameH, frameW, frameH];
            const [texture, buffer] = other();
            pass(plate, buffer, width, height, [['uScene', source], ['uColor', plateColor], ['uShift', plateShift || plateColor]],
                {...plateFixed, uRes: [width, height], uRect: rect, uH: frameH, uAmt: v.plate, uShiftTexel: 0.5 / shiftWidth});
            source = texture;
        }
        const wetNow = wet && (v.orb || 0) + (v.liquid || 0) + (v.splash || 0) + (v.droplets || 0) + v.lump + (spray ? v.spray : 0) > 0.001;
        if (wetNow) {
            const [texture, buffer] = other();
            gl.bindFramebuffer(gl.FRAMEBUFFER, buffer); gl.viewport(0, 0, width, height); gl.useProgram(water.id);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, noise);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, source);
            source = texture;
            if (!wetSet) { uniforms(water, wetFixed); gl.uniform1i(gl.getUniformLocation(water.id, 'uNoise'), 0); gl.uniform1i(gl.getUniformLocation(water.id, 'uScene'), 1); wetSet = true; }
            uniforms(water, {uRes: [width, height], uFocus: focus, uH: frameH, uTime: time, uTravel: shown.travel, uTurn: shown.turn, uSpeed: v.speed, uZoom: v.zoom, uLight: v.light,
                uOrb: v.orb, uOrbSize: v.orbSize, uLiq: v.liquid, uLiqSize: v.liquidSize, uSpl: v.splash, uSplSize: v.splashSize, uDrop: v.droplets, uLump: v.lump, uLumpSize: v.lumpSize, uLumpMove: [v.lumpX, v.lumpY]});
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.activeTexture(gl.TEXTURE0);
            if (spray && v.spray > 0.001) {
                gl.useProgram(spray.id);
                if (!spraySet) { uniforms(spray, sprayFixed); spraySet = true; }
                uniforms(spray, {uRes: [width, height], uFocus: focus, uH: frameH, uTime: time, uAmt: v.spray, uSizeK: v.spraySize});
                gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprayFixed.uCount);
                gl.disable(gl.BLEND);
            }
        }
        const bloomAmt = layersIn('bloom') ? num('bloom', 'amount', 1) * (v.bloom || 0) : 0, shaftAmt = shafts ? num('shafts', 'amount', 1) * (v.shafts || 0) : 0;
        if (glowing && bloomAmt + shaftAmt > 0.001) glow(source, v, focus, frameH);
        pass(post, null, width, height, [['uScene', source], ['uBloom', glowing ? levels[0].texture : source], ['uShafts', shaftTarget ? shaftTarget.texture : source]],
            {...(fixedSet ? {} : finish), uRes: [width, height], uFocus: focus, uBlur: v.blur, uAb: aberration * v.aberration, uFlash: v.flash, uFade: v.fade, uTime: time, uBloomAmt: bloomAmt, uShaftAmt: shaftAmt});
        fixedSet = true;
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        gl.deleteProgram(scene.id); gl.deleteProgram(post.id); gl.deleteTexture(noise); gl.deleteTexture(frame); gl.deleteFramebuffer(fbo);
        if (pingPong) { gl.deleteTexture(wetFrame); gl.deleteFramebuffer(wetFbo); }
        if (wet) gl.deleteProgram(water.id);
        if (spray) gl.deleteProgram(spray.id);
        for (const prog of [plate, bright, down, up, shafts]) if (prog) gl.deleteProgram(prog.id);
        for (const level of [...levels, shaftTarget].filter(Boolean)) { gl.deleteTexture(level.texture); gl.deleteFramebuffer(level.fbo); }
        for (const texture of [plateColor, plateShift]) if (texture) gl.deleteTexture(texture);
        if (media) media.dispose();
    }
    // media: the plate's frame source (entrancePlateFrames), once its files have arrived.
    return {size(...args) {if (!disposed) size(...args);}, draw(...args) {if (!disposed) draw(...args);}, dispose, gl,
        media(source) {if (disposed) {source.dispose();return;} if (media && media !== source) media.dispose();media = source; }};
}


if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={entranceRenderer};
