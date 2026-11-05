		// 台词朗读 (the 🔊 on a reply and plugins' speak()): the host resolves each line in its voice (speechForLine: a voice-service
		// audio URL or a browser system voice) and the one stage voice player (voice.js voicePlayer) plays it, so it follows the
		// master/voice volume and ducking, and any newer line — a bubble's voice too — stops the one being said.
		// speak resolves true when it was heard to the end.
		const tavernSpeech = (function () {
			const OWNER = "tavern-speech";
			let current = null;
			function stop(owner) {
				if (!current || owner && current.owner !== owner) return;
				const lease = current; current = null; lease.cancelled = true;
				if (voicePlayer.get()?.owner === OWNER) voicePlayer.stopPlayback();
			}
			// One clip through the player: true when it ended on its own, false when stopped, replaced or unplayable.
			function playClip(lease, descriptor, input) {
				return new Promise(function (resolve) {
					let entry = null, ended = false, off = null;
					const finish = function (heard) { off?.(); off = null; resolve(heard); };
					const check = function () { if (entry && (voicePlayer.get() !== entry || lease.cancelled)) finish(ended && !lease.cancelled); };
					off = voicePlayer.subscribe(check);
					voicePlayer.play(descriptor, input).then(function (started) {
						const now = voicePlayer.get();
						if (!started || lease.cancelled || now?.owner !== OWNER || now.id !== input.id) { finish(false); return; }
						entry = now;
						const onended = entry.audio.onended;
						entry.audio.onended = function () { ended = true; onended?.(); };
					});
				});
			}
			async function speak(input) {
				stop();
				// The host accepts at most 1000 code points per request; a body is split, and its parts share one lease so a stop
				// also cancels the lines still to be requested.
				const parts = input.parts || [{ text: String(input.text || "").trim(), narration: input.narration === true }];
				const lines = parts.filter(part => part.text).flatMap(part =>
					(input.body ? tavernBodySpeechChunks(part.text) : [part.text]).map(text => ({ text, narration: part.narration })));
				if (!lines.length) return false;
				const lease = { owner: input.owner, cancelled: false };
				current = lease;
				let heardAny = false;
				try {
					for (const [index, line] of lines.entries()) {
						const reply = await rpc("speechForLine", { speaker: input.speaker || "", text: line.text, emotion: input.emotion || "neutral", narration: line.narration === true }, input.sessionId);
						if (lease.cancelled || !reply) return false;
						// Narration stays silent while the narrator is off; the dialogue goes on.
						if (reply.skip) { if (reply.reason === "narration" || reply.reason === "empty") continue; return false; }
						const text = reply.text || line.text;
						const descriptor = reply.browser ? { available: true, browser: { voice: reply.voice || "" }, language: "zh-CN" } : { available: true, url: reply.url, loudness: reply.loudness };
						const heard = await playClip(lease, descriptor, { owner: OWNER, id: String(index), text, mood: input.emotion || "neutral",
							cacheKey: JSON.stringify([OWNER, reply.browser ? "browser:" + (reply.voice || "") : reply.url, text]) });
						if (!heard) return false;
						heardAny = true;
					}
					return heardAny;
				} catch (error) {
					if (!lease.cancelled) tavernErrorHub.report("配音", error);
					return false;
				} finally {
					if (current === lease) current = null;
				}
			}
			return { speak: speak, stop: stop };
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
        function tavernReplyBody(node) {
            return (node?.blocks || []).filter(block => block.kind === "text").map(block => String(block.text || "")).join("\n");
        }
        function TavernBodySpeechAction(props) {
            const available = usePackRevision(ttsClientAvailable);
            const source = props.useChat(function (snapshot) {
                return tavernReplyBody((snapshot?.legacy?.nodes || []).find(item => item.kind === "assistant" && item.messageId === props.messageId));
            });
            const parts = React.useMemo(() => tavernBodySpeechParts(source), [source]);
            return available && source ? React.createElement(TavernSpeakButton, { key: JSON.stringify([props.sessionId, props.messageId, source]), sessionId: props.sessionId, parts, body: true, disabled: !parts.length }) : null;
        }
        /** A second press stops the current line/body, including synthesis still in flight. */
        function TavernSpeakButton(props) {
            const h = React.createElement;
            const [playing, setPlaying] = React.useState(false);
            const run = React.useRef(null);
            React.useEffect(function () { return function () { if (run.current) { tavernSpeech.stop(run.current); run.current = null; } }; }, []);
            const shown = playing;
            const label = shown ? "停止朗读" : props.body ? "朗读正文" : "朗读这句";
            return h("button", { type: "button", className: "dsh-tavern-speak" + (shown ? " is-playing" : ""), "aria-label": label, disabled: props.disabled, title: props.disabled ? "本轮没有可朗读的正文" : label,
                onClick: function (event) {
                    event.stopPropagation();
                    if (run.current) { tavernSpeech.stop(run.current); run.current = null; setPlaying(false); return; }
                    const token = {};
                    run.current = token;
                    setPlaying(true);
                    tavernSpeech.speak({ sessionId: props.sessionId, speaker: props.speaker, text: props.text, parts: props.parts, emotion: props.emotion, body: props.body, owner: token }).finally(function () {
                        if (run.current === token) { run.current = null; setPlaying(false); }
                    });
                } }, shown ? "■" : "🔊");
        }
