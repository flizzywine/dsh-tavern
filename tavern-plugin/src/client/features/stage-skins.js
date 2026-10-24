// Skins as entries of the asset library: a pack holds 皮肤 (a skin folder: skin.json and the files it declares). Which one a
// card's stage is drawn in follows one order (stage-skin-choice.js): 本卡皮肤 → the card's own → its packs' default → 默认皮肤 →
// 经典. 舞台设置 › 基础设置 sets the two players' choices; a pack's window sets its default.
const tavernSkinKey = value => typeof value === "string" ? value : value ? JSON.stringify([value.packId, value.assetId]) : "";
const TAVERN_SKIN_ERRORS = Object.freeze({ INVALID_SKIN: "不是有效的皮肤（skin.json）", SKIN_CONTRAST: "皮肤的文字对比度不够，未能添加",
	DUPLICATE_ID: "这个皮肤 id 在本包里用过了，请换一个 id", NO_SKIN: "所选文件夹里没有 skin.json" });
const tavernSkinErrorText = error => TAVERN_SKIN_ERRORS[error && error.code] || tavernAssetErrorText(error);

// A skin in small: a stage with its text box, name plate and one line, in the skin's own colours (dsh.skin/1 textbox.paint,
// nameplate.paint, textStyle.emphasis). Without a document (a skin that is gone) it is an empty frame.
function TavernSkinArt(props) {
	const h = React.createElement, skin = props.document;
	if (!skin) return h("span", { className: "dsh-tavern-skin-art is-missing" + (props.big ? " is-big" : ""), "aria-hidden": true });
	const paint = skin.textbox.paint, name = skin.nameplate.paint;
	const style = { "--skin-bg": paint.bg, "--skin-fg": paint.fg, "--skin-line": paint.border || paint.fgMuted || paint.fg, "--skin-accent": skin.textStyle?.emphasis || paint.accent || paint.fg,
		"--skin-name-bg": name.bg, "--skin-name-fg": name.fg, "--skin-radius": Math.min(6, skin.textbox.shape?.radius ?? 4) + "px" };
	return h("span", { className: "dsh-tavern-skin-art" + (props.big ? " is-big" : ""), style, "aria-hidden": true },
		h("span", { className: "dsh-tavern-skin-art-box" }, h("span", { className: "dsh-tavern-skin-art-name" }, props.big ? "？？？" : ""),
			props.big ? h("span", { className: "dsh-tavern-skin-art-line" }, "……你、你还有", h("em", null, "什么事"), "。") : h("span", { className: "dsh-tavern-skin-art-bar" })));
}

// A skin select: the trigger shows the chosen skin in small and its name; the menu lists every choice with its own
// small stage and a ✓. `choices`: { value, label, document, pack? }.
function TavernSkinPicker(props) {
	const h = React.createElement, current = props.choices.find(choice => tavernSkinKey(choice.value) === tavernSkinKey(props.value)) || null;
	return h(TavernAssetMenu, { label: props.label, className: "dsh-tavern-skin-anchor", stopClicks: true,
		trigger: menu => h("button", { type: "button", className: "dsh-tavern-skin-trigger", "aria-haspopup": "menu", "aria-expanded": menu.open, disabled: props.disabled,
			"aria-label": props.label + "：" + (current ? current.label : "不可用"), onClick: menu.toggle },
			h(TavernSkinArt, { document: current && current.document }), h("span", { className: "dsh-tavern-skin-name" }, current ? current.label : "不可用"), h(TavernAssetGlyph, { name: "chevDown" })),
		content: close => props.choices.map(choice => h("button", { key: tavernSkinKey(choice.value) || "follow", type: "button", role: "menuitemradio",
			"aria-checked": tavernSkinKey(choice.value) === tavernSkinKey(props.value), className: "dsh-tavern-asset-menu-item dsh-tavern-skin-option", title: choice.pack ? "素材包：" + choice.pack : undefined,
			onClick: () => { close(); if (tavernSkinKey(choice.value) !== tavernSkinKey(props.value)) props.onChange(choice.value); } },
			h(TavernSkinArt, { document: choice.document }), h("span", { className: "dsh-tavern-asset-menu-text" }, choice.label),
			tavernSkinKey(choice.value) === tavernSkinKey(props.value) ? h(TavernAssetGlyph, { name: "check" }) : null)) });
}

// The stored choices and the pickers' options (rpc getStageSkins); a pack or settings change reloads them.
function useTavernStageSkins(path) {
	const [state, setState] = React.useState(null);
	const load = React.useCallback(() => rpc("getStageSkins", { path }).then(setState, () => setState(current => current || { failed: true })), [path]);
	React.useEffect(() => {
		void load();
		window.addEventListener(TAVERN_ASSET_EVENT, load); window.addEventListener("dsh-tavern-settings-changed", load);
		return () => { window.removeEventListener(TAVERN_ASSET_EVENT, load); window.removeEventListener("dsh-tavern-settings-changed", load); };
	}, [load]);
	return [state, load];
}

const TAVERN_SKIN_HELP = Object.freeze({
	global: "所有卡默认用这套皮肤；卡自带皮肤、素材包有默认皮肤或选了「本卡皮肤」的卡除外。可选「全局」素材包里的皮肤。",
	card: "只换这张卡的皮肤，其他卡不受影响。可选这张卡的素材包里的皮肤；「跟随默认」用卡自带、素材包或全局的默认皮肤。"
});
// 舞台设置 › 基础设置 «默认皮肤» (every card) and, with a card open, «本卡皮肤» (this card only). Each saves at once through
// the section's `save` (正在保存… / 已保存); a choice whose skin is gone reads 「不可用」 and the stage goes down the order.
function TavernStageSkinRows(props) {
	const h = React.createElement, [state, reload] = useTavernStageSkins(props.path);
	if (!state || state.failed) return null;
	const all = [...state.globalChoices, ...(state.card ? state.card.choices : [])], documentOf = value => (all.find(choice => tavernSkinKey(choice.value) === tavernSkinKey(value)) || {}).document || null;
	const write = (method, args) => props.save(async () => {
		try { await rpc(method, args); } finally { void reload(); }
		window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
		await tavernStageRuntime.refresh(props.sessionId);
	});
	const row = (label, help, picker, missing) => h("div", { className: "dsh-tavern-switch-row dsh-tavern-skin-row" },
		h("div", { className: "dsh-tavern-switch-main" },
			h("span", { className: "dsh-tavern-switch-name" }, h(TavernAssetGlyph, { name: "skins" }), h("span", null, label),
				h("span", { className: "dsh-tavern-switch-help", role: "img", "aria-label": label + " 说明：" + help, title: help }, "?")),
			picker),
		missing ? h("p", { className: "dsh-tavern-skin-hint" }, "所选皮肤不可用，请重新选择") : null);
	const globalMissing = !state.globalChoices.some(choice => tavernSkinKey(choice.value) === tavernSkinKey(state.global));
	const card = state.card, follow = card ? { value: null, label: "跟随默认", document: documentOf(card.fallback) } : null;
	return h(React.Fragment, null,
		row("默认皮肤", TAVERN_SKIN_HELP.global, h(TavernSkinPicker, { label: "默认皮肤", choices: state.globalChoices, value: state.global, disabled: props.busy,
			onChange: skin => write("setStageSkin", { skin }) }), globalMissing),
		card ? row("本卡皮肤", TAVERN_SKIN_HELP.card, h(TavernSkinPicker, { label: "本卡皮肤", choices: [follow, ...card.choices], value: card.choice, disabled: props.busy,
			onChange: skin => write("setCardStageSkin", { path: props.path, skin }) }), card.choice !== null && !card.choices.some(choice => tavernSkinKey(choice.value) === tavernSkinKey(card.choice))) : null);
}

// 添加皮肤: a skin folder. Its skin.json (the shallowest) and the files it declares go up by their paths beside it; the host
// checks the document and every file once and keeps them as one entry.
async function tavernSkinFolderUpload(packId, files) {
	const rel = file => file.webkitRelativePath || file.name;
	const json = files.filter(file => /(^|\/)skin\.json$/.test(rel(file))).sort((a, b) => rel(a).split("/").length - rel(b).split("/").length)[0];
	if (!json) throw Object.assign(new Error("No skin.json"), { code: "NO_SKIN" });
	const dir = rel(json).slice(0, -"skin.json".length);
	let declared = [];
	try { declared = stageSkinFiles(JSON.parse(await json.text())); } catch (_error) { /* the host names what is wrong */ }
	const byPath = new Map(files.map(file => [rel(file), file]));
	const document = await tavernAssetUpload(json), uploads = [];
	for (const path of declared) if (byPath.has(dir + path)) uploads.push({ path, uploadId: (await tavernAssetUpload(byPath.get(dir + path))).uploadId });
	return rpc("addAssetPackSkin", { packId, document: document.uploadId, files: uploads });
}

// A 皮肤 entry in its pack's window: its name, the skin in small, and 包默认 (what a card binding this pack draws when it has
// no skin of its own). A skin has no lamp, trigger words or director note: the director never chooses one. ⋯ › 删除 removes it.
function TavernSkinDetail(props) {
	const h = React.createElement, asset = props.asset, pack = props.pack, isDefault = pack.manifest.stageSkin === asset.id;
	const [error, setError] = React.useState(""), [confirm, setConfirm] = React.useState(false), [busy, setBusy] = React.useState(false);
	const write = update => { setError(""); return props.commit("skins", asset.id, update).catch(err => setError(tavernAssetErrorText(err))); };
	const toggleDefault = on => { setBusy(true); setError(""); Promise.resolve(props.setPackSkin(on ? asset.id : null)).catch(err => setError(tavernAssetErrorText(err))).finally(() => setBusy(false)); };
	const menu = h(TavernAssetMenu, { label: asset.name + " 操作", trigger: m => h(TavernAssetIconButton, { icon: "more", label: "更多操作 " + asset.name, "aria-expanded": m.open, disabled: props.busy, onClick: m.toggle }),
		content: close => h(TavernAssetMenuItem, { danger: true, onClick: () => { close(); setConfirm(true); } }, "删除…") });
	return h("div", { className: "dsh-tavern-entry-detail" },
		h("div", { className: "dsh-tavern-entry-title" },
			props.back ? h("button", { type: "button", className: "dsh-tavern-asset-icon dsh-tavern-asset-back", "aria-label": "返回" + props.back.parent, title: "返回" + props.back.parent, onClick: props.back.onBack }, h(TavernAssetGlyph, { name: "back" })) : null,
			h(TavernAssetText, { key: asset.name, className: "is-title", label: "名称", value: asset.name, validate: value => !value ? "名称不能为空" : tavernAssetChars(value) > 256 ? "名称最多 256 字" : "", onCommit: value => write(current => ({ ...current, name: value })) }),
			menu),
		h(TavernAssetAlert, { error }),
		h("div", { className: "dsh-tavern-skin-hero" }, h(TavernSkinArt, { document: pack.skins && pack.skins[asset.id], big: true })),
		h("div", { className: "dsh-tavern-asset-fields", role: "group", "aria-label": asset.name + " 设置" },
			h(TavernAssetField, { label: "包默认", help: TAVERN_ASSET_HELP.packSkin },
				h("input", { type: "checkbox", role: "switch", className: "dsh-tavern-skin-switch", "aria-label": "设为本包默认皮肤", checked: isDefault, disabled: busy || props.busy, onChange: event => toggleDefault(event.target.checked) })),
			h(TavernAssetField, { label: "说明", help: TAVERN_ASSET_HELP.skin }, h("span", { className: "dsh-tavern-skin-id" }, "id：" + asset.id))),
		confirm ? h(TavernAssetConfirm, { title: "删除皮肤「" + asset.name + "」？", body: "从素材包「" + pack.manifest.name + "」中删除。正在用它的卡改用下一个默认皮肤，最后是经典。",
			confirmLabel: "删除", danger: true, onConfirm: () => props.remove(asset), onClose: () => setConfirm(false) }) : null);
}