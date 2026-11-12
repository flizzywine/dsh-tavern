function createStageChoiceLayout({React,getComputedStyle}) {
// a bar drawn as a 9-slice border image
// shows a hairline wherever two slices meet inside a pixel - each slice is painted on its own, and the two antialiased
// edges together let the scene through (most visible on a see-through glass). Chromium places the slices on whole CSS
// px of the bar's box, then scales by the screen's pixel ratio: at 150 % (a 4K screen) a join on an odd CSS px - or on
// a fraction, as a centred list's half width gives - falls inside a device pixel. So every length that places a join
// (the list's place and size, the gaps, the bars' heights, the slice widths) is a multiple of the pixel step: the fewest
// whole CSS px that are also whole device px (1 at 100 % / 200 %, 2 at 150 %, 4 at 125 % / 175 %). The CSS rounds to
// --fk-step; a bar (or the list) whose words make it taller than its rounded height grows to the next whole step here
// (--fk-snap-h). Returns whether anything changed (the caller runs again until nothing does).
function galPixelStep(dpr) {
    for (let n = 1; n <= 4; n++) if (Math.abs(n * dpr - Math.round(n * dpr)) < 1e-6) return n;
    return 1;
}
// a skin with a focus or hover bar draws each row's bar, focus bar and hover bar in
// this decorative child (theme.css「stage skin: art choices」) - still layers the highlight shows and hides - instead
// of swapping the row's border image. Last in the row, aria-hidden, out of the flow; display none for every other skin.
function galChoiceArt() {
    return React.createElement("i", { key: "art", className: "fork-gal-choice-art", "data-fk-layer": "", "aria-hidden": "true" },
        React.createElement("i", { className: "is-bar" }, React.createElement("i")), React.createElement("i", { className: "is-focus" }, React.createElement("i")),
        React.createElement("i", { className: "is-hover" }, React.createElement("i")));
}
// The bar images of a skin's choice menu (the stage's --art-choice* tokens), decoded once per page: a row enters only after
// its bars can paint, so its words never show on a bare stage for a frame (theme.css [data-fk-wait]).
const GAL_CHOICE_BARS = ["--art-choice", "--art-choice-alt", "--art-choice-off", "--art-choice-focus", "--art-choice-focus-alt", "--art-choice-hover", "--art-choice-hover-alt", "--art-choice-tint"];
const galChoiceBarsDecoded = new Set();
function galChoiceBarUrls(list) {
    const style = getComputedStyle(list), urls = new Set();
    for (const name of GAL_CHOICE_BARS) for (const m of style.getPropertyValue(name).matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) if (m[2] && !galChoiceBarsDecoded.has(m[2])) urls.add(m[2]);
    return [...urls];
}
function galChoiceArtShown(row) {
    const art = row.lastElementChild;
    return Boolean(art && art.classList && art.classList.contains("fork-gal-choice-art") && getComputedStyle(art).display !== "none");
}
function galSnapChoices(list, dpr) {
    if (!list || !(dpr > 0) || typeof list.getBoundingClientRect !== "function") return false;
    const step = galPixelStep(dpr);
    let changed = false;
    const set = (el, name, value) => { if (el.style.getPropertyValue(name) !== value) { el.style.setProperty(name, value); changed = true; } };
    set(list, "--fk-step", step + "px");
    // The list is centred on its middle (translate -50 %), so its height is a whole number of double steps.
    for (const row of [list, ...list.children]) {
        if (row !== list && getComputedStyle(row).borderImageSource === "none" && !galChoiceArtShown(row)) continue;
        // Layout height excludes the pick animation's scale, which must not grow the frame.
        const unit = row === list ? 2 * step : step, height = parseFloat(getComputedStyle(row).height);
        if (!height) continue;
        const snapped = Math.ceil(height / unit - 1e-3) * unit;
        if (Math.abs(snapped - height) > 1e-3) set(row, "--fk-snap-h", snapped + "px");
    }
    return changed;
}
// a wide art menu whose words wrap (long suggestions: two-line bars) can be
// taller than its room even after the gaps close; it then scales once more as one (--art-choice-fit on the list, read by the
// art-choices --cu in theme.css) until it fits, down to half size, before the list scrolls. Narrow stages (no
// --art-cu0) keep their own text size and scroll. Returns whether anything changed. The rows' laid-out boxes are measured,
// not the scroll height: that counts the rows' transforms too, and the entrance (rows sliding in from ±300cu) shrank the
// menu to ~0.6 for good, so its size differed between scenes.
function galFitChoices(list) {
    const style = list && typeof getComputedStyle === "function" ? getComputedStyle(list) : null;
    if (!style || !style.getPropertyValue("--art-cu0").trim()) return false;
    const fit = parseFloat(list.style.getPropertyValue("--art-choice-fit")) || 1;
    let laid = 0;
    for (const row of list.children || []) laid = Math.max(laid, row.offsetTop + row.offsetHeight);
    const over = (laid + (parseFloat(style.paddingBottom) || 0)) / Math.max(1, list.clientHeight);
    if (!(over > 1.004) || fit <= .5) return false;
    list.style.setProperty("--art-choice-fit", String(Math.max(.5, Math.floor(fit / over * 0.995 * 1000) / 1000)));
    // The snapped heights were taken at the old size; the next pass snaps the scaled bars again.
    for (const row of [list, ...(list.children || [])]) row.style.removeProperty("--fk-snap-h");
    return true;
}
return {galPixelStep,galSnapChoices,galFitChoices,galChoiceArt,galChoiceBarUrls,galChoiceBarsDecoded};
}
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={createStageChoiceLayout};
