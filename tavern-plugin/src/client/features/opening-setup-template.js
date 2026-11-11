		// Opening setup v2, template tier (docs/specs/opening-setup-v2.md §4): the card's own layout in a sandboxed
		// frame that runs no script (sandbox="allow-same-origin" only, CSP script-src 'none', compiled by the host).
		// This page owns every control: the form's shared controls are portalled into the <dsh-field> slots,
		// <dsh-value> echoes values and <dsh-start> starts through the form's own start path.
		const OPENING_TEMPLATE_SANDBOX = "allow-same-origin";
		function openingTemplateValueText(field, value, part) {
			if (!field || value === undefined || value === null) return "";
			const options = openingSetupOptions(field);
			if (field.type === "choice") { const option = options.find(function (item) { return item.value === value; }); return !option ? "" : part === "label" ? String(option.label) : part === "text" ? String(option.text || "") : String(option.value); }
			if (field.type === "multi") { const chosen = options.filter(function (item) { return (value || []).indexOf(item.value) >= 0; }); return part === "text" ? chosen.map(function (item) { return item.text || ""; }).filter(Boolean).join("\n") : chosen.map(function (item) { return part === "label" ? item.label : item.value; }).join("、"); }
			if (field.type === "toggle") return part === "text" ? (value ? String(field.text || "") : "") : (value ? "是" : "否");
			return String(value);
		}
		// The frame paints with the page's own styles and the tokens computed at the form root (host theme + card theme).
		function adoptOpeningTemplateStyles(doc, root, hostDocument) {
			const first = doc.head.querySelector("style");
			for (const node of hostDocument.querySelectorAll("style")) {
				const copy = doc.createElement("style");
				copy.setAttribute("data-dsh-host-style", "");
				copy.textContent = node.textContent;
				doc.head.insertBefore(copy, first);
			}
			const computed = hostDocument.defaultView.getComputedStyle(root);
			for (let index = 0; index < computed.length; index++) {
				const name = computed[index];
				// On body too: page sheets define light defaults there that would shadow the page's resolved theme.
				if (name.indexOf("--") === 0) for (const node of [doc.documentElement, doc.body]) node.style.setProperty(name, computed.getPropertyValue(name));
			}
			// The page's colour scheme too: without it the frame is light, so a control's Canvas/field colours turn white on a dark theme.
			doc.documentElement.style.colorScheme = computed.colorScheme;
			doc.documentElement.classList.add("dsh-opening-template-root", "ap-ui");
		}
		function OpeningSetupTemplate(props) {
			const h = React.createElement, setup = props.setup, frame = React.useRef(null), latest = React.useRef(props);
			latest.current = props;
			const [mounted, setMounted] = React.useState(null), [height, setHeight] = React.useState(480);
			const fields = React.useMemo(function () { return new Map(setup.fields.filter(function (field) { return field.key; }).map(function (field) { return [field.key, field]; })); }, [setup]);
			const measure = function () {
				const doc = frame.current && frame.current.contentDocument;
				if (doc && doc.documentElement) setHeight(Math.max(120, Math.ceil(doc.documentElement.scrollHeight)));
			};
			const load = function () {
				const node = frame.current, doc = node && node.contentDocument;
				if (!doc || !doc.body) return;
				adoptOpeningTemplateStyles(doc, node.closest(".dsh-opening-setup") || document.body, document);
				const slots = new Map();
				for (const slot of doc.querySelectorAll("dsh-field[key]")) if (fields.has(slot.getAttribute("key"))) slots.set(slot.getAttribute("key"), slot);
				const starts = Array.prototype.slice.call(doc.querySelectorAll("dsh-start"));
				for (const button of starts) {
					button.setAttribute("role", "button");
					button.tabIndex = 0;
					button.addEventListener("click", function () { latest.current.onStart(); });
					button.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); latest.current.onStart(); } });
				}
				if (typeof ResizeObserver === "function") { const observer = new ResizeObserver(measure); observer.observe(doc.body); node.dshResize = observer; }
				setMounted({ doc: doc, slots: slots, starts: starts });
				measure();
			};
			React.useEffect(function () { return function () { if (frame.current && frame.current.dshResize) frame.current.dshResize.disconnect(); }; }, []);
			// Echo values, show / hide slots by `when`, reflect the busy start.
			React.useEffect(function () {
				if (!mounted) return;
				for (const node of mounted.doc.querySelectorAll("dsh-value[key]")) {
					const key = node.getAttribute("key"), text = props.shown.has(key) ? openingTemplateValueText(fields.get(key), props.values[key], node.getAttribute("part")) : "";
					node.textContent = text || node.getAttribute("fallback") || "";
				}
				for (const [key, slot] of mounted.slots) {
					const hidden = !props.shown.has(key), scope = slot.closest("[data-dsh-when]") || slot;
					scope.hidden = hidden;
					if (scope !== slot) slot.hidden = hidden;
				}
				for (const button of mounted.starts) { if (props.busy) button.setAttribute("aria-disabled", "true"); else button.removeAttribute("aria-disabled"); }
				measure();
			});
			return h(React.Fragment, null,
				h("iframe", { ref: frame, className: "dsh-opening-template", title: setup.title || "开局设置", sandbox: OPENING_TEMPLATE_SANDBOX, referrerPolicy: "no-referrer", srcDoc: setup.template, onLoad: load, style: { height: height + "px" } }),
				mounted ? Array.from(mounted.slots).map(function (entry) { return ReactDOM.createPortal(props.control(fields.get(entry[0]), true), entry[1], entry[0]); }) : null,
				h("div", { className: "dsh-opening-actions" }, mounted && mounted.starts.length ? null : props.startButton, props.error));
		}
