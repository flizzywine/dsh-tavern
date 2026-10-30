import sharp from 'sharp'
import {STAGE_IMAGE_MAX_BYTES} from './media.js'

// Keep this process free of the host's independently versioned sharp/libvips DLLs.
const size = Number(process.argv[2]) || 256
try {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const source=Buffer.concat(chunks)
  if(process.argv[2]==='master') {
    const width=Number(process.argv[3]),height=Number(process.argv[4])
    const input=sharp(source,{limitInputPixels:32*1024**2,sequentialRead:true}),meta=await input.metadata()
    if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||width>meta.width||height>meta.height||meta.pages>1||meta.orientation>1)throw new Error('Unsupported master geometry or orientation')
    const {data,info}=await input.toColourspace('srgb').ensureAlpha().resize({width,height,fit:'fill',withoutEnlargement:true}).raw().toBuffer({resolveWithObject:true})
    const raw={width:info.width,height:info.height,channels:4}
    let png=await sharp(data,{raw}).png().toBuffer()
    const measurements={pngDefaultBytes:png.length,pngOptimized:false}
    if(png.length>STAGE_IMAGE_MAX_BYTES) {
      // Preserve density and pixels rather than lowering quality to pass the byte gate.
      let opaque=true
      for(let i=3;i<data.length;i+=4)if(data[i]!==255){opaque=false;break}
      for(const removeAlpha of opaque?[true,false]:[false])for(const adaptiveFiltering of [true,false]) {
        const candidate=sharp(data,{raw})
        if(removeAlpha)candidate.removeAlpha()
        const optimized=await candidate.png({compressionLevel:9,adaptiveFiltering}).toBuffer()
        if(optimized.length<png.length) {
          png=optimized;measurements.pngOptimized=true
          measurements.pngOptimization={removeAlpha,adaptiveFiltering,compressionLevel:9}
        }
      }
      if(measurements.pngOptimized&&!(await sharp(png).ensureAlpha().raw().toBuffer()).equals(data))throw new Error('Optimized PNG lossless read-back mismatch')
    }
    measurements.pngBytes=png.length
    if(process.argv[5]==='compare') {
      const webp=await sharp(data,{raw}).webp({lossless:true,effort:4}).toBuffer()
      const decode=async bytes=>{const times=[];let decoded;for(let n=0;n<4;n++){const start=performance.now();decoded=await sharp(bytes).ensureAlpha().raw().toBuffer();if(n)times.push(performance.now()-start)}return {ms:times.sort((a,b)=>a-b)[1],decoded}}
      const a=await decode(png),b=await decode(webp)
      Object.assign(measurements,{webpBytes:webp.length,pngDecodeMs:a.ms,webpDecodeMs:b.ms,pngExact:a.decoded.equals(data),webpExact:b.decoded.equals(data),webpSelected:false,gate:'target-phone-not-verified'})
      if(!measurements.pngExact)throw new Error('PNG lossless read-back mismatch')
    }
    process.stdout.write(JSON.stringify({bytes:png.toString('base64'),format:'png',width:info.width,height:info.height,measurements}))
  } else {
    const bytes=await sharp(source,{limitInputPixels:32*1024**2,sequentialRead:true})
      .rotate().toColourspace('srgb').resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).png().toBuffer()
    process.stdout.write(bytes)
  }
} catch (error) {
  process.stderr.write(error.message)
  process.exitCode = 1
}
