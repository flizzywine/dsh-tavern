// Per-figure light interpolation and owned shade/rim/depth filters.
function createStageFigureAppearance({graphics,spring,springValue}) {
    let disposed=false;const instances=new Set();
    function create({PIXI,container,tune}) {
        if(disposed)throw new Error('Figure appearance owner disposed');
        let closed=false,shade;
        const filters=graphics.filters(container,null,['shade','rim','dof'],true);
        const state={slots:{},glow:springValue(0),shadow:springValue(0),blur:springValue(0),armed:springValue(0)};
        try{shade=new PIXI.filters.ColorMatrixFilter();tune(shade);filters.set('shade',shade);}
        catch(error){filters.set('shade',null);shade?.destroy();throw error;}
        function snapshot(){return {glow:state.glow.v,shadow:state.shadow.v,blur:state.blur.v,armed:state.armed.v};}
        function tick({mode='',defocused=false,quality,armedOn=0,reduced=false,color,now,dt}) {
            if(closed)return snapshot();
            spring(state.glow, mode === "glow" ? 1 : 0, 6, dt);
            spring(state.shadow, mode === "shadow" ? 1 : 0, 6, dt);
            spring(state.blur, defocused && quality === "high" ? 2 : 0, 6, dt);
            // figure-life armed cue (stageViews.figureTap.galTapArm): a soft steady outline in the figure's colour while taps on it react; it
            // fades out when the period ends (reduced motion: on and off without a fade).
            if (reduced) { state.armed.v = armedOn; state.armed.d = 0; } else spring(state.armed, armedOn, 5, dt);
            const glow = state.glow.v, shadow = state.shadow.v, armed = state.armed.v;
            const hasFilters = Boolean(PIXI.filters.GlowFilter);
            const rimDistance = quality === "low" ? 8 : 14;
            if (state.slots.rim && state.slots.rim.distance !== rimDistance) { filters.set("rim", null); state.slots.rim.filter.destroy(); delete state.slots.rim; }
            const rim = graphics.useFilter(state.slots, filters, "rim", function () {
                if (!hasFilters) return null;
                const filter = new PIXI.filters.GlowFilter({ distance: rimDistance, outerStrength: 0, innerStrength: 0, color: 0xffcf8a, quality: quality === "low" ? 0.1 : 0.18 });
                return filter;
            }, glow + shadow + armed > 0.01, now, tune);
            if (rim) {
                if (state.slots.rim) state.slots.rim.distance = rimDistance;
                const warm = glow >= shadow;
                if (armed > glow && armed > shadow) {
                    // The figure's colour lifted halfway to white, so the outline reads as light on any background.
                    const hex = /^#[0-9a-f]{6}$/i.test(color || "") ? parseInt(color.slice(1), 16) : 0xfff3e0;
                    rim.color = ((((hex >> 16) & 255) + 255) >> 1 << 16) | ((((hex >> 8) & 255) + 255) >> 1 << 8) | (((hex & 255) + 255) >> 1);
                    rim.outerStrength = armed * 2; rim.innerStrength = armed * 0.2;
                } else {
                    rim.color = warm ? 0xffcf8a : 0x9ab6ff;
                    rim.outerStrength = warm ? glow * (2.4 + 0.35 * Math.sin(2 * Math.PI * now / 2400)) : shadow * 1.5;
                    rim.innerStrength = warm ? glow * 0.7 : shadow * 0.25;
                }
            }
            const blur = graphics.useFilter(state.slots, filters, "dof", () => hasFilters ? Object.assign(new PIXI.filters.KawaseBlurFilter(0, 3, false), { forkLowRes: true }) : null, state.blur.v > 0.05, now, tune);
            if (blur) blur.blur = state.blur.v;
            return { glow, shadow };

        }
        const view={filters,tick,snapshot,setShade(matrix){if(!closed)shade.matrix=matrix;},dispose(){
            if(closed)return;closed=true;instances.delete(view);const errors=[];
            for(const [name,filter] of [['shade',shade],...Object.entries(state.slots).map(([name,slot])=>[name,slot.filter])]){
                try{filters.set(name,null);}catch(error){errors.push(error);}
                try{filter.destroy();}catch(error){errors.push(error);}
            }
            state.slots={};
            if(errors.length)throw new AggregateError(errors,'Figure appearance cleanup failed');
        }};
        instances.add(view);return view;
    }
    return {create,dispose(){if(disposed)return;disposed=true;const errors=[];for(const view of [...instances])try{view.dispose();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure appearances cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureAppearance};
