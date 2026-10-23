        function composerOffsetPx(layoutHeight, visualOffsetTop, rectTop) {
            // DOMRect 和 fixed 的定位都基于布局视口；offsetTop 已包含在 rectTop 中，不能再次相加。
            return Math.max(0, Math.round(Number(layoutHeight) - Number(rectTop)));
        }
        function sheetMaxPx(visualHeight, rectTop, chromePx) {
            const available = Math.round(Number(rectTop) - (Number(chromePx) || 0) - 6);
            const cap = Math.round(Number(visualHeight) * 0.6);
            return Math.max(0, Math.min(cap, available));
        }
        // @include modules/mobile-layout.js
        function nativeFullscreenElement(doc) {
            return doc.fullscreenElement || doc.webkitFullscreenElement || null;
        }
        function requestDocumentFullscreen(doc) {
            const root = doc.documentElement;
            const req = root && (root.requestFullscreen || root.webkitRequestFullscreen);
            if (typeof req !== "function") return Promise.resolve(false);
            function attempt(options) {
                try { return Promise.resolve(options ? req.call(root, options) : req.call(root)); }
                catch (error) { return Promise.reject(error); }
            }
            return attempt({ navigationUI: "hide" }).catch(function () { return attempt(); }).then(function () { return true; }).catch(function () { return false; });
        }
        function exitDocumentFullscreen(doc) {
            const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
            if (typeof exit !== "function" || !nativeFullscreenElement(doc)) return Promise.resolve();
            return Promise.resolve(exit.call(doc)).catch(function () {});
        }
        function installTavernImmersiveMode(button) {
            const header = button?.closest("header");
            if (!header) return { enter() {}, leave() {}, dispose() {} };
            const doc = header.ownerDocument;
            const view = doc.defaultView || (typeof window !== "undefined" ? window : null);
            const htmlClass = doc.documentElement && doc.documentElement.classList;
            let disposed = false, intent = 0;
            function isOn() {
                return !!nativeFullscreenElement(doc) || !!(htmlClass && htmlClass.contains("dsh-tavern-play-fullscreen"));
            }
            function setOn(on) {
                if (htmlClass) htmlClass.toggle("dsh-tavern-play-fullscreen", on);
                header.classList?.toggle("dsh-tavern-immersive-header", on);
            }
            function enter() {
                if (disposed) return;
                const generation = ++intent;
                setOn(true);
                if (button && typeof button.focus === "function") button.focus();
                requestDocumentFullscreen(doc).then(function () {
                    // 浏览器可延迟完成全屏请求；退出或卸载后不能被旧请求重新打开。
                    if (disposed || generation !== intent) {
                        if (nativeFullscreenElement(doc) === doc.documentElement) exitDocumentFullscreen(doc);
                        return;
                    }
                    setOn(true);
                });
            }
            function leave() {
                const generation = ++intent;
                setOn(false);
                if (button && typeof button.focus === "function") button.focus();
                exitDocumentFullscreen(doc).then(function () { if (!disposed && generation === intent) setOn(false); });
            }
            function onFsChange() {
                setOn(!!nativeFullscreenElement(doc));
            }
            function onChromeEvent(event) {
                const action = event && event.detail;
                if (action === "leave" || (action === "toggle" && isOn())) leave();
                else enter();
            }
            if (typeof doc.addEventListener === "function") {
                doc.addEventListener("fullscreenchange", onFsChange);
                doc.addEventListener("webkitfullscreenchange", onFsChange);
            }
            if (view && typeof view.addEventListener === "function") view.addEventListener("dsh-tavern-play-chrome", onChromeEvent);
            return {
                enter: enter,
                leave: leave,
                dispose() {
                    disposed = true;
                    ++intent;
                    setOn(false);
                    if (nativeFullscreenElement(doc) === doc.documentElement) void exitDocumentFullscreen(doc);
                    if (typeof doc.removeEventListener === "function") {
                        doc.removeEventListener("fullscreenchange", onFsChange);
                        doc.removeEventListener("webkitfullscreenchange", onFsChange);
                    }
                    if (view && typeof view.removeEventListener === "function") view.removeEventListener("dsh-tavern-play-chrome", onChromeEvent);
                }
            };
        }
        function FullscreenIcon(props) {
            const on = props.on;
            const d = on
                ? "M2.5 5.5h3v-3 M13.5 5.5h-3v-3 M2.5 10.5h3v3 M13.5 10.5h-3v3"
                : "M2.5 6V2.5H6 M13.5 6V2.5H10 M2.5 10v3.5H6 M13.5 10v3.5H10";
            return React.createElement("svg", {
                width: 15,
                height: 15,
                viewBox: "0 0 16 16",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.75,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "aria-hidden": "true",
                className: "dsh-tavern-icon-fullscreen"
            }, React.createElement("path", { d: d }));
        }
        function TavernImmersiveAction() {
            const button = React.useRef(null), controller = React.useRef(null);
            const [on, setOn] = React.useState(false);
            React.useEffect(() => {
                controller.current = installTavernImmersiveMode(button.current);
                function sync() {
                    const doc = button.current && button.current.ownerDocument;
                    setOn(!!(doc && (nativeFullscreenElement(doc) || (doc.documentElement && doc.documentElement.classList.contains("dsh-tavern-play-fullscreen")))));
                }
                sync();
                const view = typeof window !== "undefined" ? window : null;
                if (view) {
                    view.addEventListener("fullscreenchange", sync);
                    view.addEventListener("webkitfullscreenchange", sync);
                    view.addEventListener("dsh-tavern-play-chrome", sync);
                }
                return () => {
                    if (view) {
                        view.removeEventListener("fullscreenchange", sync);
                        view.removeEventListener("webkitfullscreenchange", sync);
                        view.removeEventListener("dsh-tavern-play-chrome", sync);
                    }
                    controller.current.dispose();
                    controller.current = null;
                };
            }, []);
            return React.createElement("button", {
                ref: button,
                type: "button",
                className: "dsh-tavern-btn dsh-tavern-play-fullscreen" + (on ? " active" : ""),
                "aria-label": on ? "退出全屏" : "全屏",
                "aria-pressed": on,
                title: on ? "退出全屏，显示浏览器顶栏和会话标题" : "进入全屏并折叠顶部状态栏",
                onClick: function () {
                    if (on) controller.current?.leave();
                    else controller.current?.enter();
                    const doc = button.current && button.current.ownerDocument;
                    setOn(!!(doc && (nativeFullscreenElement(doc) || (doc.documentElement && doc.documentElement.classList.contains("dsh-tavern-play-fullscreen")))));
                }
            }, React.createElement(FullscreenIcon, { on: on }));
        }
		// The first click both activates the panel and expands it; the iframe only
		// mounts after React commits that state, so wait briefly for it to appear.
		async function waitForTavernFrame(root, timeout = 3000) {
            const start = Date.now();
            for (;;) {
                const frame = root?.querySelector('iframe:not([aria-hidden="true"])');
                if (frame || !root || Date.now() - start > timeout) return frame || null;
                await new Promise(resolve => requestAnimationFrame(() => resolve()));
            }
        }
		async function expandTavernFrame(root) {
            try {
                const frame = await waitForTavernFrame(root);
                if (!frame) throw new Error("面板尚未加载，请稍后重试。");
                // Fullscreen the page, not the iframe: a fullscreened iframe hides every
                // host control, leaving only Esc to get out. The frame fills the page instead.
                openTavernPageFullscreen(frame);
                const pageRoot = frame.ownerDocument.documentElement;
                try { if (typeof pageRoot.requestFullscreen === "function") await pageRoot.requestFullscreen(); }
                catch (_) { /* Embedded hosts may deny native fullscreen; the page overlay remains. */ }
            } catch (error) { tavernErrorHub.report("展开大屏", error); }
        }

        let closeTavernPageFullscreen = null;
        const TAVERN_FULLSCREEN_BAR = 40;
        function openTavernPageFullscreen(frame) {
            closeTavernPageFullscreen?.();
            const doc = frame.ownerDocument;
            const previousStyle = frame.getAttribute("style");
            const previousPopover = frame.getAttribute("popover");
            const previousFocus = doc.activeElement;
            // Host controls get their own strip above the frame. Floating them over the
            // card would cover whatever the card placed in that spot, and no position is
            // safe for every card.
            const bar = doc.createElement("div");
            bar.style.cssText = "position:fixed;inset:0 0 auto 0;width:100vw;height:" + TAVERN_FULLSCREEN_BAR + "px;margin:0;padding:0 12px;box-sizing:border-box;border:0;display:flex;align-items:center;justify-content:flex-end;background:var(--dsw-alias-bg-base, Canvas);z-index:2147483647;";
            const close = doc.createElement("button");
            close.type = "button";
            close.className = "dsh-tavern-btn";
            close.textContent = "退出大屏";
            close.style.cssText = "margin:0;padding:4px 12px;";
            bar.append(close);
            let observer;
            const restore = () => {
                observer?.disconnect();
                doc.removeEventListener("fullscreenchange", onFullscreenChange);
                if (doc.fullscreenElement === doc.documentElement) doc.exitFullscreen?.().catch(() => {});
                frame.removeAttribute("data-dsh-tavern-expanded");
                if (typeof frame.hidePopover === "function" && frame.matches(":popover-open")) frame.hidePopover();
                if (previousPopover === null) frame.removeAttribute("popover");
                else frame.setAttribute("popover", previousPopover);
                if (previousStyle === null) frame.removeAttribute("style");
                else frame.setAttribute("style", previousStyle);
                bar.remove();
                doc.removeEventListener("keydown", onKey);
                if (closeTavernPageFullscreen === restore) closeTavernPageFullscreen = null;
                if (previousFocus?.isConnected) previousFocus.focus();
            };
            const onKey = event => { if (event.key === "Escape") { event.preventDefault(); restore(); } };
            // Esc during native fullscreen is consumed by the browser; leave the overlay with it.
            let wasFullscreen = false;
            const onFullscreenChange = () => {
                if (doc.fullscreenElement) wasFullscreen = true;
                else if (wasFullscreen) restore();
            };
            doc.addEventListener("fullscreenchange", onFullscreenChange);
            closeTavernPageFullscreen = restore;
            close.addEventListener("click", restore);
            doc.addEventListener("keydown", onKey);
            try {
                // Keep the live iframe in place: reparenting would reload card scripts.
                frame.setAttribute("data-dsh-tavern-expanded", "");
                frame.style.cssText += ";position:fixed!important;inset:" + TAVERN_FULLSCREEN_BAR + "px 0 auto 0!important;width:100vw!important;height:calc(100dvh - " + TAVERN_FULLSCREEN_BAR + "px)!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;box-sizing:border-box!important;border:0!important;z-index:2147483646!important;background:var(--dsw-alias-bg-base, Canvas)!important;";
                if (typeof frame.showPopover === "function") {
                    frame.setAttribute("popover", "manual");
                    frame.showPopover();
                    bar.setAttribute("popover", "manual");
                }
                doc.body.append(bar);
                if (bar.hasAttribute("popover")) bar.showPopover();
                close.focus();
                observer = new doc.defaultView.MutationObserver(() => {
                    if (!frame.isConnected || frame.getAttribute("aria-hidden") === "true") restore();
                });
                observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
            } catch (error) { restore(); throw error; }
        }

		function TavernMessageFrame(props) {
            if (props.sessionId && window.document?.body && typeof window.document.body.moveBefore === "function") {
                return React.createElement(TavernRetainedMessageFrame, props);
            }
			const homeRef = React.useRef(null);
			const panelKey = React.useRef(null);
			if (!panelKey.current) panelKey.current = "manual-" + Math.random().toString(36).slice(2);
			const panels = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
			const movable = Boolean(props.sessionId && !props.persistent && /<(?:script|iframe|object|embed)\b/i.test(String(props.content || "")));
			const pinned = panels.some(function (entry) { return entry.id === panelKey.current && entry.pinned; });
			const slotRef = React.useRef(null);
			const lifecycleRef = React.useRef(null);
			const frameProps = Object.assign({}, props, { panelId: props.panelId || "message-" + props.turn + "-" + props.partIndex,
				placement: props.persistent || pinned ? "sidebar" : "message" });
			if (!lifecycleRef.current) lifecycleRef.current = createTavernMessageFrameLifecycle(frameProps);
			const lifecycle = lifecycleRef.current;
			const [state, setState] = React.useState(lifecycle.snapshot);
			const visibleDocument = state.visibleDocument;
			const pendingDocument = state.pendingDocument;
			const height = state.height;
			const [activated, setActivated] = React.useState(props.eager === true);
			React.useEffect(function () { return lifecycle.start(setState); }, [lifecycle]);
			React.useEffect(function () { lifecycle.update(frameProps); });
			React.useEffect(function () {
				if (props.eager === true) { setActivated(true); return; }
				if (activated) return;
				let observer = null, cancelActivation = null;
				function enqueue() {
					if (cancelActivation) return;
					cancelActivation = enqueueTavernFrameActivation(function () {
						cancelActivation = null;
						setActivated(true);
						if (observer) observer.disconnect();
					});
				}
				const timer = window.setTimeout(function () {
					if (!slotRef.current) return;
					if (typeof window.IntersectionObserver !== "function") { enqueue(); return; }
					observer = new window.IntersectionObserver(function (entries) {
						if (entries[entries.length - 1]?.isIntersecting) enqueue();
						else if (cancelActivation) { cancelActivation(); cancelActivation = null; }
					}, { rootMargin: "240px 0px" });
					observer.observe(slotRef.current);
				}, 120);
				return function () { window.clearTimeout(timer); if (observer) observer.disconnect(); if (cancelActivation) cancelActivation(); };
			}, [activated, props.eager, props.sessionId]);
			function renderFrame(document, hidden) {
				if (!document) return null;
				const pendingHeight = document.height || height;
				return React.createElement("iframe", {
					key: document.token,
					ref: document.ref,
					className: "dsh-tavern-message-frame",
					title: hidden ? "正在准备人物卡消息界面" : "人物卡消息界面",
					"aria-hidden": hidden || undefined,
					sandbox: document.trustedCardMode ? undefined : "allow-scripts",
					referrerPolicy: "no-referrer",
					loading: "lazy",
					srcDoc: document.html,
					style: hidden
						? { position: "absolute", left: 0, top: 0, width: "100%", height: pendingHeight + "px", opacity: 0, pointerEvents: "none" }
						: { height: height + "px", overflow: height >= TAVERN_FRAME_MAX_HEIGHT ? "auto" : "hidden" }
				});
			}
			React.useLayoutEffect(function () {
				if (!movable || !slotRef.current || !homeRef.current) return;
				return tavernPanelRegistry.register({ id: panelKey.current, sessionId: props.sessionId,
					title: "第 " + props.turn + " 轮 · 面板 " + (Number(props.partIndex) + 1),
					node: slotRef.current, home: homeRef.current, pinned: false });
			}, [movable, props.sessionId, props.content]);
			React.useLayoutEffect(function () {
				// Story frames follow the reading font size; status panels keep their layout.
				if (props.persistent || !slotRef.current) return;
				return bindTavernFontZoom(slotRef.current, window);
			}, [props.persistent]);
			const frames = activated ? [renderFrame(visibleDocument, false), renderFrame(pendingDocument, true)] : null;
			return React.createElement("div", null,
				movable && !pinned ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: function () {
					try { setActivated(true); tavernPanelRegistry.pin(panelKey.current, true); }
					catch (error) { tavernErrorHub.report("固定面板", error); }
				} }, "固定到右侧") : null,
                visibleDocument.sizing ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: () => { setActivated(true); return expandTavernFrame(slotRef.current); } }, "展开大屏") : null,
				React.createElement("div", { ref: homeRef },
					React.createElement("div", { ref: slotRef, className: "dsh-tavern-message-frame-slot", style: { position: "relative", height: height + "px" } }, frames)));

		}

		function tavernProjectionForTurn(view, turn) {
			if (!view || !isPlayMode(view.mode) || !Array.isArray(view.replyProjections)) return null;
			const lookup = createSessionViewReader.projectionLookup;
			if (lookup?.has(view.replyProjections)) {
				const projection = lookup.row(view.replyProjections,turn);
				return projection && (Number(projection.version)===1 || Number(projection.version)===2) ? projection : null;
			}
			for (let index = view.replyProjections.length - 1; index >= 0; index -= 1) {
				const projection = view.replyProjections[index];
				if (Number(projection && projection.turn) === Number(turn)) return Number(projection.version) === 1 || Number(projection.version) === 2 ? projection : null;
			}
			return null;
		}

		function tavernLatestProjectionTurn(view) {
			const rows = view?.replyProjections;
			if (!Array.isArray(rows)) return 0;
			const lookup = createSessionViewReader.projectionLookup;
			return lookup?.has(rows) ? lookup.max(rows) : rows.reduce((latest,item)=>Math.max(latest,Number(item && item.turn)||0),0);
		}

		function tavernStoryTurnForDshTurn(view, turn) {
			const mappings = view && view.regeneratedDshTurns && typeof view.regeneratedDshTurns === "object" ? view.regeneratedDshTurns : {};
			const lookup = createSessionViewReader.storyTurnLookup;
			if (lookup?.has(mappings)) return lookup.read(mappings,turn);
			for (const storyTurn of Object.keys(mappings)) {
				if (Number(mappings[storyTurn]) === Number(turn)) return Number(storyTurn);
			}
			return Number(turn);
		}

		function tavernMvuReceiptForTurn(view, turn) {
			const receipts = view && Array.isArray(view.mvuReceipts) ? view.mvuReceipts : [];
			const ordered = createSessionViewReader.receiptOrderedIndex;
			if (ordered?.info(receipts)) return Number.isNaN(Number(turn)) ? null : ordered.get(receipts,Number(turn))?.receipt || null;
			const lookup = createSessionViewReader.receiptLookup;
			if (lookup?.has(receipts)) return lookup.read(receipts, turn);
			for (let index = receipts.length - 1; index >= 0; index -= 1) {
				if (Number(receipts[index] && receipts[index].turn) === Number(turn)) return receipts[index].receipt || null;
			}
			return null;
		}

		function TavernMvuReceipt(props) {
			const h = React.createElement;
			const [retrying, setRetrying] = React.useState(false);
			const receipt = props.receipt || {};
			const changes = Array.isArray(receipt.changes) ? receipt.changes : [];
			// MVU display/delta mirrors and schema maintenance stay in receipts for diagnostics,
			// but are not extra gameplay changes worth showing to players.
			const sideEffects = (Array.isArray(receipt.sideEffects) ? receipt.sideEffects : []).filter(function (change) {
				return !/^\/(?:delta_data|display_data|schema)(?:\/|$)/.test(String(change && change.path || ""));
			});
			const failures = Array.isArray(receipt.failures) ? receipt.failures : [];
			const status = ["pending", "updated", "partial", "error", "stale", "interrupted", "unchanged"].includes(receipt.status) ? receipt.status : "unchanged";
			const sideEffectSuffix = sideEffects.length > 0 ? " · 人物卡联动 " + sideEffects.length + " 项" : "";
			const labels = {
				pending: props.busy ? "变量结算中…" : "变量结算等待中",
				interrupted: "变量结算已中断",
				updated: (changes.length > 0 ? "变量已更新 · " + changes.length + " 项" : "变量已更新 · 旧记录无明细") + sideEffectSuffix,
				partial: "变量部分更新 · " + changes.length + " 项成功 · " + failures.length + " 项失败" + sideEffectSuffix,
				error: "变量更新失败 · " + failures.length + " 项" + sideEffectSuffix,
				stale: "变量结算已过期，未覆盖当前状态",
				unchanged: (sideEffects.length > 0 ? "Agent 未更新变量" : "本轮变量未更新") + sideEffectSuffix
			};
			const operationLabels = { set: "设置", replace: "设置", add: "新增", delta: "增减", insert: "新增", delete: "删除", remove: "删除", move: "移动" };
			const summary = h("div", { className: "dsh-tavern-mvu-receipt-summary" }, h("span", { className: "dsh-tavern-mvu-receipt-dot" }), h("span", null, labels[status]));
			async function retry() {
				if (retrying) return;
				setRetrying(true);
				try {
					if (status === "pending") {
						await rpc("retrySettlement", { turn: props.turn }, props.sessionId);
						liveTavernView.invalidate(props.sessionId);
						return;
					}
					await askTavernText({
						title: "重新结算变量", description: "指导意见（选填），仅对本次结算生效。正文保持不变。",
						placeholder: "例如：这轮还没有交付物品，不要扣除库存。",
						allowEmpty: true, maxLength: 4000, confirmLabel: "重新结算",
						onSubmit: guidance => rpc("retrySettlement", { turn: props.turn, guidance }, props.sessionId)
					});
					liveTavernView.invalidate(props.sessionId);
				} catch (error) { tavernErrorHub.report("重试变量结算", error); }
				finally { setRetrying(false); }
			}
			const retryButton = props.latest
				? h("button", { type: "button", className: "dsh-tavern-mvu-retry", disabled: retrying || props.busy, onClick: retry }, props.busy ? "结算中…" : retrying ? "重试中…" : status === "pending" ? "重新投递结算" : ["error", "stale", "interrupted", "partial"].includes(status) ? "重试变量结算" : "重新结算变量")
				: null;
			const hasDetails = String(receipt.summary || "") !== "" || changes.length > 0 || sideEffects.length > 0 || failures.length > 0 || retryButton;
			if (!hasDetails) return h("div", { className: "dsh-tavern-mvu-receipt", "data-status": status }, summary);
			return h("details", { className: "dsh-tavern-mvu-receipt", "data-status": status },
				h("summary", { className: "dsh-tavern-mvu-receipt-summary" }, h("span", { className: "dsh-tavern-mvu-receipt-dot" }), h("span", null, labels[status])),
				h("div", { className: "dsh-tavern-mvu-receipt-body" },
					receipt.summary ? h("div", { className: "dsh-tavern-mvu-receipt-reason" }, "原因：" + String(receipt.summary)) : null,
					changes.map(function (change, index) { return h("div", { key: "change:" + index, className: "dsh-tavern-mvu-change" },
						h("div", { className: "dsh-tavern-mvu-change-path" }, (operationLabels[change.operation] || "更新") + " " + String(change.path || "/")),
						h("div", { className: "dsh-tavern-mvu-change-values" }, String(change.before) + " → " + String(change.after))
					); }),
					sideEffects.length > 0 ? h("div", { className: "dsh-tavern-mvu-side-effect-title" }, "人物卡脚本联动") : null,
					sideEffects.map(function (change, index) { return h("div", { key: "side-effect:" + index, className: "dsh-tavern-mvu-change", "data-origin": "card-script" },
						h("div", { className: "dsh-tavern-mvu-change-path" }, (operationLabels[change.operation] || "更新") + " " + String(change.path || "/")),
						h("div", { className: "dsh-tavern-mvu-change-values" }, String(change.before) + " → " + String(change.after))
					); }),
					failures.map(function (failure, index) {
						const operation = operationLabels[failure.operation] || String(failure.operation || "操作");
						const path = String(failure.path || failure.command || "/");
						return h("div", { key: "failure:" + index, className: "dsh-tavern-mvu-failure" }, "失败：" + operation + " " + path + "：" + String(failure.message || "未知错误"));
					}),
					(status === "error" || status === "partial") && Array.isArray(receipt.runtimeDiagnostics) ? receipt.runtimeDiagnostics.filter(function (item) { return item && item.message && ["warn", "error"].includes(item.level); }).slice(-3).map(function (item, index) { return h("div", { key: "runtime:" + index, className: "dsh-tavern-mvu-failure" }, "运行时：" + String(item.message)); }) : null,
					retryButton
				)
			);
		}

		function htmlPartHasPresentation(value) {
			const source = String(value || "").trim();
			if (!source) return false;
			if (/<(?:script|style|link|iframe|object|embed|img|picture|video|audio|canvas|svg|br|hr|input|button|select|textarea|progress|meter)\b/i.test(source)) return true;
			const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
			if (withoutComments.replace(/<[^>]*>/g, "").trim() !== "") return true;
			const openingTags = withoutComments.match(/<[a-z][\w:-]*(?:\s[^<>]*?)?\/?\s*>/gi) || [];
			return openingTags.some(function (tag) {
				return /^<[a-z][\w:-]*\s+[^>]*>/i.test(tag) && !/^<[a-z][\w:-]*\s*\/?>$/i.test(tag);
			});
		}

		function projectionPartsOf(projection) {
			if (!projection) return [];
			if (Array.isArray(projection.parts)) return projection.parts.filter(function (part) {
				if (!part || (part.kind !== "markdown" && part.kind !== "html")) return false;
				if (part.kind === "html") return htmlPartHasPresentation(part.content !== undefined ? part.content : part.html || "");
				return String(part.text || "").trim() !== "";
			});
			if (projection.mode === "html" || projection.mode === "rich") {
				const content = String(projection.html || projection.text || "");
				return htmlPartHasPresentation(content) ? [{ kind: "html", content: content }] : [];
			}
			return [{ kind: "markdown", text: String(projection.text || "") }];
		}

        // @include inline-fragment.js
        // @include html-sketch.js

		function renderTavernProjection(projection, options) {
			const h = React.createElement;
			const parts = projectionPartsOf(projection);
			if (options.openingPreview && options.openingPreview.runtime) {
				const content = '<div id="chat"><div class="mes" mesid="0" is_user="false"><div class="mes_text">' + (options.openingPreview.messageHtml !== undefined ? options.openingPreview.messageHtml : parts.map(function (part) {
					if (part.kind === "html") return String(part.content !== undefined ? part.content : part.html || "");
					return '<div class="dsh-tavern-plain-text">' + String(part.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</div>';
				}).join("\n")) + '</div></div></div>';
				return h(TavernMessageFrame, Object.assign({}, options, { key: "opening-runtime", content: content, partIndex: 0, eager: options.eagerFrame }));
			}
			const renderPlain = function (text, key) { return h(TavernColoredMarkdown, { key: key, text: text, streaming: options.streaming, labels: { code: options.codeLabels, footnotes: "脚注" }, codeLabels: options.codeLabels, fileMentions: options.mentions }); };
			const renderMarkdown = options.cast && !options.streaming ? function (text, key) { return renderTavernCastText(text, key, renderPlain, options.cast); } : renderPlain;
			return parts.map(function (part, index) {
				if (part.kind === "markdown") {
					const markdown = options.plugin ? options.plugin.render(String(part.text || ""), index, renderMarkdown) : renderMarkdown(String(part.text || ""), index);
					return options.scriptLayer && !options.streaming ? h(TavernScriptLayerPart, { key: index, layer: options.scriptLayer, partIndex: index, text: String(part.text || "") }, markdown) : markdown;
				}
				// Rounds past the render depth keep their prose; the card's HTML waits for one click.
				if (typeof options.deferHtml === "function") {
					if (parts.findIndex(function (item) { return item.kind === "html"; }) !== index) return null;
					return h("button", { key: index, type: "button", className: "dsh-tavern-btn dsh-tavern-render-round", title: "只有最近 3 轮渲染卡片界面，更早的轮次只显示文字；点击后渲染本轮", onClick: options.deferHtml }, "渲染此轮");
				}
				// Plugin markers inside card HTML cannot be split out; show them after that part.
				const pluginHtml = options.plugin && !options.openingPreview ? options.plugin.renderHtmlMarkers(String(part.content !== undefined ? part.content : part.html || "")) : null;
				const content = pluginHtml ? pluginHtml.html : String(part.content !== undefined ? part.content : part.html || "");
				if (pluginHtml && pluginHtml.after) return h(React.Fragment, { key: index }, renderTavernProjection({ parts: [Object.assign({}, part, { content: content, html: undefined })] }, Object.assign({}, options, { plugin: null })), pluginHtml.after);
                if (options.trustedCardMode === true && !options.openingPreview && parseTavernInlineFragment(content, window.document)) {
                    return h(TavernInlineFragment, {key:index, content:content});
                }
				return h(TavernMessageFrame, { key: index, content: content, sessionId: options.sessionId, turn: options.turn, partIndex: index, frameOwner: options.frameOwner, frameSizing: options.frameSizing, helperContext: options.helperContext, helperContextReader: options.helperContextReader, openingPreview: options.openingPreview, onSelectOpening: options.onSelectOpening, onSubmitOpening: options.onSubmitOpening, trustedCardMode: options.trustedCardMode, eager: options.eagerFrame, executeSlash: options.executeSlash });
			});
		}

		function TavernScriptLayerPart(props) {
			const native = React.useRef(null), layer = React.useRef(null);
			React.useLayoutEffect(function () {
				const unmount = mountTavernScriptLayer({ native: native.current, layer: layer.current, sessionId: props.layer.sessionId, messageId: props.layer.messageId });
				// Once a card script takes the layer over, the native prose (and its quote colors) is hidden;
				// the layer is a copy of plain DOM and needs its own (#305). A hidden layer yields no ranges.
				const colors = installTavernTextColors(layer.current, {}, findTavernQuoteRanges);
				return function () { colors.dispose(); unmount(); };
			}, [props.layer.sessionId, props.layer.messageId, props.partIndex, props.text]);
			// Visibility is toggled by the layer itself; React never sets `hidden` here.
			return React.createElement("div", { className: "dsh-tavern-script-part" },
				React.createElement("div", { ref: native }, props.children),
				React.createElement("div", { ref: layer, className: "mes_text dsh-tavern-script-layer", "data-dsh-script-layer": "", "data-session": props.layer.sessionId, "data-mesid": String(props.layer.messageId) }));
		}

		// Third-party plugins: use the public tavernUi API (docs/plugin-api.md), never patch this file; its structure changes freely.
		function renderTavernAssistantBlocks(input) {
			const h = React.createElement;
			// The answer step is drawn twice by DSH: its thinking in the process panel ("reasoning"),
			// the reply below it ("response"). Each seat shows only its own blocks, as DSH's own view does.
			const blocks = (Array.isArray(input.blocks) ? input.blocks : []).filter(function (block) {
				return !block || input.groupPart !== "response" || block.kind !== "reasoning";
			});
			const translate = typeof input.t === "function" ? input.t : function (key, values) {
				if (key === "copy") return "复制";
				if (key === "copied") return "已复制";
				if (key === "message.stopped") return "已停止";
				if (key === "message.unknownBlock") return "未知消息块";
				if (key === "json.truncated") return "内容过长（共 " + String(values && values.total || 0) + " 项）";
				return key;
			};
			const codeLabels = { copyLabel: translate("copy"), copiedLabel: translate("copied") };
			const rendered = [];
			let projected = false;
			for (let index = 0; index < blocks.length; index += 1) {
				const block = blocks[index];
				if (!block) continue;
				if (block.kind === "text") {
					if (input.projection && projected) continue;
					const projection = input.projection;
					if (projection) rendered.push(h(React.Fragment, { key: index }, renderTavernProjection(projection, { streaming: input.streaming, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, frameSizing: input.frameSizing, helperContext: input.helperContext, helperContextReader: input.helperContextReader, trustedCardMode: input.trustedCardMode, eagerFrame: input.eagerFrame, frameOwner: input.frameOwner, executeSlash: input.executeSlash, scriptLayer: input.scriptLayer , plugin: input.plugin, cast: input.cast, deferHtml: input.deferHtml })));
					else if (input.htmlSketches) rendered.push(h(React.Fragment, { key: index }, splitTavernHtmlSketches(block.text).map(function (part, partIndex) {
						return part.kind === "sketch" ? h(TavernHtmlSketch, { key: partIndex, html: part.html }) : h(TavernColoredMarkdown, { key: partIndex, text: part.text, streaming: input.streaming, labels: { code: codeLabels, footnotes: "脚注" }, codeLabels: codeLabels, fileMentions: input.mentions });
					})));
					else {
						const renderPlain = function (text, key) { return h(TavernColoredMarkdown, { key: key, text: text, streaming: input.streaming, labels: { code: codeLabels, footnotes: "脚注" }, codeLabels: codeLabels, fileMentions: input.mentions }); };
						const renderMarkdown = input.cast && !input.streaming ? function (text, key) { return renderTavernCastText(text, key, renderPlain, input.cast); } : renderPlain;
						rendered.push(input.plugin ? input.plugin.render(String(block.text || ""), index, renderMarkdown) : renderMarkdown(String(block.text || ""), index));
					}
					projected = true;
					continue;
				}
				if (block.kind === "reasoning") {
					rendered.push(h("details", { key: index, className: "dsh-tavern-assistant-reasoning", open: input.streaming && index === blocks.length - 1 }, h("summary", null, input.streaming && index === blocks.length - 1 ? "思考中…" : "思考过程"), h("pre", null, String(block.text || ""))));
					continue;
				}
				if (block.kind === "image") {
					const start = index;
					const group = [block];
					while (index + 1 < blocks.length && blocks[index + 1] && blocks[index + 1].kind === "image") { group.push(blocks[index + 1]); index += 1; }
					const images = group.map(function (item) { return { attachment: item.attachment }; });
					const imageNodes = typeof input.renderMessageImages === "function"
						? input.renderMessageImages({ images: images, align: "start" })
						: renderTavernMessageImages(input, images, "start");
					if (imageNodes) rendered.push(h(React.Fragment, { key: start }, imageNodes));
					continue;
				}
				if (block.kind !== "tool-call") rendered.push(h(DshUi.JsonBlock, { key: index, label: translate("message.unknownBlock"), payload: block.block || block, truncatedLabel: function (total) { return translate("json.truncated", { total: total }); } }));
			}
			if (input.projection && !projected) {
				rendered.push(h(React.Fragment, { key: "projection" }, renderTavernProjection(input.projection, { streaming: false, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, frameSizing: input.frameSizing, helperContext: input.helperContext, helperContextReader: input.helperContextReader, trustedCardMode: input.trustedCardMode, eagerFrame: input.eagerFrame, frameOwner: input.frameOwner, executeSlash: input.executeSlash , plugin: input.plugin, cast: input.cast, deferHtml: input.deferHtml })));
			}
			if (input.interrupted) rendered.push(h("span", { key: "stopped", className: "dsh-tavern-assistant-stopped" }, translate("message.stopped")));
			return rendered;
		}

		// Message pictures go through the host Content Factory; older builds also
		// exposed a dedicated renderMessageImages seat. Never crash on either.
		function renderTavernMessageImages(props, images, align) {
			if (!Array.isArray(images) || images.length === 0) return null;
			const input = props || {};
			if (typeof input.renderMessageImages === "function") return input.renderMessageImages({ images: images, align: align });
			if (typeof input.renderFactorySlot === "function") return input.renderFactorySlot("conversation.images.content", { images: images, loadImage: input.loadImage, align: align });
			return null;
		}

		function userContentParts(content) {
			const texts = [];
			const images = [];
			const rest = [];
			for (const block of Array.isArray(content) ? content : []) {
				if (block && block.type === "text" && typeof block.text === "string") texts.push(block.text);
				else if (block && block.type === "image" && block.attachment !== undefined) images.push({ attachment: block.attachment });
				else if (block) rest.push(block);
			}
			return { text: texts.join(""), images: images, rest: rest };
		}

		function tavernUserTextForTurn(view, turn, content) {
			const fallback = userContentParts(content).text;
			const sources = view && view.inputSources;
			const key = String(Number(turn) || 0);
			if (!sources || !Object.prototype.hasOwnProperty.call(sources, key)) return fallback;
			return String(sources[key] === undefined || sources[key] === null ? "" : sources[key]);
		}
