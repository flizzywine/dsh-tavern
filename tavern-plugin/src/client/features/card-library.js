// The library gives unlabelled copies a number while keeping the card's own name.
function cardLibraryDisplayName(card, displayName = card.displayName) {
    if (displayName) return displayName;
    const suffix = String(card.path || '').match(/ ([\(][1-9]\d*[\)])\.json$/i);
    return card.name + (suffix ? suffix[1] : '');
}

// Without the pack service (no stage package) the card page's one 「导出」 (its ⋯ › 导出) lists these formats; 加密导出 is last.
function cardExportFormats(hasImage, exportFile, encrypt) {
    return [
        { label: "DSH 人物卡", note: "可打包素材和插件", run: () => exportFile("dshcard") },
        { label: "JSON", note: "卡片数据", run: () => exportFile("json") },
        { label: "PNG", note: hasImage === false ? "需要封面" : "封面和卡片数据", disabled: hasImage === false, run: () => exportFile("png") },
        { label: "加密导出…", note: "DSH 人物卡，设置密码", run: encrypt }];
}

// One long text of the card page (角色描述, 开场白 …): a row that reads › label · its first line; open, the whole text reads as
// plain prose (no box), and ✎ (or a double click) turns it into the field, which saves when it is left.
function CardTextFold({ label, value, open, onToggle, onCommit, disabled }) {
    const h = React.createElement, [editing, setEditing] = React.useState(false);
    const preview = String(value || "").replace(/\s+/g, " ").trim();
    return h("div", { className: "dsh-card-fold", "data-open": open || undefined },
        h("div", { className: "dsh-card-fold-row" },
            h("button", { type: "button", className: "dsh-card-fold-head", "aria-expanded": open, onClick: () => { if (open) setEditing(false); onToggle(); } },
                h(packUi.Glyph, { name: "chevRight" }), h("span", { className: "dsh-card-fold-label" }, label),
                h("span", { className: "dsh-card-fold-preview" }, open ? "" : preview)),
            open && !editing && !disabled ? h("button", { type: "button", className: "ap-icon-button dsh-card-fold-edit", "aria-label": "编辑" + label, title: "编辑", onClick: () => setEditing(true) }, h(packUi.Glyph, { name: "edit" })) : null),
        open ? h("div", { className: "dsh-card-fold-body", onBlur: event => { if (editing && !event.currentTarget.contains(event.relatedTarget)) setTimeout(() => setEditing(false), 0); } },
            editing ? h(InlineField, { kind: "text", multiline: true, lines: true, wide: true, hideLabel: true, label, value, autoEdit: true, onCommit })
                : h("div", { className: "dsh-card-fold-text", onDoubleClick: disabled ? undefined : () => setEditing(true) }, value)) : null);
}

// 素材包: the stage packs this card binds (its stage settings' boundPackIds), named from the pack list; null without the
// stage package. A row opens the pack in 舞台素材, whose ‹ comes back here.
function useCardStagePacks(cardPath) {
    const service = typeof packClient === "function" ? packClient() : undefined, [packs, setPacks] = React.useState(null);
    React.useEffect(() => {
        if (!service || !cardPath) { setPacks(null); return; }
        let live = true;
        Promise.all([rpc("getCardAssetBindings", { path: cardPath, metadataOnly: true }), service.listPackSummaries()]).then(([card, rows]) => {
            // a card without the stage extension has no 素材包 section (its 画风 row needs the extension too).
            if (!(card && card.extension)) { if (live) setPacks(null); return; }
            const ids = card.extension.assetBindings && card.extension.assetBindings.boundPackIds || [];
            const byId = new Map((rows || []).map(row => [row.packId || row.manifest && row.manifest.id, row]));
            if (live) setPacks(ids.map(id => { const row = byId.get(id), manifest = row && row.manifest || {};
                return { id, name: row ? row.name || manifest.name || id : id, note: row ? row.description || manifest.description || "" : "本机没有这个素材包", missing: !row }; }));
        }, () => { if (live) setPacks(null); });
        return () => { live = false; };
    }, [cardPath, !!service]);
    return packs;
}
function openCardStagePack(packId, sessionId) {
    packNav.go({ packId, back: { label: "人物卡库", open: () => openSidebarTab("dsh-tavern:cards", sessionId).catch(error => navFailed("返回人物卡库", error)) } });
    openSidebarTab("dsh-asset-library:library", sessionId).catch(error => navFailed("打开舞台素材", error));
}

// 人物卡库's one 「导入」 (the ⤓ of 舞台素材's 获取素材包): 选择本地文件… first, with a folder (the system file picker, several at
// once; on a phone with a download folder the 从手机下载目录导入 sheet); with the card ZIP entry, 从网址导入… a quieter row
// that opens a box for a card's address in its place (pasted or typed; Enter reads it). Opening the menu focuses the first row.
function CardImportMenu({ disabled, pickFile, openAddress }) {
    const h = React.createElement, popup = useInlinePopup(), [address, setAddress] = React.useState(""), [typing, setTyping] = React.useState(false);
    const glyph = name => h(packUi.Glyph, { name });
    function read() { const url = address.trim(); if (!url) return; popup.close(false); setAddress(""); setTyping(false); openAddress(url); }
    if (!openAddress) return h("button", { type: "button", className: "ap-icon-button", "aria-label": "导入人物卡", title: "导入人物卡", disabled, onClick: pickFile }, glyph("download"));
    const toggle = () => { if (!popup.open) setTyping(false); popup.setOpen(!popup.open); };
    return h("span", { className: "fork-inline-anchor", ref: popup.root, onKeyDown: popup.keys },
        h("button", { ref: popup.trigger, type: "button", className: "ap-icon-button", "aria-label": "导入人物卡", title: "导入人物卡", disabled, "aria-haspopup": "menu", "aria-expanded": popup.open, onClick: toggle }, glyph("download")),
        popup.open ? popup.layer({ className: "fork-inline-pop dsh-tavern-card-import-pop", role: "menu", "aria-label": "导入人物卡", onKeyDown: typing ? undefined : inlineMenuKeys },
            h("button", { type: "button", role: "menuitem", className: "fork-inline-option dsh-tavern-card-import-file", onClick: () => { popup.close(false); pickFile(); } }, glyph("folder"), "选择本地文件…"),
            typing ? h("div", { className: "dsh-tavern-card-import-url" },
                h(SearchBox, { bare: true, label: "卡片网址", placeholder: "粘贴卡片网址", value: address, onChange: setAddress, spellCheck: false, autoFocus: true,
                    onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); read(); } } }),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: !address.trim(), onClick: read }, "导入"))
                : h("button", { type: "button", role: "menuitem", className: "fork-inline-option", onClick: () => setTyping(true) }, glyph("link"), "从网址导入…")) : null);
}

// The world book list's dashed ＋: a menu of the books that can still be bound (a search above 8); picking one binds it.
// `label` / `noun`: the 世界书 page binds a card with the same menu (绑定人物卡).
function WorldBookAddMenu({ choices, loading, disabled, onOpen, onPick, label = "绑定世界书", noun = "世界书" }) {
    const h = React.createElement, popup = useInlinePopup({ focusSelector: "input" }), [query, setQuery] = React.useState("");
    const needle = query.trim().toLowerCase();
    const shown = needle ? choices.filter(choice => (choice.name + " " + choice.note).toLowerCase().includes(needle)) : choices;
    const toggle = () => { if (!popup.open) { setQuery(""); onOpen(); } popup.setOpen(!popup.open); };
    return h("div", { className: "fork-inline-anchor dsh-tavern-worldbook-add-anchor", ref: popup.root, onKeyDown: popup.keys },
        h("button", { ref: popup.trigger, type: "button", className: "dsh-tavern-worldbook-add-row", disabled, "aria-label": label, title: label,
            "aria-haspopup": "menu", "aria-expanded": popup.open, onClick: toggle,
            onKeyDown: event => { if (event.key === "ArrowDown" && !popup.open) { event.preventDefault(); toggle(); } } }, h(InlineGlyph, { name: "plus" })),
        popup.open ? popup.layer({ className: "fork-inline-pop dsh-tavern-worldbook-add-pop", role: "menu", "aria-label": label, onKeyDown: inlineMenuKeys },
            choices.length > 8 ? h(SearchBox, { label: "搜索" + noun, value: query, onChange: setQuery, className: "ap-search dsh-tavern-worldbook-add-search" }) : null,
            loading && !choices.length ? h("div", { className: "dsh-tavern-worldbook-add-loading" }, h(Spinner)) : null,
            !loading && !shown.length ? h(EmptyState, { compact: true, plain: !!needle, query: needle ? query : undefined, text: needle ? undefined : "没有可以绑定的" + noun }) : null,
            shown.map(choice => h("button", { key: choice.value, type: "button", role: "menuitem", className: "fork-inline-option", title: choice.name,
                onClick: () => { popup.close(true); onPick(choice.value); } },
                h("span", { className: "dsh-tavern-worldbook-add-name" }, choice.name), h("span", { className: "fork-inline-option-note" }, choice.note)))) : null);
}

		function createCardLibraryFeatureModule() {
		function CardLibraryTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);

			const [cards, setCards] = React.useState([]);
			const [selectedPath, setSelectedPath] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
						const [busy, setBusy] = React.useState(false);
			const cardBatch = useCardBatchDeletion(cards, busy, setBusy, refreshCards, props.archiveSession);
			const organization = useCardOrganization(cards, busy, refreshCards, error => setError(error), cardBatch);
			const [error, setError] = usePersistentError("人物卡库");
			const dshExport = useDshCardExport({ sessionId: props.scope && props.scope.sessionId || "" });
			// 更新 (card-update-dialog.js): a card replaced or put back is read again.
			const cardUpdate = useTavernCardUpdate({ call: rpc, onChanged: async function (path) {
				await refreshCards(); notifyTavernDataChanged(["cards"], "cards");
				if (path === selectedPath) loadCard(path);
			} });
			const importInput = React.useRef(null), mobileImport = React.useRef(null);
			const [importStatus, setImportStatus] = React.useState("");
			const actions = useTavernCardActions({ busy, setBusy, refresh: refreshCards, onError: setError, onNotice: setImportStatus, archiveSession: props.archiveSession,
				displayName: cardLibraryDisplayName, update: cardUpdate,
				// With the pack service 导出 is the one export sheet; without it the card's page keeps the format menu.
				exportCard: function (item) { if (dshExport.open) dshExport.open(item, { hasImage: item.hasImage }); else loadCard(item.path); },
				onDuplicated: function (path) { if (selectedPath) return loadCard(path); },
				onDeleted: function (path) { if (path === selectedPath) { cardRequest.current += 1; setSelectedPath(""); setCard(null); } },
				select: function (path) { if (selectedPath) clearCard(); cardBatch.begin([path]); } });
			const cardMenu = function (item) { return function (close) { return React.createElement(TavernCardMenu, { card: item, actions, organization, close }); }; };
			const [transferStatus, setTransferStatus] = React.useState("");
			const importing = React.useRef(false);
			const cardRequest = React.useRef(0);
			const visibleRef = React.useRef(Boolean(props.visible));
			const refreshModule = React.useRef(null);
			visibleRef.current = Boolean(props.visible);
			if (!refreshModule.current) refreshModule.current = createCardLibraryRefreshModule();
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const requestedPath = props.tab && props.tab.meta && typeof props.tab.meta.cardPath === "string" ? props.tab.meta.cardPath : "";
			function refreshCards() {
				return rpcWithTimeout("listCards", {}).then(function (result) { setCards(result.cards || []); setError(""); return result.cards || []; }, function (err) { if (visibleRef.current) setError(String(err && err.message || err)); return []; });
			}
			function loadCard(path) {
				if (!path) { setSelectedPath(""); setCard(null); setLoading(false); return Promise.resolve(); }
				return refreshModule.current.load(path, function () {
					const request = ++cardRequest.current;
					if (path !== selectedPath) setCard(null);
					setSelectedPath(path); setLoading(true); setError("");
					return rpcWithTimeout("getCard", { path: path }).then(function (result) {
						if (request !== cardRequest.current) return;
						const next = result.card || null;
						setCard(function (current) { return JSON.stringify(current) === JSON.stringify(next) ? current : next; });
					}, function (err) {
						if (request !== cardRequest.current) return;
						setError(String(err && err.message || err)); setCard(null);
					}).finally(function () { if (request === cardRequest.current) setLoading(false); });
				});
			}
			React.useEffect(function () {
				if (!props.visible) return function () { cardRequest.current += 1; refreshModule.current.dispose(); };
				refreshCards();
				function onData(event) {
					if (!tavernDataChangeAffects(event, ["cards"], "cards")) return;
					refreshCards().then(function (items) {
						if (!selectedPath) return;
						if (!items.some(function (item) { return item.path === selectedPath; })) { setSelectedPath(""); setCard(null); return; }
						loadCard(selectedPath);
					});
				}
				function onActivate() { refreshModule.current.activate(function () { if (selectedPath) loadCard(selectedPath); else refreshCards(); }); }
				function onVisibility() { if (document.visibilityState === "visible") onActivate(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				window.addEventListener("focus", onActivate);
				document.addEventListener("visibilitychange", onVisibility);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					window.removeEventListener("focus", onActivate);
					document.removeEventListener("visibilitychange", onVisibility);
					refreshModule.current.dispose();
				};
			}, [selectedPath, props.visible]);
			React.useEffect(function () {
				// Tab metadata supplies navigation requests. A local selection must not replay one.
				if (props.visible && requestedPath) loadCard(requestedPath);
			}, [requestedPath, props.visible]);
			function clearCard() {
				cardRequest.current += 1;
				setSelectedPath("");
				setCard(null);
				setLoading(false);
				props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null });
			}
			// 「导入人物卡」 also takes a card ZIP and hands it to the 导入卡片 sheet
			// (card-zip-entry.js); PNG / JSON files picked with it import here as before.
			const forkCardZip = props.forkCardZip && props.forkCardZip.available ? props.forkCardZip : null;
			if (props.forkCardZip && props.forkCardZip.pickerRef) props.forkCardZip.pickerRef.current = function () { if (importInput.current) importInput.current.click(); };
			async function importCardFiles(picked) {
				if (!picked.length || busy || importing.current) return;
				importing.current = true;
				setBusy(true); setError(""); setImportStatus("");
				setTransferStatus('正在准备导入…');
				let failures = [];
				try {
					const result = await importTavernCardSelection(picked, rpc, { cardZip: forkCardZip, onProgress: setImportStatus, onTransfer: setTransferStatus });
					failures = result.failures;
					setImportStatus(result.summary);
					if (result.lastPath) {
						setTransferStatus('正在刷新人物卡库…');
						notifyTavernDataChanged(["cards"], "cards");
						await refreshCards();
						if (picked.length === 1) await loadCard(result.lastPath);
					}
					if (failures.length) setError(failures.join("\n"));
				} catch (err) { setError(failures.concat("刷新人物卡库失败：" + String(err && err.message || err)).join("\n")); }
				finally { importing.current = false; setBusy(false); setTransferStatus(''); }
			}
			// The exports the library saves itself (JSON, PNG, and the .dshcard and 加密导出 without the pack service; with it
			// they go through the DSH card export sheet): the save-as dialog first, inside the click (Downloads the
			// first time, then the last export's folder), then the progress dialog while the host packs and the file streams to
			// it, then the result line saying where it is (saveExportFile `said`), or the host's reason. Without a dialog (phones)
			// the file goes to an ordinary download. `source()` resolves {url, filename} of the GET that streams the file.
			async function saveCardExport({ extension, type, description, suffix = '', title, packing, source }) {
				const name = card.name + suffix;
				let target = null;
				try { target = await pickExportTarget({ name, description, extension, type }); }
				catch (error) { if (error?.name !== 'AbortError') setError(error); return; }
				setBusy(true); setError(''); setImportStatus('');
				const progress = beginTavernCardImportProgress(name + extension, { title });
				progress.update(packing);
				let saving = false;
				try {
					const archive = await source();
					saving = true;
					const saved = await saveExportFile(archive, { target, name, onProgress: function (p) {
						progress.update(p.total ? '正在保存 ' + (p.loaded / 1048576).toFixed(1) + ' / ' + (p.total / 1048576).toFixed(1) + ' MB' : packing);
					} });
					setImportStatus(saved.said);
				} catch (error) {
					if (!saving && target?.empty) await target.file.remove?.().catch(function () {});
					setError(error);
				}
				finally { progress.close(); setBusy(false); }
			}
			// With the pack service 导出 is the one export sheet (DshCardExportSheet: format, 加密, packs and world books). Without it
			// (no stage package) the page's ⋯ › 导出 lists the formats and 加密导出, saving through saveCardExport.
			function openCardExport() { if (card && !busy) dshExport.open(card, { hasImage: cards.find(item => item.path === card.path)?.hasImage }); }
			async function encryptCurrentCard() {
				if (!card || busy) return;
				const path = card.path;
				const password = await askTavernCardPassword({ name: card.name, confirm: true });
				if (password === null) return;
				await saveCardExport({ extension: '.dshcard', type: 'application/zip', description: 'DSH 人物卡', suffix: '-加密', title: '正在加密导出人物卡',
					packing: '正在整理当前卡片、封面、插件和素材并加密…',
					source: async function () { const result = await runCardExport(rpc, { path, password }); return { url: result.downloadUrl, filename: result.filename, size: result.bytes }; } });
			}
			const CARD_EXPORT_FILES = { dshcard: { extension: '.dshcard', type: 'application/zip', description: 'DSH 人物卡' }, json: { extension: '.json', type: 'application/json', description: 'JSON 人物卡' }, png: { extension: '.png', type: 'image/png', description: 'PNG 人物卡' } };
			function exportCardFile(format) {
				if (!card) return;
				const url = "/api/dsh-tavern/card-export?" + new URLSearchParams({ path: card.path, format });
				return saveCardExport(Object.assign({ title: '正在导出人物卡', packing: format === 'dshcard' ? '正在打包卡片、封面和素材…' : '正在准备…',
					source: function () { return { url, filename: '人物卡' + CARD_EXPORT_FILES[format].extension }; } }, CARD_EXPORT_FILES[format]));
			}
			const h = React.createElement;
			if (selectedPath) {
				if (!card) return h("div", { className: "dsh-tavern-library dsh-tavern-card-library" }, h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: clearCard }, "← 返回人物卡库")), loading ? h(PanelLoading, { shape: "fields", label: "正在读取人物卡…" }) : error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")) : h("div", { className: "dsh-tavern-empty" }, "人物卡读取失败", h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")));
				const listedCard = cards.find(item => item.path === selectedPath);
				// The header: the name with ✎ (重命名), its tags and the card's ⋯ (TavernCardMenu, as on its tile, with the page's
				// low-frequency actions: 导出, 管理存档, 引用 …); 开始游玩 is beside the cover.
				const detailMenu = {
					exportCard: dshExport.open ? openCardExport : null,
					exportFormats: dshExport.open ? null : cardExportFormats(listedCard?.hasImage, exportCardFile, encryptCurrentCard),
					manageSaves: function () { window.dispatchEvent(new CustomEvent("dsh-tavern-manage-saves", { detail: { path: card.path } })); },
					attach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null };
				return h(React.Fragment, null, h(TavernCardPluginsBox, { path: selectedPath }), error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null, importStatus ? h("div", { role: "status" }, importStatus) : null, h(CardFieldsPanel, { view: { card: card }, library: true, displayName: listedCard?.displayName, organizationSettings: listedCard ? h(TavernCardDetailTags, { card: listedCard, organization }) : null, hasImage: listedCard?.hasImage, busy: busy, sessionId: props.scope && props.scope.sessionId || "", onBack: clearCard, onOpenWorldBook: props.openWorldBook, onRename: listedCard ? function () { actions.rename(listedCard); } : null, menu: listedCard ? function (close) { return h(TavernCardMenu, { card: listedCard, actions, organization, close, detail: detailMenu }); } : null, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } }), dshExport.element, cardUpdate.input, cardUpdate.element);
			}
			const visible = organization.visible;
			// "@" quotes a card into the card workspace conversation; only there does it mean anything.
			const mentionButton = sessionMode === "card" ? function (item) { return h("button", { type: "button", className: "dsh-tavern-card-mention", title: "在对话中引用", "aria-label": "在对话中引用：" + item.name, onClick: function (event) { event.stopPropagation(); props.appendMention(item.path, item.name); } }, "@"); } : null;
			return h("div", { className: "dsh-tavern-library dsh-tavern-card-library", 'aria-busy': !!transferStatus, ...tavernCardDropHandlers(importCardFiles) },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "人物卡库"),
					h("div", { className: "dsh-tavern-library-head-actions" },
						h(MobileCardImportButton, { inputRef: importInput, activateRef: mobileImport, batch: false, disabled: busy, onImported: async function (imported) { await refreshCards(); await loadCard(imported.path); notifyTavernDataChanged(["cards"], "cards"); } }),
						h("input", { ref: importInput, type: "file", multiple: true, accept: TAVERN_CARD_FILE_ACCEPT, style: { display: "none" }, onChange: function (event) { const files = Array.from(event.target.files || []); event.target.value = ""; void importCardFiles(files); } }))),
				// Only while importing, or to say how the last import went.
				transferStatus || importStatus ? h("div", { className: "dsh-tavern-question-sub dsh-tavern-card-import-hint", role: "status", 'aria-live': 'polite', style: { display: 'flex', alignItems: 'center', gap: 10 } },
					transferStatus ? h('span', { style: { flexShrink: 0 }, 'aria-hidden': true }, h(Spinner)) : null,
					h('span', { style: { whiteSpace: 'pre-line', overflowWrap: 'anywhere', minWidth: 0 } }, transferStatus ? transferStatus + '\n' + importStatus + '\n大卡包可能需要一会儿，请保持页面打开。' : importStatus)) : null,
				organization.toolbar(h(CardImportMenu, { disabled: busy || Boolean(forkCardZip && forkCardZip.busy), pickFile: function () { if (mobileImport.current) mobileImport.current(); },
					openAddress: forkCardZip && forkCardZip.openAddress ? forkCardZip.openAddress : null })),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, visible.length ? h(TavernCardList, { place: "library", cards: visible, columns: organization.columns, displayName: cardLibraryDisplayName, batch: cardBatch, busy: busy, open: function (item) { loadCard(item.path); }, menu: cardMenu, mention: mentionButton }) : h(EmptyState, cards.length ? { text: "没有匹配的人物卡", icon: "search" } : { noun: "人物卡" }), organization.batchBar()),
				dshExport.element, cardUpdate.input, cardUpdate.element
			);
		}

		// The detail header's ⋯: the card's menu (TavernCardMenu, as on its tile), under the button.
		function CardDetailMenuButton(props) {
			const menu = packUi.useContextMenu({ label: props.label + " 操作", content: props.menu });
			return React.createElement(React.Fragment, null,
				React.createElement("button", { type: "button", className: "ap-icon-button dsh-card-more", disabled: props.disabled, "aria-label": "更多操作", title: "更多操作", "aria-haspopup": "menu",
					onClick: function (event) { menu.show(event.currentTarget); } }, React.createElement(packUi.Glyph, { name: "more" })),
				menu.layer);
		}

		function CardFieldsPanel(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [error, setError] = usePersistentError("人物卡详情");
			const [script, setScript] = React.useState(null);
			const [availableResources, setAvailableResources] = React.useState([]);
			const [scriptCatalogLoaded, setScriptCatalogLoaded] = React.useState(false);
			const [scriptCatalogLoading, setScriptCatalogLoading] = React.useState(false);
			const [selectedScriptPath, setSelectedScriptPath] = React.useState("");
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = usePersistentError("剧本管理");
			const [worldBookBinding, setWorldBookBinding] = React.useState(null);
			const [availableWorldBooks, setAvailableWorldBooks] = React.useState([]);
			const [worldBookCatalogLoaded, setWorldBookCatalogLoaded] = React.useState(false);
			const [worldBookCatalogLoading, setWorldBookCatalogLoading] = React.useState(false);
			const [worldBookCatalogWarning, setWorldBookCatalogWarning] = React.useState("");
			const [worldBookBusy, setWorldBookBusy] = React.useState(false);
			const [worldBookError, setWorldBookError] = usePersistentError("世界书绑定");
			const scriptFileRef = React.useRef(null);
			const worldBookDetailsRef = React.useRef(null);
			// open folds of this page (texts by field, world books by source); the first bound book starts open.
			const [openFolds, setOpenFolds] = React.useState({});
			const stagePacks = useCardStagePacks(props.view.card.path);
			const worldBookCatalogRequestRef = React.useRef(null);
			const cardPath = props.view.card.path;
			function call(method, args) { return rpc(method, args); }
			function worldBookChoiceValue(item) {
				if (!item) return "";
				return item.kind === "card" ? "card:" + item.cardPath : "standalone:" + item.path;
			}
			function worldBookChoiceSource(value) {
				if (value.indexOf("card:") === 0) return { kind: "card", cardPath: value.slice(5) };
				if (value.indexOf("standalone:") === 0) return { kind: "standalone", path: value.slice(11) };
				return null;
			}
			function loadScript() {
				if (!cardPath) return;
				call("getScriptInfo", { path: cardPath }).then(function (result) {
					const currentScript = result.script || null;
					setScript(currentScript);
					setSelectedScriptPath(currentScript ? currentScript.path : "");
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); });
			}
			function loadScriptCatalog() {
				if (!cardPath || scriptCatalogLoaded || scriptCatalogLoading) return;
				setScriptCatalogLoading(true);
				call("listResources").then(function (result) {
					setAvailableResources(result.resources || []);
					setScriptCatalogLoaded(true);
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); })
					.finally(function () { setScriptCatalogLoading(false); });
			}
			function loadWorldBookBinding() {
				if (!cardPath) return;
				call("getWorldBookBinding", { cardPath: cardPath }).then(function (result) {
					const binding = result.binding || { kind: "none", source: null, name: "" };
					setWorldBookBinding(binding);
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); });
			}
			function loadWorldBookCatalog(force) {
				if (!cardPath || (!force && worldBookCatalogLoaded)) return Promise.resolve();
				if (worldBookCatalogRequestRef.current) return worldBookCatalogRequestRef.current;
				setWorldBookError("");
				setWorldBookCatalogLoading(true);
				const request = rpcWithTimeout("listWorldBooks", {}).then(function (result) {
					setAvailableWorldBooks((result.standalone || []).concat(result.embedded || []));
					setWorldBookCatalogLoaded(true);
					setWorldBookCatalogWarning(worldBookCatalogDiagnostic(result));
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); })
					.finally(function () {
						if (worldBookCatalogRequestRef.current !== request) return;
						worldBookCatalogRequestRef.current = null;
						setWorldBookCatalogLoading(false);
					});
				worldBookCatalogRequestRef.current = request;
				return request;
			}
			React.useEffect(function () {
				setAvailableResources([]); setScriptCatalogLoaded(false); setScriptCatalogLoading(false);
				setAvailableWorldBooks([]); setWorldBookCatalogLoaded(false); setWorldBookCatalogLoading(false);
				setWorldBookCatalogWarning(""); setOpenFolds({});
				loadScript();
				loadWorldBookBinding();
			}, [cardPath]);
			// the 剧本 menu lists the library's scripts as soon as the page shows.
			React.useEffect(function () { if (!scriptCatalogLoaded) loadScriptCatalog(); }, [cardPath, scriptCatalogLoaded]);
			React.useEffect(function () {
				function onWorldBookDataChanged(event) {
					if (!tavernDataChangeAffects(event, ["worldbooks", "cards"])) return;
					loadWorldBookBinding();
					setAvailableWorldBooks([]);
					setWorldBookCatalogLoaded(false);
				}
				window.addEventListener("dsh-tavern-data-changed", onWorldBookDataChanged);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onWorldBookDataChanged); };
			}, [cardPath]);
			// every field saves itself when it is left (R17): one key per write, the card read back from the reply.
			async function commitField(key, value) {
				setError("");
				try {
					const res = await call("updateCard", { path: cardPath, patch: { [key]: value } });
					props.onSaved(res.card);
					notifyTavernDataChanged(["cards", "sessions"], "cards");
				} catch (err) { setError(String(err && err.message || err)); }
			}
			async function importScriptFile(file) {
				if (!cardPath || !file) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("importScript", { cardPath: cardPath, payload: await parseTextResourceFile(file) });
					setScript(res.script || null);
					setSelectedScriptPath(res.script ? res.script.path : "");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
					loadScript();
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindScript(path) {
				if (!cardPath || !path) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("bindScript", { cardPath: cardPath, path: path });
					setScript(res.script || null);
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !await askConfirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { cardPath: cardPath });
					setScript(null);
					setSelectedScriptPath("");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindWorldBook(value) {
				const source = worldBookChoiceSource(value);
				if (!cardPath || !source) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("bindWorldBook", { cardPath: cardPath, source: source });
					setWorldBookBinding(result.binding || null);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			async function unbindWorldBook(book) {
				if (!cardPath) return;
				const named = book.available && book.name ? "「" + book.name + "」" : "这本世界书";
				if (!await askConfirm(named + "不再用于这张人物卡，世界书本身不会删除。", { title: "解绑世界书？", confirmText: "解绑", danger: true, hide: "card-worldbook-unbind" })) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("unbindWorldBook", { cardPath: cardPath, source: book.source });
					setWorldBookBinding(result.binding || null);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			// useListReorder's drop: `id` goes in front of `beforeId` (null = last). The list shows the new order at once.
			async function moveWorldBook(id, beforeId) {
				const books = boundWorldBooks.slice();
				const from = books.findIndex(function (book) { return worldBookChoiceValue(book.source) === id; });
				if (from < 0) return;
				const moved = books.splice(from, 1)[0];
				const at = beforeId === null ? books.length : books.findIndex(function (book) { return worldBookChoiceValue(book.source) === beforeId; });
				books.splice(at, 0, moved);
				setWorldBookBinding(Object.assign({}, worldBookBinding, { books: books, source: books[0].source }));
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("setWorldBookBindings", { cardPath: cardPath, sources: books.map(function (book) { return book.source; }) });
					setWorldBookBinding(result.binding);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); loadWorldBookBinding(); }
				finally { setWorldBookBusy(false); }
			}
			// A card text is one fold (CardTextFold): › label · its first line, opened to read and ✎ to edit; it saves when left.
			// An empty one is the grid's 「＋ 名称」 chip (R4), whose field becomes the fold once it has text.
			function fold(key, label, value, onCommit) {
				return h(CardTextFold, { key: key, label: label, value: value, open: openFolds[key] === true, disabled: props.busy, onCommit: onCommit,
					onToggle: function () { setOpenFolds(function (current) { return Object.assign({}, current, { [key]: !current[key] }); }); } });
			}
			function F(name, label) {
				const value = String(props.view.card[name] || ""), commit = function (v) { return commitField(name, v); };
				return value.trim() ? fold(name, label, value, commit)
					: h(InlineField, { key: name, kind: "text", multiline: true, lines: true, label: label, value: "", hideEmpty: true, wide: true, onCommit: commit });
			}
			// 开场白 and each 备选开场白 are one fold each; emptying an alternate removes it.
			const alternates = props.view.card.alternate_greetings || [];
			function alternateField(text, index) {
				return fold("alt-" + index + "-" + alternates.length, "备选 " + (index + 1), text,
					function (v) { const next = alternates.slice(); if (v.trim()) next[index] = v; else next.splice(index, 1); return commitField("alternate_greetings", next); });
			}
			const h = React.createElement;
			const cardExtensions = props.view.card.extensions || {};
			const cardRegexScripts = cardExtensions.regexScripts || [];
			const helperScripts = cardExtensions.helperScripts || [];
			const mvuResources = cardExtensions.mvuResources || [];
			const otherExtensions = cardExtensions.otherExtensions || [];
			const extensionCount = Number(cardExtensions.extensionCount) || 0;
			function extensionSectionTitle(title, count) {
				return count ? h("div", { className: "dsh-tavern-preset-section-title" }, title + " · " + count) : null;
			}
			function extensionTags(items) {
				return h("span", { className: "dsh-tavern-prompt-tags" }, items.filter(Boolean).map(function (item, index) { return h("span", { key: index, className: "dsh-tavern-prompt-tag" }, item); }));
			}
			function regexExtensionRow(item, index) {
				const placement = item.placement && item.placement.length ? item.placement.join(", ") : "未设置";
				const snippet = String(item.findRegex || "").slice(0, 400).replace(/\s+/g, " ").trim() || "空查找规则";
				const metadata = [
					"placement: [" + placement + "]", "promptOnly: " + Boolean(item.promptOnly), "markdownOnly: " + Boolean(item.markdownOnly),
					"runOnEdit: " + Boolean(item.runOnEdit), "substituteRegex: " + String(item.substituteRegex === null ? "null" : item.substituteRegex),
					"minDepth: " + String(item.minDepth === null ? "null" : item.minDepth), "maxDepth: " + String(item.maxDepth === null ? "null" : item.maxDepth),
					"trimStrings: " + JSON.stringify(item.trimStrings || [])
				].join("\n");
				return h(TavernLazyDetails, { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-regex",
					summary: h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags(["位置 " + placement, item.promptOnly ? "仅提示词" : "", item.markdownOnly ? "仅 Markdown" : "", item.runOnEdit ? "编辑时运行" : ""])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					render: function () { return h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "查找正则"), h("pre", { className: "dsh-tavern-regex-code" }, item.findRegex || "（空）"),
						h("div", { className: "dsh-tavern-regex-label" }, "替换内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.replaceString || "（空）"),
						h("div", { className: "dsh-tavern-regex-meta" }, metadata)
					); }
				});
			}
			function helperScriptRow(item, index) {
				const snippet = String(item.content || "").slice(0, 400).replace(/\s+/g, " ").trim() || "空脚本";
				return h(TavernLazyDetails, { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-script",
					summary: h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "SCRIPT"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags([item.type, item.buttonCount ? item.buttonCount + " 个按钮" : "", item.chars + " 字"])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					render: function () { return h("div", { className: "dsh-tavern-regex-body" },
						h(TavernScriptCode, { label: "脚本内容", content: item.content, collapsible: true }),
						item.dataText ? h(TavernScriptCode, { label: "脚本配置", content: item.dataText, collapsible: true }) : null,
						item.info ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "说明"), h("pre", { className: "dsh-tavern-regex-code" }, item.info)) : null,
						item.exportWith !== null ? h("div", { className: "dsh-tavern-regex-meta" }, "export_with: " + JSON.stringify(item.exportWith)) : null
					); }
				});
			}
			function otherExtensionRow(item, index) {
				return h(TavernLazyDetails, { key: item.ref || item.name || index, className: "dsh-tavern-prompt-row role-extension",
					summary: h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "EXT"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, item.type + " · " + item.chars + " 字")), h("span", { className: "dsh-tavern-mvu-state" }, "只读")),
					render: function () { return h("pre", { className: "dsh-tavern-prompt-content" }, item.text || "（空）"); }
				});
			}
			const extensionPanel = () => h("div", { className: "dsh-tavern-card-extensions" },
				extensionSectionTitle("正则脚本", cardRegexScripts.length), cardRegexScripts.map(regexExtensionRow),
				extensionSectionTitle("Tavern Helper 脚本", helperScripts.length), helperScripts.map(helperScriptRow),
				extensionSectionTitle("MVU 相关资源", mvuResources.length),
				mvuResources.length ? h("div", { className: "dsh-tavern-mvu-list" }, mvuResources.map(function (item, index) { return h("div", { key: item.ref || index, className: "dsh-tavern-mvu-row" }, h("span", { className: "dsh-tavern-mvu-kind" }, item.kindLabel), h("span", { className: "dsh-tavern-mvu-name", title: item.name }, item.name), h("span", { className: "dsh-tavern-mvu-state" }, item.enabled ? "已启用" : "已关闭")); })) : null,
				extensionSectionTitle("其他扩展", otherExtensions.length), otherExtensions.map(otherExtensionRow),
				extensionCount === 0 && mvuResources.length === 0 ? h("div", { className: "dsh-tavern-worldbook-empty" }, "这张人物卡没有可展示的扩展内容") : null
			);
			const selectableResources = availableResources.filter(function (item) { return !Array.isArray(item.boundCards) || item.boundCards.length === 0 || item.boundCards.some(function (boundCard) { return boundCard.path === cardPath; }); });
			// 剧本 is one row while a script is bound (its menu binds another, imports one and binds it, or 未绑定 unbinds); unbound it
			// is the first dashed 「＋ 剧本」 chip, which opens the same menu.
			const SCRIPT_IMPORT = "\u0000import";
			const scriptOptions = (script ? [{ value: "", label: "未绑定" }] : [])
				.concat(selectableResources.map(function (item) { return { value: item.path, label: item.title, note: item.path === (script && script.path) && script.chunkCount ? script.chunkCount + " 段" : undefined }; }))
				.concat(script && !selectableResources.some(function (item) { return item.path === script.path; }) ? [{ value: script.path, label: script.title }] : [])
				.concat([{ value: SCRIPT_IMPORT, label: "导入新剧本…" }]);
			const scriptField = h(InlineField, { key: "script", kind: "menu", label: "剧本", value: script ? script.path : "", options: scriptOptions, disabled: scriptBusy, wide: true, hideEmpty: true,
				help: h(HelpTip, { label: "剧本说明" }, "绑定后，新开的游玩按剧本分段推进；更换或解绑会影响用这张卡的剧本对话。"),
				onCommit: function (value) {
					if (value === SCRIPT_IMPORT) { if (scriptFileRef.current) scriptFileRef.current.click(); return; }
					if (!value) return deleteScript();
					return bindScript(value);
				},
				trail: h("input", { ref: scriptFileRef, type: "file", hidden: true, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }) });
			const boundWorldBooks = worldBookBinding && worldBookBinding.kind === "multiple" ? worldBookBinding.books : worldBookBinding && worldBookBinding.source ? [worldBookBinding] : [];
			const hasWorldBookBinding = boundWorldBooks.length > 0;
			const ownWorldBook = props.view.card.character_book;
			const ownWorldBookName = String(ownWorldBook && ownWorldBook.name || "").trim() || String(props.view.card.name || "").trim() || cardPath;
			const worldBookChoices = availableWorldBooks.filter(function (item) { return !(item.kind === "card" && item.cardPath === cardPath); });
			const boundWorldBookIds = boundWorldBooks.map(function (book) { return worldBookChoiceValue(book.source); });
			const worldBookReorder = useListReorder({ ids: boundWorldBookIds, enabled: !worldBookBusy && boundWorldBooks.length > 1, onMove: moveWorldBook });
			const ownWorldBookValue = worldBookChoiceValue({ kind: "card", cardPath: cardPath });
			const worldBookAddChoices = (ownWorldBook && typeof ownWorldBook === "object" ? [{ value: ownWorldBookValue, name: ownWorldBookName, note: "本卡自带" }] : [])
				.concat(worldBookChoices.map(function (item) { return { value: worldBookChoiceValue(item), name: item.name, note: item.kind === "card" ? "人物卡：" + item.cardName : "独立世界书" }; }))
				.filter(function (choice) { return boundWorldBookIds.indexOf(choice.value) < 0; });
			function worldBookSourceNote(book) {
				if (book.source.kind !== "card") return "独立世界书";
				return book.source.cardPath === cardPath ? "本卡自带" : "人物卡：" + (book.source.cardName || book.source.cardPath);
			}
			// 世界书 right after 基本信息: one row per bound book — its name (a click opens the book's page in 世界书 ↗),
			// where it comes from, 主书, × to unbind; drag the rows to reorder.
			const ui = packUi, card = props.view.card, title = cardLibraryDisplayName(card, props.displayName);
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				hasWorldBookBinding ? h("ul", { className: "dsh-tavern-worldbook-list", role: "listbox", "aria-label": "已绑定的世界书", "data-dragging": worldBookReorder.dragging || undefined },
					boundWorldBooks.map(function (book, index) {
						const id = boundWorldBookIds[index], open = book.available && typeof props.onOpenWorldBook === "function";
						return h("li", { key: id, className: "dsh-tavern-worldbook-row" + (book.available ? "" : " is-missing"), role: "option", "aria-selected": false, tabIndex: 0, ...worldBookReorder.row(id) },
							h("div", { className: "dsh-card-fold-row" },
								boundWorldBooks.length > 1 ? h("span", { className: "dsh-tavern-worldbook-grip", "aria-hidden": true, title: "拖动排序" },
									h("svg", { width: 10, height: 16, viewBox: "0 0 10 16", fill: "currentColor" }, [4, 8, 12].map(function (y) { return h(React.Fragment, { key: y }, h("circle", { cx: 3, cy: y, r: 1.2 }), h("circle", { cx: 7, cy: y, r: 1.2 })); }))) : null,
								book.available
									? h("button", { type: "button", className: "dsh-card-fold-head dsh-card-book-link", disabled: !open, title: "在世界书里打开「" + book.name + "」",
										onClick: function () { props.onOpenWorldBook(book.source); } },
										h(ui.Glyph, { name: "globe" }), h("span", { className: "dsh-card-book-name" }, book.name),
										h("span", { className: "dsh-card-fold-preview" }, worldBookSourceNote(book)), open ? h(ui.Glyph, { name: "openExternal" }) : null)
									: h("span", { className: "dsh-tavern-worldbook-missing", title: "这本世界书已被删除或移走" }, h(InlineGlyph, { name: "warning" }), "找不到这本世界书"),
								index === 0 ? h(HelpTip, { label: "主书", face: "主书", faceClassName: "dsh-tavern-worldbook-primary" }, "主书：游戏里新建的人物写进这本。" + (boundWorldBooks.length > 1 ? "拖动别的书到第一位，就换成它当主书。" : "")) : null,
								h("button", { type: "button", className: "ap-icon-button dsh-card-row-icon", disabled: worldBookBusy, title: "解绑", "aria-label": "解绑" + (book.available ? "「" + book.name + "」" : "这本世界书"), onClick: function () { unbindWorldBook(book); } }, h(ui.Glyph, { name: "close" }))));
					})) : null,
				h(WorldBookAddMenu, { choices: worldBookAddChoices, loading: worldBookCatalogLoading, disabled: worldBookBusy, onOpen: function () { loadWorldBookCatalog(); }, onPick: bindWorldBook }),
				worldBookError ? h("div", { className: "dsh-card-error" },
					worldBookError,
					h("button", { className: "dsh-tavern-btn", disabled: worldBookCatalogLoading, onClick: function () { loadWorldBookCatalog(true); } }, worldBookCatalogLoading ? "正在读取…" : "重新读取")
				) : null,
				worldBookCatalogWarning ? h("div", { className: "dsh-card-error" }, worldBookCatalogWarning) : null
			);
			const coverUrl = props.hasImage ? "/api/dsh-tavern/card-image?path=" + encodeURIComponent(cardPath) : "";
			const cover = h("div", { className: "dsh-card-cover-wrap" },
				coverUrl
					? h("button", { type: "button", className: "dsh-card-cover", "aria-label": "查看封面", title: "查看大图", onClick: function () { openImageViewer({ src: coverUrl, label: title }); } }, h("img", { src: coverUrl, alt: "", decoding: "async" }))
					: h("span", { className: "dsh-card-cover is-empty", "aria-hidden": true }, h("span", null, title)));
			const play = h("button", { type: "button", className: "ap-primary dsh-card-play", disabled: props.busy,
				onClick: function () { window.dispatchEvent(new CustomEvent("dsh-tavern-play-card", { detail: { path: cardPath } })); } }, h(ui.Glyph, { name: "play" }), "开始游玩");
			const more = props.menu ? h(CardDetailMenuButton, { menu: props.menu, label: title, disabled: props.busy }) : null;
			const back = props.onBack ? h("button", { type: "button", className: "ap-icon-button dsh-card-back", "aria-label": "返回人物卡库", title: "返回人物卡库", onClick: props.onBack }, h(ui.Glyph, { name: "back" })) : null;
			const name = h("h2", { className: "dsh-card-name", title: cardPath.split("/").pop() }, h("span", { className: "dsh-card-name-text" }, title),
				props.onRename ? h("button", { type: "button", className: "ap-icon-button dsh-card-rename", disabled: props.busy, "aria-label": "重命名", title: "重命名", onClick: props.onRename }, h(ui.Glyph, { name: "edit" })) : null);
			const counts = [boundWorldBooks.length ? boundWorldBooks.length + " 本世界书" : "", stagePacks && stagePacks.length ? stagePacks.length + " 个素材包" : "", (1 + alternates.length) + " 个开场白"].filter(Boolean).join(" · ");
			const head = h("header", { className: "dsh-card-head" },
				h("div", { className: "dsh-card-banner", "data-empty": coverUrl ? undefined : true }, coverUrl ? h("img", { className: "dsh-card-banner-bg", src: coverUrl, alt: "", "aria-hidden": true }) : null),
				h("div", { className: "dsh-card-title-row" }, back, name, more),
				h("div", { className: "dsh-card-hero" }, cover, h("div", { className: "dsh-card-side" }, play, props.organizationSettings, h("div", { className: "dsh-card-counts" }, counts))));
			const cardTextFields = [F("description", "角色描述"), F("personality", "性格"), F("scenario", "场景设定"), F("mes_example", "对话示例"),
				F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("creator_notes", "创作者备注")];
			const textFields = script ? cardTextFields.concat([scriptField]) : [scriptField].concat(cardTextFields);
			const greetings = [fold("first_mes", "开场白", String(card.first_mes || ""), function (v) { return commitField("first_mes", v); })].concat(alternates.map(alternateField),
				[h(InlineField, { key: "alt-new-" + alternates.length, kind: "text", multiline: true, lines: true, wide: true, hideEmpty: true, label: "备选开场白", value: "",
					onCommit: function (v) { if (v.trim()) return commitField("alternate_greetings", alternates.concat([v])); } })]);
			const extensionTotal = extensionCount + mvuResources.length;
			// 素材包: the card's 画风 row (asset-pack-style-ui.js CardGenStyleRow), then its packs.
			const packSection = stagePacks ? h(ui.StageSection, { title: "素材包", meta: stagePacks.length || undefined, foldKey: "card-detail:packs", help: "这张卡在舞台上用的素材包，在舞台设置里增减。" },
				ui.CardGenStyleRow ? h(ui.CardGenStyleRow, { cardPath: cardPath, rpc: rpc }) : null,
				stagePacks.length ? h("ul", { className: "dsh-card-packs", "aria-label": "素材包" }, stagePacks.map(function (pack) {
					return h("li", { key: pack.id, className: "dsh-card-fold-row" + (pack.missing ? " is-missing" : "") },
						h("button", { type: "button", className: "dsh-card-fold-head", disabled: pack.missing, title: pack.missing ? "本机没有这个素材包" : "在舞台素材里打开", onClick: function () { openCardStagePack(pack.id, props.sessionId); } },
							h(ui.Glyph, { name: "stage" }), h("span", { className: "dsh-card-book-name" }, pack.name), h("span", { className: "dsh-card-fold-preview" }, pack.note)));
				})) : null) : null;
			return h("div", { className: "fork-tab-scroll dsh-card-detail-scroll" },
				h("section", { className: "ap-ui dsh-card-detail", "aria-label": title, onKeyDown: function (event) { if (event.key === "Escape" && !event.defaultPrevented && props.onBack && event.target === event.currentTarget) props.onBack(); } },
					head,
					error ? h(ui.HintLine, { text: error }) : null,
					h(ui.StageSection, { title: "基本信息", foldKey: "card-detail:basic" },
						h(InlineGrid, { label: "基本信息", columns: 1, className: "dsh-card-fields" }, textFields),
						scriptError ? h(ui.HintLine, { text: scriptError }) : null),
					h(ui.StageSection, { title: "世界书", meta: boundWorldBooks.length, foldKey: "card-detail:worldbooks", help: "绑定多本时，书里设定互相矛盾，AI 可能会混淆。" }, worldBookPanel),
					packSection,
					h(ui.StageSection, { title: "开场白", meta: 1 + alternates.length, foldKey: "card-detail:greetings" },
						h(InlineGrid, { label: "开场白", columns: 1, className: "dsh-card-fields" }, greetings)),
					extensionTotal ? h(ui.StageSection, { title: "扩展内容", meta: extensionTotal, foldKey: "card-detail:extensions", defaultFolded: true,
						help: "只读：卡里的正则、脚本和其他扩展，这里不执行。" }, extensionPanel()) : null));
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) {
					return React.createElement(CardLibraryTab, Object.assign({}, props, {
						appendMention: function (path, label) { appendMention(props.scope.sessionId, "card", path, label); },
						archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
						openWorldBook: function (source) {
							openTavernSidebarTab(ctx, { type: "dsh-tavern:worldbooks", meta: { worldBookSource: source } }, { sessionId: props.scope.sessionId });
						}
					}));
				}
			}), "dsh-tavern: Better Sidebar card library tab");
		}
		return Object.freeze({ register: register });
		}
		const cardLibraryFeature = createCardLibraryFeatureModule();
