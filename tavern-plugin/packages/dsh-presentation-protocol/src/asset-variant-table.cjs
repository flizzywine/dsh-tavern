// Shared editing/preview operations on the flat same-kind table; media stays with its kind owner.
function assetVariantRow(table,id=table.default) {return table.entries.find(row=>row.id===id);}
function editAssetVariantTable(table,action) {
    const entries=table.entries.map(row=>({...row})),at=entries.findIndex(row=>row.id===action.id);
    if(at<0)throw new Error('Choose a listed variant id');
    let selectedDefault=table.default;
    if(action.type==='default')selectedDefault=action.id;
    else if(action.type==='move') {
        if(![-1,1].includes(action.delta))throw new Error('Move one position at a time');
        if(entries[at+action.delta])[entries[at],entries[at+action.delta]]=[entries[at+action.delta],entries[at]];
    } else if(action.type==='remove') {
        if(entries.length===1)throw new Error('Keep at least one variant');
        entries.splice(at,1);if(selectedDefault===action.id)selectedDefault=entries[0].id;
    } else if(action.type==='rename') {
        if(typeof action.name!=='string' || !action.name.trim())throw new Error('Enter a variant name');
        entries[at].name=action.name;
    } else throw new Error('Unknown variant edit');
    return {default:selectedDefault,entries};
}
if(typeof module!=='undefined' && typeof window === 'undefined')module.exports={assetVariantRow,editAssetVariantTable};
