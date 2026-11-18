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

const ATLAS_GRID = 16       // 16 x 16 = 256 tiles
const TILE_PX = 128         // 16 * 128 = 2048x2048 (Power-of-Two)
const STYLE_TILE_STRIDE = 42 // 6 * 42 = 252 <= 256

const GLYPH_TILE_MAP = Object.freeze({
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, '11': 11, '12': 12, '13': 13, '14': 14, '15': 15,
  '16': 16, '17': 17, '18': 18, '19': 19, '20': 20,
  '00': 21, '20_d': 22, '30': 23, '40': 24, '50': 25, '60': 26, '70': 27, '80': 28, '90': 29, '10_d': 30,
  'pip_1': 31, 'pip_2': 32, 'pip_3': 33, 'pip_4': 34, 'pip_5': 35, 'pip_6': 36,
  '+': 37, '−': 38, '◯': 39,
  '?': 40
})

// 手工精绘 5x7 纯像素点阵字模（专供 16-Bit 勇者地牢像素风，100% 锋利整数像素）
const PIXEL_FONT_5X7 = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '10001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '−': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '◯': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '?': ['01110', '10001', '00010', '00100', '00100', '00000', '00100']
}

function drawPixelBitmapString(ctx, text, isMoat, underline, crown) {
  const chars = String(text).split('')
  const px = chars.length >= 2 ? 7 : 9
  const charW = 5
  const charH = 7
  const gap = 1
  const totalCols = chars.length * charW + (chars.length - 1) * gap
  const startX = -Math.floor((totalCols * px) / 2)
  const startY = -Math.floor((charH * px) / 2) + (crown ? px : (underline ? -Math.floor(px * 0.5) : 0))
  const pad = isMoat ? px : 0

  const putBlock = (gx, gy, w = 1, h = 1) => {
    ctx.fillRect(
      startX + gx * px - pad,
      startY + gy * px - pad,
      w * px + pad * 2,
      h * px + pad * 2
    )
  }

  chars.forEach((ch, ci) => {
    const bmp = PIXEL_FONT_5X7[ch] || PIXEL_FONT_5X7['0']
    const ox = ci * (charW + gap)
    for (let r = 0; r < charH; r++) {
      const row = bmp[r]
      for (let c = 0; c < charW; c++) {
        if (row[c] === '1') putBlock(ox + c, r, 1, 1)
      }
    }
  })

  if (underline) {
    const uw = Math.min(totalCols, 5)
    const ux = Math.floor((totalCols - uw) / 2)
    putBlock(ux, charH + 1, uw, 1)
  }

  if (crown) {
    const cx = Math.floor(totalCols / 2) - 2
    putBlock(cx, -3, 1, 2)
    putBlock(cx + 2, -3, 1, 2)
    putBlock(cx + 4, -3, 1, 2)
    putBlock(cx, -2, 5, 1)
  }
}

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

  mctx.clearRect(0, 0, size, size)
  octx.clearRect(0, 0, size, size)

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

  // 六套独立艺术雕刻字体规格（幻想系列共享 styleIdx=4 锐利几何无衬线字形）
  const STYLE_TYPO = [
    { font: sz => `700 ${sz}px "Georgia", "Times New Roman", "Noto Serif", serif`, s1: 78, s2: 62, stroke: 1.5, dotMark: true },
    { pixel: true },
    { font: sz => `italic 700 ${sz}px "Palatino Linotype", "Book Antiqua", "Georgia", serif`, s1: 76, s2: 60, stroke: 1.0, sunCrown: true },
    { font: sz => `800 ${sz}px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", "Georgia", serif`, s1: 78, s2: 62, stroke: 2.0, bigAcePip: true },
    { font: sz => `800 ${sz}px "Inter", "Helvetica Neue", "Segoe UI", system-ui, sans-serif`, s1: 76, s2: 62, stroke: 2.0, geoCrown: true },
    { font: sz => `600 ${sz}px "Garamond", "Baskerville", "Times New Roman", serif`, s1: 80, s2: 64, stroke: 0.8, starCrown: true }
  ]

  function drawAllStylesPass(ctx, mode) {
    ctx.save()
    const isMoat = mode === 'moat'
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'

    for (let styleIdx = 0; styleIdx < 6; styleIdx++) {
      const spec = STYLE_TYPO[styleIdx]
      ctx.imageSmoothingEnabled = !spec.pixel

      for (const item of entries) {
        const globalId = styleIdx * STYLE_TILE_STRIDE + item.id
        const col = globalId % ATLAS_GRID
        const row = Math.floor(globalId / ATLAS_GRID)
        const cx = col * TILE_PX + TILE_PX * 0.5
        const cy = row * TILE_PX + TILE_PX * 0.5

        ctx.save()
        ctx.translate(cx, cy)
        ctx.lineCap = spec.pixel ? 'butt' : 'round'
        ctx.lineJoin = spec.pixel ? 'miter' : 'round'

        if (item.pip) {
          const pts = PIP_COORDS[item.pip]
          const span = TILE_PX * 0.30
          if (spec.pixel) {
            const pSize = item.pip === 1 ? 26 : 16
            const pad = isMoat ? 8 : 0
            for (const [px, py] of pts) {
              const x = Math.round(px * span - pSize * 0.5)
              const y = Math.round(py * span - pSize * 0.5)
              ctx.fillRect(x - pad, y - pad, pSize + pad * 2, pSize + pad * 2)
            }
          } else if (styleIdx === 2) {
            const pad = isMoat ? 5 : 0
            for (const [px, py] of pts) {
              const r = (item.pip === 1 ? TILE_PX * 0.14 : TILE_PX * 0.082) + pad
              ctx.beginPath()
              ctx.arc(px * span, py * span, r, 0, Math.PI * 2)
              if (isMoat) ctx.fill()
              else {
                ctx.lineWidth = 4.5
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(px * span, py * span, r * 0.38, 0, Math.PI * 2)
                ctx.fill()
              }
            }
          } else {
            const pad = isMoat ? 5.5 : 0
            for (const [px, py] of pts) {
              const aceBoost = (spec.bigAcePip && item.pip === 1) ? 0.195 : 0.135
              const r = (item.pip === 1 ? TILE_PX * aceBoost : TILE_PX * 0.084) + pad
              ctx.beginPath()
              ctx.arc(px * span, py * span, r, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        } else if (item.fateBlank) {
          if (spec.pixel) {
            drawPixelBitmapString(ctx, '◯', isMoat, false, false)
          } else {
            ctx.lineWidth = isMoat ? 15 : 6.5
            ctx.beginPath()
            ctx.arc(0, 0, TILE_PX * 0.16, 0, Math.PI * 2)
            ctx.stroke()
          }
        } else if (item.eyeSeal) {
          if (spec.pixel) {
            drawPixelBitmapString(ctx, '?', isMoat, false, false)
          } else {
            ctx.lineWidth = isMoat ? 13 : 5.5
            ctx.beginPath()
            ctx.moveTo(-36, 0)
            ctx.quadraticCurveTo(0, -26, 36, 0)
            ctx.quadraticCurveTo(0, 26, -36, 0)
            ctx.closePath()
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(0, 0, isMoat ? 13 : 8.5, 0, Math.PI * 2)
            ctx.fill()
          }
        } else if (spec.pixel) {
          drawPixelBitmapString(ctx, item.text, isMoat, item.underline, item.crown)
        } else {
          const txt = item.text
          const fontSize = txt.length >= 2 ? spec.s2 : spec.s1
          ctx.font = spec.font(fontSize)
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const yOff = item.crown ? 5 : (item.underline ? -3 : 1)

          if (isMoat) {
            ctx.lineWidth = 12.5
            ctx.strokeText(txt, 0, yOff)
          } else if (spec.stroke > 0) {
            ctx.lineWidth = spec.stroke
            ctx.strokeText(txt, 0, yOff)
          }
          ctx.fillText(txt, 0, yOff)

          if (item.underline) {
            const pad = isMoat ? 4.5 : 0
            if (spec.dotMark) {
              ctx.beginPath()
              ctx.arc(0, 33, 4.2 + pad, 0, Math.PI * 2)
              ctx.fill()
            } else {
              ctx.beginPath()
              ctx.roundRect(-16 - pad, 31 - pad, 32 + pad * 2, 5.5 + pad * 2, 3)
              ctx.fill()
            }
          }

          if (item.crown) {
            const pad = isMoat ? 4 : 0
            if (spec.geoCrown) {
              ctx.lineWidth = isMoat ? 9 : 3.5
              ctx.beginPath()
              ctx.arc(0, -34, 6.5, 0, Math.PI * 2)
              ctx.stroke()
            } else if (spec.starCrown || spec.sunCrown) {
              ctx.beginPath()
              const rOut = 10 + pad, rIn = 3.2 + pad * 0.4
              for (let k = 0; k < 8; k++) {
                const a = (k * Math.PI) / 4 - Math.PI / 2
                const r = (k & 1) === 0 ? rOut : rIn
                const px = Math.cos(a) * r, py = -33 + Math.sin(a) * r
                if (k === 0) ctx.moveTo(px, py)
                else ctx.lineTo(px, py)
              }
              ctx.closePath()
              ctx.fill()
            } else {
              ctx.lineWidth = isMoat ? 9.5 : 3.8
              ctx.beginPath()
              ctx.moveTo(-17, -30)
              ctx.lineTo(-8, -38)
              ctx.lineTo(0, -30)
              ctx.lineTo(8, -38)
              ctx.lineTo(17, -30)
              ctx.stroke()
            }
          }
        }
        ctx.restore()
      }
    }
    ctx.restore()
  }

  drawAllStylesPass(mctx, 'mask')
  drawAllStylesPass(octx, 'moat')

  const maskData = mctx.getImageData(0, 0, size, size).data
  const moatData = octx.getImageData(0, 0, size, size).data
  const rawBytes = new Uint8Array(size * size * 4)

  const stride = size * 4
  for (let y = 0; y < size; y++) {
    const yPrev = Math.max(0, y - 1)
    const yNext = Math.min(size - 1, y + 1)
    for (let x = 0; x < size; x++) {
      const idx = y * stride + x * 4
      const xPrev = Math.max(0, x - 1)
      const xNext = Math.min(size - 1, x + 1)

      const hL = maskData[y * stride + xPrev * 4 + 3]
      const hR = maskData[y * stride + xNext * 4 + 3]
      const hU = maskData[yPrev * stride + x * 4 + 3]
      const hD = maskData[yNext * stride + x * 4 + 3]

      const bevel = ((hR - hL) * 0.707 + (hD - hU) * 0.707) / 255

      rawBytes[idx] = maskData[idx + 3]     // R: 锐利字芯蒙版
      rawBytes[idx + 1] = moatData[idx + 3] // G: 护城衬底蒙版
      rawBytes[idx + 2] = Math.max(0, Math.min(255, Math.round((bevel * 0.5 + 0.5) * 255))) // B: 精确无损凹凸斜率
      rawBytes[idx + 3] = 255               // A: 固定 255 杜绝预乘 Alpha 损毁法线通道
    }
  }

  return { width: size, height: size, data: rawBytes }
}

const VERTEX_FLOATS = 19

function buildBeveledPolyhedron(kind, rawVerts, rawFaces, labels, faceValues, maxVal, uvScale = 1.18) {
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
    const isMaxFace = faceValues[f] === maxVal

    faces.push({
      index: f,
      normal: new Float32Array(n),
      center: new Float32Array(center),
      uAxis: new Float32Array(uAxis),
      vAxis: new Float32Array(vAxis),
      inRadius,
      label: labelStr,
      value: faceValues[f],
      isMaxFace,
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

function createTrapezohedron(kind, labels, values, maxVal) {
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
  return buildBeveledPolyhedron(kind, verts, faces, labels, values, maxVal, 1.16)
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
  return buildBeveledPolyhedron('d12', d12Verts, d12Faces, vals, vals, 12, 1.22)
}

const GL_MESHES = Object.freeze({
  d4: buildBeveledPolyhedron(
    'd4',
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    [1, 2, 3, 4], [1, 2, 3, 4], 4, 1.18
  ),
  d6: buildBeveledPolyhedron(
    'd6',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['6', '1', '2', '5', '3', '4'], [6, 1, 2, 5, 3, 4], 6, 1.24
  ),
  df: buildBeveledPolyhedron(
    'df',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['+', '−', '+', '−', '◯', '◯'], [1, -1, 1, -1, 0, 0], 1, 1.24
  ),
  d8: buildBeveledPolyhedron(
    'd8',
    [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]],
    [[0, 2, 3], [1, 4, 5], [0, 3, 4], [1, 5, 2], [0, 4, 5], [1, 2, 3], [0, 5, 2], [1, 3, 4]],
    [8, 1, 2, 7, 6, 3, 4, 5], [8, 1, 2, 7, 6, 3, 4, 5], 8, 1.18
  ),
  d10: createTrapezohedron('d10', ['10', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [10, 2, 4, 6, 8, 1, 9, 7, 5, 3], 10),
  d100_tens: createTrapezohedron('d100_tens', ['00', '20', '40', '60', '80', '10', '90', '70', '50', '30'], [0, 20, 40, 60, 80, 10, 90, 70, 50, 30], 0),
  d100_ones: createTrapezohedron('d100_ones', ['0', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [0, 2, 4, 6, 8, 1, 9, 7, 5, 3], 0),
  d12: createD12(),
  d20: (() => {
    const ico = buildIcosahedronRaw()
    const vals = assignOppositeNumbers(ico.faces, ico.verts, 20)
    return buildBeveledPolyhedron('d20', ico.verts, ico.faces, vals, vals, 20, 1.16)
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
uniform int u_theme;       // 0..5: 幻想皮肤, 6..11: 典藏皮肤 (6:atelier 7:pixel 8:etching 9:urushi 10:bauhaus 11:murano)
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

float bayer4x4(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  int idx = p.y * 4 + p.x;
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (m[idx] + 0.5) / 16.0;
}

float silverAstrolabeInlay(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float aa = max(0.0032, fwidth(r) * 1.25);

  float rings = smoothstep(aa, 0.0, abs(r - 0.94))
              + smoothstep(aa * 0.85, 0.0, abs(r - 0.88)) * 0.75
              + smoothstep(aa * 0.85, 0.0, abs(r - 0.58)) * 0.80
              + smoothstep(aa * 0.75, 0.0, abs(r - 0.26)) * 0.65;

  float rEcl = length(p - vec2(0.0, 0.16));
  float ecliptic = smoothstep(aa * 1.05, 0.0, abs(rEcl - 0.68)) * step(r, 0.94) * 0.85;

  float crossLine = (smoothstep(aa * 0.8, 0.0, abs(p.x)) + smoothstep(aa * 0.8, 0.0, abs(p.y)))
                  * step(0.26, r) * step(r, 0.94) * 0.48;
  float ticks = 0.0;
  if (r > 0.88 && r < 0.94) {
    ticks = smoothstep(0.11, 0.0, abs(sin(a * 36.0))) * 0.7;
  } else if (r > 0.55 && r < 0.61) {
    ticks = smoothstep(0.09, 0.0, abs(sin(a * 24.0))) * 0.5;
  }
  return clamp(rings + ecliptic + crossLine + ticks, 0.0, 1.2);
}

float astrolabePattern(vec2 p, float rotSpeed, float scale) {
  vec2 q = rot2(u_time * rotSpeed) * (p * scale);
  float r = length(q);
  float a = atan(q.y, q.x);
  float aa = max(0.0045, fwidth(r) * 1.35);
  float rings = smoothstep(aa, 0.0, abs(r - 1.0))
              + smoothstep(aa * 0.85, 0.0, abs(r - 0.91))
              + smoothstep(aa * 0.9, 0.0, abs(r - 0.66))
              + smoothstep(aa * 0.75, 0.0, abs(r - 0.38));
  float ticks = 0.0;
  if (r > 0.91 && r < 1.0) {
    ticks = smoothstep(0.14, 0.0, abs(sin(a * 36.0))) * 0.75;
  }
  float triA = 0.48 / max(0.35, cos(mod(a + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float triB = 0.48 / max(0.35, cos(mod(a + PI + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float hexagram = smoothstep(aa * 1.2, 0.0, abs(r - triA)) * step(r, 0.92)
                 + smoothstep(aa * 1.2, 0.0, abs(r - triB)) * step(r, 0.92);
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

  if (rayDir.z < -0.001) {
    float tHit = -u_camPos.z / rayDir.z;
    vec3 hit = u_camPos + rayDir * tHit;
    vec2 p = hit.xy * 0.0038;
    float rad = length(p);

    if (u_theme >= 6) {
      int v2 = u_theme - 6;
      float distFade = exp(-rad * rad * 0.36);
      vec3 lightDir = normalize(vec3(-0.36, -0.44, 0.82));
      float rawOcc = 0.0;
      for (int i = 0; i < 24; i++) {
        if (i >= u_diceCount) break;
        vec4 sp = u_diceSpheres[i];
        float h = max(0.0, sp.z - sp.w * 0.62);
        vec2 shCenter = sp.xy - lightDir.xy * (h * 0.58);
        float shRadius = sp.w * (0.94 + h * 0.0075);
        float d = length(hit.xy - shCenter);
        float occ = smoothstep(shRadius * 1.32, shRadius * 0.22, d) * exp(-h * 0.0105);
        rawOcc = 1.0 - (1.0 - rawOcc) * (1.0 - occ);
      }

      if (v2 == 0) {
        // [6: atelier] 绅士赌桌：北美黑胡桃木镶铜托盘 + 英式精纺墨绿细绒呢
        vec2 q = abs(hit.xy) / vec2(268.0, 178.0);
        float traySDF = length(max(q - vec2(0.74, 0.68), 0.0)) - 0.24;
        float lampSpot = exp(-dot(p * vec2(0.85, 1.05), p * vec2(0.85, 1.05)) * (0.58 - u_charge * 0.14)) * (1.0 + u_charge * 0.20);

        if (traySDF < 0.0) {
          float weave = sin(hit.x * 1.8) * sin(hit.y * 1.8) * 0.015;
          float woolFine = fbm(hit.xy * 0.22) * 0.065 + noise2(hit.xy * 1.35) * 0.035;
          vec3 baizeBase = vec3(0.038, 0.148, 0.096) + vec3(0.012, 0.032, 0.018) * (woolFine + weave);
          float grazing = pow(1.0 - abs(rayDir.z), 2.6);
          baizeBase += vec3(0.035, 0.085, 0.052) * grazing * 0.55;

          float brassFillet = smoothstep(0.009, 0.002, abs(traySDF + 0.028));
          vec3 brassCol = vec3(0.68, 0.53, 0.24) * (0.75 + 0.45 * lampSpot);
          col = mix(baizeBase * (0.48 + 0.72 * lampSpot), brassCol, brassFillet * 0.85);

          float wallShadow = smoothstep(-0.11, 0.0, traySDF);
          col *= (1.0 - wallShadow * 0.48);

          for (int i = 0; i < 8; i++) {
            vec4 imp = u_impacts[i];
            if (imp.w <= 0.001 || imp.z > 0.85) continue;
            float pr = imp.z / 0.85;
            float d = length(hit.xy - imp.xy);
            float dent = exp(-abs(d - (14.0 + pr * 48.0)) / 5.0) * (1.0 - pr) * imp.w;
            col += vec3(0.08, 0.11, 0.06) * dent * 0.35;
          }

          vec3 warmBounce = vec3(0.0);
          for (int i = 0; i < 24; i++) {
            if (i >= u_diceCount) break;
            vec4 sp = u_diceSpheres[i];
            float d3 = length(vec3(hit.xy - sp.xy, sp.z));
            warmBounce += vec3(0.26, 0.19, 0.07) * ((sp.w * sp.w) / (d3 * d3 + sp.w * sp.w * 1.4));
          }
          col = col * (1.0 - rawOcc * 0.78) + warmBounce * 0.24;
        } else {
          vec2 woodUV = hit.xy * vec2(0.018, 0.075);
          float grain = sin(woodUV.x * 9.0 + fbm(woodUV * 3.5) * 5.5) * 0.5 + 0.5;
          float pores = noise2(hit.xy * vec2(0.35, 1.2));
          vec3 walnut = mix(vec3(0.058, 0.032, 0.018), vec3(0.165, 0.096, 0.052), pow(grain, 1.4));
          walnut *= (0.88 + 0.16 * pores);
          float rimBevel = exp(-traySDF * 26.0);
          vec3 specWood = vec3(0.36, 0.25, 0.14) * rimBevel * 0.65;
          col = (walnut + specWood) * (0.42 + 0.68 * lampSpot) * (1.0 - rawOcc * 0.65);
        }
      } else if (v2 == 1) {
        // [7: pixel] 勇者地牢：16-Bit 整数像素网格 + 4x4 Bayer 有序抖动
        vec2 pixWorld = floor(hit.xy / 5.0);
        vec2 localInBrick = mod(pixWorld, vec2(12.0, 6.0));
        float rowIdx = floor(pixWorld.y / 6.0);
        if (mod(rowIdx, 2.0) > 0.5) {
          localInBrick.x = mod(pixWorld.x + 6.0, 12.0);
        }
        vec2 brickId = vec2(
          floor((pixWorld.x + (mod(rowIdx, 2.0) > 0.5 ? 6.0 : 0.0)) / 12.0),
          rowIdx
        );

        float brickHash = hash21(brickId);
        bool isMortar = (localInBrick.x < 1.0) || (localInBrick.y < 1.0);
        bool isHiEdge = !isMortar && (localInBrick.y >= 5.0 || localInBrick.x == 1.0);

        float flicker = sin(u_time * 7.0) * 0.025 + cos(u_time * 13.0) * 0.015;
        float torchR = length(floor(hit.xy / 5.0) * 5.0 * 0.0038);
        float lightVal = clamp(1.08 - torchR * 0.88 + flicker + u_climax * 0.25 + u_charge * 0.3, 0.0, 1.2);
        float dither = bayer4x4(gl_FragCoord.xy);
        float litBand = floor(lightVal * 3.2 + dither) / 3.0;

        vec3 cMortar    = vec3(0.055, 0.045, 0.085);
        vec3 cStoneLo   = vec3(0.115, 0.105, 0.185);
        vec3 cStoneMid  = vec3(0.205, 0.185, 0.285);
        vec3 cStoneHi   = vec3(0.355, 0.295, 0.365);
        vec3 cTorchWarm = vec3(0.540, 0.405, 0.345);

        float varShift = (brickHash - 0.5) * 0.22;
        float band = clamp(litBand + varShift, 0.0, 1.0);
        vec3 stone = band > 0.72 ? cTorchWarm
                   : band > 0.42 ? cStoneHi
                   : band > 0.16 ? cStoneMid
                                 : cStoneLo;

        if (!isMortar && brickHash > 0.84 && hash21(pixWorld * 1.7) > 0.78) {
          stone = mix(stone, vec3(0.16, 0.34, 0.22), 0.75);
        }
        if (isHiEdge) stone *= 1.18;
        if (isMortar) stone = cMortar;

        for (int i = 0; i < 8; i++) {
          vec4 imp = u_impacts[i];
          if (imp.w <= 0.001 || imp.z > 0.75) continue;
          float pr = imp.z / 0.75;
          vec2 dp = abs(floor(hit.xy / 5.0) * 5.0 - imp.xy);
          float boxDist = max(dp.x, dp.y);
          float targetR = floor((15.0 + pr * 75.0) / 5.0) * 5.0;
          if (abs(boxDist - targetR) < 5.2) {
            stone = u_tier == 5 ? vec3(0.85, 0.22, 0.38) : vec3(0.98, 0.78, 0.28);
          }
        }

        if (rawOcc > 0.52 || (rawOcc > 0.22 && dither > 0.5)) {
          stone *= 0.38;
        }
        col = stone;
      } else if (v2 == 2) {
        // [8: etching] 达芬奇手稿：暖象牙羊皮纸 + 圆规几何作图线 + 45° 双交叉钢笔排线阴影
        float fiber = fbm(hit.xy * 0.045) * 0.055 + noise2(hit.xy * 0.42) * 0.025;
        float ageStain = fbm(p * 2.4 + 3.7) * 0.065;
        vec3 vellum = vec3(0.925, 0.876, 0.778) - fiber - vec3(0.05, 0.06, 0.08) * ageStain;
        vellum *= mix(0.76, 1.0, exp(-rad * rad * 0.28));

        vec3 ironInk = vec3(0.155, 0.118, 0.088);
        vec3 cinnabarInk = vec3(0.695, 0.195, 0.145);

        float r = length(p);
        float a = atan(p.y, p.x);
        float aa = max(0.003, fwidth(r) * 1.25);

        float compassOuter = smoothstep(aa, 0.0, abs(r - 0.92));
        float compassInner = smoothstep(aa * 0.9, 0.0, abs(r - 0.86)) * 0.7;
        float goldenCircle = smoothstep(aa * 0.9, 0.0, abs(r - 0.568)) * 0.65;

        float diag1 = smoothstep(aa * 0.75, 0.0, abs(p.x)) + smoothstep(aa * 0.75, 0.0, abs(p.y));
        float diag2 = (smoothstep(aa * 0.75, 0.0, abs(p.x - p.y) * 0.707) + smoothstep(aa * 0.75, 0.0, abs(p.x + p.y) * 0.707)) * 0.55;
        float rulerLines = clamp(diag1 + diag2, 0.0, 1.0) * step(0.18, r) * step(r, 1.08) * 0.34;

        float degreeTicks = 0.0;
        if (r > 0.86 && r < 0.92) {
          degreeTicks = smoothstep(0.12, 0.0, abs(sin(a * 36.0))) * 0.75;
        }

        float inkMask = clamp(compassOuter + compassInner + goldenCircle + rulerLines + degreeTicks, 0.0, 1.0);
        col = mix(vellum, ironInk, inkMask * 0.72 * distFade);

        float sqBox = max(abs(p.x), abs(p.y));
        float redDiagram = smoothstep(aa * 1.1, 0.0, abs(sqBox - 0.568)) * 0.45
                         + smoothstep(aa * 1.1, 0.0, abs(r - 0.35)) * 0.42;
        col = mix(col, cinnabarInk, clamp(redDiagram, 0.0, 1.0) * distFade * (0.65 + 0.35 * max(u_climax, u_charge)));

        for (int i = 0; i < 8; i++) {
          vec4 imp = u_impacts[i];
          if (imp.w <= 0.001 || imp.z > 1.3) continue;
          float pr = imp.z / 1.3;
          float d = length(hit.xy - imp.xy);
          float ringR = 16.0 + pr * 68.0;
          float inkWave = (smoothstep(1.8, 0.0, abs(d - ringR)) + smoothstep(1.4, 0.0, abs(d - ringR * 0.78)) * 0.6) * (1.0 - pr);
          col = mix(col, cinnabarInk, clamp(inkWave * imp.w, 0.0, 0.85));
        }

        if (rawOcc > 0.05) {
          float sCoord1 = (hit.x + hit.y) * 2.35 + fbm(hit.xy * 0.08) * 1.4;
          float sCoord2 = (hit.x - hit.y) * 2.35;
          float aaS = clamp(fwidth(sCoord1) * 0.9, 0.15, 0.65);
          float hLine1 = smoothstep(0.28 + aaS, 0.28 - aaS, abs(sin(sCoord1)));
          float hLine2 = smoothstep(0.24 + aaS, 0.24 - aaS, abs(sin(sCoord2)));
          float hatchShadow = hLine1 * smoothstep(0.05, 0.34, rawOcc) * 0.58
                            + hLine2 * smoothstep(0.32, 0.72, rawOcc) * 0.52;
          col = mix(col, ironInk, clamp(hatchShadow, 0.0, 0.72));
        }
      } else if (v2 == 3) {
        // [9: urushi] 京都黑漆：镜面黑吕色推光大漆茶盘 + 梨地金砂 + 虚像倒影
        float subtleGrain = fbm(hit.xy * 0.015) * 0.006;
        col = vec3(0.014, 0.011, 0.012) + subtleGrain;

        vec2 goldCell = hit.xy * 0.32;
        float gSeed = hash21(floor(goldCell));
        if (gSeed > 0.962) {
          float gd = length(fract(goldCell) - 0.5);
          col += vec3(0.58, 0.43, 0.15) * smoothstep(0.18, 0.0, gd) * (gSeed - 0.96) * 11.0 * distFade;
        }

        float r = length(p);
        float aa = max(0.0026, fwidth(r) * 1.25);
        float outerLacquerGold = smoothstep(aa, 0.0, abs(r - 0.90)) * 0.58
                               + smoothstep(aa * 0.8, 0.0, abs(r - 0.878)) * 0.26;
        float moonCrescent = smoothstep(aa * 1.4, 0.0, abs(length(p - vec2(0.05, 0.0)) - 0.56))
                           * smoothstep(-0.15, 0.38, p.x) * 0.36;
        vec3 makieGold = vec3(0.76, 0.58, 0.24) * (1.0 + u_charge * 0.45);
        col += makieGold * (outerLacquerGold + moonCrescent) * distFade;

        if (u_climax > 0.02 && u_tier == 1) {
          float kCurve = p.y * 0.75 + 0.14 * sin(p.x * 4.2) + 0.045 * fbm(p * 9.5);
          float kAa = max(0.0028, fwidth(kCurve) * 1.35);
          float vein = smoothstep(kAa, 0.0, abs(kCurve));
          col += vec3(1.25, 0.92, 0.32) * vein * u_climax * 0.78 * distFade;
        }

        for (int i = 0; i < 8; i++) {
          vec4 imp = u_impacts[i];
          if (imp.w <= 0.001 || imp.z > 1.5) continue;
          float pr = imp.z / 1.5;
          float d = length(hit.xy - imp.xy);
          float ripple = exp(-abs(d - (14.0 + pr * 78.0)) / 2.2) * (1.0 - pr) * imp.w;
          col += vec3(0.92, 0.70, 0.26) * ripple * 0.65;
        }

        vec3 reflDir = reflect(rayDir, vec3(0.0, 0.0, 1.0));
        vec3 mirrorCol = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          if (i >= u_diceCount) break;
          vec4 sp = u_diceSpheres[i];
          vec3 oc = hit - sp.xyz;
          float b = dot(oc, reflDir);
          float c = dot(oc, oc) - sp.w * sp.w * 0.92;
          float disc = b * b - c;
          if (b < 0.0 && disc > 0.0) {
            float edgeSoft = smoothstep(0.0, sp.w * sp.w * 0.65, disc);
            bool isShuRed = ((i & 1) == 0);
            vec3 reflTint = isShuRed ? vec3(0.28, 0.042, 0.032) : vec3(0.06, 0.05, 0.04);
            mirrorCol = mix(mirrorCol, reflTint + vec3(0.08, 0.06, 0.025) * edgeSoft, edgeSoft * 0.34 * exp(-sp.z * 0.010));
          }
        }
        float skySpec = smoothstep(0.68, 0.98, reflDir.z) * 0.026;
        col = (col + mirrorCol + vec3(0.9, 0.85, 0.78) * skySpec) * (1.0 - rawOcc * 0.76);
      } else if (v2 == 4) {
        // [10: bauhaus] 包豪斯白瓷：浅灰微喷砂瑞士网格建筑台面 + 博朗信号橙刻度环
        float microSand = (hash21(floor(hit.xy * 1.5)) - 0.5) * 0.018 + fbm(hit.xy * 0.02) * 0.015;
        vec3 matteAlum = mix(vec3(0.825, 0.818, 0.798), vec3(0.905, 0.900, 0.885), exp(-rad * rad * 0.35)) + microSand;

        vec2 gCell = mod(hit.xy + 36.0, 72.0) - 36.0;
        float crossArm = min(
          max(abs(gCell.x) - 4.2, abs(gCell.y) - 0.55),
          max(abs(gCell.y) - 4.2, abs(gCell.x) - 0.55)
        );
        float fiducial = smoothstep(0.8, 0.0, crossArm) * 0.28 * distFade;
        col = mix(matteAlum, vec3(0.32, 0.33, 0.35), fiducial);

        float r = length(p);
        float a = atan(p.y, p.x);
        float aa = max(0.0028, fwidth(r) * 1.2);
        float dialRing = smoothstep(aa, 0.0, abs(r - 0.86)) * 0.38;
        float vernierTicks = 0.0;
        if (r > 0.82 && r < 0.86) {
          vernierTicks = smoothstep(0.08, 0.0, abs(sin(a * 60.0))) * 0.32;
        }
        col = mix(col, vec3(0.24, 0.25, 0.27), (dialRing + vernierTicks) * distFade);

        vec3 braunOrange = u_tier == 5 ? vec3(0.82, 0.14, 0.14) : vec3(1.0, 0.31, 0.0);
        float orangeAccent = smoothstep(aa * 1.3, 0.0, abs(r - 0.89)) * (0.28 + 0.72 * max(u_climax, u_charge)) * distFade;
        col = mix(col, braunOrange, clamp(orangeAccent, 0.0, 1.0));

        for (int i = 0; i < 8; i++) {
          vec4 imp = u_impacts[i];
          if (imp.w <= 0.001 || imp.z > 0.95) continue;
          float pr = imp.z / 0.95;
          float d = length(hit.xy - imp.xy);
          float pulse = smoothstep(2.2, 0.0, abs(d - (16.0 + pr * 64.0))) * (1.0 - pr) * imp.w;
          col = mix(col, braunOrange, clamp(pulse * 0.85, 0.0, 0.9));
        }

        col *= (1.0 - rawOcc * 0.44);
      } else {
        // [11: murano] 深海星仪：普鲁士蓝灰板岩 + 925 纯银镶嵌古典星盘 + 海琉璃焦散光池
        float h0 = fbm(hit.xy * 0.022);
        float hx = fbm(hit.xy * 0.022 + vec2(0.08, 0.0));
        float hy = fbm(hit.xy * 0.022 + vec2(0.0, 0.08));
        vec3 slateN = normalize(vec3((h0 - hx) * 1.8, (h0 - hy) * 1.8, 1.0));
        float slateDiff = max(dot(slateN, lightDir), 0.0);

        vec3 slateBase = mix(vec3(0.028, 0.048, 0.078), vec3(0.068, 0.112, 0.168), h0);
        col = slateBase * (0.55 + 0.75 * slateDiff) * mix(0.45, 1.0, distFade);

        float silverMask = silverAstrolabeInlay(p);
        vec3 H = normalize(lightDir - rayDir);
        float silverSpec = pow(max(dot(slateN, H), 0.0), 36.0);
        vec3 silverCol = vec3(0.62, 0.68, 0.75) * (0.48 + 0.62 * slateDiff + u_charge * 0.32) + vec3(0.95, 0.98, 1.0) * silverSpec * (0.85 + u_charge * 0.35);
        col = mix(col, silverCol, clamp(silverMask * (0.82 + u_charge * 0.15) * distFade, 0.0, 1.0));

        for (int i = 0; i < 8; i++) {
          vec4 imp = u_impacts[i];
          if (imp.w <= 0.001 || imp.z > 1.25) continue;
          float pr = imp.z / 1.25;
          float d = length(hit.xy - imp.xy);
          float causticWave = exp(-abs(d - (16.0 + pr * 74.0)) / 3.8) * (1.0 - pr) * imp.w;
          col += vec3(0.42, 0.82, 0.88) * causticWave * 0.72;
        }

        vec3 causticGI = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          if (i >= u_diceCount) break;
          vec4 sp = u_diceSpheres[i];
          vec2 shCenter = sp.xy - lightDir.xy * max(0.0, sp.z - sp.w * 0.6) * 0.55;
          float d = length(hit.xy - shCenter);
          float cFocus = exp(-pow(d / (sp.w * 0.62), 2.0)) * exp(-sp.z * 0.008);
          causticGI += vec3(0.24, 0.62, 0.68) * cFocus * 0.55;
        }
        col = col * (1.0 - rawOcc * 0.52) + causticGI;
      }
    } else {
      float distFade = exp(-rad * rad * 0.42);

      // 幻想皮肤 3D 台面材质 (0..5)
      if (u_theme == 0) {
        vec2 pDeep1 = (u_camPos + rayDir * ((-46.0 - u_camPos.z) / rayDir.z)).xy * 0.0034;
        vec2 pDeep2 = (u_camPos + rayDir * ((-105.0 - u_camPos.z) / rayDir.z)).xy * 0.0029;
        float neb = fbm(pDeep2 * 2.8 + vec2(u_time * 0.04, -u_time * 0.03));
        col = mix(vec3(0.008, 0.007, 0.022), vec3(0.055, 0.025, 0.12), neb * distFade);

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

        vec3 goldCol = u_tier == 5 ? vec3(1.25, 0.20, 1.95) : vec3(1.38, 0.92, 0.28);
        col += goldCol * (layer0 + layer1 + layer2) * distFade * (0.48 + 0.36 * boost);

        if (u_charge > 0.01) {
          float vortex = smoothstep(0.55, 0.0, rad) * (sin(rad * 28.0 - u_time * 14.0) * 0.5 + 0.5);
          col += vec3(2.2, 1.45, 0.5) * vortex * smoothstep(0.65, 0.0, rad) * u_charge;
        }
      } else if (u_theme == 1) {
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
        vec2 pLava = (u_camPos + rayDir * ((-26.0 - u_camPos.z) / rayDir.z)).xy * 0.004;
        vec2 warp = vec2(fbm(p * 4.5), fbm(p * 4.5 + 9.2)) * 0.18;
        vec2 ve = voronoiEdge(p * 3.2 + warp, 0.22);

        float rock = fbm(p * 6.5);
        col = mix(vec3(0.018, 0.012, 0.011), vec3(0.052, 0.036, 0.030), rock);
        float crackGlow = smoothstep(0.13, 0.015, ve.y);
        float crackCore = smoothstep(0.032, 0.003, ve.y);
        float magmaFlow = fbm(pLava * 4.2 + vec2(u_time * 0.28, -u_time * 0.20));
        vec3 lavaHDR = mix(vec3(1.85, 0.24, 0.02), vec3(4.2, 1.95, 0.28), magmaFlow * 0.6 + crackCore * 0.5);
        col += lavaHDR * (crackGlow * 0.55 + crackCore * 0.95) * distFade * (0.65 + 0.65 * u_climax + u_charge);

        float anvilRim = smoothstep(0.011, 0.0, abs(max(abs(p.x) * 0.82, abs(p.y)) - 0.90));
        col += vec3(2.1, 0.65, 0.10) * anvilRim * distFade;
      } else if (u_theme == 3) {
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
        float paperFiber = fbm(p * 14.0) * 0.055 + fbm(p * 3.2) * 0.085;
        vec3 xuan = vec3(0.74, 0.70, 0.62) - paperFiber;
        float m1 = smoothstep(0.12, -0.22, p.y + 0.50 + 0.16 * fbm(vec2(p.x * 2.5, 1.2)));
        float m2 = smoothstep(0.08, -0.18, p.y + 0.30 + 0.12 * fbm(vec2(p.x * 3.8 + 4.0, 2.5)));
        xuan = mix(xuan, vec3(0.40, 0.42, 0.42), m1 * 0.52);
        xuan = mix(xuan, vec3(0.22, 0.25, 0.27), m2 * 0.42);

        float inkWash = smoothstep(0.86, 0.15, rad + 0.06 * fbm(p * 4.5));
        xuan = mix(xuan, vec3(0.50, 0.49, 0.45), inkWash * 0.35);
        float brushRing = smoothstep(0.024, 0.002, abs(rad - 0.84 + 0.022 * fbm(p * 6.5 + u_time * 0.15)));
        xuan = mix(xuan, vec3(0.08, 0.09, 0.11), brushRing * 0.75);
        xuan *= mix(0.38, 1.0, distFade);
        col = xuan;
      } else {
        float rSafe = max(rad, 0.04);
        float twist = 2.6 / (rSafe + 0.18) - u_time * 0.85;
        vec2 swirled = rot2(twist) * p;
        float disk = fbm(swirled * 3.6);
        float horizon = smoothstep(0.16, 0.24, rad);
        float photonRing = exp(-abs(rad - 0.19) * 32.0);
        vec3 plasma = mix(vec3(0.12, 1.85, 1.45), vec3(1.45, 0.25, 2.35), disk);
        col = plasma * disk * smoothstep(1.35, 0.18, rad) * horizon * 0.85;
        col += vec3(1.8, 2.8, 2.5) * photonRing * 1.6;
        float a7 = atan(p.y, p.x);
        float sigil = smoothstep(0.012, 0.0, abs(rad - (0.72 + 0.12 * cos(a7 * 7.0 - u_time * 0.5))));
        col += vec3(0.3, 1.9, 1.5) * sigil * 0.45 * distFade;
      }

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
          float maxR = (28.0 + imp.w * 56.0) * (0.35 + 0.65 * (1.0 - pow(1.0 - prog, 3.0)));
          float nEdge = fbm(dVec * 0.055 + float(i) * 3.1) * 18.0;
          float blot = smoothstep(maxR, maxR * 0.45, dist + nEdge - 8.0);
          float fade = (1.0 - smoothstep(0.55, 1.0, prog)) * 0.62 * imp.w;
          col = mix(col, vec3(0.06, 0.07, 0.09), blot * fade);
        } else if (u_theme == 2) {
          float ang = atan(dVec.y, dVec.x);
          float rays = pow(abs(cos(ang * 5.0 + float(i) * 2.1)), 14.0);
          float reach = (35.0 + imp.w * 85.0) * smoothstep(0.0, 0.15, prog);
          float scorch = rays * smoothstep(reach, 0.0, dist) * (1.0 - prog);
          col += vec3(4.5, 1.4, 0.15) * scorch * imp.w * 1.8;
        } else {
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

      float shadow = 1.0;
      vec3 bounceGI = vec3(0.0);
      vec3 lightDir = normalize(vec3(-0.35, -0.42, 0.84));
      for (int i = 0; i < 24; i++) {
        if (i >= u_diceCount) break;
        vec4 sp = u_diceSpheres[i];
        float h = max(0.0, sp.z - sp.w * 0.65);
        vec2 shCenter = sp.xy - lightDir.xy * (h * 0.55);
        float shRadius = sp.w * (0.95 + h * 0.008);
        float d = length(hit.xy - shCenter);
        float occ = smoothstep(shRadius * 1.28, shRadius * 0.25, d) * exp(-h * 0.011);
        shadow *= (1.0 - occ * (u_theme == 4 ? 0.48 : 0.76));

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
    }
  } else {
    float skyH = clamp(rayDir.z * 3.0, 0.0, 1.0);
    if (u_theme == 8) col = mix(vec3(0.76, 0.71, 0.62), vec3(0.62, 0.57, 0.49), skyH);
    else if (u_theme == 10) col = mix(vec3(0.80, 0.79, 0.77), vec3(0.72, 0.71, 0.69), skyH);
    else if (u_theme == 6) col = mix(vec3(0.05, 0.035, 0.022), vec3(0.015, 0.012, 0.008), skyH);
    else if (u_theme >= 6) col = mix(vec3(0.03, 0.035, 0.055), vec3(0.008, 0.01, 0.018), skyH);
    else if (u_theme == 4) col = mix(vec3(0.58, 0.56, 0.52), vec3(0.32, 0.34, 0.36), skyH);
    else col = mix(vec3(0.04, 0.03, 0.08), vec3(0.005, 0.006, 0.015), skyH);
  }

  fragColor = vec4(max(col, vec3(0.0)), u_theme == 7 ? 0.0 : 1.0);
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
uniform int u_dieIndex;
uniform int u_winningFace;
uniform int u_maxFaceIdx;
uniform int u_styleAtlasOffset;
uniform float u_settled;
uniform float u_climax;
uniform int u_faceTiles[20];

const float PI = 3.14159265359;

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

float bayer4x4(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  int idx = p.y * 4 + p.x;
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (m[idx] + 0.5) / 16.0;
}

float refractedAstrolabe(vec2 p) {
  float r = length(p);
  float aa = 0.009;
  float rings = smoothstep(aa, 0.0, abs(r - 0.94))
              + smoothstep(aa, 0.0, abs(r - 0.58))
              + smoothstep(aa, 0.0, abs(r - 0.26));
  float rEcl = length(p - vec2(0.0, 0.16));
  float ecl = smoothstep(aa * 1.1, 0.0, abs(rEcl - 0.68)) * step(r, 0.94);
  float axes = (smoothstep(aa, 0.0, abs(p.x)) + smoothstep(aa, 0.0, abs(p.y))) * step(r, 0.94) * 0.5;
  return clamp(rings + ecl + axes, 0.0, 1.0);
}

vec3 sampleStudioEnv(vec3 R, int v2Theme) {
  float up = clamp(R.z * 0.5 + 0.5, 0.0, 1.0);
  float softboxMain = smoothstep(0.76, 0.96, dot(R, normalize(vec3(-0.42, -0.36, 0.83))));
  float softboxFill = smoothstep(0.70, 0.94, dot(R, normalize(vec3(0.64, 0.28, 0.71))));

  if (v2Theme == 0) {
    vec3 env = mix(vec3(0.04, 0.11, 0.07), vec3(0.24, 0.19, 0.13), up);
    return env + vec3(2.15, 1.82, 1.32) * softboxMain + vec3(0.95, 0.85, 0.72) * softboxFill * 0.65;
  }
  if (v2Theme == 3) {
    vec3 env = mix(vec3(0.03, 0.02, 0.02), vec3(0.18, 0.15, 0.13), up);
    return env + vec3(2.45, 2.25, 1.95) * softboxMain + vec3(0.9, 0.55, 0.35) * softboxFill * 0.45;
  }
  if (v2Theme == 4) {
    vec3 env = mix(vec3(0.62, 0.61, 0.59), vec3(0.95, 0.95, 0.94), up);
    return env + vec3(0.85) * softboxMain;
  }
  vec3 env = mix(vec3(0.04, 0.08, 0.14), vec3(0.18, 0.30, 0.42), up);
  return env + vec3(2.1, 2.35, 2.55) * softboxMain + vec3(0.65, 1.15, 1.35) * softboxFill * 0.7;
}

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

vec3 spectralIridescence(float cosTheta, float phase) {
  return 0.5 + 0.5 * cos(6.28318 * (cosTheta * 1.65 + phase + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec3 V = normalize(u_camPos - v_worldPos);

  float glyphMask = 0.0;
  float moatMask  = 0.0;
  float bumpSlope = 0.0;

  if (v_uv.x > 0.03 && v_uv.x < 0.97 && v_uv.y > 0.03 && v_uv.y < 0.97) {
    int localTile = u_faceTiles[clamp(v_faceIdx, 0, 19)];
    int globalTile = clamp(u_styleAtlasOffset + localTile, 0, 255);
    vec2 tileOrigin = vec2(float(globalTile & 15), float(globalTile >> 4)) * 0.0625;
    vec2 atlasUV = tileOrigin + clamp(v_uv, 0.025, 0.975) * 0.0625;
    vec4 tex = texture(u_atlas, atlasUV);

    if (u_theme == 7) {
      glyphMask = step(0.48, tex.r);
      moatMask  = clamp(step(0.42, tex.g) - glyphMask, 0.0, 1.0);
      bumpSlope = 0.0;
    } else {
      float aa = max(0.035, fwidth(tex.r) * 0.82);
      glyphMask = smoothstep(0.54 - aa, 0.54 + aa, tex.r);
      moatMask  = clamp(smoothstep(0.32, 0.58, tex.g) - glyphMask, 0.0, 1.0);
      bumpSlope = (tex.b * 2.0 - 1.0);
    }
  }

  // ==========================================================================
  // 典藏级六大跨媒介艺术皮肤 (theme 6..11)
  // ==========================================================================
  if (u_theme >= 6) {
    int v2 = u_theme - 6;
    float bevelSpan = v2 == 1 ? 0.018 : (v2 == 0 ? 0.056 : (v2 == 4 ? 0.046 : 0.052));
    float bevelMask = 1.0 - smoothstep(0.006, bevelSpan, v_edgeDist);
    float ridgeLine = smoothstep(0.034, 0.004, v_edgeDist);
    vec3 N = normalize(mix(v_faceN, v_smoothN, bevelMask * (v2 == 1 ? 0.15 : 0.62)));

    if (v2 != 1 && v2 != 2) {
      N = normalize(N - (v_tan + v_bitan) * (bumpSlope * 0.45));
    }

    vec3 L1 = normalize(vec3(-0.38, -0.45, 0.81));
    vec3 L2 = normalize(vec3(0.65, 0.50, 0.57));
    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0);
    float NdotV = max(dot(N, V), 0.001);
    vec3 R = reflect(-V, N);
    vec3 H1 = normalize(L1 + V);
    float fresnel = pow(1.0 - NdotV, 4.0);

    bool isWinFace = (v_faceIdx == u_winningFace) && (u_settled > 0.5);
    bool isMaxFace = (v_faceIdx == u_maxFaceIdx);
    float objIdAlpha = float(u_dieIndex + 1) / 32.0;
    float focusDim = (u_settled > 0.5 && !isWinFace) ? 0.72 : 1.0;

    if (v2 == 1) {
      // [7: pixel] 勇者地牢：纯阶梯像素着色 + Bayer 抖动 + 1px 清脆棱线
      float faceLit = max(dot(v_faceN, L1), 0.0) * 0.82 + max(dot(v_faceN, L2), 0.0) * 0.25;
      float dither = bayer4x4(gl_FragCoord.xy);
      int shadeBand = int(clamp(floor(faceLit * 3.4 + dither), 0.0, 3.0));

      int pal = u_dieIndex & 3;
      vec3 cDark, cMid, cBright, cRim;
      if (pal == 0) {
        cDark = vec3(0.28, 0.05, 0.11); cMid = vec3(0.58, 0.11, 0.19);
        cBright = vec3(0.86, 0.22, 0.26); cRim = vec3(1.0, 0.58, 0.45);
      } else if (pal == 1) {
        cDark = vec3(0.06, 0.13, 0.34); cMid = vec3(0.13, 0.29, 0.64);
        cBright = vec3(0.24, 0.52, 0.88); cRim = vec3(0.62, 0.86, 1.0);
      } else if (pal == 2) {
        cDark = vec3(0.05, 0.24, 0.16); cMid = vec3(0.11, 0.48, 0.30);
        cBright = vec3(0.22, 0.74, 0.44); cRim = vec3(0.68, 0.96, 0.68);
      } else {
        cDark = vec3(0.32, 0.16, 0.05); cMid = vec3(0.64, 0.36, 0.09);
        cBright = vec3(0.92, 0.62, 0.16); cRim = vec3(1.0, 0.88, 0.48);
      }

      vec3 body = shadeBand >= 3 ? cRim : (shadeBand == 2 ? cBright : (shadeBand == 1 ? cMid : cDark));
      if (v_edgeDist < 0.036 && glyphMask < 0.5 && moatMask < 0.5) {
        body = faceLit > 0.32 ? cRim : cDark * 0.65;
      }

      vec3 pixInk = (isMaxFace || (isWinFace && u_tier == 1))
        ? vec3(1.0, 0.90, 0.32)
        : vec3(0.98, 0.96, 0.90);
      body = mix(body, vec3(0.06, 0.04, 0.09), moatMask);
      body = mix(body, pixInk, glyphMask);
      if (u_settled > 0.5 && !isWinFace) body *= 0.68;

      fragColor = vec4(body, objIdAlpha);
      return;
    }

    if (v2 == 2) {
      // [8: etching] 达芬奇手稿：实时三层钢笔交叉排线阴影 + 朱砂墨刻
      float paperNoise = noise3(v_localPos * 14.0) * 0.035;
      vec3 vellum = vec3(0.945, 0.898, 0.808) - paperNoise;
      vec3 ironInk = vec3(0.135, 0.102, 0.078);
      vec3 cinnabar = vec3(0.715, 0.175, 0.125);

      float shade = clamp(dot(v_faceN, L1) * 0.78 + dot(v_faceN, L2) * 0.22, 0.0, 1.0);
      vec2 hUV = v_uv * 44.0 + vec2(float(v_faceIdx) * 3.7, float(u_dieIndex) * 2.3);
      float w1 = sin((hUV.x + hUV.y * 0.85) * PI);
      float w2 = sin((hUV.x * 0.85 - hUV.y) * PI);
      float w3 = sin((hUV.y * 1.35 + hUV.x * 0.25) * PI);

      float aaH = clamp(fwidth(hUV.x) * 1.6, 0.08, 0.45);
      float line1 = smoothstep(0.36 + aaH, 0.36 - aaH, abs(w1));
      float line2 = smoothstep(0.34 + aaH, 0.34 - aaH, abs(w2));
      float line3 = smoothstep(0.32 + aaH, 0.32 - aaH, abs(w3));

      float hatch = 0.0;
      float clearGlyphZone = clamp(glyphMask + moatMask * 0.92, 0.0, 1.0);
      if (shade < 0.72) hatch = max(hatch, line1 * smoothstep(0.72, 0.45, shade) * 0.62);
      if (shade < 0.44) hatch = max(hatch, line2 * smoothstep(0.44, 0.20, shade) * 0.72);
      if (shade < 0.20) hatch = max(hatch, line3 * smoothstep(0.20, 0.02, shade) * 0.82);
      hatch *= (1.0 - clearGlyphZone);

      vec3 col = mix(vellum, ironInk, hatch);
      float penEdge = smoothstep(0.042, 0.010, v_edgeDist) * (1.0 - glyphMask);
      col = mix(col, ironInk, penEdge * 0.86);

      float innerFrame = smoothstep(0.095, 0.080, v_edgeDist) * smoothstep(0.065, 0.080, v_edgeDist) * (1.0 - clearGlyphZone);
      col = mix(col, ironInk, innerFrame * 0.35);

      bool redInkGlyph = isMaxFace || isWinFace;
      col = mix(col, vellum, moatMask * 0.85);
      col = mix(col, redInkGlyph ? cinnabar : ironInk, glyphMask);
      if (u_settled > 0.5 && !isWinFace) col = mix(vellum * 0.88, col, 0.76);

      fragColor = vec4(col, objIdAlpha);
      return;
    }

    if (v2 == 0) {
      // [6: atelier] 绅士赌桌：手工线性拉丝做旧黄铜 & 传世猛犸骨瓷双材质
      bool isBrass = ((u_dieIndex & 1) == 0);
      vec3 env = sampleStudioEnv(R, 0);
      float antiGlare = 1.0 - glyphMask * 0.92;

      if (isBrass) {
        float brushFine = sin(v_uv.x * 260.0 + noise3(v_localPos * 12.0) * 1.8) * 0.5 + 0.5;
        float patinaNoise = noise3(v_localPos * 5.2);
        float edgePolish = clamp(bevelMask * 0.95 + ridgeLine * 0.85 + smoothstep(0.13, 0.015, v_edgeDist) * 0.48, 0.0, 1.0);

        vec3 agedBronze    = vec3(0.45, 0.32, 0.14) * (0.88 + 0.22 * patinaNoise);
        vec3 polishedBrass = vec3(0.95, 0.78, 0.43);
        vec3 metalAlbedo   = mix(agedBronze, polishedBrass, edgePolish * (1.0 - glyphMask));
        metalAlbedo *= (0.97 + 0.055 * brushFine * (1.0 - glyphMask));

        vec3 enamelInk = (isMaxFace || (isWinFace && u_tier == 1))
          ? vec3(0.95, 0.91, 0.82)
          : vec3(0.025, 0.023, 0.022);
        float edgeLip = clamp(abs(bumpSlope) * 1.6, 0.0, 1.0) * (1.0 - glyphMask);
        metalAlbedo = mix(metalAlbedo, polishedBrass * 1.12, edgeLip * 0.58);

        float rough = mix(0.28 - edgePolish * 0.14 + brushFine * 0.04, 0.22, glyphMask);
        float metal = mix(0.88, 0.04, glyphMask);

        vec3 F0 = mix(vec3(0.04), metalAlbedo, metal);
        vec3 F  = F0 + (1.0 - F0) * fresnel;
        float specPow = mix(98.0, 18.0, rough);
        float spec1 = pow(max(dot(N, H1), 0.0), specPow) * 1.48;
        float chamferGlint = bevelMask * pow(max(dot(v_smoothN, H1), 0.0), 48.0) * 1.9;

        vec3 base = mix(metalAlbedo, enamelInk, glyphMask);
        vec3 diffuse = base * (1.0 - metal * 0.82) * (0.34 + 0.78 * diff1 + 0.25 * diff2);
        vec3 specular = (F * env * (1.0 - rough * 0.42) + F * (spec1 + chamferGlint) * vec3(1.15, 1.02, 0.84)) * antiGlare;
        specular += vec3(0.06) * pow(max(dot(v_faceN, H1), 0.0), 64.0) * glyphMask;

        fragColor = vec4((diffuse + specular) * focusDim, objIdAlpha);
        return;
      } else {
        float boneGrain = sin((v_localPos.x * 15.0 + v_localPos.y * 13.0) + noise3(v_localPos * 4.5) * 2.2) * 0.5 + 0.5;
        vec3 ivory = vec3(0.92, 0.875, 0.78) - vec3(0.03, 0.036, 0.045) * boneGrain * 0.48;
        float wrapDiff = max(0.0, (dot(N, L1) + 0.45) / 1.45);

        vec3 brassTrim = vec3(0.84, 0.67, 0.34);
        float trimMask = ridgeLine * 0.82 * (1.0 - glyphMask);
        vec3 inkCol = isMaxFace ? vec3(0.62, 0.12, 0.09) : vec3(0.09, 0.07, 0.055);

        vec3 col = ivory * (0.44 + 0.66 * wrapDiff + 0.18 * diff2);
        col = mix(col, brassTrim * (0.45 + 0.75 * diff1) + env * 0.38, trimMask);
        col = mix(col, inkCol, glyphMask);
        float spec = pow(max(dot(N, H1), 0.0), 54.0) * 0.26 * antiGlare;
        col += vec3(1.0, 0.96, 0.88) * spec + env * fresnel * 0.14 * antiGlare;

        fragColor = vec4(col * focusDim, objIdAlpha);
        return;
      }
    }

    if (v2 == 3) {
      // [9: urushi] 京都黑漆：正朱砂推光大漆 / 吕色乌漆 + 夜光贝螺钿棱镶 + 金泥莳绘
      bool isShuRed = ((u_dieIndex & 1) == 0);
      vec3 env = sampleStudioEnv(R, 3);

      float depthCloud = noise3(v_localPos * 5.2) * 0.10;
      vec3 lacquerBase = isShuRed
        ? vec3(0.56, 0.075, 0.054) * (0.90 + depthCloud)
        : vec3(0.018, 0.015, 0.017) + vec3(0.012, 0.008, 0.010) * depthCloud;

      float pearlGrain = noise3(v_localPos * 18.0);
      float radenMask = smoothstep(0.028, 0.005, v_edgeDist) * (1.0 - glyphMask);
      float pearlPhase = NdotV * 2.8 + pearlGrain * 4.5 + float(v_faceIdx) * 0.7;
      vec3 motherOfPearl = vec3(0.74, 0.82, 0.80) + 0.22 * cos(pearlPhase + vec3(0.0, 1.85, 3.5));

      float goldSparkle = noise3(v_worldPos * 26.0) * 0.14;
      vec3 makieGold = (isWinFace ? vec3(0.96, 0.80, 0.42) : vec3(0.88, 0.70, 0.32)) + goldSparkle;
      if (!isShuRed && isMaxFace) {
        makieGold = vec3(0.80, 0.15, 0.11);
      }

      vec3 diffuse = lacquerBase * (0.38 + 0.72 * diff1 + 0.22 * diff2);
      diffuse = mix(diffuse, motherOfPearl * (0.55 + 0.55 * diff1), radenMask * 0.82);
      diffuse = mix(diffuse, makieGold * (0.60 + 0.58 * diff1), glyphMask);

      float clearcoatSpec = pow(max(dot(N, H1), 0.0), 148.0) * 1.65 * (1.0 - glyphMask * 0.85);
      float coatFresnel = 0.04 + 0.96 * fresnel;
      vec3 specular = (env * coatFresnel * 0.42 + vec3(1.2, 1.12, 1.0) * clearcoatSpec) * (1.0 - glyphMask * 0.75);
      specular += makieGold * pow(max(dot(N, H1), 0.0), 26.0) * 0.42 * glyphMask;

      fragColor = vec4((diffuse + specular) * focusDim, objIdAlpha);
      return;
    }

    if (v2 == 4) {
      // [10: bauhaus] 包豪斯白瓷：哑光氧化锆白瓷 / 石墨铝 + 博朗信号橙
      bool isGraphite = ((u_dieIndex % 3) == 1);
      vec3 braunOrange = u_tier == 5 ? vec3(0.84, 0.14, 0.14) : vec3(1.0, 0.30, 0.0);

      vec3 ceramicWhite = vec3(0.96, 0.955, 0.942);
      vec3 graphiteBody = vec3(0.14, 0.145, 0.156);

      bool orangeCap = isMaxFace && !isGraphite;
      vec3 bodyAlbedo = orangeCap ? braunOrange : (isGraphite ? graphiteBody : ceramicWhite);
      vec3 glyphAlbedo = orangeCap
        ? ceramicWhite
        : (isMaxFace || (isWinFace && u_tier == 1))
          ? braunOrange
          : (isGraphite ? ceramicWhite : vec3(0.10, 0.105, 0.115));

      float softLight = 0.58 + 0.44 * max(dot(v_faceN, L1), 0.0) + 0.18 * max(dot(v_faceN, L2), 0.0);
      float bevelSheen = bevelMask * pow(max(dot(v_smoothN, H1), 0.0), 22.0) * (isGraphite ? 0.22 : 0.14);

      vec3 col = bodyAlbedo * softLight + vec3(bevelSheen);
      if (isWinFace && !orangeCap) {
        float ringD = abs(length(v_uv - 0.5) - 0.42);
        float ringM = smoothstep(0.015, 0.005, ringD) * (1.0 - glyphMask);
        col = mix(col, braunOrange, ringM * 0.85);
      }
      col = mix(col, glyphAlbedo * (0.76 + 0.28 * max(dot(v_faceN, L1), 0.0)), glyphMask);
      if (u_settled > 0.5 && !isWinFace) col *= 0.85;

      fragColor = vec4(col, objIdAlpha);
      return;
    }

    // [11: murano] 深海星仪：威尼斯微磨砂海琉璃 & 斯涅尔真实背景星轨折射
    vec3 env = sampleStudioEnv(R, 5);
    vec3 refrDir = refract(-V, N, 1.0 / 1.51);
    float tFloor = -v_worldPos.z / min(-0.18, refrDir.z);
    vec2 refrHit = v_worldPos.xy + refrDir.xy * tFloor;
    vec2 refrP = refrHit * 0.0038;

    float refrAstro = refractedAstrolabe(refrP);
    float refrSlate = noise3(vec3(refrHit * 0.03, 1.0));
    vec3 transmittedBg = mix(vec3(0.035, 0.09, 0.155), vec3(0.085, 0.19, 0.27), refrSlate)
                       + vec3(0.78, 0.90, 0.96) * refrAstro * 0.88;

    float thickness = mix(1.0, 0.35, fresnel);
    float internalVeil = noise3(v_localPos * 4.8 - V * 0.28) * 0.5 + noise3(v_localPos * 11.0) * 0.25;
    vec3 glassTint = u_tier == 5
      ? mix(vec3(0.42, 0.35, 0.68), vec3(0.14, 0.08, 0.28), thickness)
      : mix(vec3(0.58, 0.88, 0.90), vec3(0.07, 0.27, 0.38), thickness);

    vec3 body = transmittedBg * glassTint * 1.48 + glassTint * internalVeil * 0.22;
    body += vec3(0.58, 0.84, 0.88) * pow(1.0 - NdotV, 2.6) * 0.35;

    vec3 silverTrim = vec3(0.78, 0.84, 0.90);
    vec3 silverGlyph = isWinFace ? vec3(0.99, 1.0, 1.0) : vec3(0.90, 0.95, 0.99);
    float tightShadow = clamp(abs(bumpSlope) * 1.4, 0.0, 1.0) * (1.0 - glyphMask);
    body = mix(body, vec3(0.02, 0.08, 0.14), tightShadow * 0.65);
    body = mix(body, silverTrim * (0.46 + 0.64 * diff1) + env * 0.35, ridgeLine * 0.72 * (1.0 - glyphMask));
    body = mix(body, silverGlyph, glyphMask);

    float antiGlare = 1.0 - glyphMask * 0.94;
    float spec = pow(max(dot(N, H1), 0.0), 78.0) * 1.35;
    vec3 specular = (env * (0.06 + 0.82 * fresnel) * 0.52 + vec3(1.15, 1.25, 1.3) * spec) * antiGlare;

    fragColor = vec4((body + specular) * focusDim, objIdAlpha);
    return;
  }

  // ==========================================================================
  // 幻想皮肤管线 (theme 0..5)
  // ==========================================================================
  float bevelMask = 1.0 - smoothstep(0.008, 0.052, v_edgeDist);
  float ridgeLine = smoothstep(0.032, 0.004, v_edgeDist);
  vec3 N = normalize(mix(v_faceN, v_smoothN, bevelMask * 0.55));
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
    emissive = auraCol * (ridgeLine * 0.52 * winPulse) * (1.0 - clearZone)
             + numColor * (glyphMask * 0.42);
  } else if (u_theme == 1) {
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

  if (u_settled > 0.5) {
    float faceFocus = isWinFace ? 1.0 : 0.42;
    baseColor *= faceFocus;
    emissive *= faceFocus;
  }

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

const RIBBON_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;

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
uniform int u_isInk; // 0: 能量发光丝带, 1: 水墨飞白浓墨, 2: 圆规铁胆细墨线, 3: 柔和微光游丝

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

  if (u_isInk == 2) {
    float line = smoothstep(0.65, 0.15, across);
    float alpha = line * tailFade * v_color.a;
    if (alpha < 0.01) discard;
    fragColor = vec4(v_color.rgb, alpha);
  } else if (u_isInk == 3) {
    float core = exp(-across * across * 6.5);
    float alpha = core * tailFade * v_color.a;
    if (alpha < 0.005) discard;
    fragColor = vec4(v_color.rgb * alpha, alpha);
  } else if (u_isInk == 1) {
    float bristle = noise2(vec2(v_uv.x * 18.0, v_uv.y * 14.0));
    float dryMask = smoothstep(0.22 + v_uv.x * 0.45, 0.78, bristle * (1.0 - across * 0.55));
    float alpha = dryMask * tailFade * v_color.a;
    if (alpha < 0.01) discard;
    fragColor = vec4(v_color.rgb, alpha);
  } else {
    float n = noise2(vec2(v_uv.x * 10.0 - u_time * 6.5, v_uv.y * 3.5));
    float core = exp(-across * across * 5.5);
    float erode = smoothstep(v_uv.x * 0.65, 1.0, n * 0.55 + core * 0.75);
    float alpha = core * erode * tailFade * v_color.a;
    if (alpha < 0.005) discard;
    fragColor = vec4(v_color.rgb * (0.8 + core * 1.4) * alpha, alpha);
  }
}
`

// 多媒介粒子与光柱着色器
// mode: 0=速度拉伸火星, 1=冲天光柱, 2=纯正方形像素尘埃, 3=像素十字闪星, 4=24K摇曳金箔叶, 5=柔和微尘/微墨点
const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_center;
layout(location = 1) in vec3 a_vel;
layout(location = 2) in vec2 a_corner;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec2 a_sizeMode;

uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform float u_time;

out vec2 v_corner;
out vec4 v_color;
flat out float v_mode;
flat out float v_seed;

void main() {
  v_corner = a_corner;
  v_color = a_color;
  v_mode = a_sizeMode.y;
  float sz = a_sizeMode.x;
  v_seed = fract(sin(dot(a_center, vec3(12.9898, 78.233, 37.719))) * 43758.5453);

  vec3 toCam = normalize(u_camPos - a_center);
  vec3 worldPos;
  if (a_sizeMode.y > 0.5 && a_sizeMode.y < 1.5) {
    vec3 up = vec3(0.0, 0.0, 1.0);
    vec3 side = normalize(cross(toCam, up));
    worldPos = a_center + side * (a_corner.x * sz) + up * ((a_corner.y * 0.5 + 0.5) * a_vel.z);
  } else if (a_sizeMode.y > 3.5 && a_sizeMode.y < 4.5) {
    vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), toCam));
    vec3 up = normalize(cross(toCam, right));
    float flutter = u_time * 5.5 + v_seed * 6.28;
    float c = cos(flutter), s = sin(flutter);
    vec2 rotC = vec2(a_corner.x * c - a_corner.y * s, (a_corner.x * s + a_corner.y * c) * (0.45 + 0.55 * abs(sin(flutter * 0.7))));
    worldPos = a_center + right * (rotC.x * sz) + up * (rotC.y * sz);
  } else if (a_sizeMode.y > 1.5) {
    vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), toCam));
    vec3 up = normalize(cross(toCam, right));
    worldPos = a_center + right * (a_corner.x * sz) + up * (a_corner.y * sz);
  } else {
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
flat in float v_seed;
out vec4 fragColor;

void main() {
  if (v_mode > 0.5 && v_mode < 1.5) {
    float radial = exp(-v_corner.x * v_corner.x * 5.2);
    float h = v_corner.y * 0.5 + 0.5;
    float vert = smoothstep(0.0, 0.08, h) * pow(max(0.0, 1.0 - h), 1.6);
    float a = radial * vert * v_color.a;
    fragColor = vec4(v_color.rgb * a, a);
    return;
  }
  if (v_mode >= 1.5 && v_mode < 2.5) {
    if (max(abs(v_corner.x), abs(v_corner.y)) > 0.85) discard;
    fragColor = vec4(v_color.rgb, 0.95);
    return;
  }
  if (v_mode >= 2.5 && v_mode < 3.5) {
    vec2 ac = abs(v_corner);
    bool inCross = (ac.x < 0.26 && ac.y < 0.95) || (ac.y < 0.26 && ac.x < 0.95) || (ac.x < 0.52 && ac.y < 0.52);
    if (!inCross) discard;
    fragColor = vec4(v_color.rgb, 0.95);
    return;
  }
  if (v_mode >= 3.5 && v_mode < 4.5) {
    float diamond = abs(v_corner.x) * 0.85 + abs(v_corner.y) * 1.15;
    if (diamond > 0.92) discard;
    fragColor = vec4(v_color.rgb * v_color.a, v_color.a);
    return;
  }
  float d2 = dot(v_corner, v_corner);
  if (d2 > 1.0) discard;
  float glow = exp(-d2 * 4.0) * (1.0 - d2);
  float a = glow * v_color.a;
  fragColor = vec4(v_color.rgb * a, a);
}
`

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

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform vec2 u_resolution;
uniform vec2 u_sceneTexSize;
uniform int u_theme;
uniform vec4 u_shockwave;
uniform float u_chroma;
uniform float u_bulletTime;
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

vec3 neutralFilmic(vec3 x) {
  const float a = 2.15;
  const float b = 0.04;
  const float c = 1.95;
  const float d = 0.56;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // 1. 像素风专属 (theme 7)：整数像素点采样 + 1px 纯正深墨黑像素外轮廓描边
  if (u_theme == 7) {
    ivec2 texDim = ivec2(u_sceneTexSize);
    ivec2 tc = clamp(ivec2(v_uv * u_sceneTexSize), ivec2(0), texDim - ivec2(1));
    vec4 center = texelFetch(u_sceneTex, tc, 0);
    vec3 pixCol = center.rgb;

    float idC = center.a;
    float idL = texelFetch(u_sceneTex, clamp(tc + ivec2(-1,  0), ivec2(0), texDim - ivec2(1)), 0).a;
    float idR = texelFetch(u_sceneTex, clamp(tc + ivec2( 1,  0), ivec2(0), texDim - ivec2(1)), 0).a;
    float idU = texelFetch(u_sceneTex, clamp(tc + ivec2( 0,  1), ivec2(0), texDim - ivec2(1)), 0).a;
    float idD = texelFetch(u_sceneTex, clamp(tc + ivec2( 0, -1), ivec2(0), texDim - ivec2(1)), 0).a;

    bool cIsBg = idC < 0.01;
    bool neighborIsDie = (idL > 0.01 && idL < 0.9) || (idR > 0.01 && idR < 0.9) ||
                         (idU > 0.01 && idU < 0.9) || (idD > 0.01 && idD < 0.9);
    bool dieSeam = (idC > 0.01 && idC < 0.9) && (
      (idR > 0.01 && idR < 0.9 && abs(idC - idR) > 0.015) ||
      (idU > 0.01 && idU < 0.9 && abs(idC - idU) > 0.015)
    );

    if ((cIsBg && neighborIsDie) || dieSeam) {
      pixCol = vec3(0.055, 0.042, 0.082);
    }
    fragColor = vec4(clamp(pixCol, 0.0, 1.0), 1.0);
    return;
  }

  // 2. 典藏级皮肤合成管线 (theme 6..11)：亮调保真 / 中性温润胶片曲线
  if (u_theme >= 6) {
    vec3 hdr = texture(u_sceneTex, clamp(v_uv, 0.001, 0.999)).rgb;
    if (u_bloomStrength > 0.001) {
      vec3 bloom = texture(u_bloomTex, clamp(v_uv, 0.001, 0.999)).rgb;
      hdr += bloom * u_bloomStrength;
    }
    vec2 fromCenter = v_uv - 0.5;
    if (u_theme == 8 || u_theme == 10) {
      float lightVig = 1.0 - dot(fromCenter, fromCenter) * (u_theme == 8 ? 0.18 : 0.10);
      vec3 c = hdr * lightVig;
      c = c / (1.0 + max(vec3(0.0), c - 0.92) * 0.8);
      fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      return;
    }
    float vig = 1.0 - dot(fromCenter, fromCenter) * 0.28;
    vec3 mapped = neutralFilmic(hdr * vig);
    mapped = pow(mapped, vec3(1.0 / 2.15));
    fragColor = vec4(mapped, 1.0);
    return;
  }

  // 3. 幻想皮肤合成管线 (theme 0..5)
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  if (u_shockwave.w > 0.001) {
    vec2 delta = uv - u_shockwave.xy;
    delta.x *= aspect;
    float dist = length(delta);
    float band = exp(-abs(dist - u_shockwave.z) * 26.0);
    vec2 dir = dist > 1e-4 ? normalize(delta) : vec2(0.0);
    dir.x /= aspect;
    uv -= dir * band * u_shockwave.w * 0.042;
  }

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

  if (u_bulletTime > 0.01) {
    float edgeMask = smoothstep(0.18, 0.78, length(fromCenter));
    float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    vec3 coldTint = mix(vec3(luma), vec3(luma) * vec3(0.65, 1.05, 1.45), 0.75);
    hdr = mix(hdr, coldTint, edgeMask * u_bulletTime * 0.65);
  }

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
      'u_dieIndex', 'u_winningFace', 'u_maxFaceIdx', 'u_styleAtlasOffset',
      'u_settled', 'u_climax', 'u_faceTiles[0]'
    ])

    this.ribbonProg = cacheUniforms(linkProgram(gl, RIBBON_VERT, RIBBON_FRAG), [
      'u_viewProj', 'u_time', 'u_isInk'
    ])

    this.particleProg = cacheUniforms(linkProgram(gl, PARTICLE_VERT, PARTICLE_FRAG), [
      'u_viewProj', 'u_camPos', 'u_time'
    ])

    this.bloomDownProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_DOWN_FRAG), [
      'u_tex', 'u_texelSize', 'u_threshold'
    ])

    this.bloomUpProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_UP_FRAG), [
      'u_tex', 'u_texelSize', 'u_intensity'
    ])

    this.compositeProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG), [
      'u_sceneTex', 'u_bloomTex', 'u_resolution', 'u_sceneTexSize',
      'u_theme', 'u_shockwave', 'u_chroma', 'u_bulletTime',
      'u_bloomStrength', 'u_time'
    ])

    this.emptyVAO = gl.createVertexArray()
  }

  _initAtlasTexture() {
    const gl = this.gl
    const atlas = getSharedAtlasCanvas()
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.data)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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

      let maxFaceIdx = 0
      for (let f = 0; f < mesh.faces.length; f++) {
        if (mesh.faces[f].isMaxFace) { maxFaceIdx = f; break }
      }
      this.meshGPU[key] = { vao, vbo, vertexCount: mesh.vertexCount, mesh, maxFaceIdx }
    }
  }

  _initDynamicBuffers() {
    const gl = this.gl

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

  _createColorTarget(w, h, withDepth, nearestFilter = false) {
    const gl = this.gl
    const filter = nearestFilter ? gl.NEAREST : gl.LINEAR
    const tryCreate = useFloat => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      if (useFloat && !nearestFilter) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
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

    if (this.hasFloatFBO && !nearestFilter) {
      const res = tryCreate(true)
      if (res) return res
      this.hasFloatFBO = false
    }
    return tryCreate(false)
  }

  _destroyFBOs() {
    if (!this.fbos) return
    const gl = this.gl
    const list = [this.fbos.scene, this.fbos.pixelScene, ...this.fbos.bloomMips]
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

    const scene = this._createColorTarget(w, h, true, false)

    // 专供 16-Bit 像素风的原生低分辨率整数网格 FBO
    const targetPixH = h < 220 ? 84 : 172
    const pixScale = Math.max(2, Math.round(h / targetPixH))
    const pw = Math.max(64, Math.round(w / pixScale))
    const ph = Math.max(44, Math.round(h / pixScale))
    const pixelScene = this._createColorTarget(pw, ph, true, true)

    const bloomMips = []
    let bw = Math.max(16, w >> 1)
    let bh = Math.max(16, h >> 1)
    for (let i = 0; i < 4; i++) {
      bloomMips.push(this._createColorTarget(bw, bh, false, false))
      bw = Math.max(8, bw >> 1)
      bh = Math.max(8, bh >> 1)
    }
    this.fbos = { scene, pixelScene, bloomMips }
  }

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

    const isPixelTheme = themeId === 7
    const isCuratedV2 = themeId >= 6
    const activeTarget = (isPixelTheme && this.fbos.pixelScene) ? this.fbos.pixelScene : this.fbos.scene

    const aspect = this.width / Math.max(1, this.height)
    mat4Perspective(this._proj, camFovRad, aspect, 18.0, 2600.0)
    mat4LookAt(this._view, camEye, camTarget, [0, 0, 1])
    mat4Multiply(this._viewProj, this._proj, this._view)
    mat4Invert(this._invViewProj, this._viewProj)

    // ========================================================================
    // PASS 1: 场景渲染（高清浮点 FBO 或 原生低分辨率像素 FBO）
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, activeTarget.fbo)
    gl.viewport(0, 0, activeTarget.w, activeTarget.h)
    gl.clear(gl.DEPTH_BUFFER_BIT)

    // 1A. 舞台台面
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

    // 1B. 多面体骰具渲染
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)

    gl.useProgram(this.diceProg.prog)
    const du = this.diceProg.u
    const styleSlot = isCuratedV2 ? (themeId - 6) : 4
    gl.uniformMatrix4fv(du.u_viewProj, false, this._viewProj)
    gl.uniform3f(du.u_camPos, camEye[0], camEye[1], camEye[2])
    gl.uniform1f(du.u_time, time)
    gl.uniform1i(du.u_theme, themeId)
    gl.uniform1i(du.u_tier, tierCode)
    gl.uniform1i(du.u_styleAtlasOffset, styleSlot * STYLE_TILE_STRIDE)
    gl.uniform1f(du.u_climax, climax)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    if (isPixelTheme) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    }
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
      gl.uniform1i(du.u_dieIndex, i)
      gl.uniform1i(du.u_winningFace, d.targetFace ? d.targetFace.index : 0)
      gl.uniform1i(du.u_maxFaceIdx, gpu.maxFaceIdx)
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

    if (isPixelTheme) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    }
    gl.disable(gl.CULL_FACE)

    // 1C. 轨迹丝带：典藏皮肤仅在版画墨丝(8)、黑漆金雾(9)、海琉璃水纹(11)绘制纤细游丝；黄铜/像素/包豪斯零冗余丝带
    if (!isCuratedV2) {
      gl.depthMask(false)
      gl.enable(gl.BLEND)
      if (themeId === 4) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      } else {
        gl.blendFunc(gl.ONE, gl.ONE)
      }
      this._drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode)
    } else if (themeId === 8 || themeId === 9 || themeId === 11) {
      gl.depthMask(false)
      gl.enable(gl.BLEND)
      if (themeId === 8) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      } else {
        gl.blendFunc(gl.ONE, gl.ONE)
      }
      this._drawSubtleCuratedTrails(dice, camEye, time, themeId)
    }

    // 1D. 粒子与微尘渲染
    if (isPixelTheme) {
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    } else {
      gl.depthMask(false)
      gl.enable(gl.BLEND)
      if (themeId === 8 || themeId === 9 || themeId === 10) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      } else {
        gl.blendFunc(gl.ONE, gl.ONE)
      }
    }
    this._drawParticlesAndPillars(particles, camEye, time)

    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)

    // ========================================================================
    // PASS 2: Dual-Kawase HDR Bloom（像素/版画/包豪斯严格零辉光糊边）
    // ========================================================================
    const isShuimo = themeId === 4
    const wantBloom = bloomEnabled && !isPixelTheme && themeId !== 8 && themeId !== 10
    const mips = this.fbos.bloomMips
    if (wantBloom && mips.length > 0 && mips[0]) {
      gl.useProgram(this.bloomDownProg.prog)
      gl.bindVertexArray(this.emptyVAO)
      const bdu = this.bloomDownProg.u
      gl.uniform1i(bdu.u_tex, 0)

      let srcTex = activeTarget.tex
      let srcW = activeTarget.w
      let srcH = activeTarget.h

      for (let i = 0; i < mips.length; i++) {
        const dst = mips[i]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, srcTex)
        gl.uniform2f(bdu.u_texelSize, 1.0 / srcW, 1.0 / srcH)
        gl.uniform1f(bdu.u_threshold, i === 0 ? (isCuratedV2 ? 1.15 : (isShuimo ? 1.25 : 1.18)) : -1.0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        srcTex = dst.tex
        srcW = dst.w
        srcH = dst.h
      }

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
        gl.uniform1f(buu.u_intensity, isCuratedV2 ? 0.72 : 0.85)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.disable(gl.BLEND)
    }

    // ========================================================================
    // PASS 3: 最终自适应合成输出
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.width, this.height)
    gl.useProgram(this.compositeProg.prog)
    const cu = this.compositeProg.u

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, activeTarget.tex)
    gl.uniform1i(cu.u_sceneTex, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, (wantBloom && mips[0]) ? mips[0].tex : activeTarget.tex)
    gl.uniform1i(cu.u_bloomTex, 1)

    const bloomStr = !wantBloom
      ? 0.0
      : isCuratedV2
        ? (themeId === 6 ? 0.16 : 0.24)
        : (isShuimo ? 0.35 : 0.52)

    gl.uniform2f(cu.u_resolution, this.width, this.height)
    gl.uniform2f(cu.u_sceneTexSize, activeTarget.w, activeTarget.h)
    gl.uniform1i(cu.u_theme, themeId)
    gl.uniform4f(cu.u_shockwave, shockwave[0], shockwave[1], shockwave[2], shockwave[3])
    gl.uniform1f(cu.u_chroma, chroma)
    gl.uniform1f(cu.u_bulletTime, bulletTime)
    gl.uniform1f(cu.u_bloomStrength, bloomStr)
    gl.uniform1f(cu.u_time, time)

    gl.bindVertexArray(this.emptyVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  _drawSubtleCuratedTrails(dice, camEye, time, themeId) {
    const buf = this.ribbonData
    let vCount = 0

    let cr = 0.85, cg = 0.65, cb = 0.28, ca = 0.35, widthScale = 0.28, inkMode = 3
    if (themeId === 8) {
      cr = 0.16; cg = 0.12; cb = 0.09; ca = 0.42; widthScale = 0.14; inkMode = 2
    } else if (themeId === 11) {
      cr = 0.45; cg = 0.82; cb = 0.88; ca = 0.32; widthScale = 0.24; inkMode = 3
    }

    const prev = { has: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, u: 0, a: 1 }

    for (let dIdx = 0; dIdx < dice.length; dIdx++) {
      const d = dice[dIdx]
      if (d.trailCount < 3 || d.settled) continue
      prev.has = false
      const n = d.trailCount

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
        const halfW = d.radius * widthScale * (1 - u * 0.85)
        sx = (sx / sLen) * halfW
        sy = (sy / sLen) * halfW
        sz = (sz / sLen) * halfW

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
    }

    if (vCount === 0) return
    const gl = this.gl
    gl.useProgram(this.ribbonProg.prog)
    gl.uniformMatrix4fv(this.ribbonProg.u.u_viewProj, false, this._viewProj)
    gl.uniform1f(this.ribbonProg.u.u_time, time)
    gl.uniform1i(this.ribbonProg.u.u_isInk, inkMode)

    gl.bindVertexArray(this.ribbonVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 9))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }

  _drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode) {
    const buf = this.ribbonData
    let vCount = 0

    let rCol = [2.6, 1.7, 0.45, 0.9]
    if (themeId === 1) rCol = [0.65, 2.2, 3.2, 0.95]
    else if (themeId === 2) rCol = [4.2, 1.25, 0.15, 0.95]
    else if (themeId === 3) rCol = [0.1, 2.5, 2.8, 0.92]
    else if (themeId === 4) rCol = [0.06, 0.07, 0.09, 0.88]
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

    for (let dIdx = 0; dIdx < dice.length; dIdx++) {
      const d = dice[dIdx]
      if (d.trailCount < 3) continue
      prev.has = false
      const n = d.trailCount

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

  _drawParticlesAndPillars(particles, camEye, time) {
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
      const pm = mode[i]
      let fade, sz
      if (pm > 0.5 && pm < 1.5) {
        fade = Math.sin(Math.min(1, p * 4.5) * Math.PI * 0.5) * Math.pow(1 - p, 1.35)
        sz = size[i] * (0.7 + 0.5 * p)
      } else if (pm >= 1.5 && pm < 3.5) {
        fade = 1.0
        sz = size[i] * (p > 0.7 ? (1 - (p - 0.7) / 0.3) : 1.0)
      } else {
        fade = 1 - p * p
        sz = size[i] * (pm >= 3.5 && pm < 4.5 ? (1 - p * 0.25) : (1 - p * 0.65))
      }
      const alpha = a[i] * fade
      if (alpha <= 0.005 || sz <= 0.05) continue

      const px = x[i], py = y[i], pz = z[i]
      const pvx = vx[i], pvy = vy[i], pvz = vz[i]
      const cr = r[i], cg = g[i], cb = b[i]

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
    gl.uniform1f(this.particleProg.u.u_time, time)

    gl.bindVertexArray(this.particleVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 14))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }
}

// ============================================================================
// 多媒介物理声学 & 8-Bit 复古芯片合成音效引擎
// ============================================================================

const CURATED_SOUND_PRESETS = new Set(['atelier', 'pixel', 'etching', 'urushi', 'bauhaus', 'murano'])

class ProceduralDiceAudio {
  constructor() {
    this.ctx = null
    this.enabled = true
    this.masterGain = null
    this.noiseBuffer = null
    this.lastBounceAt = 0
    this.activeVoices = 0
    this.chargeOsc = null
    this.chargeSubOsc = null
    this.chargeGain = null
    this._chargePreset = 'atelier'
    this._chargeMode = 'normal'
    this.lastRattleAt = 0
  }

  ensureContext() {
    if (!this.enabled) return null
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0.38
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
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.38 : 0, this.ctx.currentTime, 0.02)
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

  startChargeHum(preset = 'atelier', mode = 'normal') {
    const ctx = this.ensureContext()
    if (!ctx || this.chargeOsc) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    const m = mode || 'normal'
    this._chargePreset = preset
    this._chargeMode = m

    if (preset === 'pixel') {
      osc.type = 'square'
      osc.frequency.setValueAtTime(m === 'push' ? 82.41 : (m === 'fate' ? 196.0 : 130.81), now)
      g.gain.setValueAtTime(0.001, now)
      g.gain.linearRampToValueAtTime(0.045, now + 0.12)
    } else if (CURATED_SOUND_PRESETS.has(preset)) {
      if (m === 'push') {
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(58, now)
      } else if (m === 'fate') {
        osc.type = 'sine'
        osc.frequency.setValueAtTime(174.61, now)
      } else {
        osc.type = preset === 'bauhaus' ? 'triangle' : 'sine'
        osc.frequency.setValueAtTime(88, now)
      }
      g.gain.setValueAtTime(0.001, now)
      g.gain.linearRampToValueAtTime(0.068, now + 0.12)
    } else {
      osc.type = preset === 'cyber' ? 'sawtooth' : (preset === 'inferno' || m === 'push') ? 'triangle' : 'sine'
      osc.frequency.setValueAtTime(m === 'push' ? 62 : (m === 'fate' ? 185 : 95), now)
      g.gain.setValueAtTime(0.001, now)
      g.gain.linearRampToValueAtTime(0.09, now + 0.12)
    }
    osc.connect(g)
    g.connect(this.masterGain)
    osc.start(now)

    let subOsc = null
    if (m === 'fate' && preset !== 'pixel') {
      subOsc = ctx.createOscillator()
      const sg = ctx.createGain()
      subOsc.type = 'sine'
      subOsc.frequency.setValueAtTime(CURATED_SOUND_PRESETS.has(preset) ? 261.63 : 277.18, now)
      sg.gain.setValueAtTime(0.45, now)
      subOsc.connect(sg)
      sg.connect(g)
      subOsc.start(now)
    } else if (m === 'push' && preset !== 'pixel') {
      subOsc = ctx.createOscillator()
      const sg = ctx.createGain()
      subOsc.type = 'sawtooth'
      subOsc.frequency.setValueAtTime(60.5, now)
      sg.gain.setValueAtTime(0.22, now)
      subOsc.connect(sg)
      sg.connect(g)
      subOsc.start(now)
    }

    this.chargeOsc = osc
    this.chargeSubOsc = subOsc
    this.chargeGain = g
  }

  updateChargeHum(charge01) {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    const c = Math.max(0, Math.min(1, charge01))
    const m = this._chargeMode || 'normal'
    if (this._chargePreset === 'pixel') {
      const base = m === 'push' ? 82.41 : (m === 'fate' ? 196.0 : 130.81)
      const steps = m === 'fate' ? Math.floor(c * 14) : Math.floor(c * 10)
      const stepFreq = base * Math.pow(2, steps / 12)
      this.chargeOsc.frequency.setValueAtTime(stepFreq, now)
      this.chargeGain.gain.setTargetAtTime(0.038 + c * 0.045, now, 0.03)
    } else if (m === 'fate') {
      const f = (CURATED_SOUND_PRESETS.has(this._chargePreset) ? 174.61 : 185) + c * 225
      this.chargeOsc.frequency.setTargetAtTime(f, now, 0.04)
      if (this.chargeSubOsc) this.chargeSubOsc.frequency.setTargetAtTime(f * 1.498, now, 0.04)
      this.chargeGain.gain.setTargetAtTime(0.038 + c * 0.08, now, 0.04)
    } else if (m === 'push') {
      const f = (CURATED_SOUND_PRESETS.has(this._chargePreset) ? 58 : 62) + c * c * 125
      this.chargeOsc.frequency.setTargetAtTime(f, now, 0.03)
      if (this.chargeSubOsc) this.chargeSubOsc.frequency.setTargetAtTime(f * 1.04 + c * 6, now, 0.03)
      this.chargeGain.gain.setTargetAtTime(0.042 + c * 0.09, now, 0.03)
    } else if (CURATED_SOUND_PRESETS.has(this._chargePreset)) {
      this.chargeOsc.frequency.setTargetAtTime(88 + c * 175, now, 0.04)
      this.chargeGain.gain.setTargetAtTime(0.03 + c * 0.07, now, 0.04)
    } else {
      this.chargeOsc.frequency.setTargetAtTime(95 + c * 240, now, 0.04)
      this.chargeGain.gain.setTargetAtTime(0.04 + c * 0.11, now, 0.04)
    }
  }

  stopChargeHum() {
    if (!this.chargeOsc || !this.ctx) return
    const now = this.ctx.currentTime
    try {
      this.chargeGain.gain.cancelScheduledValues(now)
      this.chargeGain.gain.setTargetAtTime(0.0001, now, 0.025)
      this.chargeOsc.stop(now + 0.1)
      if (this.chargeSubOsc) this.chargeSubOsc.stop(now + 0.1)
    } catch {}
    this.chargeOsc = null
    this.chargeSubOsc = null
    this.chargeGain = null
  }

  playChargeRattle(preset = 'atelier', intensity = 0.5) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastRattleAt < 0.042 || this.activeVoices >= 8) return
    this.lastRattleAt = now
    const amp = Math.min(1, Math.max(0.15, intensity))
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    const jitter = 0.92 + Math.random() * 0.18
    if (preset === 'pixel') {
      osc.type = 'square'
      osc.frequency.setValueAtTime((520 + amp * 280) * jitter, now)
      g.gain.setValueAtTime(0.032 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.022)
      osc.connect(g); g.connect(this.masterGain)
      osc.start(now); osc.stop(now + 0.025)
      return
    }
    osc.type = (preset === 'bauhaus' || preset === 'cyber') ? 'triangle' : 'sine'
    const baseF = preset === 'atelier' ? 1860 : (preset === 'murano' || preset === 'prism') ? 2150 : preset === 'urushi' ? 1240 : 1080
    osc.frequency.setValueAtTime(baseF * jitter, now)
    osc.frequency.exponentialRampToValueAtTime(baseF * 0.58, now + 0.026)
    g.gain.setValueAtTime(0.042 * amp, now)
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.03)
    osc.connect(g)
    this._connectPanned(g, (Math.random() - 0.5) * 0.5)
    osc.start(now)
    osc.stop(now + 0.034)
  }

  playFateApexChime(preset = 'atelier', power = 0.5) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    const p = Math.max(0.2, Math.min(1, power))
    if (preset === 'pixel') {
      const notes = [659.25, 987.77, 1318.5]
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(f, now + i * 0.032)
        g.gain.setValueAtTime(0.048 * p, now + i * 0.032)
        g.gain.exponentialRampToValueAtTime(0.0008, now + i * 0.032 + 0.14)
        osc.connect(g); g.connect(this.masterGain)
        osc.start(now + i * 0.032); osc.stop(now + i * 0.032 + 0.15)
      })
      return
    }
    const o1 = ctx.createOscillator()
    const o2 = ctx.createOscillator()
    const g = ctx.createGain()
    o1.type = 'sine'; o2.type = 'sine'
    const root = (preset === 'urushi' || preset === 'jianxin') ? 587.33 : (preset === 'murano' || preset === 'prism') ? 783.99 : 659.25
    o1.frequency.setValueAtTime(root, now)
    o2.frequency.setValueAtTime(root * 1.5, now)
    g.gain.setValueAtTime(0.001, now)
    g.gain.linearRampToValueAtTime(0.068 * (0.65 + p * 0.45), now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.36)
    o1.connect(g); o2.connect(g)
    g.connect(this.masterGain)
    o1.start(now); o2.start(now)
    o1.stop(now + 0.38); o2.stop(now + 0.38)
  }

  playThrowWhoosh(preset = 'atelier', power = 1.0, mode = 'normal') {
    this.stopChargeHum()
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    const pwr = Math.max(0.6, Math.min(1.8, Number(power) || 1.0))

    if (preset === 'pixel') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      if (mode === 'push') {
        osc.frequency.setValueAtTime(440 * pwr * 0.85, now)
        osc.frequency.exponentialRampToValueAtTime(73.42, now + 0.11)
      } else if (mode === 'fate') {
        osc.frequency.setValueAtTime(220, now)
        osc.frequency.setValueAtTime(329.63, now + 0.03)
        osc.frequency.setValueAtTime(523.25, now + 0.065)
        osc.frequency.setValueAtTime(659.25, now + 0.10)
      } else {
        osc.frequency.setValueAtTime(196, now)
        osc.frequency.setValueAtTime(293.66, now + 0.035)
        osc.frequency.setValueAtTime(440 * Math.min(1.3, pwr), now + 0.07)
      }
      g.gain.setValueAtTime(0.075 * Math.min(1.25, pwr), now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
      osc.connect(g)
      g.connect(this.masterGain)
      osc.start(now)
      osc.stop(now + 0.15)
      return
    }

    if (mode === 'push') {
      const slam = ctx.createOscillator()
      const sg = ctx.createGain()
      slam.type = 'sine'
      slam.frequency.setValueAtTime(155 * Math.min(1.3, pwr), now)
      slam.frequency.exponentialRampToValueAtTime(42, now + 0.12)
      sg.gain.setValueAtTime(0.16 * Math.min(1.4, pwr), now)
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
      slam.connect(sg); sg.connect(this.masterGain)
      slam.start(now); slam.stop(now + 0.15)
    }

    if (!this.noiseBuffer) return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()

    if (CURATED_SOUND_PRESETS.has(preset)) {
      filter.type = 'bandpass'
      const baseFreq = preset === 'murano' ? 1200 : preset === 'bauhaus' ? 980 : 540
      if (mode === 'fate') {
        filter.frequency.setValueAtTime(baseFreq * 0.45, now)
        filter.frequency.exponentialRampToValueAtTime(baseFreq * (1.85 + pwr * 0.45), now + 0.18)
      } else if (mode === 'push') {
        filter.frequency.setValueAtTime(baseFreq * (1.65 + pwr * 0.45), now)
        filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.32, now + 0.15)
      } else {
        filter.frequency.setValueAtTime(baseFreq * 0.6, now)
        filter.frequency.exponentialRampToValueAtTime(baseFreq * (1.4 + pwr * 0.4), now + 0.07)
        filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.4, now + 0.22)
      }
      filter.Q.value = 2.6
      gain.gain.setValueAtTime(0.001, now)
      gain.gain.linearRampToValueAtTime(0.11 * Math.min(1.45, pwr), now + 0.035)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      src.connect(filter)
      filter.connect(gain)
      gain.connect(this.masterGain)
      src.start(now)
      src.stop(now + 0.24)
      return
    }

    filter.type = preset === 'cyber' ? 'bandpass' : 'lowpass'
    const baseFreq = preset === 'prism' ? 1550 : preset === 'inferno' ? 360 : 760
    if (mode === 'fate') {
      filter.frequency.setValueAtTime(baseFreq * 0.45, now)
      filter.frequency.exponentialRampToValueAtTime(baseFreq * (2.1 + pwr * 0.5), now + 0.18)
    } else if (mode === 'push') {
      filter.frequency.setValueAtTime(baseFreq * (1.9 + pwr * 0.5), now)
      filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.32, now + 0.16)
    } else {
      filter.frequency.setValueAtTime(baseFreq * 0.5, now)
      filter.frequency.exponentialRampToValueAtTime(baseFreq * (1.9 + pwr * 0.6), now + 0.08)
      filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.35, now + 0.26)
    }
    filter.Q.value = preset === 'jianxin' ? 5.2 : 2.2

    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.18 * Math.min(1.45, pwr), now + 0.04)
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

  playBounce(preset = 'atelier', strength = 0.6, pan = 0) {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBounceAt < 0.016 || this.activeVoices >= 8) return
    this.lastBounceAt = now
    this.activeVoices++

    const amp = Math.min(1, Math.max(0.08, strength))
    const jitter = 0.94 + Math.random() * 0.14

    if (preset === 'pixel') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      const f = (330 + Math.round(amp * 3) * 110) * (Math.random() > 0.5 ? 1 : 1.125)
      osc.frequency.setValueAtTime(f, now)
      osc.frequency.setValueAtTime(f * 0.5, now + 0.025)
      g.gain.setValueAtTime(0.095 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.055)
      osc.connect(g)
      this._connectPanned(g, pan)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.06)
      return
    }

    if (preset === 'atelier') {
      const thud = ctx.createOscillator()
      const tg = ctx.createGain()
      thud.type = 'sine'
      thud.frequency.setValueAtTime(135 * jitter, now)
      thud.frequency.exponentialRampToValueAtTime(46, now + 0.075)
      tg.gain.setValueAtTime(0.26 * amp, now)
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.085)
      thud.connect(tg)
      this._connectPanned(tg, pan)

      const bell = ctx.createOscillator()
      const bg = ctx.createGain()
      bell.type = 'sine'
      bell.frequency.setValueAtTime(2180 * jitter, now)
      bg.gain.setValueAtTime(0.055 * amp * amp, now)
      bg.gain.exponentialRampToValueAtTime(0.0008, now + 0.09)
      bell.connect(bg)
      this._connectPanned(bg, pan)

      thud.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      thud.start(now); bell.start(now)
      thud.stop(now + 0.09); bell.stop(now + 0.095)
      return
    }

    if (preset === 'bauhaus') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(1920 * jitter, now)
      osc.frequency.exponentialRampToValueAtTime(620, now + 0.028)
      g.gain.setValueAtTime(0.18 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.034)
      osc.connect(g)
      this._connectPanned(g, pan)
      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.038)
      return
    }

    if (preset === 'murano') {
      const o1 = ctx.createOscillator()
      const o2 = ctx.createOscillator()
      const g = ctx.createGain()
      o1.type = 'sine'; o2.type = 'sine'
      const f0 = 1360 * jitter
      o1.frequency.setValueAtTime(f0, now)
      o2.frequency.setValueAtTime(f0 * 2.58, now)
      g.gain.setValueAtTime(0.15 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16)
      o1.connect(g); o2.connect(g)
      this._connectPanned(g, pan)
      o1.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      o1.start(now); o2.start(now)
      o1.stop(now + 0.17); o2.stop(now + 0.17)
      return
    }

    if (preset === 'urushi' || preset === 'etching') {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      const base = preset === 'urushi' ? 880 : 560
      osc.frequency.setValueAtTime(base * jitter, now)
      osc.frequency.exponentialRampToValueAtTime(base * 0.52, now + 0.048)
      g.gain.setValueAtTime(0.20 * amp, now)
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.055)
      osc.connect(g)
      this._connectPanned(g, pan)

      if (this.noiseBuffer) {
        const nSrc = ctx.createBufferSource()
        nSrc.buffer = this.noiseBuffer
        const nf = ctx.createBiquadFilter()
        nf.type = 'bandpass'
        nf.frequency.value = preset === 'urushi' ? 2600 * jitter : 1450 * jitter
        nf.Q.value = 4.5
        const ng = ctx.createGain()
        ng.gain.setValueAtTime(0.12 * amp, now)
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.024)
        nSrc.connect(nf); nf.connect(ng)
        this._connectPanned(ng, pan)
        nSrc.start(now); nSrc.stop(now + 0.028)
      }

      osc.onended = () => { this.activeVoices = Math.max(0, this.activeVoices - 1) }
      osc.start(now); osc.stop(now + 0.06)
      return
    }

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

  playSettle(preset = 'atelier', tier = 'success') {
    const ctx = this.ensureContext()
    if (!ctx) return
    const now = ctx.currentTime

    if (preset === 'pixel') {
      let notes = [523.25, 659.25, 783.99]
      if (tier === 'critical') notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      else if (tier === 'costly') notes = [440, 523.25, 659.25]
      else if (tier === 'failure') notes = [392.0, 349.23, 311.13]
      else if (tier === 'fumble') notes = [311.13, 277.18, 246.94, 185.0]

      notes.forEach((freq, i) => {
        const t0 = now + i * 0.048
        const dur = i === notes.length - 1 ? 0.24 : 0.055
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(freq, t0)
        g.gain.setValueAtTime(0.075, t0)
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
        osc.connect(g)
        g.connect(this.masterGain)
        osc.start(t0)
        osc.stop(t0 + dur + 0.01)
      })
      return
    }

    if (CURATED_SOUND_PRESETS.has(preset)) {
      let notes = preset === 'urushi' ? [440, 587.33] : [440, 554.37]
      if (tier === 'critical') {
        notes = preset === 'urushi'
          ? [440, 493.88, 587.33, 659.25, 880]
          : [440, 554.37, 659.25, 880]
      } else if (tier === 'costly') {
        notes = [392.0, 466.16, 587.33]
      } else if (tier === 'failure') {
        notes = [329.63, 293.66]
      } else if (tier === 'fumble') {
        notes = [246.94, 207.65, 164.81]
      }

      const wave = preset === 'etching' ? 'triangle' : 'sine'
      const pitchMul = preset === 'murano' ? 1.25 : preset === 'atelier' ? 0.85 : 1.0

      notes.forEach((freq, i) => {
        const t0 = now + i * (preset === 'bauhaus' ? 0.038 : 0.065)
        const dur = preset === 'bauhaus' ? 0.18 : (tier === 'critical' ? 0.52 : 0.32)
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = wave
        osc.frequency.setValueAtTime(freq * pitchMul, t0)
        g.gain.setValueAtTime(0.001, t0)
        g.gain.linearRampToValueAtTime(preset === 'bauhaus' ? 0.065 : 0.085, t0 + 0.015)
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
        osc.connect(g)
        g.connect(this.masterGain)
        osc.start(t0)
        osc.stop(t0 + dur + 0.02)
      })
      return
    }

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
    id: 'atelier',
    themeIndex: 6,
    name: '绅士赌桌 · 胡桃木与古董黄铜',
    subtitle: 'Walnut & Patina Brass',
    badge: '胡桃木 · 车削黄铜',
    desc: '北美黑胡桃木实木托盘与英式精纺墨绿呢绒，手工车削做旧拉丝黄铜骰与猛犸骨瓷骰同台磕碰。',
    accent: '#d4a853',
    swatch: 'radial-gradient(circle at 35% 30%, #2b593f 0%, #102a1d 60%, #2a180d 100%)',
    soundPreset: 'atelier'
  },
  {
    id: 'pixel',
    themeIndex: 7,
    name: '勇者地牢 · 16-Bit 黄金像素',
    subtitle: '16-Bit Sovereign Pixel',
    badge: '整数像素 · Bayer 抖动',
    desc: '原生低分整数像素栅格、4×4 Bayer 有序网点抖动、1px 纯黑像素外轮廓与手工 8-Bit 点阵字模，配像素方块烟尘与芯片方波琶音。',
    accent: '#f2b63d',
    swatch: 'linear-gradient(135deg, #211d38 0%, #3d335c 52%, #d99b26 100%)',
    soundPreset: 'pixel'
  },
  {
    id: 'etching',
    themeIndex: 8,
    name: '达芬奇手稿 · 羊皮纸铜版蚀刻',
    subtitle: 'Codex Vellum & Etching',
    badge: '古羊皮纸 · 钢笔排线',
    desc: '暖象牙小牛羊皮纸与圆规几何作图线，背光面实时解算为三层铁胆墨水交叉钢笔排线与 45° 斜排线投射阴影，古典朱砂红墨点睛。',
    accent: '#b63526',
    swatch: 'linear-gradient(135deg, #efe2c8 0%, #d4c19c 62%, #7a291e 100%)',
    soundPreset: 'etching'
  },
  {
    id: 'urushi',
    themeIndex: 9,
    name: '京都黑漆 · 螺钿金泥莳绘',
    subtitle: 'Kyoto Urushi & Raden',
    badge: '镜面黑漆 · 螺钿莳绘',
    desc: '寒潭镜面黑吕色推光大漆茶盘实时倒映正朱砂漆与乌漆骰影，棱边镶嵌天然夜光贝螺钿微虹切片，空中缓落 24K 纯金箔碎叶。',
    accent: '#c93b2b',
    swatch: 'radial-gradient(circle at 40% 35%, #8f1d14 0%, #1c1212 58%, #070506 100%)',
    soundPreset: 'urushi'
  },
  {
    id: 'bauhaus',
    themeIndex: 10,
    name: '包豪斯白瓷 · 博朗信号橙',
    subtitle: 'Braun & Ceramic Atelier',
    badge: '哑光白瓷 · 信号橙',
    desc: '浅灰微喷砂瑞士网格建筑台面配哑光氧化锆白瓷与深石墨铝骰，唯最高点面点缀博朗国际信号橙。',
    accent: '#ff4f00',
    swatch: 'linear-gradient(135deg, #f4f3ef 0%, #cfcdc6 65%, #ff4f00 100%)',
    soundPreset: 'bauhaus'
  },
  {
    id: 'murano',
    themeIndex: 11,
    name: '深海星仪 · 威尼斯折射海琉璃',
    subtitle: 'Murano Sea-Glass & Silver',
    badge: '海琉璃 · 斯涅尔折射',
    desc: '深普鲁士天然板岩镶嵌 925 纯银偏心星盘，微磨砂冰青海琉璃依斯涅尔定律实时折射弯曲下方银丝星轨，投下清透水色焦散。',
    accent: '#78cad2',
    swatch: 'radial-gradient(circle at 35% 30%, #4ea8b4 0%, #14364a 58%, #08131f 100%)',
    soundPreset: 'murano'
  },
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

const THEME_BY_ID = Object.freeze(
  Object.fromEntries(NEXTGEN_THEMES.map(item => [item.id, item]))
)

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

const SEAL_CODE_BY_TIER = {
  normal: 'SETTLED',
  critical: 'CRITICAL',
  success: 'SUCCESS',
  costly: 'PARTIAL',
  failure: 'FAILURE',
  fumble: 'FUMBLE'
}

function drawCuratedSignatureOverlay(ctx, { v2Index, tier, total = 0, settleTime, sx, sy, scaleMul = 1, fadeStart = 1.9, pinSettled = false }) {
  const word = SEAL_TEXT_BY_TIER[tier] || '成功'
  const code = SEAL_CODE_BY_TIER[tier] || 'SUCCESS'
  const appear = Math.min(1, settleTime / 0.22)
  const easeOut = 1 - Math.pow(1 - appear, 3)
  const fade = (!pinSettled && settleTime > fadeStart) ? Math.max(0, 1 - (settleTime - fadeStart) / 0.65) : 1.0
  if (fade <= 0.01) return

  const totalText = total !== undefined && total !== null && total !== '' ? String(total) : ''

  ctx.save()
  ctx.translate(sx, sy + (1 - easeOut) * 6)
  ctx.scale(scaleMul * (0.94 + 0.06 * easeOut), scaleMul * (0.94 + 0.06 * easeOut))
  ctx.globalAlpha = easeOut * fade

  if (v2Index === 0) {
    // [atelier] 绅士赌桌：英伦压花拉丝黄铜乌木铭牌
    const w = 114, h = 44
    ctx.fillStyle = 'rgba(22, 15, 10, 0.92)'
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, 4)
    ctx.fill()

    ctx.strokeStyle = '#c89d4c'
    ctx.lineWidth = 1.4
    ctx.stroke()

    ctx.strokeStyle = 'rgba(200, 157, 76, 0.42)'
    ctx.lineWidth = 0.8
    ctx.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8)

    ctx.fillStyle = '#d9b366'
    ctx.beginPath()
    ctx.arc(-w / 2 + 9, 0, 1.8, 0, Math.PI * 2)
    ctx.arc(w / 2 - 9, 0, 1.8, 0, Math.PI * 2)
    ctx.fill()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = tier === 'critical' ? '#f5d589' : (tier === 'fumble' ? '#e08a7e' : '#ebd7b2')
    ctx.font = '700 15px "Georgia", "Songti SC", "Noto Serif SC", serif'
    ctx.fillText(word, 0, -4)
    ctx.fillStyle = 'rgba(217, 179, 102, 0.68)'
    ctx.font = '600 9px "Georgia", serif'
    ctx.fillText(totalText ? `ATELIER · ${totalText}` : 'ATELIER', 0, 11)
  } else if (v2Index === 1) {
    // [pixel] 勇者地牢：16-Bit JRPG 宝蓝底双白像素窗口
    ctx.imageSmoothingEnabled = false
    const w = 118, h = 44
    const x0 = -Math.round(w / 2), y0 = -Math.round(h / 2)
    ctx.fillStyle = '#0e0b16'
    ctx.fillRect(x0 - 3, y0, w + 6, h)
    ctx.fillRect(x0, y0 - 3, w, h + 6)
    ctx.fillStyle = tier === 'critical' ? '#ffd84d' : (tier === 'fumble' ? '#ff5978' : '#f4f1ea')
    ctx.fillRect(x0, y0, w, h)
    ctx.fillStyle = '#182452'
    ctx.fillRect(x0 + 3, y0 + 3, w - 6, h - 6)
    ctx.fillStyle = '#101738'
    ctx.fillRect(x0 + 3, y0 + Math.round(h * 0.52), w - 6, Math.round(h * 0.48) - 3)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = tier === 'critical' ? '#ffe46b' : '#ffffff'
    ctx.font = '700 14px ui-monospace, "Courier New", "PingFang SC", monospace'
    ctx.fillText(`▸ ${word}`, 0, -4)
    ctx.fillStyle = '#8fa8ff'
    ctx.font = '700 9.5px ui-monospace, "Courier New", monospace'
    ctx.fillText(totalText ? `${code} [${totalText}]` : code, 0, 11)
  } else if (v2Index === 2) {
    // [etching] 达芬奇手稿：文艺复兴羊皮纸细墨双框古典铭签
    const w = 116, h = 46
    ctx.fillStyle = 'rgba(242, 231, 209, 0.94)'
    ctx.fillRect(-w / 2, -h / 2, w, h)

    ctx.strokeStyle = '#2b2119'
    ctx.lineWidth = 1.3
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.lineWidth = 0.7
    ctx.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8)

    ctx.fillStyle = '#b63526'
    for (const [dx, dy] of [[-w / 2 + 4, -h / 2 + 4], [w / 2 - 4, -h / 2 + 4], [-w / 2 + 4, h / 2 - 4], [w / 2 - 4, h / 2 - 4]]) {
      ctx.fillRect(dx - 1.5, dy - 1.5, 3, 3)
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = (tier === 'critical' || tier === 'fumble') ? '#a8281c' : '#241b14'
    ctx.font = 'italic 700 15px "Palatino Linotype", "Georgia", "Songti SC", serif'
    ctx.fillText(word, 0, -4)
    ctx.fillStyle = '#6b5744'
    ctx.font = 'italic 600 9.5px "Georgia", serif'
    ctx.fillText(totalText ? `FIG. ${totalText} · ${code}` : code, 0, 11)
  } else if (v2Index === 3) {
    // [urushi] 京都黑漆：青田石金石篆刻朱文方印
    const s = 54
    ctx.rotate(-0.035)
    ctx.fillStyle = '#9c1e16'
    ctx.beginPath()
    ctx.roundRect(-s / 2, -s / 2, s, s, 2.5)
    ctx.fill()

    ctx.strokeStyle = '#f6ece0'
    ctx.lineWidth = 1.8
    ctx.strokeRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8)
    ctx.fillStyle = '#9c1e16'
    ctx.fillRect(-s / 2 + 3, -8, 3, 5)
    ctx.fillRect(s / 2 - 6, 9, 3, 4)

    ctx.fillStyle = '#faf2e6'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (word.length <= 2) {
      ctx.font = '800 19px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(word[0], 0, -10)
      ctx.fillText(word[1] || '印', 0, 11)
    } else if (word.length === 3) {
      ctx.font = '800 14.5px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(word[0], 0, -14)
      ctx.fillText(word[1], 0, 0)
      ctx.fillText(word[2], 0, 14)
    } else {
      ctx.font = '800 13.5px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
      ctx.fillText(word.slice(0, 2), 0, -8)
      ctx.fillText(word.slice(2), 0, 10)
    }
  } else if (v2Index === 4) {
    // [bauhaus] 包豪斯白瓷：瑞士国际主义工业设计规格标签
    const w = 120, h = 44
    ctx.fillStyle = 'rgba(250, 249, 246, 0.96)'
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeStyle = 'rgba(24, 24, 26, 0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(-w / 2, -h / 2, w, h)

    ctx.fillStyle = tier === 'fumble' ? '#cc2424' : '#ff4f00'
    ctx.fillRect(-w / 2, -h / 2, 5, h)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#686a70'
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(totalText ? `${code} // ${totalText.padStart(2, '0')}` : code, -w / 2 + 13, -9)

    ctx.fillStyle = '#141517'
    ctx.font = '700 14.5px "Inter", "Helvetica Neue", "PingFang SC", sans-serif'
    ctx.fillText(word, -w / 2 + 13, 8)
  } else {
    // [murano] 深海星仪：925 纯银天球仪弦弧标
    const w = 118, h = 44
    ctx.fillStyle = 'rgba(10, 22, 34, 0.88)'
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, 22)
    ctx.fill()

    ctx.strokeStyle = 'rgba(186, 218, 232, 0.72)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.strokeStyle = 'rgba(120, 202, 210, 0.35)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 18)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#eef8fc'
    ctx.font = '600 15px "Garamond", "Georgia", "Songti SC", serif'
    ctx.fillText(`✦ ${word} ✦`, 0, -4)
    ctx.fillStyle = 'rgba(148, 212, 222, 0.78)'
    ctx.font = '600 9px "Georgia", serif'
    ctx.fillText(totalText ? `MURANO · ${totalText}` : 'MURANO', 0, 11)
  }

  ctx.restore()
}

function drawThemeSealOverlay(ctx, { themeIndex, tier, total = 0, settleTime, sx, sy, scaleMul = 1, fadeStart = 1.9, pinSettled = false }) {
  if (themeIndex >= 6) {
    drawCuratedSignatureOverlay(ctx, {
      v2Index: themeIndex - 6,
      tier,
      total,
      settleTime,
      sx,
      sy,
      scaleMul,
      fadeStart,
      pinSettled
    })
    return
  }

  const sealWord = SEAL_TEXT_BY_TIER[tier] || '成功'
  const slamT = Math.min(1, settleTime / 0.14)
  const scale = (slamT < 1 ? (2.1 - 1.1 * slamT) : 1.0) * scaleMul
  const fade = (!pinSettled && settleTime > fadeStart) ? Math.max(0, 1 - (settleTime - fadeStart) / 0.65) : 1.0
  const horizFontSize = sealWord.length >= 4 ? 19 : (sealWord.length === 3 ? 23 : 26)

  ctx.save()
  ctx.translate(sx, sy)
  ctx.scale(scale, scale)
  ctx.globalAlpha = fade * 0.94

  if (themeIndex === 4) {
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
const MAX_STEPS = 380
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
  out[3] = aw * wa + bw * wb
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
    this.pinSettled = Boolean(options.pinSettled)

    this.theme = THEME_BY_ID.atelier
    this.quality = 'ultra'
    this.usePipsForD6 = false
    this.cinematicCamEnabled = !this.compactMode

    this.cssW = 800
    this.cssH = 520
    this.dpr = 1

    this.running = false
    this.rafId = 0
    this.clock = 0
    this.lastNow = 0
    this.frameTimes = new Float32Array(60)
    this.ftCursor = 0
    this.fpsAccum = 0
    this.fpsFrames = 0
    this.fps = 60

    this.dice = []
    this.tier = 'success'
    this.mode = 'normal'
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

    this.charging = false
    this.buttonCharging = false
    this.chargeMode = 'normal'
    this.chargeTime = 0
    this.lastChargePower = 0
    this.fateApexTime = 0.22
    this.fateApexChimePlayed = false
    this.fateSlowAmount = 0
    this.nextChargeRattleAt = 0
    this.chargeWorld = { x: 0, y: -40, z: 92 }
    this.dragHistory = []
    this.pendingSpecBuilder = options.buildSpecOnDragRelease || null

    this.baseEye = [0, -395, 435]
    this.camEye = [0, -395, 435]
    this.camTarget = [0, 8, 14]
    this.camFov = (38 * Math.PI) / 180
    this.shakeAmp = 0
    this.chroma = 0.06
    this.shockwave = [0.5, 0.5, 0, 0]
    this.shockAge = 99

    this.impacts = Array.from({ length: 8 }, () => ({ x: 0, y: 0, age: 0, strength: 0 }))
    this.impactCursor = 0
    this.bounceQueue = []
    this.bouncePlayCursor = 0

    this.slashes = Array.from({ length: 8 }, () => ({
      active: false, cx: 0, cy: 0, cz: 20, radius: 90, tilt: 0.4, angle: 0, width: 10, age: 0, life: 0.6, r: 1, g: 1, b: 1
    }))
    this.slashCursor = 0

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
      mode: new Float32Array(PARTICLE_CAP)
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

  startButtonCharge(modeHint = 'normal') {
    if (this.charging) return
    this.themeBeforeCharge = this.theme
    if (this.theme && this.theme.id === 'astral') {
      if (modeHint === 'fate') this.setTheme(THEME_BY_ID.prism)
      else if (modeHint === 'push') this.setTheme(THEME_BY_ID.inferno)
    }
    if (!this.dice || this.dice.length === 0) {
      this.setStaticRoll({ diceSpecs: [{ meshKey: 'd20', sides: 20, targetValue: 20 }], tier: 'success', mode: 'normal' })
    }
    const cm = modeHint === 'fate' || modeHint === 'push' ? modeHint : 'normal'
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      d._preChargeX = d.x; d._preChargeY = d.y; d._preChargeZ = d.z
      d._preChargeQx = d.qx; d._preChargeQy = d.qy; d._preChargeQz = d.qz; d._preChargeQw = d.qw
    }
    this.chargeMode = cm
    this.charging = true
    this.buttonCharging = true
    this.chargeTime = 0
    this.nextChargeRattleAt = 0.08
    if (cm === 'fate') {
      this.chargeWorld.x = 0
      this.chargeWorld.y = -4
      this.chargeWorld.z = 84
    } else if (cm === 'push') {
      this.chargeWorld.x = 0
      this.chargeWorld.y = -24
      this.chargeWorld.z = 94
    } else {
      this.chargeWorld.x = 0
      this.chargeWorld.y = -12
      this.chargeWorld.z = 88
    }
    if (this.audio) this.audio.startChargeHum(this.theme.soundPreset, cm)
    this.wake()
  }

  /**
   * 移出按钮取消蓄力：不消耗命运点或重投次数，平稳落回原状
   */
  cancelButtonCharge() {
    if (!this.charging) return
    this.charging = false
    this.buttonCharging = false
    this.chargeMode = 'normal'
    if (this.audio) this.audio.stopChargeHum()
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      if (d._preChargeX !== undefined) {
        d.x = d._preChargeX; d.y = d._preChargeY; d.z = d._preChargeZ
        d.qx = d._preChargeQx; d.qy = d._preChargeQy; d.qz = d._preChargeQz; d.qw = d._preChargeQw
      } else {
        const ep = (MAX_STEPS - 1) * 3
        const eq = (MAX_STEPS - 1) * 4
        d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
        d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
      }
      d.trailCount = 0
      d.settled = true
    }
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    this.settled = true
    // 无损取消：蓄力期间临时换上的逆命/熔炉主题必须还原，否则这张卡片会一直停留在熔炉皮肤
    if (this.themeBeforeCharge) {
      this.theme = this.themeBeforeCharge
      this.themeBeforeCharge = null
    }
    this.wake()
  }

  /**
   * 松开蓄力按钮：带着蓄力能量将悬停/剧颤中的骰群无缝爆发投向真骰结果！
   */
  releaseButtonCharge(spec, charge01 = 0.6) {
    const rawC = Number(charge01) || 0
    const power = rawC > 0.1 ? Math.max(0.18, Math.min(1, rawC)) : 0
    const activeMode = (spec && spec.mode && spec.mode !== 'normal')
      ? spec.mode
      : (this.chargeMode !== 'normal' ? this.chargeMode : ((spec && spec.mode) || 'normal'))
    const fromPositions = this.dice && this.dice.length
      ? this.dice.map(d => ({ x: d.x, y: d.y, z: d.z }))
      : null
    this.charging = false
    this.buttonCharging = false
    this.chargeMode = 'normal'
    this.themeBeforeCharge = null
    if (this.audio) this.audio.stopChargeHum()
    const enriched = {
      ...(spec || {}),
      mode: activeMode,
      chargePower: power,
      fromPositions
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
      if (this.mode === 'hidden' && !this.revealed && this.settled) {
        this.revealHidden()
        return
      }
      el.setPointerCapture(e.pointerId)
      const cm = this.mode === 'fate' || this.mode === 'push' ? this.mode : 'normal'
      this.chargeMode = cm
      this.charging = true
      this.buttonCharging = false
      this.chargeTime = 0
      this.nextChargeRattleAt = 0.08
      const wp = toWorld(e.clientX, e.clientY, 85)
      this.chargeWorld.x = Math.max(-210, Math.min(210, wp.x))
      this.chargeWorld.y = Math.max(-165, Math.min(165, wp.y))
      this.dragHistory = [{ x: this.chargeWorld.x, y: this.chargeWorld.y, t: performance.now() }]
      if (this.audio) this.audio.startChargeHum(this.theme.soundPreset, cm)
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
      const heldTime = this.chargeTime
      const fromPositions = this.dice.map(d => ({ x: d.x, y: d.y, z: d.z }))
      this.charging = false
      this.chargeMode = 'normal'
      if (this.audio) this.audio.stopChargeHum()

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
        const dragPower = Math.min(1, Math.max(0, (heldTime - 0.14) / 0.85))
        if (speed > 65) {
          spec.launchOrigin = { x: this.chargeWorld.x, y: this.chargeWorld.y, z: 95 + dragPower * 45 }
          spec.launchVelocity = { vx, vy }
          spec.chargePower = Math.max(0.25, dragPower)
          spec.fromPositions = fromPositions
        } else if (dragPower > 0.1) {
          spec.chargePower = dragPower
          spec.fromPositions = fromPositions
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
    p.mode[i] = opts.mode !== undefined ? opts.mode : (opts.pillar ? 1.0 : 0.0)
  }

  _spawnMediumAccentParticle(x, y, z, vx, vy, vz, scale = 1.0, preferStar = false) {
    const id = this.theme.themeIndex
    if (id < 6) {
      const col = this._themeHDRColor()
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: 2.6 * scale,
        life: 0.36 + Math.random() * 0.2,
        grav: preferStar ? 40 : 120,
        drag: 1.4,
        r: col[0], g: col[1], b: col[2], a: 0.92,
        mode: 0.0
      })
      return
    }
    const v2 = id - 6
    if (v2 === 1) {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (preferStar ? 6.0 : 4.5) * scale,
        life: 0.34 + Math.random() * 0.22,
        grav: preferStar ? 60 : 210, drag: 2.0,
        r: preferStar ? 1.0 : 0.92, g: preferStar ? 0.88 : 0.84, b: preferStar ? 0.28 : 0.72, a: 1.0,
        mode: preferStar ? 3.0 : 2.0
      })
    } else if (v2 === 3) {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (3.4 + Math.random() * 1.8) * scale,
        life: 0.75 + Math.random() * 0.4,
        grav: 46, drag: 2.2,
        r: 0.96, g: 0.78, b: 0.34, a: 0.92,
        mode: 4.0
      })
    } else if (v2 === 2) {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (1.9 + Math.random() * 1.2) * scale,
        life: 0.38 + Math.random() * 0.22,
        grav: preferStar ? 65 : 380, drag: 1.9,
        r: preferStar ? 0.70 : 0.16, g: preferStar ? 0.18 : 0.11, b: preferStar ? 0.13 : 0.08, a: 0.68,
        mode: 5.0
      })
    } else if (v2 === 4) {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (2.0 + Math.random() * 1.2) * scale,
        life: 0.36 + Math.random() * 0.2,
        grav: preferStar ? 55 : 320, drag: 2.0,
        r: 1.0, g: 0.31, b: 0.02, a: 0.72,
        mode: 5.0
      })
    } else if (v2 === 5) {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (2.1 + Math.random() * 1.5) * scale,
        life: 0.48 + Math.random() * 0.28,
        grav: 85, drag: 1.8,
        r: 0.66, g: 0.92, b: 0.98, a: 0.62,
        mode: 5.0
      })
    } else {
      this._spawnSpark({
        x, y, z, vx, vy, vz,
        size: (1.9 + Math.random() * 1.3) * scale,
        life: 0.50 + Math.random() * 0.3,
        grav: 50, drag: 2.3,
        r: 0.96, g: 0.79, b: 0.42, a: 0.44,
        mode: 5.0
      })
    }
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
   * 触发一次高精度真骰投掷（区分普通点按/长按、✦逆命重投点按/长按、🔥孤注一掷点按/长按）
   */
  throwDice(spec = {}) {
    /* pace < 1 = 慢镜投骰（正文中央的演出用它拉长整套投掷动作；胶囊/蓄力默认 1 保持原速） */
    this.simPace = Math.max(0.45, Math.min(1.6, Number(spec.pace) || 1))
    const diceSpecs = spec.diceSpecs && spec.diceSpecs.length
      ? spec.diceSpecs
      : [{ meshKey: 'd20', sides: 20, targetValue: 20 }]
    const count = diceSpecs.length

    const prevDiceSnap = (!spec.silentStatic && this.dice && this.dice.length)
      ? this.dice.map(d => ({ x: d.x, y: d.y, z: d.z }))
      : null

    if (!spec.silentStatic) {
      this.charging = false
      this.buttonCharging = false
      this.chargeMode = 'normal'
    }

    this.tier = spec.tier || 'success'
    this.mode = spec.mode || 'normal'
    this.revealed = false
    this.total = spec.total !== undefined ? spec.total : diceSpecs.reduce((s, d) => s + d.targetValue, 0)
    this.checkName = spec.checkName || '命运裁定'

    const power = spec.silentStatic ? 0 : Math.max(0, Math.min(1, Number(spec.chargePower) || 0))
    this.lastChargePower = power
    this.fateApexChimePlayed = false
    this.fateSlowAmount = 0

    // 清空上一轮瞬态残迹
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    for (const imp of this.impacts) { imp.strength = 0; imp._delay = 0 }
    for (const sl of this.slashes) sl.active = false
    this.shockAge = 99
    this.shockwave[3] = 0
    this.climax = 0
    this.bulletTimeAmount = 0
    this.bulletSoundPlayed = false

    const baseR = count <= 1 ? 42 : count <= 2 ? 37 : count <= 4 ? 31 : count <= 8 ? 25 : count <= 14 ? 20 : 16
    const aspect = this.cssW / Math.max(1, this.cssH)
    const boundX = Math.min(this.theaterMode ? 285 : 225, Math.max(92, 155 * aspect)) - baseR
    const boundY = (this.compactMode ? 88 : (this.theaterMode ? 124 : 138)) - baseR

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

      const radius = baseR * (ds.meshKey === 'd4' ? 1.12 : 1.0)
      const floorZ = radius * (ds.meshKey === 'd4' ? 0.52 : ds.meshKey === 'd6' || ds.meshKey === 'df' ? 0.62 : 0.76)
      const fromPos = !spec.silentStatic && spec.fromPositions && spec.fromPositions[i] ? spec.fromPositions[i] : null
      const prevPos = prevDiceSnap && prevDiceSnap[i] ? prevDiceSnap[i] : null

      let startX, startY, startZ, vx, vy, vz, wx, wy, wz

      if (spec.launchOrigin && spec.launchVelocity) {
        const spreadA = (i / Math.max(1, count)) * Math.PI * 2
        const spreadR = count > 1 ? 18 + (i % 3) * 10 : 0
        startX = fromPos ? fromPos.x : spec.launchOrigin.x + Math.cos(spreadA) * spreadR
        startY = fromPos ? fromPos.y : spec.launchOrigin.y + Math.sin(spreadA) * spreadR
        startZ = fromPos ? Math.max(floorZ + 20, fromPos.z) : spec.launchOrigin.z + (i % 4) * 12
        vx = spec.launchVelocity.vx + (Math.random() - 0.5) * 90
        vy = spec.launchVelocity.vy + (Math.random() - 0.5) * 90
        vz = this.mode === 'push' ? -(260 + power * 420) : (130 + Math.random() * 115)
        const spinMul = 1.0 + power * 1.25
        wx = (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 12) * spinMul
        wy = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12) * spinMul
        wz = (Math.random() - 0.5) * 18 * spinMul
      } else if (!spec.silentStatic && this.mode === 'fate') {
        // ✦ 逆命重投专属动作：拔地反重力升天 -> 穹顶时停凝滞翻转 -> 天命钦定落座！
        const ringR = count === 1
          ? 0
          : (this.theaterMode
            ? baseR * (1.0 + Math.sqrt(count) * 0.48)
            : Math.min(boundX * 0.46, baseR * (1.28 + Math.sqrt(count) * 0.54)))
        const slotA = (i / count) * Math.PI * 2 + Math.PI * 0.25
        const aimX = Math.cos(slotA) * ringR * 0.88
        const aimY = Math.sin(slotA) * ringR * 0.66 + 2

        if (power > 0) {
          const fallbackA = (i / Math.max(1, count)) * Math.PI * 2
          const fallbackR = count === 1 ? 0 : 44
          const maxHoldZ = this.theaterMode ? 82 : 104
          startX = fromPos ? fromPos.x : Math.cos(fallbackA) * fallbackR
          startY = fromPos ? fromPos.y : -4 + Math.sin(fallbackA) * fallbackR * 0.62
          startZ = fromPos ? Math.min(maxHoldZ + 8, Math.max(floorZ + 28, fromPos.z)) : (maxHoldZ - 12 + power * 14)
          vz = (this.theaterMode ? 155 : 205) + power * (this.theaterMode ? 95 : 145) + (i % 2) * 14
          const tArc = 0.48 + power * 0.12
          vx = (aimX - startX) / tArc + (Math.random() - 0.5) * 20
          vy = (aimY - startY) / tArc + (Math.random() - 0.5) * 20
          const fSpin = 28 + power * 28
          const dir = i % 2 === 0 ? -1 : 1
          wx = -fSpin * (0.88 + Math.random() * 0.24)
          wy = dir * fSpin * (0.62 + Math.random() * 0.25)
          wz = -dir * (14 + power * 18)
        } else {
          const originA = (i / Math.max(1, count)) * Math.PI * 2 + Math.PI
          const originR = count === 1 ? 0 : Math.min(boundX * 0.36, 38 + count * 6)
          startX = prevPos ? Math.max(-boundX * 0.85, Math.min(boundX * 0.85, prevPos.x)) : Math.cos(originA) * originR
          startY = prevPos ? Math.max(-boundY * 0.85, Math.min(boundY * 0.85, prevPos.y)) : (Math.sin(originA) * originR * 0.7 - 6)
          startZ = floorZ + 4 + (i % 3) * 3
          vz = (this.theaterMode ? 410 : 485) + Math.random() * 36 + (i % 2) * 14
          const tArc = (this.theaterMode ? 0.54 : 0.60) + Math.random() * 0.04
          vx = (aimX - startX) / tArc + (Math.random() - 0.5) * 24
          vy = (aimY - startY) / tArc + (Math.random() - 0.5) * 24
          wx = -(23 + Math.random() * 10)
          wy = (i % 2 === 0 ? 1 : -1) * (19 + Math.random() * 9)
          wz = (Math.random() - 0.5) * 16
        }

        if (i < 4) {
          const imp = this.impacts[this.impactCursor % this.impacts.length]
          this.impactCursor++
          imp.x = startX; imp.y = startY; imp.age = 0.001; imp.strength = 0.42 + power * 0.35
        }
      } else if (!spec.silentStatic && this.mode === 'push') {
        // 🔥 孤注一掷专属动作：掌心紧攥剧颤 -> 雷霆陨石俯冲猛砸 -> 狂暴高弹互撞！
        const ringR = count === 1
          ? 0
          : (this.theaterMode
            ? baseR * (1.15 + Math.sqrt(count) * 0.56)
            : Math.min(boundX * 0.55, baseR * (1.42 + Math.sqrt(count) * 0.62)))
        const slotA = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
        const aimX = Math.cos(slotA) * ringR
        const aimY = Math.sin(slotA) * ringR * 0.70 + (this.theaterMode ? 4 : 8)

        if (power > 0) {
          const jitterA = (i / Math.max(1, count)) * Math.PI * 2
          startX = fromPos ? fromPos.x : Math.cos(jitterA) * (count > 1 ? 16 : 0)
          startY = fromPos ? fromPos.y : -24 + Math.sin(jitterA) * (count > 1 ? 10 : 0)
          startZ = fromPos ? Math.max(floorZ + 44, fromPos.z) : ((this.theaterMode ? 80 : 96) + power * (this.theaterMode ? 26 : 42))
          vz = -(480 + power * 640 + Math.random() * 75)
          const slamSpread = 165 + power * 260
          vx = (aimX - startX) * (2.8 + power * 1.8) + (Math.random() - 0.5) * slamSpread
          vy = (aimY - startY) * (3.0 + power * 1.6) + (Math.random() - 0.5) * slamSpread * 0.85
          const pSpin = 40 + power * 38
          wx = (Math.random() < 0.5 ? -1 : 1) * (pSpin + Math.random() * 14)
          wy = (Math.random() < 0.5 ? -1 : 1) * (pSpin * 0.92 + Math.random() * 14)
          wz = (Math.random() - 0.5) * pSpin * 1.15
        } else {
          startX = (i - (count - 1) * 0.5) * Math.min(34, (boundX * 1.2) / Math.max(1, count)) + (Math.random() - 0.5) * 18
          startY = -boundY * 0.90
          startZ = baseR + (this.theaterMode ? 102 : 124) + (i % 3) * 12 + Math.random() * 18
          vz = -(380 + Math.random() * 110)
          vx = (aimX - startX) * 2.8 + (Math.random() - 0.5) * 155
          vy = (aimY - startY) * 3.0 + (Math.random() - 0.5) * 115
          wx = (Math.random() < 0.5 ? -1 : 1) * (32 + Math.random() * 16)
          wy = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 16)
          wz = (Math.random() - 0.5) * 36
        }
      } else if (!spec.silentStatic && power > 0) {
        // 🎲 普通投掷 · 长按蓄力松手：从空中八字旋涡切向高速离心甩射
        const fallbackA = (i / Math.max(1, count)) * Math.PI * 2
        startX = fromPos ? fromPos.x : Math.cos(fallbackA) * 28
        startY = fromPos ? fromPos.y : -14 + Math.sin(fallbackA) * 24
        startZ = fromPos ? Math.max(floorZ + 32, fromPos.z) : ((this.theaterMode ? 76 : 88) + power * 28)
        const flingAngle = (i % 2 === 0 ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.55
        const flingSpd = 380 + power * 420
        vx = Math.cos(flingAngle) * flingSpd + (Math.random() - 0.5) * 90
        vy = Math.abs(Math.sin(flingAngle)) * flingSpd * 0.68 + (Math.random() - 0.5) * 85
        vz = -(220 + power * 360)
        const nSpin = (18 + Math.random() * 12) * (1.0 + power * 1.55)
        wx = (Math.random() < 0.5 ? -1 : 1) * nSpin
        wy = (Math.random() < 0.5 ? -1 : 1) * nSpin * 0.92
        wz = (Math.random() - 0.5) * nSpin * 1.1
      } else {
        // 🎲 普通短按投掷（及静态摆盘）：经典双翼弧线抛入
        const side = (i % 2 === 0 ? -1 : 1) * (0.86 + Math.random() * 0.12)
        startX = this.theaterMode ? side * boundX * 0.96 : side * boundX * 0.88
        startY = -boundY * (0.72 + Math.random() * 0.30)
        startZ = baseR + (this.theaterMode ? 126 : 105) + Math.random() * 62 + (i % 4) * 14

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
        vz = (this.theaterMode ? 162 : 135) + Math.random() * 98
        wx = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12)
        wy = (Math.random() < 0.5 ? -1 : 1) * (13 + Math.random() * 12)
        wz = (Math.random() - 0.5) * 16
      }

      dice.push({
        index: i,
        mesh,
        meshKey: ds.meshKey,
        sides: ds.sides || mesh.faceCount,
        faceValue: ds.targetValue,
        targetFace,
        radius,
        x: startX, y: startY, z: startZ,
        vx, vy, vz,
        wx, wy, wz,
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
      this.audio.playThrowWhoosh(this.theme.soundPreset, 0.95 + power * 0.75, this.mode)
    }
    if (!spec.silentStatic) {
      this._renderAll()
      this.wake()
    }
  }

  _bakeTrajectoriesAndExactLanding(dice, boundX, boundY) {
    const count = dice.length
    const gravity = 1680
    const isFate = this.mode === 'fate'
    const isPush = this.mode === 'push'
    const power = this.lastChargePower || 0
    const maxBounces = isFate ? 2 : (isPush ? (power > 0 ? 6 : 5) : (power > 0 ? 5 : 4))
    const minBounceImpV = (isPush || power > 0) ? 38 : 60
    const wallRest = isPush ? 0.80 : (power > 0 ? 0.74 : 0.68)
    const wallSpin = isPush ? 8.5 : 5.0
    const maxReboundVz = this.theaterMode ? 405 : 510

    this.bounceQueue.length = 0
    const dq = new Float32Array(4)
    const qNext = new Float32Array(4)
    let maxSettleStep = 48
    let peakAvgZ = -Infinity
    let peakStep = 24

    for (let step = 0; step < MAX_STEPS; step++) {
      let sumZ = 0
      for (let i = 0; i < count; i++) {
        const d = dice[i]
        const floorZ = d.radius * (d.meshKey === 'd4' ? 0.52 : d.meshKey === 'd6' || d.meshKey === 'df' ? 0.62 : 0.76)

        if (!d._simSettled) {
          d.vz -= gravity * SIM_DT
          d.x += d.vx * SIM_DT
          d.y += d.vy * SIM_DT
          d.z += d.vz * SIM_DT

          d.vx *= 0.996
          d.vy *= 0.996

          if (d.x < -boundX) { d.x = -boundX; d.vx = Math.abs(d.vx) * wallRest; d.wz += wallSpin }
          else if (d.x > boundX) { d.x = boundX; d.vx = -Math.abs(d.vx) * wallRest; d.wz -= wallSpin }
          if (d.y < -boundY) { d.y = -boundY; d.vy = Math.abs(d.vy) * wallRest; d.wx += wallSpin }
          else if (d.y > boundY) { d.y = boundY; d.vy = -Math.abs(d.vy) * wallRest; d.wx -= wallSpin }

          if (d.z <= floorZ) {
            d.z = floorZ
            const impV = -d.vz
            if (impV > minBounceImpV && d.bounces < maxBounces) {
              const baseRest = isFate
                ? (0.28 + power * 0.05)
                : (isPush ? (0.64 + power * 0.10) : (power > 0 ? 0.58 + power * 0.08 : 0.54))
              const decay = isFate ? 0.13 : ((isPush || power > 0) ? 0.068 : 0.10)
              const rest = Math.max(0.24, baseRest - d.bounces * decay)
              d.vz = Math.min(maxReboundVz, impV * rest)
              const xyKeepX = isFate ? 0.52 : (isPush ? 0.80 : (this.theaterMode ? 0.58 : 0.75))
              const xyKeepY = isFate ? 0.54 : (isPush ? 0.80 : (this.theaterMode ? 0.65 : 0.75))
              d.vx *= xyKeepX
              d.vy *= xyKeepY
              const spinKick = isPush ? (9.0 + power * 6.0) : (isFate ? 3.2 : 6.2)
              d.wx = d.wx * (isFate ? 0.55 : 0.66) - d.vy * 0.05 + (Math.random() - 0.5) * spinKick
              d.wy = d.wy * (isFate ? 0.55 : 0.66) + d.vx * 0.05 + (Math.random() - 0.5) * spinKick
              d.wz *= isFate ? 0.58 : 0.72
              const strengthBoost = (d.bounces === 0 && (isPush || power > 0)) ? (0.18 + power * 0.25) : 0
              this.bounceQueue.push({
                simTime: step * SIM_DT,
                x: d.x,
                y: d.y,
                z: 3,
                strength: Math.min(1.25, impV / 520 + strengthBoost),
                bounceIndex: d.bounces,
                dieIndex: i
              })
              d.bounces++
            } else {
              d.vz = 0
              d.vx *= isFate ? 0.68 : 0.80
              d.vy *= isFate ? 0.68 : 0.80
              d.wx *= isFate ? 0.66 : 0.76
              d.wy *= isFate ? 0.66 : 0.76
              d.wz *= isFate ? 0.66 : 0.76
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
        sumZ += d.z
      }

      if (step <= 95) {
        const avgZ = sumZ / Math.max(1, count)
        if (avgZ > peakAvgZ) {
          peakAvgZ = avgZ
          peakStep = step
        }
      }

      const pairRest = isPush ? 0.90 : 0.84
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
              const imp = -pairRest * vn
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
                  strength: hs * (isPush ? 1.0 : 0.85),
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
    this.fateApexTime = Math.max(0.08, peakStep * SIM_DT)
    this.bounceQueue.sort((a, b) => a.simTime - b.simTime)

    // 逆向四元数对齐：确保目标面最终稳稳朝上微倾面向摄像机，且 det(W * L^T) = (-1)*(-1) = +1 严格属于 SO(3)！
    const qDesired = new Float32Array(4)
    const qInit = new Float32Array(4)
    const qBaked = new Float32Array(4)

    for (let i = 0; i < count; i++) {
      const d = dice[i]
      const tf = d.targetFace
      const tiltCam = d.meshKey === 'd4' ? 0.44 : 0.28
      const wnX = 0, wnY = -Math.sin(tiltCam), wnZ = Math.cos(tiltCam)

      const yaw = (Math.random() - 0.5) * (isFate ? 0.10 : 0.22)
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
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
    const id = this.theme.themeIndex
    const isPush = this.mode === 'push'
    const isFate = this.mode === 'fate'
    const power = this.lastChargePower || 0
    const heavyFirstHit = b.bounceIndex === 0 && (isPush || power > 0.25)

    const imp = this.impacts[this.impactCursor % this.impacts.length]
    this.impactCursor++
    imp.x = b.x
    imp.y = b.y
    imp.age = 0.001
    imp.strength = b.strength
    imp._delay = 0

    // 孤注一掷或高蓄力首击：额外激发一圈滞后双震波涟漪，增强重锤砸桌质感
    if (heavyFirstHit) {
      const imp2 = this.impacts[this.impactCursor % this.impacts.length]
      this.impactCursor++
      imp2.x = b.x; imp2.y = b.y; imp2.age = 0.001; imp2.strength = 0
      imp2._delay = 0.065; imp2._queuedStrength = b.strength * 0.78
    }

    if (id >= 6) {
      const v2 = id - 6
      const shakeCap = isPush ? (9.5 + power * 4.5) : (6.0 + power * 3.5)
      const shakeGain = (v2 === 1 ? 4.5 : 2.2) * (heavyFirstHit ? (1.65 + power * 0.85) : 1.0)
      this.shakeAmp = Math.min(shakeCap, this.shakeAmp + b.strength * shakeGain)
      const burstMul = heavyFirstHit ? (1.8 + power * 1.4) : (isFate && b.bounceIndex === 0 ? (1.35 + power * 0.7) : 1.0)

      if (v2 === 1) {
        const n = Math.max(2, Math.round(5 * b.strength * burstMul))
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = (35 + Math.random() * 95) * b.strength * (heavyFirstHit ? 1.35 : 1.0)
          this._spawnSpark({
            x: b.x + (Math.random() - 0.5) * 12,
            y: b.y + (Math.random() - 0.5) * 12,
            z: 6 + Math.random() * 8,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            vz: (55 + Math.random() * 90) * (heavyFirstHit ? 1.3 : 1.0),
            size: 5.0 + Math.floor(Math.random() * 2) * 2.5,
            life: 0.28 + Math.random() * 0.22,
            grav: 240,
            drag: 2.2,
            r: heavyFirstHit && isPush ? 1.0 : 0.88,
            g: heavyFirstHit && isPush ? 0.62 : 0.84,
            b: heavyFirstHit && isPush ? 0.36 : 0.78,
            a: 1.0,
            mode: 2.0
          })
        }
      } else if (v2 === 0 && (b.strength > 0.36 || heavyFirstHit)) {
        const n = Math.round(3 * burstMul)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = (32 + Math.random() * 44) * (heavyFirstHit ? 1.4 : 1.0)
          this._spawnSpark({
            x: b.x, y: b.y, z: 6,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: (35 + Math.random() * 50) * (heavyFirstHit ? 1.3 : 1.0),
            size: 1.8 + Math.random() * 1.4,
            life: 0.55 + Math.random() * 0.35,
            grav: 45, drag: 2.5,
            r: 0.95, g: 0.78, b: 0.42, a: heavyFirstHit ? 0.50 : 0.35,
            mode: 5.0
          })
        }
      } else if (v2 === 2 && (b.strength > 0.32 || heavyFirstHit)) {
        const n = Math.round(4 * burstMul)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = (40 + Math.random() * 80) * (heavyFirstHit ? 1.35 : 1.0)
          this._spawnSpark({
            x: b.x, y: b.y, z: 5,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: 60 + Math.random() * 80,
            size: 1.8 + Math.random() * 1.5,
            life: 0.35 + Math.random() * 0.25,
            grav: 480, drag: 1.8,
            r: heavyFirstHit ? 0.70 : 0.16,
            g: heavyFirstHit ? 0.18 : 0.11,
            b: heavyFirstHit ? 0.13 : 0.08,
            a: 0.68,
            mode: 5.0
          })
        }
      } else if (v2 === 3) {
        const n = Math.round(2 * burstMul)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = (28 + Math.random() * 34) * (heavyFirstHit ? 1.35 : 1.0)
          this._spawnSpark({
            x: b.x + (Math.random() - 0.5) * 16, y: b.y + (Math.random() - 0.5) * 16, z: 12 + Math.random() * 16,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: (48 + Math.random() * 60) * (heavyFirstHit ? 1.25 : 1.0),
            size: 3.6 + Math.random() * 2.2,
            life: 0.85 + Math.random() * 0.45,
            grav: 58, drag: 2.4,
            r: 0.94, g: 0.76, b: 0.32, a: 0.92,
            mode: 4.0
          })
        }
      } else if (v2 === 4 && (heavyFirstHit || b.strength > 0.5)) {
        const n = Math.round(3 * burstMul)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = 45 + Math.random() * 75
          this._spawnSpark({
            x: b.x, y: b.y, z: 6,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: 55 + Math.random() * 70,
            size: 2.0 + Math.random() * 1.2,
            life: 0.32 + Math.random() * 0.2,
            grav: 360, drag: 2.0,
            r: 1.0, g: 0.31, b: 0.02, a: 0.72,
            mode: 5.0
          })
        }
      } else if (v2 === 5) {
        const n = Math.round(4 * burstMul)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const spd = (48 + Math.random() * 44) * (heavyFirstHit ? 1.35 : 1.0)
          this._spawnSpark({
            x: b.x, y: b.y, z: 6,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz: 52 + Math.random() * 75,
            size: 2.0 + Math.random() * 1.8,
            life: 0.45 + Math.random() * 0.3,
            grav: 120, drag: 1.9,
            r: 0.65, g: 0.92, b: 0.96, a: 0.58,
            mode: 5.0
          })
        }
      }

      if (this.audio) {
        const pan = Math.max(-0.85, Math.min(0.85, b.x / 220))
        this.audio.playBounce(this.theme.soundPreset, Math.min(1, b.strength * (heavyFirstHit ? 1.2 : 1.0)), pan)
      }
      return
    }

    const fanCap = isPush ? 24 : 18
    const fanGain = (id === 2 || isPush ? 12 : 7) * (heavyFirstHit ? 1.35 : 1.0)
    this.shakeAmp = Math.min(fanCap, this.shakeAmp + b.strength * fanGain)
    if (id === 3 || heavyFirstHit) {
      this.chroma = Math.min(1.6, this.chroma + b.strength * (id === 3 ? 0.9 : 0.45))
    }
    if (heavyFirstHit && isPush) {
      const uv = this.renderer.projectToUV(b.x, b.y, 6, this._uvTmp)
      if (uv.visible) {
        this.shockwave[0] = uv.u
        this.shockwave[1] = uv.v
        this.shockwave[2] = 0.02
        this.shockwave[3] = Math.min(0.95, 0.45 + power * 0.45)
        this.shockAge = 0
      }
    }

    const col = this._themeHDRColor()
    const sparkCount = Math.round(
      (this.quality === 'lite' ? 4 : this.quality === 'balanced' ? 9 : 15)
      * (heavyFirstHit ? (1.9 + power * 0.8) : (b.bounceIndex === 0 ? 1.4 : 0.8))
    )
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2
      const spd = (65 + Math.random() * 220) * b.strength * (heavyFirstHit ? 1.3 : 1.0)
      this._spawnSpark({
        x: b.x,
        y: b.y,
        z: Math.max(4, b.z),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: (95 + Math.random() * 240) * b.strength * (heavyFirstHit ? 1.25 : 1.0),
        size: 2.2 + Math.random() * 2.8,
        life: 0.32 + Math.random() * 0.36,
        grav: id === 5 ? 90 : 620,
        drag: 1.8,
        r: col[0], g: col[1], b: col[2],
        a: 1.0
      })
    }

    if (this.audio) {
      const pan = Math.max(-0.85, Math.min(0.85, b.x / 220))
      this.audio.playBounce(this.theme.soundPreset, Math.min(1, b.strength * (heavyFirstHit ? 1.2 : 1.0)), pan)
    }
  }

  _triggerClimaxFX() {
    if (!this.dice.length) return
    const id = this.theme.themeIndex
    const isCrit = this.tier === 'critical'
    const isFumble = this.tier === 'fumble'
    const isDramatic = isCrit || isFumble || this.mode === 'fate' || this.mode === 'push'
    const power = this.lastChargePower || 0

    if (id >= 6) {
      const v2 = id - 6
      this.shakeAmp = Math.max(this.shakeAmp, isCrit ? 6.5 : (this.mode === 'push' ? 4.8 + power * 2.4 : 3.2))

      for (let idx = 0; idx < this.dice.length; idx++) {
        const d = this.dice[idx]
        const imp = this.impacts[this.impactCursor % this.impacts.length]
        this.impactCursor++
        imp.x = d.x; imp.y = d.y; imp.age = 0.001; imp._delay = 0
        imp.strength = isCrit ? 1.0 : (isDramatic ? 0.80 + power * 0.2 : 0.6)

        if (v2 === 1 && (isCrit || this.mode === 'fate')) {
          const count = isCrit ? 8 : 6
          for (let k = 0; k < count; k++) {
            const a = (k / count) * Math.PI * 2
            this._spawnSpark({
              x: d.x + Math.cos(a) * d.radius * 0.9,
              y: d.y + Math.sin(a) * d.radius * 0.9,
              z: d.radius * 0.9 + (k % 2) * 14,
              vx: Math.cos(a) * 55,
              vy: Math.sin(a) * 55,
              vz: 85 + Math.random() * 75,
              size: 6.5,
              life: 0.55 + Math.random() * 0.25,
              grav: 90, drag: 1.8,
              r: 1.0, g: 0.88, b: 0.28, a: 1.0,
              mode: 3.0
            })
          }
        } else if (v2 === 3 && (isCrit || this.mode === 'fate')) {
          const count = isCrit ? 10 : 6
          for (let k = 0; k < count; k++) {
            const a = (k / count) * Math.PI * 2 + Math.random() * 0.3
            this._spawnSpark({
              x: d.x + Math.cos(a) * 18,
              y: d.y + Math.sin(a) * 18,
              z: d.radius * 1.2 + Math.random() * 35,
              vx: Math.cos(a) * (35 + Math.random() * 45),
              vy: Math.sin(a) * (35 + Math.random() * 45),
              vz: 55 + Math.random() * 65,
              size: 4.2 + Math.random() * 2.4,
              life: 1.15 + Math.random() * 0.5,
              grav: 48, drag: 2.1,
              r: 0.98, g: 0.80, b: 0.35, a: 0.95,
              mode: 4.0
            })
          }
        } else if (isDramatic && idx < 6) {
          const count = 4 + Math.round(power * 4)
          for (let k = 0; k < count; k++) {
            const a = (k / count) * Math.PI * 2 + Math.random() * 0.3
            this._spawnMediumAccentParticle(
              d.x + Math.cos(a) * d.radius * 0.7,
              d.y + Math.sin(a) * d.radius * 0.7,
              d.radius * 0.8,
              Math.cos(a) * (42 + power * 35),
              Math.sin(a) * (42 + power * 35),
              65 + Math.random() * 55,
              1.0,
              true
            )
          }
        }
      }
      return
    }

    let cx = 0, cy = 0, cz = 0
    for (const d of this.dice) { cx += d.x; cy += d.y; cz += d.z }
    cx /= this.dice.length; cy /= this.dice.length; cz /= this.dice.length

    const uv = this.renderer.projectToUV(cx, cy, cz, this._uvTmp)
    if (uv.visible && (isDramatic || id === 0 || id === 2)) {
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
      const imp = this.impacts[this.impactCursor % this.impacts.length]
      this.impactCursor++
      imp.x = d.x; imp.y = d.y; imp.age = 0.001; imp._delay = 0; imp.strength = isCrit ? 1.25 : 0.85

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

      if ((id === 4 || isCrit) && idx < 4) {
        const slashCount = isCrit ? 3 : 2
        for (let s = 0; s < slashCount; s++) {
          const isGold = id === 4 && isCrit && s === 0
          this._spawnSlash(
            d.x, d.y, d.z + 10,
            d.radius * (2.6 + s * 0.75),
            0.35 + (s - 0.5) * 0.55,
            s * 2.1 + idx,
            d.radius * 0.32,
            0.72 + s * 0.15,
            isGold ? 2.8 : (id === 4 ? 0.06 : col[0]),
            isGold ? 1.8 : (id === 4 ? 0.07 : col[1]),
            isGold ? 0.3 : (id === 4 ? 0.09 : col[2])
          )
        }
      }

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

      const hasImpacts = this.impacts.some(imp => imp.strength > 0.001 || (imp._delay && imp._delay > 0))
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
    const isCuratedV2 = this.theme.themeIndex >= 6

    if (this.charging) {
      this.chargeTime += rawDt
      const c01 = Math.min(1, this.chargeTime / 0.88)
      if (this.audio) this.audio.updateChargeHum(c01)
      this.fateSlowAmount *= Math.max(0, 1 - rawDt * 10)
      this.bulletTimeAmount *= Math.max(0, 1 - rawDt * 10)

      const cm = this.chargeMode || 'normal'
      const n = this.dice.length

      if (cm === 'fate') {
        // ✦ 逆命重投蓄力动作：骰群反重力拔地悬升，呈横向舒展浑天星盘逆向公转/进动！
        const baseZ = (this.theaterMode ? 50 : 58) + c01 * (this.theaterMode ? 28 : 44)
        this.chargeWorld.z = baseZ
        for (let i = 0; i < n; i++) {
          const d = this.dice[i]
          const orbitRx = n === 1 ? 0 : (52 + Math.sqrt(n) * 18) * (1 - c01 * 0.28)
          const orbitRy = orbitRx * (this.theaterMode ? 0.44 : 0.65)
          const ang = -this.clock * (3.0 + c01 * 5.8) + (i / Math.max(1, n)) * Math.PI * 2
          const tx = this.chargeWorld.x + Math.cos(ang) * orbitRx
          const ty = this.chargeWorld.y + Math.sin(ang) * orbitRy
          const tz = baseZ + Math.sin(this.clock * 5.2 + i * 1.4) * 4
          const followRate = Math.min(1, rawDt * (9.5 + c01 * 8.0))
          d.x += (tx - d.x) * followRate
          d.y += (ty - d.y) * followRate
          d.z += (tz - d.z) * followRate
          d.settled = false

          const spin = -(6.5 + c01 * 18.0) * rawDt * 0.5
          const s = Math.sin(spin)
          qMul(s * 0.38, s * 0.52, s * 0.76, Math.cos(spin), d.qx, d.qy, d.qz, d.qw, this._qTmp)
          qNorm(this._qTmp)
          d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

          const th = (d.trailHead + 1) % 28
          d.trailHead = th
          d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
          if (d.trailCount < 20) d.trailCount++
        }

        if (Math.random() < (isCuratedV2 ? (0.45 + c01 * 0.45) : 0.85)) {
          const a = Math.random() * Math.PI * 2
          const r = 64 + Math.random() * 52
          this._spawnMediumAccentParticle(
            this.chargeWorld.x + Math.cos(a) * r,
            this.chargeWorld.y + Math.sin(a) * r * 0.7,
            16 + Math.random() * 38,
            -Math.cos(a) * (110 + c01 * 75),
            -Math.sin(a) * (90 + c01 * 60),
            85 + c01 * 55,
            0.9,
            true
          )
        }
      } else if (cm === 'push') {
        // 🔥 孤注一掷蓄力动作：高举紧攥成团 + 随蓄力急剧加剧的狂暴高频剧颤与互撞！
        const baseZ = (this.theaterMode ? 60 : 72) + c01 * (this.theaterMode ? 24 : 44)
        this.chargeWorld.z = baseZ
        const tremor = 1.4 + c01 * c01 * 8.8
        for (let i = 0; i < n; i++) {
          const d = this.dice[i]
          const packR = n === 1 ? 0 : (18 + Math.sqrt(n) * 8) * (1 - c01 * 0.22)
          const slotA = (i / Math.max(1, n)) * Math.PI * 2 + this.clock * 1.4
          const jx = Math.sin(this.clock * 47.0 + i * 2.7) * tremor + (Math.random() - 0.5) * tremor * 0.85
          const jy = Math.cos(this.clock * 53.0 + i * 1.9) * tremor + (Math.random() - 0.5) * tremor * 0.85
          const jz = Math.sin(this.clock * 61.0 + i * 3.3) * tremor * 0.65
          const tx = this.chargeWorld.x + Math.cos(slotA) * packR + jx
          const ty = this.chargeWorld.y + Math.sin(slotA) * packR * 0.65 + jy
          const tz = baseZ + (i % 2) * 5 + jz
          const snap = Math.min(1, rawDt * 22)
          d.x += (tx - d.x) * snap
          d.y += (ty - d.y) * snap
          d.z += (tz - d.z) * snap
          d.settled = false

          const spin = (15 + c01 * 32) * rawDt * 0.5
          const ax = Math.sin(this.clock * 11 + i)
          const ay = Math.cos(this.clock * 13 + i * 2)
          const az = Math.sin(this.clock * 17 - i)
          const invL = 1 / (Math.hypot(ax, ay, az) || 1)
          const s = Math.sin(spin)
          qMul(ax * invL * s, ay * invL * s, az * invL * s, Math.cos(spin), d.qx, d.qy, d.qz, d.qw, this._qTmp)
          qNorm(this._qTmp)
          d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

          const th = (d.trailHead + 1) % 28
          d.trailHead = th
          d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
          if (d.trailCount < 16) d.trailCount++
        }

        if (c01 > 0.42) {
          this.shakeAmp = Math.max(this.shakeAmp, (c01 - 0.42) * 1.6)
        }

        if (this.audio && this.chargeTime >= this.nextChargeRattleAt) {
          this.audio.playChargeRattle(this.theme.soundPreset, 0.35 + c01 * 0.65)
          this.nextChargeRattleAt = this.chargeTime + Math.max(0.052, 0.135 - c01 * 0.08)
        }

        if (Math.random() < (isCuratedV2 ? (0.35 + c01 * 0.55) : 0.85)) {
          const a = Math.random() * Math.PI * 2
          const spd = 55 + c01 * 115
          this._spawnMediumAccentParticle(
            this.chargeWorld.x + (Math.random() - 0.5) * 18,
            this.chargeWorld.y + (Math.random() - 0.5) * 18,
            baseZ + (Math.random() - 0.5) * 14,
            Math.cos(a) * spd,
            Math.sin(a) * spd,
            40 + Math.random() * 80,
            0.85,
            false
          )
        }
      } else {
        // 🎲 普通投掷蓄力动作：手摇八字螺旋升空聚势
        const baseZ = (this.theaterMode ? 56 : 70) + c01 * (this.theaterMode ? 24 : 38)
        this.chargeWorld.z = baseZ
        const swayX = Math.sin(this.clock * 7.8) * (10 + c01 * 14)
        for (let i = 0; i < n; i++) {
          const d = this.dice[i]
          const orbitR = n === 1 ? 8 : (26 + (1 - c01 * 0.35) * 26)
          const ang = this.clock * (6.2 + c01 * 7.8) + (i / Math.max(1, n)) * Math.PI * 2
          const tx = this.chargeWorld.x + swayX + Math.cos(ang) * orbitR
          const ty = this.chargeWorld.y + Math.sin(ang) * orbitR * 0.72
          const tz = baseZ + Math.sin(this.clock * 9 + i) * 6
          d.x += (tx - d.x) * Math.min(1, rawDt * 18)
          d.y += (ty - d.y) * Math.min(1, rawDt * 18)
          d.z += (tz - d.z) * Math.min(1, rawDt * 18)
          d.settled = false

          const spin = (12 + c01 * 20) * rawDt * 0.5
          qMul(Math.sin(spin) * 0.7, Math.sin(spin) * 0.7, 0, Math.cos(spin), d.qx, d.qy, d.qz, d.qw, this._qTmp)
          qNorm(this._qTmp)
          d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

          const th = (d.trailHead + 1) % 28
          d.trailHead = th
          d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
          if (d.trailCount < 18) d.trailCount++
        }

        if (n > 1 && this.audio && this.chargeTime >= this.nextChargeRattleAt) {
          this.audio.playChargeRattle(this.theme.soundPreset, 0.25 + c01 * 0.4)
          this.nextChargeRattleAt = this.chargeTime + Math.max(0.085, 0.16 - c01 * 0.06)
        }

        if (Math.random() < (isCuratedV2 ? (0.28 + c01 * 0.35) : 0.82)) {
          const a = Math.random() * Math.PI * 2
          const rad = 58 + Math.random() * 48
          this._spawnMediumAccentParticle(
            this.chargeWorld.x + swayX + Math.cos(a) * rad,
            this.chargeWorld.y + Math.sin(a) * rad,
            22 + Math.random() * 46,
            -Math.cos(a) * 120,
            -Math.sin(a) * 120,
            90,
            0.85,
            false
          )
        }
      }
    } else if (!this.settled) {
      const remainingSim = this.maxSimDuration - this.simTime
      const prog = this.simTime / Math.max(0.35, this.maxSimDuration)
      const pwr = this.lastChargePower || 0
      const apexT = this.fateApexTime || 0.22

      // ✦ 逆命重投专属：精准锚定烘焙最高点时刻触发「穹顶时停凝滞改命」，清晰展现空中翻转改写点数！
      const inFateApex = this.mode === 'fate'
        && this.simTime >= Math.max(0.03, apexT - 0.09)
        && this.simTime <= apexT + 0.16 + pwr * 0.10
        && this.dice.length <= 12
      this.fateSlowAmount += ((inFateApex ? 1.0 : 0.0) - this.fateSlowAmount) * Math.min(1, rawDt * 18)

      if (inFateApex && !this.fateApexChimePlayed) {
        this.fateApexChimePlayed = true
        if (this.audio) this.audio.playFateApexChime(this.theme.soundPreset, Math.max(0.35, pwr))
        for (let i = 0; i < Math.min(6, this.dice.length); i++) {
          const d = this.dice[i]
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + i
            this._spawnMediumAccentParticle(
              d.x + Math.cos(a) * d.radius * 0.85,
              d.y + Math.sin(a) * d.radius * 0.85,
              d.z,
              Math.cos(a) * 42,
              Math.sin(a) * 42,
              26,
              0.95,
              true
            )
          }
        }
      }

      let timeScale = 1.0
      if (this.mode === 'fate') {
        if (!isCuratedV2) {
          this.bulletTimeAmount += (this.fateSlowAmount - this.bulletTimeAmount) * Math.min(1, rawDt * 14)
        } else {
          this.bulletTimeAmount = 0
        }
        if (this.fateSlowAmount > 0.02) {
          const apexMinScale = 0.21 - pwr * 0.05
          timeScale = 1.0 - this.fateSlowAmount * (1.0 - apexMinScale)
        } else if (this.simTime > apexT + 0.16 + pwr * 0.10 && remainingSim > 0.14) {
          timeScale = 1.14 + pwr * 0.12
        } else if (this.theaterMode && remainingSim > 0.02 && remainingSim < 0.20) {
          timeScale = 0.72
        }
      } else if (isCuratedV2) {
        this.bulletTimeAmount = 0
        if (this.mode === 'push') {
          if (prog < 0.22) timeScale = 1.10 + pwr * 0.12
          else if ((this.tier === 'critical' || this.tier === 'fumble') && remainingSim > 0.02 && remainingSim < 0.18 && this.dice.length <= 6) {
            timeScale = 0.45
          } else if (this.theaterMode && remainingSim > 0.02 && remainingSim < 0.22) {
            timeScale = 0.68
          }
        } else {
          const wantSlow = this.tier === 'critical' && remainingSim > 0.03 && remainingSim < 0.24 && this.dice.length <= 6
          timeScale = wantSlow ? 0.44 : (this.theaterMode && remainingSim > 0.02 && remainingSim < 0.22 ? 0.65 : 1.0)
        }
      } else {
        const wantBullet =
          (this.theme.themeIndex === 1 || this.tier === 'critical' || this.tier === 'fumble') &&
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
          if (this.audio && this.theme.themeIndex === 1) {
            this.audio.playBulletTimeDrop()
          }
        }
        if (this.mode === 'push' && prog < 0.22 && !wantBullet) {
          timeScale = 1.12 + pwr * 0.12
        } else {
          timeScale = 1.0 - this.bulletTimeAmount * 0.76
        }
      }

      const simDelta = rawDt * timeScale
      this.rollTime += rawDt
      this.simTime += simDelta * (this.simPace || 1)

      // 像素风在空中运动阶段呈现 30fps 黄金精灵动画帧韵律，落定前及逆命慢镜期间恢复全精度对位
      const quantizedTime = (this.theme.themeIndex === 7 && remainingSim > 0.14 && this.fateSlowAmount < 0.2)
        ? Math.floor(this.simTime * 30) / 30
        : this.simTime

      const fStep = quantizedTime / SIM_DT
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
        this.fateSlowAmount = 0
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
      this.fateSlowAmount *= Math.max(0, 1 - rawDt * 10)
      for (let i = 0; i < this.dice.length; i++) {
        if (this.dice[i].trailCount > 0) this.dice[i].trailCount = Math.max(0, this.dice[i].trailCount - 2)
      }
    }

    for (const imp of this.impacts) {
      if (imp._delay && imp._delay > 0) {
        imp._delay -= rawDt
        if (imp._delay <= 0) {
          imp._delay = 0
          imp.age = 0.001
          imp.strength = imp._queuedStrength || 0.6
        }
        continue
      }
      if (imp.strength <= 0) continue
      imp.age += rawDt
      const maxL = this.theme.themeIndex === 4 ? 2.4 : (isCuratedV2 ? 1.6 : 1.15)
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

    const slowParticleFactor = Math.max(this.bulletTimeAmount * 0.65, this.fateSlowAmount * 0.55)
    this._stepParticles(rawDt * (1 - slowParticleFactor))
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
      if (p.mode[i] < 0.5 || p.mode[i] > 1.5) {
        const drag = Math.max(0, 1 - p.drag[i] * dt)
        p.vx[i] *= drag
        p.vy[i] *= drag
        p.vz[i] = p.vz[i] * drag - p.grav[i] * dt
        if (p.mode[i] > 3.5 && p.mode[i] < 4.5) {
          p.x[i] += Math.sin(this.clock * 4.5 + i) * 18 * dt
        }
        p.x[i] += p.vx[i] * dt
        p.y[i] += p.vy[i] * dt
        p.z[i] += p.vz[i] * dt
        if (p.z[i] < 2) {
          p.z[i] = 2
          p.vz[i] = Math.abs(p.vz[i]) * 0.42
          p.vx[i] *= 0.74
          p.vy[i] *= 0.74
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
      const zWeight = (this.charging && this.chargeMode === 'fate') || this.fateSlowAmount > 0.05 ? 0.46 : 0.35
      cz = Math.min(this.theaterMode ? 54 : 66, (sz / this.dice.length) * zWeight)
    }

    let zoom = 1.0
    if (this.cinematicCamEnabled) {
      if (this.charging) {
        const c01 = Math.min(1, this.chargeTime / 0.88)
        if (this.chargeMode === 'fate') {
          zoom = 1.02 - c01 * 0.06
        } else if (this.chargeMode === 'push') {
          zoom = 1.06 + c01 * 0.11
        } else {
          zoom = 1.05 + c01 * 0.08
        }
      } else if (this.fateSlowAmount > 0.04) {
        zoom = 1.0 - this.fateSlowAmount * (0.14 + (this.lastChargePower || 0) * 0.06)
      } else if (this.bulletTimeAmount > 0.05) {
        zoom = 1.0 - this.bulletTimeAmount * 0.24
      } else if (this.settled && this.settleTime < 1.1 && (this.tier === 'critical' || this.tier === 'fumble') && this.dice.length <= 4) {
        const pushIn = this.theme.themeIndex >= 6 ? 0.10 : 0.16
        zoom = (1.0 - pushIn) + (this.settleTime / 1.1) * pushIn
      }
    }

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

    const baseChroma = this.theme.themeIndex >= 6 ? 0.0 : (this.theme.themeIndex === 3 ? 0.22 : 0.05)
    this.chroma += (baseChroma - this.chroma) * Math.min(1, dt * 6.0)
  }

  _drawChargeAndFateHud(ctx, W, H, isLightSurface) {
    const drawPill = (text, cx, cy, borderCol) => {
      ctx.save()
      ctx.font = '600 11.5px system-ui, -apple-system, "PingFang SC", sans-serif'
      const tw = Math.ceil(ctx.measureText(text).width)
      const pw = tw + 20
      const ph = 22
      ctx.fillStyle = isLightSurface ? 'rgba(250, 245, 235, 0.90)' : 'rgba(12, 12, 16, 0.84)'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 11)
      } else {
        ctx.rect(cx - pw / 2, cy - ph / 2, pw, ph)
      }
      ctx.fill()
      ctx.strokeStyle = borderCol || this.theme.accent
      ctx.globalAlpha = 0.65
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillStyle = isLightSurface ? '#1e1915' : '#f7f3eb'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, cy + 0.5)
      ctx.restore()
    }

    if (this.charging) {
      const uv = this.renderer.projectToUV(this.chargeWorld.x, this.chargeWorld.y, this.chargeWorld.z || 76, this._uvTmp)
      if (uv.visible) {
        const cm = this.chargeMode || 'normal'
        const c01 = Math.min(1, this.chargeTime / 0.88)
        const jitterX = cm === 'push' ? Math.sin(this.clock * 52) * c01 * 2.2 : 0
        const jitterY = cm === 'push' ? Math.cos(this.clock * 59) * c01 * 2.2 : 0
        const sx = uv.u * W + jitterX
        const sy = Math.max(38, Math.min(H - 40, (1 - uv.v) * H)) + jitterY
        const r = Math.min(H * 0.22, 30 + c01 * 16)
        let ringCol = this.theme.accent

        ctx.save()
        if (cm === 'fate') {
          ctx.strokeStyle = ringCol
          ctx.lineWidth = 2.1
          ctx.beginPath()
          ctx.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
          ctx.stroke()

          ctx.save()
          ctx.translate(sx, sy)
          ctx.rotate(-this.clock * 1.8)
          if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 5])
          ctx.lineWidth = 1.2
          ctx.globalAlpha = 0.5 + c01 * 0.42
          ctx.beginPath()
          ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        } else if (cm === 'push') {
          ringCol = isLightSurface ? '#b6291c' : (c01 > 0.65 ? '#ff6438' : this.theme.accent)
          ctx.strokeStyle = ringCol
          ctx.lineWidth = 2.4 + c01 * 0.8
          const rr = r * (1.12 - c01 * 0.16)
          ctx.beginPath()
          ctx.arc(sx, sy, rr, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
          ctx.stroke()

          ctx.lineWidth = 1.4
          ctx.globalAlpha = 0.42 + c01 * 0.52
          for (let k = 0; k < 8; k++) {
            const ka = (k / 8) * Math.PI * 2 + this.clock * 0.8
            ctx.beginPath()
            ctx.moveTo(sx + Math.cos(ka) * (rr + 3), sy + Math.sin(ka) * (rr + 3))
            ctx.lineTo(sx + Math.cos(ka) * (rr + 8), sy + Math.sin(ka) * (rr + 8))
            ctx.stroke()
          }
        } else {
          ctx.strokeStyle = ringCol
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
          ctx.stroke()
        }
        ctx.restore()

        const pct = Math.round(c01 * 100)
        const label = this.buttonCharging
          ? (cm === 'fate'
            ? `✦ 逆命改运 ${pct}% · 松手逆转天命`
            : (cm === 'push' ? `🔥 孤注搏命 ${pct}% · 松手重注猛砸` : `蓄力 ${pct}% · 松手甩投`))
          : '松开或划动甩投'
        drawPill(label, sx, Math.min(H - 16, sy + r + 19), ringCol)
      }
    } else if (!this.settled && this.mode === 'fate' && this.fateSlowAmount > 0.25 && !this.compactMode) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, (this.fateSlowAmount - 0.25) / 0.5)
      drawPill('✦ 穹顶悬停 · 逆转天命 ✦', W * 0.5, Math.min(H - 16, H * 0.85), this.theme.accent)
      ctx.restore()
    }
  }

  _renderAll() {
    const hiddenMask = this.mode === 'hidden' && !this.revealed
    const tierCode = hiddenMask || !this.settled || this.charging ? 0 : (TIER_CODE_MAP[this.tier] || 2)

    this.renderer.render({
      time: this.clock,
      themeId: this.theme.themeIndex,
      tierCode,
      climax: this.charging ? 0 : this.climax,
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
    const isLightSurface = this.theme.themeIndex === 8 || this.theme.themeIndex === 10
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    this._drawChargeAndFateHud(ctx, W, H, isLightSurface)

    if (this.settled && !this.charging && !hiddenMask && this.settleTime < 2.5 && !this.compactMode) {
      drawThemeSealOverlay(ctx, {
        themeIndex: this.theme.themeIndex,
        tier: this.tier,
        total: this.total,
        settleTime: this.settleTime,
        sx: W - Math.min(115, W * 0.14),
        sy: Math.min(125, H * 0.25),
        scaleMul: 1,
        pinSettled: this.pinSettled
      })
    }

    if (this.theme.themeIndex === 3 && this.settled && !this.charging && !hiddenMask && this.settleTime < 2.4 && this.dice.length <= 6) {
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

    if (hiddenMask && this.settled && !this.charging) {
      ctx.save()
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 4.2)
      ctx.strokeStyle = isLightSurface
        ? `rgba(168, 40, 28, ${0.42 + pulse * 0.35})`
        : `rgba(122, 252, 214, ${0.45 + pulse * 0.4})`
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
    const pref = String(animationPref || "atelier")
    if (pref === "none" || pref === "compact") return null
    if (pref === "bounce") {
      if (mode === "fate") return THEME_BY_ID.prism
      if (mode === "push") return THEME_BY_ID.inferno
      if (hidden) return THEME_BY_ID.singularity
      return THEME_BY_ID.astral
    }
    if (THEME_BY_ID[pref]) return THEME_BY_ID[pref]
    return THEME_BY_ID.atelier
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
      const tierCode = hiddenMask || !this.settled || this.charging ? 0 : (TIER_CODE_MAP[this.tier] || 2)

      sharedR.render({
        time: this.clock,
        themeId: this.theme.themeIndex,
        tierCode,
        climax: this.charging ? 0 : this.climax,
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

      // 叠加锐利矢量前景（三形态蓄力环 / 逆命穹顶悬停签 / 典藏铭牌 / 赛博准星）
      this.hudCtx = this.displayCtx
      this._renderCrispVectorOverlayNoClear(hiddenMask)
    }

    _renderCrispVectorOverlayNoClear(hiddenMask) {
      const ctx = this.displayCtx
      const W = this.cssW
      const H = this.cssH
      const isLightSurface = this.theme.themeIndex === 8 || this.theme.themeIndex === 10
      ctx.save()
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

      this._drawChargeAndFateHud(ctx, W, H, isLightSurface)

      const sealWindow = this.pinSettled ? Infinity : (this.theaterMode ? 3.5 : 2.5)
      if (this.settled && !this.charging && !hiddenMask && this.settleTime < sealWindow && !this.compactMode) {
        const panelRightMargin = this.theme.themeIndex >= 6 ? 56 : 46
        drawThemeSealOverlay(ctx, {
          themeIndex: this.theme.themeIndex,
          tier: this.tier,
          total: this.total,
          settleTime: this.settleTime,
          sx: this.theaterMode ? Math.min(W - 96, Math.round(W * 0.5 + Math.min(295, W * 0.27))) : W - panelRightMargin,
          sy: this.theaterMode ? Math.round(H * 0.42) : Math.max(44, H * 0.36),
          scaleMul: this.theaterMode ? 1.04 : 0.78,
          fadeStart: this.pinSettled ? Infinity : (this.theaterMode ? 2.85 : 1.9),
          pinSettled: Boolean(this.pinSettled)
        })
      }

      if (this.theme.themeIndex === 3 && this.settled && !this.charging && !hiddenMask && (this.pinSettled || this.settleTime < 2.4) && this.dice.length <= 4 && !this.compactMode) {
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
    CinematicDiceStage,
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
    return (saved && saved.animation) || "atelier"
  }, "atelier")
}

/**
 * 原生 DOM 按钮绑定「点按即投 + 长按蓄力旋涡 + 移出无损取消」
 * （供楼层顶栏原生面板与发前逆命弹窗复用）
 */
function fdAttachHoldChargeToDomBtn(btn, options) {
  if (!btn || typeof btn.addEventListener !== "function") return
  const { mode, getStage, onTrigger, baseLabel } = options || {}
  let holdTimer = 0
  let rafId = 0
  let downAt = 0
  let charging = false
  let pointerHandled = false
  let capturedPointerId = null

  const titleEl = btn.querySelector ? btn.querySelector(".fd-reroll-btn-title") : null
  const origTitle = baseLabel || (titleEl ? titleEl.textContent : btn.textContent)

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  const releaseCapture = () => {
    if (capturedPointerId !== null && typeof btn.releasePointerCapture === "function") {
      try { btn.releasePointerCapture(capturedPointerId) } catch {}
    }
    capturedPointerId = null
  }

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
    releaseCapture()
    setChargingCls(false)
    setChargeVar(null)
    if (titleEl) titleEl.textContent = origTitle
  }

  const tick = () => {
    if (!charging) return
    const pct = Math.min(1, Math.max(0, (nowMs() - downAt - FD_HOLD_THRESHOLD_MS) / FD_HOLD_FULL_MS))
    const pctNum = Math.round(pct * 100)
    setChargeVar(pctNum + "%")
    if (titleEl) {
      titleEl.textContent = mode === "push"
        ? `🔥 搏命蓄力 ${pctNum}% · 松手猛砸`
        : (mode === "fate" ? `✦ 逆命蓄力 ${pctNum}% · 松手改命` : `蓄力 ${pctNum}% · 松手甩投`)
    }
    if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(tick)
  }

  const cancel = () => {
    if (!downAt && !charging) return
    downAt = 0
    const wasCharging = charging
    charging = false
    cleanup()
    if (wasCharging) {
      const stg = typeof getStage === "function" ? getStage() : null
      if (stg && typeof stg.cancelButtonCharge === "function") stg.cancelButtonCharge()
    }
  }

  btn.addEventListener("pointerdown", e => {
    if (btn.disabled || (e && e.button !== undefined && e.button !== 0)) return
    pointerHandled = false
    charging = false
    downAt = nowMs()
    if (e && e.pointerId !== undefined && typeof btn.setPointerCapture === "function") {
      try {
        btn.setPointerCapture(e.pointerId)
        capturedPointerId = e.pointerId
      } catch {}
    }
    holdTimer = setTimeout(() => {
      charging = true
      setChargingCls(true)
      const stg = typeof getStage === "function" ? getStage() : null
      if (stg && typeof stg.startButtonCharge === "function") stg.startButtonCharge(mode)
      tick()
    }, FD_HOLD_THRESHOLD_MS)
  })

  btn.addEventListener("pointermove", e => {
    if ((!downAt && !charging) || capturedPointerId === null || !e || typeof btn.getBoundingClientRect !== "function") return
    const r = btn.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return
    const pad = 14
    if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) {
      cancel()
    }
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

  btn.addEventListener("pointerleave", () => {
    if (capturedPointerId === null) cancel()
  })
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
    const pref = String(animPref || "atelier")
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
