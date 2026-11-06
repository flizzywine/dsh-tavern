function createStageFigureMotion({math,lipSyncIds:galLipSyncIds}) {
let disposed=false;const releases=new Set();
const {galGestureWeight,galGestureFades,galMotionDiscrete,galMotionParameter,galMotionSpring,galMotionClone}=math;
function galInstallMotionLayers(internal) {
    if(disposed)return;
    const manager = internal.motionManager, core = internal.coreModel;
    if (manager.forkMotionLayers || !manager.queueManager || !core) return;
    const fields=[[internal,'update'],...['forkMotionLayers','stopMoodMotion','settleMoodMotion','createMotion','_startMotion','startMotion','update','stopAllMotions'].map(key=>[manager,key]),[manager.groups,'idle']];
    const before=fields.map(([object,key])=>Object.getOwnPropertyDescriptor(object,key)),listeners=[];
    let installed=null,releaseDone=false,state,queue;
    const snapshot=()=>fields.map(([object,key])=>object[key]);
    const release=()=>{
        if(releaseDone)return;releaseDone=true;releases.delete(release);
        if(state){state.dead=true;state.serial++;state.pending=null;state.gesture=null;state.idle=null;state.springs.clear();state.idleClips.length=0;}
        const errors=[];
        for(const off of listeners){try{off();}catch(error){errors.push(error);}}
        for(let i=0;i<fields.length;i++){const [object,key]=fields[i];if(object[key]===installed[i])try{if(before[i])Object.defineProperty(object,key,before[i]);else delete object[key];}catch(error){errors.push(error);}}
        try{queue?.stopAllMotions();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Figure motion cleanup failed');
    };
    const on=(name,fn)=>{const guarded=(...args)=>{if(!state?.dead)fn(...args);};internal.on(name,guarded);listeners.push(()=>internal.off(name,guarded));};
    try {
    // Pose's first update resets its virtual selectors; initialize it before taking our snapshots.
    if (internal.pose) internal.pose.updateParameters(core, 0);
    const parameters = core.getModel().parameters, values = parameters.values, ids = parameters.ids;
    // The core's view of the values array is replaced when its heap grows (cubismHeapGuard): read it per frame.
    const liveValues = () => core.getModel().parameters.values;
    const partIds = core.getModel().parts && core.getModel().parts.ids || [];
    queue = new manager.queueManager.constructor();
    queue.setEventCallback((q, event) => {if(state && !state.dead)manager.emit("motion:" + event);});
    state = manager.forkMotionLayers = {
        queue, time: 0, dt: 0, previousTime: null, gesture: null, pending: null, serial: 0, idleLead: null,
        base: new Float32Array(values), scratch: new Float32Array(values.length),
        output: new Float32Array(values), springs: new Map(), idleClips: [], dead: false,
        visibility: new Map(), discreteIndices: new Set(), reduced: false, reducedSeconds: 0
    };
    function registerDiscrete(id, part) {
        const index = core.getParameterIndex(id);
        if (index < values.length) state.discreteIndices.add(index);
        let channel = state.visibility.get(id);
        if (!channel) {
            channel = { index, part: -1, idle: core.getParameterValueByIndex(index) };
            state.visibility.set(id, channel);
        }
        if (part) channel.part = partIds.indexOf(id);
    }
    for (const id of ids) if (galMotionDiscrete(id)) registerDiscrete(id, false);
    const poseParts = internal.pose && internal.pose._partGroups || [];
    for (const part of poseParts) {
        registerDiscrete(part.partId, true);
        for (const link of part.link || []) registerDiscrete(link.partId, true);
    }
    function prepareMotion(source, gesture, loop = false) {
        for (const curve of source._motionData.curves) if (curve.type === 2) registerDiscrete(curve.id, true);
        return galMotionClone(source, gesture, state.visibility, loop);
    }
    // A pack may declare a sustained emotion pose, distinct from a one-shot director gesture: ForkStageLoop repeats the
    // clip, ForkStageHold plays it once and keeps its last frame until replaced (a native ADV client:
    // startNativeStoryMotion(id, loop = id < 100)).
    manager.stopMoodMotion = function () {
        if(state.dead)return;
        if (state.pending && state.pending.priority <= 2) { state.serial++; state.pending = null; }
        if (state.gesture?.loop || state.gesture?.hold) { state.gesture = null; queue.stopAllMotions(); }
    };
    // The next held pose starts on its last frame (restoring a pose after history, a skip or a preempting act is not
    // a replay of its gesture).
    manager.settleMoodMotion = function () { if(!state.dead)state.settle = true; };
    const internalUpdate = internal.update;
    internal.update = function (dt, now) {
        if(state.dead)return;
        if (!state.reduced) return internalUpdate.call(this, dt, now);
        // Stage preference only: freeze body, physics, breath and blink; expressions remain selectable.
        state.reducedSeconds += dt / 1000;
        liveValues().set(state.output);
        core.saveParameters();
        manager.expressionManager?.update(core, now / 1000);
        this.emit("beforeModelUpdate");
        core.update(); core.loadParameters();
    };
    const profiles = Array.from(ids, galMotionParameter), lipIds = new Set(galLipSyncIds(internal.settings));
    const start = manager.startMotion, update = manager.update, stop = manager.stopAllMotions, create = manager.createMotion;
    manager.createMotion = function (data, group, definition) {
        if(state.dead)return null;
        const motion = create.call(this, data, group, definition);
        motion.forkGestureFades = galGestureFades(data && data.Meta, definition);
        return motion;
    };
    const idleGroup = Object.keys(manager.definitions).find(group => /^idle$/i.test(group));
    function beginIdle(source) {
        const motion = prepareMotion(source, false);
        // Overlap even when the clip declares zero fades. Never let an idle's last frame empty the queue.
        const duration = motion.getDuration();
        motion.setFadeInTime(Math.min(motion.getFadeInTime(), duration / 3));
        motion.setFadeOutTime(Math.min(motion.getFadeOutTime(), duration / 3));
        for (const curve of motion._motionData.curves) {
            if (curve.forkDiscrete) continue;
            if (curve.fadeInTime >= 0) curve.fadeInTime = motion.getFadeInTime();
            if (curve.fadeOutTime >= 0) curve.fadeOutTime = motion.getFadeOutTime();
        }
        // The first clip may start partway in (state.idleLead, a 0..1 fraction from live2dStartIdle's per-figure
        // jitter) so figures loaded together are not in step; it still fades in from the current pose. Later clips start at 0.
        const lead = Number.isFinite(state.idleLead) ? Math.max(0, Math.min(1, state.idleLead)) * Math.max(0, duration - Math.min(0.50, duration / 3)) * 0.8 : 0;
        state.idleLead = null;
        if (lead > 0) motion.setOffsetTime(lead);
        manager.queueManager.startMotion(motion, false, state.time);
        state.idle = { source, motion, start: null, lead };
    }
    manager._startMotion = function (motion) { if(!state.dead)beginIdle(motion); };
    if (idleGroup) {
        manager.groups.idle = idleGroup;
        manager.definitions[idleGroup].forEach((_, index) => {
            Promise.resolve(manager.loadMotion(idleGroup, index)).then(motion => {
                if (!state.dead && motion && motion.getLoopDuration() > 0) state.idleClips.push(motion);
            }).catch(() => {});
        });
    }
    manager.startMotion = async function (group, index, priority) {
        if (state.dead) return false;
        if (group === manager.groups.idle) return start.call(this, group, index, priority);
        priority = priority == null ? 2 : priority;
        const settleRequested = state.settle === true;
        state.settle = false;
        if (state.dead || (state.pending && state.pending.priority > priority) || (state.gesture && state.gesture.priority > priority)) return false;
        const request = { serial: ++state.serial, priority };
        state.pending = request;
        let source;
        try { source = await this.loadMotion(group, index); }
        finally { if (state.pending === request) state.pending = null; }
        if (!source || state.dead || request.serial !== state.serial) return false;
        const definition = this.definitions[group]?.[index], loop = definition?.ForkStageLoop === true;
        const hold = !loop && definition?.ForkStageHold === true, settle = hold && settleRequested;
        const motion = prepareMotion(source, true, loop), duration = loop ? motion.getLoopDuration() : motion.getDuration();
        if (!(duration > 0)) return false;
        const lead = settle ? Math.max(0, duration - 1e-3) : 0;
        if (lead) motion.setOffsetTime(lead);
        const fades = source.forkGestureFades || galGestureFades();
        const from = state.gesture ? new Float32Array(state.output) : null;
        const touchedIds = new Set(motion._motionData.curves.filter(curve => curve.type !== 0).map(curve => curve.id));
        for (const curve of motion._motionData.curves) {
            if (curve.type === 0 && curve.id === "EyeBlink") for (const id of motion._eyeBlinkParameterIds) touchedIds.add(id);
            if (curve.type === 0 && curve.id === "LipSync") for (const id of motion._lipSyncParameterIds) touchedIds.add(id);
        }
        const touched = new Set(state.gesture ? state.gesture.touched : []);
        ids.forEach((id, index) => { if (touchedIds.has(id)) touched.add(index); });
        // A pose snapshot provides bounded-cost interruption even under rapid FORCE replacements.
        queue.stopAllMotions();
        queue.startMotion(motion, false, state.time);
        state.gesture = { motion, group, index, priority, duration, loop, hold, lead, fadeIn: fades.fadeIn, fadeOut: fades.fadeOut, start: null, from, touched };
        this.emit("motionStart", group, index);
        return true;
    };
    manager.update = function (model, time) {
        if(state.dead)return false;
        time -= state.reducedSeconds;
        state.dt = state.previousTime == null ? 0 : Math.max(0, time - state.previousTime);
        state.previousTime = time; state.time = time;
        if (state.dt > 0.25) state.springs.clear(); // Resume/teleport, not a large integration step.
        if (state.idle) {
            if (state.idle.start == null) state.idle.start = time - (state.idle.lead || 0);
            const duration = state.idle.motion.getDuration(), overlap = Math.min(0.50, duration / 3);
            if (time - state.idle.start >= duration - overlap) {
                const clips = state.idleClips;
                beginIdle(clips.length ? clips[Math.floor(Math.random() * clips.length)] : state.idle.source);
                state.idle.start = time;
            }
        }
        return update.call(this, model, time);
    };
    on("beforeMotionUpdate", function () {
        // Do not feed last frame's gesture, spring or blink back into the continuously evaluated idle.
        liveValues().set(state.base);
        for (const channel of state.visibility.values()) core.setParameterValueByIndex(channel.index, channel.idle);
    });
    on("afterMotionUpdate", function () {
        const values = liveValues();
        state.base.set(values);
        for (const channel of state.visibility.values()) channel.idle = core.getParameterValueByIndex(channel.index);
        const gesture = state.gesture;
        let gestureDominates = false;
        if (gesture) {
            if (gesture.start == null) gesture.start = state.time;
            const age = state.time - gesture.start, sustained = gesture.loop || gesture.hold;
            const weight = galGestureWeight(age, sustained ? Infinity : gesture.duration, gesture.fadeIn, gesture.fadeOut);
            gestureDominates = weight >= 0.5;
            state.scratch.set(values);
            // A held clip is evaluated no later than its last frame, so it never finishes and never restarts.
            queue.doUpdateMotion(core, gesture.hold ? Math.min(state.time, gesture.start - gesture.lead + gesture.duration - 1e-3) : state.time);
            const t = gesture.fadeIn > 0 ? Math.max(0, Math.min(1, age / gesture.fadeIn)) : 1, change = t * t * (3 - 2 * t);
            for (let i = 0; i < values.length; i++) {
                if (state.discreteIndices.has(i)) continue;
                if (!gesture.touched.has(i)) { values[i] = state.scratch[i]; continue; }
                const target = state.scratch[i] + (values[i] - state.scratch[i]) * weight;
                values[i] = gesture.from ? gesture.from[i] + (target - gesture.from[i]) * change : target;
            }
            if (!sustained && age >= gesture.duration) { state.gesture = null; queue.stopAllMotions(); }
        }
        // Pose runs later (after physics). Its selected parts already have the authored opacity,
        // so its own fade/links cannot cross-dissolve mutually exclusive 0/1 arm variants.
        for (const channel of state.visibility.values()) {
            const value = gestureDominates ? core.getParameterValueByIndex(channel.index) : channel.idle;
            core.setParameterValueByIndex(channel.index, value);
            if (channel.part >= 0) core.setPartOpacityByIndex(channel.part, Math.max(0, Math.min(1, value)));
        }
        const expressionIds = new Set();
        const expressions = manager.expressionManager && manager.expressionManager.queueManager._motions || [];
        for (const entry of expressions) for (const parameter of entry._motion._parameters || []) expressionIds.add(parameter.parameterId);
        for (let i = 0; i < values.length; i++) {
            const profile = profiles[i];
            if (!profile || state.discreteIndices.has(i) || lipIds.has(ids[i]) || expressionIds.has(ids[i])) { state.springs.delete(i); continue; }
            let spring = state.springs.get(i);
            if (!spring) { spring = { v: values[i], d: 0 }; state.springs.set(i, spring); }
            values[i] = galMotionSpring(spring, values[i], profile.omega, profile.velocity, Math.min(0.05, state.dt));
        }
        state.output.set(values);
    });
    manager.stopAllMotions = function () {
        if(state.dead)return;
        state.serial++; state.pending = null; state.gesture = null; state.idle = null;
        queue.stopAllMotions(); state.springs.clear(); state.previousTime = null;
        const values = liveValues();
        state.base.set(values); state.output.set(values);
        for (const channel of state.visibility.values()) channel.idle = core.getParameterValueByIndex(channel.index);
        return stop.call(this);
    };
    // InternalModel emits destroy before destroying its manager (which calls stopAllMotions again).
    internal.once("destroy", release);listeners.push(()=>internal.off('destroy',release));
    installed=snapshot();releases.add(release);return release;
    }catch(error){installed=snapshot();try{release();}catch(cleanup){throw new AggregateError([error,cleanup],'Figure motion setup failed');}throw error;}
}

return {install:galInstallMotionLayers,dispose(){if(disposed)return;disposed=true;const errors=[];for(const release of [...releases])try{release();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure motion cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureMotion};
