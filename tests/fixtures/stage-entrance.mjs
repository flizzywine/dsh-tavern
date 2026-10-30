// a neutral dsh.entrance/1 fixture shared by the entrance tests.
// A neutral fixture: a dot that holds, a rush, a white cover and a fade.
export function entranceDoc() {
  return {
    schema: 'dsh.entrance/1', label: 'Fixture dive', background: 'ink', focus: [0.5, 0.5],
    palette: { ink: '#000000', warm: '#ffcc88', sea: '#22aaaa', white: '#ffffff' },
    layers: { light: { color: 'warm', radius: 0.03 }, walls: { color: 'sea' }, flare: { color: 'white' }, flash: { color: 'white' } },
    phases: [
      { id: 'dark', ms: 500 },
      { id: 'dot', ms: 400, tracks: { light: [[0, 0.5], [1, 1]] } },
      { id: 'wait', ms: 1000, hold: true, tracks: { light: [[0, 1], [0.5, 1.2], [1, 1]] } },
      { id: 'rush', ms: 1200, tracks: { light: [[0, 1], [1, 2]], walls: [[0, 0], [1, 1]], speed: [[0, 0.2], [1, 3]], flare: [[0, 0], [1, 1]] } },
      { id: 'white', ms: 200, cover: true, tracks: { flash: [[0, 0], [1, 1]], flare: [[0, 1]], speed: [[0, 3]] } },
      { id: 'fade', ms: 600, tracks: { flash: [[0, 1]], fade: [[0, 1], [1, 0]] } }
    ],
    skip: { flashMs: 120, handoffMs: 300 },
    still: { phase: 'wait', at: 0.5 }
  }
}

// The same dive with the water pass: a glass orb, liquid bodies (flooding above 1), near splashes, droplets in depth, the
// lens disc behind the light and a camera pan.
export function waterDoc() {
  const doc = entranceDoc()
  Object.assign(doc.palette, { pink: '#cc9988', foam: '#f4fbff', glint: '#ffb27a' })
  doc.layers.light.disc = 'pink'
  Object.assign(doc.layers, {
    orb: { color: 'sea', radius: 0.12, refraction: 1, glitter: 0.6 },
    liquid: { color: 'sea', edge: 'foam', density: 0.85, scale: 0.5, detail: 0.5, gloss: 1.2, refraction: 1, spread: 0.3 },
    splash: { color: 'sea', edge: 'foam', density: 0.5, scale: 1, detail: 0.3, gloss: 2, refraction: 1, spread: 0.8 },
    droplets: { color: 'foam', glint: 'glint', density: 0.5, size: 1, focus: 0.3, bokeh: 1.2, trail: 1.5 }
  })
  Object.assign(doc.phases[3].tracks, { orb: [[0, 1], [0.5, 0]], orbSize: [[0, 1], [1, 1.4]], liquid: [[0, 0], [0.5, 2.5], [1, 2.5]], liquidSize: [[0, 0.7], [1, 1.6]],
    splash: [[0, 0], [1, 1]], droplets: [[0, 0.3], [1, 1.2]], lightDisc: [[0, 0], [1, 1.5]], panX: [[0, 0], [1, -0.05]], panY: [[0, 0], [1, 0.04]] })
  return doc
}

// The water breaks up - torn, thin sheets at three depths, foam shards blown full of
// holes, a crumpled lump that moves, and a spray of fine droplets thrown out of the focus.
export function sprayDoc() {
  const doc = waterDoc()
  Object.assign(doc.layers.liquid, { tear: 0.4, opacity: 0.6, layers: 3, foam: 0.3, crinkle: 0.5, lean: 0.3, angle: -100 })
  Object.assign(doc.layers.splash, { tear: 0.5, foam: 1, cells: 1, lean: 0.5, angle: -170 })
  doc.layers.light.discSize = 2
  Object.assign(doc.layers, {
    spray: { color: 'foam', glint: 'glint', count: 4000, size: 0.8, fall: 1.2, speed: 1.6, start: 0.1, life: 1.6, spread: 0.3, lean: 0.35, angle: 20, streak: 0.35, bokeh: 0.05, mist: 0.1, clump: 0.85 },
    lump: { color: 'sea', edge: 'foam', radius: 0.075, x: 0.09, y: -0.09, wobble: 0.7, refraction: 1 }
  })
  Object.assign(doc.phases[3].tracks, { spray: [[0, 0], [0.3, 1]], spraySize: [[0, 1], [1, 1.3]], lump: [[0, 0], [1, 1]], lumpSize: [[0, 1], [1, 2]], lumpX: [[0, 0], [1, -0.2]], lumpY: [[0, 0], [1, -0.1]] })
  return doc
}
// The water is a baked plate - an offline fluid simulation as an image sequence with the refraction it
// applies to the scene behind - and the post stage glows (bloom) and scatters light shafts around the focus.
export function plateDoc() {
  const doc = entranceDoc()
  Object.assign(doc.palette, { teal: '#5f9c9c' })
  Object.assign(doc.layers, {
    plate: { dir: 'water', frames: 3, fps: 24, shift: 0.1, tint: 'teal', refraction: 0.4, exposure: 1, parallax: 0.7 },
    bloom: { amount: 1, threshold: 0.7, radius: 0.05, color: 'white' },
    shafts: { amount: 0.6, length: 0.5, color: 'warm' }
  })
  Object.assign(doc.phases[3].tracks, { plate: [[0, 0], [0.5, 1]], plateRate: [[0, 0], [0.4999, 0], [0.5, 1], [1, 1]], bloom: [[0, 1]], shafts: [[0, 0], [1, 1]] })
  return doc
}
