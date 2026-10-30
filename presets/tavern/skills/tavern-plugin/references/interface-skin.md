# 皮肤规范

规范版本：**1**

「设置 › Theme / 外观 › 皮肤」里列出所有皮肤，玩家一次只选一套：内置的几套配色（酒馆 · 暖陶土、沉静蓝、午夜黑……）、内置的「纸感」，以及玩家自己导入的皮肤。

可导入的皮肤是一个 `.css` 文件，导入后出现在同一个列表里，可以只改颜色，也可以连字体、形状一起改。皮肤只有样式，没有脚本，导入别人的皮肤不会碰到存档、不会运行代码。内置的「纸感」（来自社区贡献）就是这样一个文件，可以当参考。

需要改页面结构、加按钮、跑脚本的，不是皮肤，请写[插件](plugin-api.md)。舞台（galgame 画面）的外观另有舞台皮肤，不归本文管。

## 文件格式

- 一个 UTF-8 编码的 `.css` 文件，不超过 5 MB。
- 文件名就是皮肤名：`纸感.css` 导入后显示为「纸感」。
- 字体：用 `@font-face` 以 `data:` 地址内嵌，或用 `local()` 引用玩家电脑上的字体并写好回退。不要引用外部网址，离线和手机上会失效。
- 图片：同样以 `data:` 地址内嵌。

## 生效方式

选中一套 CSS 皮肤时，酒馆先换回「酒馆 · 暖陶土」作底（跟随浅色/深色），再把皮肤的 `<style>` 放在所有样式**之后**；选别的皮肤时它被撤掉。所以皮肤没写到的地方保持暖陶土的样子，不会和别的皮肤叠在一起。切换、删除立即生效，不用刷新。

## 改颜色

颜色由 DSH 的主题变量决定，酒馆和 DSH 自己的界面都用它。当前配色把这些变量写在 `body` 的行内样式上，所以皮肤要在 `body` 上加 `!important` 才能盖过：

```css
body {
  --dsw-alias-brand-primary: #8a5a3c !important;     /* 强调色 */
  --dsw-alias-brand-text: #fff9f2 !important;        /* 强调色上的文字 */
  --dsw-alias-bg-base: #f6f1e7 !important;           /* 页面底色 */
  --dsw-alias-bg-layer-1: #fffdf8 !important;        /* 卡片、面板 */
  --dsw-alias-label-primary: #2e2921 !important;     /* 正文文字 */
  --dsw-alias-label-secondary: #6f6759 !important;   /* 次要文字 */
  --dsw-alias-border-l1: #e9e1d4 !important;         /* 细线 */
  --dsw-alias-border-l2: #ddd3c4 !important;
}
```

只想微调酒馆自己的部分，也可以改下面的酒馆变量（默认由上面的 DSH 变量推导，不需要 `!important`）。酒馆的所有界面，以及传给人物卡 iframe 的颜色，都从这组变量取值：

| 变量 | 用途 |
|---|---|
| `--dsh-tavern-accent` | 酒馆的强调色 |
| `--dsh-tavern-accent-soft` | 强调色浅底（选中、悬停） |
| `--dsh-tavern-accent-border` | 强调色描边 |
| `--dsh-tavern-accent-ink` | 主要文字 |
| `--dsh-tavern-accent-muted` | 次要文字 |
| `--dsh-tavern-accent-hairline` | 分隔线 |
| `--dsh-tavern-accent-cream` | 酒馆区域的底色 |
| `--dsh-tavern-accent-surface` | 酒馆卡片、面板底色 |
| `--dsh-tavern-accent-error` | 错误提示 |
| `--dsh-tavern-radius-sm` / `-md` / `-lg` | 圆角 |
| `--dsh-tavern-font-display` | 标题字体 |
| `--dsh-tavern-font-sans` | 界面字体 |

## 深色模式

玩家在「通用设置 › 外观」里选浅色、深色或跟随系统；深色时 `body` 上有 `data-ds-dark-theme` 属性。皮肤若只为浅色设计，把颜色写在 `body:not([data-ds-dark-theme])` 下，深色时保持暖陶土的深色；两种都做：

```css
body:not([data-ds-dark-theme]) { --dsw-alias-bg-base: #f6f1e7 !important; }
body[data-ds-dark-theme] { --dsw-alias-bg-base: #1d1a16 !important; }
```

## 稳定的类名

下表的类名是公开接口：只加不改，确需改名时旧名至少保留 6 个月。表外的类名、元素结构、DSH 宿主带哈希的类名（如 `_titleRow_x1y2`）都不是接口，随时会变，用了就可能在某次更新后失效。

| 类名 | 位置 |
|---|---|
| `.dsh-tavern-shell-active` | 加在 `body` 上，表示酒馆界面已启用；需要只在酒馆里生效的规则可以以它开头 |
| `.dsh-tavern-sidebar` | 左栏 |
| `.dsh-tavern-history-group` | 游玩历史里的一组（同一张人物卡） |
| `.dsh-tavern-history-group-name` | 组名 |
| `.dsh-tavern-history-group-count` | 组内对话数 |
| `.dsh-tavern-history-group-items` | 组内对话列表 |
| `.dsh-tavern-header-items` | 顶栏右侧的按钮组 |
| `.dsh-tavern-assistant` | 一段正文 |
| `.dsh-tavern-user-row` | 一条玩家消息所在的行 |
| `.dsh-tavern-user-bubble` | 玩家消息气泡 |
| `.dsh-tavern-choice-trigger` | 正文下方的「生成候选项」「重新生成正文」等按钮 |
| `.dsh-tavern-status-dashboard` | 右栏「酒馆状态」 |
| `.dsh-tavern-card-grid` | 人物卡网格 |
| `.dsh-tavern-card-grid-item` | 网格里的一张人物卡 |
| `.dsh-tavern-btn` | 酒馆的通用按钮 |

DSH 宿主区域可以用它的 `data-slot` 属性定位（如 `[data-slot="conversation.header"]`），这些由 DSH 维护，酒馆不做承诺。

## 管不到的地方

- 人物卡自带的状态栏、前端界面运行在独立的 iframe 里，样式归卡片自己，皮肤的规则进不去。酒馆只把 6 个颜色变量传进去，跟随皮肤和深浅色实时更新，卡片可以选用：`--dsh-theme-bg`（底色）、`--dsh-theme-surface`（面板）、`--dsh-theme-text`（文字）、`--dsh-theme-muted`（次要文字）、`--dsh-theme-accent`（强调色）、`--dsh-theme-border`（细线）。
- 舞台用舞台皮肤。
- 改不了文字内容、按钮的有无和顺序。

## 示例

```css
/* 书页：暖纸底色、正文衬线字体、放宽行距，玩家气泡更圆；只做浅色 */
body:not([data-ds-dark-theme]) {
  --dsw-alias-bg-base: #f6f1e7 !important;
  --dsw-alias-bg-layer-1: #fffdf8 !important;
  --dsw-alias-brand-primary: #a9583e !important;
}
.dsh-tavern-assistant {
  font-family: "LXGW WenKai", "Songti SC", serif;
  line-height: 1.9;
}
.dsh-tavern-user-bubble {
  border-radius: var(--dsh-tavern-radius-lg);
}
```
