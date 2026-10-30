		// 精修: the latest 精修 of this game, original and polished text side by side, each change
		// numbered and coloured with its reason. Shown while that turn still holds the polished text.
		// Pointing at a change shows its reason and lights up the same change in the other column.
		function tavernPolishParagraphs(segments, side, hover) {
			const h = React.createElement;
			const paragraphs = [[]];
			function push(text, wrap) {
				String(text).split(/\n+/).forEach(function (piece, index) {
					if (index > 0) paragraphs.push([]);
					if (piece) paragraphs[paragraphs.length - 1].push(wrap ? wrap(piece) : piece);
				});
			}
			segments.forEach(function (segment, at) {
				if (segment.kind === "same") { push(segment.text); return; }
				const lit = hover.current && hover.current.n === segment.n ? " is-lit" : "";
				const events = hover.events(segment);
				const cls = "dsh-polish-mark" + lit;
				if (side === "before") push(segment.find, function (piece) { return h("del", Object.assign({ key: at + piece, className: cls }, events), piece); });
				else if (segment.replace) push(segment.replace, function (piece) { return h("ins", Object.assign({ key: at + piece, className: cls }, events), piece); });
				else paragraphs[paragraphs.length - 1].push(h("span", Object.assign({ key: at + "cut", className: "dsh-polish-cut" + lit }, events), "（删去）"));
				paragraphs[paragraphs.length - 1].push(h("sup", Object.assign({ key: at + "n", className: "dsh-polish-badge dsh-polish-n" + (segment.n % 8) }, events), segment.n));
			});
			return paragraphs.filter(function (children) { return children.length; }).map(function (children, index) { return h("p", { key: index }, children); });
		}

		function PolishComparisonView(props) {
			const h = React.createElement;
			const sessionId = props.polishSessionId;
			const [state, setState] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [tip, setTip] = React.useState(null);
			const [undoing, setUndoing] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [saving, setSaving] = React.useState(false);
			const revision = React.useRef(0);
			const hover = {
				current: tip,
				events: function (segment) {
					function show(event) { setTip({ n: segment.n, reason: segment.reason || "修改", x: event.clientX, y: event.clientY }); }
					return { onMouseEnter: show, onMouseMove: show, onMouseLeave: function () { setTip(null); },
						// A tap shows it on touch screens; another tap hides it.
						onClick: function (event) { if (tip && tip.n === segment.n) setTip(null); else show(event); } };
				}
			};
			const load = React.useCallback(async function () {
				const requested = ++revision.current;
				setBusy(true);
				try {
					const result = await rpc("polishComparison", {}, sessionId);
					if (requested === revision.current) setState({ sessionId: sessionId, comparison: result.comparison || null, prereview: result.prereview === true, error: "" });
				} catch (error) {
					if (requested === revision.current) setState({ sessionId: sessionId, comparison: null, error: String(error && error.message || error) });
				} finally { if (requested === revision.current) setBusy(false); }
			}, [sessionId]);
			React.useEffect(function () {
				setState(null);
				void load();
				function changed(event) { if (!event.detail || event.detail.sessionId === sessionId) void load(); }
				window.addEventListener("dsh-tavern-polished", changed);
				return function () { window.removeEventListener("dsh-tavern-polished", changed); };
			}, [sessionId, load]);
			// 自动精修 is one switch for every game: each reply is reviewed as it is written and reworded in place.
			async function togglePrereview(enabled) {
				setSaving(true); setNotice("");
				try {
					const result = await rpc("updateTavernSettings", { patch: { polishPrereview: enabled } });
					setState(function (current) { return current ? Object.assign({}, current, { prereview: result.settings.polishPrereview === true }) : current; });
				} catch (error) { setNotice("保存失败：" + String(error && error.message || error)); }
				finally { setSaving(false); }
			}
			async function undo() {
				setUndoing(true); setNotice("");
				try {
					const result = await rpc("undoPolish", {}, sessionId);
					liveTavernView.setView(sessionId, result.view);
					notifyTavernDataChanged(["sessions"], "polish-compare");
					tavernCoordination.invalidate(sessionId);
					setNotice("已撤销精修，正文恢复成精修前的样子。");
					await load();
				} catch (error) { setNotice("撤销失败：" + String(error && error.message || error)); }
				finally { setUndoing(false); }
			}
			const current = state && state.sessionId === sessionId ? state : null;
			const comparison = current && current.comparison;
			const edits = comparison ? comparison.segments.filter(function (segment) { return segment.kind === "edit"; }).sort(function (a, b) { return a.n - b.n; }) : [];
			const prereview = current ? current.prereview === true : false;
			return h("section", { className: "dsh-tavern-full-context dsh-tavern-polish-compare" },
				h("label", { className: "dsh-tavern-background-task" },
					h("span", null, "自动精修", h("span", { className: "dsh-tavern-settings-desc" }, prereview
						? "每轮正文写完，后台按「正文精修原则」审稿，等本轮结算完成后直接改进正文，正文下方标「已自动精修」；改了什么在这里对比，可撤销。每轮多一次模型调用。"
						: "开启后，每轮正文写完自动精修，不用再手动点「精修」；每轮多一次模型调用。关闭时点「精修」才开始审稿，要等半分钟到一分钟。")),
					h(Switch, { bare: true, label: "自动精修", checked: prereview, disabled: !current || saving, onChange: function (on) { void togglePrereview(on); } })),
				h("header", { className: "dsh-context-header" },
					h("div", null, h("h3", null, "精修"),
						h("p", null, !current ? "读取中…" : comparison
							? (comparison.auto ? "自动精修 · " : "") + "第 " + comparison.turn + " 轮 · 改了 " + comparison.count + " 处" + (comparison.seconds ? " · 用时 " + comparison.seconds + " 秒" : "") + " · " + new Date(comparison.at).toLocaleString()
							: current.error ? "读取失败" : "最近一次精修")),
					h("div", { className: "dsh-polish-actions" },
						comparison ? h("button", { disabled: busy || undoing, onClick: undo }, undoing ? "正在撤销…" : "撤销精修") : null,
						h("button", { disabled: busy, onClick: load }, busy ? "读取中…" : "刷新"))),
				notice ? h("p", { role: "status" }, notice) : null,
				current && current.error ? h("p", { role: "status" }, current.error) : null,
				// the shared empty state.
				current && !comparison && !current.error ? h(EmptyState, { text: "还没有可对比的精修。在最后一轮正文下点「重新生成正文」→「精修」，改完回到这里看前后对比、撤销精修；那轮正文再改动或重新生成后，这里就清空。" }) : null,
				comparison ? h("div", { className: "dsh-polish-cols" },
					h("div", { className: "dsh-polish-col" }, h("h4", null, "原文"), tavernPolishParagraphs(comparison.segments, "before", hover)),
					h("div", { className: "dsh-polish-col" }, h("h4", null, "精修"), tavernPolishParagraphs(comparison.segments, "after", hover))) : null,
				tip ? h("div", { className: "dsh-polish-tip", role: "tooltip", style: { left: Math.min(tip.x + 14, window.innerWidth - 336) + "px", top: (tip.y + 18) + "px" } },
					h("span", { className: "dsh-polish-badge dsh-polish-n" + (tip.n % 8) }, tip.n), tip.reason) : null,
				edits.length ? h("ol", { className: "dsh-polish-reasons" }, edits.map(function (segment) {
					return h("li", { key: segment.n }, h("span", { className: "dsh-polish-badge dsh-polish-n" + (segment.n % 8) }, segment.n), segment.reason || "修改");
				})) : null);
		}
