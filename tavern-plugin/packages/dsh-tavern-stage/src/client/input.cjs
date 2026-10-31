// Display input ownership. Emits reader actions; never owns the session cursor or generation.
function createStageInput({React,window,document,clock,controls,navigation}) {
let disposed=false;
const instances=new Set();
function attach(read,send){
    if(disposed)throw new Error('Stage input disposed');
    let active=true,pressedSpace=false,interrupted=false,timer=null,arm=0;
    const cleanups=[];
    const blocked=()=>{const state=read();return state.modal||state.backlog||state.hidden;};
    function cancel(){const old=timer;timer=null;arm++;try{if(old!==null)clock.clearTimeout(old);}finally{send({type:'held',value:false});}}
    function listen(target,type,handler,capture=false){
        const guarded=event=>{if(active&&!disposed)handler(event);};
        cleanups.push(()=>target.removeEventListener(type,guarded,capture));
        target.addEventListener(type,guarded,capture);
    }
    function release(){
        if(!active)return;active=false;instances.delete(instance);interrupted=false;pressedSpace=false;
        const errors=[];
        for(const cleanup of [cancel,...cleanups.reverse()])try{cleanup();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Stage input cleanup failed');
    }
    function onKey(event) {
        const {modal,backlog,hidden,auto,root,widgetOpen}=read();
            // The Config screen and the system menu keep the keyboard (each closes itself on Esc).
            if (modal) return;
            // no stage key while an input method is composing.
            if (event.isComposing || event.keyCode === 229) return;
            // A held Esc (auto-repeat) is not a new press: it would toggle the menu on every repeat while the browser
            // waits for the hold that leaves full screen.
            if (event.key === "Escape" && event.repeat) { event.preventDefault(); return; }
            // An inner overlay (the choice editor, a widget reader, a popover) already took this Esc.
            if (event.key === "Escape" && event.defaultPrevented) return;
            const target = event.target;
            // The chat composer can retain/retake focus behind this portal. Only stage editors
            // own editing keys; an invisible composer must not disable Back or Escape.
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && root && root.contains(target)) return;
            const key = event.key, letter = key.length === 1 && /[a-z]/i.test(key) ? key.toLowerCase() : "";
            const advance = key === " " || key === "Enter" || key === "ArrowRight" || key === "PageDown", back = key === "ArrowLeft" || key === "PageUp" || key === "Backspace";
            // letter shortcuts leave Ctrl / Alt / Meta combinations to the browser
            // (Ctrl+A, Ctrl+R, Ctrl+L); a held key turns one page and toggles once (auto-repeat is ignored).
            if (letter && (event.ctrlKey || event.altKey || event.metaKey)) return;
            if (event.repeat && (advance || back || letter)) { if (advance || back) event.preventDefault(); return; }
            // A control the keyboard focused (Tab, galKeyboardFocus) keeps its own Enter / Space; after a pointer click
            // they belong to the stage again - it pages, and its preventDefault keeps the focused control from being pressed.
            if ((key === " " || key === "Enter") && target && target !== root && typeof target.closest === "function" && target.closest("button, a[href], [role='button']") && root && root.contains(target) && navigation.galKeyboardFocus()) return;
            // The backlog keeps the keyboard (arrows / Page keys scroll it; Enter on a row jumps).
            if (backlog) {
                if (key === "Escape" || letter === "l") { event.preventDefault(); send({type:'backlog',open:false}); }
                return;
            }
            if (letter === "l") { event.preventDefault(); send({type:'backlog',open:true}); return; }
            if (advance) { event.preventDefault(); if (key === " ") pressedSpace = true; send({type:'page',delta:1}); }
            else if (back) { event.preventDefault(); send({type:'page',delta:-1}); }
            else if (event.key === "Escape") {
                event.preventDefault();
                if (hidden) { send({type:'hidden',value:false}); return; }
                if (widgetOpen) {send({type:'collapse-widget'});return;}
                // A modal dialog inside the stage (a widget's reader) closes itself first, even without focus.

                if (root && typeof root.querySelector === "function" && root.querySelector("[aria-modal='true']")) return;
                send({type:'menu'});
            }
            else if (letter === "h") send({type:'hidden',value:!hidden});
            else if (letter === "r") send({type:'replay'});
            // G presses the turn-end menu's 重新生成 (the badge on the 自由输入 row,
            // gal-choices.js) - only while it is shown and can act, so the key follows the control's own rule.
            else if (letter === "g") { if (controls.pressRegenerate(root)) event.preventDefault(); }
            // Like the AUTO control: turning auto on also ends a SKIP.
            else if (letter === "a") { if (!auto) send({type:'skip',value:false}); send({type:'auto',value:!auto}); }
        }

    function onKeyUp(event){if(event.key===' '&&pressedSpace){pressedSpace=false;event.preventDefault();}}
    function interrupt(event){
        if(blocked())return;
        const own=event?.type==='pointerdown'&&event.target?.closest?.(controls.skipSelector);
        const running=read().skipping&&!own;
        interrupted=Boolean(running);cancel();
        if(running)send({type:'skip',value:false});
    }
    function onDown(event){
        if(blocked())return;
        if(event.key!=='Control'){interrupt(event);return;}
        if(event.repeat||timer!==null||event.altKey||event.shiftKey||event.metaKey)return;
        const target=event.target;
        if(target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))return;
        const token=++arm;
        timer=clock.setTimeout(()=>{
            if(!active||disposed||token!==arm)return;
            timer=null;
            if(blocked()||read().atEnd)return;
            send({type:'auto',value:false});send({type:'held',value:true});
        },160);
    }
    const instance={
        reset(){if(!active)return;interrupted=false;pressedSpace=false;cancel();},
        consumeInterrupted(){const value=interrupted;interrupted=false;return value;},
        wasInterrupted:()=>interrupted,
        dispose:release
    };
    try{
        listen(window,'keydown',onKey);
        listen(window,'keyup',onKeyUp,true);
        listen(window,'keydown',onDown,true);
        listen(window,'keyup',event=>{if(event.key==='Control')cancel();},true);
        listen(window,'wheel',interrupt,true);
        listen(window,'pointerdown',interrupt,true);
        listen(window,'blur',cancel);
        listen(document,'visibilitychange',()=>{if(document.hidden)cancel();});
        instances.add(instance);return instance;
    }catch(error){try{release();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage input startup failed');}throw error;}
}
function useInput(frame,send){
    const latest=React.useRef(null),instance=React.useRef(null);
    latest.current={frame,send};
    React.useLayoutEffect(()=>{
        if(disposed)return;
        const input=attach(()=>({...latest.current.frame,root:latest.current.frame.rootRef.current}),action=>latest.current.send(action));instance.current=input;
        return ()=>{instance.current=null;input.dispose();};
    },[]);
    React.useLayoutEffect(()=>{instance.current?.reset();},[frame.sessionId,Boolean(frame.modal||frame.backlog||frame.hidden)]);
    return React.useMemo(()=>({consumeInterrupted:()=>instance.current?.consumeInterrupted()||false,wasInterrupted:()=>instance.current?.wasInterrupted()||false}),[]);
}
return {attach,useInput,dispose(){
    if(disposed)return;disposed=true;const errors=[];
    for(const instance of [...instances])try{instance.dispose();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage input cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageInput};
