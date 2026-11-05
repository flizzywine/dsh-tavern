'use strict';
// Stage lease HUD (舞台借用): the region between the top bar and the text box where a gameMode view's
// stage.hud(props) draws its own controls while it leases the stage. The engine only places, scopes and guards it:
// it is a child of the stage (so it inherits the skin theme scope and styles with --gal-ui-* tokens only), the
// region itself is see-through to the pointer (themes.css .fork-gal-lease-hud) and the card's controls opt back in.
// A throwing hud is caught by the host's plugin boundary (Boundary, props {owner, fallback}); the stage keeps going.
// lease: {owner, hud, props} - the whole, in-memory lease snapshot; rows: [{name, face}] - the lease's names, face
// being the portraits pipeline's face ({identity, src, crop, avatar}) for a resolved figure, absent otherwise.
function createStageLeaseHud({React, Boundary, PackImage, placeholderFace}) {
let facesContext;
// Created on first use: non-UI consumers load the bundle without React's component runtime.
function faces() { return facesContext ||= React.createContext(null); }
// The card's avatar: a resolved figure's portrait, else the stand-in disc with the name's first character.
function Avatar({name, size}) {
    const h = React.createElement, px = size || 32;
    const face = React.useContext(faces())?.get(name);
    const style = {width: px + 'px', height: px + 'px', fontSize: Math.round(px * .5) + 'px'};
    if (face?.src) return h('span', {className: 'fork-gal-lease-avatar', style, 'aria-hidden': true},
        h(PackImage, {identity: face.identity, src: face.src, crop: face.crop, avatar: face.avatar, className: 'fork-gal-lease-avatar-img', alt: ''}));
    return h('span', {className: 'fork-gal-lease-avatar is-glyph', style, 'aria-hidden': true}, placeholderFace({}, name)?.glyph || '');
}
function StageLeaseHud({lease, rows, device, read}) {
    const h = React.createElement;
    const map = React.useMemo(() => new Map((rows || []).filter(row => row.face).map(row => [row.name, row.face])), [rows]);
    if (!lease?.hud) return null;
    return h('div', {className: 'fork-gal-lease-hud', 'data-device': device},
        h(faces().Provider, {value: map},
            h(Boundary, {key: lease.owner, owner: lease.owner, fallback: h('p', {className: 'fork-gal-lease-hud-error', role: 'status'}, '玩法面板出错了，舞台仍可继续')},
                h(lease.hud, {...lease.props, read, device, Avatar}))));
}
return {StageLeaseHud, Avatar};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageLeaseHud};
