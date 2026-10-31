// Presentation-only turn navigation. No history read here may start a director task.
// @include gal-chat-entry.js
function galParagraphCount(text) {
    return galParagraphs([{ segments: parseBubbles(String(text || ''), false) }]).length;
}
// Icon-only: the stage glyph is drawn by CSS (theme.css "chat stage entry"), so the button adds no text to the
// paragraph (copying prose never picks up a label); the tooltip and the accessible name carry the words.
function StageEnterHere(props) {
    return React.createElement('button', { type: 'button', className: 'fork-stage-enter-here', 'aria-label': '从这里进入舞台', title: '从这里进入舞台',
        onClick: event => { event.preventDefault(); event.stopPropagation(); galEnter(props.sessionId, { turn: props.turn, para: props.para }); } });
}
// The entry sits at the end of the bubble's last line: the row renders it (props.enter) inside its text block.
// no portal; each portal container installed React's full delegated listener set.
function StageParagraph(props) {
    const timer = React.useRef(null), root = React.useRef(null);
    const [pressed, setPressed] = React.useState(false);
    React.useLayoutEffect(function () {
        if (!root.current) return;
        root.current.querySelectorAll('p, .fork-bubble').forEach(node => {
            node.setAttribute('data-fork-stage-turn', props.turn); node.setAttribute('data-fork-stage-para', props.para);
        });
    }, [props.turn, props.para, props.children]);
    function cancel() { clearTimeout(timer.current); }
    React.useEffect(() => cancel, []);
    return React.createElement('div', { ref: root, className: 'fork-stage-paragraph' + (pressed ? ' is-long-pressed' : ''), 'data-fork-stage-turn': props.turn, 'data-fork-stage-para': props.para,
        onPointerDown: event => { if (event.pointerType !== 'mouse') timer.current = setTimeout(() => setPressed(true), 500); }, onPointerUp: cancel, onPointerCancel: cancel, onPointerMove: cancel },
        props.children);
}
