// fixed first-party WebGL2 compositor for keyframe layers. One canvas per
// placement; textures are uploaded once from the owner's decoded images. Pack data never reaches a shader as code.
const KEYFRAME_VERTEX = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uView;
out vec2 vUv;
out vec2 vRef;
void main() {
  vec3 ref = uMatrix * vec3(aPos, 1.0);
  vUv = aPos; vRef = ref.xy;
  gl_Position = vec4((uView * vec3(ref.xy, 1.0)).xy, 0.0, 1.0);
}`;
const KEYFRAME_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vRef;
uniform sampler2D uTex;
uniform sampler2D uDissolveTex;
uniform sampler2D uMaskTex;
uniform int uSolid;
uniform vec3 uColor;
uniform float uAlpha;
uniform int uDissolve;
uniform int uChannel;
uniform int uInvert;
uniform float uThreshold;
uniform float uSoftness;
uniform int uMask;
uniform mat3 uMaskInverse;
uniform float uMaskAlpha;
uniform float uGain;
uniform vec4 uWave;
uniform float uTime;
out vec4 outColor;
void main() {
  vec4 source = uSolid == 1 ? vec4(1.0) : texture(uTex, vUv);
  if (uSolid == 2) source = vec4(source.a); // text: glyph coverage, coloured by the layer tint
  float alpha = uAlpha;
  if (uDissolve == 1) {
    vec4 d = texture(uDissolveTex, vUv);
    float m = uChannel == 1 ? d.a : d.r;
    if (uInvert == 1) m = 1.0 - m;
    alpha *= uThreshold <= 0.0 ? 1.0 : uThreshold >= 1.0 ? 0.0 :
      uSoftness > 0.0 ? smoothstep(uThreshold - uSoftness * 0.5, uThreshold + uSoftness * 0.5, m) : step(uThreshold, m);
  }
  if (uMask == 1) {
    vec2 mu = (uMaskInverse * vec3(vRef, 1.0)).xy;
    alpha *= any(lessThan(mu, vec2(0.0))) || any(greaterThan(mu, vec2(1.0))) ? 0.0 : texture(uMaskTex, mu).a * uMaskAlpha;
  }
  outColor = vec4(source.rgb * uColor, source.a) * alpha;
  // Additive glow: gain (may exceed 1) and an optional travelling sine across u (cycles, Hz, phase), negative half dropped.
  float glow = uGain * (uWave.x > 0.5 ? max(0.0, sin(6.2831853 * (uWave.y * vUv.x + uWave.z * uTime + uWave.w))) : 1.0);
  outColor.rgb *= glow;
}`;
function createKeyframeCompositor(canvas) {
    const gl = canvas.getContext('webgl2', {alpha:true, premultipliedAlpha:true, antialias:true, depth:false, stencil:false, preserveDrawingBuffer:false});
    if (!gl) throw new Error('WebGL2 is unavailable for keyframe layers');
    const shader = (type, text) => {
        const value = gl.createShader(type); gl.shaderSource(value, text); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
        return value;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, KEYFRAME_VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, KEYFRAME_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const u = Object.fromEntries(['uMatrix','uView','uTex','uDissolveTex','uMaskTex','uSolid','uColor','uAlpha','uDissolve','uChannel','uInvert','uThreshold','uSoftness','uMask','uMaskInverse','uMaskAlpha','uGain','uWave','uTime']
        .map(name => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uDissolveTex, 1); gl.uniform1i(u.uMaskTex, 2);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    const textures = new Map();
    // Colour layers are premultiplied; dissolve maps keep their raw channel values.
    function texture(source, premultiplied) {
        const key = premultiplied ? 'p' : 'r';
        let entry = textures.get(source);
        if (entry?.[key]) return entry[key];
        const value = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, wrap, gl.CLAMP_TO_EDGE);
        entry ||= {}; entry[key] = value; textures.set(source, entry);
        return value;
    }
    // Multiply keeps the destination alpha: it darkens the composite below it and never paints over empty canvas.
    // Add keeps it too: light is added (Unity Blend SrcAlpha One) and never occludes the stage under the canvas.
    const blends = {normal:[gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA], add:[gl.ONE, gl.ONE, gl.ZERO, gl.ONE],
        multiply:[gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE], screen:[gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]};
    return {
        prepare(sources) { for (const [source, premultiplied] of sources) texture(source, premultiplied); },
        // view: {width, height} in device px; the 1600×900 reference canvas is contained and centred.
        draw(draws, {width, height}) {
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
            gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            const scale = Math.min(width / 1600, height / 900), ox = (width - 1600 * scale) / 2, oy = (height - 900 * scale) / 2;
            gl.uniformMatrix3fv(u.uView, false, [2 * scale / width, 0, 0, 0, -2 * scale / height, 0, 2 * ox / width - 1, 1 - 2 * oy / height, 1]);
            for (const draw of draws) {
                const {layer} = draw;
                gl.blendFuncSeparate(...blends[layer.blend]);
                gl.uniformMatrix3fv(u.uMatrix, false, draw.matrix);
                gl.uniform1i(u.uSolid, layer.kind === 'solid' ? 1 : layer.kind === 'text' ? 2 : 0);
                if (layer.kind !== 'solid') { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.layer(layer), true)); }
                gl.uniform3fv(u.uColor, draw.color); gl.uniform1f(u.uAlpha, draw.alpha);
                const wave = layer.glow?.wave;
                gl.uniform1f(u.uGain, layer.glow ? draw.gain : 1); gl.uniform1f(u.uTime, draw.time || 0);
                gl.uniform4f(u.uWave, wave ? 1 : 0, wave?.cycles || 0, wave?.hz || 0, wave?.phase || 0);
                gl.uniform1i(u.uDissolve, layer.dissolve ? 1 : 0);
                if (layer.dissolve) {
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.file(layer.dissolve.image), false));
                    gl.uniform1i(u.uChannel, layer.dissolve.channel === 'alpha' ? 1 : 0); gl.uniform1i(u.uInvert, layer.dissolve.invert ? 1 : 0);
                    gl.uniform1f(u.uThreshold, draw.threshold); gl.uniform1f(u.uSoftness, layer.dissolve.softness || 0);
                }
                gl.uniform1i(u.uMask, draw.mask ? 1 : 0);
                if (draw.mask) {
                    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.layer(draw.mask.layer), true));
                    gl.uniformMatrix3fv(u.uMaskInverse, false, draw.mask.inverse); gl.uniform1f(u.uMaskAlpha, draw.mask.alpha);
                }
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        },
        clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
        release(sources) {
            for (const source of sources) { const entry = textures.get(source); if (!entry) continue; for (const value of Object.values(entry)) gl.deleteTexture(value); textures.delete(source); }
        },
        dispose() {
            for (const entry of textures.values()) for (const value of Object.values(entry)) gl.deleteTexture(value);
            textures.clear(); gl.deleteBuffer(buffer); gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width = canvas.height = 0;
        }
    };
}
