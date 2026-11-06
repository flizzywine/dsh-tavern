// Players read a provider moderation stop or a model refusal as "Tavern is broken".
// Say plainly what happened. Detection reuses the shared rules in response-classification.js.
const TAVERN_REFUSAL_TOPIC = /内容|请求|政策|安全|露骨|色情|性|未成年|涉及|guideline|policy|content|explicit/i;
// Where the player can drop the foreground tool calls that a strict provider tends
// to filter or cut short mid-turn: 本局设置 → 高级 → 前台工具.
const TAVERN_FOREGROUND_TOOL_HINT = "也可以试试在「本局设置 → 高级 → 前台工具」关掉前台工具后再发一次。";
function tavernProviderRefusalNotice(errorText) {
    return classifyResponse({ error: String(errorText || "") }).method === "provider-signal"
        ? "模型服务商的内容审核拦截了这一轮回复，这不是酒馆故障。可以修改输入后重新发送。" + TAVERN_FOREGROUND_TOOL_HINT : "";
}
function tavernModelRefusalNotice(text) {
    // Only the opening line, and only when it talks about content or policy: a refusal
    // answers instead of narrating, while lines like "我不能就这样离开她" stay fiction.
    const lead = String(text || "").trim().split("\n")[0].slice(0, 300);
    return lead && classifyResponse({ text: lead }).method === "text-pattern" && TAVERN_REFUSAL_TOPIC.test(lead)
        ? "模型拒绝继续这段剧情（模型自身的内容安全限制），这不是酒馆故障。可以回退本轮后修改输入。" + TAVERN_FOREGROUND_TOOL_HINT : "";
}
