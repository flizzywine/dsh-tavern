// Capability-scoped client adapter. Transport authentication belongs to the supplied ports.
// engineRpc — a machine-wide RPC sent without the session (the judge RPCs refuse unknown fields).
function createAssetPackBinding({service,rpc,engineRpc,settings,download,readExport,origin,scope,onUnavailable,seedUpdates,tts}) {
  if(service?.apiVersion!==2||!Array.isArray(service.capabilities)||!service.capabilities.includes('packs'))throw new Error('素材插件不支持 v2');
  let active=true,settingsSnapshot=null;
  const cleanup=new Set(),settingsListeners=new Set();
  const alive=()=>{if(!active)throw new Error('素材插件已卸载');};
  // 全局启用 is one cross-card flag shown by 素材库 and 舞台设置 at once; both re-render on any change.
  const notifySettings=()=>{for(const fn of [...settingsListeners])fn();};
  const binding={service,rpc,engineRpc,settings,download,readExport,seedUpdates,tts,
    get globalEnabledPackIds(){return settingsSnapshot?.values.globalEnabledPackIds||[];},
    async loadSettings(){alive();if(settings){const snapshot=await settings.read();alive();settingsSnapshot=snapshot;notifySettings();}return settingsSnapshot;},
    async setGlobalEnabled(packId,enabled){alive();if(!settingsSnapshot)await binding.loadSettings();const ids=settingsSnapshot.values.globalEnabledPackIds;const result=await settings.save({expectedRevision:settingsSnapshot.revision,globalEnabledPackIds:enabled?[...new Set([...ids,packId])]:ids.filter(id=>id!==packId)});alive();settingsSnapshot=result;notifySettings();return result;},
    onSettings(listener){settingsListeners.add(listener);return()=>settingsListeners.delete(listener);},
    async previewMedia({packId,hash}){alive();const lease=await service.leaseMedia({packId,hash,origin,scope});const release=()=>{cleanup.delete(release);service.releaseLease(lease.ticket);};if(!active){release();throw new Error('素材插件已卸载');}cleanup.add(release);return {url:lease.url,release};},
    onUnavailable(listener){const stop=onUnavailable?.(()=>{binding.dispose();listener();});if(stop)cleanup.add(stop);return()=>{stop?.();cleanup.delete(stop);};},
    dispose(){if(!active)return;active=false;for(const fn of [...cleanup])fn();cleanup.clear();settingsListeners.clear();settingsSnapshot=null;}
  };
  // Another surface (or another window) saved the settings: the change feed carries {type:'settings'}.
  const stopFeed=service.subscribe?.(event=>{if(active&&event?.type==='settings'&&settings)binding.loadSettings().catch(()=>{});});
  if(typeof stopFeed==='function')cleanup.add(stopFeed);
  return binding;
}
