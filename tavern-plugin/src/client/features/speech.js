		// Voiced dialogue (docs/design/cast-presentation.md): the voicing settings, a player that
		// says one line at a time, and the voice field of the character material.
		const tavernSpeechSettings = (function () {
			let data = null, loading = null;
			const listeners = new Set();
			function publish(next) { data = next; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function load() {
				if (loading) return loading;
				loading = rpc("getSpeechSettings").then(publish, function () { publish({ enabled: false, provider: "browser", providers: [] }); }).finally(function () { loading = null; });
				return loading;
			}
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-settings-changed", function () { void load(); });
			return {
				subscribe: function (listener) { listeners.add(listener); if (data === null) void load(); return function () { listeners.delete(listener); }; },
				get: function () { return data; },
				set: publish
			};
		})();
		function useTavernSpeechSettings() {
			return React.useSyncExternalStore(tavernSpeechSettings.subscribe, tavernSpeechSettings.get);
		}

		function tavernBrowserVoices() {
			try { return window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (_) { return []; }
		}

		// One line at a time: a new line stops the one being said. speak resolves true when it was heard to the end.
		const tavernSpeech = (function () {
			let current = null;
			function stop() { const playing = current; current = null; if (playing) playing.cancel(); }
			function browser(reply, playing) {
				return new Promise(function (resolve) {
					const synth = window.speechSynthesis;
					if (!synth || typeof SpeechSynthesisUtterance !== "function") { resolve(false); return; }
					const utterance = new SpeechSynthesisUtterance(reply.text);
					const voices = tavernBrowserVoices();
					const voice = voices.find(function (item) { return item.name === reply.voice; }) || (!reply.voice ? voices.find(function (item) { return /^zh/i.test(item.lang); }) : null);
					if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = "zh-CN";
					utterance.onend = function () { resolve(true); };
					utterance.onerror = function () { resolve(false); };
					playing.cancel = function () { synth.cancel(); resolve(false); };
					synth.cancel();
					synth.speak(utterance);
				});
			}
			function audio(reply, playing) {
				return new Promise(function (resolve) {
					const element = new Audio(reply.url);
					element.onended = function () { resolve(true); };
					element.onerror = function () { resolve(false); };
					playing.cancel = function () { element.pause(); resolve(false); };
					element.play().catch(function () { resolve(false); });
				});
			}
			/** Play what the host returned for a line ({ browser, voice, text } or { url }). */
			function play(reply) {
				stop();
				if (!reply || reply.skip) return Promise.resolve(false);
				const playing = { cancel: function () {} };
				current = playing;
				const done = reply.browser ? browser(reply, playing) : audio(reply, playing);
				return done.finally(function () { if (current === playing) current = null; });
			}
			async function speak(input) {
				stop();
				const text = String(input.text || "").trim();
				if (!text) return false;
				const playing = { cancel: function () { playing.stopped = true; } };
				current = playing;
				let reply;
				try {
					reply = await rpc("speechForLine", { speaker: input.speaker || "", text: text, emotion: input.emotion || "neutral", narration: input.narration === true }, input.sessionId);
				} catch (error) {
					if (current === playing) current = null;
					if (!playing.stopped) tavernErrorHub.report("配音", error);
					return false;
				}
				if (playing.stopped || current !== playing) return false;
				return play(reply);
			}
			return { speak: speak, play: play, stop: stop };
		})();

		/** A small speaker button that says one line; a second press stops it. */
		function TavernSpeakButton(props) {
			const h = React.createElement;
			const [playing, setPlaying] = React.useState(false);
			const live = React.useRef(false);
			live.current = playing;
			React.useEffect(function () { return function () { if (live.current) tavernSpeech.stop(); }; }, []);
			return h("button", { type: "button", className: "dsh-tavern-speak" + (playing ? " is-playing" : ""), "aria-label": playing ? "停止朗读" : "朗读这句", title: playing ? "停止朗读" : "朗读这句",
				onClick: function (event) {
					event.stopPropagation();
					if (playing) { tavernSpeech.stop(); setPlaying(false); return; }
					setPlaying(true);
					tavernSpeech.speak({ sessionId: props.sessionId, speaker: props.speaker, text: props.text, emotion: props.emotion }).finally(function () { setPlaying(false); });
				} }, playing ? "■" : "🔊");
		}

		function tavernSpeechDraft(provider) {
			const draft = { voice: provider ? provider.voice || "" : "", narratorVoice: provider ? provider.narratorVoice || "" : "" };
			(provider ? provider.fields : []).forEach(function (field) { draft[field.name] = field.value || ""; });
			return draft;
		}

		function TavernVoiceOptions(props) {
			const voices = props.provider && props.provider.browser ? tavernBrowserVoices().map(function (voice) { return voice.name; }) : (props.provider ? props.provider.voices : []);
			return React.createElement("datalist", { id: props.id }, voices.map(function (voice) { return React.createElement("option", { key: voice, value: voice }); }));
		}

		// Settings → 配音, its own page like 场景生图.
		function TavernSpeechSettings() {
			const h = React.createElement;
			const settings = useTavernSpeechSettings();
			const [chosen, setChosen] = React.useState("");
			const [draft, setDraft] = React.useState({});
			const [apiKey, setApiKey] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [message, setMessage] = React.useState("");
			const [models, setModels] = React.useState([]);
			const providers = settings ? settings.providers : [];
			const provider = providers.find(function (item) { return item.id === chosen; }) || null;
			// The saved channel whose service lists its models (Fish /v1/info) offers them under 模型, for the address as saved;
			// a channel only picked asks nothing until it is saved.
			const discovers = Boolean(provider && provider.discovers && settings.provider === chosen), saved = provider ? JSON.stringify(provider.fields.map(function (item) { return item.value; })) + provider.hasKey : "";
			React.useEffect(function () {
				setModels([]);
				if (!discovers) return;
				let live = true;
				rpc("speechServiceInfo", { provider: chosen }).then(function (info) { if (live) setModels(info.models || []); }, function () {});
				return function () { live = false; };
			}, [chosen, discovers, saved]);
			React.useEffect(function () {
				if (!settings || chosen) return;
				const active = providers.find(function (item) { return item.id === settings.provider; }) || providers[0];
				if (active) { setChosen(active.id); setDraft(tavernSpeechDraft(active)); }
			}, [settings]);
			if (!settings) return h("section", { className: "dsh-tavern-settings-group" }, h("p", { className: "dsh-tavern-settings-desc" }, "正在读取配音设置…"));
			function pick(id) {
				const next = providers.find(function (item) { return item.id === id; });
				setChosen(id); setDraft(tavernSpeechDraft(next)); setApiKey(""); setMessage("");
			}
			async function save(enabled) {
				setBusy(true); setMessage("");
				try {
					const result = await rpc("updateSpeechSettings", { enabled: enabled, provider: chosen, config: draft, apiKey: apiKey || undefined });
					tavernSpeechSettings.set(result);
					setApiKey("");
					window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
					setMessage(result.enabled ? "已保存，使用「" + (provider ? provider.label : chosen) + "」配音" : "已保存，配音已关闭");
					return true;
				} catch (error) { setMessage("保存失败：" + String(error.message || error)); return false; }
				finally { setBusy(false); }
			}
			async function listen() {
				if (!await save(settings.enabled)) return;
				setBusy(true);
				try { await tavernSpeech.play(await rpc("speechTest", { provider: chosen, voice: draft.voice, emotion: "joy" })); }
				catch (error) { setMessage("试听失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			function field(name, label, placeholder, list) {
				return h("label", { key: name }, label,
					h("input", { value: draft[name] || "", placeholder: placeholder || "", list: list, disabled: busy, "aria-label": label,
						onChange: function (event) { const value = event.target.value; setDraft(function (current) { return Object.assign({}, current, { [name]: value }); }); } }));
			}
			function section(title, hint) {
				return h.apply(null, ["section", { className: "dsh-tavern-image-section", "aria-label": title }, h("h4", null, title), hint ? h("p", { className: "dsh-tavern-image-hint" }, hint) : null].concat(Array.prototype.slice.call(arguments, 2)));
			}
			return h("div", { className: "dsh-tavern-settings-group dsh-tavern-speech-settings" },
				h("label", { className: "dsh-tavern-background-task" },
					h("span", null, "开启配音", h("span", { className: "dsh-tavern-settings-desc" }, settings.enabled
						? "台词行和舞台上可以朗读台词，每个人物用自己的声音。"
						: "开启后，台词行和舞台上可以朗读台词。需要先在「舞台设置」打开「对话气泡」或「舞台模式」，后台才会标注说话人。")),
					h("input", { type: "checkbox", role: "switch", "aria-label": "开启配音", checked: settings.enabled, disabled: busy, onChange: function (event) { void save(event.target.checked); } })),
				h("h3", { className: "dsh-tavern-image-settings-title" }, "配音配置（全局共用）"),
				h("div", { className: "dsh-tavern-image-settings" },
					h("p", { className: "dsh-tavern-settings-intro" }, "浏览器朗读不用配置、不花钱；在线配音渠道按字数计费，试听也会产生少量费用。"),
					section("渠道", provider ? provider.description : "",
						h("label", null, "配音渠道",
							h("select", { value: chosen, disabled: busy, "aria-label": "配音渠道", onChange: function (event) { pick(event.target.value); } },
								providers.map(function (item) { return h("option", { key: item.id, value: item.id }, item.label + (item.owner ? "（插件 " + item.owner + "）" : "")); }))),
						provider ? provider.fields.map(function (item) { return field(item.name, item.label, item.placeholder, item.name === "model" && models.length ? "dsh-tavern-speech-models" : undefined); }) : null,
						models.length ? h("datalist", { id: "dsh-tavern-speech-models" }, models.map(function (model) { return h("option", { key: model.id, value: model.id, label: model.label }); })) : null,
						models.length ? h("p", { className: "dsh-tavern-image-hint" }, "服务提供的模型：" + models.map(function (model) { return model.label; }).join("、")) : null,
						provider && provider.key ? h("label", null, (provider.keyLabel || "API Key") + (provider.hasKey ? "（已保存，留空沿用）" : provider.keyOptional ? "（选填）" : ""),
							h("input", { type: "password", value: apiKey, autoComplete: "new-password", disabled: busy, "aria-label": provider.keyLabel || "API Key",
								onChange: function (event) { setApiKey(event.target.value); } })) : null),
					section("声音", "每个人物的声音在「舞台素材」里单独选，没选的用默认声音。",
						field("voice", "默认声音", provider && provider.browser ? "留空用系统默认中文语音" : "", "dsh-tavern-speech-voices"),
						field("narratorVoice", "旁白声音", "留空则旁白不念", "dsh-tavern-speech-voices"),
						h(TavernVoiceOptions, { id: "dsh-tavern-speech-voices", provider: provider })),
					h("div", { className: "dsh-tavern-image-actions" },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void save(settings.enabled); } }, "保存"),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void listen(); } }, "试听"),
						message ? h("span", { role: "status" }, message) : null)));
		}

		/** A character's voice on the channel in use, in the character material list. */
		function TavernCastVoiceField(props) {
			const h = React.createElement;
			const settings = useTavernSpeechSettings();
			const provider = settings && settings.enabled ? settings.providers.find(function (item) { return item.id === settings.provider; }) : null;
			const saved = provider && props.character && props.character.voices ? props.character.voices[provider.id] || "" : "";
			const [value, setValue] = React.useState(saved);
			React.useEffect(function () { setValue(saved); }, [saved, provider && provider.id]);
			if (!provider) return null;
			const listId = "dsh-tavern-cast-voices-" + provider.id.replace(/[^a-z0-9]/gi, "-");
			function commit() { if (value.trim() !== saved) props.onSave(provider.id, value.trim()); }
			return h("span", { className: "dsh-tavern-cast-voice" },
				h("input", { value: value, list: listId, disabled: props.busy, placeholder: provider.voice || "默认声音", "aria-label": props.name + " 的声音",
					onChange: function (event) { setValue(event.target.value); }, onBlur: commit, onKeyDown: function (event) { if (event.key === "Enter") commit(); } }),
				h(TavernVoiceOptions, { id: listId, provider: provider }),
				h(TavernSpeakButton, { sessionId: props.sessionId, speaker: props.name, text: "你好，我是" + props.name + "。", emotion: "neutral" }));
		}
