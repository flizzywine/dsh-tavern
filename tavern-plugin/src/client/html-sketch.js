// Card-workbench sketches: closed ```html fences render as static previews.
// Scripts never run and the CSP blocks remote loads, so a sketch only shows layout.
function splitTavernHtmlSketches(text) {
    const source = String(text || "");
    const fence = /(^|\n)```html[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/gi;
    const parts = [];
    let last = 0, match;
    while ((match = fence.exec(source))) {
        const start = match.index + match[1].length;
        if (start > last) parts.push({ kind: "markdown", text: source.slice(last, start) });
        parts.push({ kind: "sketch", html: match[2] });
        last = fence.lastIndex;
    }
    if (last < source.length) parts.push({ kind: "markdown", text: source.slice(last) });
    return parts;
}
function tavernSketchDocument(html) {
    return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
        + '<style>html,body{margin:0}body{padding:8px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}*{scrollbar-width:none!important}</style>' + String(html || "");
}
function TavernHtmlSketch(props) {
    const frame = React.useRef(null);
    const [height, setHeight] = React.useState(160);
    const measure = React.useCallback(function () {
        const body = frame.current && frame.current.contentDocument && frame.current.contentDocument.body;
        if (body) setHeight(Math.min(900, Math.max(48, Math.ceil(body.scrollHeight))));
    }, []);
    return React.createElement("figure", { className: "dsh-tavern-html-sketch" },
        React.createElement("figcaption", null, "美化草图 · 仅示意，脚本不运行"),
        // allow-same-origin without allow-scripts lets the parent measure height; the sketch itself stays inert.
        React.createElement("iframe", { ref: frame, title: "美化草图", sandbox: "allow-same-origin", srcDoc: tavernSketchDocument(props.html), style: { height: height + "px" }, onLoad: measure }),
        React.createElement("details", null, React.createElement("summary", null, "查看代码"), React.createElement("pre", null, props.html)));
}
