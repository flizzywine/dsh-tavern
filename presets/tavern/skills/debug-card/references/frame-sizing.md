# iframe 高度适配

长正文优先撑高 iframe，随主页面滚动。先读 `tavern_read_play_chat` 的 `iframe` 层，检查 `frames[].layout`：模式及来源、实际宽高、可用高度、上下限、html/body/#app 的高度和 scrollHeight、position、overflowY。结合 capturedAt 与错误/网络记录判断是否为当前现场。没有 layout 的旧记录表示未观测，不能用静态代码冒充运行结果。此接口提供已保存证据，不提供实时截图或自动浏览器操作。

## 按模板声明

通过现有正则/HTML 资源修改，在目标面板 HTML 中加入一个 meta：

```html
<!-- 推荐：长内容完整撑高，随宿主页面滚动 -->
<meta name="dsh-tavern-frame" content="content">

<!-- 仅完整应用需要固定可用视口、自行内部滚动时选用 -->
<meta name="dsh-tavern-frame" content="viewport">

<!-- 明确要求固定尺寸时选用；数值为 CSS px，不写单位 -->
<meta name="dsh-tavern-frame" content="fixed" data-height="600">
<!-- 或按宽 / 高比例计算 -->
<meta name="dsh-tavern-frame" content="fixed" data-aspect-ratio="1.5">
```

每个面板只选一条。可选 `data-min-height`、`data-max-height`，均为数值 px。默认下限 48、上限 32000，沿用宿主安全上限；普通长文不要主动设置很小的 max。内容超出明确上限时开放内部滚动，可使用「展开大屏」。viewport/fixed 还受宿主可用区域限制，下限不能强行撑破可用区域；fixed 同时声明 height 与 aspectRatio 时 height 优先。无声明或无效声明继续使用旧兼容测高。

content 保持自然流，不将 html/body/#app 写成依赖 iframe 的百分比高度。viewport/fixed 由宿主恢复 html/body 的 100% 高度链；卡片自己处理 #app、局部滚动、图片比例。尺寸协议不能修复卡片内部所有 CSS。

## 卡片默认值与面板覆盖

也可使用 `tavern_update_card` 的 rawOperations 保存 `extensions.dsh_tavern.frameSizing`。先读取原始结构；V2/V3 通常位于 `/data/extensions/dsh_tavern/frameSizing`。保留同级已有配置，尤其 stateMigrations。

```json
{
  "default": { "mode": "content" },
  "panels": {
    "game-home": { "mode": "viewport" },
    "character-sheet": { "mode": "content" }
  }
}
```

普通 HTML 面板用 `<meta name="dsh-tavern-frame" data-panel-id="game-home">` 绑定稳定 id；持久状态栏可用已有 viewId。覆盖项不绑定轮次、数组位置或临时 token。优先级：模板明确模式 > 面板覆盖 > 卡片默认 > 原兼容行为。配置对象支持 mode、height、aspectRatio、minHeight、maxHeight；数值规则同模板声明。最多 64 个面板 id，仅限字母、数字、下划线、连字符，长度 1–80。

## 保存与验证

布局改动沿用[原存档更新](live-update.md)。纯布局变动无需变量迁移声明；保留原有声明。应用新模板或模式会准备新 iframe，未提交表单输入需先保存；窗口缩放、键盘视口变化和面板移动只调整外框，不重建卡片。

修复后检查原异常页面、长内容末尾和关键按钮；再看刷新后的 layout，并核对剧情与变量不变。没有实际操作条件时请用户在原游戏应用变化并操作后再读证据，报告“资源已修改，待应用验证”。保留原值或差异，便于恢复；删除本次声明可恢复原兼容路径。对会自动更新的远程脚本记录观测时间与资源版本，不能用新版本首页成功代替旧截图异常状态的复现。
