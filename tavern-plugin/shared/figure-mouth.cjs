// One authority for explicit mouth policy; validation belongs to the write boundary.
function resolveFigureMouth(figure, outfitKey, stateId, imageId) {
    const policy = figure?.extensions?.['dsh.mouth'];
    const pools = figure?.outfits?.find(outfit => outfit.key === outfitKey)?.sprite?.imagePools;
    const semanticState = pools && !pools[stateId] ? Object.entries(pools).find(([, pool]) => pool.imageIds.includes(stateId))?.[0] : stateId;
    const selectedImage = imageId || (pools && !pools[stateId] ? stateId : undefined);
    const variant = policy?.images?.[outfitKey]?.[selectedImage] || policy?.variants?.[outfitKey]?.[semanticState];
    if (variant) return {mouth:variant.mouth, mouthNote:variant.mouthNote || ''};
    return {mouth:policy?.static === true ? 'static' : 'animated', mouthNote:policy?.note || ''};
}
if (typeof module !== 'undefined') module.exports = {resolveFigureMouth};
