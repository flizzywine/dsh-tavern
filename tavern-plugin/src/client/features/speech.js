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
			function stop(owner) { if (owner && current?.owner !== owner) return; const playing = current; current = null; if (playing) playing.cancel(); }
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
                // The host accepts at most 1000 code points per request. Keep a body in one
                // playback lease so stop/new playback also cancels its remaining requests.
                const parts = input.parts || [{ text: String(input.text || "").trim(), narration: input.narration === true }];
                const lines = parts.filter(part => part.text).flatMap(part =>
                    (input.body ? tavernBodySpeechChunks(part.text) : [part.text]).map(text => ({ text, narration: part.narration })));
                if (!lines.length) return false;
                const playing = { owner: input.owner, cancel: function () {} };
                current = playing;
                let heardAny = false;
                try {
                    for (const line of lines) {
                        const reply = await rpc("speechForLine", { speaker: input.speaker || "", text: line.text, emotion: input.emotion || "neutral", narration: line.narration === true }, input.sessionId);
                        if (current !== playing || !reply) return false;
                        if (reply.skip) { if (reply.reason === "narration") continue; return false; }
                        const heard = await (reply.browser ? browser(reply, playing) : audio(reply, playing));
                        if (!heard || current !== playing) return false;
                        heardAny = true;
                        playing.cancel = function () {};
                    }
                    return heardAny;
                } catch (error) {
                    if (current === playing) tavernErrorHub.report("配音", error);
                    return false;
                } finally {
                    if (current === playing) current = null;
                }
            }
			return { speak: speak, play: play, stop: stop };
		})();

        // Read the prose and bubble captions, with no speaker IDs, voice directions or executable HTML.
        function tavernSpeechPlainText(source) {
            const text = String(source || "")
                .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
            const doc = new DOMParser().parseFromString(text, "text/html");
            doc.querySelectorAll("script,style,template,iframe").forEach(node => node.remove());
            doc.querySelectorAll("br,p,div,li,h1,h2,h3,h4,h5,h6,blockquote").forEach(node => node.append(" "));
            return (doc.body.textContent || "").replace(/[*_~`#>|]/g, "").replace(/\s+/g, " ").trim();
        }
        function tavernBodySpeechParts(source) {
            const parts = [];
            function append(text, narration) {
                text = text.trim();
                if (!text) return;
                const last = parts[parts.length - 1];
                if (last?.narration === narration) last.text += " " + text;
                else parts.push({ text, narration });
            }
            for (const segment of parseBubbles(source, false)) {
                const text = tavernSpeechPlainText(segment.text);
                if (segment.kind === "bubble") { append(text, segment.thought === true); continue; }
                let offset = 0;
                for (const [start, end] of findTavernQuoteRanges(text)) {
                    append(text.slice(offset, start), true);
                    append(text.slice(start, end), false);
                    offset = end;
                }
                append(text.slice(offset), true);
            }
            return parts;
        }
        function tavernBodySpeechChunks(text) {
            const chars = Array.from(text), chunks = [];
            while (chars.length) {
                let end = Math.min(1000, chars.length);
                if (end < chars.length) {
                    for (let i = end - 1; i >= end / 2; i--) {
                        if (/[。！？.!?；;\s]/u.test(chars[i])) { end = i + 1; break; }
                    }
                }
                chunks.push(chars.splice(0, end).join(""));
            }
            return chunks;
        }
        function TavernBodySpeechAction(props) {
            const settings = useTavernSpeechSettings();
            const source = props.useChat(function (snapshot) {
                const node = (snapshot?.legacy?.nodes || []).find(item => item.kind === "assistant" && item.messageId === props.messageId);
                return (node?.blocks || []).filter(block => block.kind === "text").map(block => String(block.text || "")).join("\n");
            });
            const provider = settings?.providers?.find(item => item.id === settings.provider);
            const readNarration = Boolean(provider?.narratorVoice?.trim());
            const parts = React.useMemo(() => tavernBodySpeechParts(source).filter(part => !part.narration || readNarration), [source, readNarration]);
            return settings?.enabled && source ? React.createElement(TavernSpeakButton, { key: JSON.stringify([props.sessionId, props.messageId, source, settings.provider, provider?.voice, provider?.narratorVoice]), sessionId: props.sessionId, parts, body: true, readNarration, disabled: !parts.length }) : null;
        }
        /** A second press stops the current line/body, including synthesis still in flight. */
        function TavernSpeakButton(props) {
            const h = React.createElement;
            const [playing, setPlaying] = React.useState(false);
            const run = React.useRef(null);
            React.useEffect(function () { return function () { if (run.current) { tavernSpeech.stop(run.current); run.current = null; } }; }, []);
            const label = playing ? "停止朗读" : props.body ? props.readNarration ? "朗读正文" : "朗读对白" : "朗读这句";
            return h("button", { type: "button", className: "dsh-tavern-speak" + (playing ? " is-playing" : ""), "aria-label": label, disabled: props.disabled, title: props.disabled ? "本轮没有可朗读的" + (props.readNarration ? "正文" : "对白") : label,
                onClick: function (event) {
                    event.stopPropagation();
                    if (run.current) { tavernSpeech.stop(run.current); run.current = null; setPlaying(false); return; }
                    const token = {};
                    run.current = token;
                    setPlaying(true);
                    tavernSpeech.speak({ sessionId: props.sessionId, speaker: props.speaker, text: props.text, parts: props.parts, emotion: props.emotion, body: props.body, owner: token }).finally(function () {
                        if (run.current === token) { run.current = null; setPlaying(false); }
                    });
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

		// Settings → 配音: dialogue/narration voices and channel settings (service ttsLineSpeechSettings).
		function TavernSpeechSettings() {
			const h = React.createElement;
			const settings = useTavernSpeechSettings();
			const [chosen, setChosen] = React.useState("");
			const [draft, setDraft] = React.useState({});
			const [apiKey, setApiKey] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [message, setMessage] = React.useState("");
			const [listed, setModels] = React.useState([]);
            const [browserVoices, setBrowserVoices] = React.useState(tavernBrowserVoices);
            React.useEffect(() => {
                const synth = window.speechSynthesis;
                const refresh = () => setBrowserVoices(tavernBrowserVoices());
                refresh();
                synth?.addEventListener?.("voiceschanged", refresh);
                return () => synth?.removeEventListener?.("voiceschanged", refresh);
            }, []);
            // Reply reading supports the browser's system voices as well as online/plugin channels.
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
			// Only the channel that listed them shows them, from the very render that switches away.
			const models = discovers ? listed : [];
			React.useEffect(function () {
				if (!settings || chosen) return;
				const active = providers.find(function (item) { return item.id === settings.provider; }) || providers[0];
				if (active) { setChosen(active.id); setDraft(tavernSpeechDraft(active)); }
			}, [settings]);
			if (!settings) return h("section", { className: "dsh-tavern-settings-group" }, h("p", { className: "dsh-tavern-settings-desc" }, "正在读取朗读设置…"));
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
					setMessage(result.enabled ? "已保存，使用「" + (provider ? provider.label : chosen) + "」配音" : "已保存，朗读已关闭");
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
                    name === "voice" ? h(HelpTip, { label: "对白声音说明" }, "正文里的对白使用这个声音。旁白声音留空时只朗读对白。") : null),
					h(InlineField, { value: draft[name] || "", placeholder: placeholder || "", list, disabled: busy, label, hideLabel: true,
                        onCommit: value => setDraft(current => Object.assign({}, current, { [name]: value })) }));
			}
			// the shared switch / inline fields (ui-design §三.4–7) on upstream's own 配音 page.
			const keyLabel = provider && provider.keyLabel || "API Key";
			return h("section", { className: "dsh-tavern-settings-group dsh-tavern-speech-settings" },
				h(TavernSettingRow, { title: "开启朗读", help: "对白和旁白分别使用下方的声音，旁白声音留空时只读对白。正文按对白标记或引号区分对白与旁白，并按原文顺序朗读。舞台自动配音用「语音服务」。在线渠道按字数计费，试听也会产生少量费用。" },
					h(Switch, { label: "开启朗读", checked: settings.enabled, disabled: busy, onChange: value => save(value) })),
				h("div", { className: "dsh-tavern-speech-form" },
					h("div", { className: "dsh-tavern-speech-field" }, h("span", null, "配音渠道",
                        provider && provider.description ? h(HelpTip, { label: "配音渠道说明" }, provider.description) : null),
						h(InlineField, { kind: "menu", value: chosen, disabled: busy, label: "配音渠道", hideLabel: true, onCommit: pick,
                            options: providers.map(item => ({ value: item.id, label: item.label + (item.owner ? "（插件 " + item.owner + "）" : "") })) })),
					provider ? provider.fields.map(function (item) { return field(item.name, item.label, item.placeholder, item.name === "model" && models.length ? "dsh-tavern-speech-models" : undefined); }) : null,
					models.length ? h("datalist", { id: "dsh-tavern-speech-models" }, models.map(function (model) { return h("option", { key: model.id, value: model.id, label: model.label }); })) : null,
					models.length ? h("p", { className: "dsh-tavern-settings-desc" }, "服务提供的模型：" + models.map(function (model) { return model.label; }).join("、")) : null,
					provider && provider.key ? h("div", { className: "dsh-tavern-speech-field" }, h("span", null, keyLabel + (provider.hasKey ? "（已保存，留空沿用）" : provider.keyOptional ? "（选填）" : "")),
						h(InlineField, { secret: true, value: apiKey, disabled: busy, label: keyLabel, hideLabel: true, onCommit: setApiKey })) : null,
					field("voice", "对白声音", provider?.browser ? "留空使用系统默认中文声音" : "", "dsh-tavern-speech-voices"),
					field("narratorVoice", "旁白声音", "留空则旁白不念", "dsh-tavern-speech-voices"),
					h(TavernVoiceOptions, { id: "dsh-tavern-speech-voices", provider: provider?.browser ? { ...provider, voices: browserVoices.map(voice => voice.name) } : provider }),
                    provider?.browser ? h("p", { className: "dsh-tavern-settings-desc" }, "使用浏览器和系统自带的语音，无需 API Key。可用音色取决于当前设备。") : null,
					h("div", { className: "dsh-tavern-speech-actions" },
						h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-speech-save", disabled: busy, onClick: function () { void save(settings.enabled); } }, "保存"),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void listen(); } }, "试听"))),
				message ? h("div", { className: "dsh-tavern-settings-row", role: "status" }, h("span", { className: "dsh-tavern-settings-desc" }, message)) : null);
		}

