		// Voiced dialogue (Wiki「设计：cast-presentation」): the voicing settings, a player that
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
					// the line pauses while DSH Tavern is not in front (foreground.js).
					let off = null, offVolume = null, finished = false, started = false;
					const syncVolume = function () { utterance.volume = forkStageAudio.speechVolume(reply.preview); };
					const sounding = function (on) { forkStageAudio.voiceActivity(playing, on && started && !finished && !reply.preview); };
					const done = function (heard) {
						if (finished) return;
						finished = true; sounding(false);
						if (off) off(); if (offVolume) offVolume(); resolve(heard);
					};
					syncVolume(); offVolume = forkStageAudio.subscribe(syncVolume);
					utterance.onstart = function () { started = true; sounding(forkForeground.isAudible()); };
					utterance.onpause = function () { sounding(false); };
					utterance.onresume = function () { sounding(forkForeground.isAudible()); };
					utterance.onend = function () { done(true); };
					utterance.onerror = function () { done(false); };
					playing.cancel = function () { synth.cancel(); done(false); };
					synth.cancel();
					off = forkForeground.subscribeAudio(function (on) { if (on) synth.resume(); else synth.pause(); sounding(on); });
					try { synth.speak(utterance); } catch (_) { done(false); }
				});
			}
			function audio(reply, playing) {
				return new Promise(function (resolve) {
					const element = new Audio(reply.url);
					if (reply.preview) forkStageAudio.preview(element, reply.loudness);
                    else forkStageAudio.prepareVoice(element, null, reply.loudness);
					let finished = false;
					const done = function (heard) {
						if (finished) return;
						finished = true; forkStageAudio.voiceActivity(playing, false);
						forkStageAudio.release(element); resolve(heard);
					};
					element.onplaying = function () { if (!finished && !reply.preview) forkStageAudio.voiceActivity(playing, true); };
					element.onpause = element.onwaiting = function () { forkStageAudio.voiceActivity(playing, false); };
					element.onended = function () { done(true); };
					element.onerror = function () { done(false); };
					playing.cancel = function () { element.pause(); done(false); };
					element.play().catch(function () { done(false); });
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
			const voices = props.provider ? props.provider.voices : [];
			return React.createElement("datalist", { id: props.id }, voices.map(function (voice) { return React.createElement("option", { key: voice, value: voice }); }));
		}

		// Settings → 配音 › 台词朗读:, a section of the dsh-tts 配音 page (service ttsLineSpeechSettings).
		function TavernSpeechSettings() {
			const h = React.createElement;
			const settings = useTavernSpeechSettings();
			const [chosen, setChosen] = React.useState("");
			const [draft, setDraft] = React.useState({});
			const [apiKey, setApiKey] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [message, setMessage] = React.useState("");
			// browser speech is one provider of the page's 「语音服务」,
			// not a second channel here; this section lists the online and plugin channels only.
			const providers = settings ? settings.providers.filter(function (item) { return !item.browser; }) : [];
			const provider = providers.find(function (item) { return item.id === chosen; }) || null;
			React.useEffect(function () {
				if (!settings || chosen) return;
				const active = providers.find(function (item) { return item.id === settings.provider; }) || providers[0];
				if (active) { setChosen(active.id); setDraft(tavernSpeechDraft(active)); }
			}, [settings]);
			if (!settings) return h("section", { className: "dsh-tavern-settings-group" }, h("p", { className: "dsh-tavern-settings-desc" }, "正在读取台词朗读设置…"));
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
					setMessage(result.enabled ? "已保存，使用「" + (provider ? provider.label : chosen) + "」配音" : "已保存，台词朗读已关闭");
					return true;
				} catch (error) { setMessage("保存失败：" + String(error.message || error)); return false; }
				finally { setBusy(false); }
			}
			async function listen() {
				if (!await save(settings.enabled)) return;
				setBusy(true);
				try { await tavernSpeech.play({ ...await rpc("speechTest", { provider: chosen, voice: draft.voice, emotion: "joy" }), preview: true }); }
				catch (error) { setMessage("试听失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			function field(name, label, placeholder, list) {
				return h("div", { key: name, className: "dsh-tavern-speech-field" }, h("span", null, label,
                    name === "voice" ? h(HelpTip, { label: "默认声音说明" }, "每个人物的声音在酒馆状态 → 舞台 →「角色素材」里单独选，没选的用默认声音。") : null),
					h(InlineField, { value: draft[name] || "", placeholder: placeholder || "", list, disabled: busy, label, hideLabel: true,
                        onCommit: value => setDraft(current => Object.assign({}, current, { [name]: value })) }));
			}
			// the shared switch / inline fields (ui-design §三.4–7) on upstream's own 配音 page.
			const keyLabel = provider && provider.keyLabel || "API Key";
			return h("section", { className: "dsh-tavern-settings-group dsh-tavern-speech-settings" },
				h(TavernSettingRow, { title: "开启台词朗读", help: "台词行旁的 🔊 按钮和插件的朗读接口用这里的渠道与声音；舞台自动配音用上面的「语音服务」（免费的浏览器朗读也在那里）。在线渠道按字数计费，试听也会产生少量费用。" },
					h(Switch, { label: "开启台词朗读", checked: settings.enabled, disabled: busy, onChange: value => save(value) })),
				h("div", { className: "dsh-tavern-speech-form" },
					h("div", { className: "dsh-tavern-speech-field" }, h("span", null, "配音渠道",
                        provider && provider.description ? h(HelpTip, { label: "配音渠道说明" }, provider.description) : null),
						h(InlineField, { kind: "menu", value: chosen, disabled: busy, label: "配音渠道", hideLabel: true, onCommit: pick,
                            options: providers.map(item => ({ value: item.id, label: item.label + (item.owner ? "（插件 " + item.owner + "）" : "") })) })),
					provider ? provider.fields.map(function (item) { return field(item.name, item.label, item.placeholder); }) : null,
					provider && provider.key ? h("div", { className: "dsh-tavern-speech-field" }, h("span", null, keyLabel + (provider.hasKey ? "（已保存，留空沿用）" : "")),
						h(InlineField, { secret: true, value: apiKey, disabled: busy, label: keyLabel, hideLabel: true, onCommit: setApiKey })) : null,
					field("voice", "默认声音", "", "dsh-tavern-speech-voices"),
					field("narratorVoice", "旁白声音", "留空则旁白不念", "dsh-tavern-speech-voices"),
					h(TavernVoiceOptions, { id: "dsh-tavern-speech-voices", provider: provider }),
					h("div", { className: "dsh-tavern-speech-actions" },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void save(settings.enabled); } }, "保存"),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void listen(); } }, "试听"))),
				message ? h("div", { className: "dsh-tavern-settings-row", role: "status" }, h("span", { className: "dsh-tavern-settings-desc" }, message)) : null);
		}

