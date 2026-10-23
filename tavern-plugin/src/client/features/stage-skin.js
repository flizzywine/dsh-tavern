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
