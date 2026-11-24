// The library gives unlabelled copies a number while keeping the card's own name.
function cardLibraryDisplayName(card, displayName = card.displayName) {
    if (displayName) return displayName;
    const suffix = String(card.path || '').match(/ ([\(][1-9]\d*[\)])\.json$/i);
    return card.name + (suffix ? suffix[1] : '');
}

function CardExportMenu({ disabled, hasImage, onExport }) {
    const h = React.createElement, popup = useInlinePopup();
    const formats = [
        { value: "dshcard", label: "DSH 人物卡", note: "可打包素材和插件" },
        { value: "json", label: "JSON", note: "卡片数据" },
        { value: "png", label: "PNG", note: hasImage === false ? "需要封面" : "封面和卡片数据", disabled: hasImage === false }
    ];
    return h("span", { className: "fork-inline-anchor", ref: popup.root, onKeyDown: popup.keys },
        h("button", { ref: popup.trigger, className: "dsh-tavern-btn", type: "button", disabled,
            "aria-haspopup": "menu", "aria-expanded": popup.open, onClick: () => popup.setOpen(!popup.open),
            onKeyDown: event => { if (event.key === "ArrowDown" && !popup.open) { event.preventDefault(); popup.setOpen(true); } } }, "导出"),
        popup.open ? popup.layer({ className: "fork-inline-pop", role: "menu", "aria-label": "导出格式", onKeyDown: inlineMenuKeys },
            formats.map(format => h("button", { key: format.value, className: "fork-inline-option", type: "button", role: "menuitem",
                disabled: disabled || format.disabled, onClick: () => { popup.close(true); onExport(format.value); } },
                h("span", null, format.label), h("span", { className: "fork-inline-option-note" }, format.note)))) : null);
}

// 人物卡库's one 「导入」: 选择本地文件 (the system file picker, several at once; on a phone with a download folder the
// 从手机下载目录导入 sheet) and, with the card ZIP entry, a box for a card's address (pasted or typed; Enter reads it).
function CardImportMenu({ disabled, pickFile, openAddress }) {
    const h = React.createElement, popup = useInlinePopup({ focusSelector: "input" }), [address, setAddress] = React.useState("");
    function read() { const url = address.trim(); if (!url) return; popup.close(false); setAddress(""); openAddress(url); }
    // A quiet icon on the toolbar, as 舞台素材's 获取素材包.
    const icon = h(packUi.Glyph, { name: "download" });
    if (!openAddress) return h("button", { type: "button", className: "ap-icon-button", "aria-label": "导入人物卡", title: "导入人物卡", disabled, onClick: pickFile }, icon);
    return h("span", { className: "fork-inline-anchor", ref: popup.root, onKeyDown: popup.keys },
        h("button", { ref: popup.trigger, type: "button", className: "ap-icon-button", "aria-label": "导入人物卡", title: "导入人物卡", disabled, "aria-haspopup": "menu", "aria-expanded": popup.open, onClick: () => popup.setOpen(!popup.open) }, icon),
        popup.open ? popup.layer({ className: "fork-inline-pop dsh-tavern-card-import-pop", role: "menu", "aria-label": "导入人物卡" },
            h("button", { type: "button", role: "menuitem", className: "fork-inline-option", onClick: () => { popup.close(false); pickFile(); } }, "选择本地文件"),
            h("div", { className: "dsh-tavern-card-import-url" },
                h(SearchBox, { bare: true, label: "卡片网址", placeholder: "粘贴卡片网址", value: address, onChange: setAddress, spellCheck: false,
                    onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); read(); } } }),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: !address.trim(), onClick: read }, "导入"))) : null);
}

// The world book list's dashed ＋: a menu of the books that can still be bound (a search above 8); picking one binds it.
function WorldBookAddMenu({ choices, loading, disabled, onOpen, onPick }) {
    const h = React.createElement, popup = useInlinePopup({ focusSelector: "input" }), [query, setQuery] = React.useState("");
    const needle = query.trim().toLowerCase();
    const shown = needle ? choices.filter(choice => (choice.name + " " + choice.note).toLowerCase().includes(needle)) : choices;
    const toggle = () => { if (!popup.open) { setQuery(""); onOpen(); } popup.setOpen(!popup.open); };
    return h("div", { className: "fork-inline-anchor dsh-tavern-worldbook-add-anchor", ref: popup.root, onKeyDown: popup.keys },
        h("button", { ref: popup.trigger, type: "button", className: "dsh-tavern-worldbook-add-row", disabled, "aria-label": "绑定世界书", title: "绑定世界书",
            "aria-haspopup": "menu", "aria-expanded": popup.open, onClick: toggle,
            onKeyDown: event => { if (event.key === "ArrowDown" && !popup.open) { event.preventDefault(); toggle(); } } }, h(InlineGlyph, { name: "plus" })),
        popup.open ? popup.layer({ className: "fork-inline-pop dsh-tavern-worldbook-add-pop", role: "menu", "aria-label": "绑定世界书", onKeyDown: inlineMenuKeys },
            choices.length > 8 ? h(SearchBox, { label: "搜索世界书", value: query, onChange: setQuery, className: "ap-search dsh-tavern-worldbook-add-search" }) : null,
            loading && !choices.length ? h("div", { className: "dsh-tavern-worldbook-add-loading" }, h(Spinner)) : null,
            !loading && !shown.length ? h(EmptyState, { compact: true, plain: !!needle, query: needle ? query : undefined, text: needle ? undefined : "没有可以绑定的世界书" }) : null,
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
					// the save takes back a half-written file; a failure before it leaves the empty file the dialog made.
					if (!saving && target?.file) await target.file.remove?.().catch(function () {});
					setError(error);
				}
				finally { progress.close(); setBusy(false); }
			}
			// With the pack service 导出 is the one export sheet (DshCardExportSheet: format, 加密, packs and world books). Without it
			// (no stage package) the header keeps the format menu and 加密导出, saving through saveCardExport.
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
				// The header: the name with ✎ (重命名), 导出 and the card's own menu (the grid's, one definition); its tags below.
				return h(React.Fragment, null, h(TavernCardPluginsBox, { path: selectedPath }), error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null, importStatus ? h("div", { role: "status" }, importStatus) : null, h(CardFieldsPanel, { view: { card: card }, library: true, displayName: listedCard?.displayName, organizationSettings: listedCard ? h(TavernCardDetailTags, { card: listedCard, organization }) : null, hasImage: listedCard?.hasImage, busy: busy, onBack: clearCard, onAttach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null, onOpenWorldBook: props.openWorldBook, onRename: listedCard ? function () { actions.rename(listedCard); } : null, menu: listedCard ? cardMenu(listedCard) : null, onExport: exportCardFile, onEncrypt: encryptCurrentCard, onOpenExport: dshExport.open ? openCardExport : null, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } }), dshExport.element, cardUpdate.input, cardUpdate.element);
			}
			const visible = organization.visible;
			// "@" quotes a card into the card workspace conversation; only there does it mean anything.
			const mentionButton = sessionMode === "card" ? function (item) { return h("button", { type: "button", className: "dsh-tavern-card-mention", title: "在对话中引用", "aria-label": "在对话中引用：" + item.name, onClick: function (event) { event.stopPropagation(); props.appendMention(item.path, item.name); } }, "@"); } : null;
			return h("div", { className: "dsh-tavern-library dsh-tavern-card-library", 'aria-busy': !!transferStatus },
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
				React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-card-detail-more", disabled: props.disabled, "aria-label": "更多操作", title: "更多操作", "aria-haspopup": "menu",
					onClick: function (event) { menu.show(event.currentTarget); } }, "⋯"),
				menu.layer);
		}

		function CardFieldsPanel(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [draft, setDraft] = React.useState({});
			const [busy, setBusy] = React.useState(false);
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
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || ""
				});
			}, [props.view.card]);
			React.useEffect(function () {
				setAvailableResources([]); setScriptCatalogLoaded(false); setScriptCatalogLoading(false);
				setAvailableWorldBooks([]); setWorldBookCatalogLoaded(false); setWorldBookCatalogLoading(false);
				setWorldBookCatalogWarning("");
				loadScript();
				loadWorldBookBinding();
			}, [cardPath]);
			React.useEffect(function () {
				function onWorldBookDataChanged(event) {
					if (!tavernDataChangeAffects(event, ["worldbooks", "cards"])) return;
					loadWorldBookBinding();
					setAvailableWorldBooks([]);
					setWorldBookCatalogLoaded(false);
					if (worldBookDetailsRef.current && worldBookDetailsRef.current.open) loadWorldBookCatalog(true);
				}
				window.addEventListener("dsh-tavern-data-changed", onWorldBookDataChanged);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onWorldBookDataChanged); };
			}, [cardPath]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const next = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean) });
					const source = props.view.card || {};
					const baseline = {
						name: source.name || "", tags: source.tags || [], description: source.description || "", personality: source.personality || "", scenario: source.scenario || "",
						first_mes: source.first_mes || "", alternate_greetings: source.alternate_greetings || [], mes_example: source.mes_example || "", system_prompt: source.system_prompt || "",
						post_history_instructions: source.post_history_instructions || "", creator_notes: source.creator_notes || ""
					};
					const patch = {};
					Object.keys(next).forEach(function (key) { if (JSON.stringify(next[key]) !== JSON.stringify(baseline[key])) patch[key] = next[key]; });
					const res = await call("updateCard", { path: cardPath, patch: patch });
					props.onSaved(res.card);
					notifyTavernDataChanged(["cards", "sessions"], "cards");
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
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
			async function bindSelectedScript() {
				if (!cardPath || !selectedScriptPath) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("bindScript", { cardPath: cardPath, path: selectedScriptPath });
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
			function F(name, label, large) {
				const value = draft[name] || "";
				const empty = !String(value).trim();
				return React.createElement("div", { className: "dsh-tavern-card-field" + (empty ? " is-empty" : "") },
					React.createElement("label", null, label),
					name === "name" || name === "tags"
						? React.createElement("input", { value: value, onChange: function (e) { field(name, e.target.value); } })
						: React.createElement("textarea", { className: (large ? "large" : "") + (empty ? " is-empty" : ""), value: value, rows: empty ? (large ? 3 : 2) : undefined, onChange: function (e) { field(name, e.target.value); } })
				);
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
				h("div", { className: "dsh-tavern-extension-note" }, "这里只读取人物卡工作区中的完整扩展数据，不执行任何卡内脚本。MVU 按名称和内容识别，用于帮助定位相关资源，不代表已经完整解析其运行逻辑。"),
				extensionSectionTitle("正则脚本", cardRegexScripts.length), cardRegexScripts.map(regexExtensionRow),
				extensionSectionTitle("Tavern Helper 脚本", helperScripts.length), helperScripts.map(helperScriptRow),
				extensionSectionTitle("MVU 相关资源", mvuResources.length),
				mvuResources.length ? h("div", { className: "dsh-tavern-mvu-list" }, mvuResources.map(function (item, index) { return h("div", { key: item.ref || index, className: "dsh-tavern-mvu-row" }, h("span", { className: "dsh-tavern-mvu-kind" }, item.kindLabel), h("span", { className: "dsh-tavern-mvu-name", title: item.name }, item.name), h("span", { className: "dsh-tavern-mvu-state" }, item.enabled ? "已启用" : "已关闭")); })) : null,
				extensionSectionTitle("其他扩展", otherExtensions.length), otherExtensions.map(otherExtensionRow),
				extensionCount === 0 && mvuResources.length === 0 ? h("div", { className: "dsh-tavern-worldbook-empty" }, "这张人物卡没有可展示的扩展内容") : null
			);
			const selectableResources = availableResources.filter(function (item) { return !Array.isArray(item.boundCards) || item.boundCards.length === 0 || item.boundCards.some(function (boundCard) { return boundCard.path === cardPath; }); });
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("select", { value: selectedScriptPath, disabled: scriptBusy || scriptCatalogLoading || !scriptCatalogLoaded || !selectableResources.length, onChange: function (event) { setSelectedScriptPath(event.target.value); } }, h("option", { value: "" }, scriptCatalogLoading ? "正在读取剧本库…" : "选择已有剧本"), selectableResources.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); })),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy || !selectedScriptPath || !!(script && script.path === selectedScriptPath), onClick: bindSelectedScript }, script ? "更换绑定" : "绑定"),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, "导入新剧本并绑定"),
				script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
			);
			const scriptHero = h("details", { className: "dsh-tavern-script-hero", onToggle: function (event) { if (event.currentTarget.open) loadScriptCatalog(); } },
				h("summary", { className: "dsh-tavern-script-hero-title" }, script ? ("剧本模式 · " + script.title) : "剧本模式 · 未绑定"),
				h("div", { className: "dsh-tavern-script-hero-help" }, "绑定剧本后，新开的游玩对话会自动进入剧本模式。Agent 按剧情进度分段读取当前片段并围绕它续写，每轮完成后推进阅读位置；不会一次载入整本剧本，也不要求玩家照原文行动。更换或解绑会影响所有使用这张人物卡的剧本对话。"),
				scriptPanel,
				scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
			);
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
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				hasWorldBookBinding ? h("ul", { className: "dsh-tavern-worldbook-list", role: "listbox", "aria-label": "已绑定的世界书", "data-dragging": worldBookReorder.dragging || undefined },
					boundWorldBooks.map(function (book, index) {
						const id = boundWorldBookIds[index];
						return h("li", { key: id, className: "dsh-tavern-worldbook-row" + (book.available ? "" : " is-missing"), role: "option", "aria-selected": false, tabIndex: 0, ...worldBookReorder.row(id) },
							boundWorldBooks.length > 1 ? h("span", { className: "dsh-tavern-worldbook-grip", "aria-hidden": true, title: "拖动排序" },
								h("svg", { width: 10, height: 16, viewBox: "0 0 10 16", fill: "currentColor" }, [4, 8, 12].map(function (y) { return h(React.Fragment, { key: y }, h("circle", { cx: 3, cy: y, r: 1.2 }), h("circle", { cx: 7, cy: y, r: 1.2 })); }))) : null,
							h("span", { className: "dsh-tavern-worldbook-main" },
								book.available
									? h("button", { type: "button", className: "dsh-tavern-worldbook-name", title: book.name, onClick: function () { if (typeof props.onOpenWorldBook === "function") props.onOpenWorldBook(book.source); } }, book.name)
									: h("span", { className: "dsh-tavern-worldbook-missing", title: "这本世界书已被删除或移走" }, h(InlineGlyph, { name: "warning" }), "找不到这本世界书"),
								index === 0 ? h(HelpTip, { label: "主书", face: "主书", faceClassName: "dsh-tavern-worldbook-primary" }, "主书：游戏里新建的人物写进这本。" + (boundWorldBooks.length > 1 ? "拖动别的书到第一位，就换成它当主书。" : "")) : null,
								h("span", { className: "dsh-tavern-worldbook-source" }, worldBookSourceNote(book))),
							h("button", { type: "button", className: "dsh-tavern-worldbook-unbind", disabled: worldBookBusy, title: "解绑", "aria-label": "解绑" + (book.available ? "「" + book.name + "」" : "这本世界书"), onClick: function () { unbindWorldBook(book); } }, h(InlineGlyph, { name: "close" })));
					})) : h(EmptyState, { compact: true, text: "还没有绑定世界书" }),
				h(WorldBookAddMenu, { choices: worldBookAddChoices, loading: worldBookCatalogLoading, disabled: worldBookBusy, onOpen: function () { loadWorldBookCatalog(); }, onPick: bindWorldBook }),
				worldBookError ? h("div", { className: "dsh-card-error" },
					worldBookError,
					h("button", { className: "dsh-tavern-btn", disabled: worldBookCatalogLoading, onClick: function () { loadWorldBookCatalog(true); } }, worldBookCatalogLoading ? "正在读取…" : "重新读取")
				) : null,
				worldBookCatalogWarning ? h("div", { className: "dsh-card-error" }, worldBookCatalogWarning) : null
			);
			return h("aside", { className: "dsh-tavern-status" + (props.library ? " dsh-tavern-card-detail" : "") },
				h("div", { className: "dsh-tavern-status-head" },
					props.onBack ? h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回") : null,
					h("div", { className: props.library ? "dsh-tavern-status-title dsh-tavern-card-detail-title" : "dsh-tavern-status-role", title: props.library && props.view.card.path ? props.view.card.path.split("/").pop() : undefined }, props.library ? cardLibraryDisplayName(props.view.card, props.displayName) : props.view.card.name,
						props.library && props.onRename ? h("button", { type: "button", className: "dsh-tavern-card-rename", disabled: props.busy, "aria-label": "重命名", title: "重命名", onClick: props.onRename }, "✎") : null),
					props.library ? h("div", { className: "dsh-tavern-library-head-actions" }, props.onAttach ? h("button", { className: "dsh-tavern-btn", onClick: props.onAttach }, "在对话中引用") : null, props.onOpenExport ? h("button", { className: "dsh-tavern-btn", disabled: props.busy, onClick: props.onOpenExport }, "导出") : h(CardExportMenu, { onExport: props.onExport, disabled: props.busy, hasImage: props.hasImage }), props.onEncrypt && !props.onOpenExport ? h("button", { className: "dsh-tavern-btn", disabled: props.busy, onClick: props.onEncrypt, title: "为当前人物卡设置导出密码" }, "加密导出") : null, props.menu ? h(CardDetailMenuButton, { menu: props.menu, label: cardLibraryDisplayName(props.view.card, props.displayName), disabled: props.busy }) : null) : null
				),
				props.organizationSettings,
				scriptHero,
				h("div", { className: "dsh-tavern-card-fields" },
					h("details", { ref: worldBookDetailsRef, open: true, className: "dsh-tavern-card-advanced dsh-tavern-card-worldbook", onToggle: function (event) { if (event.currentTarget.open) loadWorldBookCatalog(); } }, h("summary", null, "世界书", h("span", { className: "dsh-tavern-worldbook-count" }, boundWorldBooks.length), h(HelpTip, { label: "世界书说明" }, "绑定多本时，书里设定互相矛盾，AI 可能会混淆。")), worldBookPanel),
					h("details", { className: "dsh-tavern-card-advanced", open: true }, h("summary", null, "基本信息"), F("name", "角色名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注")),
					h(TavernLazyDetails, { className: "dsh-tavern-card-advanced", summary: h("summary", null, "扩展内容 · " + extensionCount + " 项"), render: extensionPanel }),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
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
