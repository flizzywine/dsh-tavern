// 卡脚本诊断弹窗（proposal-card-runtime-full.md A.6.1）
// 服务端沙箱/分派/钩子的失败经 view.tavernHelperScriptDiagnostics 到达前端。
// error/warning 级（功能受影响）复用产品自带 dsh-tavern-prompt 弹窗展示（askTavernConfirm 同款
// 样式类系）；info 级（如自愈成功）只进控制台，不打扰。同批条目只弹一次，支持一键复制反馈。
// 挂接：main.js 的脚本运行时 view 同步处调用 showCardScriptDiagnostics(sessionId, view)。
(function () {
	"use strict";
	var seenFingerprints = new Set();

	function esc(value) {
		return String(value === undefined || value === null ? "" : value)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function openNoticeDialog(entries) {
		if (typeof document === "undefined") return;
		if (document.querySelector("dialog.dsh-card-script-notice")) return;
		var dialog = document.createElement("dialog");
		dialog.className = "dsh-tavern-prompt dsh-card-script-notice";
		dialog.setAttribute("aria-label", "卡脚本提示");
		var panel = document.createElement("div");
		panel.className = "dsh-tavern-prompt-panel";
		var title = document.createElement("div");
		title.className = "dsh-tavern-prompt-title";
		title.textContent = "卡脚本提示";
		var description = document.createElement("div");
		description.style.whiteSpace = "pre-wrap";
		description.style.maxWidth = "460px";
		for (var i = 0; i < entries.length; i++) {
			var item = entries[i] || {};
			var row = document.createElement("div");
			row.style.margin = "6px 0";
			row.innerHTML = "<b>" + esc(item.name || "卡脚本") + "</b>：" + esc(item.message || "");
			description.appendChild(row);
		}
		var actions = document.createElement("div");
		actions.className = "dsh-tavern-prompt-actions";
		var copy = document.createElement("button");
		copy.type = "button"; copy.className = "dsh-tavern-btn"; copy.textContent = "复制反馈";
		copy.addEventListener("click", function () {
			var text = entries.map(function (item) {
				return "[" + (item.status || "info") + "] " + (item.name || "卡脚本") + ": " + (item.message || "");
			}).join("\n");
			try { navigator.clipboard.writeText(text); } catch (_error) {}
			copy.textContent = "已复制";
			setTimeout(function () { copy.textContent = "复制反馈"; }, 1500);
		});
		var close = document.createElement("button");
		close.type = "button"; close.className = "dsh-tavern-btn primary"; close.textContent = "知道了";
		close.addEventListener("click", function () { dialog.close(); });
		actions.append(copy, close);
		panel.append(title, description, actions);
		dialog.append(panel);
		dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
		document.body.append(dialog);
		try { dialog.showModal(); } catch (_error) { dialog.remove(); }
		dialog.addEventListener("close", function () { dialog.remove(); });
	}

	window.showCardScriptDiagnostics = function (sessionId, view) {
		var list = view && Array.isArray(view.tavernHelperScriptDiagnostics) ? view.tavernHelperScriptDiagnostics : [];
		if (list.length === 0) return;
		var fingerprint = String(sessionId || "") + "|" + list.map(function (item) {
			return (item.status || "") + ":" + (item.name || "") + ":" + (item.message || "");
		}).join("|");
		if (seenFingerprints.has(fingerprint)) return;
		seenFingerprints.add(fingerprint);
		if (seenFingerprints.size > 200) seenFingerprints.clear();
		var attention = [];
		for (var i = 0; i < list.length; i++) {
			var item = list[i] || {};
			if (item.status === "error" || item.status === "warning") attention.push(item);
			else console.info("[卡脚本诊断]", item.name || "", item.message || "");
		}
		if (attention.length > 0) openNoticeDialog(attention);
	};
})();
