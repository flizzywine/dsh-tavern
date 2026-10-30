'use strict';

// @include stage-performance-kinds.cjs
function coreItemPresentation() {
    const kinds=typeof module!=='undefined' && typeof window==='undefined' ? require('./stage-performance-kinds.cjs').STAGE_PERFORMANCE_CORE : STAGE_PERFORMANCE_CORE;
    return {
        ...kinds.find(row=>row.kind==='core.items.item'),
        media:row=>row.payload?.media ? {image:{coreItem:true}} : {},
        render(React,row,media,{CutinCard}) {
            const value=row.payload;
            return React.createElement(CutinCard,{tone:value.action,
                // 获得 / 失去 tell the player what happened; a plain show needs no word (「展示」 is the director's op name, not news).
                label:{gain:'\u83b7\u5f97',lose:'\u5931\u53bb'}[value.action],
                // An item variant (灵魂宝石 清澈 / 浑浊) reads as the subtitle; the image is that variant's own (or the tag icon).
                title:value.name,subtitle:value.variantName || undefined,iconExpected:!!value.media,amount:value.action==='show' ? undefined : value.count,
                image:media.image ? React.createElement('img',{src:media.image,alt:'',onError:event=>{event.currentTarget.hidden=true;}}) : null});
        },
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={coreItemPresentation};
