// Pure replay filter. Positions count paragraphs, not pages or wall-clock time.
function stagePacing(start, entries, looks, units) {
    const light = typeof window === "undefined" && typeof require === "function" ? require("./stage-light.cjs") : { stageLighting, stageApplyLight };
    start = start || {};
    const carried = start.pacing && start.pacing.version === 1 ? start.pacing : null;
    let lighting = light.stageLighting(start.lighting || start.light, looks);
    const state = carried ? { ...carried, recentTracks: [...(carried.recentTracks || [])] } : {
        version: 1, paragraph: 0, scene: start.scene || "", mood: lighting.mood,
        moodSetAt: lighting.mood === "none" ? null : 0, moodChanges: 0, previousMood: null,
        music: start.music || "", musicSetAt: start.music ? 0 : null,
        recentTracks: start.music ? [start.music] : []
    };
    // Missing legacy counters conservatively start dwell at this turn's boundary.
    state.mood = lighting.mood;
    const offset = state.paragraph, filtered = [], dropped = { pacingLight: 0, pacingMusic: 0 };
    let sceneAt = null, moodAt = null, openingAt = null, lastAt = 0;
    for (const original of entries || []) {
        const entry = { ...original }, at = offset + Math.max(0, (entry.at || 1) - 1);
        lastAt = Math.max(lastAt, entry.at || 0);
        if (entry.scene) {
            state.scene = entry.scene; state.moodChanges = 0; state.previousMood = null;
            state.recentTracks = state.music ? [state.music] : [];
            sceneAt = at; openingAt = null;
        }
        if (entry.commands) entry.commands = entry.commands.filter(command => {
            if (command.op !== "light") return true;
            const next = light.stageApplyLight(lighting, command.value, looks);
            if (next.mood === lighting.mood) { lighting = next; return true; }
            // Event moods (look.event, e.g. a time stop) follow the story exactly: entering or leaving one is never
            // dropped and does not touch the scene's mood budget; leaving returns to whatever mood the director names.
            const isEvent = id => (looks || []).some(look => look && look.id === id && look.event === true);
            if (isEvent(next.mood) || isEvent(lighting.mood)) { lighting = next; state.mood = next.mood; return true; }
            const opening = sceneAt === at && openingAt !== at || state.moodSetAt === null && at === 0;
            if (state.moodSetAt !== null && at - state.moodSetAt < 8 || !opening && (state.moodChanges >= 1 || next.mood === state.previousMood)) {
                dropped.pacingLight++; return false;
            }
            state.previousMood = opening ? null : state.mood;
            state.mood = next.mood; state.moodSetAt = at;
            if (opening) openingAt = at;
            else { state.moodChanges++; moodAt = at; }
            lighting = next;
            return true;
        });
        if (Object.prototype.hasOwnProperty.call(entry, "music")) {
            const track = entry.music === "none" ? "" : entry.music;
            if (track !== state.music) {
                const sceneCue = sceneAt === at || !state.scene && at === 0;
                if (!(sceneCue || moodAt === at) || state.musicSetAt !== null && at - state.musicSetAt < 12 || !sceneCue && state.recentTracks.includes(track)) {
                    delete entry.music; dropped.pacingMusic++;
                } else {
                    state.music = track; state.musicSetAt = at;
                    state.recentTracks = state.recentTracks.filter(value => value !== track).concat(track).slice(-2);
                }
            }
        }
        if (entry.scene && state.moodSetAt === null) state.moodSetAt = at;
        filtered.push(entry);
    }
    state.paragraph = offset + Math.max(lastAt, Number.isFinite(units) ? units : 0);
    return { entries: filtered, pacing: state, lighting, music: state.music, stats: { dropped } };
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { stagePacing };
