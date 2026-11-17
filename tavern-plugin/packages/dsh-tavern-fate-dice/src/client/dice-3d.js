/* ------------------------------------------------------------------ *
 * dice-3d.js —— 零依赖 WebGL2 RGBA16F HDR 3D 投骰舞台 & 长按按钮蓄力引擎
 * 架构亮点：
 * 1. 全局共享离屏 WebGL2 渲染器（全酒馆会话最多仅占用 2 个共享缓冲，杜绝多楼层上下文溢出）
 * 2. 2048px 四通道高对比暗槽描边雕文图集（大号 900 字重 + 抗镜面眩光 + 零辉光糊字）
 * 3. 手动重投/自由骰按钮支持「长按聚能旋涡蓄力 → 松手爆发投掷 / 移出无损取消」
 * 4. 静止后将 3D 画面固化至轻量 2D 画布，实现 0% CPU / 0% GPU 休眠省电
 * ------------------------------------------------------------------ */

const FD3D = (() => {

// ============================================================================
// demo/gl-meshes.js — 高精度倒角多面体 WebGL2 网格库 + 高对比抗眩光雕文图集生成器
// 图集 RGBA 四通道编码（2048x2048，专为极致数字可读性与 PBR 凹凸光影设计）：
//   R = 锐利超粗字形核心蒙版 (Crisp Extra-Bold Mask)
//   G = 暗槽描边衬底环 (High-Contrast Outline Moat) —— 彻底隔绝背景花纹干扰！
//   B = 凹槽斜向受光凹凸偏导 (Directional Bevel Slope -> 0..1)
//   A = 柔和外发光能量晕 (Soft Outer Halo)
// ============================================================================

function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s] }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}
function vNorm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

const ATLAS_GRID = 8
const TILE_PX = 256

const GLYPH_TILE_MAP = Object.freeze({
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, '11': 11, '12': 12, '13': 13, '14': 14, '15': 15,
  '16': 16, '17': 17, '18': 18, '19': 19, '20': 20,
  '00': 21, '20_d': 22, '30': 23, '40': 24, '50': 25, '60': 26, '70': 27, '80': 28, '90': 29, '10_d': 30,
  'pip_1': 31, 'pip_2': 32, 'pip_3': 33, 'pip_4': 34, 'pip_5': 35, 'pip_6': 36,
  '+': 37, '−': 38, '◯': 39,
  '?': 40
})

function buildEngravedAtlasCanvas() {
  const size = ATLAS_GRID * TILE_PX
  const maskCv = document.createElement('canvas')
  maskCv.width = size
  maskCv.height = size
  const mctx = maskCv.getContext('2d', { willReadFrequently: true })

  const moatCv = document.createElement('canvas')
  moatCv.width = size
  moatCv.height = size
  const octx = moatCv.getContext('2d', { willReadFrequently: true })

  const haloCv = document.createElement('canvas')
  haloCv.width = size
  haloCv.height = size
  const hctx = haloCv.getContext('2d', { willReadFrequently: true })

  mctx.clearRect(0, 0, size, size)
  octx.clearRect(0, 0, size, size)
  hctx.clearRect(0, 0, size, size)

  const entries = [
    ...Array.from({ length: 21 }, (_, i) => ({ id: i, text: String(i), underline: i === 6 || i === 9, crown: i === 20 })),
    { id: 21, text: '00' }, { id: 22, text: '20' }, { id: 23, text: '30' }, { id: 24, text: '40' },
    { id: 25, text: '50' }, { id: 26, text: '60' }, { id: 27, text: '70' }, { id: 28, text: '80' },
    { id: 29, text: '90' }, { id: 30, text: '10' },
    { id: 31, pip: 1 }, { id: 32, pip: 2 }, { id: 33, pip: 3 },
    { id: 34, pip: 4 }, { id: 35, pip: 5 }, { id: 36, pip: 6 },
    { id: 37, text: '+' }, { id: 38, text: '−' }, { id: 39, fateBlank: true },
    { id: 40, eyeSeal: true }
  ]

  const PIP_COORDS = {
    1: [[0, 0]],
    2: [[-0.44, -0.44], [0.44, 0.44]],
    3: [[-0.48, -0.48], [0, 0], [0.48, 0.48]],
    4: [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]],
    5: [[-0.46, -0.46], [0.46, -0.46], [0, 0], [-0.46, 0.46], [0.46, 0.46]],
    6: [[-0.42, -0.50], [0.42, -0.50], [-0.42, 0], [0.42, 0], [-0.42, 0.50], [0.42, 0.50]]
  }

  // mode: 'mask' | 'moat' | 'halo'
  function drawGlyphPass(ctx, mode) {
    ctx.save()
    const isMoat = mode === 'moat'
    const isHalo = mode === 'halo'
    if (isHalo) {
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 24
    }
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const item of entries) {
      const col = item.id % ATLAS_GRID
      const row = Math.floor(item.id / ATLAS_GRID)
      const cx = col * TILE_PX + TILE_PX * 0.5
      const cy = row * TILE_PX + TILE_PX * 0.5

      ctx.save()
      ctx.translate(cx, cy)

      if (item.pip) {
        const pts = PIP_COORDS[item.pip]
        const span = TILE_PX * 0.30
        const pad = isMoat ? 11 : 0
        for (const [px, py] of pts) {
          const x = px * span
          const y = py * span
          if (item.pip === 1) {
            ctx.beginPath()
            ctx.arc(x, y, TILE_PX * 0.145 + pad, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.beginPath()
            ctx.arc(x, y, TILE_PX * 0.082 + pad, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      } else if (item.fateBlank) {
        ctx.lineWidth = isMoat ? 32 : 14
        ctx.beginPath()
        ctx.arc(0, 0, TILE_PX * 0.16, 0, Math.PI * 2)
        ctx.stroke()
      } else if (item.eyeSeal) {
        ctx.lineWidth = isMoat ? 28 : 12
        ctx.beginPath()
        ctx.moveTo(-72, 0)
        ctx.quadraticCurveTo(0, -54, 72, 0)
        ctx.quadraticCurveTo(0, 54, -72, 0)
        ctx.closePath()
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(0, 0, isMoat ? 24 : 15, isMoat ? 40 : 32, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const txt = item.text
        const fontSize = txt.length >= 2 ? 124 : 152
        // 采用高开口、超粗无衬线几何字形，小尺寸与倾斜视角下依然清晰锐利
        ctx.font = `900 ${fontSize}px system-ui, -apple-system, "Segoe UI", "Arial Black", "PingFang SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const yOff = item.crown ? 8 : (item.underline ? -4 : 2)

        if (isMoat) {
          ctx.lineWidth = 26
          ctx.strokeText(txt, 0, yOff)
        } else {
          ctx.lineWidth = 4
          ctx.strokeText(txt, 0, yOff)
        }
        ctx.fillText(txt, 0, yOff)

        if (item.underline) {
          const pad = isMoat ? 9 : 0
          ctx.beginPath()
          ctx.roundRect(-34 - pad, 62 - pad, 68 + pad * 2, 12 + pad * 2, 6)
          ctx.fill()
        }
        if (item.crown) {
          ctx.lineWidth = isMoat ? 20 : 8
          ctx.beginPath()
          ctx.moveTo(-38, -60)
          ctx.lineTo(-18, -76)
          ctx.lineTo(0, -60)
          ctx.lineTo(18, -76)
          ctx.lineTo(38, -60)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
    ctx.restore()
  }

  drawGlyphPass(mctx, 'mask')
  drawGlyphPass(octx, 'moat')
  drawGlyphPass(hctx, 'halo')

  const maskData = mctx.getImageData(0, 0, size, size).data
  const moatData = octx.getImageData(0, 0, size, size).data
  const haloData = hctx.getImageData(0, 0, size, size).data
  const outImg = mctx.createImageData(size, size)
  const dst = outImg.data

  const stride = size * 4
  for (let y = 0; y < size; y++) {
    const yPrev = Math.max(0, y - 2)
    const yNext = Math.min(size - 1, y + 2)
    for (let x = 0; x < size; x++) {
      const idx = y * stride + x * 4
      const xPrev = Math.max(0, x - 2)
      const xNext = Math.min(size - 1, x + 2)

      const hL = maskData[y * stride + xPrev * 4 + 3]
      const hR = maskData[y * stride + xNext * 4 + 3]
      const hU = maskData[yPrev * stride + x * 4 + 3]
      const hD = maskData[yNext * stride + x * 4 + 3]

      // 左上受光凹槽斜率合成单通道法线高度偏导
      const bevel = ((hR - hL) * 0.707 + (hD - hU) * 0.707) / 255

      dst[idx] = maskData[idx + 3]     // R: 超清锐利字芯蒙版
      dst[idx + 1] = moatData[idx + 3] // G: 外扩暗槽描边保护环
      dst[idx + 2] = Math.max(0, Math.min(255, Math.round((bevel * 0.5 + 0.5) * 255))) // B: 刻槽立体凹凸受光
      dst[idx + 3] = haloData[idx + 3] // A: 柔和能量外晕
    }
  }

  mctx.putImageData(outImg, 0, 0)
  return maskCv
}

const VERTEX_FLOATS = 19

function buildBeveledPolyhedron(kind, rawVerts, rawFaces, labels, faceValues, uvScale = 1.18) {
  const normVerts = rawVerts.map(vNorm)
  const faces = []
  const triData = []

  for (let f = 0; f < rawFaces.length; f++) {
    const indices = rawFaces[f].slice()
    let cx = 0, cy = 0, cz = 0
    for (const vi of indices) {
      cx += normVerts[vi][0]
      cy += normVerts[vi][1]
      cz += normVerts[vi][2]
    }
    cx /= indices.length
    cy /= indices.length
    cz /= indices.length
    const center = [cx, cy, cz]

    const p0 = normVerts[indices[0]]
    const p1 = normVerts[indices[1]]
    const p2 = normVerts[indices[2]]
    let n = vNorm(vCross(vSub(p1, p0), vSub(p2, p0)))
    if (vDot(n, center) < 0) {
      indices.reverse()
      n = vScale(n, -1)
    }

    const pTop = normVerts[indices[0]]
    let up = vSub(pTop, center)
    up = vSub(up, vScale(n, vDot(up, n)))
    if (Math.hypot(up[0], up[1], up[2]) < 1e-5) {
      up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
      up = vSub(up, vScale(n, vDot(up, n)))
    }
    const vAxis = vScale(vNorm(up), -1)
    const uAxis = vNorm(vCross(n, vAxis))

    let inRadius = Infinity
    for (let i = 0; i < indices.length; i++) {
      const va = normVerts[indices[i]]
      const vb = normVerts[indices[(i + 1) % indices.length]]
      const mid = vScale(vAdd(va, vb), 0.5)
      const d = Math.hypot(mid[0] - cx, mid[1] - cy, mid[2] - cz)
      if (d < inRadius) inRadius = d
    }

    const invSpan = 1 / (inRadius * uvScale)
    const labelStr = String(labels[f])
    let tileKey = labelStr
    if (kind === 'd100_tens' && labelStr === '20') tileKey = '20_d'
    if (kind === 'd100_tens' && labelStr === '10') tileKey = '10_d'
    const defaultTile = GLYPH_TILE_MAP[tileKey] !== undefined ? GLYPH_TILE_MAP[tileKey] : 20
    const pipTile = kind === 'd6' ? (GLYPH_TILE_MAP[`pip_${faceValues[f]}`] ?? defaultTile) : defaultTile

    faces.push({
      index: f,
      normal: new Float32Array(n),
      center: new Float32Array(center),
      uAxis: new Float32Array(uAxis),
      vAxis: new Float32Array(vAxis),
      inRadius,
      label: labelStr,
      value: faceValues[f],
      defaultTile,
      pipTile
    })

    const pushVert = (pos, smoothN, edgeDist) => {
      const rel = vSub(pos, center)
      const lu = vDot(rel, uAxis) * invSpan * 0.5 + 0.5
      const lv = vDot(rel, vAxis) * invSpan * 0.5 + 0.5
      triData.push(
        pos[0], pos[1], pos[2],
        n[0], n[1], n[2],
        smoothN[0], smoothN[1], smoothN[2],
        uAxis[0], uAxis[1], uAxis[2],
        vAxis[0], vAxis[1], vAxis[2],
        lu, lv,
        edgeDist,
        f
      )
    }

    for (let i = 0; i < indices.length; i++) {
      const va = normVerts[indices[i]]
      const vb = normVerts[indices[(i + 1) % indices.length]]
      pushVert(center, n, 1.0)
      pushVert(va, va, 0.0)
      pushVert(vb, vb, 0.0)
    }
  }

  return {
    kind,
    faceCount: faces.length,
    faces,
    vertexBufferData: new Float32Array(triData),
    vertexCount: triData.length / VERTEX_FLOATS
  }
}

function buildIcosahedronRaw() {
  const phi = (1 + Math.sqrt(5)) / 2
  const verts = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
  ].map(vNorm)

  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ]
  return { verts, faces }
}

function assignOppositeNumbers(faces, verts, maxNum) {
  const centroids = faces.map(idx => {
    let x = 0, y = 0, z = 0
    for (const i of idx) { x += verts[i][0]; y += verts[i][1]; z += verts[i][2] }
    return vNorm([x, y, z])
  })
  const values = new Array(faces.length).fill(0)
  const used = new Uint8Array(faces.length)
  let hi = maxNum, lo = 1
  for (let i = 0; i < faces.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let bestJ = -1, bestDot = 2
    for (let j = i + 1; j < faces.length; j++) {
      if (used[j]) continue
      const d = vDot(centroids[i], centroids[j])
      if (d < bestDot) { bestDot = d; bestJ = j }
    }
    values[i] = hi--
    if (bestJ >= 0) { used[bestJ] = 1; values[bestJ] = lo++ }
  }
  return values
}

function createTrapezohedron(kind, labels, values) {
  const cos36 = Math.cos(Math.PI / 5)
  const hUnit = (1 - cos36) / (1 + cos36)
  const rUnit = Math.sqrt(1 - hUnit * hUnit)
  const verts = [[0, 0, 1], [0, 0, -1]]
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5
    verts.push([rUnit * Math.cos(a), rUnit * Math.sin(a), hUnit])
  }
  for (let k = 0; k < 5; k++) {
    const b = ((k + 0.5) * 2 * Math.PI) / 5
    verts.push([rUnit * Math.cos(b), rUnit * Math.sin(b), -hUnit])
  }
  const faces = []
  for (let k = 0; k < 5; k++) faces.push([0, 2 + k, 7 + k, 2 + ((k + 1) % 5)])
  for (let k = 0; k < 5; k++) faces.push([1, 7 + ((k + 1) % 5), 2 + ((k + 1) % 5), 7 + k])
  return buildBeveledPolyhedron(kind, verts, faces, labels, values, 1.16)
}

function createD12() {
  const ico = buildIcosahedronRaw()
  const d12Verts = ico.faces.map(f => {
    let x = 0, y = 0, z = 0
    for (const vi of f) { x += ico.verts[vi][0]; y += ico.verts[vi][1]; z += ico.verts[vi][2] }
    return vNorm([x, y, z])
  })
  const d12Faces = []
  for (let vi = 0; vi < ico.verts.length; vi++) {
    const inc = []
    for (let fi = 0; fi < ico.faces.length; fi++) {
      if (ico.faces[fi].includes(vi)) inc.push(fi)
    }
    const axis = ico.verts[vi]
    const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const t1 = vNorm(vCross(axis, ref))
    const t2 = vNorm(vCross(axis, t1))
    inc.sort((a, b) => {
      const pa = vSub(d12Verts[a], vScale(axis, vDot(d12Verts[a], axis)))
      const pb = vSub(d12Verts[b], vScale(axis, vDot(d12Verts[b], axis)))
      return Math.atan2(vDot(pa, t2), vDot(pa, t1)) - Math.atan2(vDot(pb, t2), vDot(pb, t1))
    })
    d12Faces.push(inc)
  }
  const vals = assignOppositeNumbers(d12Faces, d12Verts, 12)
  return buildBeveledPolyhedron('d12', d12Verts, d12Faces, vals, vals, 1.22)
}

const GL_MESHES = Object.freeze({
  d4: buildBeveledPolyhedron(
    'd4',
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    [1, 2, 3, 4], [1, 2, 3, 4], 1.18
  ),
  d6: buildBeveledPolyhedron(
    'd6',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['6', '1', '2', '5', '3', '4'], [6, 1, 2, 5, 3, 4], 1.24
  ),
  df: buildBeveledPolyhedron(
    'df',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['+', '−', '+', '−', '◯', '◯'], [1, -1, 1, -1, 0, 0], 1.24
  ),
  d8: buildBeveledPolyhedron(
    'd8',
    [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]],
    [[0, 2, 3], [1, 4, 5], [0, 3, 4], [1, 5, 2], [0, 4, 5], [1, 2, 3], [0, 5, 2], [1, 3, 4]],
    [8, 1, 2, 7, 6, 3, 4, 5], [8, 1, 2, 7, 6, 3, 4, 5], 1.18
  ),
  d10: createTrapezohedron('d10', ['10', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [10, 2, 4, 6, 8, 1, 9, 7, 5, 3]),
  d100_tens: createTrapezohedron('d100_tens', ['00', '20', '40', '60', '80', '10', '90', '70', '50', '30'], [0, 20, 40, 60, 80, 10, 90, 70, 50, 30]),
  d100_ones: createTrapezohedron('d100_ones', ['0', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [0, 2, 4, 6, 8, 1, 9, 7, 5, 3]),
  d12: createD12(),
  d20: (() => {
    const ico = buildIcosahedronRaw()
    const vals = assignOppositeNumbers(ico.faces, ico.verts, 20)
    return buildBeveledPolyhedron('d20', ico.verts, ico.faces, vals, vals, 1.16)
  })()
})

// ============================================================================
// demo/gl-shaders.js — 原生 WebGL2 (#version 300 es) HDR 着色器套件
// 包含：
// 1. Ray-Plane 3D 程序化舞台着色器（6大主题：星穹星盘 / 时停极光焦散 / 焚天熔岩铁砧 /
//    赛博全息视界 / 宣纸远山水墨晕染 / 黑洞引力透镜奇点 + 实时软接触阴影 + 落地能量涟漪）
// 2. 圆润倒角 + 4通道凹凸雕文 + PBR / 次表面玉石散射 / 内部星云岩浆视差 / 光谱色散 多面体着色器
// 3. 3D 能量丝带与书法飞白/弧形剑气着色器 + 速度拉伸动态模糊火星与冲天光柱着色器
// 4. Dual-Kawase 多级 HDR 辉光 (Bloom) + 屏幕空间冲击波透镜折射 + ACES 电影级色调映射
// ============================================================================

const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`

const ARENA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform mat4 u_invViewProj;
uniform vec3 u_camPos;
uniform float u_time;
uniform int u_theme;       // 0:astral 1:prism 2:inferno 3:cyber 4:jianxin 5:singularity
uniform int u_tier;        // 0:normal 1:critical 2:success 3:costly 4:failure 5:fumble
uniform float u_climax;    // 0..1 落定高潮强度
uniform float u_charge;    // 0..1 按住蓄力旋涡强度
uniform int u_diceCount;
uniform vec4 u_diceSpheres[24]; // xyz, radius
uniform vec4 u_impacts[8];      // x, y, age, strength (strength<=0 inactive)

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

// 返回 vec2(d1: 最近点距离, d2 - d1: 精确多边形裂隙边界距离！0 即在晶界裂纹正中心)
vec2 voronoiEdge(vec2 x, float animSpeed) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + 17.3));
      o = 0.5 + 0.42 * sin(u_time * animSpeed + TAU * o);
      vec2 r = g + o - f;
      float d = length(r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(d1, d2 - d1);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// 黄金秘法星盘精细蚀刻几何环函数
float astrolabePattern(vec2 p, float rotSpeed, float scale) {
  vec2 q = rot2(u_time * rotSpeed) * (p * scale);
  float r = length(q);
  float a = atan(q.y, q.x);
  float aa = max(0.0045, fwidth(r) * 1.35);
  float rings = smoothstep(aa, 0.0, abs(r - 1.0))
              + smoothstep(aa * 0.85, 0.0, abs(r - 0.91))
              + smoothstep(aa * 0.9, 0.0, abs(r - 0.66))
              + smoothstep(aa * 0.75, 0.0, abs(r - 0.38));
  // 十二星宫精密刻度齿
  float ticks = 0.0;
  if (r > 0.91 && r < 1.0) {
    ticks = smoothstep(0.14, 0.0, abs(sin(a * 36.0))) * 0.75;
  }
  // 神圣六芒星阵（两组正反交错正三角形极坐标方程）
  float triA = 0.48 / max(0.35, cos(mod(a + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float triB = 0.48 / max(0.35, cos(mod(a + PI + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float hexagram = smoothstep(aa * 1.2, 0.0, abs(r - triA)) * step(r, 0.92)
                 + smoothstep(aa * 1.2, 0.0, abs(r - triB)) * step(r, 0.92);
  // 星轨符文虚线环
  float glyphs = 0.0;
  if (r > 0.70 && r < 0.87) {
    float seg = abs(fract(a * 12.0 / TAU) - 0.5);
    glyphs = smoothstep(0.18, 0.08, seg) * smoothstep(aa * 1.1, 0.0, abs(r - 0.785)) * 0.85;
  }
  return rings + ticks + hexagram * 0.9 + glyphs;
}

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec4 nearH = u_invViewProj * vec4(ndc, -1.0, 1.0);
  vec4 farH  = u_invViewProj * vec4(ndc,  1.0, 1.0);
  vec3 pNear = nearH.xyz / nearH.w;
  vec3 pFar  = farH.xyz / farH.w;
  vec3 rayDir = normalize(pFar - pNear);

  vec3 col = vec3(0.015, 0.018, 0.03);

  // 求与桌面 z = 0 的精确三维交点
  if (rayDir.z < -0.001) {
    float tHit = -u_camPos.z / rayDir.z;
    vec3 hit = u_camPos + rayDir * tHit;
    vec2 p = hit.xy * 0.0038; // 归一化舞台坐标（半径 ~1.0 对应 ~260 世界单位）
    float rad = length(p);
    float distFade = exp(-rad * rad * 0.42);

    // 1. 六大主题程序化 3D 台面材质（带真实深度视差层！）
    if (u_theme == 0) {
      // [0] 星穹秘法·天命司南：三层深度视差黄金星盘 + 曜石星云深渊
      vec2 pDeep1 = (u_camPos + rayDir * ((-46.0 - u_camPos.z) / rayDir.z)).xy * 0.0034;
      vec2 pDeep2 = (u_camPos + rayDir * ((-105.0 - u_camPos.z) / rayDir.z)).xy * 0.0029;
      float neb = fbm(pDeep2 * 2.8 + vec2(u_time * 0.04, -u_time * 0.03));
      col = mix(vec3(0.008, 0.007, 0.022), vec3(0.055, 0.025, 0.12), neb * distFade);

      // 细密圆润深空星辰点（基于格内局部圆心距离，杜绝方块像素感）
      vec2 starGrid = pDeep2 * 78.0;
      float starSeed = hash21(floor(starGrid));
      if (starSeed > 0.965) {
        float sd = length(fract(starGrid) - 0.5);
        float twinkle = 0.45 + 0.55 * sin(u_time * 3.2 + starSeed * 90.0);
        col += vec3(1.5, 1.3, 1.9) * smoothstep(0.18, 0.0, sd) * twinkle * distFade;
      }

      float boost = 1.0 + u_climax * (u_tier == 1 ? 1.35 : 0.45) + u_charge * 1.2;
      float layer0 = astrolabePattern(p, 0.13 * boost, 1.02);
      float layer1 = astrolabePattern(pDeep1, -0.21 * boost, 1.18) * 0.48;
      float layer2 = astrolabePattern(pDeep2, 0.09 * boost, 1.36) * 0.26;

      vec3 goldCol = u_tier == 5
        ? vec3(1.25, 0.20, 1.95)
        : vec3(1.38, 0.92, 0.28); // 克制丝滑金线，凸显前景黑曜鎏金骰子主体！
      col += goldCol * (layer0 + layer1 + layer2) * distFade * (0.48 + 0.36 * boost);

      if (u_charge > 0.01) {
        float vortex = smoothstep(0.55, 0.0, rad) * (sin(rad * 28.0 - u_time * 14.0) * 0.5 + 0.5);
        col += vec3(2.2, 1.45, 0.5) * vortex * smoothstep(0.65, 0.0, rad) * u_charge;
      }
    } else if (u_theme == 1) {
      // [1] 时停棱镜·碎星圣晶：深海极光镜湖 + 锐利双层 Voronoi 晶界焦散光网！
      float n1 = fbm(p * 2.2 + vec2(0.0, u_time * 0.12));
      vec3 aurora = mix(vec3(0.02, 0.14, 0.32), vec3(0.10, 0.38, 0.42), sin(p.x * 3.0 + n1 * 4.0 + u_time * 0.4) * 0.5 + 0.5);
      col = vec3(0.006, 0.012, 0.028) + aurora * 0.42 * distFade;

      vec2 ve1 = voronoiEdge(p * 3.8 + vec2(u_time * 0.06, -u_time * 0.04), 0.85);
      vec2 ve2 = voronoiEdge(p * 6.4 - vec2(u_time * 0.05, u_time * 0.07), 1.15);
      float caus1 = smoothstep(0.085, 0.0, ve1.y);
      float caus2 = smoothstep(0.065, 0.0, ve2.y) * 0.45;
      col += vec3(0.45, 1.55, 2.35) * (caus1 + caus2) * 0.88 * distFade;

      float ring = smoothstep(0.009, 0.0, abs(rad - 0.95));
      col += vec3(0.7, 1.7, 2.5) * ring * distFade;
    } else if (u_theme == 2) {
      // [2] 焚天熔炉·孤注一掷：玄武岩多边形龟裂板块 + 地底涌动炽金岩浆裂脉！
      vec2 pLava = (u_camPos + rayDir * ((-26.0 - u_camPos.z) / rayDir.z)).xy * 0.004;
      vec2 warp = vec2(fbm(p * 4.5), fbm(p * 4.5 + 9.2)) * 0.18;
      vec2 ve = voronoiEdge(p * 3.2 + warp, 0.22);

      float rock = fbm(p * 6.5);
      col = mix(vec3(0.018, 0.012, 0.011), vec3(0.052, 0.036, 0.030), rock);
      // 岩石边缘受热暗红过渡 + 缝隙中心炽白金黄岩浆！
      float crackGlow = smoothstep(0.13, 0.015, ve.y);
      float crackCore = smoothstep(0.032, 0.003, ve.y);
      float magmaFlow = fbm(pLava * 4.2 + vec2(u_time * 0.28, -u_time * 0.20));
      vec3 lavaHDR = mix(vec3(1.85, 0.24, 0.02), vec3(4.2, 1.95, 0.28), magmaFlow * 0.6 + crackCore * 0.5);
      col += lavaHDR * (crackGlow * 0.55 + crackCore * 0.95) * distFade * (0.65 + 0.65 * u_climax + u_charge);

      float anvilRim = smoothstep(0.011, 0.0, abs(max(abs(p.x) * 0.82, abs(p.y)) - 0.90));
      col += vec3(2.1, 0.65, 0.10) * anvilRim * distFade;
    } else if (u_theme == 3) {
      // [3] 赛博超频·霓虹矩阵：全息透视网格 + 脉冲扫描波
      col = vec3(0.010, 0.007, 0.028);
      vec2 gp = hit.xy / 38.0;
      vec2 grid = abs(fract(gp - 0.5) - 0.5) / fwidth(gp);
      float line = 1.0 - min(min(grid.x, grid.y), 1.0);
      float scan = exp(-abs(rad - fract(u_time * 0.38) * 1.6) * 14.0);
      vec3 neon = mix(vec3(0.0, 1.75, 2.25), vec3(2.25, 0.15, 1.45), smoothstep(-0.8, 0.8, p.y));
      col += neon * line * (0.30 + scan * 1.35) * distFade;
      float oct = max(max(abs(p.x), abs(p.y)), (abs(p.x) + abs(p.y)) * 0.7071);
      col += vec3(2.3, 0.2, 1.5) * smoothstep(0.011, 0.0, abs(oct - 0.96)) * distFade;
    } else if (u_theme == 4) {
      // [4] 水墨剑心·太虚玉简：古宣远山云海 + 中央温润苍青端砚圆盘衬托羊脂白玉骰！
      float paperFiber = fbm(p * 14.0) * 0.055 + fbm(p * 3.2) * 0.085;
      vec3 xuan = vec3(0.74, 0.70, 0.62) - paperFiber;
      float m1 = smoothstep(0.12, -0.22, p.y + 0.50 + 0.16 * fbm(vec2(p.x * 2.5, 1.2)));
      float m2 = smoothstep(0.08, -0.18, p.y + 0.30 + 0.12 * fbm(vec2(p.x * 3.8 + 4.0, 2.5)));
      xuan = mix(xuan, vec3(0.40, 0.42, 0.42), m1 * 0.52);
      xuan = mix(xuan, vec3(0.22, 0.25, 0.27), m2 * 0.42);

      // 中央淡墨砚台圆韵与书法枯笔圆环，让白玉鎏金骰子对比鲜明！
      float inkWash = smoothstep(0.86, 0.15, rad + 0.06 * fbm(p * 4.5));
      xuan = mix(xuan, vec3(0.50, 0.49, 0.45), inkWash * 0.35);
      float brushRing = smoothstep(0.024, 0.002, abs(rad - 0.84 + 0.022 * fbm(p * 6.5 + u_time * 0.15)));
      xuan = mix(xuan, vec3(0.08, 0.09, 0.11), brushRing * 0.75);
      xuan *= mix(0.38, 1.0, distFade);
      col = xuan;
    } else {
      // [5] 虚空星噬·克苏鲁奇点：黑洞吸积盘引力透镜旋涡！
      float rSafe = max(rad, 0.04);
      float twist = 2.6 / (rSafe + 0.18) - u_time * 0.85;
      vec2 swirled = rot2(twist) * p;
      float disk = fbm(swirled * 3.6);
      float horizon = smoothstep(0.16, 0.24, rad);
      float photonRing = exp(-abs(rad - 0.19) * 32.0);
      vec3 plasma = mix(vec3(0.12, 1.85, 1.45), vec3(1.45, 0.25, 2.35), disk);
      col = plasma * disk * smoothstep(1.35, 0.18, rad) * horizon * 0.85;
      col += vec3(1.8, 2.8, 2.5) * photonRing * 1.6;
      // 异界七芒几何虚线
      float a7 = atan(p.y, p.x);
      float sigil = smoothstep(0.012, 0.0, abs(rad - (0.72 + 0.12 * cos(a7 * 7.0 - u_time * 0.5))));
      col += vec3(0.3, 1.9, 1.5) * sigil * 0.45 * distFade;
    }

    // 2. 落地能量涟漪 / 熔岩灼痕 / 水墨晕染贴花（支持最多 8 处并发撞击！）
    for (int i = 0; i < 8; i++) {
      vec4 imp = u_impacts[i];
      if (imp.w <= 0.001) continue;
      float age = imp.z;
      float life = u_theme == 4 ? 2.4 : 1.15;
      if (age > life) continue;
      float prog = age / life;
      vec2 dVec = hit.xy - imp.xy;
      float dist = length(dVec);

      if (u_theme == 4) {
        // 水墨剑心：宣纸有机分形墨晕扩散！
        float maxR = (28.0 + imp.w * 56.0) * (0.35 + 0.65 * (1.0 - pow(1.0 - prog, 3.0)));
        float nEdge = fbm(dVec * 0.055 + float(i) * 3.1) * 18.0;
        float blot = smoothstep(maxR, maxR * 0.45, dist + nEdge - 8.0);
        float fade = (1.0 - smoothstep(0.55, 1.0, prog)) * 0.62 * imp.w;
        col = mix(col, vec3(0.06, 0.07, 0.09), blot * fade);
      } else if (u_theme == 2) {
        // 焚天熔炉：炽热放射状熔岩裂痕！
        float ang = atan(dVec.y, dVec.x);
        float rays = pow(abs(cos(ang * 5.0 + float(i) * 2.1)), 14.0);
        float reach = (35.0 + imp.w * 85.0) * smoothstep(0.0, 0.15, prog);
        float scorch = rays * smoothstep(reach, 0.0, dist) * (1.0 - prog);
        col += vec3(4.5, 1.4, 0.15) * scorch * imp.w * 1.8;
      } else {
        // 秘法/棱镜/赛博/虚空：高精度双环能量冲击波
        float ringR = (18.0 + prog * (95.0 + imp.w * 75.0));
        float w = 3.5 + prog * 6.0;
        float wave = exp(-abs(dist - ringR) / w) * (1.0 - prog) * imp.w;
        vec3 rCol = u_theme == 0 ? vec3(2.8, 1.85, 0.55)
                  : u_theme == 1 ? vec3(0.8, 2.2, 3.0)
                  : u_theme == 3 ? vec3(0.2, 2.6, 2.8)
                                 : vec3(0.4, 2.4, 1.9);
        col += rCol * wave * 1.35;
      }
    }

    // 3. 真实三维多面体软接触阴影 (Ambient Occlusion) + 底部彩色漫反射发光 (Bounce GI)！
    float shadow = 1.0;
    vec3 bounceGI = vec3(0.0);
    vec3 lightDir = normalize(vec3(-0.35, -0.42, 0.84));
    for (int i = 0; i < 24; i++) {
      if (i >= u_diceCount) break;
      vec4 sp = u_diceSpheres[i];
      // 沿逆光方向投射偏移阴影中心
      float h = max(0.0, sp.z - sp.w * 0.65);
      vec2 shCenter = sp.xy - lightDir.xy * (h * 0.55);
      float shRadius = sp.w * (0.95 + h * 0.008);
      float d = length(hit.xy - shCenter);
      float occ = smoothstep(shRadius * 1.28, shRadius * 0.25, d) * exp(-h * 0.011);
      shadow *= (1.0 - occ * (u_theme == 4 ? 0.48 : 0.76));

      // 骰子自身能量向桌面投射的近场点光源漫反射！
      float dDirect = length(vec3(hit.xy - sp.xy, sp.z));
      float giAtten = (sp.w * sp.w) / (dDirect * dDirect + sp.w * sp.w * 0.8);
      vec3 giTint = u_theme == 0 ? vec3(1.4, 0.9, 0.25)
                  : u_theme == 1 ? vec3(0.4, 1.3, 1.9)
                  : u_theme == 2 ? vec3(2.2, 0.55, 0.08)
                  : u_theme == 3 ? vec3(0.1, 1.5, 1.8)
                  : u_theme == 4 ? vec3(0.8, 0.15, 0.12)
                                 : vec3(0.3, 1.5, 1.2);
      bounceGI += giTint * giAtten * (0.28 + 0.65 * u_climax);
    }

    col = col * shadow + bounceGI * (u_theme == 4 ? 0.18 : 0.45);
  } else {
    // 远景天穹微光渐变
    float skyH = clamp(rayDir.z * 3.0, 0.0, 1.0);
    col = u_theme == 4
      ? mix(vec3(0.58, 0.56, 0.52), vec3(0.32, 0.34, 0.36), skyH)
      : mix(vec3(0.04, 0.03, 0.08), vec3(0.005, 0.006, 0.015), skyH);
  }

  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`

const DICE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_faceNormal;
layout(location = 2) in vec3 a_smoothNormal;
layout(location = 3) in vec3 a_tangent;
layout(location = 4) in vec3 a_bitangent;
layout(location = 5) in vec2 a_uv;
layout(location = 6) in float a_edgeDist;
layout(location = 7) in float a_faceIdx;

uniform mat4 u_viewProj;
uniform mat3 u_rotMat;
uniform vec3 u_diePos;
uniform float u_dieRadius;

out vec3 v_worldPos;
out vec3 v_localPos;
out vec3 v_faceN;
out vec3 v_smoothN;
out vec3 v_tan;
out vec3 v_bitan;
out vec2 v_uv;
out float v_edgeDist;
flat out int v_faceIdx;

void main() {
  v_localPos = a_pos;
  vec3 wp = u_diePos + (u_rotMat * a_pos) * u_dieRadius;
  v_worldPos = wp;
  v_faceN = normalize(u_rotMat * a_faceNormal);
  v_smoothN = normalize(u_rotMat * a_smoothNormal);
  v_tan = normalize(u_rotMat * a_tangent);
  v_bitan = normalize(u_rotMat * a_bitangent);
  v_uv = a_uv;
  v_edgeDist = a_edgeDist;
  v_faceIdx = int(a_faceIdx + 0.5);
  gl_Position = u_viewProj * vec4(wp, 1.0);
}
`

const DICE_FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_localPos;
in vec3 v_faceN;
in vec3 v_smoothN;
in vec3 v_tan;
in vec3 v_bitan;
in vec2 v_uv;
in float v_edgeDist;
flat in int v_faceIdx;

out vec4 fragColor;

uniform sampler2D u_atlas;
uniform vec3 u_camPos;
uniform float u_time;
uniform int u_theme;
uniform int u_tier;
uniform int u_winningFace;
uniform float u_settled;
uniform float u_climax;
uniform int u_faceTiles[20];

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

// 伪环境反射采样，营造奢华宝石/黑曜石/鎏金镜面高光流转感
vec3 sampleEnvMap(vec3 R, int theme) {
  float horizon = pow(1.0 - abs(R.z), 4.0);
  float studioStrip1 = smoothstep(0.86, 0.98, dot(R, normalize(vec3(-0.45, -0.35, 0.82))));
  float studioStrip2 = smoothstep(0.80, 0.96, dot(R, normalize(vec3(0.62, 0.25, 0.74))));
  vec3 baseEnv = theme == 4
    ? mix(vec3(0.35, 0.34, 0.31), vec3(0.88, 0.85, 0.78), clamp(R.z * 0.5 + 0.5, 0.0, 1.0))
    : mix(vec3(0.03, 0.04, 0.09), vec3(0.14, 0.18, 0.32), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
  vec3 rimTint = theme == 0 ? vec3(1.6, 1.05, 0.35)
               : theme == 1 ? vec3(0.55, 1.65, 2.3)
               : theme == 2 ? vec3(2.2, 0.55, 0.1)
               : theme == 3 ? vec3(0.15, 1.9, 2.2)
               : theme == 4 ? vec3(0.95, 0.90, 0.82)
                            : vec3(0.45, 1.85, 1.45);
  return baseEnv + rimTint * horizon * 0.65 + vec3(3.2, 3.0, 2.7) * studioStrip1 + rimTint * studioStrip2 * 1.4;
}

// 薄膜干涉彩虹光谱函数（供时停水晶棱镜使用）
vec3 spectralIridescence(float cosTheta, float phase) {
  return 0.5 + 0.5 * cos(6.28318 * (cosTheta * 1.65 + phase + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec3 V = normalize(u_camPos - v_worldPos);

  // 1. 窄倒角：圆角只吃掉最外 5% 边沿，面内 95% 严格保持平面法线（切面必须平，否则会像球）
  float bevelMask = 1.0 - smoothstep(0.008, 0.052, v_edgeDist);
  float ridgeLine = smoothstep(0.032, 0.004, v_edgeDist);
  vec3 N = normalize(mix(v_faceN, v_smoothN, bevelMask * 0.55));

  // 2. 采样 2048x2048 高对比四通道雕文图集（R:锐利字芯, G:暗槽描边保护环, B:刻槽斜率, A:外晕）
  float glyphMask = 0.0;
  float moatMask  = 0.0;
  float glyphHalo = 0.0;
  float bumpSlope = 0.0;

  if (v_uv.x > 0.03 && v_uv.x < 0.97 && v_uv.y > 0.03 && v_uv.y < 0.97) {
    int tileId = u_faceTiles[clamp(v_faceIdx, 0, 19)];
    vec2 tileOrigin = vec2(float(tileId & 7), float(tileId >> 3)) * 0.125;
    vec2 atlasUV = tileOrigin + clamp(v_uv, 0.02, 0.98) * 0.125;
    vec4 tex = texture(u_atlas, atlasUV);
    // 收紧字芯阈值：缩小到 30~50px 时，宽软边会把笔画糊成一团灰白
    float aa = max(0.035, fwidth(tex.r) * 0.8);
    glyphMask = smoothstep(0.56 - aa, 0.56 + aa, tex.r);
    moatMask  = clamp(smoothstep(0.34, 0.60, tex.g) - glyphMask, 0.0, 1.0);
    bumpSlope = (tex.b * 2.0 - 1.0);
    glyphHalo = clamp(tex.a - glyphMask * 0.85, 0.0, 1.0);
  }

  // 刻槽边缘立体法线扰动（仅作用于字芯边缘，保持字芯内部平坦锐利不眩光）
  N = normalize(N - (v_tan + v_bitan) * (bumpSlope * 0.52));

  float NdotV = max(dot(N, V), 0.001);
  vec3 R = reflect(-V, N);
  float fresnel = pow(1.0 - NdotV, 4.0);

  vec3 L1 = normalize(vec3(-0.38, -0.45, 0.81));
  vec3 L2 = normalize(vec3(0.65, 0.52, 0.55));
  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  vec3 H1 = normalize(L1 + V);
  vec3 H2 = normalize(L2 + V);

  bool isWinFace = (v_faceIdx == u_winningFace) && (u_settled > 0.5);
  float winPulse = isWinFace ? (1.25 + 0.22 * sin(u_time * 6.5)) : 1.0;

  vec3 localView = v_localPos - V * 0.36;
  float interiorNoise = noise3(localView * 3.8 + vec3(u_time * 0.25, -u_time * 0.18, u_time * 0.15));
  float interiorFine  = noise3(localView * 8.2 - vec3(0.0, u_time * 0.4, 0.0));

  vec3 baseColor = vec3(0.04);
  vec3 emissive  = vec3(0.0);
  float roughness = 0.15;
  float metallic  = 0.1;
  float clearZone = clamp(glyphMask + moatMask * 0.95, 0.0, 1.0);

  if (u_theme == 0) {
    // [0] 星穹秘法：深邃黑曜石底 + 纯黑描边护城槽 + 零过曝高锐度鎏金亮白数字（对比度 > 18:1）
    vec3 deepNebula = mix(vec3(0.008, 0.006, 0.024), vec3(0.08, 0.03, 0.18), interiorNoise) * (1.0 - clearZone);
    deepNebula += vec3(0.45, 0.28, 0.08) * pow(interiorFine, 4.0) * 0.35 * (1.0 - clearZone);
    deepNebula = mix(deepNebula, vec3(0.004, 0.003, 0.010), moatMask);

    vec3 rimGold  = vec3(0.95, 0.70, 0.22);
    vec3 numColor = isWinFace ? vec3(1.0, 0.94, 0.68) : vec3(0.98, 0.84, 0.42);
    baseColor = mix(deepNebula, rimGold, ridgeLine * 0.85 * (1.0 - clearZone));
    baseColor = mix(baseColor, numColor, glyphMask);
    metallic  = mix(0.08, 0.88, ridgeLine * (1.0 - clearZone));
    roughness = mix(0.10, 0.45, glyphMask);

    vec3 auraCol = u_tier == 5 ? vec3(2.1, 0.28, 3.0) : vec3(2.4, 1.52, 0.38);
    // 仅棱脊高光触发 HDR Bloom，字芯保持在 0.95 以内，100% 锐利零糊边！
    emissive = auraCol * (ridgeLine * 0.52 * winPulse) * (1.0 - clearZone)
             + numColor * (glyphMask * 0.42);
  } else if (u_theme == 1) {
    // [1] 时停棱镜：深海蓝宝石棱镜 + 深靛黑护城槽 + 纯白高锐度刻字
    // 每个切面一个色相：相位由面法线决定（面内恒定），彩虹只沿棱脊流动，面内不再出现油膜斑块
    float faceNdotV = max(dot(v_faceN, V), 0.001);
    vec3 irid = spectralIridescence(faceNdotV, float(v_faceIdx) * 0.13 + u_time * 0.05);
    vec3 refractedCore = mix(vec3(0.016, 0.082, 0.215), irid * 0.30, (0.34 + 0.10 * interiorFine) * (1.0 - clearZone));
    refractedCore = mix(refractedCore, vec3(0.005, 0.015, 0.045), moatMask);

    vec3 numCol = vec3(0.99, 1.0, 1.0);
    baseColor = mix(refractedCore, numCol, glyphMask);
    roughness = mix(0.06, 0.42, glyphMask);
    metallic  = 0.12 * (1.0 - glyphMask);
    emissive  = irid * (fresnel * 0.42 + ridgeLine * 0.9) * (1.0 - clearZone)
              + numCol * (glyphMask * 0.62);
  } else if (u_theme == 2) {
    // [2] 焚天熔炉：锻打黑铁壳 + 纯黑隔热槽 + 亮金白清晰数字
    float coreHeat = pow(clamp(interiorNoise * 0.65 + interiorFine * 0.55, 0.0, 1.0), 2.2);
    vec3 magmaCore = mix(vec3(1.6, 0.18, 0.01), vec3(3.8, 1.85, 0.32), coreHeat);
    float fissure = smoothstep(0.66, 0.88, interiorFine) * (1.0 - bevelMask * 0.5) * (1.0 - clearZone);

    vec3 ironBody = mix(vec3(0.022, 0.018, 0.017), vec3(0.004, 0.003, 0.003), moatMask);
    vec3 hotNum   = isWinFace ? vec3(1.0, 0.95, 0.72) : vec3(1.0, 0.86, 0.48);
    baseColor = mix(ironBody, hotNum, glyphMask);
    metallic  = mix(0.62, 0.10, clearZone);
    roughness = 0.34;
    emissive  = magmaCore * (fissure * 0.85 + ridgeLine * 0.88) * (1.0 - clearZone)
              + hotNum * (glyphMask * 0.44);
  } else if (u_theme == 3) {
    // [3] 赛博超频：深黑装甲玻璃 + 纯黑护城槽 + 高对比荧光冰青白数码字
    float scanPlane = exp(-abs(fract(v_worldPos.z * 0.035 - u_time * 0.85) - 0.5) * 18.0) * (1.0 - clearZone);
    vec3 holoTint = (v_faceIdx & 1) == 0 ? vec3(0.05, 2.2, 2.5) : vec3(2.4, 0.18, 1.75);
    vec3 body = mix(vec3(0.010, 0.016, 0.038), vec3(0.002, 0.004, 0.010), moatMask);
    vec3 cyberNum = isWinFace ? vec3(0.95, 1.0, 1.0) : vec3(0.55, 0.98, 1.0);

    baseColor = mix(body, cyberNum, glyphMask);
    roughness = mix(0.09, 0.40, glyphMask);
    metallic  = 0.20 * (1.0 - clearZone);
    emissive  = holoTint * (ridgeLine * 1.25 + scanPlane * 0.48) * (1.0 - clearZone)
              + cyberNum * (glyphMask * 0.44);
  } else if (u_theme == 4) {
    // [4] 水墨剑心：温润羊脂白玉 + 素白净空衬底 + 浓黑徽墨 / 深沉朱砂阴文（印刷级清晰度！）
    float jadeCloud = interiorNoise * 0.09 * (1.0 - clearZone);
    vec3 jadeBody = vec3(0.91, 0.92, 0.88) - vec3(0.05, 0.03, 0.04) * jadeCloud;
    float wrapDiff = max(0.0, (dot(N, L1) + 0.55) / 1.55);
    float backTrans = pow(clamp(dot(V, -L1), 0.0, 1.0), 2.5) * 0.34;
    jadeBody *= (0.52 + 0.64 * wrapDiff + backTrans * vec3(0.88, 1.02, 0.92));
    jadeBody = mix(jadeBody, vec3(0.97, 0.97, 0.94), moatMask * 0.72);

    bool useCinnabar = isWinFace || (u_tier == 1 && v_faceIdx == u_winningFace) || (v_faceIdx == 0);
    vec3 inkCol = useCinnabar ? vec3(0.68, 0.04, 0.04) : vec3(0.02, 0.025, 0.032);
    vec3 trimGold = vec3(0.74, 0.56, 0.24);

    baseColor = mix(jadeBody, trimGold, ridgeLine * 0.78 * (1.0 - clearZone));
    baseColor = mix(baseColor, inkCol, glyphMask);
    roughness = mix(0.16, 0.82, glyphMask);
    metallic  = ridgeLine * 0.65 * (1.0 - clearZone);
  } else {
    // [5] 虚空星噬：深渊黑骨 + 纯黑护城槽 + 锐利薄荷白秘文
    float vein = pow(1.0 - abs(interiorFine * 2.0 - 1.0), 6.0) * (1.0 - clearZone);
    vec3 bone = mix(vec3(0.015, 0.026, 0.032), vec3(0.06, 0.10, 0.09), interiorNoise * (1.0 - clearZone));
    bone = mix(bone, vec3(0.003, 0.006, 0.008), moatMask);
    vec3 voidNum = u_tier == 5 ? vec3(0.96, 0.78, 1.0) : vec3(0.78, 1.0, 0.92);

    baseColor = mix(bone, voidNum, glyphMask);
    roughness = mix(0.18, 0.42, glyphMask);
    metallic  = 0.16 * (1.0 - clearZone);
    vec3 voidGlow = u_tier == 5 ? vec3(1.9, 0.28, 2.8) : vec3(0.22, 2.2, 1.72);
    emissive = voidGlow * (vein * 0.48 + ridgeLine * 0.68 * winPulse) * (1.0 - clearZone)
             + voidNum * (glyphMask * 0.42);
  }

  // 3. 落定后"赢面聚焦"：判定面全亮，其余四个面压暗到 42%，多面数字不再互相干扰读数
  if (u_settled > 0.5) {
    float faceFocus = isWinFace ? 1.0 : 0.42;
    baseColor *= faceFocus;
    emissive *= faceFocus;
  }

  // 4. PBR 高光与环境反射合成（字芯与暗槽 98% 消光抗眩，任何视角绝不反光糊字！）
  float specPow = mix(128.0, 14.0, roughness);
  float spec1 = pow(max(dot(N, H1), 0.0), specPow) * (1.8 - roughness);
  float spec2 = pow(max(dot(N, H2), 0.0), specPow * 0.6) * 0.65;

  vec3 F0 = mix(vec3(0.045), baseColor, metallic);
  vec3 F  = F0 + (1.0 - F0) * fresnel;
  vec3 env = sampleEnvMap(R, u_theme);

  vec3 diffuse = baseColor * (1.0 - metallic * 0.85) * (0.34 + 0.74 * diff1 + 0.24 * diff2);
  if (u_theme == 4 || glyphMask > 0.35) {
    diffuse = baseColor * (1.0 - metallic * 0.5);
  }
  float antiGlare = 1.0 - clamp(glyphMask * 0.98 + moatMask * 0.85, 0.0, 0.98);
  vec3 specular = (F * env * (1.0 - roughness * 0.55) + (F + 0.18) * (spec1 * vec3(1.35, 1.25, 1.1) + spec2 * vec3(0.8, 0.95, 1.2))) * antiGlare;

  specular += F * bevelMask * pow(max(dot(v_smoothN, H1), 0.0), 42.0) * 1.75 * antiGlare;

  vec3 finalHDR = diffuse + specular + emissive;
  fragColor = vec4(max(finalHDR, vec3(0.0)), 1.0);
}
`

// 3D 能量拖尾丝带 & 书法飞白/剑气着色器
const RIBBON_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;    // x: 0(头部)..1(尾部), y: -1..+1 宽度横截面
layout(location = 2) in vec4 a_color; // rgb(HDR), a

uniform mat4 u_viewProj;
out vec2 v_uv;
out vec4 v_color;

void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
`

const RIBBON_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;

uniform float u_time;
uniform int u_isInk; // 1: 水墨飞白浓墨混合, 0: 能量发光丝带

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}

void main() {
  float across = abs(v_uv.y);
  float tailFade = pow(max(0.0, 1.0 - v_uv.x), 1.45);
  float n = noise2(vec2(v_uv.x * 10.0 - u_time * 6.5, v_uv.y * 3.5));

  if (u_isInk == 1) {
    // 书法飞白：边缘与尾部呈现干笔纤维断续纹理！
    float bristle = noise2(vec2(v_uv.x * 18.0, v_uv.y * 14.0));
    float dryMask = smoothstep(0.22 + v_uv.x * 0.45, 0.78, bristle * (1.0 - across * 0.55));
    float alpha = dryMask * tailFade * v_color.a;
    if (alpha < 0.01) discard;
    fragColor = vec4(v_color.rgb, alpha);
  } else {
    float core = exp(-across * across * 5.5);
    float erode = smoothstep(v_uv.x * 0.65, 1.0, n * 0.55 + core * 0.75);
    float alpha = core * erode * tailFade * v_color.a;
    if (alpha < 0.005) discard;
    fragColor = vec4(v_color.rgb * (0.8 + core * 1.4) * alpha, alpha);
  }
}
`

// 速度拉伸 3D 火星粒子 & 冲天光柱着色器
const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_center;
layout(location = 1) in vec3 a_vel;
layout(location = 2) in vec2 a_corner; // [-1..1, -1..1]
layout(location = 3) in vec4 a_color;  // HDR rgb + alpha
layout(location = 4) in vec2 a_sizeMode; // x: size, y: mode (0:spark, 1:pillar)

uniform mat4 u_viewProj;
uniform vec3 u_camPos;

out vec2 v_corner;
out vec4 v_color;
flat out float v_mode;

void main() {
  v_corner = a_corner;
  v_color = a_color;
  v_mode = a_sizeMode.y;
  float sz = a_sizeMode.x;

  vec3 toCam = normalize(u_camPos - a_center);
  vec3 worldPos;
  if (a_sizeMode.y > 0.5) {
    // 冲天暴击光柱：沿 Z 轴垂直拔地而起！
    vec3 up = vec3(0.0, 0.0, 1.0);
    vec3 side = normalize(cross(toCam, up));
    worldPos = a_center + side * (a_corner.x * sz) + up * ((a_corner.y * 0.5 + 0.5) * a_vel.z);
  } else {
    // 速度方向动态拉伸火星：真实高快门流光残影！
    float spd = length(a_vel);
    vec3 dir = spd > 1.0 ? (a_vel / spd) : vec3(0.0, 0.0, 1.0);
    vec3 side = cross(toCam, dir);
    float sideLen = length(side);
    side = sideLen > 1e-3 ? (side / sideLen) : normalize(cross(toCam, vec3(1.0, 0.0, 0.0)));
    float stretch = sz * (1.0 + min(5.5, spd * 0.012));
    worldPos = a_center + dir * (a_corner.x * stretch) + side * (a_corner.y * sz);
  }

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`

const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec4 v_color;
flat in float v_mode;
out vec4 fragColor;

void main() {
  if (v_mode > 0.5) {
    // 冲天圣光柱 / 深渊裂柱：中心极亮、向上与向两侧丝滑衰减
    float radial = exp(-v_corner.x * v_corner.x * 5.2);
    float h = v_corner.y * 0.5 + 0.5;
    float vert = smoothstep(0.0, 0.08, h) * pow(max(0.0, 1.0 - h), 1.6);
    float a = radial * vert * v_color.a;
    fragColor = vec4(v_color.rgb * a, a);
  } else {
    float d2 = dot(v_corner, v_corner);
    if (d2 > 1.0) discard;
    float glow = exp(-d2 * 4.2) * (1.0 - d2);
    float a = glow * v_color.a;
    fragColor = vec4(v_color.rgb * glow * v_color.a, a);
  }
}
`

// Dual-Kawase 13-tap / 5-tap 降采样与阈值提取
const BLOOM_DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform float u_threshold;

void main() {
  vec2 d = u_texelSize;
  vec3 c0 = texture(u_tex, v_uv).rgb * 0.25;
  vec3 c1 = texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb * 0.1875;
  vec3 c2 = texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb * 0.1875;
  vec3 c3 = texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb * 0.1875;
  vec3 c4 = texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb * 0.1875;
  vec3 sum = c0 + c1 + c2 + c3 + c4;

  if (u_threshold > 0.0) {
    float lum = max(max(sum.r, sum.g), sum.b);
    float soft = clamp((lum - u_threshold + 0.35) / 0.7, 0.0, 1.0);
    float contrib = max(soft * soft * 0.35, lum - u_threshold) / max(lum, 1e-4);
    sum *= max(0.0, contrib);
  }
  fragColor = vec4(sum, 1.0);
}
`

// Tent 9-tap 升采样叠加
const BLOOM_UP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform float u_intensity;

void main() {
  vec2 d = u_texelSize * 1.25;
  vec3 s = vec3(0.0);
  s += texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2( 0.0, -d.y)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2(-d.x,  0.0)).rgb * 2.0;
  s += texture(u_tex, v_uv).rgb                    * 4.0;
  s += texture(u_tex, v_uv + vec2( d.x,  0.0)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2( 0.0,  d.y)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb * 1.0;
  fragColor = vec4((s / 16.0) * u_intensity, 1.0);
}
`

// 最终屏幕合成：光学冲击波透镜扭曲 + 动态色差 + 子弹时间边缘冷焦 + ACES Filmic 色调映射
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform vec2 u_resolution;
uniform vec4 u_shockwave;  // xy: 屏幕 UV (0..1), z: 半径, w: 扭曲强度
uniform float u_chroma;    // 边缘色差强度 (撞击/赛博故障时飙升)
uniform float u_bulletTime;// 0..1 子弹时间滤镜强度
uniform float u_bloomStrength;
uniform float u_time;

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // 1. 屏幕空间径向冲击波光学折射透镜！
  if (u_shockwave.w > 0.001) {
    vec2 delta = uv - u_shockwave.xy;
    delta.x *= aspect;
    float dist = length(delta);
    float band = exp(-abs(dist - u_shockwave.z) * 26.0);
    vec2 dir = dist > 1e-4 ? normalize(delta) : vec2(0.0);
    dir.x /= aspect;
    uv -= dir * band * u_shockwave.w * 0.042;
  }

  // 2. 径向色差分离 (Chromatic Aberration)
  vec2 fromCenter = uv - 0.5;
  float ca = u_chroma * dot(fromCenter, fromCenter) * 0.032;
  vec3 hdr;
  if (ca > 0.0002) {
    hdr.r = texture(u_sceneTex, clamp(uv + fromCenter * ca, 0.001, 0.999)).r;
    hdr.g = texture(u_sceneTex, clamp(uv, 0.001, 0.999)).g;
    hdr.b = texture(u_sceneTex, clamp(uv - fromCenter * ca, 0.001, 0.999)).b;
  } else {
    hdr = texture(u_sceneTex, clamp(uv, 0.001, 0.999)).rgb;
  }

  vec3 bloom = texture(u_bloomTex, clamp(uv, 0.001, 0.999)).rgb;
  hdr += bloom * u_bloomStrength;

  // 3. 子弹时间边缘冰蓝凝滞滤镜
  if (u_bulletTime > 0.01) {
    float edgeMask = smoothstep(0.18, 0.78, length(fromCenter));
    float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    vec3 coldTint = mix(vec3(luma), vec3(luma) * vec3(0.65, 1.05, 1.45), 0.75);
    hdr = mix(hdr, coldTint, edgeMask * u_bulletTime * 0.65);
  }

  // 4. 电影级暗角 + ACES 色调映射 + sRGB Gamma 校正
  float vig = 1.0 - dot(fromCenter, fromCenter) * 0.42;
  vec3 mapped = acesFilm(hdr * vig);
  mapped = pow(mapped, vec3(1.0 / 2.2));

  fragColor = vec4(mapped, 1.0);
}
`

// ============================================================================
// demo/gl-renderer.js — 零依赖原生 WebGL2 HDR 多通道渲染管线
// 渲染通道：
//   Pass 1: Scene HDR FBO (RGBA16F + Depth24)
//     1a. Ray-Plane 3D 视差舞台 + 软接触阴影 AO + 近场漫反射 Bounce GI + 落地贴花
//     1b. 圆角倒角 + 4通道法线凹凸雕文 + 内部视差 PBR/SSS 多面体
//     1c. 3D 摄像机朝向扭转丝带（星尘彗尾 / 书法飞白 / 凌空弧形剑气）
//     1d. 速度拉伸动态模糊火星粒子 & 冲天圣光柱 / 熔岩柱
//   Pass 2: 4 级 Mipmap Dual-Kawase HDR 辉光降采样与 Tent 升采样链
//   Pass 3: 屏幕空间径向冲击波透镜折射 + 动态色差 + 子弹时间冷焦 + ACES 色调映射
// ============================================================================
// 轻量无分配 4x4 矩阵工具（列主序 Float32Array(16)）
function mat4Perspective(out, fovyRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovyRad * 0.5)
  const nf = 1.0 / (near - far)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf
  return out
}

function mat4LookAt(out, eye, target, up) {
  let zx = eye[0] - target[0]
  let zy = eye[1] - target[1]
  let zz = eye[2] - target[2]
  let len = Math.hypot(zx, zy, zz) || 1
  zx /= len; zy /= len; zz /= len

  let xx = up[1] * zz - up[2] * zy
  let xy = up[2] * zx - up[0] * zz
  let xz = up[0] * zy - up[1] * zx
  len = Math.hypot(xx, xy, xz) || 1
  xx /= len; xy /= len; xz /= len

  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  out[15] = 1
  return out
}

function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

  for (let c = 0; c < 4; c++) {
    const bo = c * 4
    const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], b3 = b[bo + 3]
    out[bo]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
    out[bo + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
    out[bo + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
    out[bo + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
  }
  return out
}

function mat4Invert(out, m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3]
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7]
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11]
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15]

  const b00 = m00 * m11 - m01 * m10
  const b01 = m00 * m12 - m02 * m10
  const b02 = m00 * m13 - m03 * m10
  const b03 = m01 * m12 - m02 * m11
  const b04 = m01 * m13 - m03 * m11
  const b05 = m02 * m13 - m03 * m12
  const b06 = m20 * m31 - m21 * m30
  const b07 = m20 * m32 - m22 * m30
  const b08 = m20 * m33 - m23 * m30
  const b09 = m21 * m32 - m22 * m31
  const b10 = m21 * m33 - m23 * m31
  const b11 = m22 * m33 - m23 * m32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < 1e-10) {
    out.fill(0)
    out[0] = out[5] = out[10] = out[15] = 1
    return out
  }
  det = 1.0 / det

  out[0]  = (m11 * b11 - m12 * b10 + m13 * b09) * det
  out[1]  = (m02 * b10 - m01 * b11 - m03 * b09) * det
  out[2]  = (m31 * b05 - m32 * b04 + m33 * b03) * det
  out[3]  = (m22 * b04 - m21 * b05 - m23 * b03) * det
  out[4]  = (m12 * b08 - m10 * b11 - m13 * b07) * det
  out[5]  = (m00 * b11 - m02 * b08 + m03 * b07) * det
  out[6]  = (m32 * b02 - m30 * b05 - m33 * b01) * det
  out[7]  = (m20 * b05 - m22 * b02 + m23 * b01) * det
  out[8]  = (m10 * b10 - m11 * b08 + m13 * b06) * det
  out[9]  = (m01 * b08 - m00 * b10 - m03 * b06) * det
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det
  return out
}

// 四元数 [x,y,z,w] 转列主序 3x3 旋转矩阵（适配 GLSL mat3）
function quatToMat3ColMajor(qx, qy, qz, qw, out) {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2

  // Column 0
  out[0] = 1 - (yy + zz)
  out[1] = xy + wz
  out[2] = xz - wy
  // Column 1
  out[3] = xy - wz
  out[4] = 1 - (xx + zz)
  out[5] = yz + wx
  // Column 2
  out[6] = xz + wy
  out[7] = yz - wx
  out[8] = 1 - (xx + yy)
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`GLSL Compile Error: ${log}`)
  }
  return sh
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`GLSL Link Error: ${log}`)
  }
  return prog
}

// 共享雕文图集缓存（多画布复用同一张 2048x2048 Canvas，零重复烘焙开销！）
let sharedAtlasCanvas = null
function getSharedAtlasCanvas() {
  if (!sharedAtlasCanvas) sharedAtlasCanvas = buildEngravedAtlasCanvas()
  return sharedAtlasCanvas
}

const MAX_RIBBON_VERTS = 4096 // 每个顶点 9 floats: pos(3)+uv(2)+color(4)
const MAX_PARTICLE_VERTS = 6144 // 每个粒子 6 个顶点，每顶点 14 floats => 最多 1024 个活跃粒子/光柱

class WebGLDiceRenderer {
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // 我们在 HDR 离屏缓冲超采样并经后处理合成，更快更锐利
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl

    // 检测浮点渲染目标扩展
    this.hasFloatFBO = Boolean(gl.getExtension('EXT_color_buffer_float'))
    gl.getExtension('OES_texture_float_linear')

    this.width = 1
    this.height = 1
    this.fbos = null

    this._initPrograms()
    this._initAtlasTexture()
    this._initMeshVAOs()
    this._initDynamicBuffers()

    // 预分配 Uniform 上传缓冲（热路径零分配）
    this._proj = new Float32Array(16)
    this._view = new Float32Array(16)
    this._viewProj = new Float32Array(16)
    this._invViewProj = new Float32Array(16)
    this._rot3 = new Float32Array(9)
    this._diceSpheres = new Float32Array(24 * 4)
    this._impacts = new Float32Array(8 * 4)
    this._faceTiles = new Int32Array(20)
  }

  _initPrograms() {
    const gl = this.gl
    const cacheUniforms = (prog, names) => {
      const map = {}
      for (const n of names) map[n] = gl.getUniformLocation(prog, n)
      return { prog, u: map }
    }

    this.arenaProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, ARENA_FRAG), [
      'u_invViewProj', 'u_camPos', 'u_time', 'u_theme', 'u_tier',
      'u_climax', 'u_charge', 'u_diceCount', 'u_diceSpheres[0]', 'u_impacts[0]'
    ])

    this.diceProg = cacheUniforms(linkProgram(gl, DICE_VERT, DICE_FRAG), [
      'u_viewProj', 'u_rotMat', 'u_diePos', 'u_dieRadius',
      'u_atlas', 'u_camPos', 'u_time', 'u_theme', 'u_tier',
      'u_winningFace', 'u_settled', 'u_climax', 'u_faceTiles[0]'
    ])

    this.ribbonProg = cacheUniforms(linkProgram(gl, RIBBON_VERT, RIBBON_FRAG), [
      'u_viewProj', 'u_time', 'u_isInk'
    ])

    this.particleProg = cacheUniforms(linkProgram(gl, PARTICLE_VERT, PARTICLE_FRAG), [
      'u_viewProj', 'u_camPos'
    ])

    this.bloomDownProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_DOWN_FRAG), [
      'u_tex', 'u_texelSize', 'u_threshold'
    ])

    this.bloomUpProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_UP_FRAG), [
      'u_tex', 'u_texelSize', 'u_intensity'
    ])

    this.compositeProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG), [
      'u_sceneTex', 'u_bloomTex', 'u_resolution', 'u_shockwave',
      'u_chroma', 'u_bulletTime', 'u_bloomStrength', 'u_time'
    ])

    this.emptyVAO = gl.createVertexArray()
  }

  _initAtlasTexture() {
    const gl = this.gl
    const atlasCanvas = getSharedAtlasCanvas()
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // 倾斜的顶面在 mipmap 下极易把笔画糊成灰边，各向异性过滤能救回一大截锐度
    const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    if (anisoExt) {
      const maxAniso = Math.min(16, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1)
      if (maxAniso > 1) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso)
    }
    this.atlasTex = tex
  }

  _initMeshVAOs() {
    const gl = this.gl
    this.meshGPU = {}
    const stride = VERTEX_FLOATS * 4

    for (const [key, mesh] of Object.entries(GL_MESHES)) {
      const vao = gl.createVertexArray()
      const vbo = gl.createBuffer()
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexBufferData, gl.STATIC_DRAW)

      // 0: pos(3), 1: faceN(3), 2: smoothN(3), 3: tan(3), 4: bitan(3), 5: uv(2), 6: edge(1), 7: faceIdx(1)
      const attrs = [
        [0, 3, 0],
        [1, 3, 12],
        [2, 3, 24],
        [3, 3, 36],
        [4, 3, 48],
        [5, 2, 60],
        [6, 1, 68],
        [7, 1, 72]
      ]
      for (const [loc, size, offset] of attrs) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
      }
      gl.bindVertexArray(null)
      this.meshGPU[key] = { vao, vbo, vertexCount: mesh.vertexCount, mesh }
    }
  }

  _initDynamicBuffers() {
    const gl = this.gl

    // Ribbon VAO (pos:3, uv:2, color:4 => 9 floats = 36 bytes)
    this.ribbonData = new Float32Array(MAX_RIBBON_VERTS * 9)
    this.ribbonVAO = gl.createVertexArray()
    this.ribbonVBO = gl.createBuffer()
    gl.bindVertexArray(this.ribbonVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO)
    gl.bufferData(gl.ARRAY_BUFFER, this.ribbonData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20)

    // Particle VAO (center:3, vel:3, corner:2, color:4, sizeMode:2 => 14 floats = 56 bytes)
    this.particleData = new Float32Array(MAX_PARTICLE_VERTS * 14)
    this.particleVAO = gl.createVertexArray()
    this.particleVBO = gl.createBuffer()
    gl.bindVertexArray(this.particleVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO)
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 56, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 56, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 56, 24)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 56, 32)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 56, 48)

    gl.bindVertexArray(null)
  }

  _createColorTarget(w, h, withDepth) {
    const gl = this.gl
    const tryCreate = useFloat => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      if (useFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

      let depthRb = null
      if (withDepth) {
        depthRb = gl.createRenderbuffer()
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb)
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb)
      }

      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (!ok) {
        gl.deleteFramebuffer(fbo)
        gl.deleteTexture(tex)
        if (depthRb) gl.deleteRenderbuffer(depthRb)
        return null
      }
      return { fbo, tex, depthRb, w, h }
    }

    if (this.hasFloatFBO) {
      const res = tryCreate(true)
      if (res) return res
      this.hasFloatFBO = false
    }
    return tryCreate(false)
  }

  _destroyFBOs() {
    if (!this.fbos) return
    const gl = this.gl
    const list = [this.fbos.scene, ...this.fbos.bloomMips]
    for (const item of list) {
      if (!item) continue
      gl.deleteFramebuffer(item.fbo)
      gl.deleteTexture(item.tex)
      if (item.depthRb) gl.deleteRenderbuffer(item.depthRb)
    }
    this.fbos = null
  }

  resize(pixelW, pixelH) {
    const w = Math.max(64, pixelW | 0)
    const h = Math.max(48, pixelH | 0)
    if (this.width === w && this.height === h && this.fbos) return

    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    this._destroyFBOs()

    const scene = this._createColorTarget(w, h, true)
    const bloomMips = []
    let bw = Math.max(16, w >> 1)
    let bh = Math.max(16, h >> 1)
    for (let i = 0; i < 4; i++) {
      bloomMips.push(this._createColorTarget(bw, bh, false))
      bw = Math.max(8, bw >> 1)
      bh = Math.max(8, bh >> 1)
    }
    this.fbos = { scene, bloomMips }
  }

  /**
   * 投影世界坐标到归一化屏幕 UV [0..1, 0..1]（供冲击波与 2D 印章/准星对齐）
   */
  projectToUV(wx, wy, wz, out) {
    const vp = this._viewProj
    const cx = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12]
    const cy = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13]
    const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15]
    if (cw <= 0.001) {
      out.u = -1; out.v = -1; out.visible = false
      return out
    }
    out.u = (cx / cw) * 0.5 + 0.5
    out.v = (cy / cw) * 0.5 + 0.5
    out.visible = true
    return out
  }

  /**
   * 反投影屏幕归一化坐标 (ndcX ∈ [-1,1], ndcY ∈ [-1,1]) 到指定世界高度平面 z = planeZ
   */
  unprojectToPlane(ndcX, ndcY, planeZ, out) {
    const ivp = this._invViewProj
    const transform = (zNdc, dst) => {
      const x = ivp[0] * ndcX + ivp[4] * ndcY + ivp[8] * zNdc + ivp[12]
      const y = ivp[1] * ndcX + ivp[5] * ndcY + ivp[9] * zNdc + ivp[13]
      const z = ivp[2] * ndcX + ivp[6] * ndcY + ivp[10] * zNdc + ivp[14]
      const w = ivp[3] * ndcX + ivp[7] * ndcY + ivp[11] * zNdc + ivp[15] || 1
      dst[0] = x / w; dst[1] = y / w; dst[2] = z / w
    }
    const nearP = [0, 0, 0], farP = [0, 0, 0]
    transform(-1, nearP)
    transform(1, farP)
    const dz = farP[2] - nearP[2]
    const t = Math.abs(dz) > 1e-5 ? (planeZ - nearP[2]) / dz : 0
    out.x = nearP[0] + (farP[0] - nearP[0]) * t
    out.y = nearP[1] + (farP[1] - nearP[1]) * t
    out.z = planeZ
    return out
  }

  /**
   * 渲染完整 HDR 帧！
   */
  render(frame) {
    const gl = this.gl
    if (!this.fbos || !this.fbos.scene) return

    const {
      time, themeId, tierCode, climax, charge,
      camEye, camTarget, camFovRad,
      dice, impacts, slashes,
      particles, shockwave, chroma, bulletTime,
      usePipsForD6, hiddenMask, bloomEnabled
    } = frame

    const aspect = this.width / Math.max(1, this.height)
    mat4Perspective(this._proj, camFovRad, aspect, 18.0, 2600.0)
    mat4LookAt(this._view, camEye, camTarget, [0, 0, 1])
    mat4Multiply(this._viewProj, this._proj, this._view)
    mat4Invert(this._invViewProj, this._viewProj)

    // ========================================================================
    // PASS 1: 渲染 3D HDR 场景到离屏浮点帧缓冲
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.scene.fbo)
    gl.viewport(0, 0, this.width, this.height)
    gl.clear(gl.DEPTH_BUFFER_BIT)

    // 1A. 3D 光线投射程序化舞台 + 软接触阴影 + 落地涟漪
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.useProgram(this.arenaProg.prog)
    const au = this.arenaProg.u
    gl.uniformMatrix4fv(au.u_invViewProj, false, this._invViewProj)
    gl.uniform3f(au.u_camPos, camEye[0], camEye[1], camEye[2])
    gl.uniform1f(au.u_time, time)
    gl.uniform1i(au.u_theme, themeId)
    gl.uniform1i(au.u_tier, tierCode)
    gl.uniform1f(au.u_climax, climax)
    gl.uniform1f(au.u_charge, charge)

    const dCount = Math.min(24, dice.length)
    gl.uniform1i(au.u_diceCount, dCount)
    this._diceSpheres.fill(0)
    for (let i = 0; i < dCount; i++) {
      const d = dice[i]
      const o = i * 4
      this._diceSpheres[o] = d.x
      this._diceSpheres[o + 1] = d.y
      this._diceSpheres[o + 2] = d.z
      this._diceSpheres[o + 3] = d.radius
    }
    gl.uniform4fv(au['u_diceSpheres[0]'], this._diceSpheres)

    this._impacts.fill(0)
    for (let i = 0; i < 8; i++) {
      const imp = impacts[i]
      if (!imp || imp.strength <= 0) continue
      const o = i * 4
      this._impacts[o] = imp.x
      this._impacts[o + 1] = imp.y
      this._impacts[o + 2] = imp.age
      this._impacts[o + 3] = imp.strength
    }
    gl.uniform4fv(au['u_impacts[0]'], this._impacts)

    gl.bindVertexArray(this.emptyVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 1B. 渲染高精度倒角 + 4通道法线凹凸雕文 + 内部视差多面体
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)

    gl.useProgram(this.diceProg.prog)
    const du = this.diceProg.u
    gl.uniformMatrix4fv(du.u_viewProj, false, this._viewProj)
    gl.uniform3f(du.u_camPos, camEye[0], camEye[1], camEye[2])
    gl.uniform1f(du.u_time, time)
    gl.uniform1i(du.u_theme, themeId)
    gl.uniform1i(du.u_tier, tierCode)
    gl.uniform1f(du.u_climax, climax)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.uniform1i(du.u_atlas, 0)

    const eyeSealTile = GLYPH_TILE_MAP['?']

    for (let i = 0; i < dice.length; i++) {
      const d = dice[i]
      const gpu = this.meshGPU[d.meshKey] || this.meshGPU.d20
      gl.bindVertexArray(gpu.vao)

      quatToMat3ColMajor(d.qx, d.qy, d.qz, d.qw, this._rot3)
      gl.uniformMatrix3fv(du.u_rotMat, false, this._rot3)
      gl.uniform3f(du.u_diePos, d.x, d.y, d.z)
      gl.uniform1f(du.u_dieRadius, d.radius)
      gl.uniform1i(du.u_winningFace, d.targetFace ? d.targetFace.index : 0)
      gl.uniform1f(du.u_settled, d.settled ? 1.0 : 0.0)

      const faces = gpu.mesh.faces
      for (let f = 0; f < 20; f++) {
        if (f < faces.length) {
          if (hiddenMask) {
            this._faceTiles[f] = eyeSealTile
          } else if (usePipsForD6 && d.meshKey === 'd6') {
            this._faceTiles[f] = faces[f].pipTile
          } else {
            this._faceTiles[f] = faces[f].defaultTile
          }
        } else {
          this._faceTiles[f] = 0
        }
      }
      gl.uniform1iv(du['u_faceTiles[0]'], this._faceTiles)
      gl.drawArrays(gl.TRIANGLES, 0, gpu.vertexCount)
    }

    gl.disable(gl.CULL_FACE)

    // 1C. 渲染 3D 体积拖尾丝带 + 水墨飞白 + 凌空剑气斩痕
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    const isShuimo = themeId === 4
    if (isShuimo) {
      // 水墨浓墨正常 Alpha 混合；大成功金剑气仍可高亮
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    } else {
      gl.blendFunc(gl.ONE, gl.ONE)
    }
    this._drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode)

    // 1D. 渲染速度拉伸火星粒子与冲天光柱（始终使用 HDR 加法混合以触发璀璨辉光）
    gl.blendFunc(gl.ONE, gl.ONE)
    this._drawParticlesAndPillars(particles, camEye)

    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)

    // ========================================================================
    // PASS 2: Dual-Kawase 4 级 HDR Bloom 辉光提取与扩散
    // ========================================================================
    const mips = this.fbos.bloomMips
    if (bloomEnabled && mips.length > 0 && mips[0]) {
      gl.useProgram(this.bloomDownProg.prog)
      gl.bindVertexArray(this.emptyVAO)
      const bdu = this.bloomDownProg.u
      gl.uniform1i(bdu.u_tex, 0)

      let srcTex = this.fbos.scene.tex
      let srcW = this.width
      let srcH = this.height

      for (let i = 0; i < mips.length; i++) {
        const dst = mips[i]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, srcTex)
        gl.uniform2f(bdu.u_texelSize, 1.0 / srcW, 1.0 / srcH)
        gl.uniform1f(bdu.u_threshold, i === 0 ? (isShuimo ? 1.25 : 1.18) : -1.0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        srcTex = dst.tex
        srcW = dst.w
        srcH = dst.h
      }

      // Tent 9-tap 逐级向上叠加融合
      gl.useProgram(this.bloomUpProg.prog)
      const buu = this.bloomUpProg.u
      gl.uniform1i(buu.u_tex, 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)

      for (let i = mips.length - 1; i >= 1; i--) {
        const src = mips[i]
        const dst = mips[i - 1]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        gl.uniform2f(buu.u_texelSize, 1.0 / src.w, 1.0 / src.h)
        gl.uniform1f(buu.u_intensity, 0.85)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.disable(gl.BLEND)
    }

    // ========================================================================
    // PASS 3: 最终屏幕光学扭曲 + 色差 + ACES Filmic 色调映射输出
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.width, this.height)
    gl.useProgram(this.compositeProg.prog)
    const cu = this.compositeProg.u

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.scene.tex)
    gl.uniform1i(cu.u_sceneTex, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, (bloomEnabled && mips[0]) ? mips[0].tex : this.fbos.scene.tex)
    gl.uniform1i(cu.u_bloomTex, 1)

    gl.uniform2f(cu.u_resolution, this.width, this.height)
    gl.uniform4f(cu.u_shockwave, shockwave[0], shockwave[1], shockwave[2], shockwave[3])
    gl.uniform1f(cu.u_chroma, chroma)
    gl.uniform1f(cu.u_bulletTime, bulletTime)
    gl.uniform1f(cu.u_bloomStrength, bloomEnabled ? (isShuimo ? 0.35 : 0.52) : 0.0)
    gl.uniform1f(cu.u_time, time)

    gl.bindVertexArray(this.emptyVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  _drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode) {
    const buf = this.ribbonData
    let vCount = 0

    // 主题拖尾色彩预设 (HDR RGB + Alpha)
    let rCol = [2.6, 1.7, 0.45, 0.9]
    if (themeId === 1) rCol = [0.65, 2.2, 3.2, 0.95]
    else if (themeId === 2) rCol = [4.2, 1.25, 0.15, 0.95]
    else if (themeId === 3) rCol = [0.1, 2.5, 2.8, 0.92]
    else if (themeId === 4) rCol = [0.06, 0.07, 0.09, 0.88] // 浓墨飞白
    else if (themeId === 5) rCol = [0.35, 2.4, 1.85, 0.9]

    const pushQuadStripPoint = (px, py, pz, sx, sy, sz, u, cr, cg, cb, ca, prev) => {
      const lX = px - sx, lY = py - sy, lZ = pz - sz
      const rX = px + sx, rY = py + sy, rZ = pz + sz
      if (prev.has && vCount + 6 <= MAX_RIBBON_VERTS) {
        const writeV = (x, y, z, uCoord, vCoord, aVal) => {
          const o = vCount * 9
          buf[o] = x; buf[o + 1] = y; buf[o + 2] = z
          buf[o + 3] = uCoord; buf[o + 4] = vCoord
          buf[o + 5] = cr; buf[o + 6] = cg; buf[o + 7] = cb; buf[o + 8] = aVal
          vCount++
        }
        writeV(prev.lx, prev.ly, prev.lz, prev.u, -1, prev.a)
        writeV(prev.rx, prev.ry, prev.rz, prev.u, +1, prev.a)
        writeV(lX, lY, lZ, u, -1, ca)

        writeV(prev.rx, prev.ry, prev.rz, prev.u, +1, prev.a)
        writeV(rX, rY, rZ, u, +1, ca)
        writeV(lX, lY, lZ, u, -1, ca)
      }
      prev.lx = lX; prev.ly = lY; prev.lz = lZ
      prev.rx = rX; prev.ry = rY; prev.rz = rZ
      prev.u = u; prev.a = ca; prev.has = true
    }

    const prev = { has: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, u: 0, a: 1 }

    // 1. 每颗运动骰子的 3D 摄像机朝向流光/墨韵飘带
    for (let dIdx = 0; dIdx < dice.length; dIdx++) {
      const d = dice[dIdx]
      if (d.trailCount < 3) continue
      prev.has = false
      const n = d.trailCount

      // 赛博双色或棱镜彩虹偏移
      let cr = rCol[0], cg = rCol[1], cb = rCol[2]
      if (themeId === 3 && (dIdx & 1) === 1) { cr = 2.8; cg = 0.2; cb = 1.9 }
      if (themeId === 1) {
        const hue = dIdx * 1.1 + time * 2.0
        cr = 1.4 + Math.cos(hue) * 1.1
        cg = 1.5 + Math.cos(hue + 2.1) * 1.1
        cb = 1.8 + Math.cos(hue + 4.2) * 1.1
      }

      for (let i = 0; i < n; i++) {
        const curIdx = (d.trailHead - i + 28) % 28
        const nxtIdx = (d.trailHead - Math.min(n - 1, i + 1) + 28) % 28
        const prvIdx = (d.trailHead - Math.max(0, i - 1) + 28) % 28

        const px = d.trailX[curIdx], py = d.trailY[curIdx], pz = d.trailZ[curIdx]
        let tx = d.trailX[prvIdx] - d.trailX[nxtIdx]
        let ty = d.trailY[prvIdx] - d.trailY[nxtIdx]
        let tz = d.trailZ[prvIdx] - d.trailZ[nxtIdx]
        const tLen = Math.hypot(tx, ty, tz)
        if (tLen < 0.05) continue
        tx /= tLen; ty /= tLen; tz /= tLen

        const vx = camEye[0] - px, vy = camEye[1] - py, vz = camEye[2] - pz
        let sx = ty * vz - tz * vy
        let sy = tz * vx - tx * vz
        let sz = tx * vy - ty * vx
        const sLen = Math.hypot(sx, sy, sz) || 1
        const u = i / (n - 1)
        const halfW = d.radius * (themeId === 4 ? 0.72 : 0.58) * (1 - u * 0.82)
        sx = (sx / sLen) * halfW
        sy = (sy / sLen) * halfW
        sz = (sz / sLen) * halfW

        pushQuadStripPoint(px, py, pz, sx, sy, sz, u, cr, cg, cb, rCol[3], prev)
      }
    }

    // 2. 结算时的 3D 弧形剑气斩痕 / 黄金命运星环轨 (slashes)
    if (slashes && slashes.length) {
      for (let s = 0; s < slashes.length; s++) {
        const sl = slashes[s]
        if (!sl.active) continue
        const p = sl.age / sl.life
        if (p >= 1) continue
        prev.has = false
        const segs = 22
        const arcSpan = Math.PI * 1.15
        const startA = sl.angle - arcSpan * 0.5 + p * 0.65
        const fade = (1 - p) * (1 - p)
        const scr = tierCode === 1 && themeId === 4 ? 0.82 : sl.r
        const scg = tierCode === 1 && themeId === 4 ? 0.12 : sl.g
        const scb = tierCode === 1 && themeId === 4 ? 0.10 : sl.b

        for (let k = 0; k <= segs; k++) {
          const u = k / segs
          const a = startA + u * arcSpan
          const ca = Math.cos(a), sa = Math.sin(a)
          // 倾斜 3D 圆弧平面
          const lx = ca * sl.radius
          const ly = sa * sl.radius * Math.cos(sl.tilt)
          const lz = sa * sl.radius * Math.sin(sl.tilt)
          const px = sl.cx + lx
          const py = sl.cy + ly
          const pz = Math.max(4, sl.cz + lz)

          const env = Math.sin(u * Math.PI)
          const w = sl.width * env * (1 - p * 0.4)
          pushQuadStripPoint(px, py, pz, 0, 0, w, 1 - env, scr, scg, scb, fade * 0.95, prev)
        }
      }
    }

    if (vCount === 0) return
    const gl = this.gl
    gl.useProgram(this.ribbonProg.prog)
    gl.uniformMatrix4fv(this.ribbonProg.u.u_viewProj, false, this._viewProj)
    gl.uniform1f(this.ribbonProg.u.u_time, time)
    gl.uniform1i(this.ribbonProg.u.u_isInk, themeId === 4 ? 1 : 0)

    gl.bindVertexArray(this.ribbonVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 9))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }

  _drawParticlesAndPillars(particles, camEye) {
    if (!particles || particles.aliveCount === 0) return
    const buf = this.particleData
    let vCount = 0

    const corners = [
      [-1, -1], [1, -1], [-1, 1],
      [1, -1], [1, 1], [-1, 1]
    ]

    const { active, x, y, z, vx, vy, vz, size, age, life, r, g, b, a, mode, capacity } = particles
    for (let i = 0; i < capacity; i++) {
      if (!active[i]) continue
      if (vCount + 6 > MAX_PARTICLE_VERTS) break

      const p = age[i] / life[i]
      const fade = mode[i] > 0.5
        ? Math.sin(Math.min(1, p * 4.5) * Math.PI * 0.5) * Math.pow(1 - p, 1.35)
        : (1 - p * p)
      const alpha = a[i] * fade
      if (alpha <= 0.005) continue

      const sz = mode[i] > 0.5 ? size[i] * (0.7 + 0.5 * p) : size[i] * (1 - p * 0.65)
      const px = x[i], py = y[i], pz = z[i]
      const pvx = vx[i], pvy = vy[i], pvz = vz[i]
      const cr = r[i], cg = g[i], cb = b[i]
      const pm = mode[i]

      for (let c = 0; c < 6; c++) {
        const o = vCount * 14
        buf[o] = px; buf[o + 1] = py; buf[o + 2] = pz
        buf[o + 3] = pvx; buf[o + 4] = pvy; buf[o + 5] = pvz
        buf[o + 6] = corners[c][0]; buf[o + 7] = corners[c][1]
        buf[o + 8] = cr; buf[o + 9] = cg; buf[o + 10] = cb; buf[o + 11] = alpha
        buf[o + 12] = sz; buf[o + 13] = pm
        vCount++
      }
    }

    if (vCount === 0) return
    const gl = this.gl
    gl.useProgram(this.particleProg.prog)
    gl.uniformMatrix4fv(this.particleProg.u.u_viewProj, false, this._viewProj)
    gl.uniform3f(this.particleProg.u.u_camPos, camEye[0], camEye[1], camEye[2])

    gl.bindVertexArray(this.particleVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 14))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }
}

// ============================================================================
// demo/audio.js — 零外部资源 Web Audio 立体声物理合成音效引擎 v2
// 支持：3D 空间声像定位 (StereoPanner) + 按住蓄力引力旋涡嗡鸣 + 子弹时间下潜低频 +
//       6 大次世代视觉主题专属物理碰撞与裁定高潮交响和弦。
// ============================================================================

class ProceduralDiceAudio {
  constructor() {
    this.ctx = null
    this.enabled = true
    this.masterGain = null
    this.noiseBuffer = null
    this.lastBounceAt = 0
    this.activeVoices = 0
    this.chargeOsc = null
    this.chargeGain = null
  }

  ensureContext() {
    if (!this.enabled) return null
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0.42
      this.masterGain.connect(this.ctx.destination)
      const len = Math.floor(this.ctx.sampleRate * 0.45)
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuffer = buf
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag)
    if (!this.enabled) this.stopChargeHum()
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.42 : 0, this.ctx.currentTime, 0.02)
    }
  }

  _connectPanned(node, pan = 0) {
    const ctx = this.ctx
    if (ctx && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.max(-0.85, Math.min(0.85, pan))
      node.connect(panner)
      panner.connect(this.masterGain)
    } else {
      node.connect(this.masterGain)
    }
  }

  startChargeHum(preset = 'astral') {
    const ctx = this.ensureContext()
    if (!ctx || this.chargeOsc) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = preset === 'cyber' ? 'sawtooth' : preset === 'inferno' ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(95, now)
    g.gain.setValueAtTime(0.001, now)
    g.gain.linearRampToValueAtTime(0.09, now + 0.12)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(now)
    this.chargeOsc = osc
    this.chargeGain = g
  }

  updateChargeHum(charge01) {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    const c = Math.max(0, Math.min(1, charge01))
    this.chargeOsc.frequency.setTargetAtTime(95 + c * 240, now, 0.04)
    this.chargeGain.gain.setTargetAtTime(0.04 + c * 0.11, now, 0.04)
  }

  stopChargeHum() {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    try {
      this.chargeGain.gain.cancelScheduledValues(now)
      this.chargeGain.gain.setTargetAtTime(0.0001, now, 0.03)
      this.chargeOsc.stop(now + 0.12)
    } catch {}
    this.chargeOsc = null
    this.chargeGain = null
  }

  playThrowWhoosh(preset = 'astral', power = 1.0) {
    this.stopChargeHum()
    const ctx = this.ensureContext()
    if (!ctx || !this.noiseBuffer) return
    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    const filter = ctx.createBiquadFilter()
    filter.type = preset === 'cyber' ? 'bandpass' : 'lowpass'
    const baseFreq = preset === 'prism' ? 1550 : preset === 'inferno' ? 360 : 760
    filter.frequency.setValueAtTime(baseFreq * 0.5, now)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * (1.9 + power * 0.6), now + 0.08)
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, now + 0.26)
    filter.Q.value = preset === 'jianxin' ? 5.2 : 2.2

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.18 * Math.min(1.4, power), now + 0.045)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)
    src.start(now)
    src.stop(now + 0.28)
  }

  playBulletTimeDrop() {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(160, now)
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.32)
    g.gain.setValueAtTime(0.22, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.36)
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(now)
    osc.stop(now + 0.38)
  }

  playBounce(preset = 'astral', strength = 0.6, pan = 0) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBounceAt < 0.016 || this.activeVoices >= 8) return
    this.lastBounceAt = now
    this.activeVoices++

    const amp = Math.min(1, Math.max(0.08, strength))
    const jitter = 0.92 + Math.random() * 0.18

    if (preset === 'prism' || preset === 'astral') {
      const f0 = (preset === 'prism' ? 1480 : 940) * jitter
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const g = ctx.createGain()
      osc1.type = 'sine'
      osc2.type = 'triangle'
      osc1.frequency.setValueAtTime(f0, now)
      osc2.frequency.setValueAtTime(f0 * (preset === 'prism' ? 2.756 : 1.618), now)
      g.gain.setValueAtTime(0.22 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + (preset === 'prism' ? 0.21 : 0.14))
      osc1.connect(g); osc2.connect(g)
      this._connectPanned(g, pan)
      osc1.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc1.start(now); osc2.start(now)
      const dur = preset === 'prism' ? 0.22 : 0.15
      osc1.stop(now + dur); osc2.stop(now + dur)
      return
    }

    if (preset === 'cyber') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(1120 * jitter, now)
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.055)
      g.gain.setValueAtTime(0.18 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.connect(g)
      this._connectPanned(g, pan)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.065)
      return
    }

    // 物理刚体碰撞合成：inferno 玄武熔铁 / jianxin 羊脂白玉剑鸣 / singularity 古骨奇点
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = preset === 'inferno' ? 'triangle' : 'sine'
    const base = preset === 'inferno' ? 140 : preset === 'jianxin' ? 820 : 290
    osc.frequency.setValueAtTime(base * jitter * (1 + amp * 0.28), now)
    osc.frequency.exponentialRampToValueAtTime(base * (preset === 'jianxin' ? 0.72 : 0.38), now + 0.075)
    g.gain.setValueAtTime(0.25 * amp, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.085)
    osc.connect(g)
    this._connectPanned(g, pan)

    if (this.noiseBuffer) {
      const nSrc = ctx.createBufferSource()
      nSrc.buffer = this.noiseBuffer
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = preset === 'jianxin' ? 2800 * jitter : 1150
      nf.Q.value = 3.8
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.16 * amp, now)
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.032)
      nSrc.connect(nf); nf.connect(ng)
      this._connectPanned(ng, pan)
      nSrc.start(now); nSrc.stop(now + 0.038)
    }

    osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
    osc.start(now); osc.stop(now + 0.09)
  }

  playSettle(preset = 'astral', tier = 'success') {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime

    let notes = [523.25, 659.25]
    if (tier === 'critical') notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    else if (tier === 'costly') notes = [440, 523.25, 622.25]
    else if (tier === 'failure') notes = [349.23, 311.13]
    else if (tier === 'fumble') notes = [220, 155.56, 110, 73.42]

    const wave = preset === 'cyber'
      ? 'sawtooth'
      : preset === 'prism' || preset === 'jianxin'
        ? 'sine'
        : 'triangle'

    notes.forEach((freq, i) => {
      const t0 = now + i * 0.052
      const dur = tier === 'critical' ? 0.56 : 0.34
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      const g = ctx.createGain()

      osc.type = wave
      const mult = preset === 'prism' ? 1.45 : preset === 'inferno' || preset === 'singularity' ? 0.65 : 1.0
      osc.frequency.setValueAtTime(freq * mult, t0)

      filter.type = 'lowpass'
      filter.frequency.value = preset === 'cyber' ? 2400 : 3200

      g.gain.setValueAtTime(0.001, t0)
      g.gain.linearRampToValueAtTime(tier === 'critical' ? 0.15 : 0.10, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)

      osc.connect(filter); filter.connect(g)
      this._connectPanned(g, (i - (notes.length - 1) * 0.5) * 0.25)
      osc.start(t0); osc.stop(t0 + dur + 0.02)
    })

    // 剑鸣清音 / 重锤低音轰鸣
    if (tier === 'critical' || tier === 'fumble') {
      const sub = ctx.createOscillator()
      const sg = ctx.createGain()
      sub.type = 'sine'
      sub.frequency.setValueAtTime(preset === 'jianxin' ? 196 : 115, now)
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.38)
      sg.gain.setValueAtTime(0.32, now)
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.42)
      sub.connect(sg); sg.connect(this.masterGain)
      sub.start(now); sub.stop(now + 0.44)
    }
  }
}

// ============================================================================
// demo/physics-choreo.js — 次世代 3D 投骰物理、交互蓄力甩投 & 电影级弹簧镜头编导器
// 核心能力：
// 1. 交互式“按住蓄力旋涡 + 鼠标/触屏拖拽任意方向甩投” (Interactive Hold & Slingshot)
// 2. 120Hz 刚体碰撞预烘焙 + 四元数逆向精确对齐指定密码学真骰点数 (SO(3) 零磁吸跳变)
// 3. 电影级二阶弹簧摄像机 (Spring Camera)：蓄力拉远蓄势 -> 空中追踪 -> 临落定子弹时间推镜特写 -> 落地震屏冲击！
// 4. 零 GC 粒子与冲天光柱发射器 + 屏幕空间光学冲击波折射驱动 + 2D 矢量战术准星/朱砂印章叠层
// ============================================================================
const NEXTGEN_THEMES = Object.freeze([
  {
    id: 'astral',
    themeIndex: 0,
    name: '星穹秘法 · 天命司南',
    subtitle: 'Astral Chronometer',
    badge: '✦ 24K 鎏金星盘',
    desc: '三重深度视差旋转黄金星盘 + 内部深空星云黑曜石 + 24K 凹凸鎏金刻槽，大成功降下冲天圣金光柱与径向折射冲击波。',
    accent: '#f5b942',
    swatch: 'radial-gradient(circle at 30% 25%, #5c3d99 0%, #170f2e 55%, #070510 100%)',
    soundPreset: 'astral'
  },
  {
    id: 'prism',
    themeIndex: 1,
    name: '时停棱镜 · 碎星圣晶',
    subtitle: 'Chrono-Crystal Prism',
    badge: '⏳ 子弹时间慢镜',
    desc: '薄膜干涉彩虹色散圣晶 + 极光菱形焦散镜湖；临落定自动开启 0.22x 子弹时间推镜特写，折射七彩流光丝带。',
    accent: '#6be6ff',
    swatch: 'linear-gradient(135deg, #0b3954 0%, #1c7c9c 50%, #a8ffef 100%)',
    soundPreset: 'prism'
  },
  {
    id: 'inferno',
    themeIndex: 2,
    name: '焚天熔炉 · 孤注一掷',
    subtitle: 'Hellforge Overdrive',
    badge: '🔥 孤注一掷专属',
    desc: '锻打陨铁外壳包裹炽白涌动岩浆核，重砸玄武岩铁砧迸发放射状熔岩裂痕、速度拉伸飞溅火星与火山熔柱！',
    accent: '#ff6426',
    swatch: 'radial-gradient(circle at 40% 35%, #ff7b1c 0%, #591406 58%, #140604 100%)',
    soundPreset: 'inferno'
  },
  {
    id: 'cyber',
    themeIndex: 3,
    name: '赛博超频 · 霓虹矩阵',
    subtitle: 'Cyberpunk Overdrive',
    badge: '⚡ 全息锁定 HUD',
    desc: '烟熏全息激光扫描切面 + 霓虹透视网格，撞击触发强烈 RGB 光学色差，落定实时追踪多面体锁定战术遥测准星。',
    accent: '#00f5d4',
    swatch: 'linear-gradient(135deg, #081229 0%, #007f8c 52%, #ff007f 100%)',
    soundPreset: 'cyber'
  },
  {
    id: 'jianxin',
    themeIndex: 4,
    name: '水墨剑心 · 太虚玉简',
    subtitle: 'Jade & Cinnabar',
    badge: '🗡️ 飞白剑气朱印',
    desc: '次表面散射温润羊脂白玉鎏金骰 + 宣纸远山水墨分形晕染 + 书法“飞白”浓墨拖尾，落定横贯剑气并拍下斑驳朱砂方印！',
    accent: '#e03c31',
    swatch: 'linear-gradient(135deg, #dcd4c4 0%, #8f9491 62%, #2b2f33 100%)',
    soundPreset: 'jianxin'
  },
  {
    id: 'singularity',
    themeIndex: 5,
    name: '虚空星噬 · 诡秘奇点',
    subtitle: 'Eldritch Singularity',
    badge: '👁️ 引力透镜暗骰',
    desc: '黑洞吸积盘实时引力透镜扭曲舞台 + 古神荧光骨晶脉络，暗骰模式悬浮诡秘全视秘眼封印，点击撕裂空间揭晓真身。',
    accent: '#39e5b6',
    swatch: 'radial-gradient(circle at 50% 45%, #25a18e 0%, #241038 55%, #05050a 100%)',
    soundPreset: 'singularity'
  }
])

const TIER_CODE_MAP = {
  normal: 0,
  critical: 1,
  success: 2,
  costly: 3,
  failure: 4,
  fumble: 5
}

const SEAL_TEXT_BY_TIER = {
  normal: '定局',
  critical: '大成功',
  success: '成功',
  costly: '代价成功',
  failure: '失败',
  fumble: '大失败'
}

function drawThemeSealOverlay(ctx, { themeIndex, tier, settleTime, sx, sy, scaleMul = 1, fadeStart = 1.9 }) {
  const sealWord = SEAL_TEXT_BY_TIER[tier] || '成功'
  const slamT = Math.min(1, settleTime / 0.14)
  const scale = (slamT < 1 ? (2.1 - 1.1 * slamT) : 1.0) * scaleMul
  const fade = settleTime > fadeStart ? Math.max(0, 1 - (settleTime - fadeStart) / 0.65) : 1.0
  const horizFontSize = sealWord.length >= 4 ? 19 : (sealWord.length === 3 ? 23 : 26)

  ctx.save()
  ctx.translate(sx, sy)
  ctx.scale(scale, scale)
  ctx.globalAlpha = fade * 0.94

  if (themeIndex === 4) {
    // 水墨剑心：落定拍案篆体「朱砂红印」
    ctx.rotate(-0.08)
    ctx.fillStyle = '#b91c1c'
    ctx.strokeStyle = '#fef2f2'
    ctx.beginPath()
    ctx.roundRect(-34, -44, 68, 88, 4)
    ctx.fill()
    ctx.lineWidth = 2.4
    ctx.strokeRect(-29, -39, 58, 78)

    ctx.fillStyle = '#fff8f1'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (sealWord.length <= 2) {
      ctx.font = '900 28px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(sealWord[0], 0, -17)
      ctx.fillText(sealWord[1] || '', 0, 18)
    } else if (sealWord.length === 3) {
      ctx.font = '900 21px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(sealWord[0], 0, -23)
      ctx.fillText(sealWord[1], 0, 0)
      ctx.fillText(sealWord[2], 0, 23)
    } else {
      ctx.font = '900 16px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(sealWord[0], 0, -26)
      ctx.fillText(sealWord[1], 0, -9)
      ctx.fillText(sealWord[2], 0, 9)
      ctx.fillText(sealWord[3], 0, 26)
    }
  } else if (themeIndex === 0) {
    // 星穹秘法：24K 鎏金星盘印章
    ctx.rotate(-0.04)
    ctx.fillStyle = 'rgba(14, 9, 34, 0.92)'
    ctx.beginPath()
    ctx.arc(0, 0, 46, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#f5b942'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(0, 0, 46, 0, Math.PI * 2)
    ctx.stroke()

    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(245, 185, 66, 0.72)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(0, 0, 39, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = '#f5b942'
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5
      const px = Math.cos(a) * 46
      const py = Math.sin(a) * 46
      ctx.beginPath()
      ctx.arc(px, py, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(245, 185, 66, 0.65)'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffe699'
    ctx.font = `900 ${horizFontSize}px "Songti SC", "Noto Serif SC", "STKaiti", serif`
    ctx.fillText(sealWord, 0, 1)
  } else if (themeIndex === 1) {
    // 时停棱镜：碎星圣晶棱形徽章
    ctx.fillStyle = 'rgba(8, 36, 56, 0.88)'
    ctx.beginPath()
    ctx.moveTo(0, -44)
    ctx.lineTo(50, -14)
    ctx.lineTo(42, 34)
    ctx.lineTo(0, 44)
    ctx.lineTo(-42, 34)
    ctx.lineTo(-50, -14)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#a8ffef'
    ctx.lineWidth = 2.2
    ctx.stroke()

    ctx.strokeStyle = 'rgba(107, 230, 255, 0.65)'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(0, -37)
    ctx.lineTo(43, -11)
    ctx.lineTo(36, 29)
    ctx.lineTo(0, 37)
    ctx.lineTo(-36, 29)
    ctx.lineTo(-43, -11)
    ctx.closePath()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(107, 230, 255, 0.75)'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffffff'
    ctx.font = `900 ${horizFontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.fillText(sealWord, 0, 2)
  } else if (themeIndex === 2) {
    // 焚天熔炉：锻铁熔岩六角徽记
    ctx.rotate(-0.04)
    ctx.fillStyle = 'rgba(26, 8, 5, 0.93)'
    ctx.beginPath()
    ctx.moveTo(-40, -34)
    ctx.lineTo(40, -34)
    ctx.lineTo(52, 0)
    ctx.lineTo(40, 34)
    ctx.lineTo(-40, 34)
    ctx.lineTo(-52, 0)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#ff6426'
    ctx.lineWidth = 2.6
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255, 179, 71, 0.75)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-35, -28)
    ctx.lineTo(35, -28)
    ctx.lineTo(45, 0)
    ctx.lineTo(35, 28)
    ctx.lineTo(-35, 28)
    ctx.lineTo(-45, 0)
    ctx.closePath()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(255, 100, 38, 0.85)'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#fff1e0'
    ctx.font = `900 ${horizFontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.fillText(sealWord, 0, 1)
  } else if (themeIndex === 3) {
    // 赛博超频：霓虹全息战术铭牌
    const neon = tier === 'fumble' ? '#ff2a85' : '#00f5d4'
    const cut = 10
    const hw = 48
    const hh = 32
    ctx.fillStyle = 'rgba(6, 16, 32, 0.90)'
    ctx.beginPath()
    ctx.moveTo(-hw + cut, -hh)
    ctx.lineTo(hw, -hh)
    ctx.lineTo(hw, hh - cut)
    ctx.lineTo(hw - cut, hh)
    ctx.lineTo(-hw, hh)
    ctx.lineTo(-hw, -hh + cut)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = neon
    ctx.lineWidth = 2.0
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = neon
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffffff'
    ctx.font = `900 ${horizFontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    ctx.fillText(sealWord, 0, 1)
  } else {
    // 虚空星噬：诡秘奇点蚀环印
    ctx.fillStyle = 'rgba(8, 6, 18, 0.94)'
    ctx.beginPath()
    ctx.arc(0, 0, 46, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#a855f7'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(0, 0, 46, 0, Math.PI * 2)
    ctx.stroke()

    ctx.strokeStyle = '#39e5b6'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.arc(0, 0, 40, 0, Math.PI * 2)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(57, 229, 182, 0.72)'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#e8fff9'
    ctx.font = `900 ${horizFontSize}px "Songti SC", "Noto Serif SC", "STKaiti", serif`
    ctx.fillText(sealWord, 0, 1)
  }

  ctx.restore()
}

const SIM_DT = 1 / 120
const MAX_STEPS = 320 // 2.67s 120Hz 高精度轨迹（支撑宽幅剧场长弧线投掷）
const PARTICLE_CAP = 900

function qMul(ax, ay, az, aw, bx, by, bz, bw, out) {
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by - ax * bz + ay * bw + az * bx
  out[2] = aw * bz + ax * by - ay * bx + az * bw
  out[3] = aw * bw - ax * bx - ay * by - az * bz
}

function qNorm(q) {
  const inv = 1 / (Math.hypot(q[0], q[1], q[2], q[3]) || 1)
  q[0] *= inv; q[1] *= inv; q[2] *= inv; q[3] *= inv
}

function qSlerp(a, ao, b, bo, t, out) {
  let ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3]
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3]
  let dot = ax * bx + ay * by + az * bz + aw * bw
  if (dot < 0) {
    dot = -dot
    bx = -bx; by = -by; bz = -bz; bw = -bw
  }
  if (dot > 0.9995) {
    out[0] = ax + (bx - ax) * t
    out[1] = ay + (by - ay) * t
    out[2] = az + (bz - az) * t
    out[3] = aw + (bw - aw) * t
    qNorm(out)
    return
  }
  const theta = Math.acos(dot)
  const sinT = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / sinT
  const wb = Math.sin(t * theta) / sinT
  out[0] = ax * wa + bx * wb
  out[1] = ay * wa + by * wb
  out[2] = az * wa + bz * wb
  out[3] = aw * wa + bz * 0 + bw * wb
}

function mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, out) {
  const tr = m00 + m11 + m22
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0)
    out[3] = 0.25 / s
    out[0] = (m21 - m12) * s
    out[1] = (m02 - m20) * s
    out[2] = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22)
    out[3] = (m21 - m12) / s
    out[0] = 0.25 * s
    out[1] = (m01 + m10) / s
    out[2] = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22)
    out[3] = (m02 - m20) / s
    out[0] = (m01 + m10) / s
    out[1] = 0.25 * s
    out[2] = (m12 + m21) / s
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11)
    out[3] = (m10 - m01) / s
    out[0] = (m02 + m20) / s
    out[1] = (m12 + m21) / s
    out[2] = 0.25 * s
  }
  qNorm(out)
}

class CinematicDiceStage {
  constructor(glCanvas, hudCanvas, options = {}) {
    this.glCanvas = glCanvas
    this.hudCanvas = hudCanvas || null
    this.hudCtx = hudCanvas ? hudCanvas.getContext('2d') : null
    this.renderer = options._preRenderer || new WebGLDiceRenderer(glCanvas)

    this.audio = options.audio || null
    this.onTelemetry = options.onTelemetry || null
    this.onRollSettled = options.onRollSettled || null
    this.compactMode = Boolean(options.compact)
    this.theaterMode = Boolean(options.theater)

    this.theme = NEXTGEN_THEMES[0]
    this.quality = 'ultra' // 'ultra' | 'balanced' | 'lite'
    this.usePipsForD6 = false
    this.cinematicCamEnabled = !this.compactMode

    this.cssW = 800
    this.cssH = 520
    this.dpr = 1

    // 引擎运行与帧率遥测
    this.running = false
    this.rafId = 0
    this.clock = 0
    this.lastNow = 0
    this.frameTimes = new Float32Array(60)
    this.ftCursor = 0
    this.fpsAccum = 0
    this.fpsFrames = 0
    this.fps = 60

    // 投掷状态与模式
    this.dice = []
    this.tier = 'success'
    this.mode = 'normal' // 'normal' | 'fate' | 'push' | 'hidden'
    this.revealed = false
    this.total = 20
    this.checkName = '命运裁定'
    this.settled = true
    this.settleTime = 10
    this.rollTime = 0
    this.simTime = 0
    this.maxSimDuration = 1.2
    this.simPace = 1
    this.climax = 0
    this.bulletTimeAmount = 0
    this.bulletSoundPlayed = false

    // 交互式按住蓄力旋涡 & 拖拽甩投状态
    this.charging = false
    this.chargeTime = 0
    this.chargeWorld = { x: 0, y: -60, z: 95 }
    this.dragHistory = [] // [{ x, y, t }]
    this.pendingSpecBuilder = options.buildSpecOnDragRelease || null

    // 电影级弹簧摄像机状态
    this.baseEye = [0, -395, 435]
    this.camEye = [0, -395, 435]
    this.camTarget = [0, 8, 14]
    this.camFov = (38 * Math.PI) / 180
    this.shakeAmp = 0
    this.chroma = 0.06
    this.shockwave = [0.5, 0.5, 0, 0] // u, v, radius, strength
    this.shockAge = 99

    // 桌面撞击贴花槽 (8个)
    this.impacts = Array.from({ length: 8 }, () => ({ x: 0, y: 0, age: 0, strength: 0 }))
    this.impactCursor = 0
    this.bounceQueue = []
    this.bouncePlayCursor = 0

    // 3D 弧形剑气 / 星环轨槽 (8条)
    this.slashes = Array.from({ length: 8 }, () => ({
      active: false, cx: 0, cy: 0, cz: 20, radius: 90, tilt: 0.4, angle: 0, width: 10, age: 0, life: 0.6, r: 1, g: 1, b: 1
    }))
    this.slashCursor = 0

    // SoA GPU 粒子与冲天光柱池
    this.particles = {
      capacity: PARTICLE_CAP,
      aliveCount: 0,
      cursor: 0,
      active: new Uint8Array(PARTICLE_CAP),
      x: new Float32Array(PARTICLE_CAP),
      y: new Float32Array(PARTICLE_CAP),
      z: new Float32Array(PARTICLE_CAP),
      vx: new Float32Array(PARTICLE_CAP),
      vy: new Float32Array(PARTICLE_CAP),
      vz: new Float32Array(PARTICLE_CAP),
      size: new Float32Array(PARTICLE_CAP),
      age: new Float32Array(PARTICLE_CAP),
      life: new Float32Array(PARTICLE_CAP),
      grav: new Float32Array(PARTICLE_CAP),
      drag: new Float32Array(PARTICLE_CAP),
      r: new Float32Array(PARTICLE_CAP),
      g: new Float32Array(PARTICLE_CAP),
      b: new Float32Array(PARTICLE_CAP),
      a: new Float32Array(PARTICLE_CAP),
      mode: new Float32Array(PARTICLE_CAP) // 0: 速度拉伸火星, 1: 冲天光柱
    }

    this._qTmp = new Float32Array(4)
    this._uvTmp = { u: 0.5, v: 0.5, visible: true }

    this.resize()
    if (options.interactive !== false) {
      this._bindInteractiveSlingshot()
    }
  }

  resize() {
    const rect = this.glCanvas.getBoundingClientRect()
    const w = Math.max(120, Math.round(rect.width || this.glCanvas.clientWidth || 800))
    const h = Math.max(68, Math.round(rect.height || this.glCanvas.clientHeight || 480))
    const maxDpr = this.quality === 'lite' ? 1.0 : this.quality === 'balanced' ? 1.5 : 2.0
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)

    this.cssW = w
    this.cssH = h
    this.dpr = dpr
    this.renderer.resize(Math.round(w * dpr), Math.round(h * dpr))

    if (this.hudCanvas) {
      this.hudCanvas.width = Math.round(w * dpr)
      this.hudCanvas.height = Math.round(h * dpr)
    }

    const aspect = w / Math.max(1, h)
    // 宽扁横幅或竖窄屏幕自适应视野距离（拉近约 22%，让多面体与数字饱满清晰）
    const distScale = aspect > 2.1 ? 0.66 : aspect < 0.9 ? 1.15 : 0.88
    this.baseEye[0] = 0
    this.baseEye[1] = -335 * distScale
    this.baseEye[2] = 395 * distScale
    this.renderSingleFrame()
  }

  setTheme(themeObj) {
    if (!themeObj) return
    this.theme = themeObj
    this.wake()
  }

  setQuality(q) {
    this.quality = q || 'ultra'
    this.resize()
    this.wake()
  }

  setUsePipsForD6(flag) {
    this.usePipsForD6 = Boolean(flag)
    this.renderSingleFrame()
  }

  setCinematicCam(flag) {
    this.cinematicCamEnabled = Boolean(flag)
    this.wake()
  }

  /**
   * 手动按钮长按蓄力 API：按住重投/投掷按钮时，骰群升空进入中心引力聚能旋涡！
   */
  startButtonCharge(modeHint) {
    if (this.charging) return
    this.themeBeforeCharge = this.theme
    if (modeHint === 'fate') this.setTheme(NEXTGEN_THEMES[1])
    else if (modeHint === 'push') this.setTheme(NEXTGEN_THEMES[2])
    // 若舞台当前尚无骰子，先放置一颗默认多面体参与蓄力旋涡演出
    if (!this.dice || this.dice.length === 0) {
      this.setStaticRoll({ diceSpecs: [{ meshKey: 'd20', sides: 20, targetValue: 20 }], tier: 'success', mode: 'normal' })
    }
    this.charging = true
    this.buttonCharging = true
    this.chargeTime = 0
    this.chargeWorld.x = 0
    this.chargeWorld.y = -12
    this.chargeWorld.z = 92
    if (this.audio) this.audio.startChargeHum(this.theme.soundPreset)
    this.wake()
  }

  /**
   * 移出按钮取消蓄力：不消耗命运点或重投次数，平稳落回原状
   */
  cancelButtonCharge() {
    if (!this.charging) return
    this.charging = false
    this.buttonCharging = false
    if (this.audio) this.audio.stopChargeHum()
    // 恢复落定态原坐标与姿态
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      const ep = (MAX_STEPS - 1) * 3
      const eq = (MAX_STEPS - 1) * 4
      d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
      d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
      d.trailCount = 0
      d.settled = true
    }
    this.settled = true
    // 无损取消：蓄力期间临时换上的逆命/熔炉主题必须还原，否则这张卡片会一直停留在熔炉皮肤
    if (this.themeBeforeCharge) {
      this.theme = this.themeBeforeCharge
      this.themeBeforeCharge = null
    }
    this.wake()
  }

  /**
   * 松开蓄力按钮：带着蓄力能量将旋涡中的骰群爆发砸向指定真骰结果！
   */
  releaseButtonCharge(spec, charge01 = 0.6) {
    const power = Math.max(0, Math.min(1, Number(charge01) || 0))
    this.charging = false
    this.buttonCharging = false
    this.themeBeforeCharge = null
    if (this.audio) this.audio.stopChargeHum()
    const enriched = { ...(spec || {}) }
    if (power > 0.12) {
      const angle = (Math.random() - 0.5) * 1.1 + Math.PI * 0.5
      const spd = 220 + power * 420
      enriched.launchOrigin = { x: 0, y: -24, z: 98 + power * 48 }
      enriched.launchVelocity = {
        vx: Math.cos(angle) * spd * 0.55,
        vy: Math.sin(angle) * spd * 0.55
      }
    }
    this.throwDice(enriched)
  }

  /**
   * 静态摆盘（打开已有楼层检定面板时直接展示已落定真骰，不重复假投）
   */
  setStaticRoll(spec = {}) {
    this.throwDice({ ...spec, silentStatic: true })
    this.settled = true
    this.settleTime = 3.0
    this.simTime = this.maxSimDuration
    this.climax = 0
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      const ep = (MAX_STEPS - 1) * 3
      const eq = (MAX_STEPS - 1) * 4
      d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
      d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
      d.speed = 0
      d.trailCount = 0
      d.settled = true
    }
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    this.renderSingleFrame()
  }

  _bindInteractiveSlingshot() {
    const el = this.glCanvas
    const toWorld = (clientX, clientY, planeZ) => {
      const rect = el.getBoundingClientRect()
      const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      const ny = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2
      return this.renderer.unprojectToPlane(nx, ny, planeZ, { x: 0, y: 0, z: planeZ })
    }

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      // 若当前处于暗骰落定待揭晓状态，轻点直接撕开封印揭晓！
      if (this.mode === 'hidden' && !this.revealed && this.settled) {
        this.revealHidden()
        return
      }
      el.setPointerCapture(e.pointerId)
      this.charging = true
      this.chargeTime = 0
      const wp = toWorld(e.clientX, e.clientY, 85)
      this.chargeWorld.x = Math.max(-210, Math.min(210, wp.x))
      this.chargeWorld.y = Math.max(-165, Math.min(165, wp.y))
      this.dragHistory = [{ x: this.chargeWorld.x, y: this.chargeWorld.y, t: performance.now() }]
      if (this.audio) this.audio.startChargeHum(this.theme.soundPreset)
      this.wake()
    })

    el.addEventListener('pointermove', e => {
      if (!this.charging) return
      const wp = toWorld(e.clientX, e.clientY, 85)
      this.chargeWorld.x = Math.max(-220, Math.min(220, wp.x))
      this.chargeWorld.y = Math.max(-175, Math.min(175, wp.y))
      const now = performance.now()
      this.dragHistory.push({ x: this.chargeWorld.x, y: this.chargeWorld.y, t: now })
      if (this.dragHistory.length > 8) this.dragHistory.shift()
    })

    const finishDrag = () => {
      if (!this.charging) return
      this.charging = false
      if (this.audio) this.audio.stopChargeHum()

      // 计算甩投初速度向量
      let vx = 0, vy = 0
      if (this.dragHistory.length >= 2) {
        const first = this.dragHistory[0]
        const last = this.dragHistory[this.dragHistory.length - 1]
        const dt = Math.max(0.016, (last.t - first.t) * 0.001)
        vx = ((last.x - first.x) / dt) * 0.68
        vy = ((last.y - first.y) / dt) * 0.68
      }
      const speed = Math.hypot(vx, vy)
      if (speed > 780) {
        vx = (vx / speed) * 780
        vy = (vy / speed) * 780
      }

      const spec = this.pendingSpecBuilder ? this.pendingSpecBuilder() : null
      if (spec) {
        if (speed > 65 || this.chargeTime > 0.18) {
          spec.launchOrigin = { x: this.chargeWorld.x, y: this.chargeWorld.y, z: 95 + Math.min(1, this.chargeTime) * 45 }
          spec.launchVelocity = {
            vx: speed > 65 ? vx : -this.chargeWorld.x * 2.4 + (Math.random() - 0.5) * 180,
            vy: speed > 65 ? vy : -this.chargeWorld.y * 2.4 + (Math.random() - 0.5) * 180
          }
        }
        this.throwDice(spec)
      }
    }

    el.addEventListener('pointerup', finishDrag)
    el.addEventListener('pointercancel', finishDrag)
  }

  revealHidden() {
    if (this.mode !== 'hidden' || this.revealed) return
    this.revealed = true
    this.settleTime = 0
    this.climax = 1.0
    this._triggerClimaxFX()
    if (this.audio) this.audio.playSettle(this.theme.soundPreset, this.tier)
    if (this.onRollSettled) this.onRollSettled(this)
    this.wake()
  }

  _spawnSpark(opts) {
    if (this.quality === 'lite' && (this.particles.cursor & 1) === 1) {
      this.particles.cursor = (this.particles.cursor + 1) % PARTICLE_CAP
      return
    }
    const p = this.particles
    const i = p.cursor
    p.cursor = (i + 1) % PARTICLE_CAP
    if (!p.active[i]) p.aliveCount++
    p.active[i] = 1
    p.x[i] = opts.x || 0
    p.y[i] = opts.y || 0
    p.z[i] = opts.z || 4
    p.vx[i] = opts.vx || 0
    p.vy[i] = opts.vy || 0
    p.vz[i] = opts.vz || 0
    p.size[i] = opts.size || 3.5
    p.age[i] = 0
    p.life[i] = opts.life || 0.55
    p.grav[i] = opts.grav !== undefined ? opts.grav : 420
    p.drag[i] = opts.drag !== undefined ? opts.drag : 1.6
    p.r[i] = opts.r !== undefined ? opts.r : 2.5
    p.g[i] = opts.g !== undefined ? opts.g : 1.6
    p.b[i] = opts.b !== undefined ? opts.b : 0.4
    p.a[i] = opts.a !== undefined ? opts.a : 1.0
    p.mode[i] = opts.pillar ? 1.0 : 0.0
  }

  _spawnSlash(cx, cy, cz, radius, tilt, angle, width, life, r, g, b) {
    const sl = this.slashes[this.slashCursor % this.slashes.length]
    this.slashCursor++
    sl.active = true
    sl.cx = cx; sl.cy = cy; sl.cz = cz
    sl.radius = radius
    sl.tilt = tilt
    sl.angle = angle
    sl.width = width
    sl.age = 0
    sl.life = life
    sl.r = r; sl.g = g; sl.b = b
  }

  _themeHDRColor() {
    const id = this.theme.themeIndex
    if (id === 0) return this.tier === 'fumble' ? [2.2, 0.35, 3.4] : [3.4, 2.1, 0.55]
    if (id === 1) return [0.9, 2.6, 3.8]
    if (id === 2) return [4.8, 1.55, 0.2]
    if (id === 3) return [0.2, 3.0, 3.4]
    if (id === 4) return this.tier === 'critical' ? [2.6, 0.35, 0.22] : [0.9, 0.85, 0.7]
    return this.tier === 'fumble' ? [2.4, 0.3, 3.4] : [0.4, 2.9, 2.2]
  }

  /**
   * 触发一次高精度真骰投掷！
   */
  throwDice(spec = {}) {
    /* pace < 1 = 慢镜投骰（正文中央的演出用它拉长整套投掷动作；胶囊/蓄力默认 1 保持原速） */
    this.simPace = Math.max(0.45, Math.min(1.6, Number(spec.pace) || 1))
    const diceSpecs = spec.diceSpecs && spec.diceSpecs.length
      ? spec.diceSpecs
      : [{ meshKey: 'd20', sides: 20, targetValue: 20 }]
    const count = diceSpecs.length

    this.tier = spec.tier || 'success'
    this.mode = spec.mode || 'normal'
    this.revealed = false
    this.total = spec.total !== undefined ? spec.total : diceSpecs.reduce((s, d) => s + d.targetValue, 0)
    this.checkName = spec.checkName || '命运裁定'

    // 清空上一轮瞬态残迹
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    for (const imp of this.impacts) imp.strength = 0
    for (const sl of this.slashes) sl.active = false
    this.shockAge = 99
    this.shockwave[3] = 0
    this.climax = 0
    this.bulletTimeAmount = 0
    this.bulletSoundPlayed = false

    const baseR = count <= 1 ? 42 : count <= 2 ? 37 : count <= 4 ? 31 : count <= 8 ? 25 : count <= 14 ? 20 : 16
    const aspect = this.cssW / Math.max(1, this.cssH)
    const boundX = Math.min(this.theaterMode ? 285 : 225, Math.max(92, 155 * aspect)) - baseR
    const boundY = (this.compactMode ? 88 : 138) - baseR

    const dice = []
    for (let i = 0; i < count; i++) {
      const ds = diceSpecs[i]
      const mesh = GL_MESHES[ds.meshKey] || GL_MESHES.d20
      let targetFace = mesh.faces[0]
      for (let f = 0; f < mesh.faces.length; f++) {
        if (mesh.faces[f].value === ds.targetValue) {
          targetFace = mesh.faces[f]
          break
        }
      }

      let startX, startY, startZ, vx, vy, vz
      if (spec.launchOrigin && spec.launchVelocity) {
        const spreadA = (i / Math.max(1, count)) * Math.PI * 2
        const spreadR = count > 1 ? 18 + (i % 3) * 10 : 0
        startX = spec.launchOrigin.x + Math.cos(spreadA) * spreadR
        startY = spec.launchOrigin.y + Math.sin(spreadA) * spreadR
        startZ = spec.launchOrigin.z + (i % 4) * 12
        vx = spec.launchVelocity.vx + (Math.random() - 0.5) * 95
        vy = spec.launchVelocity.vy + (Math.random() - 0.5) * 95
        vz = 140 + Math.random() * 130
      } else {
        // 默认从近景两侧帅气弧线抛入舞台正中央星盘！剧场横幅模式从宽翼起跳，向中心黄金圆环精准聚拢碰撞
        const side = (i % 2 === 0 ? -1 : 1) * (0.86 + Math.random() * 0.12)
        startX = this.theaterMode ? side * boundX * 0.96 : side * boundX * 0.88
        startY = -boundY * (0.72 + Math.random() * 0.30)
        startZ = baseR + (this.theaterMode ? 132 : 105) + Math.random() * 68 + (i % 4) * 14

        const ringR = count === 1
          ? 0
          : (this.theaterMode
            ? baseR * (1.05 + Math.sqrt(count) * 0.52)
            : Math.min(boundX * 0.58, baseR * (1.65 + Math.sqrt(count) * 0.78)))
        const slotA = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35
        const aimX = Math.cos(slotA) * ringR * (this.theaterMode ? 0.78 : 0.85)
        const aimY = Math.sin(slotA) * ringR * 0.65 + (this.theaterMode ? 2 : 12)
        const tFlight = (this.theaterMode ? 0.52 : 0.38) + Math.random() * 0.07
        const jitter = this.theaterMode ? 36 : 65
        vx = (aimX - startX) / tFlight + (Math.random() - 0.5) * jitter
        vy = (aimY - startY) / tFlight + (Math.random() - 0.5) * jitter
        vz = (this.theaterMode ? 168 : 135) + Math.random() * 105
      }

      dice.push({
        index: i,
        mesh,
        meshKey: ds.meshKey,
        sides: ds.sides || mesh.faceCount,
        faceValue: ds.targetValue,
        targetFace,
        radius: baseR * (ds.meshKey === 'd4' ? 1.12 : 1.0),
        x: startX, y: startY, z: startZ,
        vx, vy, vz,
        wx: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12),
        wy: (Math.random() < 0.5 ? -1 : 1) * (13 + Math.random() * 12),
        wz: (Math.random() - 0.5) * 16,
        qx: 0, qy: 0, qz: 0, qw: 1,
        speed: Math.hypot(vx, vy, vz),
        settled: false,
        settleStep: MAX_STEPS - 1,
        bounces: 0,
        trajPos: new Float32Array(MAX_STEPS * 3),
        trajQuat: new Float32Array(MAX_STEPS * 4),
        trajSpeed: new Float32Array(MAX_STEPS),
        trailX: new Float32Array(28),
        trailY: new Float32Array(28),
        trailZ: new Float32Array(28),
        trailCount: 0,
        trailHead: 0
      })
    }

    this._bakeTrajectoriesAndExactLanding(dice, boundX, boundY)

    this.dice = dice
    this.settled = false
    this.settleTime = 0
    this.rollTime = 0
    this.simTime = 0
    this.bouncePlayCursor = 0

    if (this.audio && !spec.silentStatic) {
      this.audio.playThrowWhoosh(this.theme.soundPreset, 1.1)
    }
    if (!spec.silentStatic) this.wake()
  }

  _bakeTrajectoriesAndExactLanding(dice, boundX, boundY) {
    const count = dice.length
    const gravity = 1680
    this.bounceQueue.length = 0
    const dq = new Float32Array(4)
    const qNext = new Float32Array(4)
    let maxSettleStep = 48

    for (let step = 0; step < MAX_STEPS; step++) {
      for (let i = 0; i < count; i++) {
        const d = dice[i]
        // 内切距离使多面体真实贴合 z=0 台面
        const floorZ = d.radius * (d.meshKey === 'd4' ? 0.52 : d.meshKey === 'd6' || d.meshKey === 'df' ? 0.62 : 0.76)

        if (!d._simSettled) {
          d.vz -= gravity * SIM_DT
          d.x += d.vx * SIM_DT
          d.y += d.vy * SIM_DT
          d.z += d.vz * SIM_DT

          d.vx *= 0.996
          d.vy *= 0.996

          if (d.x < -boundX) { d.x = -boundX; d.vx = Math.abs(d.vx) * 0.68; d.wz += 5 }
          else if (d.x > boundX) { d.x = boundX; d.vx = -Math.abs(d.vx) * 0.68; d.wz -= 5 }
          if (d.y < -boundY) { d.y = -boundY; d.vy = Math.abs(d.vy) * 0.68; d.wx += 5 }
          else if (d.y > boundY) { d.y = boundY; d.vy = -Math.abs(d.vy) * 0.68; d.wx -= 5 }

          if (d.z <= floorZ) {
            d.z = floorZ
            const impV = -d.vz
            if (impV > 60 && d.bounces < 5) {
              const rest = Math.max(0.24, 0.58 - d.bounces * 0.09)
              d.vz = impV * rest
              d.vx *= this.theaterMode ? 0.56 : 0.75
              d.vy *= this.theaterMode ? 0.64 : 0.75
              d.wx = d.wx * 0.65 - d.vy * 0.05 + (Math.random() - 0.5) * 6.5
              d.wy = d.wy * 0.65 + d.vx * 0.05 + (Math.random() - 0.5) * 6.5
              d.wz *= 0.72
              this.bounceQueue.push({
                simTime: step * SIM_DT,
                x: d.x,
                y: d.y,
                z: 3,
                strength: Math.min(1, impV / 540),
                bounceIndex: d.bounces,
                dieIndex: i
              })
              d.bounces++
            } else {
              d.vz = 0
              d.vx *= 0.80
              d.vy *= 0.80
              d.wx *= 0.76
              d.wy *= 0.76
              d.wz *= 0.76
              if (Math.hypot(d.vx, d.vy) < 5.5 && Math.hypot(d.wx, d.wy, d.wz) < 0.42 && step > 40) {
                d.vx = 0; d.vy = 0; d.vz = 0
                d.wx = 0; d.wy = 0; d.wz = 0
                d._simSettled = true
                d.settleStep = step
                if (step > maxSettleStep) maxSettleStep = step
              }
            }
          }

          const wMag = Math.hypot(d.wx, d.wy, d.wz)
          if (wMag > 1e-4) {
            const half = 0.5 * wMag * SIM_DT
            const s = Math.sin(half) / wMag
            dq[0] = d.wx * s; dq[1] = d.wy * s; dq[2] = d.wz * s; dq[3] = Math.cos(half)
            qMul(dq[0], dq[1], dq[2], dq[3], d.qx, d.qy, d.qz, d.qw, qNext)
            qNorm(qNext)
            d.qx = qNext[0]; d.qy = qNext[1]; d.qz = qNext[2]; d.qw = qNext[3]
          }
        }
      }

      // 多骰 3D 球体刚性互撞弹开
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = dice[i], b = dice[j]
          const minDist = (a.radius + b.radius) * 0.96
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < minDist * minDist && d2 > 1e-4) {
            const dist = Math.sqrt(d2)
            const nx = dx / dist, ny = dy / dist, nz = dz / dist
            const overlap = (minDist - dist) * 0.52
            a.x -= nx * overlap; a.y -= ny * overlap
            b.x += nx * overlap; b.y += ny * overlap
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvz = b.vz - a.vz
            const vn = rvx * nx + rvy * ny + rvz * nz
            if (vn < 0) {
              const imp = -0.84 * vn
              a.vx -= nx * imp; a.vy -= ny * imp; a.vz -= nz * imp * 0.35
              b.vx += nx * imp; b.vy += ny * imp; b.vz += nz * imp * 0.35
              if (imp > 18) {
                a._simSettled = false
                b._simSettled = false
              }
              const hs = Math.min(1, imp / 260)
              if (hs > 0.25 && this.bounceQueue.length < 96) {
                this.bounceQueue.push({
                  simTime: step * SIM_DT,
                  x: (a.x + b.x) * 0.5,
                  y: (a.y + b.y) * 0.5,
                  z: (a.z + b.z) * 0.5,
                  strength: hs * 0.85,
                  bounceIndex: 1,
                  dieIndex: i
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < count; i++) {
        const d = dice[i]
        const po = step * 3
        d.trajPos[po] = d.x; d.trajPos[po + 1] = d.y; d.trajPos[po + 2] = d.z
        d.trajSpeed[step] = Math.hypot(d.vx, d.vy, d.vz)
        const qo = step * 4
        d.trajQuat[qo] = d.qx; d.trajQuat[qo + 1] = d.qy; d.trajQuat[qo + 2] = d.qz; d.trajQuat[qo + 3] = d.qw
      }
    }

    for (let i = 0; i < count; i++) {
      if (!dice[i]._simSettled) {
        dice[i].settleStep = MAX_STEPS - 2
        maxSettleStep = MAX_STEPS - 2
      }
    }
    this.maxSimDuration = maxSettleStep * SIM_DT
    this.bounceQueue.sort((a, b) => a.simTime - b.simTime)

    // 逆向四元数对齐：确保目标面最终稳稳朝上微倾面向摄像机，且 det(W * L^T) = (-1)*(-1) = +1 严格属于 SO(3)！
    const qDesired = new Float32Array(4)
    const qInit = new Float32Array(4)
    const qBaked = new Float32Array(4)

    for (let i = 0; i < count; i++) {
      const d = dice[i]
      const tf = d.targetFace
      // 落定面法线向摄像机方向适度前倾 (0.28 rad ≈ 16°)，消除透视压缩，让顶面大号数字正对视线！
      const tiltCam = d.meshKey === 'd4' ? 0.44 : 0.28
      const wnX = 0, wnY = -Math.sin(tiltCam), wnZ = Math.cos(tiltCam)

      // 保持极轻微偏航角 (±6°)，端正大气易读
      const yaw = (Math.random() - 0.5) * 0.22
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
      // 基准 Wv 指向屏幕下方 (-Y 侧)，绕 Wn 偏航后并设 Wu = cross(Wn, Wv) 以严格对齐 gl-meshes 切空间手性
      const wvX = sy
      const wvY = -cy * Math.cos(tiltCam)
      const wvZ = -cy * Math.sin(tiltCam)

      const wuX = wnY * wvZ - wnZ * wvY
      const wuY = wnZ * wvX - wnX * wvZ
      const wuZ = wnX * wvY - wnY * wvX

      const ux = tf.uAxis[0], uy = tf.uAxis[1], uz = tf.uAxis[2]
      const vx = tf.vAxis[0], vy = tf.vAxis[1], vz = tf.vAxis[2]
      const nx = tf.normal[0], ny = tf.normal[1], nz = tf.normal[2]

      const m00 = wuX * ux + wvX * vx + wnX * nx
      const m10 = wuY * ux + wvY * vx + wnY * nx
      const m20 = wuZ * ux + wvZ * vx + wnZ * nx

      const m01 = wuX * uy + wvX * vy + wnX * ny
      const m11 = wuY * uy + wvY * vy + wnY * ny
      const m21 = wuZ * uy + wvZ * vy + wnZ * ny

      const m02 = wuX * uz + wvX * vz + wnX * nz
      const m12 = wuY * uz + wvY * vz + wnZ * nz
      const m22 = wuZ * uz + wvZ * vz + wnZ * nz

      mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, qDesired)

      const endO = (MAX_STEPS - 1) * 4
      const qex = d.trajQuat[endO], qey = d.trajQuat[endO + 1], qez = d.trajQuat[endO + 2], qew = d.trajQuat[endO + 3]
      qMul(-qex, -qey, -qez, qew, qDesired[0], qDesired[1], qDesired[2], qDesired[3], qInit)
      qNorm(qInit)

      for (let step = 0; step < MAX_STEPS; step++) {
        const qo = step * 4
        qMul(
          d.trajQuat[qo], d.trajQuat[qo + 1], d.trajQuat[qo + 2], d.trajQuat[qo + 3],
          qInit[0], qInit[1], qInit[2], qInit[3],
          qBaked
        )
        d.trajQuat[qo] = qBaked[0]
        d.trajQuat[qo + 1] = qBaked[1]
        d.trajQuat[qo + 2] = qBaked[2]
        d.trajQuat[qo + 3] = qBaked[3]
      }

      d.x = d.trajPos[0]; d.y = d.trajPos[1]; d.z = d.trajPos[2]
      d.qx = d.trajQuat[0]; d.qy = d.trajQuat[1]; d.qz = d.trajQuat[2]; d.qw = d.trajQuat[3]
      d.trailCount = 1
      d.trailHead = 0
      d.trailX[0] = d.x; d.trailY[0] = d.y; d.trailZ[0] = d.z
    }
  }

  _onBounceEvent(b) {
    // 1. 桌面涟漪 / 熔岩裂痕 / 水墨晕染贴花
    const imp = this.impacts[this.impactCursor % this.impacts.length]
    this.impactCursor++
    imp.x = b.x
    imp.y = b.y
    imp.age = 0.001
    imp.strength = b.strength

    // 2. 镜头物理微震动 + 赛博色差脉冲
    this.shakeAmp = Math.min(18, this.shakeAmp + b.strength * (this.theme.themeIndex === 2 ? 12 : 7))
    if (this.theme.themeIndex === 3) {
      this.chroma = Math.min(1.6, this.chroma + b.strength * 0.9)
    }

    // 3. 迸射速度拉伸 3D 火星粒子
    const col = this._themeHDRColor()
    const sparkCount = (this.quality === 'lite' ? 4 : this.quality === 'balanced' ? 9 : 15) * (b.bounceIndex === 0 ? 1.4 : 0.8)
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2
      const spd = (65 + Math.random() * 220) * b.strength
      this._spawnSpark({
        x: b.x,
        y: b.y,
        z: Math.max(4, b.z),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: (95 + Math.random() * 240) * b.strength,
        size: 2.2 + Math.random() * 2.8,
        life: 0.32 + Math.random() * 0.36,
        grav: this.theme.themeIndex === 5 ? 90 : 620,
        drag: 1.8,
        r: col[0], g: col[1], b: col[2],
        a: 1.0
      })
    }

    if (this.audio) {
      const pan = Math.max(-0.85, Math.min(0.85, b.x / 220))
      this.audio.playBounce(this.theme.soundPreset, b.strength, pan)
    }
  }

  _triggerClimaxFX() {
    if (!this.dice.length) return
    const isCrit = this.tier === 'critical'
    const isFumble = this.tier === 'fumble'
    const isDramatic = isCrit || isFumble || this.mode === 'fate' || this.mode === 'push'

    // 计算骰群几何中心并投影到屏幕 UV，触发光学径向折射冲击波！
    let cx = 0, cy = 0, cz = 0
    for (const d of this.dice) { cx += d.x; cy += d.y; cz += d.z }
    cx /= this.dice.length; cy /= this.dice.length; cz /= this.dice.length

    const uv = this.renderer.projectToUV(cx, cy, cz, this._uvTmp)
    if (uv.visible && (isDramatic || this.theme.themeIndex === 0 || this.theme.themeIndex === 2)) {
      this.shockwave[0] = uv.u
      this.shockwave[1] = uv.v
      this.shockwave[2] = 0.02
      this.shockwave[3] = isCrit ? 1.0 : isFumble ? 0.85 : 0.45
      this.shockAge = 0
    }

    this.shakeAmp = Math.max(this.shakeAmp, isCrit ? 16 : isFumble ? 14 : 6)
    this.chroma = Math.max(this.chroma, isCrit || isFumble ? 1.15 : 0.35)

    const col = this._themeHDRColor()

    for (let idx = 0; idx < this.dice.length; idx++) {
      const d = this.dice[idx]
      // 在每颗落定骰子底部加一道强烈桌面能量光环
      const imp = this.impacts[this.impactCursor % this.impacts.length]
      this.impactCursor++
      imp.x = d.x; imp.y = d.y; imp.age = 0.001; imp.strength = isCrit ? 1.25 : 0.85

      // 大成功 / 孤注一掷 / 大失败：在骰子后方升起圣光背光柱，衬托轮廓而绝不遮挡正面数字！
      if ((isCrit || isFumble || this.mode === 'push') && idx < 6) {
        this._spawnSpark({
          x: d.x, y: d.y + d.radius * 0.85, z: d.radius * 0.9,
          vx: 0, vy: 0, vz: isCrit ? 320 : 220,
          size: d.radius * (isCrit ? 1.15 : 0.95),
          life: isCrit ? 0.92 : 0.72,
          grav: 0, drag: 0,
          r: col[0], g: col[1], b: col[2],
          a: 0.58,
          pillar: true
        })
      }

      // 水墨剑心 / 星穹秘法 / 时停棱镜：凌空交错 3D 弧形剑气或星轨斩痕！
      if ((this.theme.themeIndex === 4 || isCrit) && idx < 4) {
        const slashCount = isCrit ? 3 : 2
        for (let s = 0; s < slashCount; s++) {
          const isGold = this.theme.themeIndex === 4 && isCrit && s === 0
          this._spawnSlash(
            d.x, d.y, d.z + 10,
            d.radius * (2.6 + s * 0.75),
            0.35 + (s - 0.5) * 0.55,
            s * 2.1 + idx,
            d.radius * 0.32,
            0.72 + s * 0.15,
            isGold ? 2.8 : (this.theme.themeIndex === 4 ? 0.06 : col[0]),
            isGold ? 1.8 : (this.theme.themeIndex === 4 ? 0.07 : col[1]),
            isGold ? 0.3 : (this.theme.themeIndex === 4 ? 0.09 : col[2])
          )
        }
      }

      // 礼花式高速粒子喷泉爆发
      const burstN = isCrit ? (this.quality === 'lite' ? 14 : 38) : (this.quality === 'lite' ? 6 : 16)
      for (let k = 0; k < burstN; k++) {
        const a = (k / burstN) * Math.PI * 2 + Math.random() * 0.25
        const v = 90 + Math.random() * (isCrit ? 320 : 180)
        this._spawnSpark({
          x: d.x, y: d.y, z: d.radius * 0.8,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          vz: 140 + Math.random() * (isCrit ? 360 : 190),
          size: 2.6 + Math.random() * 3.2,
          life: 0.55 + Math.random() * 0.55,
          grav: 480,
          drag: 1.4,
          r: col[0], g: col[1], b: col[2],
          a: 1.0
        })
      }
    }
  }

  wake() {
    if (this.running) return
    this.running = true
    this.lastNow = performance.now()

    const loop = now => {
      if (!this.running) return
      const t0 = performance.now()
      const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) * 0.001))
      this.lastNow = now

      this._step(rawDt)
      this._renderAll()

      const cpuMs = performance.now() - t0
      this.frameTimes[this.ftCursor] = cpuMs
      this.ftCursor = (this.ftCursor + 1) % this.frameTimes.length
      this.fpsAccum += rawDt
      this.fpsFrames++
      if (this.fpsAccum >= 0.25) {
        this.fps = Math.round(this.fpsFrames / this.fpsAccum)
        this.fpsAccum = 0
        this.fpsFrames = 0
        this._emitTelemetry(true)
      }

      // 智能 0% GPU 休眠门控：落定超过 2.6s 且无蓄力/无存活粒子/无未消散贴花 => 自动休眠！
      const hasImpacts = this.impacts.some(imp => imp.strength > 0.001)
      const hasSlashes = this.slashes.some(sl => sl.active)
      const hiddenIdle = this.mode === 'hidden' && !this.revealed && this.settleTime < 3.2
      const sleepAfter = this.theaterMode ? 3.8 : 2.6
      if (
        !this.charging &&
        this.settled &&
        this.settleTime > sleepAfter &&
        this.particles.aliveCount === 0 &&
        !hasImpacts &&
        !hasSlashes &&
        !hiddenIdle
      ) {
        this.running = false
        this._emitTelemetry(false)
        return
      }

      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    if (this.audio) this.audio.stopChargeHum()
  }

  renderSingleFrame() {
    this._renderAll()
  }

  _emitTelemetry(active) {
    if (!this.onTelemetry) return
    let sum = 0
    for (let i = 0; i < this.frameTimes.length; i++) sum += this.frameTimes[i]
    this.onTelemetry({
      fps: active ? this.fps : 0,
      avgMs: sum / this.frameTimes.length,
      particles: this.particles.aliveCount,
      diceCount: this.dice.length,
      sleeping: !active
    })
  }

  _step(rawDt) {
    this.clock += rawDt

    // 1. 按住蓄力旋涡交互阶段：骰群围绕光标悬浮高速自旋聚能！
    if (this.charging) {
      this.chargeTime += rawDt
      const c01 = Math.min(1, this.chargeTime / 0.85)
      if (this.audio) this.audio.updateChargeHum(c01)

      const n = this.dice.length
      for (let i = 0; i < n; i++) {
        const d = this.dice[i]
        const orbitR = n === 1 ? 6 : (26 + (1 - c01 * 0.35) * 28)
        const ang = this.clock * (6.5 + c01 * 8.0) + (i / Math.max(1, n)) * Math.PI * 2
        const tx = this.chargeWorld.x + Math.cos(ang) * orbitR
        const ty = this.chargeWorld.y + Math.sin(ang) * orbitR
        const tz = 82 + c01 * 38 + Math.sin(this.clock * 9 + i) * 8
        d.x += (tx - d.x) * Math.min(1, rawDt * 18)
        d.y += (ty - d.y) * Math.min(1, rawDt * 18)
        d.z += (tz - d.z) * Math.min(1, rawDt * 18)
        d.settled = false

        // 高速聚能自转
        const spin = (12 + c01 * 22) * rawDt * 0.5
        qMul(Math.sin(spin) * 0.7, Math.sin(spin) * 0.7, 0, Math.cos(spin), d.qx, d.qy, d.qz, d.qw, this._qTmp)
        qNorm(this._qTmp)
        d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

        const th = (d.trailHead + 1) % 28
        d.trailHead = th
        d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
        if (d.trailCount < 18) d.trailCount++
      }

      // 蓄力吸入星尘粒子
      const col = this._themeHDRColor()
      if (Math.random() < 0.85) {
        const a = Math.random() * Math.PI * 2
        const rad = 75 + Math.random() * 65
        this._spawnSpark({
          x: this.chargeWorld.x + Math.cos(a) * rad,
          y: this.chargeWorld.y + Math.sin(a) * rad,
          z: 20 + Math.random() * 60,
          vx: -Math.cos(a) * 180,
          vy: -Math.sin(a) * 180,
          vz: 120,
          size: 2.6,
          life: 0.35,
          grav: 0,
          drag: 1.2,
          r: col[0], g: col[1], b: col[2],
          a: 0.9
        })
      }
    } else if (!this.settled) {
      // 2. 子弹时间慢镜判定：时停棱镜主题、✦逆命重投 或 大成功/大失败 临近落定前的最后 0.28s！
      const remainingSim = this.maxSimDuration - this.simTime
      const wantBullet =
        (this.theme.themeIndex === 1 || this.mode === 'fate' || this.tier === 'critical' || this.tier === 'fumble') &&
        remainingSim > 0.03 &&
        remainingSim < 0.30 &&
        this.dice.length <= 6
      const wantTheaterEase =
        !wantBullet &&
        this.theaterMode &&
        remainingSim > 0.02 &&
        remainingSim < 0.24 &&
        this.dice.length <= 6

      const targetBT = wantBullet ? 1.0 : (wantTheaterEase ? 0.56 : 0.0)
      this.bulletTimeAmount += (targetBT - this.bulletTimeAmount) * Math.min(1, rawDt * 12)
      if (wantBullet && !this.bulletSoundPlayed) {
        this.bulletSoundPlayed = true
        if (this.audio && (this.theme.themeIndex === 1 || this.mode === 'fate')) {
          this.audio.playBulletTimeDrop()
        }
      }

      const timeScale = 1.0 - this.bulletTimeAmount * 0.76 // 最低放慢至 0.24x 超清折射慢镜！
      const simDelta = rawDt * timeScale
      this.rollTime += rawDt
      this.simTime += simDelta * (this.simPace || 1)

      const fStep = this.simTime / SIM_DT
      const s0 = Math.min(MAX_STEPS - 2, Math.max(0, fStep | 0))
      const alpha = Math.max(0, Math.min(1, fStep - s0))
      const s1 = s0 + 1

      let allDone = this.simTime >= this.maxSimDuration
      for (let i = 0; i < this.dice.length; i++) {
        const d = this.dice[i]
        const p0 = s0 * 3, p1 = s1 * 3
        d.x = d.trajPos[p0] + (d.trajPos[p1] - d.trajPos[p0]) * alpha
        d.y = d.trajPos[p0 + 1] + (d.trajPos[p1 + 1] - d.trajPos[p0 + 1]) * alpha
        d.z = d.trajPos[p0 + 2] + (d.trajPos[p1 + 2] - d.trajPos[p0 + 2]) * alpha
        d.speed = d.trajSpeed[s0] + (d.trajSpeed[s1] - d.trajSpeed[s0]) * alpha

        qSlerp(d.trajQuat, s0 * 4, d.trajQuat, s1 * 4, alpha, this._qTmp)
        d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

        d.settled = s0 >= d.settleStep
        if (!d.settled) allDone = false

        const th = (d.trailHead + 1) % 28
        d.trailHead = th
        d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
        if (d.trailCount < 28) d.trailCount++
      }

      while (this.bouncePlayCursor < this.bounceQueue.length && this.bounceQueue[this.bouncePlayCursor].simTime <= this.simTime) {
        this._onBounceEvent(this.bounceQueue[this.bouncePlayCursor++])
      }

      if (allDone) {
        this.settled = true
        this.settleTime = 0
        this.bulletTimeAmount = 0
        this.climax = 1.0
        for (let i = 0; i < this.dice.length; i++) {
          const d = this.dice[i]
          const ep = (MAX_STEPS - 1) * 3
          const eq = (MAX_STEPS - 1) * 4
          d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
          d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
          d.speed = 0
          d.settled = true
        }
        if (this.mode !== 'hidden') {
          this._triggerClimaxFX()
          if (this.audio) this.audio.playSettle(this.theme.soundPreset, this.tier)
        }
        if (this.onRollSettled) this.onRollSettled(this)
      }
    } else {
      this.settleTime += rawDt
      this.climax = Math.max(0, 1.0 - this.settleTime * 0.48)
      this.bulletTimeAmount *= Math.max(0, 1 - rawDt * 10)
      for (let i = 0; i < this.dice.length; i++) {
        if (this.dice[i].trailCount > 0) this.dice[i].trailCount = Math.max(0, this.dice[i].trailCount - 2)
      }
    }

    // 3. 更新贴花、剑气、光学冲击波与粒子池
    for (const imp of this.impacts) {
      if (imp.strength <= 0) continue
      imp.age += rawDt
      const maxL = this.theme.themeIndex === 4 ? 2.4 : 1.15
      if (imp.age > maxL) imp.strength = 0
    }

    for (const sl of this.slashes) {
      if (!sl.active) continue
      sl.age += rawDt
      if (sl.age >= sl.life) sl.active = false
    }

    if (this.shockAge < 1.2) {
      this.shockAge += rawDt
      const p = this.shockAge / 0.85
      if (p >= 1) {
        this.shockwave[3] = 0
        this.shockAge = 99
      } else {
        this.shockwave[2] = 0.02 + p * 0.88
        this.shockwave[3] *= Math.max(0, 1 - rawDt * 2.6)
      }
    }

    this._stepParticles(rawDt * (1 - this.bulletTimeAmount * 0.65))
    this._updateSpringCamera(rawDt)
  }

  _stepParticles(dt) {
    const p = this.particles
    if (p.aliveCount === 0) return
    let alive = 0
    for (let i = 0; i < p.capacity; i++) {
      if (!p.active[i]) continue
      const age = p.age[i] + dt
      if (age >= p.life[i]) {
        p.active[i] = 0
        continue
      }
      alive++
      p.age[i] = age
      if (p.mode[i] < 0.5) {
        const drag = Math.max(0, 1 - p.drag[i] * dt)
        p.vx[i] *= drag
        p.vy[i] *= drag
        p.vz[i] = p.vz[i] * drag - p.grav[i] * dt
        p.x[i] += p.vx[i] * dt
        p.y[i] += p.vy[i] * dt
        p.z[i] += p.vz[i] * dt
        if (p.z[i] < 2) {
          p.z[i] = 2
          p.vz[i] = Math.abs(p.vz[i]) * 0.45
          p.vx[i] *= 0.78
          p.vy[i] *= 0.78
        }
      }
    }
    p.aliveCount = alive
  }

  _updateSpringCamera(dt) {
    let cx = 0, cy = 8, cz = 14
    if (this.dice.length > 0) {
      let sx = 0, sy = 0, sz = 0
      for (const d of this.dice) { sx += d.x; sy += d.y; sz += d.z }
      cx = (sx / this.dice.length) * 0.42
      cy = (sy / this.dice.length) * 0.42
      cz = Math.min(48, (sz / this.dice.length) * 0.35)
    }

    let zoom = 1.0
    if (this.cinematicCamEnabled) {
      if (this.charging) {
        zoom = 1.08 + Math.min(1, this.chargeTime) * 0.08 // 蓄力拉远蓄势
      } else if (this.bulletTimeAmount > 0.05) {
        zoom = 1.0 - this.bulletTimeAmount * 0.24 // 子弹时间戏剧性推镜特写！
      } else if (this.settled && this.settleTime < 1.1 && (this.tier === 'critical' || this.tier === 'fumble') && this.dice.length <= 4) {
        zoom = 0.84 + (this.settleTime / 1.1) * 0.16
      }
    }

    // 震屏衰减
    this.shakeAmp *= Math.max(0, 1 - dt * 14)
    const shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp
    const shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp
    const shakeZ = (Math.random() - 0.5) * 1.4 * this.shakeAmp

    const targetEyeX = cx * 0.35 + shakeX
    const targetEyeY = this.baseEye[1] * zoom + cy * 0.25 + shakeY
    const targetEyeZ = this.baseEye[2] * zoom + shakeZ

    const smooth = Math.min(1, dt * 8.5)
    this.camEye[0] += (targetEyeX - this.camEye[0]) * smooth
    this.camEye[1] += (targetEyeY - this.camEye[1]) * smooth
    this.camEye[2] += (targetEyeZ - this.camEye[2]) * smooth

    this.camTarget[0] += (cx - this.camTarget[0]) * smooth
    this.camTarget[1] += (cy - this.camTarget[1]) * smooth
    this.camTarget[2] += (cz - this.camTarget[2]) * smooth

    const baseChroma = this.theme.themeIndex === 3 ? 0.22 : 0.05
    this.chroma += (baseChroma - this.chroma) * Math.min(1, dt * 6.0)
  }

  _renderAll() {
    const hiddenMask = this.mode === 'hidden' && !this.revealed
    const tierCode = hiddenMask || !this.settled ? 0 : (TIER_CODE_MAP[this.tier] || 2)

    this.renderer.render({
      time: this.clock,
      themeId: this.theme.themeIndex,
      tierCode,
      climax: this.climax,
      charge: this.charging ? Math.min(1, this.chargeTime / 0.8) : 0,
      camEye: this.camEye,
      camTarget: this.camTarget,
      camFovRad: this.camFov,
      dice: this.dice,
      impacts: this.impacts,
      slashes: this.slashes,
      particles: this.particles,
      shockwave: this.shockwave,
      chroma: this.chroma,
      bulletTime: this.bulletTimeAmount,
      usePipsForD6: this.usePipsForD6,
      hiddenMask,
      bloomEnabled: this.quality !== 'lite'
    })

    if (this.hudCtx) {
      this._renderCrispVectorOverlay(hiddenMask)
    }
  }

  _renderCrispVectorOverlay(hiddenMask) {
    const ctx = this.hudCtx
    const W = this.cssW
    const H = this.cssH
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // 1. 按住蓄力环与甩投引导提示
    if (this.charging) {
      const uv = this.renderer.projectToUV(this.chargeWorld.x, this.chargeWorld.y, 85, this._uvTmp)
      if (uv.visible) {
        const sx = uv.u * W
        const sy = (1 - uv.v) * H
        const c01 = Math.min(1, this.chargeTime / 0.85)
        const r = 38 + c01 * 22
        ctx.strokeStyle = this.theme.accent
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
        ctx.stroke()

        ctx.font = '700 11.5px system-ui, sans-serif'
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(
          this.buttonCharging
            ? `⚡ 聚能蓄力 ${Math.round(c01 * 100)}% · 松开按钮爆发投掷`
            : '松开或划动甩投！',
          sx,
          sy + r + 18
        )
      }
    }

    // 2. 全皮肤专属：落定拍案主题印章 / 铭牌（六套主题各有专属形态与醒目汉字）
    if (this.settled && !hiddenMask && this.settleTime < 2.5 && !this.compactMode) {
      drawThemeSealOverlay(ctx, {
        themeIndex: this.theme.themeIndex,
        tier: this.tier,
        settleTime: this.settleTime,
        sx: W - Math.min(115, W * 0.14),
        sy: Math.min(125, H * 0.25),
        scaleMul: 1
      })
    }

    // 3. 赛博超频专属：实时投影追踪骰子的全息锁定战术准星！
    if (this.theme.themeIndex === 3 && this.settled && !hiddenMask && this.settleTime < 2.4 && this.dice.length <= 6) {
      const fade = this.settleTime > 1.8 ? Math.max(0, 1 - (this.settleTime - 1.8) / 0.6) : Math.min(1, this.settleTime * 5)
      ctx.save()
      ctx.globalAlpha = fade
      ctx.strokeStyle = this.tier === 'fumble' ? '#ff2a85' : '#00f5d4'
      ctx.fillStyle = this.tier === 'fumble' ? '#ff2a85' : '#00f5d4'
      ctx.lineWidth = 1.6
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace'

      for (let i = 0; i < this.dice.length; i++) {
        const d = this.dice[i]
        const uv = this.renderer.projectToUV(d.x, d.y, d.z, this._uvTmp)
        if (!uv.visible) continue
        const px = uv.u * W
        const py = (1 - uv.v) * H
        const box = this.compactMode ? 22 : 34
        const len = 9

        ctx.beginPath()
        // 四角折线锁定框
        ctx.moveTo(px - box, py - box + len); ctx.lineTo(px - box, py - box); ctx.lineTo(px - box + len, py - box)
        ctx.moveTo(px + box - len, py - box); ctx.lineTo(px + box, py - box); ctx.lineTo(px + box, py - box + len)
        ctx.moveTo(px - box, py + box - len); ctx.lineTo(px - box, py + box); ctx.lineTo(px - box + len, py + box)
        ctx.moveTo(px + box - len, py + box); ctx.lineTo(px + box, py + box); ctx.lineTo(px + box, py + box - len)
        ctx.stroke()

        if (!this.compactMode) {
          ctx.fillText(`VAL:${d.faceValue} // ${this.tier.toUpperCase()}`, px - box, py - box - 6)
        }
      }
      ctx.restore()
    }

    // 4. 暗骰未揭晓：悬浮呼吸全视秘眼环
    if (hiddenMask && this.settled) {
      ctx.save()
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 4.2)
      ctx.strokeStyle = `rgba(122, 252, 214, ${0.45 + pulse * 0.4})`
      ctx.lineWidth = 1.8
      for (let i = 0; i < Math.min(6, this.dice.length); i++) {
        const d = this.dice[i]
        const uv = this.renderer.projectToUV(d.x, d.y, d.z + d.radius * 1.1, this._uvTmp)
        if (!uv.visible) continue
        const px = uv.u * W
        const py = (1 - uv.v) * H
        ctx.beginPath()
        ctx.arc(px, py, 20 + pulse * 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    ctx.restore()
  }
}

  let webglProbeResult = null
  function canUseWebGL2() {
    if (webglProbeResult !== null) return webglProbeResult
    try {
      if (typeof window === "undefined" || typeof document === "undefined") {
        webglProbeResult = false
        return false
      }
      if (typeof WebGL2RenderingContext === "undefined") {
        webglProbeResult = false
        return false
      }
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        webglProbeResult = false
        return false
      }
      const cv = document.createElement("canvas")
      const gl = cv.getContext("webgl2")
      webglProbeResult = Boolean(gl)
      return webglProbeResult
    } catch {
      webglProbeResult = false
      return false
    }
  }

  let sharedAudio = null
  function getAudio() {
    if (!sharedAudio) sharedAudio = new ProceduralDiceAudio()
    return sharedAudio
  }

  // 全局维护 panel / banner / theater 三个共享离屏 WebGL2 渲染器，互不抢占 FBO 尺寸，绘制后极速 Blit 到 2D 画布！
  const sharedRenderers = { panel: null, banner: null, theater: null }
  function getSharedRenderer(kind, w, h) {
    const key = kind === "theater" ? "theater" : (kind === "banner" ? "banner" : "panel")
    if (!sharedRenderers[key]) {
      const offCanvas = document.createElement("canvas")
      sharedRenderers[key] = new WebGLDiceRenderer(offCanvas)
    }
    const r = sharedRenderers[key]
    r.resize(w, h)
    return r
  }

  // 复用锁定骰（重新生成 / 编辑正文后重放同一楼层）不是一次新的重投：
  // 主题必须归位默认，否则 🔥孤注 的焚天熔炉会跟着锁定结果，复现在该楼层之后的每一次重放上。
  function resolveThemeMode(roll, hidden) {
    if (hidden) return "hidden"
    if (roll && roll.reusedOnRegenerate) return "normal"
    const rerollMode = roll && roll.rerollMeta && roll.rerollMeta.mode
    return rerollMode === "fate" || rerollMode === "push" ? rerollMode : "normal"
  }

  function resolveTheme(animationPref, mode, hidden) {
    const pref = String(animationPref || "bounce")
    if (pref === "none" || pref === "compact") return null
    if (pref === "prism") return NEXTGEN_THEMES[1]
    if (pref === "inferno") return NEXTGEN_THEMES[2]
    if (pref === "cyber") return NEXTGEN_THEMES[3]
    if (pref === "jianxin") return NEXTGEN_THEMES[4]
    if (pref === "singularity") return NEXTGEN_THEMES[5]
    // 默认 bounce = 智能 3D 星穹秘法（随 ✦逆命 / 🔥孤注 / 👁️暗骰 自动切换专属高潮视效）
    if (mode === "fate") return NEXTGEN_THEMES[1]
    if (mode === "push") return NEXTGEN_THEMES[2]
    if (hidden) return NEXTGEN_THEMES[5]
    return NEXTGEN_THEMES[0]
  }

  function meshKeyForSides(sides) {
    const s = Number(sides) || 6
    if (s <= 4) return "d4"
    if (s <= 6) return "d6"
    if (s <= 8) return "d8"
    if (s === 10) return "d10"
    if (s <= 12) return "d12"
    return "d20"
  }

  function rollToStageSpec(roll, isFree) {
    if (!roll) return null
    if (isFree) {
      const sides = Number(roll.sides) || 6
      const faces = Array.isArray(roll.dice) && roll.dice.length ? roll.dice : [Number(roll.total) || 1]
      if (sides === 100 && faces.length === 1) {
        const pct = Math.max(1, Math.min(100, Math.round(Number(faces[0]) || 50)))
        const tens = pct === 100 ? 0 : Math.floor(pct / 10) * 10
        const ones = pct === 100 ? 0 : pct % 10
        return {
          diceSpecs: [
            { meshKey: "d100_tens", sides: 100, targetValue: tens },
            { meshKey: "d100_ones", sides: 10, targetValue: ones }
          ],
          tier: pct <= 5 ? "critical" : pct >= 96 ? "fumble" : "success",
          mode: "normal",
          total: Number(roll.total) || pct,
          checkName: roll.expression || "自由骰"
        }
      }
      const mk = meshKeyForSides(sides)
      const maxFace = GL_MESHES[mk] ? GL_MESHES[mk].faceCount : 20
      const diceSpecs = faces.slice(0, 16).map(v => ({
        meshKey: mk,
        sides,
        targetValue: Math.max(1, Math.min(maxFace, Math.round(Number(v) || 1)))
      }))
      return {
        diceSpecs,
        tier: "success",
        mode: "normal",
        total: Number(roll.total) || 0,
        checkName: roll.expression || "自由骰"
      }
    }

    const rule = String(roll.rule || "2d6")
    const rawDice = Array.isArray(roll.dice) && roll.dice.length ? roll.dice : [Number(roll.rawTotal ?? roll.total) || 1]
    const mode = resolveThemeMode(roll, roll.hidden)
    const tier = fdTierOf(roll.tier)

    if (rule === "d100") {
      const pct = Math.max(1, Math.min(100, Math.round(Number(rawDice[0]) || Number(roll.total) || 50)))
      const tens = pct === 100 ? 0 : Math.floor(pct / 10) * 10
      const ones = pct === 100 ? 0 : pct % 10
      return {
        diceSpecs: [
          { meshKey: "d100_tens", sides: 100, targetValue: tens },
          { meshKey: "d100_ones", sides: 10, targetValue: ones }
        ],
        tier,
        mode,
        total: Number(roll.total) || pct,
        checkName: roll.check || "检定"
      }
    }

    const sides = rule === "d20" ? 20 : rule === "d10" ? 10 : (Number(roll.sides) || 6)
    const mk = meshKeyForSides(sides)
    const maxFace = GL_MESHES[mk] ? GL_MESHES[mk].faceCount : sides
    const diceSpecs = rawDice.slice(0, 12).map(v => ({
      meshKey: mk,
      sides,
      targetValue: Math.max(1, Math.min(maxFace, Math.round(Number(v) || 1)))
    }))

    return {
      diceSpecs,
      tier,
      mode,
      total: Number(roll.total) || 0,
      checkName: roll.check || "检定"
    }
  }

  /**
   * 轻量代理舞台控制器：复用全局共享离屏 WebGL2 渲染器，将每帧画面 Blit 到当前卡片的 2D Canvas！
   */
  class SharedBlitDiceStage extends CinematicDiceStage {
    constructor(displayCanvas, options = {}) {
      const bucket = options.theater ? "theater" : (options.banner ? "banner" : "panel")
      const initW = options.theater ? 1080 : (options.banner ? 360 : 680)
      const initH = options.theater ? 340 : (options.banner ? 148 : 272)
      const sharedR = getSharedRenderer(bucket, initW, initH)
      // 传入一个虚拟 canvas 占位避免父类重复 new WebGLDiceRenderer
      super(sharedR.canvas, null, { ...options, interactive: false, _preRenderer: sharedR })
      this.displayCanvas = displayCanvas
      this.displayCtx = displayCanvas.getContext("2d")
      this.bucket = bucket
      this.pendingChargePower = 0
      this.resize()
    }

    resize() {
      if (!this.displayCanvas) return
      /* 布局尺寸优先（clientWidth/Height）：入场 scaleX 变换期间 getBoundingClientRect 会缩水，
       * 用它算分辨率会把 3D 画面糊掉，所以变换动画期间也必须按布局宽高开画布。 */
      const layoutW = Number(this.displayCanvas.clientWidth) || 0
      const layoutH = Number(this.displayCanvas.clientHeight) || 0
      const rect = layoutW && layoutH
        ? null
        : (typeof this.displayCanvas.getBoundingClientRect === "function"
          ? this.displayCanvas.getBoundingClientRect()
          : null)
      const w = Math.max(130, Math.round(layoutW || (rect && rect.width) || (this.bucket === "banner" ? 210 : 420)))
      const h = Math.max(64, Math.round(layoutH || (rect && rect.height) || (this.bucket === "banner" ? 76 : 152)))
      const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2.0)

      this.cssW = w
      this.cssH = h
      this.dpr = dpr
      const pw = Math.round(w * dpr)
      const ph = Math.round(h * dpr)
      if (this.displayCanvas.width !== pw || this.displayCanvas.height !== ph) {
        this.displayCanvas.width = pw
        this.displayCanvas.height = ph
      }

      const aspect = w / Math.max(1, h)
      const distScale = aspect > 2.15 ? 0.64 : aspect < 0.9 ? 1.12 : 0.84
      this.baseEye[0] = 0
      this.baseEye[1] = -325 * distScale
      this.baseEye[2] = 385 * distScale
      this.camEye[0] = this.baseEye[0]
      this.camEye[1] = this.baseEye[1]
      this.camEye[2] = this.baseEye[2]
    }

    _renderAll() {
      if (!this.displayCanvas || !this.displayCtx) return
      const pw = this.displayCanvas.width || 360
      const ph = this.displayCanvas.height || 152
      const sharedR = getSharedRenderer(this.bucket, pw, ph)
      this.renderer = sharedR

      const hiddenMask = this.mode === "hidden" && !this.revealed
      const tierCode = hiddenMask || !this.settled ? 0 : (TIER_CODE_MAP[this.tier] || 2)

      sharedR.render({
        time: this.clock,
        themeId: this.theme.themeIndex,
        tierCode,
        climax: this.climax,
        charge: this.charging ? Math.min(1, this.chargeTime / 0.8) : 0,
        camEye: this.camEye,
        camTarget: this.camTarget,
        camFovRad: this.camFov,
        dice: this.dice,
        impacts: this.impacts,
        slashes: this.slashes,
        particles: this.particles,
        shockwave: this.shockwave,
        chroma: this.chroma,
        bulletTime: this.bulletTimeAmount,
        usePipsForD6: this.usePipsForD6,
        hiddenMask,
        bloomEnabled: this.quality !== "lite"
      })

      this.displayCtx.save()
      this.displayCtx.setTransform(1, 0, 0, 1, 0, 0)
      this.displayCtx.drawImage(sharedR.canvas, 0, 0, pw, ph, 0, 0, pw, ph)
      this.displayCtx.restore()

      // 叠加锐利矢量前景（蓄力百分比圆环 / 水墨朱砂方印 / 赛博锁定准星）
      this.hudCtx = this.displayCtx
      this._renderCrispVectorOverlayNoClear(hiddenMask)
    }

    _renderCrispVectorOverlayNoClear(hiddenMask) {
      const ctx = this.displayCtx
      const W = this.cssW
      const H = this.cssH
      ctx.save()
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

      if (this.charging) {
        const uv = this.renderer.projectToUV(this.chargeWorld.x, this.chargeWorld.y, 85, this._uvTmp)
        if (uv.visible) {
          const sx = uv.u * W
          const sy = (1 - uv.v) * H
          const c01 = Math.min(1, this.chargeTime / 0.90)
          const r = Math.min(H * 0.34, 32 + c01 * 18)
          ctx.strokeStyle = this.theme.accent
          ctx.lineWidth = 2.4
          ctx.beginPath()
          ctx.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
          ctx.stroke()

          ctx.font = "700 11.5px system-ui, sans-serif"
          ctx.fillStyle = "#fff8e7"
          ctx.shadowColor = "rgba(0,0,0,0.85)"
          ctx.shadowBlur = 6
          ctx.textAlign = "center"
          ctx.fillText("⚡ 聚能蓄力 " + Math.round(c01 * 100) + "% · 松开按钮爆发投掷", sx, Math.min(H - 8, sy + r + 16))
        }
      }

      const sealWindow = this.pinSettled ? Infinity : (this.theaterMode ? 3.5 : 2.5)
      if (this.settled && !hiddenMask && this.settleTime < sealWindow && !this.compactMode) {
        drawThemeSealOverlay(ctx, {
          themeIndex: this.theme.themeIndex,
          tier: this.tier,
          settleTime: this.settleTime,
          sx: this.theaterMode ? Math.min(W - 96, Math.round(W * 0.5 + Math.min(295, W * 0.27))) : W - 46,
          sy: this.theaterMode ? Math.round(H * 0.42) : Math.max(44, H * 0.36),
          scaleMul: this.theaterMode ? 1.04 : 0.78,
          fadeStart: this.pinSettled ? Infinity : (this.theaterMode ? 2.85 : 1.9)
        })
      }

      if (this.theme.themeIndex === 3 && this.settled && !hiddenMask && (this.pinSettled || this.settleTime < 2.4) && this.dice.length <= 4 && !this.compactMode) {
        const fade = (!this.pinSettled && this.settleTime > 1.8) ? Math.max(0, 1 - (this.settleTime - 1.8) / 0.6) : Math.min(1, this.settleTime * 5)
        ctx.save()
        ctx.globalAlpha = fade
        ctx.strokeStyle = this.tier === "fumble" ? "#ff2a85" : "#00f5d4"
        ctx.lineWidth = 1.5
        for (let i = 0; i < this.dice.length; i++) {
          const d = this.dice[i]
          const uv = this.renderer.projectToUV(d.x, d.y, d.z, this._uvTmp)
          if (!uv.visible) continue
          const px = uv.u * W, py = (1 - uv.v) * H
          const box = 26, len = 7
          ctx.beginPath()
          ctx.moveTo(px - box, py - box + len); ctx.lineTo(px - box, py - box); ctx.lineTo(px - box + len, py - box)
          ctx.moveTo(px + box - len, py - box); ctx.lineTo(px + box, py - box); ctx.lineTo(px + box, py - box + len)
          ctx.moveTo(px - box, py + box - len); ctx.lineTo(px - box, py + box); ctx.lineTo(px - box + len, py + box)
          ctx.moveTo(px + box - len, py + box); ctx.lineTo(px + box, py + box); ctx.lineTo(px + box, py + box - len)
          ctx.stroke()
        }
        ctx.restore()
      }

      ctx.restore()
    }
  }

  return {
    canUseWebGL2,
    getAudio,
    resolveTheme,
    resolveThemeMode,
    rollToStageSpec,
    SharedBlitDiceStage,
    NEXTGEN_THEMES
  }
})()


/* ---------- React & 原生 DOM 共用：3D 舞台组件 + 手动按钮长按蓄力控制器 ---------- */

const FD_HOLD_THRESHOLD_MS = 140
const FD_HOLD_FULL_MS = 960

function fdGetCachedAnimationPref() {
  return fdSafe(() => {
    const saved = fdReadJson(FD_STORAGE_KEYS.settings, null)
    return (saved && saved.animation) || "bounce"
  }, "bounce")
}

/**
 * 原生 DOM 按钮绑定「点按即投 + 长按蓄力旋涡 + 移出无损取消」
 * （供楼层顶栏原生面板与 Demo 复用）
 */
function fdAttachHoldChargeToDomBtn(btn, options) {
  if (!btn || typeof btn.addEventListener !== "function") return
  const { mode, getStage, onTrigger, baseLabel } = options || {}
  let holdTimer = 0
  let rafId = 0
  let downAt = 0
  let charging = false
  let pointerHandled = false

  const titleEl = btn.querySelector(".fd-reroll-btn-title")
  const origTitle = baseLabel || (titleEl ? titleEl.textContent : btn.textContent)

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  const setChargingCls = on => {
    if (btn.classList) {
      if (on && typeof btn.classList.add === "function") { btn.classList.add("is-charging"); return }
      if (!on && typeof btn.classList.remove === "function") { btn.classList.remove("is-charging"); return }
      if (typeof btn.classList.toggle === "function") { btn.classList.toggle("is-charging", Boolean(on)); return }
    }
    const parts = String(btn.className || "").split(/\s+/).filter(Boolean).filter(c => c !== "is-charging")
    if (on) parts.push("is-charging")
    btn.className = parts.join(" ")
  }
  const setChargeVar = val => {
    if (!btn.style) return
    if (val === null) {
      if (typeof btn.style.removeProperty === "function") btn.style.removeProperty("--fd-charge")
      else delete btn.style["--fd-charge"]
    } else if (typeof btn.style.setProperty === "function") {
      btn.style.setProperty("--fd-charge", val)
    } else {
      btn.style["--fd-charge"] = val
    }
  }

  const cleanup = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0 }
    if (rafId && typeof cancelAnimationFrame === "function") { cancelAnimationFrame(rafId); rafId = 0 }
    setChargingCls(false)
    setChargeVar(null)
    if (titleEl) titleEl.textContent = origTitle
  }

  const tick = () => {
    if (!charging) return
    const pct = Math.min(1, Math.max(0, (nowMs() - downAt - FD_HOLD_THRESHOLD_MS) / FD_HOLD_FULL_MS))
    setChargeVar(Math.round(pct * 100) + "%")
    if (titleEl) {
      titleEl.textContent = (mode === "push" ? "🔥 熔炉蓄力 " : "✦ 逆命蓄力 ") + Math.round(pct * 100) + "% · 松手爆发"
    }
    if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(tick)
  }

  btn.addEventListener("pointerdown", e => {
    if (btn.disabled || (e.button !== undefined && e.button !== 0)) return
    pointerHandled = false
    charging = false
    downAt = nowMs()
    holdTimer = setTimeout(() => {
      charging = true
      setChargingCls(true)
      const stg = typeof getStage === "function" ? getStage() : null
      if (stg && typeof stg.startButtonCharge === "function") stg.startButtonCharge(mode)
      tick()
    }, FD_HOLD_THRESHOLD_MS)
  })

  btn.addEventListener("pointerup", () => {
    if (!downAt) return
    const elapsed = nowMs() - downAt
    downAt = 0
    pointerHandled = true
    const wasCharging = charging
    charging = false
    cleanup()
    const power = wasCharging ? Math.min(1, Math.max(0.18, (elapsed - FD_HOLD_THRESHOLD_MS) / FD_HOLD_FULL_MS)) : 0
    const stg = typeof getStage === "function" ? getStage() : null
    if (stg) stg.pendingChargePower = power
    if (typeof onTrigger === "function") onTrigger(mode, power)
  })

  const cancel = () => {
    if (!downAt && !charging) return
    downAt = 0
    const wasCharging = charging
    charging = false
    cleanup()
    if (wasCharging) {
      const stg = typeof getStage === "function" ? getStage() : null
      if (stg) stg.cancelButtonCharge()
    }
  }

  btn.addEventListener("pointerleave", cancel)
  btn.addEventListener("pointercancel", cancel)
  btn.addEventListener("click", e => {
    if (pointerHandled) {
      pointerHandled = false
      if (e && typeof e.preventDefault === "function") e.preventDefault()
      return
    }
    if (!btn.disabled && typeof onTrigger === "function") onTrigger(mode, 0)
  })
}

/**
 * React 长按蓄力 Hook：兼容键盘点击/单元测试同步 onClick，同时在真实浏览器指针长按时激活 3D 旋涡蓄力！
 */
function useFdHoldCharge(options) {
  const { mode, disabled, stageRef, onTrigger } = options || {}
  const [chargePct, setChargePct] = useState(0)
  const [charging, setCharging] = useState(false)
  const stateRef = useRef({ timer: 0, raf: 0, downAt: 0, charging: false, pointerHandled: false })

  useEffect(() => {
    return () => {
      const s = stateRef.current
      if (s.timer) clearTimeout(s.timer)
      if (s.raf) cancelAnimationFrame(s.raf)
    }
  }, [])

  const stopVisuals = () => {
    const s = stateRef.current
    if (s.timer) { clearTimeout(s.timer); s.timer = 0 }
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0 }
    s.charging = false
    setCharging(false)
    setChargePct(0)
  }

  const onPointerDown = e => {
    if (disabled || (e && e.button !== undefined && e.button !== 0)) return
    const s = stateRef.current
    s.pointerHandled = false
    s.charging = false
    s.downAt = (typeof performance !== "undefined" ? performance.now() : Date.now())
    s.timer = setTimeout(() => {
      s.charging = true
      setCharging(true)
      const stg = stageRef && stageRef.current
      if (stg && typeof stg.startButtonCharge === "function") stg.startButtonCharge(mode)
      const loop = () => {
        if (!s.charging) return
        const now = typeof performance !== "undefined" ? performance.now() : Date.now()
        const p = Math.min(100, Math.max(5, Math.round(((now - s.downAt - FD_HOLD_THRESHOLD_MS) / FD_HOLD_FULL_MS) * 100)))
        setChargePct(p)
        if (typeof requestAnimationFrame === "function") s.raf = requestAnimationFrame(loop)
      }
      loop()
    }, FD_HOLD_THRESHOLD_MS)
  }

  const onPointerUp = () => {
    const s = stateRef.current
    if (!s.downAt) return
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    const elapsed = now - s.downAt
    s.downAt = 0
    s.pointerHandled = true
    const wasCharging = s.charging
    stopVisuals()
    const power = wasCharging ? Math.min(1, Math.max(0.18, (elapsed - FD_HOLD_THRESHOLD_MS) / FD_HOLD_FULL_MS)) : 0
    const stg = stageRef && stageRef.current
    if (stg) stg.pendingChargePower = power
    if (typeof onTrigger === "function") onTrigger(mode, power)
  }

  const onPointerCancelOrLeave = () => {
    const s = stateRef.current
    if (!s.downAt && !s.charging) return
    s.downAt = 0
    const wasCharging = s.charging
    stopVisuals()
    if (wasCharging) {
      const stg = stageRef && stageRef.current
      if (stg && typeof stg.cancelButtonCharge === "function") stg.cancelButtonCharge()
    }
  }

  const onClick = () => {
    const s = stateRef.current
    if (s.pointerHandled) {
      s.pointerHandled = false
      return
    }
    if (!disabled && typeof onTrigger === "function") onTrigger(mode, 0)
  }

  return {
    charging,
    chargePct,
    bindProps: {
      onPointerDown,
      onPointerUp,
      onPointerLeave: onPointerCancelOrLeave,
      onPointerCancel: onPointerCancelOrLeave,
      onClick,
      style: charging ? { "--fd-charge": chargePct + "%" } : undefined
    }
  }
}

/**
 * React 3D 命运真骰舞台挂件（不支持 WebGL2 或处于 Node 测试环境时返回 null 零副作用降级）
 */
function Fd3DDiceStage(props) {
  const { roll, isFree, revealed, animation, banner, compact, animateOnMount, stageRef, onClick } = props || {}
  const canvasRef = useRef(null)
  const internalStageRef = useRef(null)
  const lastRollKeyRef = useRef("")

  const animPref = animation || fdGetCachedAnimationPref()
  const hidden = Boolean(roll && roll.hidden && !revealed)
  const mode = FD3D.resolveThemeMode(roll, hidden)
  const theme = FD3D.resolveTheme(animPref, mode, hidden)
  const supported = Boolean(theme && roll && FD3D.canUseWebGL2())

  const rollKey = roll
    ? String(roll.rolledAt || "") + ":" + String(roll.total || "") + ":" + String((roll.dice || []).join(",")) + ":" + String(hidden)
    : ""

  useEffect(() => {
    if (!supported || !canvasRef.current) return undefined
    const stg = new FD3D.SharedBlitDiceStage(canvasRef.current, {
      audio: banner ? null : FD3D.getAudio(),
      banner: Boolean(banner),
      compact: Boolean(compact || banner)
    })
    internalStageRef.current = stg
    if (stageRef) stageRef.current = stg

    let ro = null
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => {
        stg.resize()
        stg.renderSingleFrame()
      })
      ro.observe(canvasRef.current)
    }

    return () => {
      if (ro) ro.disconnect()
      stg.stop()
      internalStageRef.current = null
      if (stageRef && stageRef.current === stg) stageRef.current = null
    }
  }, [supported, Boolean(banner)])

  useEffect(() => {
    const stg = internalStageRef.current
    if (!supported || !stg || !roll || !theme) return
    const spec = FD3D.rollToStageSpec(roll, Boolean(isFree))
    if (!spec) return
    if (revealed && spec.mode === "hidden") {
      spec.mode = "normal"
    }

    const isFirst = lastRollKeyRef.current === ""
    const changed = lastRollKeyRef.current !== rollKey
    lastRollKeyRef.current = rollKey
    const isStaticPlate = isFirst && !animateOnMount

    // 智能切换（bounce）下，✦逆命 / 🔥孤注 的专属皮肤只属于投掷那一刻：
    // 重开楼层、复用锁定骰这类静态摆盘一律回到默认星穹，避免熔炉/棱镜皮肤长期滞留在卡片上
    const pref = String(animPref || "bounce")
    const staticTheme = pref === "bounce" ? FD3D.resolveTheme(pref, hidden ? "hidden" : "normal", hidden) : null
    stg.setTheme((isStaticPlate && staticTheme) || theme)
    if (isStaticPlate) {
      stg.setStaticRoll(spec)
    } else if (changed) {
      const power = stg.pendingChargePower || 0
      stg.pendingChargePower = 0
      if (power > 0.1) stg.releaseButtonCharge(spec, power)
      else stg.throwDice(spec)
    }
  }, [supported, rollKey, revealed, animPref, theme ? theme.id : ""])

  if (!supported) return null

  const cls = "fd-3d-stage" + (banner ? " is-banner" : (compact ? " is-compact" : ""))
  return h("div", { className: cls, onClick },
    h("canvas", {
      ref: canvasRef,
      className: "fd-3d-canvas",
      "aria-hidden": "true"
    }))
}
