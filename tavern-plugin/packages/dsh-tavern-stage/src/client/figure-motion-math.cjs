function createStageFigureMotionMath({spring:galSpring,fade:galMotionFade}) {
// uninterrupted idle, an independent gesture queue, then parameter springs.
// Cubism4-specific adapter; the vendored runtime and loaded clip cache stay untouched.
function galGestureWeight(age, duration, fadeIn = 0.40, fadeOut = 0.50) {
    const ramp = (x, time) => { if (!(time > 0)) return 1; x = Math.max(0, Math.min(1, x / time)); return x * x * (3 - 2 * x); };
    return age < 0 || age >= duration ? 0 : ramp(age, fadeIn) * ramp(duration - age, fadeOut);
}
// Gesture fades are what the model declares: the motion3 Meta, then its model3 motion entry (Cubism's order in the
// runtime's createMotion); the stage's 0.40 / 0.50 s apply only when neither declares one.
function galGestureFades(meta, entry) {
    const declared = key => [meta && meta[key], entry && entry[key]].find(value => Number.isFinite(value) && value >= 0);
    const fadeIn = declared("FadeInTime"), fadeOut = declared("FadeOutTime");
    return { fadeIn: fadeIn === undefined ? 0.40 : fadeIn, fadeOut: fadeOut === undefined ? 0.50 : fadeOut };
}
// Switches are only what the model declares as one: pose3 groups/links and PartOpacity tracks (poseIds), and
// parameters named as a switch (our rigs' ParamArmPoseSwitch, game rigs' ParamHand*Display). Arm-set letters are
// not switches: game rigs key continuous angles as ParamArmLA02 / ParamArmRB03 / ParamArmLC01, the arm-set
// choice itself is their pose3 parts, so those angles blend and spring like any other arm parameter.
function galMotionDiscrete(id, poseIds) {
    return Boolean(poseIds && poseIds.has(id)) || /^Param(?:Arm|Hand).*(?:Display|Switch|Visible|Opacity)$/.test(id);
}
function galMotionParameter(id) {
    if (galMotionDiscrete(id)) return null;
    if (/^ParamAngle[XYZ]$/.test(id)) return { omega: 14, velocity: 180 };
    if (/^ParamBodyAngle[XYZ]$/.test(id)) return { omega: 14, velocity: 90 };
    if (/^ParamEyeBall[XY]$/.test(id)) return { omega: 20, velocity: Infinity };
    if (/^Param(?:Arm|Hand|Shoulder)/.test(id)) return { omega: 12, velocity: Infinity };
    return null;
}
function galMotionSpring(s, target, omega, velocity, dt) {
    if (!(dt > 0)) return s.v;
    const old = s.v;
    galSpring(s, target, omega, dt);
    s.d = Math.max(-velocity, Math.min(velocity, s.d));
    s.v = Math.max(old - velocity * dt, Math.min(old + velocity * dt, s.v));
    return s.v;
}
function galMotionClone(source, gesture, discreteIds, loop = false) {
    const motion = Object.assign(Object.create(Object.getPrototypeOf(source)), source);
    motion._motionData = Object.assign({}, source._motionData, {
        curves: source._motionData.curves.map(function (curve) {
            const discrete = curve.type === 2 || galMotionDiscrete(curve.id, discreteIds);
            // Route PartOpacity through its (often virtual) parameter channel, independent of
            // CubismConfig.setOpacityFromMotion. Publish the winning track to real parts later.
            return Object.assign({}, curve, {
                type: curve.type === 2 ? 1 : curve.type, forkDiscrete: discrete,
                fadeInTime: discrete ? 0 : gesture ? -1 : curve.fadeInTime < 0 ? -1 : galMotionFade(curve.fadeInTime),
                fadeOutTime: discrete ? 0 : gesture ? -1 : curve.fadeOutTime < 0 ? -1 : galMotionFade(curve.fadeOutTime)
            });
        })
    });
    motion._firedEventValues = [];
    motion.setIsLoop(loop);
    // Gesture envelopes are applied once by our mixer, not again by Cubism's curve fades.
    motion.setFadeInTime(gesture ? 0 : galMotionFade(source.getFadeInTime()));
    motion.setFadeOutTime(gesture ? 0 : galMotionFade(source.getFadeOutTime()));
    motion.setFinishedMotionHandler(undefined);
    return motion;
}

return {galGestureWeight,galGestureFades,galMotionDiscrete,galMotionParameter,galMotionSpring,galMotionClone};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureMotionMath};
