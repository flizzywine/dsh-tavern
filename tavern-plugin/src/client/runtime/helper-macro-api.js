// Read-only macro emulation. Do not execute write/eval/random macros merely
// because a card asks to format text or inspect a slash-command result.
function installTavernHelperMacroApi({window, context}) {
    function readPath(value, path) {
        const parts = [];
        String(path).replace(/[^.[\]]+|\[(?:(["'])((?:(?!\1)[^\\]|\\.)*)\1|([^\]]+))\]/g,
            function (token, quote, quoted, unquoted) { parts.push(quote ? quoted.replace(/\\([\\"'])/g, '$1') : unquoted === undefined ? token : unquoted); });
        for (const part of parts) {
            if (['__proto__', 'constructor', 'prototype'].includes(part) || value == null || !Object.prototype.hasOwnProperty.call(Object(value), part)) return undefined;
            value = value[part];
        }
        return value;
    }
    function publicValue(value, seen = new WeakSet()) {
        if (!value || typeof value !== 'object') return value;
        if (seen.has(value)) return null;
        seen.add(value);
        const result = Array.isArray(value) ? value.map(item => publicValue(item, seen))
            : Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')).map(([key, item]) => [key, publicValue(item, seen)]));
        seen.delete(value);
        return result;
    }
    function asText(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'object') { try { return JSON.stringify(value); } catch (_) { return ''; } }
        return String(value);
    }
    window.substitudeMacros = function (input, options = {}) {
        const state = context() || {};
        const id = options.message_id === undefined ? window.getCurrentMessageId?.() : options.message_id;
        return String(input ?? '').replace(/{{\s*(user|char|lastMessageId|messageId)\s*}}|<(user|char)>/gi, function (_match, name, legacy) {
            switch ((name || legacy).toLowerCase()) {
                case 'user': return String((typeof state.chatVariables?.playerName === 'string' && state.chatVariables.playerName.trim()) || state.playerName || '你');
                case 'char': return String(options.character_name ?? state.characterName ?? state.character?.name ?? '角色');
                case 'lastmessageid': return String(window.getLastMessageId?.() ?? -1);
                default: return String(id ?? -1);
            }
        }).replace(/{{\s*(getvar|getglobalvar|get_(message|chat|character|global)_variable)\s*::\s*([^{}]*?)\s*}}/gi,
            function (_match, command, scope, path) {
                const type = scope?.toLowerCase() || (command.toLowerCase() === 'getglobalvar' ? 'global' : 'chat');
                const option = type === 'message' ? {type, message_id: id} : {type};
                const table = window.getVariables(option);
                const value = readPath(table, path);
                return asText(scope ? publicValue(value) : value);
            });
    };
    // Correctly spelled convenience alias; the historical public name is kept.
    window.substituteMacros = window.substitudeMacros;
    const helper = window.TavernHelper || (window.TavernHelper = {});
    for (const name of ['substitudeMacros', 'substituteMacros']) Object.defineProperty(helper, name, {
        enumerable: true, configurable: true, get: () => window[name], set: value => {window[name] = value;}
    });
}
