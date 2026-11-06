// The first sound of a call: she picks up and says 「喂？」 in her own voice at once, whatever the machine is doing.
//
// The greeting is a fixed line in her voice language, never written by the model, so it can be synthesized ahead of time
// and kept in the voice cache under its voice + text identity (dsh-tavern-tts audio-v2: voice, provider revision, mood, language,
// readings and text). At dial the host only reads that cache: a hit goes to the page with the call and plays the moment she
// picks up; a miss never synthesizes then - the contact is queued, and her greeting is made when the app is idle.
// The model's greeting follows it (the dial cue tells the model she has said it).

// What she says on picking up, by voice language; the caption is always the Chinese 「喂？」.
const SAID = {zh:'喂？', yue:'喂？', ja:'もしもし？', en:'Hello?', ko:'여보세요?'}
const CAPTION = '喂？'

/** Her pick-up line for a voice language (null: none for that language) in her default 差分. */
export function callGreeting(language, mood) {
  const say = SAID[language]
  return say ? {say, sub:CAPTION, mood:mood || 'default'} : null
}

/**
 * Greetings to make in idle time, one at a time. `want({sessionId, contactId, origin})` queues a contact (once);
 * `prepare(entry)` checks her cache and synthesizes the greeting when it is missing. A greeting is made only after the
 * app has been idle (`idle()`: no turn, director, background task, voice or call in flight) for `quietMs`, so it never
 * competes with a story turn's voice or a call; a failed one is dropped until the contact is wanted again.
 */
export function createCallGreetings({idle, prepare, quietMs = 20000, checkMs = 5000, clock = () => Date.now(),
  timer = {set:(fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t }, clear:t => clearTimeout(t)}}) {
  const wanted = new Map()
  let handle = null, quietSince = null, running = false, disposed = false
  function arm() { if (!handle && !running && !disposed && wanted.size) handle = timer.set(check, checkMs) }
  async function check() {
    handle = null
    if (!idle()) quietSince = null
    else if ((quietSince ??= clock()) <= clock() - quietMs) {
      const [key, entry] = wanted.entries().next().value
      wanted.delete(key); running = true
      try { await prepare(entry) } catch { /* dropped until wanted again */ }
      running = false; quietSince = null
    }
    arm()
  }
  return Object.freeze({
    want(entry) {
      if (disposed) return
      const key = JSON.stringify([entry.sessionId, entry.contactId])
      if (!wanted.has(key)) wanted.set(key, entry)
      arm()
    },
    pending: () => [...wanted.values()],
    dispose() { disposed = true; wanted.clear(); if (handle) timer.clear(handle); handle = null },
  })
}
