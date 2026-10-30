// Image-table formats are explicit; a v2/v3 document never reads semantic-key artwork.
function spriteUsesImages(manifest) {
    return manifest?.version === (manifest?.kind === 'layered-static-sprites' ? 3 : 2);
}
function spriteImageTable(manifest) {
    return spriteUsesImages(manifest) ? manifest.images : manifest?.emotions;
}
function stateImagePool(outfit, stateId) {
    const pools = outfit?.sprite?.imagePools;
    return pools?.[stateId] || pools?.[outfit.fallbackTo?.[stateId]] || pools?.[outfit.defaultEmotion] || null;
}
// Preview defaults are deterministic. Committed identities never fall back to another picture.
function stateImageId(outfit, stateId, selection) {
    if (selection) return selection.outfitKey === outfit?.key && selection.manifestKey === outfit?.sprite?.manifestKey ? selection.imageId : null;
    return stateImagePool(outfit, stateId)?.defaultImageId || null;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {spriteUsesImages, spriteImageTable, stateImagePool, stateImageId};
