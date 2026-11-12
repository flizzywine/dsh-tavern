function createStageSettingsModule({React, rpc, notifySettingsChanged, TavernModelSlotGroups, SettingsGroup, StageGenerationSettings, CubismCoreEntry, SpineRuntimeEntry, ForkModManagerEntry, TavernSettingRow, Switch}) {
    // 对话气泡 / 舞台模式's global layer (engine stageToggles, default off); a card's 本卡开启 / 本卡关闭 lives on its 舞台设置 and wins
    // (card-stage-settings.js effectiveCardStage). 舞台模式 needs 对话气泡, like the card page.
    function GlobalStageSwitches() {
        const h = React.createElement;
        const [engine, setEngine] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
        React.useEffect(() => {
            let active = true;
            rpc("getAssetEngineSettings").then(value => { if (active) setEngine(value); }, err => { if (active) setError("读取失败：" + err.message); });
            return () => { active = false; };
        }, []);
        async function save(key, value) {
            setBusy(true); setError("");
            const write = current => rpc("saveAssetEngineSettings", { expectedRevision: current.revision, patch: { stageToggles: { [key]: value } } });
            try {
                try { setEngine(await write(engine)); }
                catch (err) { if (err?.code !== "REVISION_CONFLICT") throw err; setEngine(await write(await rpc("getAssetEngineSettings"))); }
            } catch (err) { setError("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        const toggles = engine?.values?.stageToggles, dialogue = toggles?.dialogue === true;
        const row = (key, title, text, blocked) => h(TavernSettingRow, { key, title, help: text },
            h(Switch, { label: title, disabled: !engine || busy || engine.writable === false || blocked, checked: toggles?.[key] === true, onChange: value => save(key, value) }));
        return h(React.Fragment, null,
            row("dialogue", "对话气泡", "带舞台设置的卡默认是否用带头像的对话气泡显示正文。单张卡可在它的舞台设置里改为本卡开启或本卡关闭；普通人物卡不受影响。"),
            row("stage", "舞台模式", dialogue ? "带舞台设置的卡默认是否打开舞台（立绘、背景、音乐和演出）。单张卡可在它的舞台设置里改为本卡开启或本卡关闭。" : "先打开对话气泡", !dialogue),
            error ? h("p", { className: "dsh-tavern-gs-notice is-alert", role: "alert" }, "⚠ " + error) : null);
    }
    function StageModelSettings() {
        const h = React.createElement;
        const [state, setState] = React.useState({loading:true, busy:false, slots:[], settings:{}, catalog:[], scoringCatalog:[], error:""});
        React.useEffect(() => {
            let active = true;
            const refresh = () => rpc('getTavernSettings').then(result => {
                if (active) setState(current => ({...current, loading:false, slots:(result.modModelSlots || []).filter(slot=>slot.modId === 'dsh.stage'), settings:result.settings, catalog:result.modelCatalog || [], scoringCatalog:result.scoringCatalog || [], error:""}));
            }, error => { if (active) setState(current=>({...current, loading:false, error:String(error.message || error)})); });
            refresh();
            window.addEventListener('dsh-tavern-mods-changed', refresh);
            return () => { active = false; window.removeEventListener('dsh-tavern-mods-changed', refresh); };
        }, []);
        async function save(modModelSelection) {
            setState(current=>({...current,busy:true,error:""}));
            try {
                const result = await rpc('updateTavernSettings', {patch:{modModelSelection}});
                notifySettingsChanged();
                setState(current=>({...current,busy:false,settings:result.settings}));
            } catch(error) { setState(current=>({...current,busy:false,error:String(error.message || error)})); }
        }
        return h(React.Fragment, null,
            state.error ? h('p', {role:'alert'}, state.error) : null,
            h(TavernModelSlotGroups, {rowsOnly:true, slots:state.slots, values:state.settings?.modModels, catalog:state.catalog, scoringCatalog:state.scoringCatalog, disabled:state.loading || state.busy, onChange:save}));
    }
    function TavernStageSettingsSection() {
        const h = React.createElement;
        return h("div", {className:"dsh-tavern-settings-section dsh-tavern-global-settings"},
            h(SettingsGroup, {title:"基础设置"}, h(GlobalStageSwitches)),
            h(SettingsGroup, {title:"舞台模型"}, h(StageModelSettings)),
            h(SettingsGroup, {title:"素材生图"}, StageGenerationSettings ? h(StageGenerationSettings) : null),
            // the optional runtimes, the same entries as the model previews.
            h(SettingsGroup, {title:"运行库"}, h("div", {className:"fork-runtime-list"}, CubismCoreEntry ? h(CubismCoreEntry, {request:rpc}) : null, SpineRuntimeEntry ? h(SpineRuntimeEntry, {request:rpc}) : null)),
            h(SettingsGroup, {title:"舞台模组"}, ForkModManagerEntry ? h(ForkModManagerEntry) : null));
    }
    return {TavernStageSettingsSection};
}
