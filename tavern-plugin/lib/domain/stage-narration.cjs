'use strict';

// Presentation-only authority. A held device is shown like a picture, above the text band.
// Sample this choice at the line boundary, not whenever an overlay enters or leaves.
function stageNarrationLayout({cg = null, items = [], performance = null, device = false, scheduled = [], regions = []} = {}) {
    const reservesImage=claims=>claims?.some(region=>region==='illustration' || region==='stage');
    const preparingImage=scheduled.some(entry=>(entry.status==='pending' || entry.status==='playing') && reservesImage(entry.regions));
    return cg || device || reservesImage(regions) || preparingImage || items.some(row => row.performance?.payload?.media && row.media?.image) || performance?.imageShown === true && !performance.unavailable ? 'band' : 'screen';
}

function stageNarrationPresentation(previous, line, layers) {
    return previous?.line === line ? previous : {line, layout:stageNarrationLayout(layers)};
}

// Reserve the band for the image-bearing phase, rather than flickering with alpha.
// Masks, particle textures and skin decorations are not showcased illustrations.
function stagePerformanceImageShown(document) {
    return (document?.keyframes?.layers || []).some(layer => layer.kind === 'image' && !layer.maskOnly);
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {stageNarrationLayout, stageNarrationPresentation, stagePerformanceImageShown};
