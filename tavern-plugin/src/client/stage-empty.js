// one theme-token palette and canvas painter for the stage and opening previews.
function stageEmptyPalette(scope) {
    const probe = document.createElement('span');
    scope.appendChild(probe);
    const resolve = color => { probe.style.color = color; return getComputedStyle(probe).color; };
    const colors = [
        resolve('color-mix(in srgb, var(--gal-empty-accent, #9572cc) 25%, var(--gal-empty-surface, #1d1630))'),
        resolve('var(--gal-empty-surface, #1d1630)'),
        resolve('var(--gal-empty-deep, #0e0b16)')
    ];
    probe.remove();
    return colors;
}
function stagePaintEmpty(ctx, w, h, colors) {
    ctx.save(); ctx.translate(w / 2, h * 0.2); ctx.scale(1.2, 0.9);
    const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(w / 2, h * 0.8) / 1.05);
    [0, 0.55, 1].forEach((stop, i) => radial.addColorStop(stop, colors[i]));
    ctx.fillStyle = radial; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
}
