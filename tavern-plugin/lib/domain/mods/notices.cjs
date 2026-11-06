'use strict';
function createCapabilityNotices() {
    const sessions = new Set();
    return {
        take(sessionId, consumer, resolution) {
            if (sessions.has(sessionId)) return [];
            const missing = (resolution[consumer] || []).find(row => !row.available && row.onMissing === 'notify');
            if (!missing) return [];
            sessions.add(sessionId);
            return [missing.message];
        },
        dispose(sessionId) { sessions.delete(sessionId); }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createCapabilityNotices};
