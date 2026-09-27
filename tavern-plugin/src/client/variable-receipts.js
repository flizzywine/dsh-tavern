// null requests a read-only snapshot; an obsolete receipt cannot roll state back.
// Untouched history remains shared. This function also runs inside script iframes.
function applyTavernVariableReceipt(previous, delta) {
    if (previous && delta && delta.version === 2) {
        if (delta.chatId !== previous.chatId || delta.lifecycleRevision < Number(previous.lifecycleRevision || 0)) return previous;
        if (delta.lifecycleRevision !== Number(previous.lifecycleRevision || 0)) return null;
        if (delta.kind === 'transaction') {
            if (previous.transaction?.eventId !== delta.eventId) return previous;
            if (delta.sequence <= previous.transaction.sequence) return previous;
            if (delta.baseSequence !== previous.transaction.sequence || delta.sequence !== delta.baseSequence + 1) return null;
        } else if (delta.kind === 'committed') {
            if (delta.stateRevision < previous.stateRevision) return previous;
            if (delta.baseRevision !== previous.stateRevision || previous.messagesPending) return null;
        } else if (delta.kind === 'dispatch') {
            if (previous.transaction || delta.baseRevision !== previous.stateRevision || previous.messagesPending) return null;
        } else return null;
        const context = Object.assign({}, previous, delta.header || {}, {
            stateRevision: delta.stateRevision,
            transaction: { eventId: delta.eventId, sequence: delta.kind === 'dispatch' ? 0 : delta.sequence }
        });
        if (delta.kind === 'committed') delete context.transaction;
        const api = applyTavernVariableReceipt.indexApi;
        const length = delta.kind === 'dispatch' ? delta.messageCount : (previous.messages || []).length;
        if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return null;
        const entries = [];
        for (const source of delta.messages || []) {
            const index = source.message_id;
            if (!Number.isInteger(index) || index < 0 || index >= length) return null;
            const message = JSON.parse(JSON.stringify(source));
            // Dispatch used to decorate every floor. A compact floor must keep
            // these aliases too: official MVU compares name with SillyTavern.name2.
            message.mes = message.message;
            message.is_user = message.role === 'user'; message.is_system = message.role === 'system';
            if (!message.name) message.name = message.is_user ? (context.playerName || '你') : (context.characterName || context.character?.name || '角色');
            entries.push([index, message]);
        }
        context.messages = api.update(previous.messages || [], entries, length);
        if (!api.info(context.messages).complete) return null;
        for (const key of ['chatVariables', 'scriptVariables', 'scriptPrompts']) if (Object.hasOwn(delta, key)) context[key] = JSON.parse(JSON.stringify(delta[key]));
        return context;
    }
    if (!previous || !delta || delta.version !== 1) return null;
    if (delta.chatId !== previous.chatId || delta.lifecycleRevision < Number(previous.lifecycleRevision || 0)) return previous;
    if (delta.lifecycleRevision !== Number(previous.lifecycleRevision || 0)) return null;
    if (delta.stateRevision <= Number(previous.stateRevision || 0)) return previous;
    if (delta.baseRevision !== previous.stateRevision) return null;
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    const context = Object.assign({}, previous, { stateRevision: delta.stateRevision });
    if (delta.message) {
        if (!Number.isInteger(delta.messageId) || !previous.messages || !previous.messages[delta.messageId]) return null;

        const message = Object.assign({}, previous.messages[delta.messageId], copy(delta.message));
        // Retain the parent runtime's compatibility aliases without copying history.
        if (Object.prototype.hasOwnProperty.call(message, 'mes')) message.mes = message.message;
        context.messages = applyTavernVariableReceipt.indexApi.update(previous.messages, [[delta.messageId, message]]);
    } else if (delta.chatVariables) context.chatVariables = copy(delta.chatVariables);
    else if (delta.scriptVariables) context.scriptVariables = copy(delta.scriptVariables);
    else return null;
    return context;
}
