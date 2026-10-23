		function ensureTavernHostJQuery(host) {
			if (host.jQuery && host.jQuery.fn && host.jQuery.fn.jquery) return Promise.resolve();
			const doc = host.document;
			const existing = doc.querySelector('script[data-dsh-tavern-host-jquery]');
			if (existing && existing.tavernReady) return existing.tavernReady;
			const script = doc.createElement('script');
			script.setAttribute('data-dsh-tavern-host-jquery', '');
			script.src = '/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js';
			const previousDollar = host.$;
			script.tavernReady = new Promise(function (resolve, reject) {
				const timer = host.setTimeout(function () { finish(new Error('宿主 jQuery 加载超时')); }, 15000);
				function finish(error) {
					host.clearTimeout(timer);
					script.onload = script.onerror = null;
					script.remove();
					if (error) reject(error); else resolve();
				}
				script.onload = function () {
					if (!host.jQuery || !host.jQuery.fn || !host.jQuery.fn.jquery) return finish(new Error('宿主 jQuery 未初始化'));
					if (previousDollar !== undefined && host.$ === host.jQuery) host.jQuery.noConflict();
					finish();
				};
				script.onerror = function () { finish(new Error('宿主 jQuery 加载失败')); };
			});
			doc.head.appendChild(script);
			return script.tavernReady;
		}

		function ensureTavernHostJQueryUi(host) {
			if (host.jQuery && typeof host.jQuery.fn.draggable === "function") return Promise.resolve();
			const doc = host.document;
			const existing = doc.querySelector('script[data-dsh-tavern-host-jquery-ui]');
			if (existing && existing.tavernReady) return existing.tavernReady;
			const script = doc.createElement('script');
			script.setAttribute('data-dsh-tavern-host-jquery-ui', '');
			script.src = '/api/dsh-tavern/vendor/runtime-assets/jquery-ui/jquery-ui.min.js';
			script.tavernReady = new Promise(function (resolve, reject) {
				const timer = host.setTimeout(function () { finish(new Error('宿主 jQuery UI 加载超时')); }, 15000);
				function finish(error) {
					host.clearTimeout(timer);
					script.onload = script.onerror = null;
					script.remove();
					if (error) reject(error); else resolve();
				}
				script.onload = function () { finish(typeof host.jQuery.fn.draggable === 'function' ? null : new Error('宿主 jQuery UI 未初始化')); };
				script.onerror = function () { finish(new Error('宿主 jQuery UI 加载失败')); };
			});
			doc.head.appendChild(script);
			return script.tavernReady;
		}

        function mountTavernLegacyMessage(options) {
            // Card scripts own this DOM subtree. Keep React's message tree separate
            // so innerHTML replacement cannot detach nodes React still reconciles.
            const node = options.node, native = options.native;
            const text = node.ownerDocument.createElement("div");
            text.className = "mes_text";
            text.textContent = String(options.source || "");
            node.appendChild(text);
            const initial = text.textContent;
            // Source differs from display after macro/regex processing too.
            // Only an actual script DOM edit may replace the native renderer.
            node.hidden = true;
            native.hidden = false;
            text.style.whiteSpace = "pre-wrap";
            const Observer = options.MutationObserver || node.ownerDocument.defaultView.MutationObserver;
            const observer = new Observer(function () {
                const replaced = text.childElementCount > 0 || text.textContent !== initial;
                node.hidden = !replaced;
                native.hidden = replaced;
            });
            observer.observe(text, { childList: true, subtree: true, characterData: true });
            return function () { observer.disconnect(); text.remove(); native.hidden = false; };
        }

        // SillyTavern scripts rewrite the displayed message (phone bubbles, inline
        // widgets) through retrieveDisplayedMessage. React owns the native tree, so
        // scripts get a static copy; once they change it, the copy replaces the
        // native part. A new text rebuilds the copy and announces the render again.
        const tavernRenderedAnnouncements = new Map();
        function announceTavernMessageRendered(view, sessionId, messageId) {
            const key = String(sessionId) + ":" + String(messageId);
            view.clearTimeout(tavernRenderedAnnouncements.get(key));
            tavernRenderedAnnouncements.set(key, view.setTimeout(function () {
                tavernRenderedAnnouncements.delete(key);
                view.dispatchEvent(new view.CustomEvent("dsh-tavern-message-rendered", { detail: { sessionId: String(sessionId), messageId: Number(messageId) } }));
            }, 80));
        }
        function mountTavernScriptLayer(options) {
            const native = options.native, layer = options.layer;
            const view = layer.ownerDocument.defaultView;
            const Observer = options.MutationObserver || view.MutationObserver;
            let takenOver = false, disposed = false;
            layer.hidden = true;
            native.hidden = false;
            const layerObserver = new Observer(function () {
                if (takenOver || disposed) return;
                takenOver = true;
                layer.hidden = false;
                native.hidden = true;
            });
            function rebuild() {
                if (takenOver || disposed) return;
                layer.replaceChildren.apply(layer, Array.from(native.childNodes).map(function (node) { return node.cloneNode(true); }));
                // Our own copy is not a script edit.
                layerObserver.takeRecords();
            }
            const nativeObserver = new Observer(function () { rebuild(); });
            rebuild();
            layerObserver.observe(layer, { childList: true, subtree: true, characterData: true, attributes: true });
            nativeObserver.observe(native, { childList: true, subtree: true, characterData: true });
            announceTavernMessageRendered(view, options.sessionId, options.messageId);
            return function () {
                disposed = true;
                layerObserver.disconnect();
                nativeObserver.disconnect();
                layer.replaceChildren();
                layer.hidden = true;
                native.hidden = false;
            };
        }
        function tavernScriptLayers(document, sessionId, messageId) {
            return Array.from(document.querySelectorAll("[data-dsh-script-layer]")).filter(function (node) {
                return node.getAttribute("data-mesid") === String(messageId)
                    && (!sessionId || node.getAttribute("data-session") === String(sessionId)) && node.isConnected;
            });
        }

		function installTavernTrustedHostFacade(host, frameWindow, priority, names) {
			// A visible mount root supports legacy host detection and panel mounting.
			// Never fake send_textarea: scripts must reach the real composer.
			let chatRoot = host.document && host.document.getElementById('chat');
			if (!chatRoot && host.document && host.document.createElement) {
				chatRoot = host.document.createElement('div');
				chatRoot.id = 'chat';
                // This compatibility mount is not another chat viewport. Legacy
                // panel padding must not add a second, page-level scroll range.
                if (chatRoot.style) chatRoot.style.setProperty('display', 'contents', 'important');
                // display:contents has no box, but scripts measure #chat as the reading
                // pane (clip windows, "is my slot visible"). A 0x0 rect hides them.
                chatRoot.getBoundingClientRect = function () {
                    const pane = host.document.querySelector('[data-conversation-scroll]');
                    return (pane || host.document.documentElement).getBoundingClientRect();
                };
				chatRoot.tavernCompatibilityOwners = 0;
				host.document.body.appendChild(chatRoot);
			}
			const ownsChatRoot = chatRoot && typeof chatRoot.tavernCompatibilityOwners === 'number';
			if (ownsChatRoot) chatRoot.tavernCompatibilityOwners++;
			// Legacy sorting scripts address the parent document in trusted mode.
			// This hidden select accepts their UI events only; it has no host listeners.
			let sortControl = host.document && host.document.getElementById('world_info_sort_order');
			if (!sortControl && host.document && host.document.createElement) {
				sortControl = host.document.createElement('select');
				sortControl.id = 'world_info_sort_order';
				sortControl.hidden = true;
				const option = host.document.createElement('option');
				option.value = '13';
				option.textContent = '自定义排序';
				sortControl.appendChild(option);
				sortControl.tavernCompatibilityOwners = 0;
				host.document.body.appendChild(sortControl);
			}
			const ownsSortControl = sortControl && typeof sortControl.tavernCompatibilityOwners === 'number';
			if (ownsSortControl) sortControl.tavernCompatibilityOwners++;
			const frameElement = frameWindow.frameElement, frameDocument = frameWindow.document;
			const bindings = (names || ["SillyTavern", "TavernHelper", "Mvu", "_", "toastr"]).map(function (name) {
				const previous = Object.getOwnPropertyDescriptor(host, name);
				if (previous && !previous.configurable) throw new Error("宿主接口不可替换：" + name);
				const binding = { name: name, previous: previous, active: true, priority: Number(priority) || 0, frameWindow: frameWindow, frameElement: frameElement, frameDocument: frameDocument, toastr: name === "toastr" ? frameWindow.toastr : undefined, get: function () {
                    function rank(owner) {
                        const sessionId = owner.frameWindow.frameElement && owner.frameWindow.frameElement.__dshTavernSessionId;
                        return owner.priority + (host.__dshTavernSelectedSessionId && sessionId ? (sessionId === host.__dshTavernSelectedSessionId ? 1 : -1) : 0);
                    }
                    // document.open() removes the frame's unload listeners. Do
                    // not rely on those listeners to retire its host APIs.
                    let selected = null, newer = null, descriptor = { get: binding.get };
                    while (descriptor && descriptor.get && descriptor.get.tavernHostBinding) {
                        const owner = descriptor.get.tavernHostBinding;
                        let live = owner.active;
                        try {
                            if (owner.frameElement && owner.frameElement.isConnected === false) live = false;
                            if (owner.frameDocument && owner.frameWindow.document !== owner.frameDocument) live = false;
                        } catch (_) { live = false; }
                        if (live) {
                            if (!selected || rank(owner) > rank(selected)) selected = owner;
                            newer = owner;
                        } else {
                            if (owner.release) owner.release();
                            if (newer) newer.previous = owner.previous;
                        }
                        descriptor = owner.previous;
                    }
                    if (!selected) return descriptor && (descriptor.get ? descriptor.get.call(host) : descriptor.value);
                    return name === "toastr" ? selected.toastr : selected.frameWindow[name];
                } };
				binding.get.tavernHostBinding = binding;
				return binding;
			});
			for (const binding of bindings) Object.defineProperty(host, binding.name, { configurable: true, get: binding.get });
			let released = false;
			function release() {
				if (released) return;
				released = true;
				if (ownsSortControl && --sortControl.tavernCompatibilityOwners === 0) sortControl.remove();
				if (ownsChatRoot && --chatRoot.tavernCompatibilityOwners === 0) chatRoot.remove();
				for (const binding of bindings) {
					binding.active = false;
					if (Object.getOwnPropertyDescriptor(host, binding.name)?.get !== binding.get) continue;
					let previous = binding.previous;
					while (previous?.get?.tavernHostBinding && !previous.get.tavernHostBinding.active) previous = previous.get.tavernHostBinding.previous;
					if (previous) Object.defineProperty(host, binding.name, previous);
					else delete host[binding.name];
				}
			}
			for (const binding of bindings) binding.release = release;
			return release;
		}

		function releaseTavernHostJQueryHandlers(host, frameWindow) {
            if (!host || !frameWindow || !frameWindow.Function) return;
            // A trusted script can use either jQuery instance to bind live message
            // nodes. Each instance owns a separate event cache, so inspect both.
            const registries = Array.from(new Set([host.jQuery, frameWindow.jQuery])).filter(function (jq) {
                return jq && typeof jq.hasData === "function" && typeof jq._data === "function" && typeof jq.event?.remove === "function";
            });
            if (!registries.length) return;
            const targets = new Set();
            function addDocument(owner, document) {
                if (owner) targets.add(owner);
                if (!document) return;
                targets.add(document);
                for (const node of document.querySelectorAll?.('*') || []) targets.add(node);
            }
            addDocument(host, host.document);
            addDocument(frameWindow, frameWindow.document);
            const sessionId = frameWindow.frameElement?.__dshTavernSessionId;
            if (sessionId) for (const frame of host.document?.querySelectorAll?.('iframe.dsh-tavern-message-frame') || []) {
                if (frame.__dshTavernSessionId !== sessionId) continue;
                try {
                    // Hidden replacement frames may already have handlers too.
                    // Never enter another session or an opaque/cross-origin frame.
                    const document = frame.contentDocument;
                    if (document) addDocument(frame.contentWindow, document);
                } catch (_) { /* Cross-origin documents cannot be inspected. */ }
            }
            // Callback realm identifies the retiring script even on shared DOM.
            // Preserve other scripts' callbacks, including identical namespaces.
            for (const jq of registries) for (const target of targets) {
                if (!jq.hasData(target)) continue;
                const events = jq._data(target, 'events') || {};
                for (const handlers of Object.values(events)) {
                    for (const entry of Array.from(handlers)) {
                        if (entry.handler instanceof frameWindow.Function) {
                            jq.event.remove(target, entry.origType + (entry.namespace ? '.' + entry.namespace : ''), entry.handler, entry.selector);
                        }
                    }
                }
            }
		}

        // The parent sends the latest complete context after iframe load. Keep
        // archive data out of executable srcdoc and install the facade before
        // companion modules can continue past their existing readiness gate.
        function startTavernHelperFromMessage(metadata, bootstrap) {
            window.__dshTavernHelperReady = new Promise(function (resolve, reject) {
                function receive(event) {
                    const data = event && event.data;
                    if (event.source !== parent || !data || data.token !== metadata.token || data.type !== "dsh-tavern-helper-context") return;
                    window.removeEventListener("message", receive);
                    try { bootstrap(data.context); resolve(window.__dshTavernHelperReady); }
                    catch (error) {
                        parent.postMessage({type:"dsh-tavern-helper-bootstrap-failed",token:metadata.token,message:String(error && error.message || error)},"*");
                        reject(error);
                    }
                }
                window.addEventListener("message", receive);
            });
        }

		function buildTavernHelperScriptParts(input) {
			const scripts = Array.isArray(input && input.scripts)
				? input.scripts
				: (input && input.script ? [input.script] : []);
			const metadata = {
				token: String(input && input.token || ""),
				officialMvu: scripts.some(function (script) { return script && script.system === "official-mvu"; }),
				scripts: scripts.map(function (script) {
					return {
						id: String(script && script.id || ""),
						name: String(script && script.name || ""),
						info: String(script && script.info || ""),
						buttons: Array.isArray(script && script.buttons) ? script.buttons : [],
                        buttonsEnabled: !script || script.buttonsEnabled !== false,
						system: String(script && script.system || "")
					};
				})
			};
			const context = input && input.context && typeof input.context === "object" ? input.context : {};
			const safeMetadata = JSON.stringify(metadata).replace(/</g, "\\u003c");
			const safeContext = input && input.deferContext === true ? "initialContext" : JSON.stringify(context).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			let bootstrap = '(' + tavernHelperScriptBootstrap.toString() + ')(' + safeMetadata + ',' + safeContext + ',{'
				+ 'createInitializationTiming:' + createTavernInitializationTiming.toString() + ','
				+ 'createTransport:' + createTavernHelperTransport.toString() + ','
                + 'createIndexedArrayApi:' + createIndexedArrayApi.toString() + ','
                + 'createOrderedNumericIndex:' + createOrderedNumericIndex.toString() + ','
                + 'createTurnFieldIndex:' + createTurnFieldIndex.toString() + ','
                + 'applyVariableReceipt:' + applyTavernVariableReceipt.toString() + ','
				+ 'createMessageReader:' + createTavernHelperMessageReader.toString() + ','
                + 'installUtilities:' + installTavernHelperUtilities.toString() + ','
                + 'installMacros:' + installTavernHelperMacroApi.toString() + ','
                + 'installDisplay:' + installTavernHelperDisplayApi.toString() + ','
                + 'installGeneration:' + installTavernHelperGenerationApi.toString() + ','
                + 'installEventApi:' + installTavernHelperEventApi.toString() + ','
                + 'createRegexEngine:' + createTavernRegexEngine.toString() + ','
                + 'installRegexApi:' + installTavernHelperRegexApi.toString() + ','
				+ 'createEvents:' + createTavernHelperEventBus.toString() + ','
				+ 'createPopup:' + createTavernHelperPopup.toString() + ','
				+ 'installCompatibility:' + installTavernCompatibilityDiagnostics.toString() + ','
				+ 'createHistoryReader:' + createTavernHistoryReader.toString() + ','
                + 'createResourceReader:' + createTavernResourceReader.toString() + ','
                + 'createChatData:' + createTavernChatDataFacade.toString() + ','
                + 'createLocalVariables:' + createTavernLocalVariables.toString() + ','
				+ 'installBackgroundModel:' + installTavernBackgroundModel.toString() + ','
				+ 'installFacade:' + installTavernHelperFacade.toString() + '});';
            if (input && input.deferContext === true) bootstrap = '(' + startTavernHelperFromMessage.toString() + ')(' + safeMetadata + ',function(initialContext){' + bootstrap + '});';
			const modules = scripts.map(function (script) {
				return { id: String(script && script.id || ""), system: String(script && script.system || ""), assetUrl: String(script && script.assetUrl || ""), content: String(script && script.content || "") };
			});
			const loaderSource = 'await window.__dshTavernHelperReady;\n'
                + 'const createTavernFrameLifecycle=' + createTavernFrameLifecycle.toString() + ';\n'
				+ 'const createTavernPreviewWindow=' + createTavernPreviewWindow.toString() + ';\n'
				+ 'const loadModule=' + loadTavernHelperModule.toString() + ';\n'
				+ 'const createMvuLoader=' + createMvuBundleLoader.toString() + ';\n'
				+ 'const scripts=' + JSON.stringify(modules).replace(/</g, "\\u003c") + ';\n'
				+ 'const token=' + JSON.stringify(metadata.token) + ';\n'
				+ 'try{'
				+ (input && input.trustedCardMode ? 'const ensureHostJQuery=' + ensureTavernHostJQuery.toString() + ';await ensureHostJQuery(window.parent);const ensureHostJQueryUi=' + ensureTavernHostJQueryUi.toString() + ';await ensureHostJQueryUi(window.parent);const artifacts=window.frameElement&&window.frameElement.__dshTavernHostArtifacts;window.$=window.jQuery=artifacts?artifacts.bindJQuery(window.parent.jQuery):window.parent.jQuery;const installHostFacade=' + installTavernTrustedHostFacade.toString() + ';const releaseHostFacade=installHostFacade(window.parent,window);window.addEventListener("pagehide",releaseHostFacade,{once:true});window.addEventListener("unload",releaseHostFacade,{once:true});\n' : '')
				+ 'const installComposer=' + installLegacyTavernComposer.toString() + ';await installComposer();\n'
                + 'window.__dshTavernComposerWindow=(' + createTavernComposerWindow.toString() + ')(window);if(window.jQuery){window.$=window.jQuery=window.__dshTavernComposerWindow.jQuery;}\n'
                + 'const installNodeCompatibility=' + installTavernNodeCompatibility.toString() + ';installNodeCompatibility(window);\n'
				+ 'for(const script of scripts){window.__dshTavernHelperSetCurrentScript(script.id);try{'
				+ 'if(script.system==="official-mvu"&&script.assetUrl){const loader=createMvuLoader({fetch:window.fetch.bind(window),evaluate:source=>loadModule(source,script.id,false,installComposer),onDiagnostic(diagnostic){parent.postMessage({type:"dsh-tavern-mvu-load-diagnostic",token,diagnostic},"*");},onState(state){parent.postMessage({type:"dsh-tavern-mvu-load-state",token,state},"*");}});'
				+ 'const retry=event=>{if(event.source===parent&&event.data?.token===token&&event.data.type==="dsh-tavern-mvu-reload")loader.retry();};'
				+ 'window.addEventListener("message",retry);window.addEventListener("pagehide",()=>loader.dispose(),{once:true});'
				+ 'try{await loader.load(new URL(script.assetUrl,document.baseURI).href);}finally{window.removeEventListener("message",retry);}}else await window.__dshTavernInitializationTiming.wait("companion-module",loadModule(script.content,script.id,' + (input && input.previewScope === true ? 'true' : 'false') + ',installComposer),script.id);'
				+ 'if(script.system==="official-mvu")await window.waitGlobalInitialized("Mvu");window.__dshTavernHelperSubscriptionsReady(script.id);'
				+ '}catch(error){window.__dshTavernHelperSubscriptionsFailed(script.id,error);if(script.system==="official-mvu")break;}}}catch(error){for(const script of scripts)window.__dshTavernHelperSubscriptionsFailed(script.id,error);}finally{window.__dshTavernResolveCompanionScriptsReady();}';
			// Start now: document.open() can remove deferred module tags before they run.
			const safeLoader = JSON.stringify(loaderSource).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			return {
				head: '<script data-dsh-tavern-crypto>(' + installTavernCryptoSubtlePolyfill.toString() + ')(window);<\/script>'
                + tavernIconDependencies()
				+ tavernStaticAssetShim()
				+ tavernHelperScriptDependencies()
				+ '<script data-dsh-tavern-helper-script>' + bootstrap + '<\/script>',
				body: '<div id="extensions_settings2" hidden><select id="world_info_sort_order"><option value="13">自定义排序</option></select></div><div id="tavern_helper" hidden></div><script data-dsh-tavern-helper-loader>(' + startTavernHelperLoader.toString() + ')(' + safeLoader + ');<\/script>'
			};
        }

        function buildTavernHelperScriptDocument(input) {
			const parts = buildTavernHelperScriptParts(input);
			return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src dsh-app://app/api/dsh-tavern/ https: http: data: blob:; script-src dsh-app://app/api/dsh-tavern/ \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src dsh-app://app/api/dsh-tavern/ https: http: wss: data: blob:; img-src dsh-app://app/api/dsh-tavern/ https: http: data: blob:; style-src dsh-app://app/api/dsh-tavern/ \'unsafe-inline\' https: http:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
				+ parts.head + '</head><body>' + parts.body + '</body></html>';
        }
