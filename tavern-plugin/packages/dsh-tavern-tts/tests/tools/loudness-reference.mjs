import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { measureVoiceLoudness } from '../../src/loudness.js'
import { wav } from '../../src/core.js'
const dir = new URL('../fixtures/loudness/', import.meta.url)
const original = readFileSync(new URL('speech-32000-0.wav', dir))
let start
for(let i=12;i+8<=original.length;) { const n=original.readUInt32LE(i+4); if(original.toString('ascii',i,i+4)==='data')start=i+8; i+=8+n+n%2 }
for(const [name,scale] of [['near-clipping',3],['quiet',0.003]]) {
 const b=Buffer.from(original)
 for(let i=start;i+2<=b.length;i+=2)b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(b.readInt16LE(i)*scale))),i)
 writeFileSync(new URL(name+'.wav',dir),b)
}
const rows=[]
for(const file of readdirSync(dir).filter(f=>f.endsWith('.wav'))) {
 const bytes=wav(readFileSync(new URL(file,dir)))
 const result=spawnSync('ffmpeg',['-hide_banner','-nostdin','-i','pipe:0','-af','apad=whole_dur=0.4,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{input:bytes,encoding:'utf8',windowsHide:true,timeout:15000})
 if(result.status!==0)throw new Error(result.stderr || String(result.error))
 const text=result.stderr, ref=JSON.parse(text.slice(text.lastIndexOf('{'),text.lastIndexOf('}')+1)), js=measureVoiceLoudness(bytes)
 rows.push({file,ffmpegI:+ref.input_i,ffmpegTP:+ref.input_tp,jsI:+js.lufs.toFixed(3),jsTP:+js.truePeak.toFixed(3)})
}
writeFileSync(new URL('reference.json',dir),JSON.stringify(rows,null,2)+'\n')
console.table(rows)
const pcm=Buffer.alloc(32000*10*2)
const {pcmWav}=await import('../../src/providers/audio.js')
for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(15000*Math.sin(i*0.1)),i*2)
const clip=pcmWav(pcm,32000)
const t=performance.now();measureVoiceLoudness(clip);console.log('10s 32kHz ms',performance.now()-t)