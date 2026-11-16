function createStageSettingsModule({React, rpc, notifySettingsChanged, TavernModelSlotGroups, SettingsGroup, CubismCoreEntry, SpineRuntimeEntry, ForkModManagerEntry}) {
    // 对话气泡 / 舞台模式 have no row here: their only switch is the four-state one of 舞台设置 › 基础设置 (its 全局 choices write
    // the same engine stageToggles).
    // 舞台模型: every slot the stage registered — its own (导演模型, 智能判断) first as plain rows, then each stage mod's
    // (手机 › 通话模型) under the mod's name. The core's own slots stay on 设置 › DSH Tavern › 默认模型 (owner 'core').
    function StageModelSettings() {
        const h = React.createElement;
        const [state, setState] = React.useState({loading:true, busy:false, slots:[], settings:{}, catalog:[], scoringCatalog:[], error:""});
        React.useEffect(() => {
            let active = true;
            const refresh = () => rpc('getTavernSettings').then(result => {
                if (active) setState(current => ({...current, loading:false, slots:(result.modModelSlots || []).filter(slot=>slot.owner !== 'core'), settings:result.settings, catalog:result.modelCatalog || [], scoringCatalog:result.scoringCatalog || [], error:""}));
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
        const common = {values:state.settings?.modModels, catalog:state.catalog, scoringCatalog:state.scoringCatalog, disabled:state.loading || state.busy, onChange:save};
        return h(React.Fragment, null,
            state.error ? h('p', {role:'alert'}, state.error) : null,
            h(TavernModelSlotGroups, {...common, rowsOnly:true, slots:state.slots.filter(slot=>slot.modId === 'dsh.stage')}),
            h(TavernModelSlotGroups, {...common, slots:state.slots.filter(slot=>slot.modId !== 'dsh.stage')}));
    }
    function TavernStageSettingsSection() {
        const h = React.createElement;
        return h("div", {className:"dsh-tavern-settings-section dsh-tavern-global-settings"},
            h(SettingsGroup, {title:"舞台模型"}, h(StageModelSettings)),
            // the optional runtimes, the same entries as the model previews.
            h(SettingsGroup, {title:"运行库"}, h("div", {className:"fork-runtime-list"}, CubismCoreEntry ? h(CubismCoreEntry, {request:rpc}) : null, SpineRuntimeEntry ? h(SpineRuntimeEntry, {request:rpc}) : null)),
            h(SettingsGroup, {title:"舞台模组"}, ForkModManagerEntry ? h(ForkModManagerEntry) : null));
    }
    return {TavernStageSettingsSection};
}
