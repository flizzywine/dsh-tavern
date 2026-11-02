// the audio of one synthesis while its provider still streams it.
// Providers hand over 16-bit mono PCM as it is decoded; every reader gets the whole line from its start, as a WAV of
// unknown length. The samples are widened to 32-bit float on the way out: Chromium starts a progressive WAV once it has
// read about 256 KB, which float mono reaches after ~1.4 s of audio (16-bit would wait ~2.8 s) and which keeps a player
// ahead of Drama 3's 0.74 s decode windows at RTF up to about 0.9 (measured 2026-10-24, Chromium 145).
export function createLiveAudio({sampleRate = 44100} = {}) {
  const chunks = []
  let carry = null, ended = false, failure = null, wake = null
  const changed = () => { const fn = wake; wake = null; fn?.() }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(0xFFFFFFFF, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28)
  header.writeUInt16LE(4, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(0xFFFFFFFF - 36, 40)
  return {
    push(pcm) {
      // HTTP chunks need not end on a sample.
      const bytes = carry ? Buffer.concat([carry, pcm]) : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), whole = bytes.length & ~1
      carry = whole < bytes.length ? Buffer.from(bytes.subarray(whole)) : null
      if (!whole) return
      const out = Buffer.alloc(whole * 2)
      for (let i = 0; i < whole; i += 2) out.writeFloatLE(bytes.readInt16LE(i) / 32768, i * 2)
      chunks.push(out); changed()
    },
    end() { ended = true; changed() },
    fail(error) { failure = error; changed() },
    stream() {
      let next = -1
      return new ReadableStream({
        async pull(controller) {
          if (next < 0) { next = 0; controller.enqueue(new Uint8Array(header)); return }
          while (next >= chunks.length && !ended && !failure) await new Promise(resolve => { const previous = wake; wake = () => { previous?.(); resolve() } })
          if (next < chunks.length) controller.enqueue(new Uint8Array(chunks[next++]))
          else if (failure) controller.error(failure)
          else controller.close()
        },
      })
    },
  }
}
