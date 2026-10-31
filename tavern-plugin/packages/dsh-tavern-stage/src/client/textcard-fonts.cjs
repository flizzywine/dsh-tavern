function createStageTextcardFonts({document,FontFace,fonts:tavernFonts}) {
let disposed=false;const localFonts=new Set();
// ---------- fonts ----------
// TEXTCARD_FACE is the one place that picks the card face. `library`: a font-library id, registered on demand, full font (no per-sample subset).
// `local`: installed full / PostScript names tried first through local(), for trying faces that are not in the library
// (never shipped); one installed face serves every card weight, like the single-weight HGP明朝B of the 物語 cards.
// If none is installed the library face is used. The tategaki punctuation table (textcard-vert-ink.cjs) was
// generated from the library's Noto Serif SC and applies only while that face renders.
const TEXTCARD_FACE = Object.freeze({library: 'noto-serif-sc', local: Object.freeze([])});
const TEXTCARD_LOCAL_FAMILY = 'DSH Textcard Local';
function textcardLocalFace(face) {
    if (!face.local.length || typeof document === 'undefined' || !document.fonts || typeof FontFace !== 'function') return Promise.resolve(null);
    const src = face.local.map(name => 'local(' + JSON.stringify(name) + ')').join(', ');
    const font = new FontFace(TEXTCARD_LOCAL_FAMILY, src, {weight: '100 900', display: 'block'});
    return font.load().then(() => { if(disposed)return null;document.fonts.add(font);localFonts.add(font); return JSON.stringify(TEXTCARD_LOCAL_FAMILY); }, () => null);
}
let textcardFamily = null, textcardFamilyValue;
function textcardFonts() {
    if(disposed)return Promise.resolve(null);
    if (textcardFamily) return textcardFamily;
    const library = () => typeof tavernFonts === 'object' && tavernFonts && tavernFonts.ensure
        ? Promise.resolve(tavernFonts.ensure(TEXTCARD_FACE.library)).then(font => font && font.family || null, () => null) : Promise.resolve(null);
    textcardFamily = textcardLocalFace(TEXTCARD_FACE).then(local => local || library());
    textcardFamily.then(value => { if(!disposed)textcardFamilyValue = value; });
    return textcardFamily;
}
const textcardGlyphs = plan => [...new Set(plan.frames.flatMap(frame => [...JSON.stringify(frame.state)]))].join('').slice(0, 400) || '文';
const textcardFaces = family => [400, 500, 700].map(weight => weight + ' 40px ' + family.split(',')[0]);
async function textcardFontsReady(plan, family) {
    if (disposed || !family || typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(textcardFaces(family).map(face => document.fonts.load(face, textcardGlyphs(plan))));
}
// Synchronous: the family is known and every face the plan needs is loaded (or there is no library to wait for).
function textcardFontsLoaded(plan) {
    if (disposed || textcardFamilyValue === undefined) return false;
    if (!textcardFamilyValue || typeof document === 'undefined' || !document.fonts) return true;
    try { return textcardFaces(textcardFamilyValue).every(face => document.fonts.check(face, textcardGlyphs(plan))); } catch (_) { return false; }
}

return {ensure:textcardFonts,ready:textcardFontsReady,loaded:textcardFontsLoaded,dispose(){if(disposed)return;disposed=true;textcardFamily=null;textcardFamilyValue=undefined;for(const font of localFonts)document.fonts.delete(font);localFonts.clear();}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTextcardFonts};
