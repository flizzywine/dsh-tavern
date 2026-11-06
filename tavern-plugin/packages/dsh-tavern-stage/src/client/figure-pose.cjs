// Figure action timing and geometry in stage coordinates. No texture or model ownership.
function createStageFigurePose({resolve,flatLayout,actionAt,ease}) {
    let disposed=false;const instances=new Set();
    function create({kind,phase,period}) {
        if(disposed)throw new Error('Figure pose owner disposed');
        let closed=false,nonce=null,action=null;
        function update({sprite:current,fading,now,reduced,command,idle,framing,W,H,x,flip,lift,size,ground}) {
            if(closed)return null;
            if(command&&command.nonce!==nonce){nonce=command.nonce;action={name:command.name,start:now};}
            const act=action?actionAt(action.name,now-action.start,reduced):actionAt('',0);
            if(act.done)action=null;
            let breath=kind==='spine'?1:1+.008*(1-Math.cos(2*Math.PI*now/period+phase))/2;
            if(idle.on)breath=idle.scaleY;
            let head=null,bodyBounds=null,resolved=null;
            const place = function (sprite) {
                // metrics are in base-image pixels; talk frames and mouth children reuse the pivot.
                const input = sprite.figureInput;
                if (input) {
                    const rest = resolve({ ...input, ...framing, W, H, stageX: W * x, canvas: [sprite.texture.width, sprite.texture.height], flip: flip });
                    if (sprite === current) resolved = rest;
                    if (rest.mode === "physical") {
                        const body = { x: Math.min(rest.x, rest.x + sprite.texture.width * rest.scale * flip), y: rest.y, width: sprite.texture.width * rest.scale, height: sprite.texture.height * rest.scale };
                        if (!bodyBounds) bodyBounds = body;
                        else { const old = bodyBounds, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y); bodyBounds = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y }; }
                        const candidateHead = rest.restHead || { x: rest.support.x, top: rest.y + (sprite.forkHeadTop || 0) * sprite.texture.height * rest.scale, chin: rest.y + ((sprite.forkHeadTop || 0) + 0.17) * sprite.texture.height * rest.scale, width: rest.poseSpan * 0.16 };
                        if (!head || candidateHead.top < head.top) head = candidateHead;
                        sprite.position.set(rest.support.x + (act.dx + idle.dx) * rest.poseSpan + act.px, rest.support.y + act.dy * rest.poseSpan);
                        sprite.scale.set(rest.scale * act.zoom * flip * act.flip * act.scaleX * idle.scaleX, rest.scale * act.zoom * breath * act.scaleY * idle.tapY);
                        sprite.rotation = idle.rotation;
                        return;
                    }
                }
                const rest = flatLayout(sprite.texture.width, sprite.texture.height, W, H, x, 1, 0, size, ground);
                const body = { x: rest.x - rest.width / 2, y: rest.y - rest.height * 1.008, width: rest.width, height: rest.height * 1.008 };
                if (!bodyBounds) bodyBounds = body;
                else {
                    const old = bodyBounds, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y);
                    bodyBounds = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y };
                }
                const top = rest.y - rest.height * 1.008 * (1 - (sprite.forkHeadTop || 0));
                if (!head || top < head.top) head = { x: rest.x, top, chin: top + rest.height * 0.17, width: rest.height * 0.16 };
                const L = flatLayout(sprite.texture.width, sprite.texture.height, W, H, x, act.zoom, lift, size, ground);
                sprite.position.set(L.x + (act.dx + idle.dx) * L.width + act.px, L.y + act.dy * L.height);
                sprite.scale.set(L.scale * flip * act.flip * act.scaleX * idle.scaleX, L.scale * breath * act.scaleY * idle.tapY);
                sprite.rotation = idle.rotation;
            };

            place(current);
            const localHead=head,remaining=[],retired=[];
            for(const item of fading){
                const progress=(now-item.start)/260;
                if(progress>=1){retired.push(item);continue;}
                item.sprite.alpha=1-ease.inOutSine(progress);place(item.sprite);remaining.push(item);
            }
            return {restHead:head,restBody:bodyBounds,localHead,resolved,remaining,retired};
        }
        const pose={update,dispose(){if(closed)return;closed=true;instances.delete(pose);action=null;nonce=null;}};
        instances.add(pose);return pose;
    }
    return {create,dispose(){if(disposed)return;disposed=true;for(const pose of [...instances])pose.dispose();}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigurePose};
