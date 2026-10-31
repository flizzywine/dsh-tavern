function createStageSceneCamera({ease,clamp}) {
// Camera shots (persistent). The world point (fx, fy) (fractions of the stage) sits at the screen point
// (ax, ay); zoom and rotation turn around it. head: { x, y } of the close-up target, fractions.
const GAL_SHOTS = {
    "": { zoom: 1, ms: 900, ease: "inOutCubic" },
    push: { zoom: 1.12, ms: 8000, ease: "inOutSine" },
    close: { zoom: 1.35, ms: 700, ease: "inOutCubic" },
    "pan-left": { zoom: 1.1, panX: -0.06, ms: 4000, ease: "inOutSine" },
    "pan-right": { zoom: 1.1, panX: 0.06, ms: 4000, ease: "inOutSine" },
    dutch: { zoom: 1.08, rotation: 3.5 * Math.PI / 180, ms: 1000, ease: "inOutCubic" }
};
function galShotTarget(shot, head) {
    let spec = GAL_SHOTS[shot] || GAL_SHOTS[""];
    if (shot === "close" && !head) spec = GAL_SHOTS[""];
    const target = { zoom: spec.zoom, fx: 0.5 + (spec.panX || 0), fy: 0.42, ax: 0.5, ay: 0.42, rotation: spec.rotation || 0 };
    if (shot === "close" && head) {
        target.fx = head.x; target.fy = head.y; target.ax = 0.5;
        target.zoom = head.zoom ?? spec.zoom; target.ay = head.ay ?? 0.36;
    }
    return { target, ms: spec.ms, ease: spec.ease };
}
// Keeps the camera inside the backdrop (which overscans the stage by margin on each side): zooms in just
// enough for rotations, then slides the focus so no corner of the screen shows past the picture.
function galCameraClamp(cam, W, H, margin) {
    const m = margin == null ? 0.018 : margin;
    const cos = Math.cos(cam.rotation || 0), sin = Math.sin(cam.rotation || 0);
    let zoom = Math.max(0.2, cam.zoom || 1);
    const corners = z => [[0, 0], [W, 0], [0, H], [W, H]].map(function ([sx, sy]) {
        const dx = (sx - cam.ax * W) / z, dy = (sy - cam.ay * H) / z;
        return [dx * cos + dy * sin, -dx * sin + dy * cos];
    });
    const span = list => [Math.min(...list), Math.max(...list)];
    let c = corners(zoom);
    let [x0, x1] = span(c.map(p => p[0])), [y0, y1] = span(c.map(p => p[1]));
    const need = Math.max(1, (x1 - x0) / (W * (1 + 2 * m)), (y1 - y0) / (H * (1 + 2 * m)));
    if (need > 1) { zoom *= need * 1.0001; c = corners(zoom); [x0, x1] = span(c.map(p => p[0])); [y0, y1] = span(c.map(p => p[1])); }
    let fx = cam.fx * W, fy = cam.fy * H;
    if (fx + x0 < -m * W) fx = -m * W - x0; else if (fx + x1 > (1 + m) * W) fx = (1 + m) * W - x1;
    if (fy + y0 < -m * H) fy = -m * H - y0; else if (fy + y1 > (1 + m) * H) fy = (1 + m) * H - y1;
    return Object.assign({}, cam, { zoom, fx: fx / W, fy: fy / H });
}


function create() {
    let camera={key:null,from:null,current:null,start:0,ms:0,ease:'inOutCubic'};
    function snapshot(){return {...camera,from:camera.from&&{...camera.from},current:camera.current&&{...camera.current},goal:camera.goal&&{...camera.goal},safe:camera.safe&&{...camera.safe}};}
    function reset(){camera.key=null;camera.current=null;return snapshot();}
    function step({spec={},framing=null,hasTarget=!!framing,frame,W,H,now,skipping=false,snap=false,kick=0}) {
        let target,key,ms,curve,zoomMax=Infinity;
        if(!spec.shot&&typeof spec.zoom==='number'){
            const number=(value,fallback)=>typeof value==='number'&&isFinite(value)?value:fallback;
            const zoom=Math.max(.5,number(spec.zoom,1)),panX=number(spec.panX,0),panY=number(spec.panY,0),rotation=number(spec.rotation,0);
            target={zoom,fx:.5+panX,fy:.42+panY,ax:.5,ay:.42,rotation};
            key='manual:'+ [zoom,panX,panY,rotation].join(',');ms=1200;curve='inOutCubic';
        }else{
            const shot=spec.shot||'',plan=galShotTarget(shot,framing);
            target=plan.target;key=shot+':'+(hasTarget?spec.target:'');ms=plan.ms;curve=plan.ease;
            zoomMax=framing?framing.zoomMax:Infinity;
        }
        target={...target,fy:(frame.top+target.fy*frame.height)/H,ay:(frame.top+target.ay*frame.height)/H};
        camera.closeOn=spec.shot==='close'&&key!=='close:'?spec.target:'';
        camera.goal=galCameraClamp(target,W,H,.018);
        if(skipping)ms=Math.min(ms,200);if(snap)ms=0;
        if(camera.key!==key){camera.from=camera.current||target;camera.key=key;camera.start=now;camera.ms=camera.current?ms:0;camera.ease=curve;}
        const k=camera.ms>0?ease[camera.ease](clamp((now-camera.start)/camera.ms)):1,current={};
        for(const name of ['zoom','fx','fy','ax','ay','rotation'])current[name]=camera.from[name]+(target[name]-camera.from[name])*k;
        camera.current=current;
        camera.safe=galCameraClamp({...current,zoom:Math.min(current.zoom*(1+kick),Math.max(current.zoom,zoomMax))},W,H,.018);
        return snapshot();
    }
    return {step,reset,snapshot};
}
return {create,shot:galShotTarget,clamp:galCameraClamp};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSceneCamera};
