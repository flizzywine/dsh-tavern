// diagnostic-only view of the v2 catalogue. Editing lives in the pack workbench.
const CATALOGUE_KINDS = {backgrounds:'背景',music:'音乐',sfx:'音效',ambience:'环境音',looks:'滤镜',widgets:'模组'};
function catalogueItemKey(row) { const ref = row.ref; return ref ? [ref.packId,ref.kind,ref.assetId].join('/') : ''; }
function catalogueLamp(row) {
    if (!row.sent) return {id:'off',label:({disabled:'已停用','over-cap':'超出上限',unmatched:'未命中','asset-unavailable':'不可用','widget-unauthorized':'未授权'})[row.excluded] || '未发送'};
    if (row.reasons.includes('constant')) return {id:'blue',label:'常驻'};
    // one user-facing term — a green hit by its words is 「触发词」 (as in the
    // pack editor), and a 智能判断 pick says so instead of claiming a keyword hit.
    return {id:'green',label:row.reasons.includes('carried') ? '延续' : row.reasons.includes('opening') ? '开场' : row.reasons.includes('judge') ? '判断模型' : '触发词'};
}
function CatalogueDiagnostics({state}) {
    const h = React.createElement, catalogue = state.result?.catalogueDiagnostics;
    if (!catalogue) return null;
    return h('section',{className:'fork-director-input-block','data-block':'assets'},
        h('h4',null,'素材清单'),h('p',{className:'fork-catalogue-legend'},'蓝灯常驻 · 绿灯触发或延续 · 灰灯未发送'),
        Object.entries(CATALOGUE_KINDS).map(([kind,label]) => {
            const rows = (catalogue.rows || []).filter(row => row.ref.kind === kind);
            return h('details',{key:kind,open:true,className:'fork-catalogue-module'},
                h('summary',null,label,' · ',rows.filter(row => row.sent).length,' / ',rows.length),
                h('ul',{className:'fork-catalogue-items'},rows.map(row => {
                    const lamp = catalogueLamp(row), key = catalogueItemKey(row);
                    return h('li',{key,className:'fork-catalogue-item','data-lamp':lamp.id},
                        h('i',{className:'fork-lamp','data-lamp':lamp.id,'aria-hidden':true}),
                        h('span',{className:'fork-catalogue-name'},row.label || row.asset.name),
                        h('span',null,lamp.label),h('code',{title:key},key));
                })));
        }),
        (catalogue.diagnostics || []).map((item,index) => h('p',{key:index,role:'status'},[item.kind,item.packId,item.code].filter(Boolean).join(' · '))));
}
