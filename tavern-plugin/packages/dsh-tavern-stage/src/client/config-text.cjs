function createStageConfigText({React:react, fields, reading:sharedReading, limits:STAGE_READING_LIMITS, defaults:STAGE_READING_DEFAULTS, scale:STAGE_TEXT_SCALE, scaleOf:stageTextScaleOf, themes:STAGE_THEMES, fonts:tavernFonts, FontPicker, Typewriter:GalTypewriter, clock:forkForeground, autoDelay:galAutoDelay}) {
let disposed=false;
const cleanups=new Set();
const stageReading={...sharedReading,set:patch=>{if(!disposed)sharedReading.set(patch);}};
const {group:galConfigGroup,row:galConfigRow,slider:galConfigSlider}=fields;
const React={...react,createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
function useEffect(setup,deps){react.useEffect(()=>{
    if(disposed)return;
    const cleanup=setup();if(typeof cleanup!=='function')return;
    let active=true;const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};cleanups.add(release);return release;
},deps);}
const GAL_CONFIG_SAMPLE = "夕阳把走廊染成了橘色。她停下脚步，回头看了你一眼。";
const GAL_CONFIG_FILM_SAMPLE = "今天……可以一起回去吗？";
function stageTextScaleSet(skin, percent) { if(!disposed)stageReading.set({ textScale: { ...stageReading.get().textScale, [skin]: percent } }); }
function GalConfigTextScale(props) {
    const h = React.createElement, skin = props.skin, [min, max, step] = STAGE_TEXT_SCALE;
    const percent = stageTextScaleOf(props.reading, skin.id), label = skin.label || (STAGE_THEMES.find(([value]) => value === skin.id) || [skin.id, skin.id])[1];
    return galConfigRow("文字大小", galConfigSlider(["小", "大"], { min, max, step, value: percent, reset: 100, label: "文字大小",
            valueText: percent + "%", output: percent + "%", onChange: value => stageTextScaleSet(skin.id, value) },
            percent === 100 ? null : { label: "恢复为 100%", onClick: () => stageTextScaleSet(skin.id, 100) }),
        h(React.Fragment, null, h("span", null, "只调整当前皮肤「" + label + "」的文本框文字和选项，每个皮肤各自记住；100% 是皮肤原本的字号。"),
            h("span", null, "字越小，一页放得下越多。")));
}

function GalConfigText(props) {
    const h = React.createElement;
    const stage = props.data && props.data.config && props.data.config.stage || {};
    const reading = React.useSyncExternalStore(stageReading.subscribe,stageReading.get);
    const theme = stage.theme || "classic";
    const [speedMin, speedMax, speedStep] = STAGE_READING_LIMITS.textSpeed, [waitMin, waitMax, waitStep] = STAGE_READING_LIMITS.autoWait;
    // Speed reads left = slow, right = fast (instant at the far right); stored as milliseconds per character.
    const speedValue = speedMax - reading.textSpeed;
    const fonts = typeof tavernFonts !== "undefined" && typeof FontPicker === "function";
    const preview = h(GalConfigPreview, { reading, film: fonts });
    return h(React.Fragment, null,
        galConfigGroup("阅读", null,
            galConfigRow("文字速度", galConfigSlider(["慢", "快"], { min: 0, max: speedMax - speedMin, step: speedStep, value: speedValue, label: "文字速度",
                    valueText: reading.textSpeed === 0 ? "瞬间显示" : reading.textSpeed + " 毫秒每字", output: reading.textSpeed === 0 ? "瞬间" : reading.textSpeed + " ms/字", onChange: value => stageReading.set({ textSpeed: speedMax - value }) }),
                "打字机效果每个字的间隔；拉到最右边整句直接出现。默认 " + STAGE_READING_DEFAULTS.textSpeed + " 毫秒。"),
            galConfigRow("自动阅读速度", galConfigSlider(["慢", "快"], { min: 0.5, max: 3, step: 0.1, value: reading.autoSpeed, label: "自动阅读速度",
                    valueText: reading.autoSpeed.toFixed(1) + " 倍", output: reading.autoSpeed.toFixed(1) + "×", onChange: value => stageReading.set({ autoSpeed: value }) }),
                "按倍率缩放无配音页的阅读时间（含最短停留）和配音结束后的等待；不会截断正在播放的配音。默认 1.3 倍，比原来的节奏稍快。立即生效。"),
            galConfigRow("自动模式等待", galConfigSlider(["短", "长"], { min: waitMin, max: waitMax, step: waitStep, value: reading.autoWait, label: "自动模式等待",
                    valueText: (reading.autoWait / 1000).toFixed(1) + " 秒", output: (reading.autoWait / 1000).toFixed(1) + " 秒", onChange: value => stageReading.set({ autoWait: value }) }),
                h(React.Fragment, null, h("span", null, "配音结束后的基础停顿，再除以自动阅读速度；不会截断配音。"), h("span", null, "无配音页按字数阅读，再加入相对 0.7 秒的等待增减，最后按速度缩放。等待控制停顿，速度控制整体阅读节奏。"))),
            fonts ? null : preview),
        fonts ? galConfigGroup("字体", null,
            // no context, so 「跟随样式」 follows the active stage's skin declaration
            // (fonts.js) and updates when the skin switches. 千禧晴空 (aero) declares no stage font: system 微软雅黑.
            galConfigRow("舞台字体", h(FontPicker, { role: "stage", label: "舞台字体", follow: "跟随样式", builtin: theme === "aero" ? "微软雅黑" : undefined, theme, variant: "stage" }),
                h(React.Fragment, null, h("span", null, "文本框、姓名牌、候选项和这个设置画面用的字体，选中立刻生效。"),
                    h("span", null, "跟随样式：用当前舞台皮肤指定的字体；皮肤没有指定就用内置字体（千禧晴空是系统的微软雅黑）。"))),
            props.textSkin ? h(GalConfigTextScale, { skin: props.textSkin, reading }) : null,
            galConfigRow("字幕字体", h(FontPicker, { role: "film", label: "字幕字体", follow: "跟随样式", theme, variant: "stage" }),
                h(React.Fragment, null, h("span", null, "电影模式下字幕用的字体。"), h("span", null, "跟随样式：用皮肤指定的字幕字体，没有就用皮肤的舞台字体。"))),
            preview) : null);
}
function GalConfigPreview(props) {
    const h = React.createElement;
    const reading = props.reading;
    const [round, setRound] = React.useState(0);
    const [done, setDone] = React.useState(false);
    useEffect(function () { setDone(false); setRound(n => n + 1); }, [reading.textSpeed, reading.autoWait, reading.autoSpeed]);
    useEffect(function () {
        if (disposed || !done) return undefined;
        let active=true;
        const timer = forkForeground.setTimeout(() => { if(!active||disposed)return;setDone(false); setRound(n => n + 1); }, Math.min(6000, galAutoDelay(reading, false, GAL_CONFIG_SAMPLE)));
        return () => {active=false;forkForeground.clearTimeout(timer);};
    }, [done]);
    return h("div", { className: "fork-gal-config-preview", "aria-hidden": true },
        h("span", { className: "fork-gal-config-preview-name" }, "预览"),
        h("div", { className: "fork-gal-config-preview-text" }, h(GalTypewriter, { key: round, text: GAL_CONFIG_SAMPLE, speed: reading.textSpeed, onDone: () => setDone(true) }), done ? h("i", { className: "fork-gal-config-preview-next" }) : null),
        // Film subtitles use their own font (--gal-film-font); a still line on a letterbox strip.
        props.film ? h("div", { className: "fork-gal-config-preview-film" }, h("span", { className: "fork-gal-config-preview-name" }, "字幕"), h("p", null, GAL_CONFIG_FILM_SAMPLE)) : null);
}

return {Text:GalConfigText,Preview:GalConfigPreview,setScale:stageTextScaleSet,dispose(){
    if(disposed)return;disposed=true;
    const errors=[];for(const cleanup of [...cleanups]){try{cleanup();}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Stage text settings cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageConfigText};
