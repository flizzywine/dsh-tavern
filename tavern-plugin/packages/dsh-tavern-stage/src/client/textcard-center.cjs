function createStageTextcardCenter({metrics:TEXTCARD_VERT_INK}={}) {
let disposed=false;
function invalidate(){if(!disposed){textcardCenterCache.clear();textcardInkCache.clear();}}
// ---------- optical centring ----------
// Full-width CJK punctuation sits on one side of its em box (「？」 at the end of 「真的？」), and letter-spacing adds a
// trailing gap: the layout box is centred, the ink is not. Each [data-tc-center] block is measured glyph by glyph —
// layout position from a DOM Range; ink bounds from canvas measureText (actualBoundingBox*) for horizontal and upright
// glyphs, and from the generated vert/vrt2 table (textcard-vert-ink.cjs, bin/textcard-vert-ink.py) for
// tategaki punctuation, whose rotated/shifted form canvas cannot see — and moved with `translate` so its ink box is
// centred on the block's layout box (the sample's ink centring). `halt` / `text-spacing-trim` do not fix ？！.
function textcardVertInk(style, ch) {
    // Only the first family renders the card; a fallback name later in the stack must not select the Noto table.
    if (typeof TEXTCARD_VERT_INK === 'undefined' || !/noto-serif-sc|Noto Serif SC/i.test(style.fontFamily.split(',')[0])) return null;
    const weight = Number(style.fontWeight) || 400, key = weight >= 600 ? '700' : weight >= 450 ? '500' : '400';
    return TEXTCARD_VERT_INK[key][ch] || null;
}
const textcardInkCache = new Map();
let textcardCanvas = null;
function textcardGlyphInk(doc, font, ch) {
    const key = font + '\u0000' + ch;
    let ink = textcardInkCache.get(key);
    if (ink) return ink;
    textcardCanvas ||= doc.createElement('canvas').getContext('2d');
    const c = textcardCanvas;
    c.font = font; c.textAlign = 'left'; c.textBaseline = 'ideographic';
    const m = c.measureText(ch);
    c.textBaseline = 'alphabetic';
    const a = c.measureText(ch);
    // ideo: relative to the em box bottom (vertical upright); alpha: relative to the alphabetic baseline, which sits
    // fontBoundingBoxAscent below the top of the inline content area (horizontal).
    ink = {left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, top: -m.actualBoundingBoxAscent, bottom: m.actualBoundingBoxDescent, width: m.width,
        alphaTop: -a.actualBoundingBoxAscent, alphaBottom: a.actualBoundingBoxDescent, ascent: a.fontBoundingBoxAscent};
    if (textcardInkCache.size > 4000) textcardInkCache.clear();
    textcardInkCache.set(key, ink);
    return ink;
}
// The offset of a block follows from its layout alone, so it is kept per (card attributes, card size, block class and
// box size, and each text run's class, font, writing mode, letter-spacing and text): a repeated card skips the glyph walk.
// Nothing is kept while a font is loading (the glyphs may still be a fallback) and the cache empties when one finishes.
const textcardCenterCache = new Map();
let textcardCenterFonts = null;
function textcardCenterCacheable(doc) {
    if(disposed)return false;
    const fonts = doc.fonts;
    if (!fonts) return false;
    if (textcardCenterFonts !== fonts) {
        textcardCenterFonts?.removeEventListener?.('loadingdone',invalidate);
        textcardCenterFonts = fonts;
        textcardCenterCache.clear();
        fonts.addEventListener?.('loadingdone', invalidate);
    }
    return fonts.status === 'loaded';
}
// Stage units: a docked stage is only scaled (createModStageDock); glyph metrics are in CSS px of the card.
function textcardLocalRect(r, k) {
    return k === 1 ? r : {left: r.left * k, right: r.right * k, top: r.top * k, bottom: r.bottom * k, width: r.width * k, height: r.height * k};
}
function textcardCenterOffset(doc, block, box, runs, k = 1) {
    const range = doc.createRange();
    let ink = null;
    for (const {text, style, vertical, size, font} of runs) {
        const value = text.nodeValue;
        for (let i = 0; i < value.length;) {
            const code = value.codePointAt(i), len = code > 0xffff ? 2 : 1, ch = value.slice(i, i + len);
            range.setStart(text, i); range.setEnd(text, i + len); i += len;
            if (!ch.trim()) continue;
            const r = textcardLocalRect(range.getBoundingClientRect(), k);
            if (!r.width && !r.height) continue;
            const table = vertical ? textcardVertInk(style, ch) : null;
            if (table) {
                const left = r.left + (r.width - size) / 2, em = size / 1000;
                const rect = {left: left + table[0] * em, right: left + size - table[1] * em, top: r.top + table[2] * em, bottom: r.top + size - table[3] * em};
                ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
                continue;
            }
            const g = textcardGlyphInk(doc, font, ch);
            if (!(g.right > g.left)) continue;
            // Horizontal: the em box starts at the glyph's advance origin. Vertical upright: the em box is centred in
            // the column and its ideographic bottom sits one em below the glyph's top.
            const x0 = vertical ? r.left + (r.width - g.width) / 2 : r.left, base = vertical ? r.top + size : r.top + g.ascent;
            const rect = {left: x0 + g.left, right: x0 + g.right, top: base + (vertical ? g.top : g.alphaTop), bottom: base + (vertical ? g.bottom : g.alphaBottom)};
            ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
        }
    }
    range.detach?.();
    if (!ink) return '';
    const dx = (box.left + box.right) / 2 - (ink.left + ink.right) / 2;
    const dy = block.dataset.tcCenter === 'xy' ? (box.top + box.bottom) / 2 - (ink.top + ink.bottom) / 2 : 0;
    return Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px' : '';
}
// Writes, then reads, then writes: every block's translate is cleared first, all of them are measured against one
// layout (blocks are never nested, so one block's translate cannot move another), and the offsets are written last.
function textcardCenter(card) {
    if(disposed)return;
    const doc = card.ownerDocument, view = doc.defaultView;
    const blocks = [...card.querySelectorAll('[data-tc-center]')];
    for (const block of blocks) block.style.translate = '';
    const cacheable = textcardCenterCacheable(doc);
    const d = card.dataset, cardKey = [d.layout, d.style, d.dir, d.face, d.size, d.motif, d.anchor, d.reduced, card.clientWidth, card.clientHeight].join('\u0001');
    const stage = card.closest('.fork-gal-stage'), outer = stage && blocks.length ? stage.getBoundingClientRect() : null;
    const k = outer && outer.width > 0 && Math.abs(outer.width - stage.offsetWidth) >= 1 ? stage.offsetWidth / outer.width : 1;
    const offsets = blocks.map(block => {
        const box = textcardLocalRect(block.getBoundingClientRect(), k);
        if (!box.width || !box.height) return '';
        const walker = doc.createTreeWalker(block, 4), runs = [];
        let key = cardKey + '\u0002' + block.className + '\u0001' + block.dataset.tcCenter + '\u0001' + box.width + '\u0001' + box.height;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const style = view.getComputedStyle(text.parentElement), vertical = style.writingMode.startsWith('vertical');
            const size = parseFloat(style.fontSize), font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
            runs.push({text, style, vertical, size, font});
            key += '\u0002' + text.parentElement.className + '\u0001' + font + '\u0001' + style.writingMode + '\u0001' + style.letterSpacing + '\u0001' + text.nodeValue;
        }
        if (cacheable && textcardCenterCache.has(key)) return textcardCenterCache.get(key);
        const offset = textcardCenterOffset(doc, block, box, runs, k);
        if (cacheable) {
            if (textcardCenterCache.size > 256) textcardCenterCache.clear();
            textcardCenterCache.set(key, offset);
        }
        return offset;
    });
    blocks.forEach((block, i) => { if (offsets[i]) block.style.translate = offsets[i]; });
}

return {center:textcardCenter,offset:textcardCenterOffset,vertical:textcardVertInk,cacheable:textcardCenterCacheable,dispose(){
    if(disposed)return;disposed=true;
    const fonts=textcardCenterFonts;textcardCenterFonts=null;textcardCanvas=null;textcardInkCache.clear();textcardCenterCache.clear();
    fonts?.removeEventListener?.('loadingdone',invalidate);
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTextcardCenter};
