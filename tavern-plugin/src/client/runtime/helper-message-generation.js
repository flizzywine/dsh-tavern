// Message frames never decide which floor owns generation-time scene state.
// The host chooses a live floor and asks it to flush before submitting a turn.
function installTavernMessageGenerationBridge({ window: w, token }) {
    w.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== w.parent || data?.token !== token || data.type !== 'dsh-tavern-frame-before-generate') return;
        const reply = result => w.parent.postMessage({ type: 'dsh-tavern-frame-before-generate-done', token, requestId: data.requestId, ...result }, '*');
        Promise.resolve().then(() => w.__dshFlushBeforeGenerate()).then(
            () => reply({ ok: true }),
            error => reply({ ok: false, error: String(error?.message || error) })
        );
    });
}
