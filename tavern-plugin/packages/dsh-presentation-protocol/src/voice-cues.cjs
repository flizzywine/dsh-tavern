// Voice directions (`{…}` cues inside a spoken line) are projections; the story's raw text remains authoritative.
// One authority: the bubble parser (bubble-line.cjs, included in the browser, required in Node) and the voice plugin
// (dsh-tavern-tts, copied into its src/shared by build.mjs) both read these.
const voiceCues = (() => {
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
return { projectVoiceCues, hasLeadingVoiceCue };
})();
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = voiceCues;
