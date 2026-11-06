// deterministic art signature and consumer-side WCAG contrast; no I/O or cache.
const FIGURE_AUTO_NEUTRAL = '#78808c';
function figureRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function figureHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function figureHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), c = hi - lo, l = (hi + lo) / 2;
  let h = 0;
  if (c) h = (hi === r ? ((g - b) / c + 6) % 6 : hi === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60;
  return {h, s:c ? c / (1 - Math.abs(2 * l - 1)) : 0, l, c};
}
function figureFromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return rgb.map(v => Math.round((v + m) * 255));
}
function figureLuminance(hex) {
  const rgb = figureRgb(hex).map(v => {v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;});
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function figureContrast(a, b) {
  const x = figureLuminance(a), y = figureLuminance(b);
  return (Math.max(x,y) + 0.05) / (Math.min(x,y) + 0.05);
}
// the one readability rule for an image colour as rendered. Move lightness only (hue and
// saturation kept) to the closest value for which `passes(candidate)` holds, searching both directions (darker and
// lighter); a colour that already passes is returned unchanged; when neither end can pass the colour is left as is.
// `passes` decides what the colour is checked against: as text over a background, or as a plate under fixed text.
function figureLightness(base, passes, steps = 20) {
  if (passes(base)) return base;
  const {h,s,l} = figureHsl(...figureRgb(base)), candidates = [];
  for (const end of [0,1]) {
    if (!passes(figureHex(figureFromHsl(h,s,end)))) continue;
    let pass = end, fail = l;
    for (let i = 0; i < steps; i++) {
      const mid = (pass + fail) / 2;
      if (passes(figureHex(figureFromHsl(h,s,mid)))) pass = mid;
      else fail = mid;
    }
    candidates.push({color:figureHex(figureFromHsl(h,s,pass)),distance:Math.abs(pass-l)});
  }
  candidates.sort((a,b) => a.distance-b.distance);
  return candidates.length ? candidates[0].color : base;
}
// The colour as text (or a glyph) over the actual opaque/composited background it is drawn on.
function figureTextColor(base, background, ratio = 4.5) {
  return figureLightness(base, color => figureContrast(color, background) >= ratio);
}
// The colour as a plate under fixed text (a theme or skin ink): the plate moves, the text keeps its colour.
function figurePlateColor(base, text, ratio = 4.5) {
  return figureLightness(base, color => figureContrast(text, color) >= ratio);
}
// the one rule for character colours. A character has one image colour (形象色): the user's
// imageColor when set, else the autoColor sampled from its own image. No preset palette, no cross-card or in-card assignment;
// two characters may share a colour. Readability is resolved where it is drawn (src/client/figure-color-contrast.js).
// The picker's swatches: lighter and darker shades of the automatic colour (same hue and saturation), not a preset palette.
function figureColorShades(color) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) return [];
  const {h,s} = figureHsl(...figureRgb(color));
  return [...new Set([0.28,0.38,0.48,0.58,0.68,0.78].map(l => figureHex(figureFromHsl(h,s,l))))];
}
// Avatars may include shoulders: sample their upper 72%. For a static sprite use
// the top 20% of opaque bounds, excluding the outer 12%, not the padded canvas.
function figureColorRegion(data, width, height, sprite) {
  if (!sprite) return {left:0,top:0,right:width,bottom:Math.ceil(height*0.72)};
  let left = width, right = 0, top = height, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y*width+x)*4+3] < 32) continue;
    left = Math.min(left,x); right = Math.max(right,x+1);
    top = Math.min(top,y); bottom = Math.max(bottom,y+1);
  }
  const inset = Math.floor((right-left)*0.12);
  return {left:left+inset,right:right-inset,top,bottom:top+Math.ceil((bottom-top)*0.20)};
}
function inferFigureAutoColor({data,width,height}, {sprite = false} = {}) {
  const region = figureColorRegion(data,width,height,sprite);
  let opaqueWeight = 0;
  const saturated = Array.from({length:24}, () => ({weight:0,r:0,g:0,b:0}));
  const chromatic = Array.from({length:24}, () => ({weight:0,r:0,g:0,b:0}));
  const add = (bins,r,g,b,h,weight) => {
    // Overlapping hue windows avoid splitting hair shades at a bucket boundary.
    const center = Math.floor(h/15);
    for (const offset of [0,1]) {
      const bin = bins[(center+offset)%24], fraction = h/15-center;
      const w = weight * (offset ? fraction : 1-fraction);
      bin.weight += w; bin.r += r*w; bin.g += g*w; bin.b += b*w;
    }
  };
  for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
    const i = (y*width+x)*4, a = data[i+3]/255;
    if (a < 0.125) continue;
    opaqueWeight += a;
    const r = data[i], g = data[i+1], b = data[i+2], {h,s,l,c} = figureHsl(r,g,b);
    const skin = h >= 8 && h <= 50 && (l > 0.84 || h <= 42 && l > 0.12 && c < 0.36);
    if (l < 0.055 || l > 0.94 || c < 0.045 || skin) continue;
    add(chromatic,r,g,b,h,a);
    if (c >= 0.18 && s >= 0.28 && l >= 0.16 && l <= 0.84) add(saturated,r,g,b,h,a);
  }
  const best = bins => bins.reduce((a,b) => b.weight > a.weight ? b : a);
  let winner = best(saturated);
  // A tiny accessory must not displace the character's low-chroma hair.
  if (winner.weight < opaqueWeight * 0.03) winner = best(chromatic);
  return winner.weight ? figureHex([winner.r,winner.g,winner.b].map(v => v/winner.weight)) : FIGURE_AUTO_NEUTRAL;
}
// Browser intake and the offline Chromium fill use exactly the same bounded sampling.
function figureBitmapAutoColor(bitmap, sprite, canvas) {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return inferFigureAutoColor(context.getImageData(0, 0, canvas.width, canvas.height), {sprite});
}
// the source identity, not figure metadata, decides whether an authoring write needs sampling.
function figureAutoSource(figure, sprites = {}) {
  const outfit = figure.outfits.find(row => row.enabled);
  if (!outfit) return null;
  const id = outfit.sprite?.imagePools?.[outfit.defaultEmotion || figure.emotions?.[0]?.id]?.defaultImageId || 'calm';
  if (outfit.avatars?.[id]) return {hash:outfit.avatars[id],sprite:false};
  const binding = outfit.sprite, manifest = sprites[binding?.manifestKey];
  if (!manifest) return null;
  const resolver = typeof window === 'undefined' && typeof require === 'function' ? require('./sprite-emotions.cjs').resolveSpriteEmotion : resolveSpriteEmotion;
  const state = resolver(manifest,id).state;
  const hash = binding.assets[state?.stage?.src || state?.src];
  return hash ? {hash,sprite:true} : null;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {
  FIGURE_AUTO_NEUTRAL, inferFigureAutoColor, figureColorRegion, figureTextColor, figurePlateColor, figureLightness, figureContrast,
  figureAutoSource, figureBitmapAutoColor, figureColorShades
};
