		function createMvuBundleLoader(options) {
			const delays = options.retryDelays || [1000, 2000];
			let disposed = false, pending = null, resume = null, cancel = null;
			const loadId = "mvu-load-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
			let cycle = 0, attemptNumber = 0, diagnosticCount = 0;
			function observe(phase, extra) {
				try {
					if (!options.onDiagnostic || diagnosticCount++ >= 64) return;
					const result = options.onDiagnostic(Object.assign({ loadId: loadId, phase: phase, cycle: cycle, attempt: attemptNumber, at: Date.now() }, extra));
					if (result && typeof result.catch === "function") result.catch(function () {});
				} catch (_) {} // Observers must never alter loading, retries or the original error.
			}
			function responseDetails(response) {
				const details = {};
				try {
					if (Number.isFinite(response.status)) details.httpStatus = response.status;
					details.redirected = response.redirected === true;
					if (response.url) details.responsePath = new URL(response.url).pathname;
					if (response.headers) {
						details.contentType = String(response.headers.get("content-type") || "").slice(0, 120);
						const length = response.headers.get("content-length");
						if (length !== null && /^\d+$/.test(length)) details.contentLength = Number(length);
					}
				} catch (_) {}
				return details;
			}
			function bodyDetails(source) {
				const details = { receivedChars: source.length, bodyKind: source.length > 16384 ? "not-inspected-large" : "unclassified" };
				try {
					// Only inspect bounded error envelopes; never log source, body previews or JSON extras.
					if (source.length <= 16384) {
						if (source.trim() === "forbidden") details.bodyKind = "forbidden";
						else {
							const value = JSON.parse(source);
							details.bodyKind = "json";
							if (value && value.ok === false) {
								details.bodyKind = "json-error";
								if (typeof value.error === "string") details.serverError = value.error.slice(0, 2000);
							}
						}
					}
				} catch (_) {}
				return details;
			}
			async function readErrorBody(response) {
				const limit = 16384;
				if (!response.body || typeof response.body.getReader !== "function") {
					const text = typeof response.text === "function" ? await response.text() : "";
					return text.length <= limit ? text : "";
				}
				const reader = response.body.getReader(), decoder = new TextDecoder();
				let text = "", bytes = 0;
				try {
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) return text + decoder.decode();
						bytes += chunk.value.byteLength;
						if (bytes > limit) return "";
						text += decoder.decode(chunk.value, { stream: true });
					}
				} finally { try { Promise.resolve(reader.cancel()).catch(function () {}); reader.releaseLock(); } catch (_) {} }
			}
			function check() { if (disposed) throw new Error("MVU loader disposed"); }
			function state(value) { if (!disposed && options.onState) options.onState(value); }
			function wait(delay) {
				return new Promise(function (resolve, reject) {
					let timer;
					function finish(error) { clearTimeout(timer); cancel = null; resume = null; if (error) reject(error); else resolve(); }
					cancel = function () { finish(new Error("MVU loader disposed")); };
					if (delay === null) resume = function () { finish(); };
					else timer = setTimeout(finish, delay);
				});
			}
			async function download(url) {
				const controller = new AbortController();
				const startedAt = Date.now();
				let details = {};
				let failureStep = "fetch";
				let timer;
				try {
					observe("download-started");
					return await Promise.race([
						Promise.resolve().then(async function () {
							check();
							const response = await options.fetch(url, { signal: controller.signal, cache: "no-store" });
							details = responseDetails(response);
							failureStep = "http-status";
							if (!disposed && !controller.signal.aborted) observe("download-response", details);
							failureStep = "response-body";
							const isJavaScript = /^(?:application|text)\/(?:x-)?(?:java|ecma)script(?:\s*;|$)/i.test(details.contentType || "");
							const source = response.ok && isJavaScript ? await response.text() : await readErrorBody(response);
							const body = bodyDetails(source);
							if (!disposed && !controller.signal.aborted) observe("download-completed", Object.assign({}, details, body, { durationMs: Date.now() - startedAt }));
							failureStep = "response-validation";
							if (!response.ok || !isJavaScript || body.bodyKind === "json-error" || body.bodyKind === "json" || body.bodyKind === "forbidden" || /^\s*<(?:!doctype\s+html|html)\b/i.test(source)) {
								const reason = body.serverError || (body.bodyKind === "forbidden" ? "访问被拒绝（forbidden）" : !response.ok ? "HTTP " + response.status : "响应不是 MVU JavaScript（Content-Type: " + (details.contentType || "未提供") + "）");
								throw new Error("MVU 下载失败：" + reason);
							}
							return source;
						}),
						new Promise(function (_resolve, reject) {
							cancel = function () { controller.abort(); reject(new Error("MVU loader disposed")); };
							timer = setTimeout(function () { controller.abort(); reject(new Error("MVU 下载超时")); }, options.timeoutMs || 10000);
						})
					]);
				} catch (error) {
					observe(disposed ? "disposed" : "download-failed", Object.assign({}, details, { failureStep: failureStep, durationMs: Date.now() - startedAt, errorName: String(error.name || ""), message: String(error.message || error).slice(0, 2000) }));
					throw error;
				} finally { clearTimeout(timer); cancel = null; }
			}
			async function run(url) {
				while (true) {
					cycle++;
					for (let attempt = 0; attempt <= delays.length; attempt++) {
						attemptNumber = attempt + 1;
						check();
						state({ phase: "loading", attempt: attempt + 1, canRetry: false });
						let source;
						try { source = await download(url); }
						catch (error) {
							check();
							if (attempt < delays.length) { observe("retry-scheduled", { delayMs: delays[attempt] }); await wait(delays[attempt]); continue; }
							const waiting = wait(null);
							observe("retry-exhausted");
							state({ phase: "failed", attempt: attempt + 1, canRetry: true, error: String(error.message || error).slice(0, 4000) });
							await waiting;
							break;
						}
						check();
						state({ phase: "evaluating", canRetry: false });
						// Never catch evaluation errors in the download retry loop.
						const startedAt = Date.now();
						observe("execution-started");
						try {
							const result = await options.evaluate(source);
							observe("execution-completed", { durationMs: Date.now() - startedAt });
							return result;
						} catch (error) {
							observe("execution-failed", { durationMs: Date.now() - startedAt, errorName: String(error.name || ""), message: String(error.message || error).slice(0, 2000) });
							throw error;
						}
					}
				}
			}
			return Object.freeze({
				load: function (url) { if (!pending) pending = run(url); return pending; },
				retry: function () { if (disposed || !resume) return false; observe("manual-retry"); resume(); return true; },
				dispose: function () { disposed = true; if (cancel) cancel(); }
			});
		}

		function createTavernPreviewWindow(host) {
			// Give card-owned modules a local host without replacing the real RPC parent.
			let scope;
			const methods = new Map();
			scope = new Proxy(host, { get(target, key) {
				if (["parent", "top", "window", "self", "globalThis"].includes(key)) return scope;
				const value = Reflect.get(target, key, target);
				if (["addEventListener", "removeEventListener", "dispatchEvent", "postMessage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "fetch"].includes(key) && typeof value === "function") {
					if (!methods.has(key)) methods.set(key, value.bind(target));
					return methods.get(key);
				}
				return value;
			}, set(target, key, value) { return Reflect.set(target, key, value, target); } });
			return scope;
		}

		function loadTavernHelperModule(source, scriptId, previewScope, beforeMount) {
            // Saved card snapshots can retain the previous projected asset URL.
            // Change only the projection version, not the pinned source hash.
            source = String(source).replace(/(\/api\/dsh-tavern\/remote-assets\/[^\s"'`<>?]+)\?host=1\b/g, "$1?host=2");
			// Card pages may declare a lexical `$` that shadows window.jQuery.
			// Bind the managed MVU module to its runtime dependency, not page globals.
			if (scriptId === "__dsh_official_mvu__") source = "const $ = window.jQuery;\n" + source;
			if (previewScope && scriptId !== "__dsh_official_mvu__") source = "const window = (" + createTavernPreviewWindow.toString() + ")(globalThis); const parent = window, top = window, self = window;\n" + source;
            if (!previewScope && scriptId !== "__dsh_official_mvu__" && window.__dshTavernComposerWindow) source = "const window = globalThis.__dshTavernComposerWindow; const parent = window.parent, top = window.top, self = window;\n" + source;
			const sourceUrl = "dsh-tavern-script:" + encodeURIComponent(String(scriptId || "module"));
			const startedAt = window.performance && window.performance.now ? window.performance.now() : 0;
			function loadFailure(event) {
				function safeUrl(value) {
					try { const url = new URL(value, document.baseURI); if (!/^https?:$/.test(url.protocol)) return ""; return (url.origin + url.pathname).slice(0, 500); } catch (_) { return ""; }
				}
				function safeMessage(value) {
					return String(value || "").replace(/https?:\/\/[^\s"'<>]+/gi, safeUrl).replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, "[REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/((?:api[-_]?key|access[-_]?token|password|secret|authorization)["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi, "$1[REDACTED]").slice(0, 1000);
				}
				const references = Array.from(new Set((String(source).match(/(?:https?:\/\/|\/api\/dsh-tavern\/)[^\s"'<>`]+/g) || []).map(safeUrl).filter(Boolean))).slice(0, 8);
				let resources = [];
				try { resources = window.performance.getEntriesByType("resource").filter(function (entry) { return entry.startTime >= startedAt && entry.initiatorType === "script" && entry.responseStatus >= 400 && entry.responseStatus <= 599; }).slice(-8).map(function (entry) { return { url: safeUrl(entry.name), status: entry.responseStatus }; }).filter(function (entry) { return entry.url; }); } catch (_) {}
				const offline = window.navigator && window.navigator.onLine === false;
				const httpFailure = resources.some(function (entry) { return references.includes(entry.url); });
				const reason = offline ? "offline" : httpFailure ? "http" : "unknown";
				const message = offline ? "浏览器当前离线，人物卡脚本依赖加载失败。请检查网络后刷新页面重试。" : httpFailure ? "人物卡脚本依赖请求失败。请查看详情中的 HTTP 状态；资源恢复后刷新页面重试。" : "人物卡模块或依赖加载失败，暂不能确定原因。请查看详情；可检查网络，若持续失败请导出诊断包。";
				const error = new Error(message + " 该脚本功能可能不可用，变量脚本失败会影响初始化或校验。");
				error.dshTavernModuleFailure = { phase: "module-load", reason: reason, message: safeMessage(event && event.message), references: references, resources: resources };
				return error;
			}
			return new Promise(function (resolve, reject) {
				const element = document.createElement("script");
				const completionKey = "__dshTavernModuleComplete_" + Math.random().toString(36).slice(2);
				let settled = false;
				let cancelMount = function () {};
				function finish(error) {
					if (settled) return;
					settled = true;
					cancelMount();
					window.removeEventListener("error", onError);
					delete window[completionKey];
					element.remove();
					if (error) reject(error); else resolve();
				}
				function onError(event) {
					if (String(event.filename || "").startsWith("dsh-tavern-script:") && event.filename !== sourceUrl) return;
					const message = String(event.error && event.error.message || event.message || "");
					if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) finish(loadFailure({ message: message }));
					else finish(event.error || new Error(event.message || "人物卡模块或依赖加载失败"));
				}
				window[completionKey] = function () { finish(); };
				window.addEventListener("error", onError);
				element.onerror = function (event) {
					if (event && (event.error || event.message)) { onError(event); return; }
					finish(loadFailure(event));
				};
				element.type = "module";
				// Inline modules inherit srcdoc's document base. Native imports retain
				// bindings/re-exports and dynamic imports can resolve local cache URLs.
				// A completion footer waits for top-level await (a load event does not).
				element.textContent = String(source) + "\n;window[" + JSON.stringify(completionKey) + "]?.();\n//# sourceURL=" + sourceUrl + "\n";
                cancelMount = createTavernFrameLifecycle(window, document).mount(function () {
                    if (settled) return;
                    if (beforeMount) beforeMount();
                    document.body.appendChild(element);
                }, finish);
			});
		}
