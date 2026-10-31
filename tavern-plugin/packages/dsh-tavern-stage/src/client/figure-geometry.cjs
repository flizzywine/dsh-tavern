function createStageFigureGeometry() {
// Head / chest landmarks in texture-normalized v (0 = top). Pack anatomy when present, else the measured head top.
function galStaticBody(sprite) {
    const anatomy = sprite.figureInput && sprite.figureInput.anatomy;
    const top = anatomy && Number.isFinite(anatomy.headTop) ? anatomy.headTop : sprite.forkHeadTop || 0;
    const chin = anatomy && Number.isFinite(anatomy.chin) && anatomy.chin > top ? anatomy.chin : top + 0.14;
    const span = chin - top;
    return [top, chin, chin + span * 0.9, chin + span * 2.6];
}
function galStaticCenterU(sprite) {
    const anatomy = sprite.figureInput && sprite.figureInput.anatomy;
    return anatomy && Number.isFinite(anatomy.centerX) ? anatomy.centerX : sprite.anchor.x || 0.5;
}
// The warp bends a standing body around its neck; a seated, lying or otherwise posed figure keeps S1 only.
function galStaticWarps(figure) {
    const sizing = figure && figure.figureSizing;
    return !sizing || !sizing.heightBasis || sizing.heightBasis === "standing";
}

return {galStaticBody, galStaticCenterU, galStaticWarps};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureGeometry};
