// A lease refresh changes URLs, never event identity or ownership of a playing track.
// audible(): the sound policy (foreground.js) - an SE that would start while DSH Tavern is not in front is dropped.
function createWidgetMedia({createAudio,bind=()=>{},release=()=>{},schedule=setTimeout,cancel=clearTimeout,audible=()=>true}) {
    const scopes=new Map();
    function acquire(key) {
        let owner=scopes.get(key);
        if (!owner) {owner={users:0,tracks:new Map(),seen:new Set(),value:null,pending:null};scopes.set(key,owner);}
        if(owner.pending)cancel(owner.pending);
        owner.pending=null;owner.users++;
        const stop=asset=>{const track=owner.tracks.get(asset);if(track){track.audio.pause();release(track.audio);track.audio.removeAttribute?.('src');owner.tracks.delete(asset);}};
        const api={
            update(value) {
                owner.value=value;
                for(const [asset,track] of owner.tracks) {
                    if(!value.active || !value.policy?.[track.kind] || value.assets?.[asset]?.identity!==track.identity)stop(asset);
                    else if(value.playback?.paused){if(track.kind==='music')track.audio.pause();else stop(asset);}
                    else {
                        const item=value.assets[asset];
                        if(track.volume!==item.volume){bind(track.audio,track.kind,track.url,item);track.volume=item.volume;}
                        if(track.kind==='music' && track.audio.paused)Promise.resolve(track.audio.play()).catch(()=>stop(asset));
                    }
                }
            },
            stop,
            play(asset,eventToken) {
                const value=owner.value,item=value?.assets?.[asset],playback=value?.playback || {};
                if(!value?.active || playback.paused || !item || !['music','sfx'].includes(item.kind) || !value.policy?.[item.kind])return false;
                if(item.kind==='sfx') {
                    // A live arrival, or a settled history page's replay of its line (playback.replay), sounds once per event.
                    if(playback.mode!=='live' && !playback.replay || !playback.fresh || !eventToken || eventToken!==playback.eventToken || !audible())return false;
                    const identity=eventToken+':'+asset;if(owner.seen.has(identity))return false;owner.seen.add(identity);
                } else {
                    if(owner.tracks.get(asset)?.identity===item.identity)return true;
                    for(const [id,track] of owner.tracks)if(track.kind==='music')stop(id);
                }
                stop(asset);
                const audio=createAudio(item.url);audio.loop=item.kind==='music';bind(audio,item.kind,item.url,item);
                owner.tracks.set(asset,{audio,kind:item.kind,identity:item.identity,url:item.url,volume:item.volume});
                audio.addEventListener?.('ended',()=>{if(owner.tracks.get(asset)?.audio===audio)stop(asset);},{once:true});
                Promise.resolve(audio.play()).catch(()=>{if(owner.tracks.get(asset)?.audio===audio)stop(asset);});return true;
            },
            dispose() {if(--owner.users===0)owner.pending=schedule(()=>{if(!owner.users){for(const asset of owner.tracks.keys())stop(asset);scopes.delete(key);}},0);}
        };return api;
    }
    // skip is silent - every widget SE still sounding stops; music (persistent) keeps playing.
    function stopSfx() {
        for(const owner of scopes.values())for(const [asset,track] of owner.tracks)if(track.kind==='sfx'){track.audio.pause();release(track.audio);track.audio.removeAttribute?.('src');owner.tracks.delete(asset);}
    }
    return {acquire,stopSfx,dispose(){for(const owner of scopes.values()){if(owner.pending)cancel(owner.pending);for(const {audio} of owner.tracks.values()){audio.pause();release(audio);}}scopes.clear();}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createWidgetMedia};
