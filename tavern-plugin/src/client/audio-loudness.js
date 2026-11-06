// @include-shared pcm-loudness.cjs

async function measureAudioBufferLoudness(audio) {
  const channels = Array.from({length:audio.numberOfChannels}, (_, i) => audio.getChannelData(i));
  let measured;
  if (audio.duration < 10) measured = measurePcmLoudness(channels, audio.sampleRate);
  else {
    const source = 'const measure = ' + measurePcmLoudness.toString() + ';onmessage = ({data}) => {try {postMessage({value:measure(data.channels,data.rate)})} catch(error) {postMessage({error:error.message})}}';
    const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
    let worker;
    try {
      worker = new Worker(url);
      measured = await new Promise((resolve, reject) => {
        worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.value);
        worker.onerror = () => reject(new Error('音频响度测量失败，请重新添加音频'));
        const copies = channels.map(channel => channel.slice());
        worker.postMessage({channels:copies, rate:audio.sampleRate}, copies.map(channel => channel.buffer));
      });
    } finally { worker?.terminate(); URL.revokeObjectURL(url); }
  }
  return {v:1, lufs:measured.lufs ?? -100, peak:Math.max(-100, measured.truePeak ?? -100)};
}

async function measureBrowserAudio(bytes) {
  const context = new AudioContext();
  try {
    let audio;
    try { audio = await context.decodeAudioData(bytes.slice().buffer); }
    catch { throw new Error('浏览器无法解码此音频，请转换为 WAV 或浏览器支持的音频格式后重试'); }
    return await measureAudioBufferLoudness(audio);
  } finally { await context.close(); }
}
