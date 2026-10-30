// the one loading indicator. Every fork loading state uses this component: transcript
// avatars, pack thumbnails, emotion face previews, the character modal's Live2D card, stage resource notices, voice
// buttons, busy lines. An iOS-style activity indicator: twelve tapered spokes stay in place and fade one step behind
// each other, so the bright head runs smoothly round (styles: `.fork-spinner` in theme.css).
// No flash: nothing is drawn until the load has lasted SPINNER_DELAY_MS; a fast (cached) load never shows it.
// A new load restarts the delay when the caller gives the spinner a new React key.
// props: { fill, className, label, out, delay }.
//   fill  - an overlay centred in the host's padding box (host must be positioned), sized from the box; nothing at all
//           is rendered before the delay. Without fill it is an inline em box, reserved from the first frame (the
//           wheel appears inside it), so it never shifts layout.
//   out   - the load has finished: a spinner already showing fades out (the caller unmounts it afterwards); one not yet
//           showing never appears.
//   label - a status label (role=status); otherwise the spinner is aria-hidden and the caller states what is loading.
const SPINNER_DELAY_MS = 150;
const SPINNER_SPOKES = 12;
function Spinner(props) {
    const h = React.createElement;
    const p = props || {}, out = !!p.out, delay = typeof p.delay === "number" ? p.delay : SPINNER_DELAY_MS;
    const [ready, setReady] = React.useState(delay <= 0);
    React.useEffect(function () {
        if (ready || out) return;
        const timer = setTimeout(() => setReady(true), delay);
        return () => clearTimeout(timer);
    }, [ready, out]);
    if (p.fill && !ready) return null;
    const spokes = [];
    if (ready) for (let i = 0; i < SPINNER_SPOKES; i++) spokes.push(h("i", { key: i }));
    return h("span", { className: "fork-spinner" + (p.fill ? " is-fill" : "") + (p.className ? " " + p.className : ""),
        "data-out": ready && out ? true : undefined, role: p.label ? "status" : undefined,
        "aria-label": p.label || undefined, "aria-hidden": p.label ? undefined : true },
        ready ? h("span", { className: "fork-spinner-wheel" }, spokes) : null);
}
