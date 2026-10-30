// Card figure faces for stage widgets and the live room (see useCardFaces).
const cardFaceJobs=new Set(),cardFaceNoSubscribe=()=>()=>{};
// the faces of card figures named by alias or name — the
// identity resolver's card figure (config.characters[] holds every enabled figure of the card's and the global packs;
// its avatarMedia.default is the face the transcript shows), prepared in the session avatar cache whether or not the
// figure is on stage (the stage only hands over its visible cast's faces). Shared by the phone's contacts and the live
// room's host bar. Returns Map name → ready face URL (cropped thumbnail); a name with no figure or no face is absent.
// px: the face's CSS size when it must be sharp at that size (the live-room bar asks 96 so a 1.5× screen gets 144 px);
// without it any prepared size of the face will do. A smaller one already prepared shows until the sharp one is ready.
function useCardFaces({config,sessionId,source,names,px}) {
    const faceCache=typeof avatarCache==='undefined' ? null : avatarCache;
    const cardFace=name=>{const descriptor=name ? bubbleCharacter(config,name)?.avatarMedia?.default : null;return descriptor ? {...descriptor,sessionId} : null;};
    const faces=React.useSyncExternalStore(faceCache?.subscribe || cardFaceNoSubscribe,()=>faceCache ? names.map(name=>{const face=cardFace(name);return face && (px && faceCache.get(face,px) || faceCache.ready(face)) || '';}).join('\n') : '');
    const urls=new Map(faces ? names.map((name,i)=>[name,faces.split('\n')[i]]).filter(([,url])=>url) : []);
    const missing=names.filter(name=>cardFace(name) && (!urls.has(name) || px && !faceCache.get(cardFace(name),px)));
    const missingKey=JSON.stringify([sessionId,source?.sessionId,source?.authorityEpoch,px,missing.map(name=>cardFace(name).identity)]);
    React.useEffect(()=>{
        const owner=typeof stageSessions!=='undefined' ? stageSessions.resourceOwner : null;
        if (!faceCache || !owner || !source?.sessionId || !missing.length) return;
        const authority=JSON.stringify([source.sessionId,source.authorityEpoch]);
        for (const name of missing) {
            const face=cardFace(name),{sessionId:_session,...descriptor}=face,job=JSON.stringify([authority,face.identity,face.revision,face.crop,px]);
            if (cardFaceJobs.has(job)) continue;
            cardFaceJobs.add(job);
            // Widget faces are not the entry page's speakers: during a stage entry they lease once it is shown.
            const entering=typeof galEntryShown!=='undefined' && !galEntryShown.get() && !!document.querySelector('.fork-gal-stage');
            (entering ? galEntryShown.settled().then(()=>owner.acquire(descriptor,authority)) : Promise.resolve(owner.acquire(descriptor,authority))).then(async pin=>{try {await faceCache.prepare(face,pin.handle.url,px);} finally {pin.release();}}).catch(()=>{}).finally(()=>cardFaceJobs.delete(job));
        }
    },[missingKey]);
    return urls;
}
