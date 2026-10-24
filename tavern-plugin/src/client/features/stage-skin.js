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
		"--gal-skin-line-height": String(document.textStyle?.lineHeight || 1.7), ...stageSkinQuickMenu(document) };
	let spread = 0;
	tokens["--gal-skin-rings"] = (shape.rings || []).map(ring => `0 0 0 ${spread += ring.width}px ${ring.color}`).join(",") || "none";
	return Object.assign(tokens, stageSkinPanelTokens(document));
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

// The root's style and marks for a skin: data-fk-skin names the drawn skin.
function stageSkinRoot(document) {
	return { style: stageSkinTokens(document), "data-fk-skin": document.id };
}

// The art layer (dsh.skin/1 `art`): the skin's own images as the text box, its name plate, the page cue and the auto lamp,
// in px of the skin's design screen (art.screen high, art.screenWidth wide). One art px is --art-u (tavern.css «stage skin:
// art»). Images come from the skin's bundle under one lease (castStage `skin.base`); a declared image that does not load
// drops the whole art layer, never part of it. The stage draws the parts it has; the other art parts wait for theirs.

// The images the drawn parts read, as paths relative to the skin document.
function stageSkinArtImages(document) {
	const box = document.art?.textbox, plate = document.art?.nameplate;
	if (!box) return [];
	return [...new Set([...Object.values(box.images), box.next && stageSkinImageOf(box.next), box.lamp?.image, plate?.image].filter(Boolean))];
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
	return { marks, tokens, frames };
}

// The decoded art images of the skin on stage: { files } once every image the drawn parts read has loaded from the skin's
// lease, else null (the document is drawn without its art). A failed load is asked again (1 s, doubling to 30 s) while the
// same skin and lease stand: one failed read at stage open must not leave the stage without its art until a refresh.
function useStageSkinArtFiles(skin) {
	const names = skin && skin.base ? stageSkinArtImages(skin.document) : [];
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
