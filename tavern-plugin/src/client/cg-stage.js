// minimal production overlay; artwork stays outside scene grading and camera transforms.
// @include cg-consumer.cjs
function cgPaintFrame(element,frame) {
    if (!element) return false;
    element.style.display=frame.visible ? 'block' : 'none';
    element.style.opacity=String(frame.white > 0 || frame.current && frame.previous ? 1 : frame.alpha);
    const flash=element.querySelector('.fork-cg-white');
    if (flash) flash.style.opacity=String(frame.white || 0);
    const images=element.querySelectorAll('img'), view={width:element.clientWidth,height:element.clientHeight};
    [frame.previous,frame.current].forEach((value,index)=>{
        const image=images[index];
        if (!value) {image.style.display='none';image.removeAttribute('src');return;}
        if (image.getAttribute('src') !== value.media.url) image.src=value.media.url;
        image.alt=value.label || 'CG';image.style.display='block';
        image.style.opacity=String(frame.current && frame.previous ? index ? frame.alpha : 1-frame.alpha : 1);
        if (image.naturalWidth && view.width) {
            const transform=cgTransform(view,{width:image.naturalWidth,height:image.naturalHeight},frame.focus);
            image.style.transform=`translate(${transform.x}px,${transform.y}px) scale(${transform.zoom})`;
        }
    });
    return !!frame.current && images[1].complete && images[1].naturalWidth > 0 && view.width > 0 && view.height > 0 && element.isConnected && !document.hidden && element.checkVisibility?.({checkVisibilityCSS:true,checkOpacity:true}) !== false;
}
function CgGallery(props) { return stageViews ? React.createElement(stageViews.gallery.Gallery, props) : null; }
function useCgStage(...args) { return stageViews.cg.useStage(...args); }
