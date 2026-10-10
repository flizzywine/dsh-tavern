function backgroundWaitMessage(progress, now) {
    if (!progress || now - progress.startedAt < 60000) return "";
    const plugin = progress.plugin ? "插件「" + progress.plugin + "」正在结算。" : "";
    return plugin + backgroundPhaseMessage(progress, now);
}
function backgroundPhaseMessage(progress, now) {
    if (progress.phase === "model") {
        return now - progress.lastProgressAt < 15000
            ? "模型仍在输出思考、正文或工具参数，后台任务尚未完成。可以继续等待或停止后台；已生成的正文会保留。"
            : "正在等待模型 API 的有效输出。连续 5 分钟没有有效输出会停止并报错；也可以现在停止后台，保留已生成的正文。";
    }
    return progress.phase === "tool"
        ? "正在执行后台工具或等待人物卡变量处理。若长时间没有完成，可以停止后台；已生成的正文会保留。"
        : "正在准备后台请求。若长时间没有完成，可以停止后台；已生成的正文会保留。";
}
function TavernBackgroundWait(props) {
    const [progress, setProgress] = React.useState(null);
    const [now, setNow] = React.useState(Date.now);
    const active = props.activity?.busy || props.activity?.phase === "pending";
    React.useEffect(function () {
        let disposed = false, loading = false;
        setProgress(null);
        if (!active) return;
        async function refresh() {
            setNow(Date.now());
            if (loading) return;
            loading = true;
            try {
                const result = await rpc("getBackgroundProgress", {}, props.sessionId);
                if (!disposed) setProgress(result.progress);
            } catch (_) { /* Existing task status and stop controls remain usable. */ }
            finally { loading = false; }
        }
        void refresh();
        const timer = window.setInterval(refresh, 5000);
        return function () { disposed = true; window.clearInterval(timer); };
    }, [active, props.sessionId, props.activity?.operationId]);
    const message = backgroundWaitMessage(progress || {phase:"preparing",startedAt:props.activity?.updatedAt || now}, now);
    if (!active || !message) return null;
    return React.createElement("div", {className:"dsh-tavern-status-section", role:"status"},
        React.createElement("p", null, message),
        React.createElement(TavernStopBackgroundAction, {sessionId:props.sessionId}));
}
