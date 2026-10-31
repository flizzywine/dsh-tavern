'use strict';

function createStageClientEntry({startLifetime, install, report}) {
    let mounted = null, disposed = false;
    return Object.freeze({
        mount() {
            if (disposed) throw new Error('Stage client host is disposed');
            if (mounted) throw new Error('Stage client is already mounted');
            const token = {};
            mounted = token;
            try {
                const stop = startLifetime(({own}) => {
                    for (const run of install) {
                        if (disposed) throw new Error('Stage client host is disposed');
                        const cleanup = run();
                        if (cleanup) own(cleanup);
                        if (disposed) throw new Error('Stage client host is disposed');
                    }
                });
                token.stop = () => {
                    if (mounted !== token) return;
                    mounted = null;
                    stop();
                };
                return token.stop;
            } catch (error) {
                mounted = null;
                report?.(error);
                throw error;
            }
        },
        dispose() {disposed = true; mounted?.stop();}
    });
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageClientEntry};
