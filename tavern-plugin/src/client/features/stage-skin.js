// The stage skin's interpreter: a dsh.skin/1 document (lib/domain/stage-skin.js) becomes the tokens on the stage root.
// One generic path for every skin, the built-in 经典 included; the stage CSS reads only these tokens, never a skin id.
// Skins are checked where they enter, so a document is drawn as given and never checked again here.

// The text box, its name plate and the reading text. The player's text size and layout stay authoritative.
function stageSkinTokens(document) {
	const p = document.textbox.paint, shape = document.textbox.shape || {}, n = document.nameplate;
	const tokens = { "--gal-skin-bg": p.bg, "--gal-skin-fg": p.fg, "--gal-skin-muted": p.fgMuted || p.fg, "--gal-skin-accent": document.textStyle?.emphasis || p.accent || p.fg,
		"--gal-skin-border": p.border || p.fg, "--gal-skin-radius": (shape.radius ?? 8) + "px", "--gal-skin-border-width": (shape.borderWidth ?? 1) + "px",
		"--gal-skin-name-bg": n.paint.bg, "--gal-skin-name-fg": n.paint.fg, "--gal-skin-name-rotate": (n.rotate || 0) + "deg",
		"--gal-skin-name-radius": n.shape === "pill" ? "99px" : "2px",
		"--gal-skin-weight": String(document.textStyle?.weight || 400), "--gal-skin-spacing": (document.textStyle?.letterSpacing ?? 0.03) + "em",
		"--gal-skin-line-height": String(document.textStyle?.lineHeight || 1.7),
		// textFx: the ink a glyph enters in (flash) and the side a stamp drops from (tavern.css 「stage typewriter」).
		"--gal-skin-flash": document.textFx.flash || document.textStyle?.emphasis || p.fg, "--gal-skin-stamp-y": document.textFx.from === "bottom" ? "16px" : "-16px",
		...stageSkinGlyphPoses(document.textFx), ...stageSkinQuickMenu(document), ...stageSkinNarrationTokens(document.art),
		// textStyle.narration: narration's own ink in the box (data-fk-skin-narration-ink).
		...(document.textStyle?.narration ? { "--gal-skin-narration": document.textStyle.narration } : {}) };
	let spread = 0;
	tokens["--gal-skin-rings"] = (shape.rings || []).map(ring => `0 0 0 ${spread += ring.width}px ${ring.color}`).join(",") || "none";
	return Object.assign(tokens, stageSkinPanelTokens(document));
}

// textFx.poses as the glyph copy's tokens (tavern.css 「stage typewriter」): per pose its transform, filter and ink.
function stageSkinGlyphPoses(fx) {
	const tokens = {};
	(fx.poses || []).forEach((pose, i) => {
		const scale = pose.scale ?? 1, p = "--gal-hop-" + i;
		tokens[p + "-t"] = `translate(${pose.dx || 0}em, ${pose.dy || 0}em) rotate(${pose.rot || 0}deg) scale(${(pose.sx ?? 1) * scale}, ${(pose.sy ?? 1) * scale}) skewX(${pose.skew || 0}deg)`;
		tokens[p + "-f"] = pose.blur ? `blur(${pose.blur}em)` : "none";
		tokens[p + "-c"] = pose.ink === "flash" ? "var(--gal-skin-flash)" : pose.ink === "accent" ? "var(--gal-skin-accent)" : "var(--gal-skin-fg)";
	});
	return tokens;
}

// art.narration (tavern.css 「stage narration」): the boxless narration in px of the design screen - its size, pitch, veil and
// centre (y, by default the middle), and the band's (by default 30 / 43 px, veil 80/255, on the bottom edge). The design width
// bounds the px as it does the art layer's; without art.screenWidth the screen is 16:9. It needs no image, so it is drawn
// from the document alone. The boxless words take ink (by default a light subtitle ink) and halo (by default a dark glow;
// false = none; a declared halo is one shadow in design px), and the veil is veilColor (by default black) at veil / band.veil.
function stageSkinNarrationTokens(art) {
	const narration = art && art.narration;
	if (!narration) return {};
	const band = narration.band || {}, halo = narration.halo, rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).join(" ");
	const ink = narration.ink || STAGE_NARRATION_INK, u = value => "calc(" + (value || 0) + " * var(--nar-u))";
	return { "--art-nar-ink": ink, "--art-nar-ink-rgb": rgb(ink), "--art-nar-veil-rgb": rgb(narration.veilColor || "#000000"),
		"--art-nar-halo": halo === false ? "none" : halo ? [u(halo.x), u(halo.y), u(halo.blur), "rgb(" + rgb(halo.color) + " / " + (halo.alpha ?? 1) + ")"].join(" ")
			: "0 0 2px #000, 0 1px 3px rgb(0 0 0 / .95), 0 0 14px rgb(0 0 0 / .65)", "--nar-screen": String(art.screen), "--nar-screen-w": String(art.screenWidth || Math.round(art.screen * 16 / 9)),
		"--art-nar-font": String(narration.font), "--art-nar-pitch": String(narration.pitch), "--art-nar-veil": String(narration.veil), "--art-nar-y": String(narration.y ?? art.screen / 2),
		"--art-nar-band-font": String(band.font ?? 30), "--art-nar-band-pitch": String(band.pitch ?? 43), "--art-nar-band-veil": String(band.veil ?? Math.round(80 / 255 * 1000) / 1000),
		"--art-nar-band-bottom": String(band.bottom ?? 0) };
}

// The control row sits on the text box with no plate of its own: the skin's own ink at rest (quickMenu.fg, else fgMuted,
// else fg) and its accent when hovered or on, over solid accent-tinted chips. Every pair keeps >= 3:1 against what it sits on.
function stageSkinQuickMenu(document) {
	const p = document.textbox.paint, bg = p.bg;
	const mix = (a, b, t) => "#" + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("");
	const ok = (ink, paint) => skinContrast(ink, paint) + 1e-6 >= 3;
	const idle = [document.quickMenu?.fg, p.fgMuted, p.fg].find(ink => ink && ok(ink, bg)) || p.fg;
	const on = [document.textStyle?.emphasis, p.accent, p.fg].find(ink => ink && ok(ink, bg)) || p.fg;
	const chip = (t, ink) => { for (let k = t; k > 0; k -= .02) { const paint = mix(on, bg, k); if (ok(ink, paint)) return paint; } return bg; };
	return { "--gal-skin-qm-idle": idle, "--gal-skin-qm-on": on, "--gal-skin-qm-hover": chip(.16, on), "--gal-skin-qm-active": chip(.24, on) };
}

// The stage's own panels (the input under the box) take the skin's ui paint, else its text box paint: an accent that
// reads on the surface and an ink that reads on the accent.
function stageSkinPanelTokens(document) {
	const p = { ...document.textbox.paint, ...document.ui }, ink = p.fg;
	const accent = [p.accent, document.textStyle?.emphasis, ink].find(value => value && skinContrast(value, p.bg) >= 4.5);
	const onAccent = p.onAccent && skinContrast(p.onAccent, accent) >= 4.5 ? p.onAccent : skinContrast("#ffffff", accent) >= 4.5 ? "#ffffff" : "#000000";
	const muted = p.fgMuted || ink;
	return { "--gal-ui-surface": p.bg, "--gal-ui-ink": ink, "--gal-ui-muted": muted, "--gal-ui-line": p.border || muted, "--gal-ui-accent": accent, "--gal-ui-accent-ink": onAccent,
		"--gal-ui-radius": (document.ui?.radius ?? document.textbox.shape?.radius ?? 10) + "px" };
}

// font (tavern.css 「stage skin: fonts」): the stage's three type roles - body the reading text, name the speaker's name, ui
// the rest of the stage. A role's id is one of the skin's own faces (font.faces) or a family of the font library (`library`,
// the families listed so far: tavernFontLibrary); the first of [the role's own id, body] that resolves draws it, ahead of
// the stage's stack. A face's fallback (a library family) follows it, for the glyphs the face lacks. Nothing that resolves:
// the stack alone. useStageSkinFonts loads what the roles name.
const STAGE_FONT_STACK = '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const stageSkinFaceFamily = id => "DSH Skin " + id;
// role -> the families it is drawn in, in order: {family, face: the face id} or a library family entry.
function stageSkinFontRoles(font, library) {
	const faces = font.faces || {}, family = id => library.find(item => item.id === id);
	const pick = id => {
		if (!id) return null;
		if (!Object.hasOwn(faces, id)) return family(id) ? [family(id)] : null;
		const backup = faces[id].fallback && family(faces[id].fallback);
		return [{ family: stageSkinFaceFamily(id), face: id }, ...(backup ? [backup] : [])];
	};
	return Object.fromEntries([["body", [font.body]], ["name", [font.name, font.body]], ["ui", [font.ui, font.body]]]
		.map(([role, ids]) => [role, ids.map(pick).find(Boolean) || []]));
}
function stageSkinFontTokens(font, library) {
	return Object.fromEntries(Object.entries(stageSkinFontRoles(font, library))
		.map(([role, families]) => ["--gal-skin-font-" + role, [...families.map(item => JSON.stringify(item.family)), STAGE_FONT_STACK].join(", ")]));
}

// The root's style and marks for a skin: data-fk-skin names the drawn skin; the control row's place (quickMenu.place: the box's
// top-right or bottom-right corner), where it stands on phones (narrow top / edge; bottom is the placed default) and whether
// it is drawn from the skin's icons. A folded menu (layout capsule / orb) has no row to place.
function stageSkinRoot(document, library = []) {
	const tx = stageSkinTransitions(document);
	const root = { style: { ...stageSkinTokens(document), ...stageSkinFontTokens(document.font, library), ...tx.tokens }, "data-fk-skin": document.id }, menu = document.quickMenu;
	if (tx.marks) root["data-fk-tx"] = tx.marks;
	if (document.textStyle?.narration) root["data-fk-skin-narration-ink"] = "";
	if (menu && (!menu.layout || menu.layout === "bar")) {
		if (menu.place) root["data-fk-skin-controls-place"] = menu.place;
		if (menu.place && ["top", "edge"].includes(menu.narrow)) root["data-fk-skin-controls-narrow"] = menu.narrow;
		if (menu.icons) root["data-fk-skin-controls-icons"] = "";
	}
	return root;
}

// transitions (tavern.css 「stage choices」): per declared surface and phase (data-fk-tx lists them, e.g. "choices-enter") its
// duration, ease, delay and row stagger, and where it moves from - the pose, the fade and the wipe's closed shape (and the open
// one it grows to) - as tokens one keyframe reads. choices.leave holds the pick for its delay + ms before it is sent.
const STAGE_SKIN_TX_EASE = Object.freeze({ linear: "linear", out: "cubic-bezier(.2,.7,.3,1)", "in-out": "cubic-bezier(.65,0,.35,1)", back: "cubic-bezier(.34,1.56,.64,1)", snap: "cubic-bezier(.86,0,.07,1)",
	"expo-out": "cubic-bezier(.16,1,.3,1)", "quint-out": "cubic-bezier(.22,1,.36,1)", emphasized: "cubic-bezier(.2,0,0,1)", "emphasized-out": "cubic-bezier(.05,.7,.1,1)", "emphasized-in": "cubic-bezier(.3,0,.8,.15)", spring: "cubic-bezier(.3,1.3,.5,1)" });
// A wipe's clip path, open (the row whole) or closed (nothing shown), in % of the row; the closed shapes grow from `at`
// far enough to cover the row from any point.
function stageSkinWipeClip(wipe, open) {
	const [x, y] = (wipe.at || [.5, .5]).map(v => Math.round(v * 1000) / 10), r = (n, k) => Math.round((n + k) * 10) / 10 + "%", k = open ? 1 : 0;
	const poly = points => "polygon(" + points.map(([dx, dy]) => r(x, dx) + " " + r(y, dy)).join(",") + ")";
	switch (wipe.shape) {
	case "circle": return `circle(${open ? 150 : 0}% at ${x}% ${y}%)`;
	case "rect": return poly([[-100 * k, -100 * k], [100 * k, -100 * k], [100 * k, 100 * k], [-100 * k, 100 * k]]);
	case "diamond": return poly([[0, -200 * k], [200 * k, 0], [0, 200 * k], [-200 * k, 0]]);
	case "triangle": return poly([[0, -420 * k], [370 * k, 260 * k], [-370 * k, 260 * k]]);
	case "left": return open ? "inset(0 0 0 0)" : "inset(0 100% 0 0)";
	case "right": return open ? "inset(0 0 0 0)" : "inset(0 0 0 100%)";
	case "up": return open ? "inset(0 0 0 0)" : "inset(100% 0 0 0)";
	default: return open ? "inset(0 0 0 0)" : "inset(0 0 100% 0)";
	}
}
function stageSkinTransitions(document) {
	const tokens = {}, phases = [], choices = document.transitions?.choices || {};
	for (const [phase, t] of Object.entries(choices)) {
		const p = "--tx-choices-" + phase, pose = t.pose || {};
		phases.push("choices-" + phase);
		Object.assign(tokens, { [p + "-ms"]: t.ms + "ms", [p + "-ease"]: Array.isArray(t.ease) ? "cubic-bezier(" + t.ease.join(",") + ")" : STAGE_SKIN_TX_EASE[t.ease || "out"],
			[p + "-delay"]: (t.delay || 0) + "ms", [p + "-stagger"]: (t.stagger || 0) + "ms", [p + "-o"]: t.fade ? "0" : "1",
			[p + "-t"]: t.pose ? `translate(${pose.dx || 0}%, ${pose.dy || 0}%) rotate(${pose.rot || 0}deg) scale(${pose.scale ?? 1})` : "none",
			[p + "-clip"]: t.wipe ? stageSkinWipeClip(t.wipe, false) : "none", [p + "-open"]: t.wipe ? stageSkinWipeClip(t.wipe, true) : "none" });
	}
	if (choices.leave) tokens["--tx-choices-pick-ms"] = String(choices.leave.ms + (choices.leave.delay || 0));
	return { tokens, marks: phases.join(" ") };
}

// quickMenu.icons / button: each control the skin draws, by action (auto, skip, back, ...), from the decoded files - its image,
// its `on` image while it runs, and the button body every icon stands on (normal / hover / on / disabled, the glyph box in
// fractions of the body, the body's aspect). The stage keeps the buttons, their actions, names and keys.
function stageSkinControlIcons(document, files) {
	const icons = {}, menu = document.quickMenu;
	if (!files || !menu || menu.layout && menu.layout !== "bar") return icons;
	for (const [action, icon] of Object.entries(menu.icons || {})) if (files[icon.image]) icons[action] = { image: files[icon.image].url, on: icon.on && files[icon.on] ? files[icon.on].url : null };
	const button = menu.button, body = button && files[button.normal];
	if (body) {
		const state = key => button[key] && files[button[key]] ? files[button[key]].url : null;
		const shared = { normal: body.url, hover: state("hover"), on: state("on"), disabled: state("disabled"), glyph: button.glyph, aspect: Math.round(body.width / body.height * 10000) / 10000 };
		for (const icon of Object.values(icons)) icon.button = shared;
	}
	return icons;
}
// The quick menu's files (icons and button states), read with the art from the skin's lease.
function stageSkinQuickImages(document) {
	const menu = document.quickMenu, button = menu && menu.button;
	if (!menu || menu.layout && menu.layout !== "bar") return [];
	return [...Object.values(menu.icons || {}).flatMap(icon => [icon.image, icon.on]), ...(button ? [button.normal, button.hover, button.on, button.disabled] : [])].filter(Boolean);
}

// The art layer (dsh.skin/1 `art`): the skin's own images as the text box, its name plate, the page cue and the auto lamp,
// in px of the skin's design screen (art.screen high, art.screenWidth wide). One art px is --art-u (tavern.css «stage skin:
// art»). Images come from the skin's bundle under one lease (castStage `skin.base`); a declared image that does not load
// drops the whole art layer, never part of it. The stage draws the parts it has; the other art parts wait for theirs.

// The images the drawn parts read, as paths relative to the skin document.
function stageSkinArtImages(document) {
	const box = document.art?.textbox, plate = document.art?.nameplate, frame = stageSkinPortrait(document)?.frame;
	if (!box) return [];
	const choices = document.art.choices;
	return [...new Set([...Object.values(box.images), box.next && stageSkinImageOf(box.next), box.lamp?.image, plate?.image,
		...(frame ? [frame.image, frame.glass, frame.back, frame.speaking] : []),
		...(choices ? [...Object.values(choices.images), choices.focus?.image, choices.focus?.alt] : [])].filter(Boolean))];
}
// The face window the stage draws (art.portrait with the speaker's avatar; a bust cut from the stage figure is not drawn here).
function stageSkinPortrait(document) {
	const portrait = document.art?.portrait;
	return portrait && (portrait.source || "avatar") === "avatar" ? portrait : null;
}
// Everything the stage reads from the skin's bundle: the art and the quick menu's icons.
function stageSkinImages(document) {
	return [...new Set([...stageSkinArtImages(document), ...stageSkinQuickImages(document)])];
}

// frames (skinFrames) on an image of w x h px: the cell, the sheet's background size, one cycle, the iteration count and the
// rest frame (the first when looping, the last when played once).
function stageSkinFrames(frames, [w, h]) {
	const n = frames.count || frames.columns * frames.rows, loop = frames.loop !== false;
	return { cell: [Math.round(w / frames.columns * 1000) / 1000, Math.round(h / frames.rows * 1000) / 1000], size: `${frames.columns * 100}% ${frames.rows * 100}%`,
		ms: Math.round(n / frames.fps * 1000), loop, rest: stageSkinFramePosition(frames, loop ? 0 : n - 1) };
}
function stageSkinFramePosition({ columns, rows }, i) {
	return `${columns > 1 ? (i % columns) * 100 / (columns - 1) : 0}% ${rows > 1 ? Math.floor(i / columns) * 100 / (rows - 1) : 0}%`;
}
// A frames slot's cells as discrete background positions, row-major, for Element.animate (step-end holds each cell).
function stageSkinFrameKeys(frames) {
	const n = frames.count || frames.columns * frames.rows;
	return [...Array.from({ length: n }, (_, i) => ({ offset: i / n, backgroundPosition: stageSkinFramePosition(frames, i) })), { offset: 1, backgroundPosition: stageSkinFramePosition(frames, n - 1) }];
}

// The art layer's marks and --art-* tokens for the stage root, from the decoded images (`files`: path -> { url, width,
// height }), or null when the skin has no text box art or one of its images is missing.
function stageSkinArt(document, files) {
	const art = document.art, box = art?.textbox;
	if (!box || !files || stageSkinArtImages(document).some(name => !files[name])) return null;
	const url = name => 'url("' + files[name].url + '")', n = value => String(Math.round(value * 1000) / 1000);
	// scale: design px per image px (one value or [x, y]); 1 = the image's natural size.
	const size = (name, scale = 1) => [files[name].width, files[name].height].map((px, i) => Math.round(px * [].concat(scale)[Math.min(i, [].concat(scale).length - 1)] * 1000) / 1000);
	const [w, h] = size(box.images.plain, box.scale), [x, y, bw, bh] = box.body, [left, right, middle] = box.text;
	// --art-screen-w: the width that bounds the art px; without a declared one the box fits its share of the stage width.
	const marks = { "data-fk-skin-art": "box" }, tokens = { "--art-screen": n(art.screen), "--art-screen-w": n(art.screenWidth || w / (box.fit || .96)),
		"--art-img-w": n(w), "--art-img-h": n(h), "--art-body-x": n(x), "--art-body-y": n(y), "--art-body-w": n(bw), "--art-body-h": n(bh), "--art-bottom": n(box.bottom),
		"--art-text-l": n(left), "--art-text-r": n(right), "--art-text-y": n(middle), "--art-font": n(box.font), "--art-lines": n(box.lines), "--art-plain": url(box.images.plain) };
	if (box.fit) tokens["--art-fit"] = n(box.fit);
	// narration: the narration page's own box image.
	if (box.images.narration) tokens["--art-narration"] = url(box.images.narration);
	if (box.pitch) { marks["data-fk-skin-art-pitch"] = ""; tokens["--art-pitch"] = n(box.pitch); }
	if (box.align) marks["data-fk-skin-art-align"] = box.align;
	if (box.stroke) { marks["data-fk-skin-art-stroke"] = ""; Object.assign(tokens, { "--art-text-stroke": box.stroke.color, "--art-text-stroke-w": n(box.stroke.width) }); }
	// slice: the box image 9-sliced on phones (in the image's own px; widths in design px). Default: everything outside the
	// text block (centred on text[2], lines x the pitch) and the body's own edges stays as drawn.
	{
		const [sx, sy] = [].concat(box.scale ?? 1).concat(box.scale ?? 1), round = v => String(Math.max(0, Math.round(v * 100) / 100));
		const block = box.lines * (box.pitch || box.font * 1.6), top = box.align === "top" ? middle : middle - block / 2;
		const edges = stageSkinSliceEdges(box.slice) || [Math.max(y, top) / sy, Math.max(0, w - right) / sx, Math.max(h - y - bh, h - top - block) / sy, Math.max(0, left) / sx];
		Object.assign(tokens, { "--art-sl": edges.map(round).join(" "), "--art-sl-t": round(edges[0] * sy), "--art-sl-r": round(edges[1] * sx), "--art-sl-b": round(edges[2] * sy), "--art-sl-l": round(edges[3] * sx) });
	}
	// The page cue: none when the original has none, else the skin's own image centred on cue[0], resting on cue[1]; frames
	// play it as cells of its sheet. Without an image the engine's cue is drawn there.
	const cue = Array.isArray(box.cue) ? box.cue : [0, 0, 0], frames = {};
	Object.assign(tokens, { "--art-cue-x": n(cue[0]), "--art-cue-y": n(cue[1]), "--art-cue-h": n(cue[2]), "--art-rise": n(box.rise || 0) });
	if (!box.cue) marks["data-fk-skin-art-cue"] = "none";
	else if (box.next) {
		const image = stageSkinImageOf(box.next), sheet = box.next.frames && stageSkinFrames(box.next.frames, size(image, box.scale)), [nw, nh] = sheet ? sheet.cell : size(image, box.scale);
		marks["data-fk-skin-art-cue"] = box.cue === "inline" ? "inline-image" : "image";
		Object.assign(tokens, { "--art-next": url(image), "--art-next-w": n(nw), "--art-next-h": n(nh) });
		if (sheet) { marks["data-fk-skin-art-cue-frames"] = ""; Object.assign(tokens, { "--art-next-sheet": sheet.size, "--art-next-rest": sheet.rest }); frames.next = { ...sheet, keys: stageSkinFrameKeys(box.next.frames) }; }
	} else marks["data-fk-skin-art-cue"] = box.cue === "inline" ? "inline" : "glyph";
	if (box.bob) marks["data-fk-skin-art-bob"] = box.bob;
	// The lamp: the original's AUTO image while auto paging runs (blink / spin over period s, or frames of its sheet).
	if (box.lamp) {
		const l = box.lamp, sheet = l.frames && stageSkinFrames(l.frames, size(l.image, l.scale)), [lw, lh] = sheet ? sheet.cell : size(l.image, l.scale);
		marks["data-fk-skin-art-lamp"] = sheet ? "frames" : l.motion || "";
		Object.assign(tokens, { "--art-lamp": url(l.image), "--art-lamp-x": n(l.x), "--art-lamp-y": n(l.y), "--art-lamp-w": n(lw), "--art-lamp-h": n(lh), "--art-lamp-t": (l.period || 1) + "s" });
		if (sheet) { Object.assign(tokens, { "--art-lamp-sheet": sheet.size, "--art-lamp-rest": sheet.rest }); frames.lamp = { ...sheet, keys: stageSkinFrameKeys(l.frames) }; }
		if (l.swap) marks["data-fk-skin-art-lamp-swap"] = "";
	}
	// The name on the box: the layout's plate placed at x / y, or the skin's own plate image (9-sliced to grow along the name
	// with slice), the name in a two-band fill under its outline with fill.
	const plate = art.nameplate;
	if (plate) {
		marks["data-fk-skin-art-name"] = "";
		if (plate.vertical) marks["data-fk-skin-art-name-vertical"] = "";
		Object.assign(tokens, { "--art-np-x": n(plate.x), "--art-np-y": n(plate.y), "--art-np-w": n(plate.w || 0), "--art-np-h": n(plate.h), "--art-np-font": n(plate.font), "--art-np-stroke": n(plate.stroke || 0), "--art-np-weight": String(plate.weight || 500) });
		if (plate.image) {
			const [pw, ph] = size(plate.image, plate.scale);
			marks["data-fk-skin-art-name"] = "image";
			Object.assign(tokens, { "--art-np-img": url(plate.image), "--art-np-w": n(pw), "--art-np-h": n(ph), "--art-np-text": n(plate.text || 0) });
			if (plate.center != null && !plate.slice) { marks["data-fk-skin-art-np-center"] = ""; tokens["--art-np-center"] = n(plate.center); }
			if (plate.slice) {
				const [sx, sy] = [].concat(plate.scale ?? 1).concat(plate.scale ?? 1), e = stageSkinSliceEdges(plate.slice), round = v => String(Math.round(v * 100) / 100);
				const pad = plate.pad || (plate.vertical ? [e[0] * sy, e[2] * sy] : [e[3] * sx, e[1] * sx]);
				marks["data-fk-skin-art-np-slice"] = "";
				Object.assign(tokens, { "--art-np-sl": e.map(round).join(" "), "--art-np-sl-t": round(e[0] * sy), "--art-np-sl-r": round(e[1] * sx), "--art-np-sl-b": round(e[2] * sy), "--art-np-sl-l": round(e[3] * sx),
					"--art-np-grow": round(plate.grow || 0), "--art-np-pad-a": round(pad[0]), "--art-np-pad-b": round(pad[1]) });
			}
		}
		if (plate.fill) { marks["data-fk-skin-art-fill"] = ""; Object.assign(tokens, { "--art-np-fill-a": plate.fill[0], "--art-np-fill-b": plate.fill[1] }); }
		if (plate.shadow) Object.assign(tokens, { "--art-np-sx": n(plate.shadow[0]), "--art-np-sy": n(plate.shadow[1]) });
		if (plate.spacing != null) tokens["--art-np-spacing"] = plate.spacing + "em";
	}
	// controls: the control row on the box image in design px on wide stages - its right end at x, its top at y, each control
	// w x size apart by gap (tavern.css 「stage skin: box controls」).
	if (box.controls) {
		const c = box.controls;
		marks["data-fk-skin-art-controls"] = "";
		Object.assign(tokens, { "--art-qc-x": n(c.x), "--art-qc-y": n(c.y), "--art-qc-size": n(c.size), "--art-qc-w": n(c.w || c.size), "--art-qc-gap": n(c.gap || 0) });
	}
	stageSkinChoiceArt(art, art.screen - box.bottom - h, size, url, n, marks, tokens);
	const faceName = stageSkinPortraitArt(document, size, url, n, marks, tokens);
	return { marks, tokens, frames, faceName };
}

// art.choices (tavern.css 「stage skin: art choices」): the round-end menu as the skin's bar image, 9-sliced, its words in the
// text column [l, r] centred on y within band; stacked on the design centre (center, or anchor stage / above-box: the middle
// of the room above the box image, whose top is `boxTop`), gap px apart, at x; odd / even rows tilted and shifted. focus: the
// bar (and its ink, and dx aside) under the pointer or keyboard focus; alt: the even rows' own bar and focus bar.
function stageSkinChoiceArt(art, boxTop, size, url, n, marks, tokens) {
	const c = art.choices;
	if (!c) return;
	const [w, h] = size(c.images.plain), [st, sr, sb, sl] = stageSkinSliceEdges(c.slice), [left, right, middle] = c.text;
	marks["data-fk-skin-choices"] = "";
	Object.assign(tokens, { "--art-choice": url(c.images.plain), "--art-choice-off": url(c.images.off || c.images.plain), "--art-choice-w": n(w), "--art-choice-h": n(h),
		"--art-choice-st": n(st), "--art-choice-sr": n(sr), "--art-choice-sb": n(sb), "--art-choice-sl": n(sl), "--art-choice-l": n(left), "--art-choice-r": n(right), "--art-choice-y": n(middle),
		"--art-choice-font": n(c.font), "--art-choice-pitch": n(c.pitch), "--art-choice-gap": n(c.gap),
		"--art-choice-center": n(c.anchor === "above-box" ? Math.round(Math.max(0, boxTop) / 2) : c.anchor === "stage" ? art.screen / 2 : c.center) });
	if (c.anchor === "above-box") marks["data-fk-skin-choices-anchor"] = "above-box";
	if (c.band) Object.assign(tokens, { "--art-choice-top": n(c.band[0]), "--art-choice-bottom": n(c.band[1]) });
	if (c.x != null) tokens["--art-choice-x"] = n(c.x);
	if (c.align) Object.assign(tokens, { "--art-choice-align": c.align, "--art-choice-justify": c.align === "center" ? "center" : c.align === "left" ? "flex-start" : "flex-end" });
	["odd", "even"].forEach((side, i) => {
		if (c.tilt) tokens["--art-choice-tilt-" + side] = c.tilt[i] + "deg";
		if (c.stagger) tokens["--art-choice-shift-" + side] = n(c.stagger[i]);
	});
	if (c.ink) tokens["--art-choice-ink"] = c.ink;
	if (c.weight) tokens["--art-choice-weight"] = String(c.weight);
	if (c.spacing) tokens["--art-choice-spacing"] = c.spacing + "em";
	if (c.focus) {
		marks["data-fk-skin-choices-focus"] = "";
		Object.assign(tokens, { "--art-choice-focus": url(c.focus.image), "--art-choice-focus-dx": n(c.focus.dx || 0) });
		if (c.focus.ink) tokens["--art-choice-focus-ink"] = c.focus.ink;
	}
	if (c.images.alt || c.focus?.alt) {
		marks["data-fk-skin-choices-alt"] = "";
		tokens["--art-choice-alt"] = url(c.images.alt || c.images.plain);
		if (c.focus) tokens["--art-choice-focus-alt"] = url(c.focus.alt || c.focus.image);
	}
}

// The face window (art.portrait): the speaker's avatar in a square on the design screen (left / bottom / size). frame: the
// skin's frame image (left / bottom, its natural size) around a window (default the square) the face is clipped to - round
// (the window's ellipse), front (the frame over the face), glass (a sheen over the face), back (behind a cut-out face), fill
// (the window's own opaque face: a colour or a radial [centre, edge]) and speaking (the frame while the line is delivered).
// frame.name: the speaker's name along a circle on the frame (TavernStageSideName), in the frame image's own px; while it
// shows, the box's plate steps aside. narrow: where the face stands on phones (CSS px from the box's top-left corner) and how
// the lines clear it. Writes the marks and --art-face-* tokens; returns the arc name's geometry, or null.
function stageSkinPortraitArt(document, size, url, n, marks, tokens) {
	const portrait = stageSkinPortrait(document);
	if (!portrait) return null;
	let faceName = null;
	marks["data-fk-skin-portrait"] = "avatar";
	Object.assign(tokens, { "--art-face-l": n(portrait.left), "--art-face-b": n(portrait.bottom), "--art-face-s": n(portrait.size) });
	const frame = portrait.frame;
	if (frame) {
		const [fw, fh] = size(frame.image), [wl, wb, ww, wh] = frame.window || [portrait.left, portrait.bottom, portrait.size, portrait.size];
		marks["data-fk-skin-portrait-frame"] = "";
		Object.assign(tokens, { "--art-face-frame": url(frame.image), "--art-face-fl": n(frame.left), "--art-face-fb": n(frame.bottom), "--art-face-fw": n(fw), "--art-face-fh": n(fh),
			"--art-face-wl": n(wl), "--art-face-wb": n(wb), "--art-face-ww": n(ww), "--art-face-wh": n(wh) });
		if (frame.round) marks["data-fk-skin-portrait-round"] = "";
		if (frame.front) marks["data-fk-skin-portrait-front"] = "";
		if (frame.glass) { marks["data-fk-skin-portrait-glass"] = ""; tokens["--art-face-glass"] = url(frame.glass); }
		if (frame.back) { marks["data-fk-skin-portrait-back"] = ""; tokens["--art-face-back"] = url(frame.back); }
		// round: the ellipse closest-side, cut a hair inside it so the frame's inner edge covers the cut
		if (frame.fill) {
			const [inner, outer] = [].concat(frame.fill).concat([].concat(frame.fill));
			marks["data-fk-skin-portrait-fill"] = "";
			tokens["--art-face-fill"] = frame.round ? `radial-gradient(closest-side, ${inner}, ${outer} 99%, transparent 100%)` : `radial-gradient(farthest-corner, ${inner}, ${outer})`;
		}
		if (frame.speaking) { marks["data-fk-skin-portrait-speaking"] = ""; tokens["--art-face-speaking"] = url(frame.speaking); }
		// The arc's centre and radius are in design px; while the name shows there, the box's plate steps aside.
		if (frame.name) {
			const f = frame.name, [ax, ab, r] = f.arc, span = f.span || 90, top = f.side === "top";
			marks["data-fk-skin-portrait-name"] = "";
			Object.assign(tokens, { "--art-face-nink": [].concat(f.ink)[0], "--art-face-nweight": String(f.weight || 700), "--art-face-nspacing": (f.spacing || 0) + "em" });
			if (f.engrave) Object.assign(tokens, { "--art-face-nlight": f.engrave.light, "--art-face-ndark": f.engrave.dark });
			if (f.stroke) { marks["data-fk-skin-portrait-name-stroke"] = ""; tokens["--art-face-nstroke"] = f.stroke.color; }
			faceName = { view: [fw, fh], x: ax - frame.left, y: fh - (ab - frame.bottom), r, span, side: top ? "top" : "bottom", font: f.font, ink: [].concat(f.ink),
				weight: f.weight || 700, spacing: f.spacing || 0, engrave: f.engrave || null, stroke: f.stroke || null, shadow: f.shadow ? { color: f.shadow.color, dx: f.shadow.dx || 0, dy: f.shadow.dy } : null,
				bed: f.bed ? { color: f.bed.color, alpha: f.bed.alpha, width: f.bed.width || f.font } : null, min: f.min || f.font * .25 };
		}
	}
	// narrow: the side on a phone, `width` CSS px wide at x / y from the box's top-left corner; name below = the frame's name as
	// one line under it (arc keeps the arc, down to nameMin px); flow = how the lines clear it (beside its column, wrap round
	// it, below it), starting `left` px in.
	if (portrait.narrow) {
		const nw = portrait.narrow, [sw, sh] = frame ? size(frame.image) : [portrait.size, portrait.size];
		marks["data-fk-skin-portrait-narrow"] = nw.name === "arc" || !frame?.name ? "" : nw.name || "below";
		marks["data-fk-skin-portrait-flow"] = nw.flow || "beside";
		if (faceName && nw.nameMin) faceName.narrowMin = nw.nameMin;
		Object.assign(tokens, { "--art-face-nleft": n(nw.left ?? 12), "--art-face-nw": n(nw.width), "--art-face-nh": n(Math.round(nw.width * sh / sw * 10) / 10),
			"--art-face-nx": n(nw.x), "--art-face-ny": n(nw.y), "--art-face-nsw": n(sw) });
	}
	return faceName;
}

// What the stage's font roles name while the stage shows the skin (skinDocument; skin: the pack skin with its lease base,
// else null). The library families they use join the page once each (tavernFontLibrary.ensure). The skin's own faces
// (font.faces) load from its lease: each joins document.fonts at its declared weight and its text swaps in once the file has
// loaded (until then, or if it fails, the next family of the role); they leave with the skin.
function useStageSkinFonts(skin, skinDocument, library) {
	const families = Object.values(stageSkinFontRoles(skinDocument.font, library)).flat();
	const libraryKey = families.filter(item => !item.face).map(item => item.id).join(" ");
	React.useEffect(() => { libraryKey.split(" ").filter(Boolean).forEach(id => tavernFontLibrary.ensure(id)); }, [libraryKey]);
	const faces = skin && skin.base ? Object.entries(skin.document.font.faces || {}) : [];
	const key = faces.length ? JSON.stringify([skin.base, faces]) : "";
	React.useEffect(() => {
		if (!key) return undefined;
		const added = faces.map(([id, face]) => {
			const url = skin.base + face.file.split("/").map(encodeURIComponent).join("/");
			const font = new FontFace(stageSkinFaceFamily(id), "url(" + JSON.stringify(url) + ") format(\"woff2\")", { weight: String(face.weight), display: "swap" });
			document.fonts.add(font);
			font.load().catch(() => console.warn("Stage skin font unavailable: " + face.file));
			return font;
		});
		return () => added.forEach(font => document.fonts.delete(font));
	}, [key]);
}

// The decoded images of the skin on stage (its art and quick menu icons): files once every image has loaded from the skin's
// lease, else null (the document is drawn without its art). A failed load is asked again (1 s, doubling to 30 s) while the
// same skin and lease stand: one failed read at stage open must not leave the stage without its art until a refresh.
function useStageSkinArtFiles(skin) {
	const names = skin && skin.base ? stageSkinImages(skin.document) : [];
	const key = names.length ? JSON.stringify([skin.base, skin.document.id, names]) : "";
	const [state, setState] = React.useState({ key: "", files: null, tries: 0 });
	const tries = state.key === key ? state.tries : 0;
	React.useEffect(() => {
		if (!key) return undefined;
		let live = true, timer = null;
		const load = name => new Promise((resolve, reject) => {
			const image = new Image(), url = skin.base + name.split("/").map(encodeURIComponent).join("/");
			image.onload = () => resolve([name, { url, width: image.naturalWidth, height: image.naturalHeight }]);
			image.onerror = () => reject(new Error("Stage skin image unavailable: " + name));
			image.src = url;
		});
		Promise.all(names.map(load)).then(entries => {
			if (live) setState({ key, files: Object.fromEntries(entries), tries });
		}, error => {
			if (!live) return;
			console.warn(error.message);
			timer = setTimeout(() => setState({ key, files: null, tries: tries + 1 }), Math.min(30000, 1000 * 2 ** tries));
		});
		return () => { live = false; clearTimeout(timer); };
	}, [key, tries]);
	return state.key === key ? state.files : null;
}
