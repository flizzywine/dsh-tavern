// presentation settings only.
// Dialogue box style cards (shared by both settings modes and the in-stage Config panel).
// "crt" is the built-in 显像管 phosphor screen, "aero" the 千禧晴空 Frutiger Aero
// sky glass. Kept literal: tests read this list from the source.
const STAGE_THEMES = [["classic", "经典"], ["gothic", "哥特金边"], ["magical", "魔法少女"], ["crt", "显像管"], ["aero", "千禧晴空"]];
function StageThemePicker(props) {
    const h = React.createElement;
    const value = props.value || "classic";
    return h("div", { className: "fork-stage-themes", role: "radiogroup", "aria-label": "对话框样式" },
        STAGE_THEMES.map(([id, label]) =>
            h("button", { key: id, type: "button", role: "radio", "aria-checked": value === id, className: "fork-stage-theme", "data-theme": id, onClick: () => { if (id !== value) props.onChange(id); } },
                h("span", { className: "fork-stage-theme-swatch", "aria-hidden": true }, h("i")), h("b", null, label))));
}
