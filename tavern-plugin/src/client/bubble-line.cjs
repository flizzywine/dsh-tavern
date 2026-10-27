// Voice directions are projections; the story's raw text remains authoritative.
function projectVoiceCues(text, { cues = false, streaming = false, spoken = value => value } = {}) {
    const source = String(text || "");
    let result = "", start = 0, depth = 0, open = -1;
    for (let i = 0; i < source.length; i++) {
        if (source[i] === "{") {
            if (!depth) { result += spoken(source.slice(start, i).replace(/[{}]/g, "")); open = i; }
            depth++;
        } else if (source[i] === "}" && depth) {
            if (--depth === 0) {
                const cue = source.slice(open + 1, i);
                if (cue.includes("{")) result += spoken(cue.replace(/[{}]/g, ""));
                else if (cues && cue.trim() && [...cue].length <= 80) result += "[" + cue + "]";
                start = i + 1;
            }
        }
    }
    if (depth) {
        if (!streaming) result += spoken(source.slice(open + 1).replace(/[{}]/g, ""));
    } else result += spoken(source.slice(start).replace(/[{}]/g, ""));
    return result;
}
function hasLeadingVoiceCue(text) {
    return /^\s*\{[^{}]{1,80}\}/u.test(text);
}
// Shared by host parsers and the bundled client. Only whole-line code quotes
// are syntax; backticks inside a bracket (including a streaming one) are text.
// Body models also wrap a whole bubble line in Markdown emphasis (`*@bubble…]*`, `…]**`); the
// markers outside the bracket are formatting, not text. Inner thoughts keep their `[*…*]` inside the bracket.
function stripBubbleCodeQuote(line) {
    const opening = /^([\t ]*)(?:`{1,2}|[*_~]{1,3})(?=@bubble(?:-voice)?(?:\s*[:\uff1a]|$))/.exec(line);
    const value = opening ? opening[1] + line.slice(opening[0].length) : line;
    if (!/^[\t ]*@bubble/.test(value)) return line;
    return value.replace(/(\])[\t ]*[`*_~]+[\t ]*(\r?)$/, "$1$2");
}
// A line that still starts with @bubble but does not parse is never shown raw: it degrades to narration of its
// bracketed (or last) field, without the prefix. Empty results are dropped.
function bubbleFallbackText(line) {
    const rest = String(line).replace(/^\s*@bubble(?:-voice)?\s*[:\uff1a]?\s*/, "");
    const bracket = /\[([^\]\n]*)(?:\]([^|\uff5c\[\n]*))?/.exec(rest), fields = rest.split(/[|\uff5c]/);
    const text = bracket ? bracket[1].trim().replace(/^\*([\s\S]*)\*$/, "$1") + (bracket[2] || "") : fields.length > 1 ? fields[fields.length - 1] : "";
    return projectVoiceCues(text).trim();
}

// One tolerant reader for transcript and host/client stage units.
const BUBBLE_LINE = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)\]\s*$/;
const BUBBLE_PARTIAL = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)$/;

// `open`: the bracket has not closed in the text (a live tail, or a reply that ended early). Only `streaming`, the
// caller's real stream state, marks the segment unfinished.
function bubbleSegment(match, streaming, open = streaming) {
    const raw = String(match[4] || "").trim();
    const thought = /^\*[\s\S]*\*$/.test(raw) || (open && raw.startsWith("*"));
    const speech = thought ? raw.replace(/^\*|\*$/g, "") : raw;
    const text = projectVoiceCues(speech, {streaming:Boolean(streaming)});
    return { kind: "bubble", alias: match[1].trim().toLowerCase(), name: match[2].trim(), mood: match[3].trim(), text, ...(text !== speech ? {speech,singleVoiceText:true} : {}), thought: thought, streaming: Boolean(streaming) };
}
// Split prose into Markdown narration and bubble lines.
function parseBubbles(text, streaming, {callSpeaker} = {}) {
    const lines = String(text || "").split("\n");
    const segments = [];
    let buffer = [];
    function flush() { const md = buffer.join("\n"); if (md.trim() !== "") segments.push({ kind: "markdown", text: md }); buffer = []; }
    lines.forEach(function (line, index) {
        const original = line;
        // Calls omit identity; complete the same wire line before the one shared parser reads it.
        if (callSpeaker) line = "@bubble:" + (callSpeaker.handle || "") + "|" + (callSpeaker.name || "") + "|" + line;
        line = stripBubbleCodeQuote(line);
        // A fifth field opts into voice text, even before its closing bracket arrives.
        const voiceLine = /^\s*@bubble-voice/.test(line) || /^\s*@bubble\s*[:：]\s*[^|｜\n]*[|｜][^|｜\n]*[|｜][^|｜\n]*[|｜]\s*\[[^\]\n]*\]\s*[|｜]/.test(line);
        // Body models sometimes close a complete voice field with one more
        // separator (`…|[voice text]|`). There is no sixth field, so it is formatting; it is not the unfinished voice field below.
        const voiced = voiceLine && /^\s*@bubble(?:-voice)?\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[([^\]\n]*)\](?:[|｜]\s*\[([^\]\n]*)\](?:\s*[|｜])?)?\s*$/.exec(line);
        if (voiced) { flush(); const segment = bubbleSegment(voiced, voiced[5] === undefined && streaming && index === lines.length - 1); segment.speech = (voiced[5] === undefined ? voiced[4] : voiced[5]).trim().replace(/^\*([\s\S]*)\*$/, "$1").trim(); segment.singleVoiceText = voiced[5] === undefined; segment.voiced = true; segments.push(segment); return; }
        if (voiceLine) {
            flush();
            // The text shape (`[…]|` with no voice field yet) never decides streaming; only the live
            // tail of a streaming reply is unfinished. A finished reply shows the bubble complete; its empty or unfinished
            // voice field still has no speech (never falls back to the display text).
            const live = Boolean(streaming) && index === lines.length - 1;
            const partial = /^\s*@bubble(?:-voice)?\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[([^\]\n]*)(\])?/.exec(line);
            if (partial) {
                const segment = bubbleSegment(partial, live, !partial[5]); segment.voiced = true;
                const voice = /\]\s*[|｜]\s*\[([^\]\n]*)$/.exec(line);
                segment.speech = live && voice ? voice[1].replace(/^\*/, "") : "";
                segments.push(segment);
            }
            return;
        }
        // Streaming flicker: the live tail is unfinished even when its bracket has closed - a
        // voice field `|[…]` may still follow - so a page reads pending until its line ends (not done, then pending again).
        const full = BUBBLE_LINE.exec(line);
        if (full) { flush(); segments.push(bubbleSegment(full, Boolean(streaming) && index === lines.length - 1, false)); return; }
        // An opening bracket still means an unfinished bracketed line, not bare text.
        const bare = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*([^\[\s][^\n]*)\s*$/.exec(line);
        if (bare) { flush(); segments.push(bubbleSegment(bare, streaming && index === lines.length - 1)); return; }
        // A live tail that is still becoming `@bubble` (`@`, `@bub`) is held too, not shown as narration for a chunk.
        if (streaming && index === lines.length - 1 && (/^\s*@bubble/.test(line) || /^\s*@(?:b(?:u(?:b(?:b(?:l)?)?)?)?)?$/.test(line))) {
            const partial = BUBBLE_PARTIAL.exec(line);
            flush();
            if (partial) segments.push(bubbleSegment(partial, true));
            return;
        }
        if (/^\s*@bubble(?:-voice)?(?:\s*[:\uff1a]|$)/.test(line)) {
            const text = bubbleFallbackText(line);
            if (text) buffer.push(text);
            return;
        }
        buffer.push(original);
    });
    flush();
    return segments;
}

// Streaming speech uses the same bubble projection as the stage, not a second wire format.
function bubbleSpeechCut(text, first) {
    const marks = first ? /[、，,。．！？!?…；;：:～~—]/ : /[。．！？!?…]/;
    const trailing = /[、，,。．！？!?…；;：:～~—」』）)”’"'\s]/;
    let letters = 0, cueDepth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "{") { cueDepth++; continue; }
        if (text[i] === "}" && cueDepth) { cueDepth--; continue; }
        if (cueDepth) continue;
        if (!trailing.test(text[i])) { letters++; continue; }
        if (!marks.test(text[i]) || letters < 2) continue;
        let end = i + 1;
        while (end < text.length && trailing.test(text[end])) end++;
        return end < text.length ? end : 0;
    }
    return 0;
}
function createBubbleStream({ language = "zh" } = {}) {
    let source = "", finished = false;
    const states = [], segments = [];
    function project(final) {
        const events = [];
        const bubbles = parseBubbles(source, !final).filter(row => row.kind === "bubble");
        bubbles.forEach((bubble, index) => {
            const state = states[index] || (states[index] = {sent:0, closed:false});
            if (state.closed || bubble.thought) return;
            const speech = bubble.speech !== undefined ? bubble.speech : language === "zh" ? bubble.text : "";
            let rest = speech.slice(state.sent);
            const piece = (say, part) => {
                const row = {say:say.trim(), sub:null, ...(part ? {part:true} : {})};
                if (!row.say) return;
                segments.push(row); state.last = segments.length - 1;
                events.push({type:"say", index:segments.length - 1, say:row.say, ...(part ? {part:true} : {})});
            };
            for (let cut; (cut = bubbleSpeechCut(rest, !segments.length)) > 0;) {
                piece(rest.slice(0, cut), true); state.sent += cut; rest = rest.slice(cut);
            }
            if (!bubble.streaming) {
                piece(rest, false); state.sent = speech.length; state.closed = true;
                const last = segments[state.last];
                if (last && !last.part) { last.sub = bubble.text; events.push({type:"sub", index:segments.length - 1, sub:bubble.text}); }
            }
        });
        return events;
    }
    return {
        feed(chunk) { if (finished) return []; source += String(chunk); return project(false); },
        finish() { if (finished) return []; finished = true; return project(true); },
        get segments() { return segments.map(row => ({...row})); },
        get count() { return segments.length; }
    };
}

// A figure's vocabulary is local to its alias, never another cast member.
// Local IDs/labels take precedence over colliding engine custom rows.
function figureBubbleMoods(base, emotions) {
    return (emotions === undefined ? base : emotions).filter(row=>row.label!==undefined).map(row=>({...row}));
}

// Exact names win; a shortened label wins over a builtin synonym.
function matchBubbleMood(word, list) {
    const text = String(word || "").trim();
    if (!text) return null;
    const words = group => Array.isArray(group.words) ? group.words : String(group.words || "").split(/\s+/);
    return list.find(group => group.id === text || group.label === text)
        || list.find(group => String(group.label).startsWith(text))
        || list.find(group => words(group).includes(text)) || null;
}
// The same exact resolver is used by host, voice and browser projection.
// A speaker resolves once per character list (a config change replaces the
// list), not on every render: normalizing the whole catalogue per call was a page-turn hot spot.
const bubbleCharacterLists = new WeakMap();
function bubbleCharacter(config, segment) {
    const rows = config?.characters || [];
    if (!rows.length) return null;
    let resolved = bubbleCharacterLists.get(rows);
    if (!resolved) bubbleCharacterLists.set(rows, resolved = new Map());
    const key = typeof segment === 'string' ? '\u0000' + segment : JSON.stringify([segment?.alias ?? null, segment?.name ?? null]);
    if (resolved.has(key)) return resolved.get(key);
    const resolver = typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
    const result = resolver.resolveFigureName(rows.map(row => ({...row,actorKey:row.alias})),segment);
    const row = result.status === 'resolved' ? rows.find(row => row.alias === result.actorKey) : null;
    resolved.set(key, row);
    return row;
}
// A stage actor (the scene's figures) keeps its carried key after a chat copy or
// a pack merge, so its key need not be its card character's alias; it then names that character through its figure ref, with
// the same canonical resolver. Everything the card character owns (形象色, a skin's cast art) is read through this.
const stageActorCharacterLists = new WeakMap();
function stageActorCharacter(config, figures, alias) {
    const direct = bubbleCharacter(config, alias);
    const figure = direct || !alias ? null : (figures || []).find(row => row.alias === alias);
    const rows = config?.characters || [];
    if (!figure?.ref?.figureId || !rows.length) return direct;
    let resolved = stageActorCharacterLists.get(rows);
    if (!resolved) stageActorCharacterLists.set(rows, resolved = new Map());
    const key = figure.ref.packId + '\u0000' + figure.ref.figureId;
    if (resolved.has(key)) return resolved.get(key);
    const resolver = typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
    const result = resolver.resolveFigureName(rows.map(row => ({...row,actorKey:row.alias})),figure.ref);
    const row = result.status === 'resolved' ? rows.find(row => row.alias === result.actorKey) || null : null;
    resolved.set(key, row);
    return row;
}
function bubbleDisplayName(segment, config) {
    const character = bubbleCharacter(config,segment);
    return String(character?.name || segment?.name || "").trim();
}
// The one rule for a character's 配音语言 (a BCP 47 tag). The story is written in Chinese;
// there is no 正文语言 setting. A voice language that is Chinese (or unset) speaks the line's one text field as written;
// any other language makes the story model write two fields for that character: Chinese display text + voice text in
// that language. The 配音语言 picker, the dialogue format, stage/chat voice and the phone call all read these functions.
// effectiveVoiceLanguage: what the picker shows and the voice speaks — the stored choice, else the fallback (the voice's
// declared language), else 中文. Picking the language equal to effectiveVoiceLanguage('', fallback) stores unset, so
// "unset" and "the default" are one state.
function effectiveVoiceLanguage(stored, fallback) {
    return String(stored || fallback || '').trim() || 'zh';
}
// Whether a voice language needs its own voice text: its primary subtag is not 'zh' (zh-CN, zh-TW are Chinese).
function voiceTranslates(language) {
    const primary = String(language || '').split('-')[0].toLowerCase();
    return primary !== '' && primary !== 'zh';
}
function characterVoiceLanguage(character) {
    return effectiveVoiceLanguage(character?.voiceLanguage || character?.voiceLang);
}
// Shared by playback and export; missing voice text uses the display text with the same bound voice.
// An explicitly empty/incomplete voice field stays silent; identity/mood resolution stays with the caller.
function packSpeechInput(segment, config, character, mood) {
    if (segment.kind !== 'bubble' || segment.streaming || !character?.voice) return null;
    const text = segment.speech ?? segment.text;
    if (!text || !/[\p{L}\p{N}]/u.test(text) || text.length > 1500) return null;
    return {text, mood:mood?.id || character.defaultEmotion || null};
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { bubbleSpeechCut, createBubbleStream, projectVoiceCues, hasLeadingVoiceCue, stripBubbleCodeQuote, parseBubbles, matchBubbleMood, bubbleDisplayName, figureBubbleMoods, bubbleCharacter, stageActorCharacter, effectiveVoiceLanguage, voiceTranslates, characterVoiceLanguage, packSpeechInput };
