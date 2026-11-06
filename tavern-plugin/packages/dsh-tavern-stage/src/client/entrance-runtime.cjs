function createStageEntranceRenderer({window,contractFactory,renderer,frames,loop}) {
    let disposed=false;const runs=new Set();
    const supported=()=>!disposed && typeof window.WebGL2RenderingContext!=='undefined';
    function workerSource() {
        return '"use strict";const contract=('+contractFactory.toString()+')();\nconst renderer='+renderer.toString()+
            ';\nconst frames='+frames.toString()+';\nconst loop='+loop.toString()+';\nlet run=null;\nself.onmessage=event=>{const data=event.data;'+
            'if(data.type==="init"){run=loop(contract,renderer,frames,{canvas:data.canvas,doc:data.doc,options:data.options,size:data.size,'+
            'raf:fn=>typeof self.requestAnimationFrame==="function"?self.requestAnimationFrame(fn):setTimeout(()=>fn(performance.now()),16),'+
            'cancel:id=>typeof self.cancelAnimationFrame==="function"?self.cancelAnimationFrame(id):clearTimeout(id),'+
            'post:message=>self.postMessage(message)});}else if(run)run.message(data);};';
    }
    function start(canvas,run,size,onEvent) {
        if(disposed)throw new Error('Entrance renderer disposed');
        let stopped=false,port;
        const post=event=>{if(!stopped&&!disposed)onEvent(event);};
        const offThread=typeof window.Worker==='function' && typeof window.OffscreenCanvas==='function' && typeof canvas.transferControlToOffscreen==='function';
        if(offThread) {
            let worker,url;
            try {
                url=window.URL.createObjectURL(new window.Blob([workerSource()],{type:'text/javascript'}));
                worker=new window.Worker(url);
                const offscreen=canvas.transferControlToOffscreen();
                worker.onmessage=event=>post(event.data);
                worker.onerror=event=>{event.preventDefault?.();post({type:'error',message:event.message||'Entrance worker failed'});};
                worker.postMessage({type:'init',canvas:offscreen,doc:run.doc,options:run.options,size},[offscreen]);
                port={message:data=>worker.postMessage(data),stop(){worker.onmessage=null;worker.onerror=null;worker.terminate();}};
            }catch(error){worker?.terminate();console.warn('Entrance worker unavailable',error);}
            finally{if(url)window.URL.revokeObjectURL(url);}
        }
        if(!port) {
            const local=loop(contractFactory(),renderer,(files,ahead)=>frames(files,ahead,window.createImageBitmap.bind(window)),{
                canvas,doc:run.doc,options:run.options,size,raf:fn=>window.requestAnimationFrame(fn),cancel:id=>window.cancelAnimationFrame(id),post});
            port={message:data=>local.message(data),stop:()=>local.message({type:'stop'})};
        }
        const send=data=>{if(!stopped&&!disposed)port.message(data);};
        const api={input:data=>send({type:'input',...data}),size:size=>send({type:'size',size}),media:files=>send({type:'media',files}),stop(){
            if(stopped)return;stopped=true;runs.delete(api);port.stop();
        }};
        runs.add(api);return api;
    }
    return {supported,start,dispose(){
        if(disposed)return;disposed=true;const errors=[];
        for(const run of [...runs])try{run.stop();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Entrance renderer cleanup failed');
    }};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageEntranceRenderer};
