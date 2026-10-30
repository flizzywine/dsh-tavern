// Generated existing mood resolver by build.mjs; do not edit.
function matchBubbleMood(word, list) {
    const text = String(word || "").trim();
    if (!text) return null;
    const words = group => Array.isArray(group.words) ? group.words : String(group.words || "").split(/\s+/);
    return list.find(group => group.id === text || group.label === text)
        || list.find(group => String(group.label).startsWith(text))
        || list.find(group => words(group).includes(text)) || null;
}
module.exports = {matchBubbleMood};
