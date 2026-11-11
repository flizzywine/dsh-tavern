		// Opening setup v2 (docs/specs/opening-setup-v2.md): the prep page's own form for a card's declarative
		// opening setup. The host projected `setup` (display text with {{user}}/{{char}} resolved, theme tokens,
		// the compiled template); the greeting frame stays mounted behind the form and starts the game when
		// this form posts the values (§6). Validation of the values is the host's (resolveOpeningSetup).
		function openingSetupOptions(field) {
			return (Array.isArray(field.options) ? field.options : []).map(function (option) {
				return typeof option === "string" ? { value: option, label: option }
					: Object.assign({}, option, { value: option.value === undefined ? option.label : option.value, label: option.label === undefined ? String(option.value) : option.label });
			});
		}
		const OPENING_SETUP_VALUED = { name: true, text: true, choice: true, multi: true, slider: true, toggle: true };
		function openingSetupImage(ref, card) {
			if (ref !== "cover") return ref || "";
			return card && card.hasImage ? "/api/dsh-tavern/card-image?path=" + encodeURIComponent(card.path) : "";
		}
		function openingSetupDefaults(setup) {
			const values = {};
			for (const field of setup.fields) {
				if (!OPENING_SETUP_VALUED[field.type]) continue;
				const options = openingSetupOptions(field);
				values[field.key] = field.default !== undefined ? field.default
					: field.type === "choice" ? options[0] && options[0].value
					: field.type === "multi" ? [] : field.type === "slider" ? field.min : field.type === "toggle" ? false : "";
			}
			return values;
		}
		// `when` follows the host's rule: every condition met, and the fields it reads are themselves shown.
		function openingSetupVisible(setup, values) {
			const shown = new Set();
			for (const field of setup.fields) {
				const ok = !field.when || Object.keys(field.when).every(function (key) {
					if (!shown.has(key)) return false;
					const expected = [].concat(field.when[key]), actual = values[key];
					return Array.isArray(actual) ? actual.some(function (value) { return expected.indexOf(value) >= 0; }) : expected.indexOf(actual) >= 0;
				});
				if (ok && field.key) shown.add(field.key);
				if (ok && !field.key) shown.add(field);
			}
			return shown;
		}
		// Points left in each group with `points`, for the sliders that follow it.
		function openingSetupBudgets(setup, values, shown) {
			const budgets = new Map();
			let group = null;
			for (const field of setup.fields) {
				if (field.type === "group") { group = field.points !== undefined ? { field: field, left: field.points } : null; if (group) budgets.set(field, group); continue; }
				if (group && field.type === "slider" && shown.has(field.key)) { group.left -= (Number(values[field.key]) || field.min) - field.min; budgets.set(field.key, group); }
			}
			return budgets;
		}
		// Route cards: a radiogroup (choice) or a group of toggles (multi), each option a button with its line and picture.
		function OpeningSetupCards(props) {
			const h = React.createElement, field = props.field, multi = field.type === "multi", value = props.value;
			const options = openingSetupOptions(field);
			const on = function (option) { return multi ? (value || []).indexOf(option.value) >= 0 : value === option.value; };
			const pick = function (option) {
				if (props.disabled) return;
				if (!multi) { props.onChange(option.value); return; }
				const next = on(option) ? (value || []).filter(function (item) { return item !== option.value; }) : options.filter(function (item) { return on(item) || item === option.value; }).map(function (item) { return item.value; });
				props.onChange(next);
			};
			const keys = function (event) {
				if (multi) return;
				const at = options.findIndex(on), n = options.length;
				const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[event.key];
				if (next === undefined || !n) return;
				event.preventDefault();
				const option = options[(next + n) % n];
				pick(option);
				const buttons = event.currentTarget.querySelectorAll("button");
				if (buttons[(next + n) % n]) buttons[(next + n) % n].focus();
			};
			const stop = options.findIndex(on) < 0 ? 0 : options.findIndex(on);
			return h("div", { className: "dsh-opening-cards", role: multi ? "group" : "radiogroup", "aria-label": field.label, onKeyDown: keys },
				options.map(function (option, index) {
					const image = openingSetupImage(option.image, props.card);
					return h("button", { key: String(option.value), type: "button", className: "dsh-opening-card", role: multi ? "checkbox" : "radio", "aria-checked": on(option),
						tabIndex: multi || index === stop ? 0 : -1, disabled: props.disabled || undefined, onClick: function () { pick(option); } },
						image ? h("img", { className: "dsh-opening-card-image", src: image, alt: "", loading: "lazy" }) : null,
						h("span", { className: "dsh-opening-card-label" }, option.label),
						option.desc ? h("span", { className: "dsh-opening-card-desc" }, option.desc) : null);
				}));
		}
		// One control per field type, built from the shared components (ui-design §三); `inFrame` (template tier)
		// keeps every control inside the sandboxed document: route cards instead of a menu that would open outside it.
		function createOpeningFieldControl(field, ctx) {
			const h = React.createElement, value = ctx.value, disabled = ctx.disabled;
			const help = field.help ? h("span", { className: "dsh-opening-help" }, field.help) : null;
			if (field.type === "note") {
				return field.fold ? h("details", { className: "dsh-opening-note" }, h("summary", null, field.fold), h("p", null, field.text))
					: h("p", { className: "dsh-opening-note" }, field.text);
			}
			if (field.type === "group") {
				const budget = ctx.budget;
				return h("div", { className: "dsh-opening-group" }, h("span", { className: "dsh-opening-group-title" }, field.label),
					budget ? h("span", { className: "dsh-opening-group-points", "data-over": budget.left < 0 || undefined, role: "status" }, "剩余 " + budget.left + " 点") : null);
			}
			if (field.type === "name" || field.type === "text") {
				return h("div", { className: "dsh-opening-field", "data-type": field.type },
					h(InlineField, { kind: "text", label: field.label, value: value || "", placeholder: field.placeholder || (field.type === "name" ? "你" : "未填写"), multiline: field.multiline || undefined, lines: field.multiline || undefined,
						maxLength: field.maxLength || (field.type === "name" ? 40 : 200), count: true, wide: true, disabled: disabled, onCommit: ctx.onChange }), help);
			}
			if (field.type === "toggle") {
				return h("div", { className: "dsh-opening-field", "data-type": "toggle" }, h(InlineRow, { label: field.label }, h(Switch, { checked: !!value, label: field.label, disabled: disabled, onChange: ctx.onChange })), help);
			}
			if (field.type === "slider") {
				const budget = ctx.budget, current = Number(value) || field.min;
				const max = budget ? Math.min(field.max, current + Math.max(0, budget.left)) : field.max;
				return h("div", { className: "dsh-opening-field", "data-type": "slider" }, h(InlineRow, { label: field.label },
					h(Slider, { value: current, min: field.min, max: field.max, step: field.step || 1, label: field.label, disabled: disabled, output: String(current), valueText: String(current),
						onChange: function (next) { ctx.onChange(Math.min(next, max)); } })), help);
			}
			const options = openingSetupOptions(field);
			const pictured = options.some(function (option) { return option.desc || option.image; });
			let control;
			if (field.type === "multi" || pictured || ctx.inFrame) control = h(OpeningSetupCards, { field: field, value: value, card: ctx.card, disabled: disabled, onChange: ctx.onChange });
			else if (options.length <= 3 && options.every(function (option) { return String(option.label).length <= 8; })) control = h(Segmented, { label: field.label, value: value, disabled: disabled, options: options.map(function (option) { return [option.value, option.label]; }), onChange: ctx.onChange });
			else return h("div", { className: "dsh-opening-field", "data-type": field.type }, h(InlineField, { kind: "menu", label: field.label, value: value, wide: true, disabled: disabled, options: options.map(function (option) { return { value: option.value, label: option.label }; }), onCommit: ctx.onChange }), help);
			return h("div", { className: "dsh-opening-field", "data-type": field.type, role: "group", "aria-label": field.label },
				h("span", { className: "dsh-opening-field-label" }, field.label), control, help);
		}
		// The greeting frame behind the form: its prep runtime and bridge start the game.
		function openingSetupFrame(host) {
			const frames = host ? host.querySelectorAll("iframe.dsh-tavern-message-frame") : [];
			for (const frame of frames) if (frame.getAttribute("aria-hidden") !== "true" && frame.contentWindow) return frame;
			return null;
		}
		function startOpeningSetup(host, values, hostWindow) {
			const win = hostWindow || window, frame = openingSetupFrame(host);
			if (!frame) return Promise.reject(new Error("开场还在准备，请稍候再试"));
			return new Promise(function (resolve, reject) {
				const timer = win.setTimeout(function () { win.removeEventListener("message", listen); reject(new Error("开局没有响应，请重试")); }, 180000);
				function listen(event) {
					const data = event.data;
					if (event.source !== frame.contentWindow || !data || data.type !== "dsh-tavern-opening-setup-result") return;
					win.clearTimeout(timer); win.removeEventListener("message", listen);
					if (data.ok) resolve(); else reject(new Error(String(data.error || "开局未完成")));
				}
				win.addEventListener("message", listen);
				frame.contentWindow.postMessage({ type: "dsh-tavern-opening-setup-start", values: values }, "*");
			});
		}
		// The values the host receives: schema keys of the fields that are shown, nothing else.
		function openingSetupSubmission(setup, values) {
			const shown = openingSetupVisible(setup, values), out = {};
			for (const field of setup.fields) if (OPENING_SETUP_VALUED[field.type] && shown.has(field.key)) out[field.key] = values[field.key];
			return out;
		}
		function OpeningSetupForm(props) {
			const h = React.createElement, setup = props.setup;
			const [values, setValues] = React.useState(function () { return openingSetupDefaults(setup); });
			const [state, setState] = React.useState({ busy: false, error: "" });
			const host = React.useRef(null);
			const shown = openingSetupVisible(setup, values), budgets = openingSetupBudgets(setup, values, shown);
			const setValue = function (key, value) { setValues(function (current) { return Object.assign({}, current, { [key]: value }); }); setState({ busy: false, error: "" }); };
			const start = function () {
				if (state.busy || props.disabled) return;
				setState({ busy: true, error: "" });
				startOpeningSetup(host.current, openingSetupSubmission(setup, values)).catch(function (error) { setState({ busy: false, error: String(error && error.message || error).replace(/^开局设置：/, "") }); });
			};
			const style = Object.assign({}, setup.style || {});
			const image = openingSetupImage(setup.theme && setup.theme.image, props.card);
			if (image && setup.theme.image === "cover") style["--dsh-opening-image"] = 'url("' + image + '")';
			if (setup.theme && setup.theme.accent) style["--fork-accent"] = setup.theme.accent;
			const control = function (field, inFrame) {
				return createOpeningFieldControl(field, { value: field.key ? values[field.key] : undefined, budget: budgets.get(field.key || field), card: props.card, inFrame: inFrame, disabled: state.busy || props.disabled,
					onChange: function (value) { setValue(field.key, value); } });
			};
			const startButton = h("button", { type: "button", className: "dsh-tavern-question-primary dsh-opening-start", disabled: state.busy || props.disabled || undefined, onClick: start }, state.busy ? h(React.Fragment, null, h(Spinner, {}), " 正在开局…") : "开始");
			const error = state.error ? h("p", { className: "dsh-opening-error", role: "alert" }, state.error) : null;
			const head = setup.title || setup.intro ? h("header", { className: "dsh-opening-head" }, setup.title ? h("h2", { className: "dsh-opening-title" }, setup.title) : null, setup.intro ? h("p", { className: "dsh-opening-intro" }, setup.intro) : null) : null;
			const body = setup.template
				? h(OpeningSetupTemplate, { setup: setup, values: values, shown: shown, control: control, busy: state.busy, onStart: start, startButton: startButton, error: error })
				: h(React.Fragment, null, head, h("div", { className: "dsh-opening-fields" }, setup.fields.filter(function (field) { return shown.has(field.key || field); }).map(function (field, index) {
					return h(React.Fragment, { key: field.key || "f" + index }, control(field, false));
				})), h("div", { className: "dsh-opening-actions" }, startButton, error));
			// ap-ui: the shared controls (InlineField, Segmented, Switch, Slider) take their panel look inside it (ui-design R23).
			return h("div", { className: "dsh-opening-setup ap-ui", "data-opening-setup": setup.template ? "template" : "form", "data-layout": setup.theme && setup.theme.layout === "split" && image ? "split" : "center", style: style },
				image && !setup.template ? h("div", { className: "dsh-opening-art", "aria-hidden": true }) : null,
				h("div", { className: "dsh-opening-panel" }, body),
				// The greeting stays laid out but out of sight; display:none would stop its frame.
				h("div", { ref: host, className: "dsh-opening-frame-host", "aria-hidden": true }, props.children));
		}
