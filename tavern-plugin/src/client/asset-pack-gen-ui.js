  // In-app asset generation. A picture is made where it goes: a 差分 tile (编辑's grid, 生图's wall) opens the
  // ONE generation dialog (GenDialog), and the request then runs in the tile itself (a ring and the time, 排队, 待采用, ⚠).
  // The batch buttons send one request per missing 差分 with its default prompt and no dialog. Generation draws from the
  // 设定图 or the 设定文字 (外貌 + 服装描述), never from 平和 (平和 only stays the ruler an adopted 立绘 is aligned to). Nothing loops,
  // retries or refills in the background, and nothing here talks about money. The pack modal owns one controller
  // (useAssetGen); nothing is read from the backend until a 生图 surface opens.
  const GEN_POLL_MS=1500,GEN_PARALLEL=4,GEN_REF_LIMIT=4,GEN_REF_BYTES=8*1024*1024;
  // ⚠ chips: a short label per deterministic check; the backend sentence is the tooltip.
  const GEN_WARNINGS={NO_TRANSPARENCY:'没有透明背景',EDGE_CONTACT:'人物碰到边缘',CELL_EDGE_CONTACT:'碰到格子边缘',ASPECT_MISMATCH:'比例不对',LOW_RESOLUTION:'分辨率偏低',
    EMPTY_IMAGE:'图是空的',CHECK_UNAVAILABLE:'无法自动检查',SHEET_UNSLICEABLE:'不能自动切分'};
  // The host has no API that opens a settings section, so the way there is written out once.
  // Pictures come from the 配图 plugin's channel; the server's message names what to change there.
  const GEN_PROBLEMS={UNSUPPORTED_CHANNEL:'当前生图渠道不能生成这张素材 · 设置 → 配图',NOT_CONFIGURED:'还没配置生图渠道 · 设置 → 配图'};
  // An earlier request of the same slot never answered: the next one asks first (the backend's confirmNewRequestIds gate).
  const GEN_UNCERTAIN='上一次请求没有返回结果，不会自动重试。仍要再生成一张吗？';
  const GEN_POSE_ROLE='User pose reference: borrow only the pose and expression idea, never the face or outfit';
  const GEN_ART_ROLE='User artwork of this character: authority for identity, outfit and style';
  const GEN_CURRENT_ROLE='Current picture of this slot: may keep its composition and pose; the settei stays the authority for identity and outfit';
  const GEN_BASE_ROLE='Base image to edit: keep identity, outfit, pose, framing and background exactly; change only what the user notes ask for';
  const GEN_REASONS={layered:'这个差分是动态立绘：在它格子的菜单里选「重画…」',avatar:'先有这个差分的立绘，才能生成它的头像',
    sheet:'先有首个差分立绘或设定图，才能一次生成八个头像',avatars:'缺头像的差分还没有立绘：先有立绘，才能生成头像',basis:'还没有设定：先写外貌或服装描述，或准备一张设定图',edit:'先写想改哪里',busy:'这一格正在生成'};
  // the eight base faces of the eight-face sheet, in its layout order (key,
  // shared name). The sheet is used only when every one of them is a declared 差分 still missing its 头像.
  const GEN_SHEET_FACES=[['joy','喜悦'],['anger','愤怒'],['sad','悲伤'],['anxious','紧张'],['calm','平和'],['shy','害羞'],['disgust','嫌弃'],['love','爱恋']];
  // The shared confirmation gate (image-billing-confirmation.js, also scene illustration's) words its refusal for that page;
  // here it only means the earlier request needs confirming first (no money talk in 生图).
  const genError=e=>e?.code==='BILLING_CONFIRMATION_REQUIRED'?'上一次请求没有返回结果，请确认后再生成':errorText(e);
  const genKey=t=>t.kind==='background'?'background/'+(t.assetId||''):[t.kind,t.figureId,t.outfitKey,t.emotionId||''].join('/');
  const genShown=job=>['running','candidate','save_failed','failed'].includes(job?.status);
  const genSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function genBytes(base64){const s=atob(base64),out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out;}
  function genBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
  // The slot a generation writes, by the backend's own rule: the emotion's own sprite state (平和 → default), its own avatar.
  function genOwnSprite(outfit,manifest,id){
    // read through the sprite's view (hybrid / flat / layered alike), as the backend does.
    const state=outfit?.sprite&&manifest?emotionState(outfit,manifest,id):null,src=state?.stage?.src||state?.src;
    return src?outfit.sprite.assets?.[src]||null:null;
  }
  const genDefaultId=(figure,outfit)=>outfit?.defaultEmotion??figure?.emotions?.[0]?.id;
  const genSaid=v=>!!String(v||'').trim();
  // What a generation draws from: a picture (the outfit 设定图 or the figure's identity board), else the 设定文字 (外貌 /
  // 服装描述), else nothing yet — then 生成 waits for one (the tile menu offers the ways to make it).
  function genBasis(figure,outfit){return outfit?.settei||figure?.identitySettei?'image':genSaid(figure?.identityAppearance)||genSaid(outfit?.outfitAppearance)?'text':'';}
  // The prompt a 差分 starts from: its name and 使用情景; a cell's 「存为默认」 (outfit.genPrompts, owner U4) replaces it for
  // that figure × outfit × 差分 only. The shared fixed layer (template) is edited in 设置 → 舞台 → 素材生图 (GenPromptSettings).
  const genBuiltPrompt=row=>row?row.label+'的表情'+(genSaid(row.guidance)?'，'+row.guidance.trim():'')+'。':'';
  const genPromptFor=(outfit,kind,row)=>outfit?.genPrompts?.[kind]?.[row?.id]||genBuiltPrompt(row);
  // The latest group of a target left an unconfirmed request: the next one goes through the gate.
  function genUncertain(list,target){
    const key=genKey(target),mine=(list||[]).filter(j=>genKey(j.target)===key);if(!mine.length)return false;
    const last=mine.reduce((a,b)=>b.createdAt>a.createdAt?b:a);
    return mine.some(j=>j.groupId===last.groupId&&j.outcome==='unconfirmed'&&j.status!=='running');
  }
  // ---------- The controller (one per pack modal) ----------
  // Every pack write still goes through the modal's serialized writer (`enqueue`); sprite / avatar candidates are adopted
  // through the original importFigureImage (receipts kept per job, so a retry never imports a slot twice).
  function useAssetGen({binding,packId,enqueue,importFigureImage,onPacksChanged}) {
    const [jobs,setJobs]=React.useState(null),[pending,setPending]=React.useState({}),[errors,setErrors]=React.useState({}),[problem,setProblem]=React.useState('');
    const [sheet,setSheet]=React.useState(null),[dialog,setDialog]=React.useState(null),[gate,setGate]=React.useState(null),[models,setModels]=React.useState({}),[run,setRun]=React.useState(null);
    const alive=React.useRef(true),active=React.useRef(false),known=React.useRef(null),queue=React.useRef([]),pumping=React.useRef(false),receipts=React.useRef(new Map()),urls=React.useRef(new Map()),sheets=React.useRef(0),epoch=React.useRef(0);
    const dropping=React.useRef(new Set()),progressRef=React.useRef(null);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;queue.current=[];};},[]);
    const call=async(method,args)=>(await binding.rpc(method,args))?.data;
    const settle=()=>enqueue(async c=>({value:c})).then(r=>r.value);
    const show=list=>{known.current=list;if(alive.current)setJobs(list);};
    const merge=list=>{epoch.current++;const map=new Map((known.current||[]).map(j=>[j.jobId,j]));for(const j of list||[])if(j)map.set(j.jobId,j);show([...map.values()]);};
    const mark=(key,value)=>setPending(p=>{const next={...p};if(value)next[key]=value;else delete next[key];return next;});
    const fail=(key,message)=>setErrors(e=>{const next={...e};if(message)next[key]=message;else delete next[key];return next;});
    // A list that left before a newer write came back is stale: it is read again instead of overwriting the write.
    async function refresh(){
      for(let attempt=0;attempt<3;attempt++){
        const seen=epoch.current;
        try{const list=await call('listAssetCandidates',{packId});if(seen!==epoch.current)continue;show(list||[]);}catch(_){if(!known.current)show([]);}
        break;
      }
      return known.current||[];
    }
    const open=()=>{if(active.current)return;active.current=true;refresh();};
    // Polling only while a request of this pack is in flight.
    React.useEffect(()=>{if(!jobs?.some(j=>j.status==='running'))return;const t=setTimeout(refresh,GEN_POLL_MS);return()=>clearTimeout(t);},[jobs]);
    React.useEffect(()=>{
      if(typeof window==='undefined')return;
      const focus=()=>{if(active.current)refresh();};
      window.addEventListener('focus',focus);
      return()=>window.removeEventListener('focus',focus);
    },[]);
    // One picture waits per slot: when a newer candidate arrives (a 重画 / 改图 of a waiting one), the older one is dropped;
    // until then the older one stays, and it is on show again when the newer request brings nothing.
    React.useEffect(()=>{
      if(!jobs)return;const newest=new Map();
      for(const j of jobs)if(['candidate','save_failed'].includes(j.status)&&j.target.kind!=='background'){const k=genKey(j.target),b=newest.get(k);if(!b||j.createdAt>b.createdAt)newest.set(k,j);}
      for(const j of jobs)if(j.status==='candidate'&&j.target.kind!=='background'&&newest.get(genKey(j.target))!==j&&!dropping.current.has(j.jobId)){dropping.current.add(j.jobId);reject(j).catch(()=>{});}
    },[jobs]);
    const jobFor=target=>{
      const key=genKey(target);let best=null,held=null;
      for(const j of jobs||[]){if(genKey(j.target)!==key)continue;if(!best||j.createdAt>=best.createdAt)best=j;if(['candidate','save_failed'].includes(j.status)&&(!held||j.createdAt>=held.createdAt))held=j;}
      if(held&&best!==held&&!['running','accepted'].includes(best.status))return held;
      return genShown(best)?best:null;
    };
    const ask=count=>new Promise(resolve=>setGate({count,resolve}));
    // prepare → (gate) → generate. The backend retires the original only after a new candidate is saved.
    async function start(target,input={},{approved=false,plan:kept}={}){
      const key=genKey(target);open();mark(key,'starting');fail(key,'');
      try{
        let plan=kept;
        if(!plan){
          const pack=await settle();
          try{plan=await call('prepareAssetGeneration',{target,expectedRevision:pack.revision,...input});}
          catch(e){if(GEN_PROBLEMS[e.code])setProblem(e.message||GEN_PROBLEMS[e.code]);throw e;}
          if(alive.current)setProblem('');
          const confirm=plan.confirmNewRequestIds||[];
          if(confirm.length&&!approved&&!await ask(confirm.length))return null;
        }
        const confirm=plan.confirmNewRequestIds||[];
        let result;
        try{result=await call('generateAssetCandidate',{planId:plan.planId,consentToken:plan.consentToken,...(confirm.length?{confirmNewRequestIds:confirm}:{})});}
        catch(e){throw Object.assign(e,{plan});}
        if(alive.current)setModels(m=>({...m,...Object.fromEntries(result.jobs.map(j=>[j.jobId,plan.provider?.model||'']))}));
        merge(result.jobs);
        return result.jobs[0];
      }catch(e){fail(key,GEN_PROBLEMS[e.code]?'':genError(e)||'生成失败');throw e;}
      finally{mark(key,'');}
    }
    const openSheet=(target,input,extra)=>{open();setSheet({id:++sheets.current,target,input,...extra});};
    // The 生成背景 / eight-face sheet requests: started at once, their sheet opens on the progress.
    function startSlot(target,input){openSheet(target,input);return start(target,input).catch(()=>null);}
    // 「生成缺失立绘」 / 「生成缺失头像」 (owner U2): one request per item ({target, input}), at most four in flight; the
    // ones not yet sent are dropped by 停止 or when the modal closes. `run` is the batch the heading counts (「生成中 a/b」).
    async function batch(items){
      if(!items.length)return;
      open();const list=await refresh(),uncertain=new Set(items.filter(i=>genUncertain(list,i.target)).map(i=>genKey(i.target)));
      if(uncertain.size&&!await ask(uncertain.size))return;
      const keys=items.map(i=>genKey(i.target)),live=progressRef.current;
      setRun(r=>({keys:[...new Set([...(live&&r?r.keys:[]),...keys])]}));
      for(const item of items){queue.current.push({target:item.target,input:item.input||{},approved:uncertain.has(genKey(item.target))});mark(genKey(item.target),'queued');}
      pump();
    }
    async function pump(){
      if(pumping.current)return;pumping.current=true;
      try{
        while(alive.current&&queue.current.length){
          if((known.current||[]).filter(j=>j.status==='running').length>=GEN_PARALLEL){await genSleep(GEN_POLL_MS);await refresh();continue;}
          const item=queue.current.shift();
          try{await start(item.target,item.input,{approved:item.approved,plan:item.plan});}
          catch(e){
            // Another pack's requests fill the four seats: the same consented plan is sent once a seat frees up.
            if(e.code==='BUSY'&&e.plan&&alive.current){queue.current.push({...item,plan:e.plan});mark(genKey(item.target),'queued');fail(genKey(item.target),'');await genSleep(GEN_POLL_MS*2);await refresh();}
            else if(GEN_PROBLEMS[e.code])for(const rest of queue.current.splice(0))mark(genKey(rest.target),'');
          }
        }
      }finally{pumping.current=false;}
    }
    function dequeue(target){const key=genKey(target);queue.current=queue.current.filter(item=>genKey(item.target)!==key);mark(key,'');}
    // 停止: the batch's requests not yet sent are dropped and the ones in flight cancelled; what came back stays.
    async function stop(){
      const keys=new Set(run?.keys||[]);
      queue.current=queue.current.filter(item=>{const key=genKey(item.target);if(!keys.has(key))return true;mark(key,'');return false;});
      for(const j of known.current||[])if(j.status==='running'&&keys.has(genKey(j.target)))await cancel(j).catch(()=>{});
    }
    const forget=jobId=>{for(const key of [...urls.current.keys()])if(key.startsWith(jobId+'|'))urls.current.delete(key);receipts.current.delete(jobId);};
    async function cancel(job){merge([await call('cancelAssetGenerationJob',{jobId:job.jobId})]);}
    async function reject(job){const done=await call('rejectAssetCandidate',{jobId:job.jobId});forget(job.jobId);merge([done]);return done;}
    async function retrySave(job){merge([await call('retryAssetCandidateSave',{jobId:job.jobId})]);}
    // The background sheet's 「按意见重画」 (a note on the frozen request).
    function redraw(job,note){
      const room=(job.references||[]).filter(ref=>!ref.redraw).length<GEN_REF_LIMIT;
      return start(job.target,{redrawOf:job.jobId,note,useCandidateReference:room});
    }
    // Candidate pixels for previews: one read per job / slice, kept as a data URL while the modal is open.
    function candidateUrl(jobId,emotionId){
      const key=jobId+'|'+(emotionId||'');let entry=urls.current.get(key);
      if(!entry){entry=call('readAssetCandidate',{jobId,...(emotionId?{emotionId}:{})}).then(d=>'data:'+d.mediaType+';base64,'+d.base64);urls.current.set(key,entry);entry.catch(()=>urls.current.delete(key));}
      return entry;
    }
    const candidateData=(job,emotionId)=>call('readAssetCandidate',{jobId:job.jobId,...(emotionId?{emotionId}:{})});
    async function candidateFile(job,emotionId,forImport=false){
      const d=await call('readAssetCandidate',{jobId:job.jobId,...(emotionId?{emotionId}:{}),...(forImport?{forImport:true}:{})});
      return new File([genBytes(d.base64)],(emotionId||job.target.kind)+'.png',{type:d.mediaType});
    }
    const finalize=(job,extra)=>enqueue(async c=>{merge([await call('acceptAssetCandidate',{jobId:job.jobId,expectedRevision:c.revision,...extra})]);return {snapshot:await binding.service.getPackSnapshot({packId})};});
    // 采用. settei / background: the backend writes the original pack (CAS on its slot). sprite / avatar: the candidate goes
    // through importFigureImage (aligned sprite read), then accept with the receipt. A sheet imports slot by slot and
    // resumes after a failure from the first slot without a receipt. Older candidates of the same slot are dropped.
    async function accept(job,{replace=false,file,keywords}={}){
      const t=job.target;
      if(['settei','identity-settei','background'].includes(t.kind)){
        await enqueue(async c=>{merge([await call('acceptAssetCandidate',{jobId:job.jobId,expectedRevision:c.revision,keywords,...(replace?{replace:true}:{})})]);return {snapshot:await binding.service.getPackSnapshot({packId})};});
      } else {
        const receipt=receipts.current.get(job.jobId)||{hashes:{}};receipts.current.set(job.jobId,receipt);
        const slots=t.kind==='avatar-sheet'?t.emotionIds.filter(Boolean):[t.emotionId];
        // An avatar is imported byte for byte, so a slot that already holds this candidate (an earlier attempt, maybe
        // before the modal was reopened) counts as imported. Sprites are aligned on import; their receipt is the session's.
        const now=(await settle()).figures?.[t.figureId]?.outfits.find(o=>o.key===t.outfitKey);
        for(const id of slots){const want=t.kind==='avatar-sheet'?job.candidate?.slices?.[id]?.hash:t.kind==='avatar'?job.candidate?.hash:null;if(!receipt.hashes[id]&&want&&(now?.sprite?.imagePools?.[id]?.imageIds.some(imageId=>now.avatars?.[imageId]===want)||now?.avatars?.[id]===want))receipt.hashes[id]=want;}
        for(const id of slots){
          if(receipt.hashes[id])continue;
          const image=file||await candidateFile(job,t.kind==='avatar-sheet'?id:null,t.kind==='sprite');
          await importFigureImage(t.figureId,t.outfitKey,id,image,t.kind==='sprite'?'sprite':'avatar',{expectedPackId:packId,expectedRevision:(await settle()).revision,imageId:t.imageId,onImported:r=>{receipt.hashes[id]=r.hash;}});
        }
        await finalize(job,t.kind==='avatar-sheet'?{importedHashes:receipt.hashes}:{importedHash:receipt.hashes[t.emotionId]});
      }
      // Adopting settles the slot: other candidates of it are dropped, and a failed request's ⚠ (a redraw that brought
      // nothing) is cleared with it.
      forget(job.jobId);fail(genKey(t),'');
      for(const j of known.current||[])if(j.jobId!==job.jobId&&['candidate','failed'].includes(j.status)&&genKey(j.target)===genKey(t)&&!dropping.current.has(j.jobId)){dropping.current.add(j.jobId);reject(j).catch(()=>{});}
      onPacksChanged?.();
      follow((known.current||[]).find(j=>j.jobId===job.jobId)||job);
    }
    // gen-ui b5: what waited for this picture's 采用 (the job's followUp) is sent now, as a batch — a 立绘 carrying its own 头像
    // as the next follow-up; a 头像 goes straight (its 立绘 is there now).
    function follow(job){
      const t=job.target,list=job.followUp||[];if(!list.length)return;
      const at=(kind,emotionId)=>({packId:t.packId,figureId:t.figureId,outfitKey:t.outfitKey,kind,emotionId,...(kind==='avatar'&&job.acceptedImageId?{imageId:job.acceptedImageId}:{})}),opts=f=>({...(f.userPrompt?{userPrompt:f.userPrompt}:{}),...(f.style?{style:f.style}:{})});
      const sprites=list.filter(f=>f.kind==='sprite').map(f=>f.emotionId);
      batch(list.filter(f=>f.kind==='sprite'||!sprites.includes(f.emotionId)).map(f=>{const then=f.kind==='sprite'?list.filter(a=>a.kind==='avatar'&&a.emotionId===f.emotionId):[];
        return {target:at(f.kind,f.emotionId),input:{...opts(f),...(then.length?{followUp:then}:{})}};})).catch(()=>{});
    }
    // 「全部采用」: one after another (each its own CAS write); a slot that fails keeps its candidate and says why.
    async function acceptAll(list){
      let done=0;
      for(const job of list){try{await accept(job);done++;}catch(e){fail(genKey(job.target),errorText(e));}}
      return done;
    }
    const dialogs=gate&&h(ConfirmDialog,{title:'上一次还没有结果',body:gate.count>1?'其中 '+gate.count+' 项上一次请求没有返回结果，不会自动重试。仍要再生成吗？':GEN_UNCERTAIN,confirmLabel:'仍要生成',
      onConfirm:()=>gate.resolve(true),onClose:()=>{gate.resolve(false);setGate(null);}});
    // the exact prompt and references a request would send, built by the backend without
    // a plan, a channel or a request.
    const previewPrompt=async(target,input={})=>{const pack=await settle();return call('prepareAssetGeneration',{target,expectedRevision:pack.revision,...input,preview:true});};
    // The batch the heading counts: done / total while any of it is queued, starting or drawing; else none.
    // Slots waiting for an earlier picture's 采用 (followUp of a request in flight or waiting): shown 「排队中」.
    const after=new Set((jobs||[]).filter(j=>['running','candidate','save_failed'].includes(j.status)).flatMap(j=>(j.followUp||[]).map(f=>genKey({...j.target,kind:f.kind,emotionId:f.emotionId}))));
    const progress=run?(()=>{const left=run.keys.filter(key=>{if(pending[key])return true;return (jobs||[]).some(j=>j.status==='running'&&genKey(j.target)===key);}).length;
      return left?{total:run.keys.length,done:run.keys.length-left,keys:run.keys}:null;})():null;
    progressRef.current=progress;
    return {jobs,pending,errors,problem,models,sheet,dialog,progress,after,open,refresh,jobFor,start,startSlot,previewPrompt,batch,stop,dequeue,cancel,reject,retrySave,redraw,accept,acceptAll,
      candidateUrl,candidateData,candidateFile,dialogs,openSheet,clearError:key=>fail(key,''),
      openDialog:(target,extra={})=>{open();setDialog({id:++sheets.current,target,mode:'gen',...extra});},closeDialog:()=>setDialog(null),
      retarget:(target,extra)=>setSheet(s=>s&&{...s,...extra,target}),closeSheet:()=>setSheet(null),
      waiting:(figureId,kinds)=>(jobs||[]).some(j=>j.target.figureId===figureId&&(!kinds||kinds.includes(j.target.kind))&&['candidate','save_failed'].includes(j.status))};
  }
  // ---------- Pieces ----------
  function useCandidateUrl(gen,jobId,emotionId){
    const key=jobId?jobId+'|'+(emotionId||''):'',[value,setValue]=React.useState(null);
    React.useEffect(()=>{if(!jobId)return;let live=true;gen.candidateUrl(jobId,emotionId).then(url=>{if(live)setValue({key,url});},()=>{});return()=>{live=false;};},[key]);
    return value?.key===key?value.url:null;
  }
  function CandidateArt({gen,jobId,emotionId,className}) {
    const url=useCandidateUrl(gen,jobId,emotionId);
    return url?h(RevealImg,{src:url,alt:'',draggable:false,className}):h(Spinner,{key:jobId+(emotionId||''),fill:true});
  }
  // 查看大图 of a waiting candidate (its pixels are read once per job).
  function CandidateImageView({gen,jobId,label,actions,onClose}) {
    return h(PackImageView,{src:useCandidateUrl(gen,jobId),label,actions,onClose});
  }
  function GenWarnings({warnings}) {
    if(!warnings?.length)return null;
    return h('div',{className:'ap-gen-warns',role:'list','aria-label':'检查结果'},warnings.map((w,i)=>h('span',{key:w.code+i,role:'listitem',className:'ap-gen-warn',title:w.message},h(Glyph,{name:'warning'}),w.label||GEN_WARNINGS[w.code]||w.message)));
  }
  function useElapsed(since,on) {
    const [now,setNow]=React.useState(()=>Date.now());
    React.useEffect(()=>{if(!on)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[on]);
    const s=Math.max(0,Math.floor((now-(since||now))/1000));
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  }
  // ↑ ↓ (and ← → in a picture grid) walk a small 生图 menu.
  function genMenuKeys(e) {
    const items=[...e.currentTarget.querySelectorAll('button:not(:disabled),input')],i=items.indexOf(document.activeElement),n=items.length,next={ArrowDown:i+1,ArrowRight:i+1,ArrowUp:i-1,ArrowLeft:i-1,Home:0,End:n-1}[e.key];
    if(next===undefined||!n)return;e.preventDefault();items[(next+n)%n].focus();
  }
  // ---------- One slot as the grid sees it ----------
  // 'queued' / 'running' (with `since`) / 'candidate' / 'failed' / 'idle', and the job behind it. A 头像 counts the latest
  // eight-face sheet request covering it too (then `sheet` is that request's target).
  function genCell(gen,target){
    const key=genKey(target),own=gen.jobFor(target);
    const sheetTarget=target.kind==='avatar'?{packId:target.packId,figureId:target.figureId,outfitKey:target.outfitKey,kind:'avatar-sheet'}:null,cover=sheetTarget&&gen.jobFor(sheetTarget);
    const inSheet=!!cover&&(cover.target.emotionIds||[]).includes(target.emotionId),covering=inSheet&&(!own||cover.createdAt>own.createdAt)?cover:null,job=covering||own;
    const pend=gen.pending[key]||(inSheet&&!own?gen.pending[genKey(sheetTarget)]:'')||'';
    let state=pend==='queued'?'queued':pend||job?.status==='running'?'running':['candidate','save_failed'].includes(job?.status)?'candidate':job?.status==='failed'||(!job&&gen.errors[key])?'failed':'idle';
    const after=state==='idle'&&!!gen.after?.has(key);if(after)state='queued';
    const warnings=covering?covering.candidate?.slices?.[target.emotionId]?.checks?.warnings||[]:job?.candidate?.checks?.warnings||[];
    // A waiting candidate's `error` is why its last 采用 failed (「全部采用」 goes on past it; the tile keeps its ⚠).
    return {state,key,target,after,job:state==='idle'||state==='queued'?null:job,sheet:covering?covering.target:null,since:!pend&&job?.status==='running'?job.createdAt:null,
      error:state==='failed'?job?.error?.message||gen.errors[key]||'':state==='candidate'?gen.errors[key]||'':'',warnings};
  }
  // The candidate in a 差分 tile: a 立绘 is cut to the head and shoulders (a generated 立绘 fills its 2:3 canvas centred,
  // the head in its top fifth), a 头像 shows whole.
  function GenFaceCandidate({gen,cell,kind}) {
    return h('span',{className:'ap-gen-face-art','data-kind':kind},h(CandidateArt,{gen,jobId:cell.job.jobId,emotionId:cell.sheet?cell.target.emotionId:null}));
  }
  // The marks a request leaves on a tile: a turning ring and the time (生成中), 「排队中」, the dot and 「待采用」, ⚠.
  function GenFaceMarks({cell}) {
    const elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    if(cell.state==='queued')return h('span',{className:'ap-gen-queue'},'排队中');
    if(cell.state==='running')return h(React.Fragment,null,h(Spinner,{key:'run'+cell.key,fill:true,delay:0,className:'ap-gen-spin'}),cell.since?h('span',{className:'ap-gen-face-time'},elapsed):null);
    if(cell.state==='candidate')return h(React.Fragment,null,h('span',{className:'ap-gen-dot','aria-hidden':true}),h('span',{className:'ap-gen-badge'},'待采用'),
      (cell.error||cell.warnings.length>0)&&h('span',{className:'ap-gen-flag',title:[cell.error,...cell.warnings.map(w=>w.message)].filter(Boolean).join('\n')},h(Glyph,{name:'warning'})));
    if(cell.state==='failed')return h('span',{className:'ap-gen-flag',title:genFailText(cell.error)},h(Glyph,{name:'warning'}));
    return null;
  }
  // status words are plain terms — 排队中 / 生成中 / 待采用 / 生图失败; a failure reads
  // 「没能生成：<reason>」 on the tile's hover, in the records and on the 新人物 page: the host's Chinese reason through the
  // shared playerErrorText (no provider English, no HTTP status —).
  const GEN_CELL_WORDS={queued:'排队中',running:'生成中',candidate:'待采用',failed:'生图失败'};
  const genFailText=reason=>{const why=String((typeof reason==='string'?reason:reason?.message)||'').replace(/^生图失败[：:]?/,'');
    return '没能生成：'+(why?playerErrorText(why,{fallback:'请稍后再试'}):'请稍后再试').replace(/[。；;，,]$/,'');};
  // The preview card of the picked 差分 while its request runs (the ring, 生成中 / 排队中 and the time) and while a candidate
  // waits (the picture on the checkerboard, 「待采用」, the outfit 设定图 in a corner to compare against — mock E5 / E6).
  function GenStageWait({cell}) {
    const elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    return h('span',{className:'ap-gen-stage-wait',role:'status'},h(Spinner,{key:'wait'+cell.key,delay:0}),
      h('b',null,GEN_CELL_WORDS[cell.state==='queued'?'queued':'running']),cell.since&&cell.state==='running'&&h('small',null,elapsed));
  }
  function GenStageCandidate({gen,binding,packId,cell,kind,emotionId,settei}) {
    return h('span',{className:'ap-stand ap-gen-stand','data-kind':kind},
      h('span',{className:'ap-gen-stand-art'},h(CandidateArt,{gen,jobId:cell.job.jobId,emotionId:cell.sheet?emotionId:null})),
      h('span',{className:'ap-gen-badge is-stage'},'待采用'),
      settei&&h('span',{className:'ap-gen-pip',title:'服装设定图'},h(Thumb,{binding,packId,hash:settei,label:'服装设定图'}),h('small',null,'设定图')));
  }
  // The 差分 detail's request line (UI standard R9: the selected tile's actions under the grid): state, checks, actions.
  function GenCellStatus({gen,cell,outfit,onDialog}) {
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    if(cell.state==='idle')return null;
    const run=fn=>{setBusy(true);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));};
    const job=cell.job,basis=job?.references?.some(r=>r.hash&&r.hash===outfit?.settei)?'照服装设定图':'照设定文字';
    const actions=cell.state==='candidate'?(cell.sheet?[h(Button,{key:'view',disabled:busy,onClick:()=>gen.openSheet(cell.sheet)},'查看八个头像')]:[
        h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:()=>run(()=>gen.reject(job))},'不要'),
        h(Button,{key:'redraw',disabled:busy,onClick:()=>onDialog('redraw')},'重画…'),
        h(Button,{key:'yes',disabled:busy,onClick:()=>run(()=>gen.accept(job))},'采用')]):
      cell.state==='failed'?[h(Button,{key:'retry',disabled:busy,onClick:()=>run(()=>gen.start(cell.target,job?.userPrompt?{userPrompt:job.userPrompt}:{}))},h(Glyph,{name:'reset'}),'重试'),
        h(Button,{key:'adjust',disabled:busy,onClick:()=>onDialog('gen')},'调整后重试…')]:
      [h(Button,{key:'stop',disabled:busy||cell.after||cell.state==='running'&&!job,title:cell.after?'采用前一张图后开始':undefined,onClick:()=>run(()=>cell.state==='queued'?gen.dequeue(cell.target):gen.cancel(job))},cell.state==='queued'?'取消排队':'取消')];
    // One row: the pill, the reason or detail, the actions; it wraps only when the width runs out. A
    // failure's reason is the host's text after the 「生图失败」 pill (no second ⚠).
    const meta=cell.state==='failed'?(cell.error?h('span',{className:'ap-gen-warn-ink'},cell.error):null):cell.error?h('span',{className:'ap-gen-warn-ink'},h(Glyph,{name:'warning'}),'采用失败：'+cell.error):
      cell.state==='candidate'&&!cell.sheet?h('span',null,basis+(job?.userPrompt?' · '+job.userPrompt:'')):cell.state==='running'&&cell.since?h('span',{className:'ap-gen-time'},elapsed):null;
    return h('div',{className:'ap-gen-status','data-state':cell.state,role:'group','aria-label':'生成'},
      h('div',{className:'ap-gen-status-row'},h('span',{className:'ap-gen-pill','data-state':cell.state},GEN_CELL_WORDS[cell.state]),
        cell.state==='candidate'&&h(GenWarnings,{warnings:cell.warnings}),meta&&h('span',{className:'ap-gen-status-meta'},meta),h('span',{className:'ap-gen-status-actions'},actions)),
      error&&h('p',{className:'ap-field-error',role:'alert'},error));
  }
  // The ⚠ line a gated action leaves where it was clicked (for touch, where tooltips do not show). It stays until the next
  // action there (or the picked 差分 / view changes, which remounts its owner) — no timer, so it never vanishes unread.
  function useGenNote() {
    const [note,setNote]=React.useState('');
    return [note,text=>setNote(text||'')];
  }
  function GenGateNote({text,className=''}) {
    if(!text)return null;
    return h('p',{className:('ap-gen-gate '+className).trim(),role:'status'},h(Glyph,{name:'warning'}),h('span',null,text));
  }
  // ---------- The ONE generation dialog ----------
  // 编辑 and 生图 open the same dialog: 生成 / 重画 / 改图 a 差分 (输出 立绘＋头像 · 立绘 · 头像), a 服装 or 人物设定图, and
  // 添加服装 (a new outfit, optionally with its 服装设定图 and then its first 差分). One column — no preview, no divider lines:
  // 参考图 (the 设定图 that exist and, for 重画, the picture being redrawn; never a 平和 stand-in; a chip's ✕ leaves a
  // default out → `omit`; ＋ uploads), 外貌 / 服装描述 as read-only chips with ✎, 额外要求 (this 差分's default description;
  // changed → ↺ and 「存为默认」 for this cell only, U4), 画风 (the pack's default; changed → 「设为本包默认」). The footer's
  // quiet icon shows the full prompt (a preview: no plan, no request). Title 「生图」; the subtitle goes big → small:
  // figure · outfit · 差分 (· 重画 / 改图). A 头像 follows its 立绘: 「立绘＋头像」 sends the 立绘 now and its 头像 once that is
  // adopted (the job's followUp), as 添加服装 sends its first 差分 after the 服装设定图. Ctrl+Enter sends, Esc closes; the
  // request then runs in its tile and the dialog closes as soon as it is sent.
  const GEN_STYLES=[['clean','干净低细节'],['anime','动画截图'],['polished','精美高质量商业插画'],['none','不指定']];
  const GEN_HELP={figure:'这个人物的标准样貌图。之后的立绘、头像和服装设定图都以它为参考图。',outfit:'这套服装的标准样貌图。这套服装之后的立绘和头像都以它为参考图。',
    first:label=>'两项都勾时先生成服装设定图；采用后再以它为参考图生成「'+label+'」的立绘和头像。',style:'只用于这一次；「设为本包默认」后，这个素材包的生图都默认用它。「不指定」不附任何画风要求。'};
  const genWhere=(...parts)=>parts.filter(Boolean).join(' · ');
  const genFileInput=(ref,label,onFile)=>h('input',{ref,type:'file',hidden:true,tabIndex:-1,accept:'image/png,image/webp,image/jpeg','aria-label':label,onChange:e=>{const f=e.target.files?.[0];e.target.value='';if(f)onFile(f);}});
  // `bare`: no caption under the picture (the 新人物 page's 设定图 row names them in its label).
  function GenRefChip({binding,packId,hash,url,name,wide=false,bare=false,onRemove}) {
    const art=hash?h(Thumb,{binding,packId,hash,label:name,className:'ap-gen-ref-art'}):url?h('img',{src:url,alt:'',draggable:false}):h(Glyph,{name:'note'});
    return h('span',{className:'ap-gd-ref'},h('span',{className:'ap-gd-ref-chip'},h('span',{className:'ap-gen-ref is-static','data-wide':wide||undefined,role:'img','aria-label':name,title:name},art),
      onRemove&&h('button',{type:'button',className:'ap-gen-ref-x','aria-label':'移除参考图 '+name,title:'移除',onClick:onRemove},h(Glyph,{name:'close'}))),!bare&&h('small',null,name));
  }
  // A user reference picture (uploaded or pasted) as the request sends it; refuses what the backend would.
  async function genReadUpload(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('参考图请选 PNG、JPEG 或 WebP');
    if(file.size>GEN_REF_BYTES)throw new Error('参考图最大 8 MB');
    const base64=genBase64(new Uint8Array(await file.arrayBuffer()));
    return {id:file.name+file.size+Date.now()+Math.random().toString(36).slice(2,6),mediaType:file.type,base64,url:'data:'+file.type+';base64,'+base64};
  }
  // 外貌 / 服装描述 beside a 差分 request: a read-only chip 「name text ✎」; ✎ (or the text) turns it into the house inline
  // field in place — Enter / leaving saves the stored text (R17), Esc cancels — and back.
  function GenSaid({name,value,onSave}) {
    const [edit,setEdit]=React.useState(false),ref=React.useRef(null);
    React.useEffect(()=>{if(edit)ref.current?.focus?.();},[edit]);
    if(edit)return h('div',{className:'ap-gd-said is-edit',onBlur:e=>{if(!e.currentTarget.contains(e.relatedTarget))setTimeout(()=>setEdit(false),0);},onKeyDown:e=>{if(e.key==='Escape'){e.stopPropagation();setEdit(false);}}},
      h(InlineField,{kind:'text',multiline:true,label:name,controlRef:ref,className:'ap-gd-said-field',value,placeholder:'未填写',maxLength:1000,onCommit:v=>{onSave(v);setEdit(false);}}));
    return h('span',{className:'ap-gd-said'},h('span',{className:'ap-gd-said-key'},name),
      h('button',{type:'button',className:'ap-gd-said-text','data-empty':!value||undefined,title:value||undefined,'aria-label':name+'：'+(value||'未填写'),onClick:()=>setEdit(true)},value||'未填写'),
      h(IconButton,{icon:'edit',label:'编辑'+name,className:'ap-icon-button ap-gd-said-edit',onClick:()=>setEdit(true)}));
  }
  const genCheck=(on,set,text)=>h('button',{type:'button',role:'checkbox','aria-checked':on,className:'ap-check-row ap-gd-check',onClick:()=>set(v=>!v)},
    h('span',{className:'ap-check-mark','aria-hidden':true},on&&h(Glyph,{name:'check'})),h('span',null,text));
  // The footer's quiet 「查看完整提示词」: the exact text a request would send (lines edited in 设置 → 舞台 → 素材生图 marked), read on
  // demand before the popover opens so it places itself once with its real height.
  function GenPeek({load}) {
    const [shown,setShown]=React.useState(null);
    return h(Popover,{label:'完整提示词',className:'ap-gd-peek',float:true,limit:520,
      trigger:({toggle,open})=>h(IconButton,{icon:'note',label:'查看完整提示词',className:'ap-icon-button ap-gd-peek-btn','aria-haspopup':'dialog','aria-expanded':open,'aria-busy':shown?.busy||undefined,
        onClick:()=>{if(open){toggle();return;}setShown({busy:true});load().then(p=>{setShown({text:p.prompt,parts:p.parts});toggle();},e=>{setShown({error:errorText(e)});toggle();});}}),
      content:()=>h('div',{className:'ap-gd-peek-body'},!shown||shown.busy?h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在读取…'):
        shown.error?h('p',{className:'ap-field-error',role:'alert'},h(Glyph,{name:'warning'}),shown.error):
        h(React.Fragment,null,shown.parts?.some(p=>p.edited)&&h('p',{className:'ap-gen-prompt-legend'},h('mark',{className:'ap-gen-prompt-edited'},'标出'),'的部分是在「设置 → 舞台 → 素材生图」里改过的'),
          h('pre',{className:'ap-gen-prompt-text ap-gd-peek-text',tabIndex:0,'aria-label':'将发送的提示词'},shown.parts?shown.parts.map((p,i)=>p.edited?h('mark',{key:i,className:'ap-gen-prompt-edited'},p.text):p.text):shown.text)))});
  }
  function GenDialog({gen,binding,pack,commitFigure,importSettei,saveStyle}) {
    const d=gen.dialog,packId=pack.manifest.id,figure=pack.figures?.[d.target.figureId]||null,mode=d.mode||'gen',adding=mode==='outfit';
    const fig=!adding&&d.target.kind==='identity-settei',settei=fig||!adding&&d.target.kind==='settei',cellMode=!adding&&!settei,redo=mode==='redraw'||mode==='edit';
    const raw=fig?null:figure?.outfits.find(o=>o.key===d.target.outfitKey)||null,outfit=raw&&figureOutfitView(figure,raw);
    const rows=figure?figureEditorEmotions(figure):[],manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey];
    const emotionId=cellMode?d.target.emotionId:null,row=rows.find(r=>r.id===emotionId)||null;
    const takes=cellMode&&!!outfit&&spriteSlotTakesStill(outfit,manifest,emotionId);
    const ownSprite=cellMode&&outfit?genOwnSprite(outfit,manifest,emotionId):null,ownAvatar=cellMode&&outfit?outfit.avatars?.[emotionId]||null:null;
    const outs=cellMode&&mode!=='edit'?[takes&&['both','立绘＋头像'],takes&&['sprite','立绘'],['avatar','头像']].filter(Boolean):[];
    const [out,setOut]=React.useState(()=>!cellMode||mode==='edit'?d.target.kind:outs.some(o=>o[0]===d.out)?d.out:d.target.kind==='avatar'||!takes?'avatar':mode==='redraw'?'sprite':'both');
    const kind=adding?'settei':settei?d.target.kind:out==='avatar'?'avatar':'sprite';
    const target=adding?null:fig?{packId,figureId:d.target.figureId,kind}:settei?{packId,figureId:d.target.figureId,outfitKey:d.target.outfitKey,kind}:{packId,figureId:d.target.figureId,outfitKey:d.target.outfitKey,kind,emotionId};
    const cell=target?genCell(gen,target):{state:'idle'};
    // 重画 / 改图 work on what the slot shows: the waiting candidate, else the adopted picture.
    const own=fig?figure?.identitySettei?.board||null:settei?outfit?.settei||null:kind==='avatar'?ownAvatar:ownSprite;
    const waiting=cell.state==='candidate'?cell.job:null,base=redo?(waiting?{job:waiting}:own?{hash:own}:null):null;
    const baseUrl=useCandidateUrl(gen,base?.job?.jobId||null,cell.sheet?emotionId:null);
    const defaultPrompt=cellMode&&mode!=='edit'&&outfit&&row?genPromptFor(outfit,kind,row):'';
    // Text fields commit on Enter / blur (a blur precedes 生成): the latest committed text is read from here.
    const texts=React.useRef(null);if(!texts.current)texts.current={prompt:mode==='redraw'&&waiting?.userPrompt||defaultPrompt,name:'',wear:''};
    const [prompt,setPromptState]=React.useState(texts.current.prompt),[saved,setSaved]=React.useState(false);
    const [removed,setRemoved]=React.useState([]),[uploads,setUploads]=React.useState([]),[style,setStyle]=React.useState(pack.manifest.genStyle||'clean');
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const [name,setNameState]=React.useState(''),[wear,setWearState]=React.useState(''),[lamp,setLamp]=React.useState('keyword');
    const [words,setWords]=React.useState(()=>{const short=String(figure?.name||'').split(/[·・]/)[0].trim();return adding&&short?[short]:[];});
    const [sheetFile,setSheetFile]=React.useState(null),[genSheet,setGenSheet]=React.useState(true),[genFirst,setGenFirst]=React.useState(true);
    const refInput=React.useRef(null),sheetInput=React.useRef(null),made=React.useRef(null),submitRef=React.useRef(null);
    const setPrompt=v=>{texts.current.prompt=v;setPromptState(v);setSaved(false);};
    const setName=v=>{texts.current.name=v;setNameState(v);},setWear=v=>{texts.current.wear=v;setWearState(v);};
    const close=()=>{if(!busy)gen.closeDialog();};
    if(!figure||!fig&&!outfit)return h(Modal,{title:'生图',className:'ap-gen-dialog',onClose:close},h(EmptyState,{text:'服装已被删除'}));
    // 参考图: the 设定图 the backend attaches by rule (asset-generation.js prepare) — the 人物设定图 (unless the outfit's 设定图
    // no longer descends from it) and, for a 差分, the 服装设定图; a 头像 also its own 立绘 (fixed). Nothing stands in.
    const identity=figure.identitySettei,stale=!!identity&&cellMode&&outfit.setteiParentVersion!==undefined&&outfit.setteiParentVersion!==identity.version;
    const sheetNow=adding&&genSheet&&!sheetFile,anyGen=!adding||sheetNow||genFirst;
    const defaults=[identity&&!fig&&!stale&&{id:'identity',hash:identity.board,name:'人物设定图'},cellMode&&outfit.settei&&{id:'settei',hash:outfit.settei,name:'服装设定图'}].filter(r=>r&&!removed.includes(r.id));
    const fixed=cellMode&&kind==='avatar'&&ownSprite?{hash:ownSprite,name:(row?.label||'')+'立绘'}:null;
    const current=base&&(mode==='edit'||!removed.includes('current'))?base:null;
    const room=GEN_REF_LIMIT-defaults.length-(fixed?1:0)-(current?1:0)-uploads.length;
    const reason=cellMode&&kind==='sprite'&&!takes?GEN_REASONS.layered:cellMode&&kind==='avatar'&&!ownSprite?GEN_REASONS.avatar:
      mode==='edit'&&!prompt.trim()?GEN_REASONS.edit:redo&&!base?'这一格还没有图':['running','queued'].includes(cell.state)?GEN_REASONS.busy:
      adding&&!name.trim()?'请填写服装名':settei&&!prompt.trim()&&!defaults.length&&!uploads.length&&!genSaid(figure.identityAppearance)&&!genSaid(outfit?.outfitAppearance)?GEN_REASONS.basis:'';
    const upload=file=>genReadUpload(file).then(u=>setUploads(list=>[...list,u])).catch(e=>setError(errorText(e)));
    // One request's input — the 画风 seam: this dialog's preset (an 改图 keeps the pack's), its references and omissions.
    const inputNow=async()=>{
      const references=[];
      if(current){const role=mode==='edit'?GEN_BASE_ROLE:GEN_CURRENT_ROLE;
        if(current.hash)references.push({hash:current.hash,role});else{const data=await gen.candidateData(current.job,cell.sheet?emotionId:null);references.push({base64:data.base64,mediaType:data.mediaType,role});}}
      for(const u of uploads)references.push({base64:u.base64,mediaType:u.mediaType,role:cellMode?GEN_POSE_ROLE:GEN_ART_ROLE});
      const omit=['identity','settei'].filter(id=>removed.includes(id)),text=texts.current.prompt.trim();
      return {...(text?{userPrompt:text}:{}),...(references.length?{references}:{}),...(omit.length?{omit}:{}),...(mode!=='edit'?{style}:{})};
    };
    // 添加服装: the outfit is written once (a retry after a failed start does not add a second one), its uploaded 服装设定图
    // goes in, the page shows it; then the 服装设定图 is generated (its first 差分 follows its 采用), or that 差分 at once.
    const first=figure.outfits.find(o=>o.key===d.target.outfitKey)?.defaultEmotion??figure.emotions?.[0]?.id,firstRow=rows.find(r=>r.id===first),firstLabel=firstRow?.label||'';
    const addOutfit=async step=>{
      const t=texts.current;
      if(!made.current){
        const key=newResourceKey('outfit'),label=t.name.trim(),wearText=t.wear.trim();
        await commitFigure(figure.id,f=>({outfits:[...f.outfits,{key,label,enabled:lamp!=='off',...(first?{defaultEmotion:first}:{}),recall:{mode:lamp==='off'?'keyword':lamp,keywords:words},...(wearText?{outfitAppearance:wearText}:{})}]}));
        made.current=key;if(sheetFile)await importSettei(figure.id,key,sheetFile.file);d.onOutfit?.(key);
      }
      const key=made.current,at=(k,extra={})=>({packId,figureId:figure.id,outfitKey:key,kind:k,...extra}),input=await inputNow();
      const firstText=firstRow?genBuiltPrompt(firstRow):'',firstFollow=first?[{kind:'avatar',emotionId:first,...(firstText?{userPrompt:firstText}:{}),style}]:[];
      let job=true;step.sent=true;
      if(sheetNow)job=await gen.start(at('settei'),{...input,...(genFirst&&first?{followUp:[{kind:'sprite',emotionId:first,...(firstText?{userPrompt:firstText}:{}),style},...firstFollow]}:{})});
      else if(genFirst&&first)job=await gen.start(at('sprite',{emotionId:first}),{...input,...(firstText?{userPrompt:firstText}:{}),followUp:firstFollow});
      if(job)gen.closeDialog();
    };
    // A failed start is said once, from gen.errors (startError below); only what fails before it is this dialog's own error.
    const sendCell=async step=>{
      const input=await inputNow();step.sent=true;
      const follow=out==='both'?{followUp:[{kind:'avatar',emotionId,...(input.userPrompt?{userPrompt:input.userPrompt}:{}),style:input.style}]}:{};
      const job=await gen.start(target,{...input,...follow});
      if(job)gen.closeDialog();
    };
    const submit=()=>{if(busy||reason)return;setBusy(true);setError('');const step={sent:false};
      Promise.resolve().then(()=>adding?addOutfit(step):sendCell(step)).catch(e=>{if(!step.sent)setError(errorText(e));}).finally(()=>setBusy(false));};
    submitRef.current=submit;
    // 「存为默认」: this cell's own description (outfit.genPrompts[kind][差分], U4); the name-and-使用情景 default needs no entry.
    const saveDefault=()=>{const text=texts.current.prompt.trim(),k=kind;
      return commitFigure(figure.id,f=>({outfits:f.outfits.map(o=>{
        if(o.key!==outfit.key)return o;const all={...(o.genPrompts||{})},map={...(all[k]||{})};
        if(!text||text===genBuiltPrompt(row))delete map[row.id];else map[row.id]=text;
        if(Object.keys(map).length)all[k]=map;else delete all[k];
        const next={...o};if(Object.keys(all).length)next.genPrompts=all;else delete next.genPrompts;return next;})})).then(()=>setSaved(true),e=>setError(errorText(e)));};
    const writeLook=v=>commitFigure(figure.id,()=>({identityAppearance:v||null})).catch(e=>setError(errorText(e)));
    const writeWear=v=>commitFigure(figure.id,f=>({outfits:f.outfits.map(o=>{if(o.key!==outfit.key)return o;const n={...o};if(v)n.outfitAppearance=v;else delete n.outfitAppearance;return n;})})).catch(e=>setError(errorText(e)));
    const changeOut=next=>{const was=texts.current.prompt.trim();if(was===defaultPrompt.trim()&&row)setPrompt(genPromptFor(outfit,next==='avatar'?'avatar':'sprite',row));setOut(next);};
    const row_=(key,label,body,extra={})=>h(InlineRow,{key,label,help:extra.help,multiline:extra.multiline,wide:extra.multiline,className:'ap-gen-row ap-gd-row'+(extra.className?' '+extra.className:'')},body);
    const textField=(key,label,value,onCommit,placeholder,extra={})=>h(InlineField,{key,kind:'text',multiline:true,label,className:'ap-gen-row ap-gd-row ap-gd-text'+(extra.className?' '+extra.className:''),
      value,placeholder,maxLength:1000,trail:extra.trail,onCommit});
    const chip=(key,r,onRemove)=>h(GenRefChip,{key,binding,packId,hash:r.hash,url:r.url,name:r.name,wide:r.wide,onRemove});
    const refsRow=row_('refs','参考图',h('div',{className:'ap-gd-refs',role:'group','aria-label':'参考图'},
      defaults.map(r=>chip(r.id,{...r,wide:true},()=>setRemoved(x=>[...x,r.id]))),
      fixed&&chip('fixed',fixed),
      current&&chip('current',{hash:current.hash,url:current.job?baseUrl:null,name:mode==='edit'?'底图':settei?'当前设定图':kind==='avatar'?'当前头像':'当前立绘'},mode==='edit'?null:()=>setRemoved(x=>[...x,'current'])),
      uploads.map(u=>chip(u.id,{url:u.url,name:'上传的图'},()=>setUploads(x=>x.filter(y=>y!==u)))),
      room>0&&h(CatAddTile,{label:'上传参考图',className:'ap-gd-ref-add',onClick:()=>refInput.current?.click?.()}),genFileInput(refInput,'上传参考图',upload)),{multiline:true,className:'is-refs'});
    const said=list=>row_('said','',h('div',{className:'ap-gd-said-list'},list.map(([k,v,save])=>h(GenSaid,{key:k,name:k,value:v,onSave:save}))),{multiline:true,className:'is-said'});
    const lookSaid=['外貌',figure.identityAppearance||'',writeLook],wearSaid=outfit&&['服装描述',outfit.outfitAppearance||'',writeWear];
    const changed=cellMode&&mode!=='edit'&&prompt.trim()!==defaultPrompt.trim();
    const promptTrail=changed?h('span',{className:'ap-gd-prompt-acts'},h(IconButton,{icon:'reset',label:'恢复默认',onClick:()=>setPrompt(defaultPrompt)}),
        h('button',{type:'button',className:'ap-inline-link ap-gd-save-default',title:'存为「'+(row?.label||'')+'」的默认描述',onClick:saveDefault},'存为默认')):
      saved?h('span',{className:'ap-gd-prompt-acts ap-gd-saved',role:'status'},h(Glyph,{name:'check'}),'已存为默认'):null;
    const extra=textField('prompt',mode==='edit'?'想改哪里':'额外要求',prompt,setPrompt,mode==='edit'?'例：领巾换成红色，其余不变':cellMode?'例：双手叉腰，气鼓鼓地瞪着前方':'角度、细节…',{className:'is-prompt',trail:promptTrail});
    const packStyle=pack.manifest.genStyle||'clean';
    const styleRow=mode!=='edit'&&anyGen&&h(InlineField,{key:'style',kind:'menu',label:'画风',help:h(Help,{text:GEN_HELP.style,label:'画风 说明'}),className:'ap-gen-row ap-gd-row is-style',value:style,
      options:GEN_STYLES.map(([value,label])=>({value,label})),onCommit:setStyle,
      trail:style!==packStyle&&saveStyle?h('button',{type:'button',className:'ap-inline-link ap-gd-style-save',onClick:()=>saveStyle(style).catch(e=>setError(errorText(e)))},'设为本包默认'):null});
    let fields;
    if(adding)fields=[
      h(InlineField,{key:'name',kind:'text',label:'服装名',className:'ap-gen-row ap-gd-row',value:name,placeholder:'例：冬装',maxLength:24,onCommit:v=>setName(v.trim())}),
      textField('wear','服装描述',wear,setWear,'款式、颜色、材质…'),
      row_('sheet','服装设定图',h('span',{className:'ap-gd-sheet'},sheetFile?chip('sheet',{url:sheetFile.url,name:'服装设定图',wide:true},()=>setSheetFile(null)):
          h('button',{type:'button',className:'ap-cat-add ap-gd-sheet-add','aria-label':'上传服装设定图',title:'上传服装设定图',onClick:()=>sheetInput.current?.click?.()},h(Glyph,{name:'upload'})),
        genFileInput(sheetInput,'上传服装设定图',f=>setSheetFile({file:f,url:typeof URL!=='undefined'&&URL.createObjectURL?URL.createObjectURL(f):null}))),{help:h(Help,{text:GEN_HELP.outfit,label:'服装设定图 说明'})}),
      h(InlineField,{key:'words',kind:'chips',label:'触发词',controlLabel:'服装触发词',className:'ap-gen-row ap-gd-row is-words',value:words,split:splitKeywords,validate:keywordProblem,onCommit:setWords}),
      row_('lamp','触发方式',h(LampMenu,{label:'触发方式',named:true,mode:lamp,onChange:setLamp})),
      row_('first','生成',h('span',{className:'ap-gd-checks'},!sheetFile&&genCheck(genSheet,setGenSheet,'同时生成服装设定图'),firstLabel&&genCheck(genFirst,setGenFirst,'生成「'+firstLabel+'」立绘＋头像')),
        {help:!sheetFile&&firstLabel&&h(Help,{text:GEN_HELP.first(firstLabel),label:'生成 说明'})}),
      anyGen&&refsRow,styleRow];
    else if(settei)fields=[fig?textField('face','外貌',figure.identityAppearance||'',writeLook,'发色、瞳色、身材…'):textField('wear','服装描述',outfit.outfitAppearance||'',writeWear,'款式、颜色、材质…'),
      refsRow,!fig&&said([lookSaid]),extra,styleRow];
    else fields=[outs.length>1&&row_('out','输出',h(Segmented,{className:'ap-gen-views',label:'输出',value:out,onChange:changeOut,options:outs})),refsRow,said([lookSaid,wearSaid]),extra,styleRow];
    const startKey=target?genKey(target):made.current?genKey(sheetNow?{kind:'settei',figureId:figure.id,outfitKey:made.current}:{kind:'sprite',figureId:figure.id,outfitKey:made.current,emotionId:first}):'';
    const startError=startKey&&gen.errors[startKey]&&!gen.pending[startKey]?gen.errors[startKey]:'';
    const title=adding?'添加服装':'生图',verb=mode==='redraw'?'重画':mode==='edit'?'改图':adding?(sheetNow||genFirst?'添加并生成':'添加'):'生成';
    const sub=adding?figure.name:fig?genWhere(figure.name,'人物设定图',redo&&'重画'):settei?genWhere(figure.name,outfit.label,'服装设定图',redo&&'重画'):
      genWhere(figure.name,outfit.label,row?.label,mode==='redraw'?'重画':mode==='edit'?'改图':'');
    const head=h('header',{className:'ap-gen-sheet-head'},h('h2',null,title),h('span',{className:'ap-gen-sheet-meta'},sub),settei&&h(Help,{text:fig?GEN_HELP.figure:GEN_HELP.outfit,label:(fig?'人物设定图':'服装设定图')+' 说明'}),
      h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:close}));
    const foot=h('footer',{className:'ap-gen-foot ap-gd-foot'},target&&h(GenPeek,{load:()=>inputNow().then(input=>gen.previewPrompt(target,input))}),busy&&h('span',{className:'ap-busy'},h(Spinner),'正在发送…'),
      h(Button,{disabled:busy,onClick:close},'取消'),h(Button,{primary:true,className:'ap-primary ap-gd-go',disabled:busy||!!reason,title:reason||'Ctrl+Enter',onClick:submit},verb!=='添加'&&h(Glyph,{name:'spark'}),verb));
    return h(Modal,{title:title+' · '+sub,className:'ap-gen-dialog',frame:{'data-mode':mode},onClose:close,busy,head,foot,initialFocus:'dialog'},
      h('div',{className:'ap-gd-body','data-mode':mode,onKeyDown:e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.target?.blur?.();setTimeout(()=>submitRef.current(),0);}}},
        h('div',{className:'ap-gd-fields'},...fields.filter(Boolean),
          gen.problem&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,gen.problem)),
          reason&&reason!==GEN_REASONS.edit&&!(adding&&!name.trim())&&h('p',{className:'ap-gen-reason'},reason),
          startError&&!gen.problem&&h('p',{className:'ap-alert',role:'alert'},startError),
          error&&h('p',{className:'ap-alert',role:'alert'},h(Glyph,{name:'warning'}),error))));
  }
  // ---------- The large view (查看大图) and the background / eight-face requests ----------
  // Desktop: the picture large on the left, checks / references beside it, actions at the foot. Phone: a full-screen
  // sheet — picture, then the rest, actions pinned to the bottom. A figure picture's 重画 / 改图 go to the dialog.
  function GenSheet({gen,binding,pack,importSettei}) {
    const {target,input}=gen.sheet,packId=pack.manifest.id,key=genKey(target),kind=target.kind;
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[redrawing,setRedrawing]=React.useState(false),[note,setNote]=React.useState('');
    const [words,setWords]=React.useState([]);
    const [changed,setChanged]=React.useState(false),[framing,setFraming]=React.useState(null),[view,setView]=React.useState('slices'),[prompt,setPrompt]=React.useState('');
    const job=gen.jobFor(target),pend=gen.pending[key],startError=!pend&&(gen.errors[key]||gen.sheet.error);
    const state=pend||job?.status==='running'?'running':job?.status==='candidate'?'candidate':job?.status==='save_failed'?'save_failed':job?.status==='failed'?'failed':'idle';
    const elapsed=useElapsed(job?.createdAt,state==='running');
    let title='',meta='',hash=null,figure=null,outfit=null,asset=null,ready=true,reason='';
    if(kind==='background'){asset=target.assetId?pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id===target.assetId):null;title=asset?.name||'新背景';hash=asset?.media||null;}
    else{
      figure=pack.figures?.[target.figureId];outfit=figure?.outfits.find(o=>o.key===target.outfitKey);meta=outfit?.label||'';
      const manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey],emotion=figure&&figureEditorEmotions(figure).find(r=>r.id===target.emotionId)?.label||'';
      title=kind==='settei'?'设定图':kind==='avatar-sheet'?'八个表情头像':emotion+(kind==='sprite'?'立绘':'头像');
      hash=kind==='settei'?outfit?.settei:kind==='sprite'?genOwnSprite(outfit,manifest,target.emotionId):kind==='avatar'?outfit?.avatars?.[outfitImageId(outfit,target.emotionId)]:null;
      reason=kind==='avatar-sheet'&&!genOwnSprite(outfit,manifest,genDefaultId(figure,outfit))&&!outfit?.settei?GEN_REASONS.sheet:'';
      ready=!reason;
    }
    const figureKind=['sprite','avatar','settei'].includes(kind),transparent=['sprite','avatar','avatar-sheet'].includes(kind),candidate=job?.candidate,sheetSlices=candidate?.slices||null;
    const run=fn=>{setBusy(true);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));};
    const close=()=>{if(!busy)gen.closeSheet();};
    const dialog=mode=>{gen.closeSheet();gen.openDialog(target,{mode});};
    const accept=opts=>run(async()=>{
      try{await gen.accept(job,{...opts,keywords:words});gen.closeSheet();}
      catch(e){
        if(e.code==='TARGET_CHANGED'){setChanged(true);return;}
        // The calm ruler could not align this sprite: the original picture goes to the framer instead (manual alignment).
        if(e.code==='ALIGNMENT_REQUIRED'){setFraming(await gen.candidateFile(job,null,false));return;}
        throw e;
      }
    });
    // A failed start is shown from gen.errors (one place), not repeated here.
    const generate=()=>run(async()=>{
      if(figureKind){dialog('gen');return;}
      if(kind!=='background'){await gen.start(target,input).catch(()=>{});return;}
      await gen.start(target,{userPrompt:prompt.trim()}).catch(()=>{});
    });
    const drop=()=>run(async()=>{await gen.reject(job);gen.closeSheet();});
    const references=job?.references||[];
    const first=figure&&genDefaultId(figure,outfit);
    const refName=r=>r.redraw?'上一张':r.hash===figure?.identitySettei?.board?'人物设定图':r.hash===outfit?.settei?'服装设定图':r.hash===outfit?.avatars?.[first]?'首个差分头像':r.purpose==='emotion-sprite'?'同差分立绘':'参考图';
    // The stage: progress, the candidate (a sheet as its eight cut cells or whole), the failure, or the current picture.
    const sliceWarnings=sheetSlices?Object.entries(sheetSlices).flatMap(([id,s])=>(s.checks?.warnings||[]).map(w=>({...w,id}))):[];
    const names=figure?Object.fromEntries(figureEditorEmotions(figure).map(r=>[r.id,r.label])):{};
    const stage=state==='running'?h('div',{className:'ap-gen-wait',role:'status'},h('span',{className:'ap-gen-wait-spin'},h(Spinner,{key:'wait',fill:true})),
        h('strong',null,pend==='queued'?'排队等待':pend?'正在发送':'正在生成'),!pend&&h('span',{className:'ap-gen-time'},elapsed),!pend&&gen.models[job?.jobId]&&h('small',null,gen.models[job.jobId])):
      state==='candidate'?(kind==='avatar-sheet'&&sheetSlices&&view==='slices'?h('div',{className:'ap-gen-slices'},(job.target.emotionIds||[]).map((id,i)=>id?h('figure',{key:id,className:'ap-gen-slice'},
          h('span',{className:'ap-gen-slice-art'},h(CandidateArt,{gen,jobId:job.jobId,emotionId:id}),(sheetSlices[id]?.checks?.warnings||[]).length>0&&h('span',{className:'ap-gen-flag',title:sheetSlices[id].checks.warnings.map(w=>w.message).join('\n')},h(Glyph,{name:'warning'}))),
          h('figcaption',null,names[id]||id)):h('span',{key:'skip'+i,className:'ap-gen-slice is-skip'}))):h(CandidateArt,{gen,jobId:job.jobId,className:'ap-gen-full'})):
      state==='failed'||state==='save_failed'?h('div',{className:'ap-gen-wait is-failed',role:'alert'},h(Glyph,{name:'warning'}),h('p',null,job?.error?.message||'生成失败')):
      hash?h(Thumb,{key:hash,binding,packId,hash,label:title,className:'ap-gen-full'}):h('span',{className:'ap-gen-empty'},h(Glyph,{name:'spark'}));
    const sideWarnings=candidate?[...(candidate.checks?.warnings||[]),...Object.values(sliceWarnings.reduce((acc,w)=>{(acc[w.code]||=({...w,ids:[]})).ids.push(w.id);return acc;},{})).map(w=>({...w,label:(GEN_WARNINGS[w.code]||w.message)+'：'+w.ids.map(id=>names[id]||id).join('、')}))]:[];
    const replaces=kind==='avatar-sheet'&&outfit?(job?.target.emotionIds||[]).filter(id=>id&&outfit.avatars?.[outfitImageId(outfit,id)]).length:0;
    // with nothing to say beside it (a picture just being looked at), the picture
    // takes the whole width, so a landscape 设定图 is not letterboxed into a tall empty stage.
    const side=[
      gen.problem&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,gen.problem)),
      state==='candidate'&&h(GenWarnings,{warnings:sideWarnings}),
      state==='candidate'&&kind==='background'&&!target.assetId&&h(InlineField,{kind:'chips',label:'触发词',controlLabel:'背景触发词',className:'ap-gen-row is-words',value:words,split:splitKeywords,validate:keywordProblem,onCommit:setWords,help:h(Help,{text:'填写 3–6 个正文里会出现的短词，如：教室、黄昏、樱花。',label:'触发词说明'})}),
      state==='candidate'&&['sprite','avatar'].includes(kind)&&h('div',{className:'ap-gen-tones','data-shape':kind},['light','dark'].map(tone=>h('span',{key:tone,className:'ap-gen-tone','data-tone':tone,title:tone==='light'?'浅色底':'深色底'},h(CandidateArt,{gen,jobId:job.jobId})))),
      state==='candidate'&&kind==='avatar-sheet'&&sheetSlices&&h(Segmented,{className:'ap-gen-view',label:'显示',value:view,onChange:setView,options:[['slices','切开'],['whole','原图']]}),
      replaces>0&&state==='candidate'&&h('p',{className:'ap-gen-reason'},'采用会替换已有的 '+replaces+' 个头像。'),
      state==='candidate'&&job?.userPrompt&&h('div',{className:'ap-gen-used'},h('span',{className:'ap-prop-key'},'提示词'),h('p',{className:'ap-gen-used-text'},job.userPrompt)),
      references.length>0&&state!=='idle'&&h('div',{className:'ap-gen-used'},h('span',{className:'ap-prop-key'},'参考'),h('div',{className:'ap-gen-refs'},references.map((r,i)=>h('span',{key:i,className:'ap-gen-ref is-static',title:refName(r)},
        r.hash&&pack.manifest.blobs?.[r.hash]?h(Thumb,{binding,packId,hash:r.hash,label:refName(r),className:'ap-gen-ref-art'}):h(Glyph,{name:'note'}))))),
      kind==='background'&&(state==='idle'||state==='failed')&&h('label',{className:'ap-gen-field'},h('span',{className:'ap-prop-key'},'想要什么样的背景'),
        h(TextArea,{className:'ap-gen-text',rows:4,maxLength:4000,autoFocus:true,value:prompt,placeholder:'例：黄昏的教室，窗外有樱花',onChange:setPrompt})),
      redrawing&&h('label',{className:'ap-gen-field'},h('span',{className:'ap-prop-key'},'想改哪里'),
        h(TextArea,{className:'ap-gen-text',rows:3,maxLength:1000,autoFocus:true,value:note,placeholder:'例：蝴蝶结换成红色，头发再长一点',onChange:setNote})),
      changed&&h('p',{className:'ap-gen-reason'},'这里已经换了一张图。'),
      !ready&&state==='idle'&&h('p',{className:'ap-gen-reason'},reason),
      startError&&h('p',{className:'ap-alert',role:'alert'},startError),
      error&&h('p',{className:'ap-alert',role:'alert'},error)].filter(Boolean);
    const sliced=kind!=='avatar-sheet'||!!sheetSlices;
    const actions=state==='running'?[h(Button,{key:'cancel',disabled:busy||pend==='starting',onClick:()=>run(()=>pend==='queued'?gen.dequeue(target):gen.cancel(job))},pend==='queued'?'取消排队':'取消生成')]:
      state==='candidate'&&redrawing?[h(Button,{key:'back',disabled:busy,onClick:()=>{setRedrawing(false);setNote('');}},'取消'),h(Button,{key:'go',primary:true,disabled:busy||!note.trim(),onClick:()=>run(async()=>{await gen.redraw(job,note.trim());setRedrawing(false);setNote('');})},'重画')]:
      state==='candidate'?[h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:drop},'不要'),
        figureKind?h(Button,{key:'redraw',disabled:busy,onClick:()=>dialog('redraw')},'重画…'):h(Button,{key:'redraw',disabled:busy,onClick:()=>setRedrawing(true)},'按意见重画'),
        changed?h(Button,{key:'replace',primary:true,disabled:busy,onClick:()=>accept({replace:true})},'仍用这张替换'):h(Button,{key:'yes',primary:true,disabled:busy||!sliced,title:sliced?undefined:'这张图不能自动切开',onClick:()=>accept()},kind==='avatar-sheet'?'采用全部':'采用')]:
      state==='save_failed'?[h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:drop},'不要'),h(Button,{key:'save',primary:true,disabled:busy,onClick:()=>run(()=>gen.retrySave(job))},'重试保存')]:
      state==='failed'?[h(Button,{key:'ok',disabled:busy,onClick:()=>run(async()=>{if(job)await gen.reject(job);gen.closeSheet();})},'知道了'),h(Button,{key:'again',primary:true,disabled:busy||kind==='background'&&!prompt.trim(),onClick:generate},figureKind?'调整后重试…':'重新生成')]:
      [kind==='settei'&&h(UploadButton,{key:'upload',label:'上传设定图',text:'上传替换',disabled:busy,onFile:file=>run(()=>importSettei(target.figureId,target.outfitKey,file))}),
        figureKind&&hash?h(Button,{key:'edit',disabled:busy,onClick:()=>dialog('edit')},'改图…'):null,
        h(Button,{key:'go',primary:true,disabled:busy||!ready||kind==='background'&&!prompt.trim(),title:ready?undefined:reason,onClick:figureKind&&hash?()=>dialog('redraw'):generate},h(Glyph,{name:'spark'}),figureKind?(hash?'重画…':'生成…'):hash?'重新生成':'生成')];
    const head=h('header',{className:'ap-gen-sheet-head'},h('h2',null,title),meta&&h('span',{className:'ap-gen-sheet-meta'},meta),h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:close}));
    return h(React.Fragment,null,
      h(Modal,{title:title+(meta?' · '+meta:''),className:'ap-gen-sheet'+(side.length?'':' is-wide'),onClose:close,busy,head,initialFocus:'dialog',
          foot:h('footer',{className:'ap-gen-foot'},busy&&h('span',{className:'ap-busy'},h(Spinner),'正在处理…'),actions)},
        h('div',{className:'ap-gen-stage','data-kind':kind,'data-checker':transparent&&(state==='candidate'||state==='idle'&&hash)?true:undefined},stage),
        side.length>0&&h('div',{className:'ap-gen-side'},...side)),
      framing&&h(Modal,{title:'调整立绘',className:'ap-framer-modal',closable:false,onClose:()=>setFraming(null)},
        h(ImageFramer,{file:framing,square:false,onCancel:()=>setFraming(null),onDone:file=>{setFraming(null);accept({file});}})));
  }
  // ---------- The 生图 page ----------
  // Outfits on top, the 差分 wall below, icon-led and compact. 人物: a 设定块 (the 人物设定图 slot + 外貌 as one inline line).
  // 服装: tiles, the selected one ringed (the page's one outfit choice, shared with 编辑); a dashed ＋ opens 添加服装.
  // 「服装名」: its one heading tool — ✦ⁿ 生成缺少的差分 (no dialog, U2), ✓ⁿ 全部采用, or the batch's n/m ■ — and its 设定块
  // (服装设定图 + 服装描述). 差分 N: a tile per 差分, the 立绘 to the chest with its 头像 in the corner. A tile opens its menu
  // (下载 / 重画… / 设为默认 / 上传图片 / 删除); a missing one is a dashed ✦ that opens the dialog, with ↩ 使用回退 in its corner; a new
  // picture waits on its tile with the ✕｜✓ pill. The first visit shows one coach mark where to start.
  function genOutfitArt(binding,pack,figure,outfit) {
    outfit=figureOutfitView(figure,outfit);
    const packId=pack.manifest.id,manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey],bust=outfit&&outfitHead(outfit,manifest);
    if(bust)return h(BustArt,{binding,packId,bust,figure,frame:CAST_FACE});
    const face=outfit&&selectPackAvatar({outfit,manifest,defaultEmotion:genDefaultId(figure,outfit)});
    if(face)return h(Thumb,{binding,packId,hash:face.hash,crop:face.crop,label:outfit.label,className:'ap-gen-outfit-thumb'});
    if(outfit?.settei)return h(Thumb,{binding,packId,hash:outfit.settei,label:outfit.label,className:'ap-gen-outfit-thumb'});
    return h(Silhouette,{figure});
  }
  const genOutfitKind=(pack,outfit)=>outfitHead(outfit,outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey])?'bust':'thumb';
  const GEN_COACH='dsh-tavern:gen-coach';
  const genCoachSeen=()=>{try{return typeof localStorage!=='undefined'&&localStorage.getItem(GEN_COACH)==='1';}catch(_){return false;}};
  const genCoachDone=()=>{try{localStorage.setItem(GEN_COACH,'1');}catch(_){}};
  // A new picture's decision: one pill — ✕ quiet, ✓ filled — at the foot of its tile (or beside its 设定图 slot).
  const GenDecide=({label,onNo,onYes,id})=>h('span',{className:'ap-gw-decide',role:'group','aria-label':label},
    h(IconButton,{icon:'close',label:'不要',className:'ap-icon-button ap-gw-no','data-gen-decide':'no-'+id,onClick:onNo}),
    h(IconButton,{icon:'check',label:'采用',className:'ap-icon-button ap-gw-yes','data-gen-decide':'yes-'+id,onClick:onYes}));
  const genFlag=cell=>(cell.state==='failed'||cell.error||cell.warnings?.length>0)&&h('span',{className:'ap-gen-flag',title:cell.state==='failed'?genFailText(cell.error):[cell.error&&'采用失败：'+cell.error,...(cell.warnings||[]).map(w=>w.message)].filter(Boolean).join('\n')},h(Glyph,{name:'warning'}));
  const genItem=(icon,text,onClick,extra={})=>h(MenuItem,{key:text,danger:extra.danger,onClick},h(Glyph,{name:icon}),h('span',null,text));
  // 设定块 slot: 人物设定图 or 服装设定图, a small 3:2 picture. Empty: dashed, ⤒ 上传 and ✦ 生成 (raised on hover / focus, always
  // on touch); filled: its menu (查看大图 / 下载 / 重画… / 上传图片 / 删除); a request: the ring, or the ✕｜✓ pill beside it.
  function GenSetteiSlot({c,level}) {
    const {gen,binding,packId,figure,outfit}=c,fig=level==='figure',name=fig?'人物设定图':'服装设定图';
    const target=fig?{packId,figureId:figure.id,kind:'identity-settei'}:{packId,figureId:figure.id,outfitKey:outfit.key,kind:'settei'},cell=genCell(gen,target);
    const hash=fig?figure.identitySettei?.board||null:outfit.settei||null,file=React.useRef(null),[view,setView]=React.useState(false);
    const upload=f=>c.run(()=>fig?c.identityBoard.upload(figure.id,f):c.settei.upload(figure.id,outfit.key,f));
    const input=genFileInput(file,'上传'+name,upload),base={className:'ap-gw-slot','data-gen-slot':target.kind};
    if(cell.state==='candidate')return h('div',{...base,'data-state':'candidate'},
      h('span',{className:'ap-gw-slot-art','data-checker':true},h(CandidateArt,{gen,jobId:cell.job.jobId}),genFlag(cell)),
      h(GenDecide,{label:'新'+name,id:level,onNo:()=>c.run(()=>gen.reject(cell.job)),onYes:()=>c.accept(cell.job)}));
    if(cell.state==='running'||cell.state==='queued')return h('div',{...base,'data-state':'running'},
      h('span',{className:'ap-gw-slot-art'},hash&&h('span',{className:'ap-gw-dim'},h(Thumb,{binding,packId,hash,label:name})),h(GenFaceMarks,{cell})));
    if(!hash)return h('div',{...base,'data-state':cell.state==='failed'?'failed':'empty',role:'group','aria-label':name},
      h('span',{className:'ap-gw-slot-art ap-gw-slot-empty'},
        h('span',{className:'ap-gw-slot-tools'},h(IconButton,{icon:'upload',label:'上传'+name,className:'ap-icon-button ap-gw-round',onClick:()=>file.current?.click?.()}),
          h(IconButton,{icon:'spark',label:'生成'+name+'…',className:'ap-icon-button ap-gw-round',onClick:()=>c.open(target,{mode:'gen'})})),genFlag(cell)),input);
    const remove=()=>c.ask({title:'删除'+name+'？',body:fig?'立绘、头像和服装设定图都不受影响。':'「'+outfit.label+'」的立绘和头像不受影响。',confirmLabel:'删除',danger:true,
      onConfirm:()=>fig?c.identityBoard.remove(figure.id):c.settei.remove(figure.id,outfit.key)});
    return h('div',{...base,'data-state':'filled'},
      h(Popover,{label:name+' 操作',className:'ap-face-menu-anchor',float:true,fit:true,limit:420,
        trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gw-slot-hit','aria-label':name,title:name,...cellMenuTrigger({open,toggle})},
          h('span',{className:'ap-gw-slot-art','data-checker':true},h(Thumb,{key:hash,binding,packId,hash,label:name}),genFlag(cell))),
        content:close=>{const go=fn=>()=>{close();fn();};return h('div',{className:'ap-cell-menu',onKeyDown:genMenuKeys},
          genItem('eye','查看大图',go(()=>setView(true))),
          genItem('export','下载',go(()=>c.run(()=>downloadPackMedia(binding,c.pack,hash,figure.name+'-'+(fig?'':outfit.label+'-')+name)))),
          genItem('reset','重画…',go(()=>c.open(target,{mode:'redraw'}))),
          genItem('upload','上传图片',go(()=>file.current?.click?.())),(fig?c.identityBoard.remove:c.settei.remove)&&genItem('remove','删除',go(remove),{danger:true}));}}),
      // 查看大图: the shared viewer; the old sheet's actions are its corner buttons (上传替换; a 服装设定图 also 改图… / 重画…).
      input,view&&h(PackImageView,{binding,packId,hash,label:name,onClose:()=>setView(false),actions:[
        {icon:'upload',label:'上传替换',onClick:()=>file.current?.click?.()},
        !fig&&{icon:'edit',label:'改图…',onClick:()=>{setView(false);c.open(target,{mode:'edit'});}},
        !fig&&{icon:'reset',label:'重画…',onClick:()=>{setView(false);c.open(target,{mode:'redraw'});}}]}));
  }
  // 人物 / 「服装」: the slot beside one inline line (R23: reads as text, ✎ on hover, Enter / leaving saves).
  function GenSettei({c,level}) {
    const fig=level==='figure';
    return h('div',{className:'ap-gw-settei',role:'group','aria-label':fig?'人物设定':'服装设定'},h(GenSetteiSlot,{c,level}),
      fig?h(InlineField,{kind:'text',label:'外貌',hideLabel:true,className:'ap-gw-line',placeholder:'外貌：发色、瞳色、身材…',maxLength:1000,value:c.figure.identityAppearance||'',onCommit:v=>c.write(()=>({identityAppearance:v||null}))}):
        h(InlineField,{key:c.outfit.key,kind:'text',label:'服装描述',hideLabel:true,className:'ap-gw-line',placeholder:'服装描述：款式、颜色、材质…',maxLength:1000,value:c.outfit.outfitAppearance||'',
          onCommit:v=>c.writeOutfit(o=>{const n={...o};if(v)n.outfitAppearance=v;else delete n.outfitAppearance;return n;})}));
  }
  // ↩ 使用回退 (owner U3) in a missing tile's corner: which 差分 stands in while it has none (setFigureEmotionFallback).
  function GenFallback({c,row,use}) {
    const pick=(close,v)=>()=>{close();if(v!==use)c.run(()=>c.setFallback(c.outfit.key,row.id,!!v,v&&v!==c.outfit.defaultEmotion?v:undefined));};
    const name=id=>c.rows.find(r=>r.id===id)?.label||'';
    // The corner holds the anchor (a floating menu copies its anchor's class, so the hide-until-hover rule stays outside).
    return h('span',{className:'ap-gw-fallback'},h(Popover,{label:'「'+row.label+'」使用回退',className:'ap-gw-fallback-pop',float:true,limit:300,
      trigger:({toggle,open})=>h(IconButton,{icon:'fallback',label:use?'使用回退：'+name(use):'使用回退…',className:'ap-icon-button ap-gw-round ap-gw-fallback-btn','aria-pressed':!!use,'aria-haspopup':'menu','aria-expanded':open,onClick:toggle}),
      content:close=>h('div',{className:'ap-gen-emotion-menu',onKeyDown:genMenuKeys},
        h('div',{className:'ap-gw-menu-head','aria-hidden':true},h(Glyph,{name:'fallback'}),h('b',null,'使用回退')),
        [{id:''},...c.rows.filter(r=>r.id!==row.id)].map(r=>h('button',{key:r.id||'none',type:'button',role:'menuitemradio','aria-checked':use===r.id,className:'ap-menu-item',onClick:pick(close,r.id)},
          h('span',null,r.id?r.label:'不回退'),use===r.id&&h(Glyph,{name:'check'}))))}));
  }
  const GenCoach=({text,onClose})=>h('span',{className:'ap-gw-coach',role:'note'},h(Glyph,{name:'spark'}),h('span',null,text),h(IconButton,{icon:'close',label:'知道了',className:'ap-icon-button ap-gw-coach-x',onClick:onClose}));
  // One 差分 tile of the wall.
  function GenWallCard({c,row,coach}) {
    const {gen,binding,packId,outfit}=c,id=row.id,isDefault=id===outfit.defaultEmotion;
    const sCell=genCell(gen,c.at('sprite',id)),aCell=genCell(gen,c.at('avatar',id)),busyState=s=>['running','queued','candidate'].includes(s.state);
    const live=busyState(sCell)?sCell:busyState(aCell)?aCell:null,failed=sCell.state==='failed'?sCell:aCell.state==='failed'?aCell:null;
    const spriteHash=c.sprite(id),avatarHash=c.avatar(id),hasSprite=c.hasSprite(id);
    const nameRow=h('span',{className:'ap-gw-name'},isDefault&&h('span',{className:'ap-gw-star',title:'默认差分'},h(Glyph,{name:'star'})),h('span',null,row.label));
    const base={role:'listitem',className:'ap-gw-card','data-emotion':id};
    if(live?.state==='candidate'){const both=[sCell,aCell].filter(x=>x.state==='candidate'&&!x.sheet).map(x=>x.job);
      return h('div',{...base,'data-state':'candidate'},
        h('span',{className:'ap-gw-art','data-checker':true},h('span',{className:'ap-gw-face-art'},h(CandidateArt,{gen,jobId:live.job.jobId,emotionId:live.sheet?id:null})),genFlag(live),
          both.length?h(GenDecide,{label:'「'+row.label+'」新图',id,onNo:()=>c.run(()=>Promise.all(both.map(j=>gen.reject(j)))),onYes:()=>c.acceptAll(both)}):
            h(IconButton,{icon:'eye',label:'查看八个头像',className:'ap-icon-button ap-gw-round ap-gw-sheet',onClick:()=>gen.openSheet(live.sheet)})),nameRow);}
    if(live)return h('div',{...base,'data-state':live.state,title:live.after?'采用前一张图后开始':undefined},
      h('span',{className:'ap-gw-art'+(hasSprite||avatarHash?'':' ap-gw-missing')},spriteHash||avatarHash?h('span',{className:'ap-gw-face-art ap-gw-dim'},h(Thumb,{binding,packId,hash:spriteHash||avatarHash,label:row.label})):null,h(GenFaceMarks,{cell:live})),nameRow);
    if(!hasSprite&&!avatarHash){
      const use=standInValue(outfit,id),standArt=use&&(c.sprite(use)||c.avatar(use));
      return h('div',{...base,'data-state':'missing','data-first':coach?true:undefined},
        h('button',{type:'button',className:'ap-gw-hit ap-gw-ghost','aria-label':'生成「'+row.label+'」…',title:failed?genFailText(failed.error):'生成「'+row.label+'」…',onClick:()=>c.open(c.at('sprite',id),{mode:'gen',out:'both'})},
          h('span',{className:'ap-gw-art ap-gw-missing'},standArt&&h('span',{className:'ap-gw-face-art ap-gw-stand'},h(Thumb,{binding,packId,hash:standArt,label:row.label})),
            h('span',{className:'ap-gw-ghost-mark'},h(Glyph,{name:'spark'})),failed&&genFlag(failed)),nameRow),
        !c.blank&&!isDefault&&c.setFallback&&h(GenFallback,{c,row,use}),coach);}
    const art=spriteHash?h(Thumb,{binding,packId,hash:spriteHash,label:row.label}):hasSprite&&c.bust(id)?h(BustArt,{binding,packId,bust:c.bust(id),figure:c.figure,frame:CAST_FACE}):h(Thumb,{binding,packId,hash:avatarHash,label:row.label});
    // 下载: the tile's own picture file — its still 立绘, or the 头像 of a 差分 without one (a model / parts 立绘 has no single file).
    const fileHash=spriteHash||(!hasSprite&&avatarHash),fileName=c.figure.name+'-'+outfit.label+'-'+row.label+(spriteHash?'立绘':'头像');
    const remove=()=>c.ask({title:'删除「'+row.label+'」？',body:'「'+outfit.label+'」里「'+row.label+'」的立绘和头像会被删除；差分本身和其他服装不受影响。',confirmLabel:'删除',danger:true,
      onConfirm:async()=>{if(hasSprite)await c.removeFigureImage(c.figure.id,outfit.key,id,'sprite');if(avatarHash)await c.removeFigureImage(c.figure.id,outfit.key,id,'avatar');}});
    return h('div',{...base,'data-state':'filled'},
      h(Popover,{label:row.label+' 操作',className:'ap-face-menu-anchor',float:true,fit:true,limit:460,
        trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gw-hit','aria-label':row.label,title:failed?genFailText(failed.error):undefined,...cellMenuTrigger({open,toggle,onMenu:()=>c.onPick?.(id)})},
          h('span',{className:'ap-gw-art'},h('span',{className:'ap-gw-face-art','data-kind':spriteHash||hasSprite?'sprite':'avatar'},art),
            hasSprite&&h('span',{className:'ap-gw-face','data-empty':!avatarHash||undefined,title:avatarHash?undefined:'没有头像'},avatarHash?h(Thumb,{binding,packId,hash:avatarHash,label:row.label+'头像'}):h(Glyph,{name:'plus'})),
            failed&&genFlag(failed)),nameRow),
        content:close=>{const go=fn=>()=>{close();fn();};return h('div',{className:'ap-cell-menu',onKeyDown:genMenuKeys},
          fileHash&&genItem('export','下载',go(()=>c.run(()=>downloadPackMedia(binding,c.pack,fileHash,fileName)))),
          genItem('reset','重画…',go(()=>c.open(c.at(hasSprite&&c.takes(id)?'sprite':'avatar',id),{mode:'redraw',out:hasSprite&&c.takes(id)?'sprite':'avatar'}))),
          !isDefault&&genItem('star','设为默认',go(()=>c.writeOutfit(o=>({...o,defaultEmotion:id})))),
          c.uploadSprite&&c.takes(id)&&genItem('upload','上传图片',go(()=>c.uploadSprite(id))),
          c.removeFigureImage&&genItem('remove','删除',go(remove),{danger:true}));}}));
  }
  function FigureGenTab({binding,pack,figure,outfit,onOutfit,onPick,write,writeOutfit,gen,settei,identityBoard,uploadSprite,removeFigureImage,setFallback}) {
    const packId=pack.manifest.id,[confirm,setConfirm]=React.useState(null),[error,setError]=React.useState(''),[accepting,setAccepting]=React.useState(false),[coach,setCoach]=React.useState(()=>!genCoachSeen());
    React.useEffect(()=>{gen.open();},[]);
    const run=fn=>{setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e)));};
    // 采用: a 立绘 the 平和 ruler could not align (or a slot changed meanwhile) goes to the large view, which handles both.
    const accept=job=>run(()=>gen.accept(job).catch(e=>{if(['ALIGNMENT_REQUIRED','TARGET_CHANGED'].includes(e?.code)){gen.openSheet(job.target);return;}throw e;}));
    const endCoach=()=>{if(coach){genCoachDone();setCoach(false);}};
    const open=(target,extra={})=>{endCoach();gen.openDialog(target,{...extra,onOutfit});};
    const manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey],rows=outfit?outfitEmotionRows(figure,outfit,manifest):[];
    const c={gen,binding,pack,packId,figure,outfit,rows,write,writeOutfit,settei,identityBoard,uploadSprite,removeFigureImage,setFallback,onPick,run,accept,open,ask:setConfirm,
      acceptAll:list=>{setAccepting(true);return gen.acceptAll(list).finally(()=>setAccepting(false));},
      at:(kind,emotionId)=>({packId,figureId:figure.id,outfitKey:outfit.key,kind,emotionId}),
      sprite:id=>genOwnSprite(outfit,manifest,id),avatar:id=>outfit?.avatars?.[outfitImageId(outfit,id)]||null,hasSprite:id=>!!outfit&&emotionMapped('sprite',outfit,manifest,id),
      takes:id=>spriteSlotTakesStill(outfit,manifest,id),bust:id=>outfit.sprite&&stateBust(outfit,emotionState(outfit,manifest,id))};
    c.blank=!!outfit&&rows.every(r=>!c.hasSprite(r.id)&&!c.avatar(r.id));
    const head=(text,count,tools,className)=>h('h4',{className:'ap-gw-head'+(className?' '+className:'')},h('span',null,text),count!==undefined&&h('span',{className:'ap-gw-count'},count),tools&&h('span',{className:'ap-gw-tools'},tools));
    const problem=gen.problem&&!gen.sheet&&!gen.dialog&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,gen.problem));
    const person=h('section',{className:'ap-gw-sec','aria-label':'人物'},head('人物'),h(GenSettei,{c,level:'figure'}));
    const dialogs=confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)});
    if(!outfit)return h('div',{className:'ap-gen-tab ap-gw'},problem,h(ErrorBox,{error}),person,h(EmptyState,{noun:'服装'}),dialogs);
    const outfits=h('section',{className:'ap-gw-sec','aria-label':'服装'},head('服装',figure.outfits.length),
      h('div',{className:'ap-gw-outfits',role:'list'},figure.outfits.map(o=>h('div',{key:o.key,role:'listitem'},
          h('button',{type:'button',className:'ap-gw-outfit','aria-pressed':o.key===outfit.key,title:o.label,onClick:()=>{if(o.key!==outfit.key)onOutfit(o.key);}},
            h('span',{className:'ap-gen-outfit-art','data-kind':genOutfitKind(pack,o)},genOutfitArt(binding,pack,figure,o)),h('span',{className:'ap-gw-outfit-name'},o.label)))),
        h('div',{role:'listitem',className:'ap-gw-outfit-addcell'},h(CatAddTile,{label:'添加服装',className:'ap-gw-outfit-add',onClick:()=>open({packId,figureId:figure.id,outfitKey:outfit.key,kind:'settei'},{mode:'outfit'})}))));
    // The heading's one tool. ✦ⁿ fills what is missing — a 立绘 (its 头像 follows its 采用) or a 头像 whose 立绘 is there — for the
    // 差分 with no 回退 and nothing in flight or waiting, each with its default description; it never replaces a picture. A
    // blank outfit starts from one tile instead (the coach points there).
    const cells=rows.map(r=>[r,genCell(gen,c.at('sprite',r.id)),genCell(gen,c.at('avatar',r.id))]);
    const waiting=cells.flatMap(([,s,a])=>[s,a]).filter(x=>x.state==='candidate'&&!x.sheet&&x.job).map(x=>x.job),waitingCells=cells.filter(([,s,a])=>[s,a].some(x=>x.state==='candidate'&&!x.sheet)).length;
    const idle=x=>x.state==='idle'||x.state==='failed';
    const todo=cells.filter(([r,s,a])=>idle(s)&&idle(a)&&(!c.hasSprite(r.id)&&c.takes(r.id)&&!outfit.fallbackEmotions?.includes(r.id)||c.hasSprite(r.id)&&!c.avatar(r.id))).map(([r])=>r);
    const fill=()=>{endCoach();run(()=>gen.batch(todo.map(r=>c.hasSprite(r.id)?{target:c.at('avatar',r.id),input:{userPrompt:genPromptFor(outfit,'avatar',r)}}:
      {target:c.at('sprite',r.id),input:{userPrompt:genPromptFor(outfit,'sprite',r),...(c.avatar(r.id)?{}:{followUp:[{kind:'avatar',emotionId:r.id,userPrompt:genPromptFor(outfit,'avatar',r)}]})}})));};
    const progress=gen.progress,ours=!!progress&&progress.keys.some(k=>{const p=k.split('/');return p[1]===figure.id&&p[2]===outfit.key;});
    const badge=(icon,label,n,onClick,name)=>h('span',{className:'ap-gw-badged'},h(IconButton,{icon,label,className:'ap-icon-button ap-gw-accent','data-gen-tool':name,disabled:accepting,onClick}),h('span',{className:'ap-gw-badge','aria-hidden':true},n));
    const tool=ours?h('span',{className:'ap-gw-progress',role:'status','aria-label':'正在生成 '+progress.done+'/'+progress.total},h(Spinner,{delay:0}),h('span',null,progress.done+'/'+progress.total),h(IconButton,{icon:'stop',label:'停止',onClick:()=>gen.stop()})):
      waitingCells>1?badge('check','全部采用（'+waitingCells+'）',waitingCells,()=>c.acceptAll(waiting),'accept-all'):
      todo.length&&!c.blank?badge('spark','生成缺少的 '+todo.length+' 个差分',todo.length,fill,'fill'):null;
    const mine=(gen.jobs||[]).some(j=>j.target.figureId===figure.id&&j.target.outfitKey===outfit.key&&genShown(j));
    const first=genDefaultId(figure,outfit),start=coach&&!mine?(c.blank?first:todo.find(r=>!c.hasSprite(r.id))?.id):null;
    const wall=h('section',{className:'ap-gw-sec ap-gw-outfit-block','aria-label':'「'+outfit.label+'」'},
      head('「'+outfit.label+'」',undefined,tool,'is-outfit'),
      h(GenSettei,{c,level:'outfit'}),
      head('差分',rows.length),
      h('div',{className:'ap-gw-wall',role:'list','aria-label':'差分',onClickCapture:endCoach},rows.map(r=>h(GenWallCard,{key:r.id,c,row:r,
        coach:r.id===start?h(GenCoach,{text:c.blank?'从这一格开始':'虚线格 = 缺图，点击生成',onClose:endCoach}):null}))));
    return h('div',{className:'ap-gen-tab ap-gw'},problem,h(ErrorBox,{error}),person,outfits,wall,dialogs);
  }
  // ---------- 设置 → 舞台 → 素材生图: the shared layer of every whole-image request, for all characters ----------
  // One folded section per kind with its template text (asset-generation.js prompts / setPrompt; the default stays in the
  // template file). The {{slots}} carry the character, the outfit, the 差分 and the cell's own prompt, so an edit keeps
  // them (checked here as the field's own validation and again on write). Enter or leaving the field saves (Shift+Enter: a
  // new line); a blue dot marks an edited kind and ⟲ 恢复默认 drops the edit. CG has no in-app generator, so no section.
  const GEN_PROMPT_KINDS={sprite:'立绘',avatar:'头像','avatar-sheet':'八个表情',settei:'服装设定图','identity-settei':'人物设定图',background:'背景'};
  const GEN_PROMPT_USE={sprite:'生成立绘',avatar:'生成单个头像','avatar-sheet':'一次生成八个表情',settei:'生成服装设定图','identity-settei':'生成人物设定图',background:'生成背景'};
  const genSlots=text=>[...new Set([...String(text).matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))];
  function GenPromptSettings({call}) {
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[alert,setAlert]=React.useState(''),[saving,setSaving]=React.useState(''),[confirm,setConfirm]=React.useState(null),[epoch,setEpoch]=React.useState(0);
    const current=React.useRef(null),queue=React.useRef(Promise.resolve());
    const accept=value=>{current.current=value;setData(value);};
    const load=()=>call('getAssetGenPrompts').then(r=>{accept(r.data);setError('');},e=>setError(errorText(e)));
    React.useEffect(()=>{load();},[call]);
    // Serial writes on the newest revision; a refused one shows the stored text again with the reason.
    const write=(kind,text)=>{const task=queue.current.then(async()=>{
      setSaving('saving');setAlert('');
      try{accept((await call('setAssetGenPrompt',{kind,text,expectedRevision:current.current.revision})).data);setSaving('saved');}
      catch(e){setSaving('');setAlert(e?.code==='REVISION_CONFLICT'?e.message:errorText(e));if(e?.code==='REVISION_CONFLICT')await load();setEpoch(n=>n+1);}
    });queue.current=task.catch(()=>{});return task;};
    const known=new Set((data?.kinds||[]).flatMap(k=>k.required));
    const problem=k=>text=>{
      const used=genSlots(text),unknown=used.filter(v=>!known.has(v)),missing=k.required.filter(v=>!used.includes(v));
      return !text.trim()?'不能为空':unknown.length?'没有这个占位符：'+unknown.map(v=>'{{'+v+'}}').join(' '):missing.length?'请保留 '+missing.map(v=>'{{'+v+'}}').join(' '):'';
    };
    const section=k=>{const name=GEN_PROMPT_KINDS[k.kind];
      return h(StageSection,{key:k.kind,title:name,meta:k.edited?h(OverrideDot,{label:'已改'}):undefined,foldKey:'gen-prompt:'+k.kind,defaultFolded:true,
        help:GEN_PROMPT_USE[k.kind]+'时附上的固定要求，所有人物共用。{{…}} 是每次填入的内容，要保留。',
        action:k.edited&&h(IconButton,{icon:'reset',label:'恢复默认',onClick:()=>setConfirm(k.kind)})},
        h(InlineField,{key:k.kind+'/'+epoch,kind:'text',multiline:true,lines:true,wide:true,hideLabel:true,label:name,className:'ap-gen-prompt-field',
          value:k.text.trimEnd(),maxLength:12000,validate:problem(k),onCommit:text=>write(k.kind,text)}));};
    return h('div',{className:'ap-ui ap-gen-prompts'},
      h('p',{className:'ap-save-state',role:'status'},saving==='saving'?'正在保存…':saving==='saved'?'已保存':''),
      !data&&!error&&h(Loading,{shape:'fields',count:4}),
      h(ErrorBox,{error,reload:load}),
      alert&&h('p',{className:'ap-alert',role:'alert'},h(Glyph,{name:'warning'}),alert),
      data&&data.kinds.filter(k=>GEN_PROMPT_KINDS[k.kind]).map(section),
      confirm&&h(ConfirmDialog,{title:'恢复默认',body:'「'+GEN_PROMPT_KINDS[confirm]+'」改过的内容会丢失。',confirmLabel:'恢复默认',onClose:()=>setConfirm(null),
        onConfirm:()=>write(confirm,null)}));
  }
