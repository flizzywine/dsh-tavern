		// `loaded` tells "not a Tavern session" apart from "the list has not arrived".
		const tavernSessionModes = { values: {}, listeners: new Set(), loaded: false };
		function publishSessionModes(items) {
			const next = {};
			(items || []).forEach(function (item) { next[item.sessionId] = item.mode || "story"; });
			tavernSessionModes.values = next;
			tavernSessionModes.loaded = true;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function publishSessionMode(sessionId, mode) {
			const next = Object.assign({}, tavernSessionModes.values, { [sessionId]: mode });
			tavernSessionModes.values = next;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function useTavernSessionMode(sessionId) {
			const [values, setValues] = React.useState(tavernSessionModes.values);
			React.useEffect(function () {
				// The left panel publishes the modes, but on mobile it stays unmounted
				// until the drawer opens; fetch once here so header controls do not
				// wait for it. An unknown session still renders nothing.
				ensureTavernSessionModes();
				tavernSessionModes.listeners.add(setValues);
				return function () { tavernSessionModes.listeners.delete(setValues); };
			}, []);
			return values[sessionId] || "";
		}
		let tavernSessionModeRequest = null;
		function ensureTavernSessionModes() {
			if (tavernSessionModeRequest || tavernSessionModes.loaded) return;
			tavernSessionModeRequest = Promise.resolve()
				.then(function () { return rpc("listSessions"); })
				.then(function (result) { publishSessionModes(result && result.sessions); }, function () {})
				.then(function () { tavernSessionModeRequest = null; });
		}
		function escapeOpeningPreviewText(value) {
			return String(value || "")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/\"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		function isHtmlOpening(value) {
			return /<\/?[a-z][^>]*>/i.test(String(value || ""));
		}

		function tavernStaticAssetUrl(value) {
			const source = String(value || "");
			return /^https:\/\//i.test(source) ? "/api/dsh-tavern/static-assets?url=" + encodeURIComponent(source) + (/\.[cm]?js(?:[?#]|$)/i.test(source) ? "&host=2" : "") : source;
		}

		function rewriteTavernStaticMarkup(value) {
			function replace(_match, prefix, quote, url) { return prefix + quote + tavernStaticAssetUrl(url) + quote; }
			const rewritten = String(value || "")
				.replace(/(\b(?:src|poster)\s*=\s*)(["'])(https:\/\/[^"']+)\2/gi, replace)
				.replace(/(<link\b[^>]*\bhref\s*=\s*)(["'])(https:\/\/[^"']+)\2/gi, replace)
				.replace(/(\s(?:src|poster)\s*=\s*)(https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, url) { return prefix + '"' + tavernStaticAssetUrl(url) + '"'; })
				.replace(/(<link\b[^>]*\shref\s*=\s*)(https:\/\/[^\s"'`<>]+)/gi, function (_match, prefix, url) { return prefix + '"' + tavernStaticAssetUrl(url) + '"'; })
				.replace(/(url\(\s*)(?:(["'])(https:\/\/[^"']+)\2|(https:\/\/[^"')\s]+))(\s*\))/gi, function (_match, prefix, quote, quoted, bare, suffix) { quote = quote || ""; return prefix + quote + tavernStaticAssetUrl(quoted || bare) + quote + suffix; })
				.replace(/(\bfrom\s*|\bimport\s*)(["'])(https:\/\/[^"']+)\2/g, replace)
				.replace(/(\bimport\s*\(\s*)(["'])(https:\/\/[^"']+)\2/g, replace);
			// Media must retain native streaming/Range requests instead of the bounded whole-file cache.
			// Frames are navigations, not subresources: proxying would move the page to our
			// origin and break its relative assets, storage and postMessage origin checks.
			return rewritten.replace(/<(?:video|audio|source|iframe|frame)\b[^>]*>/gi, function (tag) {
				return tag.replace(/(\ssrc\s*=\s*)(["'])(\/api\/dsh-tavern\/static-assets\?url=([^"']+))\2/gi, function (_match, prefix, quote, proxy, url) {
					return prefix + quote + decodeURIComponent(url) + quote;
				});
			});
		}

        // @include modules/remote-document-loader.js

		function tavernStaticAssetShim() {
			return '<script data-dsh-tavern-static-cache>(function(){if(window.__dshTavernStaticAssetUrl)return;function proxy(value){var source=String(value||"");return /^https:\\/\\//i.test(source)?"/api/dsh-tavern/static-assets?url="+encodeURIComponent(source)+(/\\.[cm]?js(?:[?#]|$)/i.test(source)?"&host=2":""):source;}function css(value){return String(value||"").replace(/url\\(\\s*(?:(["\\\'])(https:\\/\\/[^"\\\']+)\\1|(https:\\/\\/[^"\\\')\\s]+))\\s*\\)/gi,function(_,quote,quoted,bare){quote=quote||"";return "url("+quote+proxy(quoted||bare)+quote+")";});}window.__dshTavernStaticAssetUrl=proxy;var nativeSet=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){var key=String(name||"").toLowerCase(),tag=String(this.tagName||"").toLowerCase();if(!(key==="src"&&/^(video|audio|source|iframe|frame)$/.test(tag))&&(key==="src"||key==="poster"||(key==="href"&&tag==="link"))&&/^https:\\/\\//i.test(String(value||"")))value=proxy(value);else if(key==="style")value=css(value);return nativeSet.call(this,name,value);};var nativeGet=Element.prototype.getAttribute,PROXY="/api/dsh-tavern/static-assets?url=";Element.prototype.getAttribute=function(name){var value=nativeGet.call(this,name);if(typeof value!=="string"||value.indexOf(PROXY)!==0)return value;var key=String(name||"").toLowerCase();if(key!=="src"&&key!=="poster"&&key!=="href")return value;var raw=value.slice(PROXY.length),amp=raw.indexOf("&");if(amp>=0)raw=raw.slice(0,amp);try{return decodeURIComponent(raw);}catch(e){return value;}};[["HTMLImageElement","src"],["HTMLScriptElement","src"],["HTMLVideoElement","poster"],["HTMLLinkElement","href"]].forEach(function(row){var Type=window[row[0]],descriptor=Type&&Object.getOwnPropertyDescriptor(Type.prototype,row[1]);if(!descriptor||!descriptor.set||!descriptor.get)return;try{Object.defineProperty(Type.prototype,row[1],{configurable:descriptor.configurable,enumerable:descriptor.enumerable,get:descriptor.get,set:function(value){return descriptor.set.call(this,proxy(value));}});}catch(e){}});if(window.CSSStyleDeclaration&&CSSStyleDeclaration.prototype.setProperty){var nativeProperty=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){return nativeProperty.call(this,name,css(value),priority);};}new MutationObserver(function(records){records.forEach(function(record){var node=record.target;if(!node||node.nodeType!==1)return;["src","poster"].forEach(function(name){if(name==="src"&&/^(video|audio|source|iframe|frame)$/i.test(node.tagName))return;var value=node.getAttribute&&nativeGet.call(node,name);if(/^https:\\/\\//i.test(String(value||"")))nativeSet.call(node,name,proxy(value));});if(String(node.tagName||"").toLowerCase()==="link"){var href=nativeGet.call(node,"href");if(/^https:\\/\\//i.test(String(href||"")))nativeSet.call(node,"href",proxy(href));}var style=node.getAttribute&&nativeGet.call(node,"style");if(style&&/https:\\/\\//i.test(style)){var next=css(style);if(next!==style)nativeSet.call(node,"style",next);}});}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["src","href","poster","style"]});})();<\/script>';
		}

		function tavernIconDependencies() {
			return '<link rel="stylesheet" data-dsh-tavern-icons href="/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css">';
		}

		const tavernHostStylesheetBridges = new WeakMap();
		function bundledTavernStylesheetHref(value) {
			const source = String(value || "");
			const href = source.split(/[?#]/)[0];
			const cdnjs = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[^/]+\/css\/all(?:\.min)?\.css$/i.test(href);
			const jsdelivr = /^https:\/\/(?:cdn|testingcf)\.jsdelivr\.net\/npm\/@fortawesome\/fontawesome-free@[^/]+\/css\/all(?:\.min)?\.css$/i.test(href);
			if (cdnjs || jsdelivr) return "/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css";
			return source;
		}

		function createTavernHostStylesheetBridge(options) {
			const hostWindow = options && options.window || window;
			let entry = tavernHostStylesheetBridges.get(hostWindow);
			if (entry) {
				entry.references += 1;
				return function () { release(); };
			}
			const Link = hostWindow && hostWindow.HTMLLinkElement;
			const prototype = Link && Link.prototype;
			const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "href");
			if (!descriptor || descriptor.configurable === false || typeof descriptor.set !== "function") return function () {};
			const nativeSet = descriptor.set;
			const bridgedSet = function (value) { return nativeSet.call(this, bundledTavernStylesheetHref(value)); };
			Object.defineProperty(prototype, "href", Object.assign({}, descriptor, { set: bridgedSet }));
            // Trusted scripts use host jQuery to mount UI, while their own document
            // remains an iframe. Its icon stylesheet cannot style those host nodes.
            const hostDocument = hostWindow.document;
            let icons = null;
            if (hostDocument && hostDocument.head && hostDocument.createElement) {
                icons = hostDocument.createElement("link");
                icons.rel = "stylesheet";
                icons.setAttribute("data-dsh-tavern-host-icons", "");
                icons.href = "/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css";
                hostDocument.head.appendChild(icons);
            }
			entry = { prototype: prototype, descriptor: descriptor, bridgedSet: bridgedSet, references: 1, icons: icons };
			tavernHostStylesheetBridges.set(hostWindow, entry);
			function release() {
				if (!entry || entry.references <= 0) return;
				entry.references -= 1;
				if (entry.references > 0) return;
                if (entry.icons) entry.icons.remove();
				const current = Object.getOwnPropertyDescriptor(entry.prototype, "href");
				if (current && current.set === entry.bridgedSet) Object.defineProperty(entry.prototype, "href", entry.descriptor);
				tavernHostStylesheetBridges.delete(hostWindow);
			}
			return release;
		}

		function createTavernHostArtifactScope(options) {
            const hostDocument = options && options.document;
            const roots = [hostDocument && hostDocument.head, hostDocument && hostDocument.body].filter(Boolean);
            const owned = new Map();
            const owners = hostDocument.__dshTavernArtifactOwners || (hostDocument.__dshTavernArtifactOwners = new WeakMap());
            const identity = {};
            const host = hostDocument.defaultView;
            // Keep the card's DOM searchable while it is absent from the shared
            // document. In particular, delayed callbacks query fixed IDs again.
            const parking = hostDocument.createElement ? hostDocument.createElement("html") : null;
            const parkingRoots = new Map();
            if (parking) for (const root of roots) {
                const container = hostDocument.createElement(root === hostDocument.head ? "head" : "body");
                parking.appendChild(container);
                parkingRoots.set(root, container);
            }
            let observer = null;
            function parkNode(node, previous) {
                previous.nextSibling = node.nextSibling;
                const container = parkingRoots.get(previous.root);
                if (container) container.appendChild(node);
                else previous.root.removeChild(node);
                previous.parked = true;
            }
            function ownerOf(node) {
                for (; node; node = node.parentNode) if (owners.has(node)) return owners.get(node);
                return null;
            }
            function park() {
                if (visible || disposed) return;
                // Park each node once per hidden period. A card that puts its node
                // back keeps it there (still hidden): taking it again would feed the
                // card's own observer, and the two would never let the page idle.
                for (const [node, previous] of owned) if (!previous.parked && node.parentNode === previous.root) {
                    parkNode(node, previous);
                }
            }
            function remember(node, root) {
                // Prose highlights belong to the host renderer, even if React mounts
                // them while a card frame is being initialized.
                if (owned.has(node) || owners.has(node) || node.hasAttribute?.("data-tavern-retained-frames")
                    || node.hasAttribute?.("data-dsh-tavern-text-colors")) return;
                owners.set(node, identity);
                node.setAttribute?.("data-dsh-tavern-host-artifact", "");
                owned.set(node, { hidden: node.hidden, disabled: node.disabled, body: root === hostDocument.body,
                    root: root, nextSibling: node.nextSibling, parked: false });
            }
            let disposed = false, visible = true;
            const created = new Set();
            function captureCreated() {
                for (const node of created) if (roots.includes(node.parentNode)) remember(node, node.parentNode);
            }
            if (host && host.MutationObserver) {
                observer = new host.MutationObserver(function (changes) {
                    for (const change of changes) for (const node of change.addedNodes) {
                        if (created.has(node)) remember(node, change.target);
                    }
                    park();
                });
                for (const root of roots) observer.observe(root, { childList: true });
            }
            return Object.freeze({
                trackNode: function (node) { created.add(node); return node; },
                findElementById: function (id) {
                    const node = hostDocument.getElementById(id);
                    if (node && (!ownerOf(node) || ownerOf(node) === identity)) return node;
                    if (!disposed && parking) for (const parked of parking.querySelectorAll('[id]')) {
                        if (parked.id === id && ownerOf(parked) === identity) return parked;
                    }
                    return null;
                },
                mutateRoot: function (root, mutate) {
                    const before = new Set(root.childNodes);
                    try { return mutate(); }
                    finally {
                        for (const node of Array.from(root.childNodes)) if (!before.has(node)) {
                            if (disposed) node.remove(); else remember(node, root);
                        }
                        park();
                    }
                },
                // Scope the mounting operation, not the whole asynchronous import.
                // Other conversations and the app can render while that import waits.
                bindJQuery: function (jquery) {
                    const wrappers = new WeakMap();
                    const mutations = new Set(["append", "prepend", "before", "after", "appendTo", "prependTo", "insertBefore", "insertAfter", "replaceWith", "replaceAll", "html"]);
                    function select(selector, context, result) {
                        result = result.filter(function () { const owner = ownerOf(this); return !owner || owner === identity; });
                        if (!parking || disposed) return result;
                        const contexts = context == null ? [hostDocument] : context.jquery ? context.toArray() : [context];
                        for (const root of contexts) {
                            const container = root === hostDocument ? parking : parkingRoots.get(root);
                            if (container) result = result.add(jquery(container).find(selector).filter(function () { return ownerOf(this) === identity; }));
                        }
                        return result;
                    }
                    function wrap(value) {
                        if (!value || !value.jquery) return value;
                        if (wrappers.has(value)) return wrappers.get(value);
                        const proxy = new Proxy(value, { get(target, key) {
                            const method = target[key];
                            if (typeof method !== "function" || key === "constructor") return method;
                            return function () {
                                const before = mutations.has(key) ? roots.map(root => ({ root, nodes: new Set(root.childNodes) })) : null;
                                // Explicit removal must not resurrect a parked panel
                                // when the conversation becomes visible again.
                                if (key === "remove") {
                                    const removed = arguments[0] ? target.filter(arguments[0]) : target;
                                    for (const node of owned.keys()) if (removed.toArray().some(root => root === node || root.contains?.(node))) {
                                        owned.delete(node); owners.delete(node);
                                    }
                                }
                                let result;
                                try { result = method.apply(target, arguments); }
                                finally {
                                    if (before) for (const entry of before) for (const node of Array.from(entry.root.childNodes)) {
                                        if (!entry.nodes.has(node)) { if (disposed) node.remove(); else remember(node, entry.root); }
                                    }
                                }
                                if (key === "find" && typeof arguments[0] === "string") result = select(arguments[0], target, result);
                                return wrap(result);
                            };
                        } });
                        wrappers.set(value, proxy); wrappers.set(proxy, proxy);
                        return proxy;
                    }
                    return new Proxy(jquery, { apply(target, receiver, args) {
                        let result = Reflect.apply(target, receiver, args);
                        if (typeof args[0] === "string" && !args[0].trim().startsWith("<")) result = select(args[0], args[1], result);
                        return wrap(result);
                    } });
                },
                setVisible: function (next) {
                    if (disposed || visible === next) return;
                    captureCreated();
                    visible = next;
                    for (const [node, previous] of owned) {
                        // Hidden nodes still match the fixed IDs used by card scripts
                        // to detect an existing panel. Remove inactive artifacts from
                        // the shared document so another conversation can initialize.
                        // Use native DOM removal: jQuery.remove() discards handlers.
                        if (!next && node.parentNode === previous.root) {
                            parkNode(node, previous);
                        }
                        if (previous.body) node.hidden = next ? previous.hidden : true;
                        else if (node.tagName === "STYLE" || node.tagName === "LINK") node.disabled = next ? previous.disabled : true;
                    }
                    if (next) for (const [node, previous] of Array.from(owned).reverse()) {
                        if (!previous.parked) continue;
                        previous.parked = false;
                        if (node.parentNode && node.parentNode !== parkingRoots.get(previous.root)) continue;
                        if (previous.nextSibling && previous.nextSibling.parentNode === previous.root) {
                            previous.root.insertBefore(node, previous.nextSibling);
                        } else previous.root.append(node);
                    }
                },
                dispose: function () {
                    if (disposed) return;
                    captureCreated();
                    disposed = true;
                    if (observer) observer.disconnect();
                    for (const node of owned.keys()) {
                        if (typeof node.remove === "function") node.remove();
                        else if (node.parentNode && typeof node.parentNode.removeChild === "function") node.parentNode.removeChild(node);
                    }
                    owned.clear();
                    created.clear();
                }
            });
        }

		const TAVERN_CARD_PHONE_HOST = '[id^="improved-phone-shadow-host-"]';
		const TAVERN_CARD_PHONE_BUTTON = '[id^="improved-phone-floating-button-"]';
		const TAVERN_CARD_PHONE_PARKING = '[data-dsh-tavern-card-app-parking]';
		const TAVERN_CARD_PHONE_SESSION = 'data-dsh-tavern-card-app-session';
		const TAVERN_CARD_PHONE_CSS = '/api/dsh-tavern/vendor/runtime-assets/fontawesome/css/all.min.css';
		const TAVERN_CARD_PHONE_FONTS = '/api/dsh-tavern/vendor/runtime-assets/fontawesome/webfonts/';
		let tavernCardIconCssPromise = null;
		function loadTavernCardIconCss() {
			if (!tavernCardIconCssPromise) tavernCardIconCssPromise = window.fetch(TAVERN_CARD_PHONE_CSS).then(function (response) {
				if (!response.ok) throw new Error("人物卡图标样式加载失败（HTTP " + String(response.status) + "）");
				return response.text();
			}).then(function (css) {
				return String(css).replace(/url\((['"]?)\.\.\/webfonts\//g, "url($1" + TAVERN_CARD_PHONE_FONTS);
			}).catch(function (error) {
				tavernCardIconCssPromise = null;
				throw error;
			});
			return tavernCardIconCssPromise;
		}
		function ensureTavernCardIconFonts(hostDocument) {
			if (!hostDocument || !hostDocument.head || typeof hostDocument.createElement !== "function") return;
			if (hostDocument.querySelector && hostDocument.querySelector('style[data-dsh-tavern-card-app-fonts]')) return;
			const fonts = hostDocument.createElement("style");
			fonts.setAttribute("data-dsh-tavern-card-app-fonts", "fontawesome");
			fonts.textContent = '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-solid-900.woff2") format("woff2")}\n'
				+ '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:400;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-regular-400.woff2") format("woff2")}\n'
				+ '@font-face{font-family:"Font Awesome 6 Brands";font-style:normal;font-weight:400;font-display:block;src:url("' + TAVERN_CARD_PHONE_FONTS + 'fa-brands-400.woff2") format("woff2")}';
			hostDocument.head.appendChild(fonts);
		}
		function ensureTavernCardAppParking(hostDocument) {
			if (!hostDocument || !hostDocument.body || typeof hostDocument.createElement !== "function") return null;
			let parking = hostDocument.querySelector && hostDocument.querySelector(TAVERN_CARD_PHONE_PARKING);
			if (parking) return parking;
			parking = hostDocument.createElement("div");
			parking.setAttribute("data-dsh-tavern-card-app-parking", "");
			parking.setAttribute("aria-hidden", "true");
			parking.hidden = true;
			hostDocument.body.appendChild(parking);
			return parking;
		}
		function createTavernCardAppPresence(options) {
			const hostWindow = options && options.window || window;
			const notify = options && typeof options.onChange === "function" ? options.onChange : function () {};
			const listeners = new Set();
			const schedule = options && options.setTimeout || (typeof hostWindow.setTimeout === "function" ? hostWindow.setTimeout.bind(hostWindow) : function () { return null; });
			const cancel = options && options.clearTimeout || (typeof hostWindow.clearTimeout === "function" ? hostWindow.clearTimeout.bind(hostWindow) : function () {});
			const graceMs = Math.max(0, Number(options && options.graceMs) || 5000);
			let timer = null;
			let disposed = false;
			let state = Object.freeze({ visible: false, attached: false, recovering: false });
			function publish(next) {
				state = Object.freeze(next);
				notify(state);
				listeners.forEach(function (listener) { listener(); });
			}
			function cancelPending() { if (timer !== null) { cancel(timer); timer = null; } }
			function change(attached) {
				if (disposed) return;
				if (attached) {
					cancelPending();
					publish({ visible: true, attached: true, recovering: false });
					return;
				}
				if (!state.visible || state.recovering) return;
				publish({ visible: true, attached: false, recovering: true });
				timer = schedule(function () {
					timer = null;
					if (disposed || state.attached) return;
					publish({ visible: false, attached: false, recovering: false });
				}, graceMs);
			}
			return Object.freeze({
				change: change,
				inspect: function () { return state; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				dispose: function () { disposed = true; cancelPending(); listeners.clear(); }
			});
		}
		const tavernCardAppPresence = createTavernCardAppPresence();
		function createTavernCardAppDock(options) {
			const hostDocument = options && options.document || document;
			const slot = options && options.slot;
			const sessionId = String(options && options.sessionId || "");
			const loadIconCss = options && options.loadIconCss || loadTavernCardIconCss;
			const notify = options && typeof options.onChange === "function" ? options.onChange : function () {};
			const Mutation = options && Object.prototype.hasOwnProperty.call(options, "MutationObserver") ? options.MutationObserver : (hostDocument.defaultView && hostDocument.defaultView.MutationObserver);
			const Resize = options && Object.prototype.hasOwnProperty.call(options, "ResizeObserver") ? options.ResizeObserver : (hostDocument.defaultView && hostDocument.defaultView.ResizeObserver);
			let attached = null;
			let originalParent = null;
			let originalNext = null;
			let originalStyle = null;
			let floatingButton = null;
			let floatingDisplay = null;
			let mutationObserver = null;
			let resizeObserver = null;
			const candidateObservers = new Map();
			let disposed = false;

			function hasPhoneLayout(host) {
				const root = host && host.shadowRoot;
				return Boolean(root && typeof root.querySelector === "function" && root.querySelector(".phone-wrapper"));
			}

			function clearCandidateObserver(host) {
				const observer = candidateObservers.get(host);
				if (observer) observer.disconnect();
				candidateObservers.delete(host);
			}

			function watchCandidate(host) {
				if (typeof Mutation !== "function" || !host || !host.shadowRoot || candidateObservers.has(host)) return;
				const observer = new Mutation(function () {
					if (hasPhoneLayout(host)) { clearCandidateObserver(host); scan(); }
				});
				observer.observe(host.shadowRoot, { childList: true, subtree: true });
				candidateObservers.set(host, observer);
			}

			function installShadowDependencies(host) {
				const root = host && host.shadowRoot;
				if (!root) return false;
				const staleIcons = typeof root.querySelectorAll === "function"
					? Array.from(root.querySelectorAll('link[href*="font-awesome"], link[href*="fontawesome"], link[data-dsh-tavern-card-app-icons], style[data-dsh-tavern-card-app-icons]'))
					: [];
				const icons = root.ownerDocument.createElement("style");
				icons.setAttribute("data-dsh-tavern-card-app-icons", "fontawesome");
				root.appendChild(icons);
				staleIcons.forEach(function (item) { if (item && item !== icons && typeof item.remove === "function") item.remove(); });
				Promise.resolve(loadIconCss()).then(function (css) {
					if (icons.isConnected === false) return;
					icons.textContent = String(css || "");
				}).catch(function (error) { console.warn("人物卡图标样式加载失败", error); });
				let layout = root.querySelector('[data-dsh-tavern-card-app-layout]');
				if (!layout) {
					layout = root.ownerDocument.createElement("style");
					layout.setAttribute("data-dsh-tavern-card-app-layout", "phone");
					layout.layoutStyle = true;
					layout.textContent = '.phone-wrapper{position:absolute!important;top:10px!important;left:50%!important;right:auto!important;transform:translateX(-50%) scale(var(--dsh-tavern-card-app-scale,1))!important;transform-origin:top center!important}.phone-drag-btn,.phone-charm{display:none!important}'
						// the page rule does not reach into this shadow root.
						+ '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
					root.appendChild(layout);
				}
				return true;
			}

			function resize() {
				if (!attached) return;
				const available = Math.max(240, Number(slot && slot.clientWidth) || 384) - 24;
				const scale = Math.min(1, available / 360);
				attached.style.setProperty("--dsh-tavern-card-app-scale", String(scale));
				attached.style.height = String(Math.ceil(620 * scale)) + "px";
			}

			function attach(host) {
				if (!host || host === attached) return false;
				const ownerSessionId = host.getAttribute && host.getAttribute(TAVERN_CARD_PHONE_SESSION);
				if (ownerSessionId && sessionId && ownerSessionId !== sessionId) return false;
				if (!hasPhoneLayout(host)) { watchCandidate(host); return false; }
				clearCandidateObserver(host);
				if (attached) restore();
				attached = host;
				if (sessionId && host.setAttribute) host.setAttribute(TAVERN_CARD_PHONE_SESSION, sessionId);
				originalParent = host.parentNode;
				originalNext = host.nextSibling;
				originalStyle = host.getAttribute && host.getAttribute("style");
				slot.appendChild(host);
				ensureTavernCardIconFonts(hostDocument);
				if (!installShadowDependencies(host)) { restore(); return false; }
				host.style.position = "relative";
				host.style.inset = "auto";
				host.style.zIndex = "auto";
				host.style.width = "100%";
				host.style.overflow = "hidden";
				const phoneKey = String(host.id || "").slice("improved-phone-shadow-host-".length);
				floatingButton = hostDocument.getElementById && hostDocument.getElementById("improved-phone-floating-button-" + phoneKey) || hostDocument.querySelector(TAVERN_CARD_PHONE_BUTTON);
				if (floatingButton) {
					floatingDisplay = floatingButton.style.display;
					floatingButton.style.display = "none";
				}
				resize();
				notify(true);
				return true;
			}

			function restore() {
				if (!attached) return;
				const host = attached;
				attached = null;
				if (originalStyle === null && host.removeAttribute) host.removeAttribute("style");
				else if (host.setAttribute) host.setAttribute("style", originalStyle || "");
				if (originalParent) {
					if (originalNext && originalNext.parentNode === originalParent && typeof originalParent.insertBefore === "function") originalParent.insertBefore(host, originalNext);
					else if (typeof originalParent.appendChild === "function") originalParent.appendChild(host);
				}
				if (floatingButton) floatingButton.style.display = floatingDisplay;
				originalParent = null; originalNext = null; originalStyle = null; floatingButton = null; floatingDisplay = null;
				notify(false);
			}

			function park() {
				if (!attached) return;
				const host = attached;
				attached = null;
				const parking = ensureTavernCardAppParking(hostDocument);
				if (parking && typeof parking.appendChild === "function") parking.appendChild(host);
				else host.style.display = "none";
				if (floatingButton) floatingButton.style.display = "none";
				originalParent = null; originalNext = null; originalStyle = null; floatingButton = null; floatingDisplay = null;
				notify(false);
			}

			function scan() {
				if (disposed || attached) return;
				const hosts = hostDocument.querySelectorAll(TAVERN_CARD_PHONE_HOST);
				for (let index = 0; index < hosts.length; index += 1) if (attach(hosts[index])) break;
			}

			// a phone host can only arrive in added nodes. Look there, not through
			// the whole document on every mutation (the id-prefix selector walked ~23k elements per stage page turn).
			function added(mutations) {
				for (let i = 0; i < mutations.length; i += 1) {
					const nodes = mutations[i].addedNodes || [];
					for (let j = 0; j < nodes.length; j += 1) {
						const node = nodes[j];
						if (node.nodeType !== 1) continue;
						if (String(node.id || "").indexOf("improved-phone-shadow-host-") === 0) return true;
						if (typeof node.querySelector === "function" && node.querySelector(TAVERN_CARD_PHONE_HOST)) return true;
					}
				}
				return false;
			}

			scan();
			if (typeof Mutation === "function" && hostDocument.body) {
				mutationObserver = new Mutation(function (mutations) {
					let lost = false;
					if (attached && attached.isConnected === false) {
						attached = null; originalParent = null; originalNext = null; originalStyle = null;
						if (floatingButton) floatingButton.style.display = floatingDisplay;
						floatingButton = null; floatingDisplay = null;
						notify(false);
						lost = true;
					}
					if (!attached && (lost || !mutations || added(mutations))) scan();
				});
				mutationObserver.observe(hostDocument.body, { childList: true, subtree: true });
			}
			if (typeof Resize === "function" && slot) {
				resizeObserver = new Resize(resize);
				resizeObserver.observe(slot);
			}
			return Object.freeze({
				open: function () { const button = hostDocument.querySelector(TAVERN_CARD_PHONE_BUTTON); if (button && typeof button.click === "function") button.click(); },
				inspect: function () { return { attached: Boolean(attached) }; },
				dispose: function () { disposed = true; if (mutationObserver) mutationObserver.disconnect(); if (resizeObserver) resizeObserver.disconnect(); candidateObservers.forEach(function (observer) { observer.disconnect(); }); candidateObservers.clear(); park(); }
			});
		}
