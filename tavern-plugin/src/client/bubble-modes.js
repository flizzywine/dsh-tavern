// the 「对话气泡」 settings tab in two modes.
// 简单 (default) shows the few choices a newcomer needs; 高级 shows everything as short grouped rows and
// opens anything big (characters, assets, director) in a large centered modal (bubble-modals.js).
// The mode is a machine preference (localStorage), not per card. The tab itself, its save queue and the
// character actions live in bubbles.js (ForkBubbleSettingsTab); it hands them over as `ctx`.

// ---------- Helpers (pure; tests/fork-bubble-modes.test.mjs) ----------
const SETTINGS_MODE_KEY = "fork-bubble-settings-mode";
const settingsMode = (function () {
    const listeners = new Set();
    function get() { try { return localStorage.getItem(SETTINGS_MODE_KEY) === "advanced" ? "advanced" : "simple"; } catch (_) { return "simple"; } }
    return {
        get,
        set(mode) { try { localStorage.setItem(SETTINGS_MODE_KEY, mode === "advanced" ? "advanced" : "simple"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();

// Explicit declarations use short labels and opaque IDs; only existing declarations reserve names.
const EMOTION_LABEL_MAX = 6;
const EMOTION_NOTE_MAX = 60;
function newEmotionId(taken, random) {
    const used = new Set(taken || []);
    const next = random || Math.random;
    for (let i = 0; i < 50; i++) {
        const id = "c" + Math.floor(next() * 60466176).toString(36).padStart(5, "0").slice(-5);
        if (!used.has(id)) return id;
    }
    let n = 1;
    while (used.has("c" + n)) n++;
    return "c" + n;
}
// "" when the label is usable, else what is wrong with it.
function emotionLabelError(label, emotions, editingId) {
    const text = String(label || "").trim();
    const length = Array.from(text).length;
    if (!length) return "请填写名称";
    if (length > EMOTION_LABEL_MAX) return "名称最多 " + EMOTION_LABEL_MAX + " 个字";
    if (/[|｜\[\]@\s]/.test(text)) return "名称不能含空格或 | [ ] @";
    if ((emotions || []).some(item => item.id !== editingId && item.id === text.toLowerCase())) return "不能和差分编号重名";
    if ((emotions || []).some(item => item.id !== editingId && item.label.toLowerCase() === text.toLowerCase())) return "已有同名差分";
    return "";
}
// Add (no id) or edit one emotion → the new list; throws when the label is invalid or the list is full.
function emotionUpsert(emotions, value, random) {
    const list = (emotions || []).map(item => ({ id: item.id, label: item.label, ...(item.words ? {words:item.words} : {}), note: item.note || "" }));
    const error = emotionLabelError(value.label, list, value.id || "");
    if (error) throw new Error(error);
    const item = { id: value.id || "", label: String(value.label).trim(), note: Array.from(String(value.note || "").trim()).slice(0, EMOTION_NOTE_MAX).join("") };
    const index = item.id ? list.findIndex(entry => entry.id === item.id) : -1;
    if (index >= 0) { list[index] = {...list[index], ...item}; return list; }
    if (list.length >= CUSTOM_MOOD_MAX) throw new Error("最多 " + CUSTOM_MOOD_MAX + " 个差分");
    item.id = newEmotionId(list.map(entry => entry.id), random);
    return list.concat([item]);
}
// Characters that have an image (avatar variant or full-size) for this emotion.
function emotionUsers(config, id) {
    return ((config && config.characters) || []).filter(item => item && ((item.moods && item.moods[id]) || (item.full && item.full[id]))).map(characterLabel);
}
// Remove an emotion and the characters' images for it.
function emotionRemove(config, id) {
    const strip = map => { if (!map || !(id in map)) return map; const next = { ...map }; delete next[id]; return next; };
    return { ...config, emotions: customEmotions(config).filter(item => item.id !== id),
        characters: ((config && config.characters) || []).map(item => item && ((item.moods && id in item.moods) || (item.full && id in item.full)) ? { ...item, moods: strip(item.moods), full: strip(item.full) } : item) };
}

// 简单 → 自动演出: one switch for the director (automatic scene changes) and the music together.
function autoStageState(stage) {
    const director = Boolean(stage && stage.director === true), music = Boolean(stage && stage.music === true);
    return { on: director || music, partial: director !== music };
}
function autoStagePatch(on) { return { director: Boolean(on), music: Boolean(on) }; }

// The stage fields the settings panels write. The retired worldview and the derived protagonist are never
// sent back (characters carry offstage now); the old tag filters went with the asset-library sources.
// Sources always go out in the new shape.
function stageOutgoing(stage) {
    const { tags: _tags, musicTags: _musicTags, worldview: _worldview, protagonist: _protagonist, ...saved } = stage || {};
    return saved;
}
// The whole config the settings write: stage plus injection controls (the retired
// preset fields presetId / emotionMode / bilingual never go back; empty = the default template), custom
// emotions as { id, label, note }, and not the host's derived mood list.
function bubbleOutgoing(config) {
    const { moods: _moods, ...next } = config || {};
    if (next.stage) next.stage = stageOutgoing(next.stage);
    const template = next.injection && typeof next.injection.template === "string" ? next.injection.template : "";
    const injection = next.injection || {};
    next.injection = { template, extra: typeof injection.extra === "string" ? injection.extra : "", ...(injection.placement ? { placement: { ...injection.placement } } : {}) };
    if (Array.isArray(next.emotions)) next.emotions = customEmotions(next).map(item => item.note ? item : { id: item.id, label: item.label, ...(item.words ? {words:item.words} : {}) });
    return next;
}
// A config read from an older host: its single protagonist becomes that character's offstage flag.
function bubbleIncoming(config) {
    const input = config || { enabled: false, characters: [] };
    const characters = Array.isArray(input.characters) ? input.characters : [];
    const protagonist = input.stage && typeof input.stage.protagonist === "string" ? input.stage.protagonist : "";
    if (!protagonist || characters.some(item => item && Object.prototype.hasOwnProperty.call(item, "offstage"))) return { ...input, characters };
    return { ...input, characters: characters.map(item => item && item.alias === protagonist ? { ...item, offstage: true } : item) };
}
// What a character still lacks (status dot): a stage portrait and, while voices are on, a voice. Offstage
// characters (usually the player) need neither. An unloaded portrait list never reports a bound portrait as missing.
function characterIssues(character, models, voiceOn) {
    const item = character || {}, issues = [];
    const list = models || [];
    if (item.offstage) return issues;
    if ((!item.portrait || (list.length && !list.some(model => model.id === item.portrait && !model.retired)))) issues.push("立绘");
    if (voiceOn && !item.voice) issues.push("配音");
    return issues;
}
function characterLabel(character) { return character && (character.name || character.alias) || "未命名"; }

// ---------- Components ----------
// the old 简单 / 高级 panels, their rows and switches had no caller and were
// removed; the prompt editor lives in bubble-presets.js, characters and differences in the pack workbench.
