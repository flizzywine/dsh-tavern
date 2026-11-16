// The story read aloud for plugins (tavernUi apiVersion 9: readingUnits, playReading, …; docs/plugin-api.md). What is read
// is the stage's own reading (story-reading.cjs); a line plays through the one voice player (voicePlayer), with the same
// voice and cache key as the bubbles' own ▶ when it is read by its figure, so a line the bubbles said is not synthesized
// again. Narration (and every line with lines: 'reader') reads in the reading voice: options.voice null = the one 旁白声音
// points at, {figure: {packId, figureId}} a library figure, {browser: voiceId} a system voice (readingVoices lists them).
// @include story-reading.cjs
const tavernReading = (function () {
    const OWNER = "reading";
    // per game: its units by key (with the parsed segment the voice needs) and its bubble config
    const books = new Map(), opened = new Map();
    let entry = null;
    async function configOf(gameId) {
        const data = bubbleStore.get(gameId) || await rpc("getDialogueBubbles", { sessionId: gameId }, gameId);
        return data && data.config || null;
    }
    async function units(gameId) {
        const [result, config] = await Promise.all([rpc("getStoryTranscript", { sessionId: gameId, historyFrom: 0 }, gameId), configOf(gameId)]);
        const list = readingUnits(tavernStoryTranscriptRows(result && result.storyTranscript));
        books.set(gameId, { config, units: new Map(list.map(unit => [unit.key, unit])) });
        return list.map(unit => ({ key: unit.key, row: unit.row, floor: unit.floor, n: unit.n, para: unit.para, kind: unit.kind, text: unit.text,
            speaker: unit.kind === "line" ? bubbleDisplayName(unit.segment, config) || unit.segment.name : "" }));
    }
    // One opening per voice (and per game for its figures), kept while it works.
    function opener(key, open) {
        return () => {
            if (!opened.get(key)) {
                const opening = open();
                opened.set(key, opening);
                opening.catch(() => { if (opened.get(key) === opening) opened.delete(key); });
            }
            return opened.get(key);
        };
    }
    // A unit as the voice player plays it. null: nothing to say (a unit of a reading this page has not listed).
    function speechOf(gameId, key, options = {}) {
        const book = books.get(gameId), unit = book && book.units.get(key);
        if (!unit) return null;
        const config = book.config, common = { owner: OWNER, id: key, volume: options.volume, rate: options.rate };
        if (unit.kind === "line" && options.lines !== "reader" && config) {
            const input = segmentSpeechInput(unit.segment, config);
            if (input) {
                const character = input.general ? null : bubbleCharacter(config, unit.segment);
                const speaker = input.general ? ["general", config.voice.general, unit.segment.name] : [character.alias, character.voiceKey, characterVoiceLanguage(character)];
                const args = input.general ? { general: true } : { alias: character.alias };
                return { descriptor: opener(JSON.stringify(["figure", gameId, args]), () => rpc("openAssetPackVoice", args, gameId)),
                    input: { ...common, text: input.text, mood: input.mood, cacheKey: JSON.stringify([JSON.stringify([gameId, ...speaker, input.text, input.mood]), undefined]) } };
            }
        }
        const text = unit.kind === "line" && unit.segment.thought ? unit.segment.text : unit.text;
        if (!speakableText(text)) return null;
        const voice = options.voice || null, voiceKey = JSON.stringify(["reader", voice]);
        const descriptor = voice && voice.browser !== undefined ? () => ({ available: true, browser: { voice: voice.browser }, language: "zh-CN" })
            : opener(voiceKey, () => rpc("openReadingVoice", voice && voice.figure ? { figure: voice.figure } : {}, gameId));
        return { descriptor, input: { ...common, text, mood: null, cacheKey: JSON.stringify([OWNER, voiceKey, text]) } };
    }
    function current() { const now = voicePlayer.get(); return now && now === entry ? now : null; }
    return Object.freeze({
        units,
        prepare(gameId, key, options) {
            const speech = speechOf(gameId, key, options);
            return speech ? voicePlayer.prefetch(speech.descriptor, speech.input) : Promise.resolve(false);
        },
        // Resolves once the line is over: {ended}, {stopped} (stop, another line, another player), {skipped} (nothing to
        // say) or {error: code}; options.onStart() runs when its sound starts.
        async play(gameId, key, options) {
            const speech = speechOf(gameId, key, options);
            if (!speech) return { skipped: true };
            const started = await voicePlayer.play(speech.descriptor, speech.input);
            const now = voicePlayer.get();
            if (now && now.owner !== OWNER) return { stopped: true };
            if (!started || !now || now.id !== key || !now.audio) return { error: voicePlayer.getError(speech.input) || now && now.error || "voice-unavailable" };
            entry = now;
            if (options && typeof options.onStart === "function") options.onStart();
            return new Promise(resolve => {
                let ended = false;
                const onended = now.audio.onended;
                now.audio.onended = function () { ended = true; if (onended) onended.apply(this, arguments); };
                const off = voicePlayer.subscribe(() => {
                    if (voicePlayer.get() === now) return;
                    off();
                    if (entry === now) entry = null;
                    resolve(ended ? { ended: true } : { stopped: true });
                });
            });
        },
        pause() { const now = current(); if (!now || now.audio.paused) return false; now.audio.pause(); return true; },
        resume() { const now = current(); if (!now) return false; now.audio.play().catch(() => {}); return true; },
        stop() { if (voicePlayer.get()?.owner === OWNER) voicePlayer.stopPlayback(); entry = null; },
        // volume 0..1, rate: for the line being read, at once
        tune(options = {}) {
            const now = current();
            if (!now) return;
            if (options.volume !== undefined) now.audio.volume = options.volume;
            if (options.rate !== undefined) { now.audio.preservesPitch = true; now.audio.playbackRate = options.rate; }
        },
        // The reading voices to choose from: the library's voiced figures (each voice's users) and the system voices.
        async voices() {
            const catalogue = await packTransport.service.listVoiceCatalogue();
            const seen = new Set(), options = [];
            for (const voice of catalogue.voices) for (const user of voice.users || []) {
                const key = JSON.stringify([voice.ref.packId, user.id]);
                if (!voice.ref.packId || seen.has(key)) continue;
                seen.add(key);
                options.push({ key, group: voice.packName || "", name: user.name, value: { figure: { packId: voice.ref.packId, figureId: user.id }, name: user.name } });
            }
            const system = typeof window !== "undefined" && window.speechSynthesis ? await browserSpeechVoiceList(window.speechSynthesis) : [];
            for (const voice of system) options.push({ key: "browser:" + voice.id, group: "系统声音", name: voice.label, value: { browser: voice.id, name: voice.label } });
            return options;
        }
    });
})();
