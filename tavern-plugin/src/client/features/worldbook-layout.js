		// ==== 世界书库 › 常驻排布（方案 A · 纵序横条 + GPU FLIP 动画 + 防误触内容速览）====
		// 严格按服务端同一套合并/分类/promptOrder 计算常驻条目排布，支持跨通道（稳定前缀 ↔ 每轮尾部）
		// 与区内拖拽调序、键盘微调、撤销回退，以及兼容移动端且不误触的快速内容查看。
		const WBL_BOOK_PALETTE_COUNT = 6;
		const WBL_LAND_BADGE_MS = 1800;

		function wblFmtTokens(value) {
			const n = Math.max(0, Number(value) || 0);
			return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
		}

		function wblPlacementLabel(item) {
			const key = String(item && item.placementKey || "0");
			if (key === "0") return "位置 0（前置）";
			if (key === "1") return "位置 1（后置）";
			if (key.startsWith("4:")) return "深度注入 " + key.slice(2);
			return "位置 " + key;
		}

		function wblCaptureFlipRects(rootEl) {
			const map = new Map();
			if (!rootEl || !rootEl.querySelectorAll) return map;
			rootEl.querySelectorAll("[data-wbl-flip]").forEach(function (node) {
				const rect = node.getBoundingClientRect();
				if (rect.width > 0 || rect.height > 0) map.set(node.getAttribute("data-wbl-flip"), rect);
			});
			return map;
		}

		function wblPlayFlip(rootEl, prevRects, options) {
			if (!rootEl || !prevRects || !prevRects.size) return;
			const skipKey = options && options.skipKey ? options.skipKey : null;
			const duration = options && options.duration ? options.duration : 360;
			const targets = [];
			rootEl.querySelectorAll("[data-wbl-flip]").forEach(function (node) {
				const key = node.getAttribute("data-wbl-flip");
				if (!key || key === skipKey) return;
				const prev = prevRects.get(key);
				if (!prev) return;
				const next = node.getBoundingClientRect();
				const dx = prev.left - next.left;
				const dy = prev.top - next.top;
				if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) return;
				node.style.transition = "none";
				node.style.willChange = "transform";
				node.style.transform = "translate3d(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px, 0)";
				targets.push(node);
			});
			if (!targets.length) return;
			void rootEl.offsetHeight;
			window.requestAnimationFrame(function () {
				targets.forEach(function (node) {
					node.style.transition = "transform " + duration + "ms cubic-bezier(0.22, 1, 0.36, 1)";
					node.style.transform = "translate3d(0, 0, 0)";
					const clean = function () {
						node.style.transition = "";
						node.style.transform = "";
						node.style.willChange = "";
					};
					node.addEventListener("transitionend", clean, { once: true });
					window.setTimeout(clean, duration + 60);
				});
			});
		}

		function WblIcon(props) {
			const h = React.createElement, name = props.name;
			if (name === "eye") {
				return h("svg", { className: "dsh-wbl-svg", width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("path", { d: "M1.75 8C3.2 5.1 5.45 3.75 8 3.75S12.8 5.1 14.25 8C12.8 10.9 10.55 12.25 8 12.25S3.2 10.9 1.75 8Z", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round" }),
					h("circle", { cx: 8, cy: 8, r: 2, stroke: "currentColor", strokeWidth: 1.35 }));
			}
			if (name === "grip") {
				return h("svg", { className: "dsh-wbl-svg", width: 14, height: 14, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true },
					h("circle", { cx: 5.5, cy: 3.5, r: 1.15 }), h("circle", { cx: 10.5, cy: 3.5, r: 1.15 }),
					h("circle", { cx: 5.5, cy: 8, r: 1.15 }), h("circle", { cx: 10.5, cy: 8, r: 1.15 }),
					h("circle", { cx: 5.5, cy: 12.5, r: 1.15 }), h("circle", { cx: 10.5, cy: 12.5, r: 1.15 }));
			}
			if (name === "up") {
				return h("svg", { className: "dsh-wbl-svg", width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("path", { d: "M4 10l4-4 4 4", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }));
			}
			if (name === "down") {
				return h("svg", { className: "dsh-wbl-svg", width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("path", { d: "M4 6l4 4 4-4", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }));
			}
			if (name === "bars") {
				return h("svg", { className: "dsh-wbl-svg", width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("rect", { x: 2, y: 2.5, width: 11, height: 2.6, rx: 1.2, fill: "currentColor" }),
					h("rect", { x: 2, y: 6.7, width: 7.5, height: 2.6, rx: 1.2, fill: "currentColor", opacity: 0.78 }),
					h("rect", { x: 2, y: 10.9, width: 9.5, height: 2.6, rx: 1.2, fill: "currentColor", opacity: 0.56 }));
			}
			if (name === "lock") {
				return h("svg", { className: "dsh-wbl-svg", width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					h("rect", { x: 3.5, y: 7.2, width: 9, height: 6.3, rx: 1.6, stroke: "currentColor", strokeWidth: 1.35 }),
					h("path", { d: "M5.5 7.2V5.3a2.5 2.5 0 0 1 5 0v1.9", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round" }));
			}
			return null;
		}

		// 快速查看条目内容弹层（桌面端居中、移动端自动底部抽屉；独立滚动、文字可选中、支持一键切通道与跳原书编辑）。
		function WorldBookLayoutPreviewModal(props) {
			const h = React.createElement, item = props.item;
			const [fullContent, setFullContent] = React.useState(item ? item.preview : "");
			const [loadingFull, setLoadingFull] = React.useState(false);
			const [loadError, setLoadError] = React.useState("");

			React.useEffect(function () {
				if (!item) return;
				setFullContent(item.preview || "");
				setLoadError("");
				if (!item.contentTruncated) { setLoadingFull(false); return; }
				let cancelled = false;
				setLoadingFull(true);
				rpcWithTimeout("getWorldBookEntryContent", { source: item.bookSource, ref: item.entryRef }, props.sessionId).then(function (result) {
					if (cancelled) return;
					if (result && typeof result.content === "string") setFullContent(result.content);
					setLoadingFull(false);
				}, function (err) {
					if (cancelled) return;
					setLoadError(String(err && err.message || err));
					setLoadingFull(false);
				});
				return function () { cancelled = true; };
			}, [item && item.id, item && item.preview, item && item.contentTruncated, props.sessionId]);

			if (!item) return null;
			const toPrefix = item.zone === "tail";
			const colorIndex = item.bookIndex % WBL_BOOK_PALETTE_COUNT;
			const foot = h("footer", { className: "dsh-wbl-preview-foot" },
				h("div", { className: "dsh-wbl-preview-move-group" },
					h("button", { type: "button", className: "dsh-wbl-chip-btn", disabled: props.busy, onClick: function () { props.onNudge(item.id, -1); } }, "↑ 前移"),
					h("button", { type: "button", className: "dsh-wbl-chip-btn", disabled: props.busy, onClick: function () { props.onNudge(item.id, 1); } }, "↓ 后移"),
					h("button", {
						type: "button",
						className: "dsh-wbl-chip-btn",
						disabled: props.busy || (toPrefix && item.lockedToTail),
						title: toPrefix && item.lockedToTail ? "含模板、宏或随机的动态条目无法进入稳定前缀" : undefined,
						onClick: function () { props.onSwitchZone(item.id); }
					}, toPrefix ? (item.lockedToTail ? "动态条目锁尾部" : "⇄ 移入稳定前缀") : "⇄ 移至每轮尾部")),
				h("div", { className: "dsh-wbl-preview-primary-group" },
					h(packUi.Button, {
						primary: true,
						onClick: function () {
							props.onClose();
							props.onOpenBookEntry(item.bookSource, item.entryRef);
						}
					}, "去原书编辑")));

			return h(packUi.Modal, {
				title: item.title || "未命名条目",
				onClose: props.onClose,
				className: "dsh-wbl-preview-modal",
				foot: foot
			},
				h("div", { className: "dsh-wbl-preview-meta" },
					h("span", { className: "dsh-wbl-meta-pill", "data-book-color": colorIndex },
						h("i", { className: "dsh-wbl-color-dot" }),
						item.bookName,
						item.bookIsGlobal ? " · 全局" : item.bookIsPrimary ? " · 主书" : ""),
					h("span", { className: "dsh-wbl-meta-pill" }, item.zone === "prefix" ? "稳定前缀" : "每轮尾部"),
					h("span", { className: "dsh-wbl-meta-pill dsh-wbl-mono" }, "#" + item.order),
					h("span", { className: "dsh-wbl-meta-pill" }, wblPlacementLabel(item)),
					h("span", { className: "dsh-wbl-meta-pill dsh-wbl-mono" }, "约 " + wblFmtTokens(item.tokens) + " token"),
					item.dynamic ? h("span", { className: "dsh-wbl-meta-pill is-warn" }, "动态 · 锁定尾部") : null,
					item.forcedChannel ? h("span", { className: "dsh-wbl-meta-pill is-accent" }, "非常驻强注") : null,
					item.budgetEvicted ? h("span", { className: "dsh-wbl-meta-pill is-danger" }, "超出尾部预算") : null),
				item.primaryKeys && item.primaryKeys.length
					? h("div", { className: "dsh-wbl-preview-keys" },
						h("span", { className: "dsh-wbl-preview-keys-label" }, "触发词："),
						item.primaryKeys.join("、"))
					: null,
				loadError ? h(packUi.HintLine, { text: "读取完整正文失败（先显示前段预览）：" + loadError }) : null,
				h("div", { className: "dsh-wbl-preview-body", role: "region", "aria-label": "条目正文预览" },
					fullContent ? h("pre", { className: "dsh-wbl-preview-text" }, fullContent)
						: h("p", { className: "dsh-wbl-preview-empty" }, "该条目目前没有正文内容"),
					loadingFull ? h("p", { className: "dsh-wbl-preview-loading" }, "正在载入剩余全文（共 " + item.contentLength + " 字）…") : null));
		}

		function WorldBookPromptLayoutPage(props) {
			const h = React.createElement;
			const askConfirm = useTavernConfirm(props.sessionId);
			const [layout, setLayout] = React.useState(props.initialLayout || null);
			const [loading, setLoading] = React.useState(!props.initialLayout);
			const [saving, setSaving] = React.useState(false);
			const [savedOnce, setSavedOnce] = React.useState(false);
			const [error, setError] = usePersistentError("常驻排布");
			const [selectedId, setSelectedId] = React.useState(null);
			const [previewId, setPreviewId] = React.useState(null);
			const [prefixCacheNotice, setPrefixCacheNotice] = React.useState(false);
			const [tailCostNotice, setTailCostNotice] = React.useState("");
			const [toastText, setToastText] = React.useState("");
			const [undoStack, setUndoStack] = React.useState([]);
			const [landed, setLanded] = React.useState(null); // { id, text }
			const [dragUi, setDragUi] = React.useState(null); // { id, activeZone, blockedZone }

			const rootRef = React.useRef(null);
			const layoutRef = React.useRef(layout);
			layoutRef.current = layout;
			const savingRef = React.useRef(false);
			savingRef.current = saving;
			const dragRef = React.useRef(null);
			const pendingFlipRef = React.useRef(null);
			const toastTimerRef = React.useRef(null);
			const landTimerRef = React.useRef(null);
			const saveQueueRef = React.useRef(Promise.resolve());

			function showToast(message) {
				setToastText(message);
				if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
				toastTimerRef.current = window.setTimeout(function () { setToastText(""); }, 2600);
			}

			function markLanded(id, text) {
				setLanded({ id: id, text: text });
				if (landTimerRef.current) window.clearTimeout(landTimerRef.current);
				landTimerRef.current = window.setTimeout(function () { setLanded(null); }, WBL_LAND_BADGE_MS);
			}

			function triggerFlip(fn, options) {
				const prev = wblCaptureFlipRects(rootRef.current);
				pendingFlipRef.current = { prev: prev, options: options || { duration: 380 } };
				fn();
			}

			React.useLayoutEffect(function () {
				const job = pendingFlipRef.current;
				if (!job) return;
				pendingFlipRef.current = null;
				wblPlayFlip(rootRef.current, job.prev, job.options);
			});

			React.useEffect(function () {
				return function () {
					if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
					if (landTimerRef.current) window.clearTimeout(landTimerRef.current);
					if (dragRef.current && dragRef.current.ghostEl) dragRef.current.ghostEl.remove();
				};
			}, []);

			function fetchLayout(silent) {
				if (!silent) setLoading(true);
				setError("");
				return rpcWithTimeout("getWorldBookPromptLayout", {}, props.sessionId).then(function (result) {
					setLayout(result);
					if (props.onLayoutLoaded) props.onLayoutLoaded(result);
					setLoading(false);
					return result;
				}, function (err) {
					setError(String(err && err.message || err));
					setLoading(false);
					return null;
				});
			}

			React.useEffect(function () {
				fetchLayout(Boolean(props.initialLayout));
			}, [props.sessionId]);

			useVisibleDataRefresh(props.visible, function (event) {
				return tavernDataChangeAffects(event, ["worldbooks", "cards"], "worldbooks");
			}, function () {
				if (dragRef.current || savingRef.current) return;
				return fetchLayout(true);
			}, props.sessionId);

			function applyLayoutProjection(current, nextPrefix, nextTail, nextBudget) {
				const prefixTokens = nextPrefix.reduce(function (sum, item) { return sum + item.tokens; }, 0);
				const tailTokens = nextTail.reduce(function (sum, item) { return sum + item.tokens; }, 0);
				return Object.assign({}, current, {
					prefix: nextPrefix,
					tail: nextTail,
					summary: {
						totalCount: nextPrefix.length + nextTail.length,
						prefixCount: nextPrefix.length,
						tailCount: nextTail.length,
						totalTokens: prefixTokens + tailTokens,
						prefixTokens: prefixTokens,
						tailTokens: tailTokens
					},
					budget: nextBudget || current.budget
				});
			}

			function persistBookUpdates(updates) {
				const run = saveQueueRef.current.then(async function () {
					setSaving(true);
					setError("");
					try {
						for (const item of updates) {
							await rpc("updateWorldBook", {
								source: item.source,
								lean: true,
								update: { operations: item.operations }
							}, props.sessionId);
						}
						setSavedOnce(true);
						notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
						return true;
					} catch (err) {
						setError("保存排布失败：" + String(err && err.message || err));
						await fetchLayout(true);
						return false;
					} finally {
						setSaving(false);
					}
				});
				saveQueueRef.current = run;
				return run;
			}

			function buildInverseUpdates(beforeLayout, updates) {
				const beforeByKey = new Map();
				beforeLayout.prefix.concat(beforeLayout.tail).forEach(function (item) {
					beforeByKey.set(JSON.stringify(item.bookSource) + "\n" + item.entryRef, item);
				});
				return updates.map(function (bookUpdate) {
					const bookKey = JSON.stringify(bookUpdate.source);
					return {
						source: bookUpdate.source,
						bookName: bookUpdate.bookName,
						bookIsGlobal: bookUpdate.bookIsGlobal,
						operations: bookUpdate.operations.map(function (op) {
							const prev = beforeByKey.get(bookKey + "\n" + op.ref);
							const patch = {};
							if (prev) {
								if (Object.prototype.hasOwnProperty.call(op.patch, "order")) patch.order = prev.order;
								if (Object.prototype.hasOwnProperty.call(op.patch, "channel")) {
									patch.channel = prev.channelInherited ? null : prev.channel;
								}
								if (Object.prototype.hasOwnProperty.call(op.patch, "position")) patch.position = prev.position;
								if (Object.prototype.hasOwnProperty.call(op.patch, "depth")) patch.depth = prev.depth;
								if (Object.prototype.hasOwnProperty.call(op.patch, "role")) patch.role = prev.role;
							}
							return { op: "update", ref: op.ref, patch: patch };
						})
					};
				});
			}

			async function commitReorder(movedId, targetZone, targetIndex, baseLayoutOverride) {
				const base = baseLayoutOverride || layoutRef.current;
				if (!base) return;
				const plan = planWorldBookLayoutReorder({
					prefix: base.prefix,
					tail: base.tail,
					movedId: movedId,
					targetZone: targetZone,
					targetIndex: targetIndex,
					tokenBudget: base.budget ? base.budget.limit : 8192
				});
				if (!plan.ok) {
					if (plan.reason === "dynamic-locked") {
						showToast("含模板、宏或随机的动态条目无法进入稳定前缀");
					}
					if (baseLayoutOverride) {
						triggerFlip(function () { setLayout(base); }, { duration: 320 });
					}
					return;
				}
				if (!plan.changed) {
					if (baseLayoutOverride) {
						triggerFlip(function () { setLayout(base); }, { duration: 240 });
					}
					return;
				}

				if (plan.affectedGlobalBooks.length) {
					const names = plan.affectedGlobalBooks.map(function (name) { return "「" + name + "」"; }).join("、");
					const ok = await askConfirm(
						"将修改全局书" + names + "的条目排序，所有人物卡都会受影响。",
						{ title: "修改全局世界书排序？", confirmText: "继续保存", hide: "worldbook-layout-global" }
					);
					if (!ok) {
						triggerFlip(function () { setLayout(base); }, { duration: 320 });
						return;
					}
				}

				const nextLayout = applyLayoutProjection(base, plan.prefix, plan.tail, plan.budget);
				const inverse = buildInverseUpdates(base, plan.updates);
				const movedChange = plan.changes.find(function (c) { return c.id === movedId; }) || plan.changes[0];
				const movedItem = nextLayout.prefix.concat(nextLayout.tail).find(function (it) { return it.id === movedId; });

				let badgeText = "";
				if (plan.channelChanged) {
					badgeText = targetZone === "tail"
						? "⇄ 移至每轮尾部 · +" + wblFmtTokens(movedItem ? movedItem.tokens : 0) + "/轮"
						: "⇄ 移入稳定前缀 · #" + (movedItem ? movedItem.order : "");
				} else if (movedChange) {
					const delta = plan.newIndex - plan.oldIndex;
					badgeText = (delta < 0 ? "↑ 前移 " + Math.abs(delta) + " 位" : "↓ 后移 " + delta + " 位")
						+ " · #" + movedChange.prevOrder + "→#" + movedChange.nextOrder;
				}

				triggerFlip(function () {
					setLayout(nextLayout);
					setSelectedId(movedId);
					setUndoStack(function (stack) { return stack.concat([{ before: base, inverseUpdates: inverse, movedId: movedId }]).slice(-15); });
				}, { duration: 380 });
				if (badgeText) markLanded(movedId, badgeText);

				if (plan.prefixChanged) setPrefixCacheNotice(true);
				if (plan.channelChanged && targetZone === "tail" && movedItem) {
					setTailCostNotice("「" + movedItem.title + "」已移至每轮尾部：每轮将多占用约 " + wblFmtTokens(movedItem.tokens) + " token。");
					showToast("已移至每轮尾部（每轮 +" + wblFmtTokens(movedItem.tokens) + " token）");
				} else if (plan.channelChanged && targetZone === "prefix") {
					setTailCostNotice("");
					showToast("已移入稳定前缀（下一轮触发一次缓存重建）");
				} else if (plan.prefixChanged) {
					showToast("已调整稳定前缀顺序（下一轮触发一次缓存重建）");
				} else {
					showToast("已调整每轮尾部顺序（不影响前缀缓存）");
				}

				const ok = await persistBookUpdates(plan.updates);
				if (ok && props.onLayoutLoaded) props.onLayoutLoaded(nextLayout);
			}

			function nudgeItem(itemId, direction) {
				const current = layoutRef.current;
				if (!current || savingRef.current) return;
				const inPrefix = current.prefix.findIndex(function (it) { return it.id === itemId; });
				if (inPrefix >= 0) {
					const nextIdx = inPrefix + direction;
					if (nextIdx >= 0 && nextIdx < current.prefix.length) {
						commitReorder(itemId, "prefix", nextIdx);
					} else if (direction > 0) {
						commitReorder(itemId, "tail", 0);
					}
					return;
				}
				const inTail = current.tail.findIndex(function (it) { return it.id === itemId; });
				if (inTail >= 0) {
					const nextIdx = inTail + direction;
					if (nextIdx >= 0 && nextIdx < current.tail.length) {
						commitReorder(itemId, "tail", nextIdx);
					} else if (direction < 0) {
						commitReorder(itemId, "prefix", current.prefix.length);
					}
				}
			}

			function switchItemZone(itemId) {
				const current = layoutRef.current;
				if (!current || savingRef.current) return;
				const item = current.prefix.concat(current.tail).find(function (it) { return it.id === itemId; });
				if (!item) return;
				const targetZone = item.zone === "prefix" ? "tail" : "prefix";
				const targetIndex = targetZone === "prefix" ? current.prefix.length : 0;
				commitReorder(itemId, targetZone, targetIndex);
			}

			async function handleUndo() {
				if (!undoStack.length || savingRef.current) return;
				const top = undoStack[undoStack.length - 1];
				setUndoStack(function (stack) { return stack.slice(0, -1); });
				triggerFlip(function () { setLayout(top.before); }, { duration: 380 });
				markLanded(top.movedId, "已撤销");
				showToast("正在撤销上一步排序…");
				const ok = await persistBookUpdates(top.inverseUpdates);
				if (ok) {
					showToast("已撤销上一步排序");
					if (props.onLayoutLoaded) props.onLayoutLoaded(top.before);
				}
			}

			// 键盘 Alt + ↑ / ↓ 微调当前选中条目
			React.useEffect(function () {
				function onKeyDown(event) {
					if (!event.altKey || !selectedId || previewId) return;
					if (event.key === "ArrowUp") { event.preventDefault(); nudgeItem(selectedId, -1); }
					else if (event.key === "ArrowDown") { event.preventDefault(); nudgeItem(selectedId, 1); }
				}
				window.addEventListener("keydown", onKeyDown);
				return function () { window.removeEventListener("keydown", onKeyDown); };
			}, [selectedId, previewId]);

			// 自定义高性能 Pointer 拖拽（移动端仅从左侧拖柄起拖，避免滚动或浏览时误触；桌面支持整行起拖）
			function startRowPointerDrag(event, item, fromHandle) {
				if (savingRef.current) return;
				if (event.target && event.target.closest && event.target.closest("button:not(.dsh-wbl-handle)")) return;
				if (event.pointerType === "touch" && !fromHandle) return;
				if (event.pointerType === "mouse" && event.button !== 0) return;

				const rowEl = event.currentTarget.closest ? event.currentTarget.closest("[data-wbl-item]") : event.currentTarget;
				if (!rowEl) return;
				const startX = event.clientX;
				const startY = event.clientY;
				let started = false;
				let rafId = null;
				let latestEv = event;

				function positionGhost(cx, cy, vx) {
					const d = dragRef.current;
					if (!d || !d.ghostEl) return;
					const x = cx - d.offsetX;
					const y = cy - d.offsetY;
					const tilt = Math.max(-2.4, Math.min(2.4, vx * 0.14));
					d.ghostEl.style.transform = "translate3d(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px, 0) scale(1.025) rotate(" + tilt.toFixed(2) + "deg)";
				}

				function begin(moveEv) {
					const rect = rowEl.getBoundingClientRect();
					const ghost = rowEl.cloneNode(true);
					ghost.classList.remove("is-selected", "is-just-landed", "is-drag-placeholder");
					ghost.classList.add("dsh-wbl-drag-ghost");
					ghost.removeAttribute("data-wbl-flip");
					ghost.removeAttribute("data-wbl-item");
					ghost.style.width = rect.width + "px";
					ghost.style.height = rect.height + "px";
					const tag = document.createElement("span");
					tag.className = "dsh-wbl-ghost-tag";
					tag.textContent = "拖动中 · " + (item.zone === "prefix" ? "稳定前缀" : "每轮尾部");
					ghost.appendChild(tag);
					document.body.appendChild(ghost);

					const base = layoutRef.current;
					dragRef.current = {
						id: item.id,
						item: item,
						ghostEl: ghost,
						ghostTagEl: tag,
						offsetX: startX - rect.left,
						offsetY: startY - rect.top,
						prevX: moveEv.clientX,
						preLayout: base,
						targetZone: item.zone,
						targetIndex: (item.zone === "prefix" ? base.prefix : base.tail).findIndex(function (it) { return it.id === item.id; }),
						blockedZone: false,
						lastSwapAt: 0,
						lastSwapKey: ""
					};
					setSelectedId(item.id);
					setDragUi({ id: item.id, activeZone: item.zone, blockedZone: false });
					positionGhost(moveEv.clientX, moveEv.clientY, 0);
				}

				function updateFrame(moveEv) {
					const d = dragRef.current;
					const root = rootRef.current;
					const current = layoutRef.current;
					if (!d || !root || !current) return;
					const vx = moveEv.clientX - d.prevX;
					d.prevX = moveEv.clientX;
					positionGhost(moveEv.clientX, moveEv.clientY, vx);

					const zones = Array.from(root.querySelectorAll("[data-wbl-zone]"));
					let hoveredZone = null;
					for (const zoneEl of zones) {
						const r = zoneEl.getBoundingClientRect();
						if (moveEv.clientY >= r.top - 18 && moveEv.clientY <= r.bottom + 18) {
							hoveredZone = zoneEl.getAttribute("data-wbl-zone");
							break;
						}
					}

					if (hoveredZone === "prefix" && d.item.lockedToTail) {
						d.blockedZone = true;
						d.ghostTagEl.classList.add("is-blocked");
						d.ghostTagEl.textContent = "动态条目不可移入稳定前缀";
						setDragUi({ id: d.id, activeZone: null, blockedZone: true });
						return;
					}

					d.blockedZone = false;
					d.ghostTagEl.classList.remove("is-blocked");
					if (!hoveredZone) {
						setDragUi({ id: d.id, activeZone: null, blockedZone: false });
						return;
					}

					const zoneEl = zones.find(function (z) { return z.getAttribute("data-wbl-zone") === hoveredZone; });
					const siblings = Array.from(zoneEl.querySelectorAll("[data-wbl-item]")).filter(function (el) {
						return el.getAttribute("data-wbl-item") !== d.id;
					});

					let insertIdx = siblings.length;
					for (let i = 0; i < siblings.length; i += 1) {
						const r = siblings[i].getBoundingClientRect();
						if (moveEv.clientY < r.top + r.height * 0.5) {
							insertIdx = i;
							break;
						}
					}

					const draggedNow = current.prefix.concat(current.tail).find(function (it) { return it.id === d.id; });
					if (!draggedNow) return;
					const curList = draggedNow.zone === "prefix" ? current.prefix : current.tail;
					const curIdx = curList.findIndex(function (it) { return it.id === d.id; });

					d.targetZone = hoveredZone;
					d.targetIndex = insertIdx;
					d.ghostTagEl.textContent = hoveredZone === "prefix"
						? "释放到：稳定前缀 第 " + (insertIdx + 1) + " 位"
						: "释放到：每轮尾部 第 " + (insertIdx + 1) + " 位" + (d.item.zone === "prefix" ? " · 每轮 +" + wblFmtTokens(d.item.tokens) : "");

					if (draggedNow.zone === hoveredZone && curIdx === insertIdx) {
						setDragUi(function (prev) {
							return prev && prev.activeZone === hoveredZone && !prev.blockedZone ? prev : { id: d.id, activeZone: hoveredZone, blockedZone: false };
						});
						return;
					}

					const swapKey = hoveredZone + ":" + insertIdx;
					const now = performance.now();
					if (d.lastSwapKey === swapKey && now - d.lastSwapAt < 120) return;
					d.lastSwapAt = now;
					d.lastSwapKey = swapKey;

					const nextPrefix = current.prefix.filter(function (it) { return it.id !== d.id; });
					const nextTail = current.tail.filter(function (it) { return it.id !== d.id; });
					const movedCopy = Object.assign({}, draggedNow, { zone: hoveredZone });
					if (hoveredZone === "prefix") nextPrefix.splice(insertIdx, 0, movedCopy);
					else nextTail.splice(insertIdx, 0, movedCopy);

					const previewLayout = applyLayoutProjection(current, nextPrefix, nextTail, current.budget);
					triggerFlip(function () {
						setLayout(previewLayout);
						setDragUi({ id: d.id, activeZone: hoveredZone, blockedZone: false });
					}, { skipKey: "row:" + d.id, duration: 280 });
				}

				function finish(cancelled) {
					const d = dragRef.current;
					dragRef.current = null;
					setDragUi(null);
					if (!d) return;

					if (cancelled || d.blockedZone) {
						if (d.ghostEl) d.ghostEl.remove();
						if (d.blockedZone) showToast("动态条目含模板或随机内容，已留在每轮尾部");
						triggerFlip(function () { setLayout(d.preLayout); }, { duration: 320 });
						return;
					}

					const root = rootRef.current;
					const slot = root ? root.querySelector('[data-wbl-item="' + d.id.replace(/"/g, '\\"') + '"]') : null;
					const slotRect = slot ? slot.getBoundingClientRect() : null;
					const finalize = function () {
						if (d.ghostEl) d.ghostEl.remove();
						commitReorder(d.id, d.targetZone, d.targetIndex, d.preLayout);
					};

					if (slotRect && d.ghostEl) {
						if (d.ghostTagEl) d.ghostTagEl.style.opacity = "0";
						d.ghostEl.style.transition = "transform 160ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease";
						d.ghostEl.style.transform = "translate3d(" + slotRect.left.toFixed(1) + "px, " + slotRect.top.toFixed(1) + "px, 0) scale(1) rotate(0deg)";
						d.ghostEl.style.opacity = "0.92";
						window.setTimeout(finalize, 155);
					} else {
						finalize();
					}
				}

				function onMove(moveEv) {
					latestEv = moveEv;
					if (!started) {
						if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) < 6) return;
						started = true;
						begin(moveEv);
					}
					if (moveEv.cancelable) moveEv.preventDefault();
					if (!rafId) {
						rafId = window.requestAnimationFrame(function () {
							rafId = null;
							updateFrame(latestEv);
						});
					}
				}

				function onEnd() {
					window.removeEventListener("pointermove", onMove, { passive: false });
					window.removeEventListener("pointerup", onEnd);
					window.removeEventListener("pointercancel", onEnd);
					window.removeEventListener("keydown", onEsc);
					if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
					if (!started) {
						setSelectedId(item.id);
						return;
					}
					finish(false);
				}

				function onEsc(kEv) {
					if (kEv.key !== "Escape") return;
					window.removeEventListener("pointermove", onMove, { passive: false });
					window.removeEventListener("pointerup", onEnd);
					window.removeEventListener("pointercancel", onEnd);
					window.removeEventListener("keydown", onEsc);
					if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
					if (started) finish(true);
				}

				window.addEventListener("pointermove", onMove, { passive: false });
				window.addEventListener("pointerup", onEnd);
				window.addEventListener("pointercancel", onEnd);
				window.addEventListener("keydown", onEsc);
			}

			if (loading && !layout) {
				return h("div", { className: "fork-tab-scroll dsh-wbl-scroll" },
					h("div", { className: "ap-ui dsh-wbl-page" },
						h(PanelLoading, { shape: "rows", label: "正在计算常驻条目排布…" })));
			}

			const prefix = layout && Array.isArray(layout.prefix) ? layout.prefix : [];
			const tail = layout && Array.isArray(layout.tail) ? layout.tail : [];
			const allItems = prefix.concat(tail);
			const summary = layout && layout.summary ? layout.summary : { totalCount: 0, prefixCount: 0, tailCount: 0, totalTokens: 0, prefixTokens: 0, tailTokens: 0 };
			const budget = layout && layout.budget ? layout.budget : { limit: 8192, used: 0, overflowed: false };
			const books = layout && Array.isArray(layout.books) ? layout.books : [];
			const maxTokens = Math.max.apply(null, [1].concat(allItems.map(function (it) { return it.tokens || 0; })));
			const budgetPct = budget.limit > 0 ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : 0;
			const evictedCount = tail.filter(function (it) { return it.budgetEvicted; }).length;
			const previewItem = previewId ? allItems.find(function (it) { return it.id === previewId; }) || null : null;
			const titleText = layout && layout.cardName ? "常驻排布 · " + layout.cardName : "常驻排布 · 全局世界书";

			function renderEntryRow(item) {
				const barPct = Math.max(6, Math.round(((item.tokens || 0) / maxTokens) * 100));
				const colorIndex = item.bookIndex % WBL_BOOK_PALETTE_COUNT;
				const isPlaceholder = dragUi && dragUi.id === item.id;
				const isLanded = landed && landed.id === item.id;
				const rowCls = [
					"dsh-wbl-row",
					selectedId === item.id ? "is-selected" : "",
					item.dynamic ? "is-dynamic" : "",
					item.budgetEvicted ? "is-evicted" : "",
					isPlaceholder ? "is-drag-placeholder" : "",
					isLanded ? "is-just-landed" : ""
				].filter(Boolean).join(" ");

				return h("li", {
					key: item.id,
					className: rowCls,
					"data-wbl-item": item.id,
					"data-wbl-flip": "row:" + item.id,
					"data-book-color": colorIndex,
					"data-slot-hint": item.zone === "prefix" ? "松手落入：稳定前缀" : "松手落入：每轮尾部",
					onPointerDown: function (event) { startRowPointerDrag(event, item, false); }
				},
					isLanded && landed.text ? h("span", { className: "dsh-wbl-move-badge", role: "status" }, landed.text) : null,
					h("button", {
						type: "button",
						className: "dsh-wbl-handle",
						"aria-label": "拖动调整「" + item.title + "」位置",
						title: "按住拖动调整顺序或跨通道",
						onPointerDown: function (event) { event.stopPropagation(); startRowPointerDrag(event, item, true); }
					}, h(WblIcon, { name: "grip" })),
					h("div", { className: "dsh-wbl-info" },
						h("div", { className: "dsh-wbl-name-line" },
							h("span", { className: "dsh-wbl-name", title: item.title }, item.title),
							h("span", { className: "dsh-wbl-tok-mobile dsh-wbl-mono" }, wblFmtTokens(item.tokens))),
						h("div", { className: "dsh-wbl-tags" },
							h("span", { className: "dsh-wbl-book-label" },
								h("i", { className: "dsh-wbl-color-dot" }),
								item.bookName),
							item.bookIsGlobal ? h("span", { className: "dsh-wbl-tag is-global" }, "全局") : null,
							item.dynamic ? h("span", { className: "dsh-wbl-tag is-dyn" }, h(WblIcon, { name: "lock" }), "动态") : null,
							item.forcedChannel ? h("span", { className: "dsh-wbl-tag is-forced" }, "强注") : null,
							item.budgetEvicted ? h("span", { className: "dsh-wbl-tag is-evict" }, "超预算") : null)),
					h("div", { className: "dsh-wbl-bar-wrap" },
						h("div", { className: "dsh-wbl-bar-track" },
							h("div", { className: "dsh-wbl-bar-fill", style: { width: barPct + "%" } })),
						h("span", { className: "dsh-wbl-order-mobile dsh-wbl-mono" }, "#" + item.order)),
					h("span", { className: "dsh-wbl-tok dsh-wbl-mono", title: "估算约 " + item.tokens + " token" }, wblFmtTokens(item.tokens)),
					h("span", { className: "dsh-wbl-order dsh-wbl-mono", title: "排序值 order：" + item.order + " · " + wblPlacementLabel(item) }, "#" + item.order),
					h("div", { className: "dsh-wbl-ops" },
						h("button", {
							type: "button",
							className: "dsh-wbl-op-btn dsh-wbl-preview-btn",
							"aria-label": "查看「" + item.title + "」内容",
							title: "快速查看条目内容",
							onClick: function (event) { event.stopPropagation(); setSelectedId(item.id); setPreviewId(item.id); }
						}, h(WblIcon, { name: "eye" })),
						h("button", {
							type: "button",
							className: "dsh-wbl-op-btn",
							disabled: saving,
							"aria-label": "上移「" + item.title + "」",
							title: "前移一位（Alt+↑）",
							onClick: function (event) { event.stopPropagation(); nudgeItem(item.id, -1); }
						}, h(WblIcon, { name: "up" })),
						h("button", {
							type: "button",
							className: "dsh-wbl-op-btn",
							disabled: saving,
							"aria-label": "下移「" + item.title + "」",
							title: "后移一位（Alt+↓）",
							onClick: function (event) { event.stopPropagation(); nudgeItem(item.id, 1); }
						}, h(WblIcon, { name: "down" }))));
			}

			function renderRibbonSegment(item) {
				const pct = Math.max(2, ((item.tokens || 0) / Math.max(1, summary.totalTokens)) * 100);
				const colorIndex = item.bookIndex % WBL_BOOK_PALETTE_COUNT;
				return h("button", {
					key: item.id,
					type: "button",
					className: "dsh-wbl-ribbon-seg"
						+ (item.zone === "tail" ? " is-tail" : "")
						+ (item.budgetEvicted ? " is-evicted" : "")
						+ (selectedId === item.id ? " is-selected" : ""),
					"data-book-color": colorIndex,
					"data-wbl-flip": "seg:" + item.id,
					style: { width: pct.toFixed(2) + "%" },
					title: item.title + " · " + item.bookName + " · " + wblFmtTokens(item.tokens) + " token（" + (item.zone === "prefix" ? "稳定前缀" : "每轮尾部") + "）",
					"aria-label": "定位到 " + item.title,
					onClick: function () {
						setSelectedId(item.id);
						const target = rootRef.current && rootRef.current.querySelector('[data-wbl-item="' + item.id.replace(/"/g, '\\"') + '"]');
						if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
					}
				});
			}

			const pageKeys = function (event) {
				if (event.key === "Escape" && !event.defaultPrevented && !previewId && props.onBack && event.target === event.currentTarget) {
					props.onBack();
				}
			};

			return h("div", { className: "fork-tab-scroll dsh-wbl-scroll" },
				h("section", { ref: rootRef, className: "ap-ui dsh-wbl-page", "aria-label": titleText, tabIndex: -1, onKeyDown: pageKeys },
					h("header", { className: "dsh-wbl-head" },
						h("div", { className: "dsh-wbl-head-row" },
							h("button", { type: "button", className: "ap-icon-button dsh-card-back", "aria-label": "返回世界书库", title: "返回世界书库", onClick: props.onBack }, h(packUi.Glyph, { name: "back" })),
							h("h2", { className: "dsh-wbl-title", title: titleText }, titleText),
							prefixCacheNotice ? h("span", { className: "dsh-wbl-pill is-warn", role: "status" }, "缓存中断") : null,
							saving || savedOnce ? h("span", { className: "ap-save-state", role: "status" }, saving ? "正在保存…" : "已保存") : null,
							h("div", { className: "dsh-wbl-head-actions" },
								undoStack.length ? h("button", { type: "button", className: "dsh-wbl-chip-btn", disabled: saving, onClick: handleUndo }, "撤销") : null,
								h(ResetButton, { label: "刷新排布", disabled: saving || loading, onClick: function () { fetchLayout(false); } })))),

					error ? h(packUi.HintLine, { text: error, action: "重试", onAction: function () { fetchLayout(false); } }) : null,
					layout && layout.openingSnapshot ? h("div", { className: "dsh-wbl-banner is-info" }, "当前对话使用开局世界书快照：在此调整排序会写回世界书库，但不会改变本局已锁定的开局设定。") : null,
					prefixCacheNotice ? h("div", { className: "dsh-wbl-banner is-warn" },
						h("span", null, "已改动稳定前缀：下一轮请求将触发一次提示词缓存重建，之后恢复长期复用。"),
						h("button", { type: "button", className: "dsh-wbl-banner-close", onClick: function () { setPrefixCacheNotice(false); } }, "知道了")) : null,
					tailCostNotice ? h("div", { className: "dsh-wbl-banner is-info" },
						h("span", null, tailCostNotice),
						h("button", { type: "button", className: "dsh-wbl-banner-close", onClick: function () { setTailCostNotice(""); } }, "知道了")) : null,

					!allItems.length
						? h("div", { className: "dsh-wbl-empty" },
							h("p", null, "当前生效的世界书里没有常驻或固定通道条目。"),
							h("p", { className: "dsh-wbl-empty-sub" }, "将条目设为「常驻」或指定注入通道为「稳定前缀 / 每轮尾部」后，这里会按实际请求顺序实时显示。"))
						: h(React.Fragment, null,
							// 总览堆叠条
							h("div", { className: "dsh-wbl-overview" },
								h("div", { className: "dsh-wbl-kpi-row" },
									h("div", { className: "dsh-wbl-kpi-main" },
										h("strong", { className: "dsh-wbl-kpi-big dsh-wbl-mono" }, wblFmtTokens(summary.totalTokens)),
										h("span", { className: "dsh-wbl-kpi-unit" }, "估算常驻 token · " + summary.totalCount + " 条")),
									h("div", { className: "dsh-wbl-kpi-splits dsh-wbl-mono" },
										h("span", null, "前缀 ", h("b", null, wblFmtTokens(summary.prefixTokens))),
										h("span", null, "尾部 ", h("b", null, "+" + wblFmtTokens(summary.tailTokens)), "/轮"))),
								h("div", { className: "dsh-wbl-ribbon", role: "group", "aria-label": "常驻条目占比总览" },
									prefix.map(renderRibbonSegment),
									prefix.length && tail.length ? h("span", { className: "dsh-wbl-ribbon-sep", "aria-hidden": true }) : null,
									tail.map(renderRibbonSegment)),
								h("div", { className: "dsh-wbl-legend" },
									h("div", { className: "dsh-wbl-legend-books" },
										books.map(function (book) {
											return h("span", { key: book.key, className: "dsh-wbl-legend-item", "data-book-color": book.index % WBL_BOOK_PALETTE_COUNT },
												h("i", { className: "dsh-wbl-color-dot" }),
												book.name,
												book.isGlobal ? " · 全局" : book.isPrimary ? " · 主书" : "");
										})),
									h("span", { className: "dsh-wbl-legend-tip" }, "按住 ⠿ 拖动换位 · 点 👁 速览全文"))),

							// 方案 A · 纵序横条序列
							h("div", { className: "dsh-wbl-sequence" },
								h("div", { className: "dsh-wbl-anchor", "data-cat": "preset" },
									h("i", { className: "dsh-wbl-anchor-dot" }),
									h("span", { className: "dsh-wbl-anchor-name" }, "预设开头"),
									h("span", { className: "dsh-wbl-anchor-line" }),
									h("span", { className: "dsh-wbl-anchor-note" }, "系统提示")),

								h("div", {
									className: "dsh-wbl-zone"
										+ (dragUi && dragUi.activeZone === "prefix" ? " is-drop-active" : "")
										+ (dragUi && dragUi.blockedZone ? " is-drop-blocked" : ""),
									"data-wbl-zone": "prefix"
								},
									h("div", { className: "dsh-wbl-zone-head" },
										h("div", { className: "dsh-wbl-zone-title-wrap" },
											h("span", { className: "dsh-wbl-zone-title" }, "稳定前缀"),
											h("span", { className: "dsh-wbl-zone-sub" }, "长期缓存复用 · 改动后下一轮重建一次")),
										h("span", { className: "dsh-wbl-zone-metric dsh-wbl-mono" }, prefix.length + " 条 · " + wblFmtTokens(summary.prefixTokens))),
									prefix.length
										? h("ul", { className: "dsh-wbl-list", "aria-label": "稳定前缀条目" }, prefix.map(renderEntryRow))
										: h("div", { className: "dsh-wbl-zone-empty" }, "将非动态条目拖到这里，放入稳定前缀缓存")),

								h("div", { className: "dsh-wbl-anchor", "data-cat": "char" },
									h("i", { className: "dsh-wbl-anchor-dot" }),
									h("span", { className: "dsh-wbl-anchor-name" }, layout && layout.cardName ? "人物卡 · " + layout.cardName : "人物卡"),
									h("span", { className: "dsh-wbl-anchor-line" })),

								h("div", { className: "dsh-wbl-anchor", "data-cat": "history" },
									h("i", { className: "dsh-wbl-anchor-dot" }),
									h("span", { className: "dsh-wbl-anchor-name" }, "历史消息"),
									h("span", { className: "dsh-wbl-anchor-line" }),
									h("span", { className: "dsh-wbl-anchor-note" }, "跨过此线即换通道")),

								h("div", {
									className: "dsh-wbl-zone" + (dragUi && dragUi.activeZone === "tail" ? " is-drop-active" : ""),
									"data-wbl-zone": "tail"
								},
									h("div", { className: "dsh-wbl-zone-head" },
										h("div", { className: "dsh-wbl-zone-title-wrap" },
											h("span", { className: "dsh-wbl-zone-title" }, "每轮尾部"),
											h("span", { className: "dsh-wbl-zone-sub" }, "每轮重发 · order 越大预算越优先")),
										h("span", { className: "dsh-wbl-zone-metric dsh-wbl-mono" + (budget.overflowed ? " is-danger" : "") }, "每轮 +" + wblFmtTokens(summary.tailTokens))),
									h("div", { className: "dsh-wbl-budget" },
										h("div", { className: "dsh-wbl-budget-meta" },
											h("span", { className: "dsh-wbl-mono" }, "尾部预算 " + wblFmtTokens(budget.used) + " / " + wblFmtTokens(budget.limit)),
											h("span", { className: budget.overflowed ? "is-danger" : "" },
												evictedCount ? evictedCount + " 条超出预算将被挤出" : "余量 " + wblFmtTokens(Math.max(0, budget.limit - budget.used)))),
										h("div", { className: "dsh-wbl-budget-track" },
											h("div", { className: "dsh-wbl-budget-fill" + (budget.overflowed ? " is-over" : ""), style: { width: budgetPct + "%" } }))),
									tail.length
										? h("ul", { className: "dsh-wbl-list", "aria-label": "每轮尾部条目" }, tail.map(renderEntryRow))
										: h("div", { className: "dsh-wbl-zone-empty" }, "将条目拖到这里，改为每轮贴近最新消息注入")),

								h("div", { className: "dsh-wbl-anchor", "data-cat": "input" },
									h("i", { className: "dsh-wbl-anchor-dot" }),
									h("span", { className: "dsh-wbl-anchor-name" }, "本轮玩家输入"),
									h("span", { className: "dsh-wbl-anchor-line" })))),

					toastText ? h("div", { className: "dsh-wbl-toast", role: "status" }, toastText) : null,
					h(WorldBookLayoutPreviewModal, {
						item: previewItem,
						sessionId: props.sessionId,
						busy: saving,
						onClose: function () { setPreviewId(null); },
						onNudge: nudgeItem,
						onSwitchZone: switchItemZone,
						onOpenBookEntry: props.onOpenBookEntry
					})));
		}
