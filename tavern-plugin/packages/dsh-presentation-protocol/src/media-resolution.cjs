'use strict';

const MEDIA_RESOLUTION_POLICY = Object.freeze({ version: 'display-density/1', longSide: 4096, status: 'owner-approved', avatarMasters: 'retain-until-framing-closure' });

// Largest singular value: rotation alone does not increase sampling density.
function mediaSamplingScale(matrix) {
    const [a, b, c, d] = matrix;
    return (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2;
}

// Consumers supply their real source-pixel -> CSS-pixel transforms. Inspection zoom
// is not a consumer promise. Missing geometry forbids destructive downsampling.
function planMediaResolution(source, uses, policy = MEDIA_RESOLUTION_POLICY) {
    const { width, height, identity } = source;
    const diagnostics = [], known = [], unknown = [];
    for (const usage of uses) {
        if (usage.inspection) continue;
        if (usage.unknown) { unknown.push({ use: usage.use, reason: usage.unknown }); continue; }
        const scale = (usage.matrix ? mediaSamplingScale(usage.matrix) : usage.scale) * usage.dpr;
        known.push({ use: usage.use, scale });
    }
    if (!known.length && !unknown.length) unknown.push({ use: 'unclassified', reason: 'No display consumer declared' });
    const maximum = known.reduce((a, b) => b.scale > a.scale ? b : a, { use: null, scale: 0 });
    const capScale = policy.longSide / Math.max(width, height);
    const requiredScale = Math.min(maximum.scale, capScale);
    const pixels = scale => [Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale))];
    const requiredPixels = known.length ? pixels(requiredScale) : null;
    const outputScale = unknown.length ? 1 : Math.min(1, requiredScale);
    const outputPixels = pixels(outputScale);
    const limited = known.filter(use => use.scale > 1).map(use => ({ ...use, factor: use.scale }));
    for (const use of limited) diagnostics.push({ code: 'RESOLUTION_SOURCE_LIMITED', use: use.use, factor: use.factor, message: `upscaled x${use.factor.toFixed(3)} for ${use.use}` });
    if (maximum.scale > capScale) diagnostics.push({ code: 'RESOLUTION_CAPPED', use: maximum.use, factor: maximum.scale / capScale, longSide: policy.longSide });
    for (const use of unknown) diagnostics.push({ code: 'RESOLUTION_GEOMETRY_UNKNOWN', ...use });
    const outputArea = outputPixels[0] * outputPixels[1], sourceArea = width * height;
    return {
        policyVersion: policy.version, sourceRef: identity, sourcePixels: [width, height],
        uncappedRequiredPixels: known.length ? pixels(maximum.scale) : null, requiredPixels, outputPixels,
        sourceToMaster: outputScale, limitingUse: maximum.use,
        quality: unknown.length ? 'geometry-unknown' : requiredScale > 1 ? 'source-limited' : outputArea < sourceArea ? 'over-size' : 'sufficient',
        residualUpscale: known.length ? maximum.scale / Math.min(1, requiredScale) : null,
        savings: { pixels: sourceArea - outputArea, rgbaBytes: (sourceArea - outputArea) * 4, encodedBytes: null },
        uses: known, diagnostics,
    };
}

module.exports = { MEDIA_RESOLUTION_POLICY, mediaSamplingScale, planMediaResolution };
