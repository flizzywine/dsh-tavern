function createStageSettingsModule({React, rpc, notifySettingsChanged, TavernModelSlotGroups, SettingsGroup, StageGenerationSettings, SpineRuntimeEntry, ForkModManagerEntry}) {
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
            h(SettingsGroup, {title:"舞台模型"}, h(StageModelSettings)),
            h(SettingsGroup, {title:"素材生图"}, StageGenerationSettings ? h(StageGenerationSettings) : null),
            h(SettingsGroup, {title:"运行库"}, SpineRuntimeEntry ? h(SpineRuntimeEntry, {request:rpc}) : null),
            h(SettingsGroup, {title:"舞台模组"}, ForkModManagerEntry ? h(ForkModManagerEntry) : null));
    }
    return {TavernStageSettingsSection};
}
