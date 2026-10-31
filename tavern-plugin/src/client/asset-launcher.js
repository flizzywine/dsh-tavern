// one workbench, one slot registration, one transport lifetime.
let packTransport;
const packUi = createAssetPackUI(React,{VoicePicker:BubbleLibraryPicker,AvatarImage:PackImage,HelpTip:typeof HelpTip==='function'?HelpTip:undefined,
    live2d:typeof LIVE2D_PREVIEW_KIT==='object'?LIVE2D_PREVIEW_KIT:undefined,
    // the Spine importer's reader and live preview (spine-preview.js).
    spine:typeof forkSpineKit==='function'?forkSpineKit():undefined,
    // 舞台设置 › 基础设置 「自动生成选项」 reads/writes through the one preference hook.
    autoChoices:typeof useAutoChoicesPreference==='function'?useAutoChoicesPreference:undefined,
    // 开场画面 previews the stage's compensating background grade (same math as the live stage).
    timeGrade:projection=>{const grade=createPackSceneLayers()(projection).backgroundGrade;return galMatrix.isIdentity(grade)?null:grade;},
    emotions:{moods:BUBBLE_MOODS,max:CUSTOM_MOOD_MAX,colors:customMoodColors,upsert:(list,value)=>emotionUpsert(list,value)}});
const packListeners = new Set();
let packRevision = 0;
function notifyPackChange(event) { packRevision++; for (const fn of packListeners) fn(event); }
function usePackRevision(select) { return React.useSyncExternalStore(fn => { packListeners.add(fn); return () => packListeners.delete(fn); }, select || (() => packRevision)); }
function packClient() { return packTransport?.available() ? packTransport.service : undefined; }
// 舞台设置 ↔ 素材库 deep links. The target waits here until the library tab consumes it.
let stageSidebar;
const packNav = (function () {
    let pending = null; const listeners = new Set();
    return { go(target) { pending = target || {}; for (const fn of [...listeners]) fn(); }, take() { const next = pending; pending = null; return next; },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
})();
function navFailed(label, error) { try { tavernErrorHub.report(label, error); } catch (_) { console.warn(label, error); } }
function openSidebarTab(type, sessionId) {
    if (!stageSidebar) return Promise.reject(new Error('当前页面无法切换侧栏标签'));
    return Promise.resolve().then(() => stageSidebar.openTab({ type }, sessionId ? { sessionId } : undefined));
}
// the first entry into 舞台模式 on a card that binds no
// 素材包 opens 舞台设置 straight on 设置向导 instead (once per card; packUi.stageSetup decides and holds the request until
// the page takes it). null: enter as usual; else a promise of whether the wizard opened.
function stageSetupGate(sessionId, current = () => true) {
    const data = bubbleStore.get(sessionId);
    return packUi.stageSetup.enter({ current, service: packClient(), path: data?.cardPath, stageOn: data?.config?.stage?.director === true,
        open: () => openSidebarTab('dsh-tavern:bubbles', sessionId) });
}
function stageNav(sessionId) {
    return { openTab: type => openSidebarTab(type, sessionId).catch(error => navFailed('打开侧栏标签', error)),
        // a pack opened from 舞台设置 gets the sub-page ‹ back to it.
        openLibrary: target => { packNav.go(target && target.packId ? { ...target, back: { label: '舞台设置', open: () => openSidebarTab('dsh-tavern:bubbles', sessionId).catch(error => navFailed('返回舞台设置', error)) } } : target); return openSidebarTab('dsh-asset-library:library', sessionId).catch(error => navFailed('打开舞台素材', error)); } };
}
// a card save from 舞台设置 / 素材库 shows at once, as 开启 BGM does: the card's dialogue
// settings reload (the BGM player follows stage.music) and an open stage re-projects (BGM / 音效 / 环境音, default skin),
// instead of waiting for the 60 s poll or the next turn.
function cardStageSaved(sessionId) {
    if (!sessionId) return;
    bubbleStore.load(sessionId, true);
    const store = typeof stageSessions !== 'undefined' ? stageSessions.get(sessionId) : null, source = store?.getSnapshot().source;
    if (source) store.dispatch({ type: 'REFRESH_BEGIN', source });
}
function workbenchRpc(sessionId) {
    return (method,args) => rpc(method,args || {},sessionId).then(result => { if (method === 'saveCardAssetBindings' || method === 'saveAssetEngineSettings') cardStageSaved(sessionId); return result; });
}
// machine-wide engine RPCs (getJudgeConfig …) take no sessionId: their strict
// argument check refuses it, so they go out without the session.
function engineRpc(method,args) { return rpc(method,args || {}); }
function PackWorkbench({sessionId,cardPath,cardName,cardStamp,loading,page = 'library',prompts}) {
    usePackRevision();
    const transport = packTransport, service = packClient(), tts=forkTtsScope?.get('ttsClient');
    const binding = React.useMemo(() => service ? createAssetPackBinding({service,tts,
        rpc:workbenchRpc(sessionId), engineRpc:engineRpc, settings:transport.settings,
        download:result => transport.download(result), readExport:result => transport.bytes(result),
        onUnavailable:fn => transport.onUnavailable(fn)
    }) : {rpc:workbenchRpc(sessionId),engineRpc:engineRpc,download:result=>transport.download(result),tts}, [transport,service,sessionId,tts]);
    const nav = React.useMemo(() => stageNav(sessionId), [sessionId]);
    React.useEffect(() => () => binding?.dispose?.(),[binding]);
    // the Tavern 舞台 tab is one card-centric page.
    // the host's tab body is a fixed-height column that clips (overflow: hidden) and
    // scrolls nothing itself, so a page taller than the panel was cut off. The page scrolls in its own box (.fork-tab-scroll).
    const page_=page==='stage'?React.createElement(packUi.StagePanel,{binding,sessionId,cardPath,cardName,loading,nav,prompts}):
        React.createElement(packUi.App,{key:service ? 'available' : 'unavailable',enabled:true,binding,nav:packNav,sessionId,cardPath,cardStamp});
    return React.createElement('div',{className:'fork-tab-scroll'},page_);
}
// the library owns no card, but it reads the open chat's card (when there is one) so a
// pack bound to that card shows 「本卡使用」 and is listed right after the 全局 packs instead of claiming 「关闭」. Without a chat it shows
// global state only.
function AssetLibraryTab(props) {
    const sessionId=props.scope?.sessionId || '',data=useBubbles(sessionId,!!sessionId);
    return React.createElement(PackWorkbench,{key:sessionId,sessionId,cardPath:sessionId?data?.cardPath:undefined,cardStamp:sessionId?data:undefined});
}
// the host half of 舞台设置 › 提示词 (asset-pack-card-ui.js StagePrompts). usePrompts() reads what
// the story model receives (the shared dialogue store: getDialogueBubbles `injection`, `config.injection` for 恢复默认)
// and the director preview; the 对白格式 editor and its reset write the global engine dialogue.injection.
function stagePrompts(sessionId) {
    return {
        usePrompts() {
            const data = useBubbles(sessionId, true), [director, refreshDirector] = useDirectorPreview(sessionId), injection = data?.config?.injection;
            return { story: data ? { parts: Array.isArray(data.injection) ? data.injection : data.instruction ? [{ key: 'format', text: data.instruction, tokens: null }] : [],
                custom: !!(injection?.template?.trim() || injection?.extra?.trim()),
                // the bubble entries the bound worldbooks really hold, so one another card left behind shows too.
                entries: Array.isArray(data.placement?.entries) ? data.placement.entries : null, userName: data.userName || '' } : null,
                director, refresh: () => { bubbleStore.load(sessionId, true); refreshDirector(); } };
        },
        dialogueEditor: close => React.createElement(StageDialogueEditor, { sessionId, onClose: close }),
        resetDialogue: () => resetDialogueInjection(sessionId)
    };
}
function TavernStageTab(props) {
    const sessionId=props.scope?.sessionId || '',data=useBubbles(sessionId,true),prompts=React.useMemo(() => stagePrompts(sessionId),[sessionId]);
    return React.createElement(PackWorkbench,{key:sessionId,sessionId,page:'stage',cardPath:data?.cardPath,cardName:data?.cardName,loading:!data,prompts});
}
function installTavernAssetLaunchers(ctx, slots) {
    if (ctx.betterSidebar) { const sidebar = ctx.betterSidebar; stageSidebar = sidebar; ctx.effect(() => () => { if (stageSidebar === sidebar) stageSidebar = undefined; }); }
    ctx.inject(['ttsClient'], child => {
        forkTtsScope = child;
        voicePlayer.setEnabled(true); notifyPackChange();
        const off=child.get('ttsClient').subscribe(event => {
            // a preset keeps its ID when its synthesis parameters change.
            if (event?.type === 'voicesChanged') voicePlayer.invalidate();
            // a finished synthesis only refreshes the confirmed-failure ⚠ (its own listeners). Treating it as a
            // pack change reloads the stage, which re-synthesizes the failed line, which fires again: a retry loop that
            // also made the 配音 ⚠ blink.
            if (event?.type === 'modelValidationChanged') return;
            // another reading preset (or an edit to it) changes each line's
            // identity in dsh-tts; drop decoded clips so a replay asks again (re-synthesised there only when replayed).
            if (event?.type === 'readingsChanged') { voicePlayer.invalidate(); return; }
            notifyPackChange(event);
        });
        const offRate=stageReading.subscribe(() => voicePlayer.setRate(stageReading.get().voiceRate));
        child.effect(() => () => {off();offRate();if(forkTtsScope!==child)return;forkTtsScope=undefined;voicePlayer.setEnabled(false);voicePlayer.invalidate();notifyPackChange();});
    });
    ctx.effect(() => {
        const transport = createPackTransport(); packTransport = transport;
        const stop = transport.service.subscribe(notifyPackChange);
        transport.start();
        return () => { stop(); transport.dispose(); if (packTransport === transport) packTransport = undefined; notifyPackChange(); };
    });
    ctx.provide('assetPackWorkbench',{render:props=>React.createElement(AssetLibraryTab,props)});
    // the global 读音词典 drawn with the shared panel components; the 配音
    // page (dsh-tts) places it and supplies its control RPC.
    ctx.provide('ttsReadingsEditor',{render:props=>React.createElement(packUi.ReadingsEditor,props)});
}
