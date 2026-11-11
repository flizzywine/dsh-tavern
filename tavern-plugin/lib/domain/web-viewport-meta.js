// 安卓 Chrome（108+）默认 `interactive-widget=resizes-visual`：输入法动画期间布局视口不动，
// 页面只能等 visualViewport 的 resize，而那要等动画收尾才来 —— 也就是「输入法先弹、页面过一会
// 才上移」，事件漏一次就彻底不动。`interactive-widget` 只在页面加载时读一次，脚本改 meta 无效
// （Chromium 未实现动态生效），所以只能改宿主动态下发的 HTML。
const INTERACTIVE_WIDGET = "interactive-widget=resizes-content";
const VIEWPORT_META = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;

/**
 * 让安卓浏览器把软键盘当成窗口高度的一部分：布局视口跟着输入法逐帧变短，
 * 页面（酒馆外壳按 100% 跟随）自然同帧重排，不再靠 JS 追 visualViewport。
 * status: 'patched'（已写入）、'already'（本来就是 resizes-content）、'unmatched'（宿主换形状，保持原样）。
 */
export function patchViewportMetaSource(source) {
  const text = String(source ?? "");
  const meta = VIEWPORT_META.exec(text);
  if (!meta) return { status: "unmatched" };
  const tag = meta[0];
  const content = /content\s*=\s*(["'])([^"']*)\1/i.exec(tag);
  if (!content) return { status: "unmatched" };
  const value = content[2];
  const existing = /interactive-widget\s*=\s*([a-z-]+)/i.exec(value);
  if (existing && existing[1].toLowerCase() === "resizes-content") return { status: "already" };
  // 已有的 resizes-visual 等取值要改掉，而不是再拼一个（同一属性出现两次时后者未必生效）。
  const next = existing
    ? value.slice(0, existing.index) + INTERACTIVE_WIDGET + value.slice(existing.index + existing[0].length)
    : `${value.replace(/\s*$/, "")}${value.trim().endsWith(",") ? " " : ", "}${INTERACTIVE_WIDGET}`;
  const patchedTag = tag.slice(0, content.index) + `content=${content[1]}${next}${content[1]}` + tag.slice(content.index + content[0].length);
  return { status: "patched", text: text.slice(0, meta.index) + patchedTag + text.slice(meta.index + tag.length) };
}
