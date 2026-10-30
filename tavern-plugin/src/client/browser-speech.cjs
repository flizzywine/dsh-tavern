// the browser's own speech
// synthesis (Web Speech) as a voice provider. It yields no audio data — a line is an utterance spoken by the system — so it
// never reaches the WebAudio mixer: no loudness levelling, no ducking of the voice itself, no low-pass, no analyser. Its
// volume is the utterance volume (master × voice, read when the line starts), and a playing line still ducks the other
// buses. A clip is an Audio-like object the stage voice player drives like an <audio> element.
function browserSpeechVoices(synth) {
    let list = [];
    try { list = synth ? synth.getVoices() || [] : []; } catch (_) { list = []; }
    return list.map(voice => ({ id: voice.name, label: voice.name, languages: voice.lang ? [voice.lang] : [], local: voice.localService !== false, default: voice.default === true }));
}
// The system voices, waiting briefly for a browser that loads them late ('voiceschanged').
function browserSpeechVoiceList(synth, wait = 1500) {
    const now = browserSpeechVoices(synth);
    if (now.length || !synth || typeof synth.addEventListener !== 'function') return Promise.resolve(now);
    return new Promise(resolve => {
        const done = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', done); resolve(browserSpeechVoices(synth)); };
        const timer = setTimeout(done, wait);
        synth.addEventListener('voiceschanged', done);
    });
}
// The named system voice, else (no name, or a machine without it) the first voice of the line's language.
function browserSpeechVoice(synth, name, language) {
    let list = [];
    try { list = synth ? synth.getVoices() || [] : []; } catch (_) { list = []; }
    const primary = String(language || '').toLowerCase().split('-')[0];
    return (name && list.find(voice => voice.name === name)) || (primary && list.find(voice => String(voice.lang).toLowerCase().split(/[-_]/)[0] === primary)) || null;
}
// One utterance plays at a time machine-wide; the clip that speaks owns the synthesizer.
let browserSpeechOwner = null;
/**
 * @param {{text:string, voice?:string, language?:string, rate?:number, pitch?:number}} line
 * @param {{synth, Utterance, level?:() => number, subscribeAudio?:(fn:(on:boolean) => void) => () => void, now?:() => number}} env
 */
function createBrowserSpeechClip(line, { synth, Utterance, level = () => 1, subscribeAudio = null, now = Date.now }) {
    let utterance = null, offAudio = null, started = 0;
    const clip = {
        browserSpeech: true, text: line.text, src: '', preload: 'auto', paused: true, ended: false, volume: 1, playbackRate: 1, preservesPitch: true,
        duration: NaN, onplay: null, onpause: null, onended: null,
        get currentTime() { return started && !clip.paused ? (now() - started) / 1000 : 0; },
        set currentTime(_value) {},
        load() {},
        play() {
            if (!synth || typeof Utterance !== 'function') return Promise.reject(Object.assign(new Error('浏览器不支持朗读'), { code: 'BROWSER_SPEECH_UNAVAILABLE' }));
            const previous = browserSpeechOwner;
            if (previous && previous !== clip) previous.interrupt();
            stop();
            const next = new Utterance(line.text), voice = browserSpeechVoice(synth, line.voice, line.language);
            if (voice) { next.voice = voice; next.lang = voice.lang; } else if (line.language) next.lang = line.language;
            next.volume = Math.max(0, Math.min(1, clip.volume * level()));
            next.rate = Math.max(0.1, Math.min(10, (Number(line.rate) || 1) * (Number(clip.playbackRate) || 1)));
            if (Number.isFinite(line.pitch)) next.pitch = Math.max(0, Math.min(2, line.pitch));
            const mine = () => utterance === next;
            next.onend = () => { if (!mine()) return; finish(); clip.ended = true; clip.onended?.(); };
            next.onerror = () => { if (!mine()) return; finish(); clip.onpause?.(); };
            utterance = next; browserSpeechOwner = clip; clip.paused = false; clip.ended = false; started = now();
            // The app in the background pauses the line (foreground.js); back in front it goes on.
            if (subscribeAudio) offAudio = subscribeAudio(on => { if (!mine()) return; if (on) synth.resume(); else synth.pause(); });
            try { synth.cancel(); synth.speak(next); } catch (error) { finish(); return Promise.reject(error); }
            clip.onplay?.();
            return Promise.resolve();
        },
        pause() { if (clip.paused) return; stop(); clip.onpause?.(); },
        // Another clip took the synthesizer: this one stops without cancelling the new line.
        interrupt() { if (clip.paused) return; finish(); clip.onpause?.(); }
    };
    function finish() {
        utterance = null; clip.paused = true; started = 0;
        if (offAudio) { const off = offAudio; offAudio = null; off(); }
        if (browserSpeechOwner === clip) browserSpeechOwner = null;
    }
    function stop() {
        const speaking = utterance && browserSpeechOwner === clip;
        finish();
        if (speaking) { try { synth.cancel(); } catch (_) {} }
    }
    return clip;
}
// The app's clip: master × voice volume (a preview: master only), paused while the app is in the background.
function browserSpeechClip(line, preview = false) {
    return createBrowserSpeechClip(line, { synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance,
        level: () => forkStageAudio.speechVolume(preview), subscribeAudio: typeof forkForeground === 'undefined' ? null : forkForeground.subscribeAudio });
}
// A speaking browser clip has no samples to analyse; the mouth follows a gentle syllable rhythm while it speaks.
function browserSpeechMouth(clip, now = Date.now) {
    if (!clip || !clip.browserSpeech || clip.paused) return 0;
    const t = now() / 1000;
    return Math.max(0, 0.3 + 0.4 * Math.abs(Math.sin(t * 11)) * (0.6 + 0.4 * Math.sin(t * 2.3)));
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { browserSpeechVoices, browserSpeechVoiceList, browserSpeechVoice, createBrowserSpeechClip, browserSpeechMouth };
