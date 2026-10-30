// Selected, host-authorized raster images only. No URL or file path comes from widget input.
const stageWidgetSettingImages = new Map();
const stageWidgetImageError = code => Object.assign(new Error(code),{code});
function stageWidgetRasterSize(bytes, mime) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
    if (mime==='image/png' && ascii(1,3)==='PNG') return [view.getUint32(16),view.getUint32(20)];
    if (mime==='image/jpeg' && bytes[0]===255 && bytes[1]===216) {
        for(let p=2;p+4<bytes.length;) {
            if(bytes[p++]!==255)break;while(bytes[p]===255)p++;
            const marker=bytes[p++],length=view.getUint16(p);
            if(length<2 || p+length>bytes.length)break;
            if([192,193,194].includes(marker))return [view.getUint16(p+5),view.getUint16(p+3)];
            p+=length;
        }
    }
    if (mime==='image/webp' && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP') {
        const kind=ascii(12,4);
        if(kind==='VP8X')return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
        if(kind==='VP8L' && bytes[20]===47){const bits=view.getUint32(21,true);return [1+(bits&16383),1+((bits>>>14)&16383)];}
        if(kind==='VP8 ')return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
    }
    throw stageWidgetImageError('image-format');
}
async function stageWidgetRasterImage(asset,signal) {
    if (!['image/png','image/jpeg','image/webp'].includes(asset.mime)) throw stageWidgetImageError('image-format');
    if (asset.size>8388608) throw stageWidgetImageError('image-bytes');
    if (!/^\/api\/dsh-asset-library\/v2\/lease\//.test(asset.url)) throw stageWidgetImageError('asset-unavailable');
    const response=await fetch(asset.url,{signal});
    if(!response.ok)throw stageWidgetImageError('asset-unavailable');
    const reader=response.body.getReader(),chunks=[];let length=0;
    try { for (;;) { const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8388608 || length>asset.size)throw stageWidgetImageError('image-bytes');chunks.push(value); } }
    catch(error){await reader.cancel();throw error;}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const [width,height]=stageWidgetRasterSize(bytes,asset.mime);
    if(!width || !height || width>4096 || height>4096 || width*height>16000000)throw stageWidgetImageError('image-pixels');
    const bitmap=await createImageBitmap(new Blob([bytes],{type:asset.mime}));
    try {
        const ratio=Math.min(1,1536/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        for(const quality of [.85,.65,.45]) {const url=canvas.toDataURL('image/webp',quality);if(url.length<=1048576)return {kind:'image',url,identity:asset.identity};}
        throw stageWidgetImageError('image-projection');
    } finally {bitmap.close();}
}
function useWidgetSettingImages(items) {
    const [projection,setProjection]=React.useState({key:'',assets:{}});
    const selected=items.filter(item=>!item.presentation.suspended).map(item=>[item.identity,item.definition.settingAssets || {}]);
    // Renewed authorized leases do not discard an already decoded image of the same content.
    const key=JSON.stringify(selected.map(([identity,assets])=>[identity,Object.entries(assets).map(([field,asset])=>[field,asset?.identity || null])]));
    React.useEffect(()=>{
        let live=true;const held=[];
        const acquire=asset=>{
            if(!asset)return Promise.resolve({asset:null,status:'ready'});
            let entry=stageWidgetSettingImages.get(asset.identity);
            if(!entry){const controller=new AbortController();entry={refs:0,controller,promise:stageWidgetRasterImage(asset,controller.signal).then(asset=>({asset,status:'ready'})).catch(error=>({asset:null,status:['image-format','image-bytes','image-pixels','image-projection','asset-unavailable'].includes(error.code)?error.code:'image-decode'}))};stageWidgetSettingImages.set(asset.identity,entry);}
            entry.refs++;held.push([asset.identity,entry]);return entry.promise;
        };
        Promise.all(selected.map(async([identity,assets])=>[identity,Object.fromEntries(await Promise.all(Object.entries(assets).slice(0,4).map(async([field,asset])=>[field,await acquire(asset)])))])).then(rows=>{if(live)setProjection({key,assets:Object.fromEntries(rows)});});
        return()=>{live=false;for(const [hash,entry] of held)if(--entry.refs===0){entry.controller.abort();stageWidgetSettingImages.delete(hash);}};
    },[key]);
    for(const item of items){
        const results=projection.key===key ? projection.assets[item.identity] || {} : {};
        item.settingAssets={...item.definition.inlineSettingAssets,...Object.fromEntries(Object.entries(results).map(([field,result])=>[field,result.asset]))};
        item.settingsFeedback={...(item.settingsFeedback || item.definition.settingsFeedback)};
        for(const [field,asset] of Object.entries(item.definition.settingAssets || {}))if(asset){
            const status=item.presentation.suspended ? 'suspended' : results[field]?.status || 'loading';
            if(!item.settingAssets[field])item.settings[field]=null;
            item.settingsFeedback[field]={...item.settingsFeedback[field],value:item.settings[field],status};
        }
    }
}
