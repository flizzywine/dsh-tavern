		// Gallery tab beside 对话/轨迹/完整上下文: the pictures plugins attached to this game, one
		// row per turn from the first turn on. Delete one from its corner, or pick several;
		// deleting removes the picture only, the story text and saves are untouched.
		function SceneImageGallery(props) {
			const h = React.createElement;
			const askConfirm = useTavernConfirm();
			const [items, setItems] = React.useState(null);
			const [picking, setPicking] = React.useState(false);
			const [picked, setPicked] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const loadRevision = React.useRef(0);
			const galleryRevision = React.useRef(0);
			const load = React.useCallback(async function () {
				const requested = ++loadRevision.current;
				const sessionId = props.gallerySessionId;
				setBusy(true);
				try {
					const result = await rpc("listSceneImageHistory", { sessionId: sessionId }, sessionId);
					if (requested === loadRevision.current) { setItems({ sessionId: sessionId, plugin: result.pluginItems || [] }); setNotice(""); }
				}
				catch (e) { if (requested === loadRevision.current) setNotice(String(e.message || e)); }
				finally { if (requested === loadRevision.current) setBusy(false); }
			}, [props.gallerySessionId]);
			React.useEffect(function () {
				++galleryRevision.current;
				++loadRevision.current;
				setItems(null); setPicked({}); setPicking(false); setNotice(""); void load();
				function changed() { void load(); }
				window.addEventListener("dsh-tavern-image-changed", changed);
				// A plugin attached or removed a picture.
				const stopPlugin = props.gallerySessionId ? tavernPluginMediaIndex.subscribe(props.gallerySessionId, changed) : function () {};
				return function () { ++galleryRevision.current; ++loadRevision.current; window.removeEventListener("dsh-tavern-image-changed", changed); stopPlugin(); };
			}, [load]);
			const currentItems = items && items.sessionId === props.gallerySessionId ? items : null;
			const rows = [];
			(currentItems ? currentItems.plugin : []).forEach(function (item) {
				let row = rows.find(function (entry) { return item.provider ? entry.provider === item.provider : !entry.provider && entry.turn === item.turn; });
				if (!row) rows.push(row = item.provider ? { provider: item.provider, shots: [] } : { turn: item.turn, shots: [] });
				row.shots.push({ item: item, plugin: true, version: { id: item.id, description: item.caption, createdAt: item.createdAt }, id: "plugin/" + item.id,
					url: item.provider
						? "/api/dsh-tavern/plugin-gallery-media?" + new URLSearchParams({ sessionId: props.gallerySessionId, id: item.id }).toString()
						: "/api/dsh-tavern/plugin-media?" + new URLSearchParams({ sessionId: props.gallerySessionId, id: item.id, v: String(item.updatedAt || "") }).toString() });
			});
			rows.sort(function (a, b) { return a.provider ? (b.provider ? a.provider.localeCompare(b.provider) : 1) : b.provider ? -1 : a.turn - b.turn; });
			rows.forEach(function (row) { row.shots.sort(function (a, b) { return a.version.createdAt - b.version.createdAt; }); });
			const shots = rows.flatMap(function (row) { return row.shots; });
			const urls = shots.map(function (shot) { return shot.url; });
			const chosen = shots.filter(function (shot) { return picked[shot.id]; });
			function toggle(shot, on) { setPicked(function (value) { const next = Object.assign({}, value); if (on) next[shot.id] = true; else delete next[shot.id]; return next; }); }
			async function remove(list) {
				const revision = galleryRevision.current;
				const sessionId = props.gallerySessionId;
				const hasProviderItems = list.some(function (shot) { return Boolean(shot.item.provider); });
				if (!list.length || !await askConfirm(list.length === 1 ? list[0].item.provider
					? "删除「" + list[0].item.provider + "」图库里的这张图片？这会调用插件的删除方法，可能同时删除本地图片文件。"
					: "删除第 " + list[0].item.turn + " 轮的这张图片？只移除图片，不影响正文与存档。"
					: "删除选中的 " + list.length + " 张图片？" + (hasProviderItems
						? "这会调用对应插件的删除方法，可能同时删除本地图片文件。"
						: "只移除图片，不影响正文与存档。"))) return;
				if (revision !== galleryRevision.current) return;
				setBusy(true); setNotice("");
				try {
					const results = (await rpc("removeSceneImageHistory", {
						sessionId: sessionId,
						pluginItems: list.map(function (shot) { return shot.item.id; })
					}, sessionId)).results;
					const failed = results.filter(function (row) { return !row.ok; });
					if (revision === galleryRevision.current) {
						if (failed.length || list.length > 1) setNotice("已删除 " + (results.length - failed.length) + " 张" + (failed.length ? "，" + failed.length + " 张失败：" + failed[0].error : ""));
						setPicked({}); setPicking(false);
					}
					// Turns showing a removed picture refresh; this listener reloads the gallery too.
					window.dispatchEvent(new CustomEvent("dsh-tavern-image-changed"));
				} catch (e) { if (revision === galleryRevision.current) setNotice(String(e.message || e)); }
				finally { if (revision === galleryRevision.current) setBusy(false); }
			}
			return h("section", { className: "dsh-tavern-full-context dsh-tavern-gallery" + (picking ? " is-picking" : "") },
				h("header", { className: "dsh-context-header" },
					h("div", null, h("h3", null, "画廊"), h("p", null, currentItems ? "本局共 " + shots.length + " 张，按轮次排列" : notice ? "读取失败" : "读取中…")),
					h("button", { disabled: busy, onClick: load }, busy ? "读取中…" : "刷新")),
				shots.length ? h("div", { className: "dsh-context-toolbar" },
					picking ? h(React.Fragment, null,
						h("button", { type: "button", disabled: busy, onClick: function () { setPicked(chosen.length === shots.length ? {} : Object.fromEntries(shots.map(function (shot) { return [shot.id, true]; }))); } }, chosen.length === shots.length ? "取消全选" : "全选"),
						h("button", { type: "button", className: "danger", disabled: busy || !chosen.length, onClick: function () { void remove(chosen); } }, "删除选中的 " + chosen.length + " 张"),
						h("button", { type: "button", disabled: busy, onClick: function () { setPicking(false); setPicked({}); } }, "完成"))
						: h("button", { type: "button", disabled: busy, onClick: function () { setPicking(true); } }, "批量删除")) : null,
				notice ? h("p", { role: "status" }, notice) : null,
				currentItems && !shots.length ? h("p", { className: "dsh-context-empty" }, "这一局还没有插图。") : null,
				rows.map(function (row) {
					return h("section", { key: row.provider || "turn-" + row.turn, className: "dsh-tavern-gallery-turn" },
						h("h4", null, row.provider ? "本局生图 · " + row.provider : row.turn > 0 ? "第 " + row.turn + " 轮" : "开场", h("span", null, row.shots.length + " 张")),
						h("div", { className: "dsh-tavern-gallery-row" }, row.shots.map(function (shot) {
							return h("figure", { key: shot.id, className: "dsh-tavern-gallery-shot" + (picked[shot.id] ? " is-picked" : ""), title: shot.version.description },
									h("button", { type: "button", className: "dsh-tavern-image-preview", "aria-label": shot.item.provider ? "放大「" + shot.item.provider + "」图库图片" : "放大第 " + shot.item.turn + " 轮插图", onClick: function (event) {
									if (picking) toggle(shot, !picked[shot.id]);
									else openSceneImagePreview(shot.url, event.currentTarget, null, null, { urls: urls, index: urls.indexOf(shot.url) });
								} }, h("img", { src: shot.url, alt: shot.version.description || "插图", loading: "lazy" })),
								picking ? h("label", { className: "dsh-tavern-gallery-pick" }, h("input", { type: "checkbox", "aria-label": "选择第 " + shot.item.turn + " 轮插图", checked: Boolean(picked[shot.id]), disabled: busy, onChange: function (event) { toggle(shot, event.target.checked); } }))
									: h("button", { type: "button", className: "dsh-tavern-gallery-delete", "aria-label": "删除这张图片", title: "删除这张图片", disabled: busy, onClick: function () { void remove([shot]); } }, h(DshUi.IconTrashOutlineRegular, null)));
						})));
				}));
		}
