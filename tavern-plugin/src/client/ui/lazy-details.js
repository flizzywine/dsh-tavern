		// A closed <details> still mounts its body. Long lists of collapsed rows
		// (scripts, regexes, menus) build their contents only while expanded.
		function TavernLazyDetails(props) {
			const [open, setOpen] = React.useState(props.defaultOpen === true);
			const attributes = Object.assign({}, props.attributes, {
				className: props.className,
				open: open,
				onToggle: function (event) { setOpen(event.currentTarget.open); }
			});
			return React.createElement("details", attributes, props.summary, open ? props.render() : null);
		}
