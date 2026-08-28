# SillyTavern CSS 兼容环境调研

> 调研日期：2026-08-28  
> 上游仓库：[`SillyTavern/SillyTavern`](https://github.com/SillyTavern/SillyTavern)  
> 锁定分支与提交：`release` / [`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`](https://github.com/SillyTavern/SillyTavern/commit/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8)（[`package.json` 版本 `1.18.0`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/package.json#L118)）  
> 范围：只研究官方源码和官方文档；不把社区人物卡的偶然用法当成官方契约。

## 结论

SillyTavern 并不存在一份可以简单称为“人物卡 CSS”的文件。它在同一个浏览器文档中叠加出一套公共前端环境：

1. Noto Sans / Noto Sans Mono 字体；
2. Font Awesome 6.5.2 的 core、solid、brands 样式和字体文件；
3. `style.css` 中的主题变量、基础控件样式、消息正文样式及大量宿主界面样式；
4. `st-tailwind.css` 中的一组 ST 自定义工具类；
5. jQuery UI、highlight.js、Cropper、Toastr、Select2 等第三方控件样式；
6. 世界书、群组、移动端等功能区样式；
7. 用户主题的动态 CSS 变量与 Custom CSS；
8. 每个启用扩展通过 `manifest.json.css` 注入的全局样式。

传统 ST 中，聊天正文和 UI 扩展都处于这个主文档，因此可以直接“碰到”这些全局样式。dsh-tavern 将人物卡 UI 放入独立 iframe 后，浏览器不会继承父文档 CSS，这些隐式依赖必须由兼容层显式提供。

如果当前目标是**最大兼容而不是最小实现**，就不应继续手工猜测“常用 CSS 白名单”。更可靠的参照是 ST 最终页面按顺序生效的全部 stylesheet、inline style，以及根节点运行时主题变量。由于完整 `style.css` 同时包含 `body { height: 100dvh; overflow: hidden; }` 等宿主 shell 规则，iframe 在加载完整环境后还需要一层很薄的 iframe adapter，修正透明背景、高度和滚动；除此之外尽量不改上游语义。

官方服务的 `/` 路径实际返回 `public/index.html`，不是另一个构建产物。证据：[`src/server-main.js` 第 212–242 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/server-main.js#L212-L242)。

## 官方页面实际加载了什么

锁定提交的 `public/index.html` 明确加载以下样式：

| 类别 | 文件 | 判断 |
|---|---|---|
| 字体 | `webfonts/NotoSans/stylesheet.css`、`webfonts/NotoSansMono/stylesheet.css` | 基础环境 |
| 图标 | `css/fontawesome.min.css`、`css/solid.min.css`、`css/brands.min.css` | 基础环境 |
| 第三方组件 | `jquery-ui.min.css`、`bright.min.css`、`cropper.min.css`、`toastr.min.css`、`select2.min.css` | 完整静态环境 |
| ST 核心 | `style.css`、`st-tailwind.css` | 基础公共环境 |
| ST 功能区 | `rm-groups.css`、`group-avatars.css`、`toggle-dependent.css`、`world-info.css`、`extensions-panel.css`、`select2-overrides.css`、`mobile-styles.css`、`macros.css` | 完整静态环境 |
| 用户覆盖 | `user.css` | 用户安装级覆盖，不是人物卡固定依赖 |

证据：[`public/index.html` 第 20–46 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/index.html#L20-L46)。

`style.css` 自身还 `@import` 了动画、弹窗、提示词管理、加载器、文件控件、标签、欢迎页等 16 份样式，所以“加载 `style.css`”实际远不止加载一个基础 reset。证据：[`public/style.css` 第 1–18 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/style.css#L1-L18)。

### Font Awesome 的准确来源

锁定提交内置的是 **Font Awesome Free 6.5.2**，不是从 CDN 动态加载：

- `fontawesome.min.css` 提供公共类和图标映射；
- `solid.min.css` 声明 `Font Awesome 6 Free` 900 字重，并引用 `../webfonts/fa-solid-900.woff2`；
- `brands.min.css` 声明品牌图标，并引用 `fa-brands-400.woff2`；
- 首页没有加载 `regular.min.css`，因此不能把 regular 图标视为官方默认环境。

证据：[`fontawesome.min.css`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/css/fontawesome.min.css)、[`solid.min.css`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/css/solid.min.css)、[`brands.min.css`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/css/brands.min.css)、[`public/webfonts`](https://github.com/SillyTavern/SillyTavern/tree/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/webfonts)。

dsh-tavern 当前注入 `@fortawesome/fontawesome-free@6.7.2/css/all.min.css`，可以解决已观察到的空图标，但它是“近似兼容”，不是对锁定 ST 版本的字节级复现。后续兼容包应记录目标 ST 版本，避免无意混用图标版本。

## 主题和全局变量

`style.css` 在 `:root` 定义了三层常用变量：

- 基础色：`--black*`、`--white*`、`--grey*`、`--fullred`、`--golden` 等；
- SmartTheme：`--SmartThemeBodyColor`、`--SmartThemeEmColor`、`--SmartThemeUnderlineColor`、`--SmartThemeQuoteColor`、`--SmartThemeBlurTintColor`、`--SmartThemeChatTintColor`、`--SmartThemeUserMesBlurTintColor`、`--SmartThemeBotMesBlurTintColor`、`--SmartThemeShadowColor`、`--SmartThemeBorderColor`；
- 尺寸与字体：`--fontScale`、`--mainFontSize`、`--mainFontFamily`、`--monoFontFamily`、`--blurStrength`、`--shadowWidth`、`--doc-height` 等。

证据：[`public/style.css` 第 20–104 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/style.css#L20-L104)。

这些并非只有默认值。运行时主题设置会把颜色、字体缩放、模糊和阴影重新写到 `document.documentElement.style`，Custom CSS 也会作为 `<style id="custom-style">` 注入页面。证据：[`public/scripts/power-user.js` 第 1104–1179 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/power-user.js#L1104-L1179)；官方文档也说明主题会保存颜色、字体比例、模糊、阴影和 Custom CSS：[UI Customization](https://docs.sillytavern.app/usage/core-concepts/uicustomization/)。

因此兼容层至少要提供这些变量的默认值。若追求主题一致，还要把宿主当前主题值投影进 iframe；仅复制静态默认值只能保证“不坏”，不能保证“和 ST 当前主题一样”。

## 扩展样式如何进入全局环境

官方扩展不是自动继承一套私有组件样式。每个扩展在 `manifest.json` 中声明可选的 `css` 文件；ST 激活扩展时，创建 `<link rel="stylesheet">` 并追加到主文档 `head`。这意味着扩展 CSS 也是全局 CSS，并且加载顺序属于扩展生命周期的一部分。

证据：

- [`getManifests` 与扩展激活，第 532–637 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions.js#L532-L637)
- [`addExtensionStyle`，第 775–804 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/extensions.js#L775-L804)
- [官方 UI Extensions 文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)：`css` 是 manifest 的可选样式入口，扩展运行在浏览器上下文并可操作 ST DOM。

由此可得：如果 dsh-tavern 运行一个 Tavern Helper/MVU 兼容脚本，它所依赖的扩展 CSS 应随对应扩展能力一起装载，而不是把所有已知扩展 CSS 永久塞入每个 iframe。

## 人物卡实际上能依赖什么

这里必须区分“浏览器里确实可见”和“官方保证稳定”。

### 浏览器事实

传统 ST 把消息 HTML 放进 `.mes_text`，所以正文在同一文档里能够看到首页加载的所有样式、当前主题变量、Custom CSS 和扩展 CSS。ST 的正文样式还为表格、列表、引用、代码、图片等提供默认布局。证据：[`public/style.css` 的消息正文规则](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/style.css#L371-L611)。

消息中的 `<style>` 也不是原样无边界执行：ST 会编码、清洗并给选择器增加 `.mes_text` 前缀和 `custom-` 类名前缀。证据：[`public/scripts/chats.js` 第 530–595 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/chats.js#L530-L595) 和 [`messageFormatting` 第 1898–1909 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/script.js#L1898-L1909)。

### 契约事实

官方把人物卡定义为塑造 LLM 行为的提示词集合，而把 UI、DOM 操作和脚本能力放在扩展体系中。官方没有承诺“人物卡可稳定依赖任意 ST 内部 CSS 类”。证据：[SillyTavern 官方首页的 Character Cards 定义](https://docs.sillytavern.app/) 和 [UI Extensions 文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)。

所以，社区富 UI 人物卡对 `.fa-*`、SmartTheme 变量、ST 工具类乃至插件全局样式的使用，本质上是对宿主实现的隐式 ABI。为了最大兼容，dsh-tavern 可以模拟它；但工程上必须把它标记为“兼容行为”，不能误称为人物卡标准。

## 必须区分：ST 原生消息环境与 Tavern Helper iframe

上面的“完整 ST 页面 CSS”适用于直接渲染在 `.mes_text` 中的 HTML。复杂 MVU 卡通常还会经过 Tavern Helper（JS-Slash-Runner）创建第二层消息 iframe；该 iframe **同样不会继承 ST 主页面 CSS**，而是由 Tavern Helper 自己建立一套更小的运行环境。

锁定 Tavern Helper commit [`4dd4b873f191accb5dd933089ddf36b846458585`](https://github.com/N0VI028/JS-Slash-Runner/tree/4dd4b873f191accb5dd933089ddf36b846458585)。其消息 iframe 模板明确注入：

1. Font Awesome `all.min.css`；
2. Tailwind 浏览器运行时；
3. jQuery；
4. jQuery UI；
5. jQuery UI Theme CSS；
6. jQuery UI Touch Punch；
7. Vue Runtime；
8. Vue Router。

证据：[`third_party_message.html`](https://github.com/N0VI028/JS-Slash-Runner/blob/4dd4b873f191accb5dd933089ddf36b846458585/src/iframe/third_party_message.html)；[`createSrcContent`](https://github.com/N0VI028/JS-Slash-Runner/blob/4dd4b873f191accb5dd933089ddf36b846458585/src/panel/render/iframe.ts#L81-L103) 还加入 box sizing、零边距、隐藏溢出、用户/角色头像映射、视口与高度适配脚本。

Tavern Helper 的 `predefine.js` 另外把父页面的 Lodash、YAML、Showdown、Toastr、Zod、Tavern Helper API 和 SillyTavern context 暴露到 iframe。因此，最大兼容不只是 CSS 工作，还包括全局 JavaScript 与宿主 DOM/API ABI。证据：[`predefine.js`](https://github.com/N0VI028/JS-Slash-Runner/blob/4dd4b873f191accb5dd933089ddf36b846458585/src/iframe/predefine.js)。

由此应形成两个兼容配置，而不是互相覆盖：

| 配置 | 面向对象 | 应恢复的环境 |
|---|---|---|
| ST 消息兼容层 | 直接写入消息正文、依赖 `.mes_text` 的正则 HTML | ST 首页静态 CSS、主题变量、容器语义、用户与扩展动态样式 |
| Tavern Helper iframe 兼容层 | 酒馆助手创建的状态栏和交互界面 | 精确复刻 `third_party_message.html`、`predefine.js` 的依赖与高度适配契约 |

不能把 ST 的完整 `style.css` 直接当作 Tavern Helper iframe 的官方环境：上游 Tavern Helper 并没有这样做。若为兼容某些越界依赖而额外加载，应标记为 dsh-tavern 的超集行为，并验证不会压过人物卡自带样式。

### 《灯火阑珊》的实际依赖

对锁定 Apeiria commit [`4b8f897b7fa07d1eb851018e98893a86f42be6b6`](https://github.com/Alice233-Alice/Apeiria/tree/4b8f897b7fa07d1eb851018e98893a86f42be6b6) 的 `灯火阑珊-状态栏` source map 扫描显示：

- 状态栏视觉 CSS 和主题变量基本自包含，`--bg-primary`、`--text-primary`、`--accent-color` 等由组件自己的 `themeStyles` 写入，不依赖 ST SmartTheme；
- 大量图标使用 `fa-solid fa-*`，因此 Font Awesome 是当前缺失按钮的直接原因；
- 通知调用依赖 `toastr` 全局对象；
- 行动发送会查找父页面 `#send_textarea`、`#send_but`，这属于宿主 DOM ABI；
- Vue/Pinia 及卡片自身 CSS 由其前端包提供。

因此对这张卡，当前最直接的必需项是 Font Awesome、Toastr facade、Tavern Helper API/变量环境与 ST 输入框/发送动作的等价适配。加载完整 ST 主页面 CSS不是它当前 UI 正常显示的必要条件，但仍是其他“直接消息 HTML 卡”的兼容需求。

## 给 dsh-tavern 的分级清单

### P0：必须兼容（基础公共环境）

1. **Font Awesome 默认集合**
   - core + solid + brands；
   - 对应 WOFF2 字体；
   - 资源 URL 重写与本地缓存；
   - compatibility pack 记录上游 ST commit 和 FA 版本。
2. **ST 核心主题变量**
   - 上述 SmartTheme 变量；
   - 基础黑白灰/状态色变量；
   - `--fontScale`、`--mainFontSize`、`--mainFontFamily`、`--monoFontFamily`、`--blurStrength`、`--shadowWidth`、`--doc-height`。
3. **字体环境**
   - Noto Sans、Noto Sans Mono；
   - 字体失败时保留系统 fallback。
4. **官方 `style.css` 及其递归 imports**
   - 最大兼容模式应先原样加载锁定版本，而不是先抽取一个自认为足够的消息样式子集；
   - 缓存代理必须递归改写 `@import`、字体、图片等相对 URL；
   - 最后追加很薄的 iframe adapter，只修正 `body` 高度、背景和滚动等容器差异。
5. **`st-tailwind.css` 工具类**
   - 文件只有约 7 KB，包含 ST 自己维护的常用布局、间距、颜色和显示工具类；
   - 应按锁定版本整体打包，避免零散猜测类名。
6. **兼容容器语义**
   - iframe 内提供 `.mes`、`.mes_block`、`.mes_text` 等最小包装结构或等价作用域，使人物卡 CSS 的常见选择器能命中；
   - 不应伪造完整 ST 页面 DOM。

### P1：完整静态环境（纯兼容模式建议直接加载）

按 `public/index.html` 第 20–46 行的原始顺序，加载 P0 之外的全部静态样式：

- jQuery UI、highlight.js `bright`、Cropper、Toastr、Select2；
- `rm-groups.css`、`group-avatars.css`、`toggle-dependent.css`、`world-info.css`、`extensions-panel.css`、`select2-overrides.css`、`mobile-styles.css`、`macros.css`。

这些样式中很多只有配合对应 DOM/JavaScript 才有意义，但“纯兼容模式”的目标是先复现 ST，而不是提前判断卡片不会用到。可在将来有覆盖率证据后再裁剪。

### P2：用户与扩展动态环境

1. **动态主题同步**：将当前主题的根节点变量写进 iframe，并在主题变化时更新。
2. **`user.css`**：属于安装实例级 CSS；若目标是复刻某个 ST 实例，应同步它。
3. **主题 Custom CSS**：同步运行时 `<style id="custom-style">`。
4. **扩展 manifest CSS**：按启用顺序加载当前扩展声明的 CSS；相对字体、图片 URL 走缓存代理。
5. **扩展动态样式**：兼容扩展运行时新增的 `<style>` 和 `<link>`，而不只读取 manifest。
6. **body/html 状态**：同步会影响 CSS 的 class、data attribute、语言和方向属性。

这里的 `user.css` 不是仓库里一份固定主题：服务端中间件会优先把 `data/_css/user.css` 映射到 `/css/user.css`。证据：[`src/middleware/userCss.js` 第 4–16 行](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/src/middleware/userCss.js#L4-L16)。

### 不应混入 compatibility pack

1. **DSH 父页面 CSS**：它不是 ST CSS，复制后只会制造新的偶然依赖。
2. **与锁定 ST 版本不一致的静默升级**：例如把 6.5.2 无记录地替换成 6.7.2；可以使用超集版本，但必须在 manifest 中明确。
3. **没有来源和顺序的零散补丁**：容易出现同名选择器优先级漂移。
4. **把所有扩展 CSS 固化为静态基线**：扩展样式应跟随扩展启用状态和加载顺序。
5. **把某个用户的 `user.css` 当成官方默认值**：它只能属于实例复刻层。

## 推荐落地形态

建议把兼容环境做成一个明确版本的组合包，而不是继续“缺什么补什么”：
```text
st-compat-css/<st-commit>/
├── tokens.css          # ST 默认变量与 DSH 主题映射入口
├── fonts.css           # Noto Sans / Mono
├── fontawesome.css     # core + solid + brands
├── upstream/           # 按 index.html 顺序保存官方静态 CSS
├── iframe-adapter.css  # 只修正 iframe 容器差异
├── dynamic.json        # 主题、用户和扩展动态层清单
└── assets/             # woff2 等本地缓存资源
```

iframe 生成顺序建议固定为：

```text
按 index.html 顺序的官方静态 CSS
→ 当前根节点主题变量
→ iframe adapter（只修正容器差异）
→ 按原始插入顺序重放 user/custom/扩展动态 style
→ 人物卡自身 CSS
```

这样既能复现 ST 的常见隐式环境，也能让人物卡自己的样式保持最高优先级。每次升级上游 ST 时，通过新目录/版本清单更新，而不是静默替换现有卡片的运行环境。

对 Tavern Helper iframe 则使用另一条固定顺序：

```text
Tavern Helper third_party_message 依赖
→ predefine 全局/API facade
→ iframe 视口和高度适配
→ 人物卡 HTML、CSS 与脚本
```

两条流水线可以共享静态资源缓存，但不应共享一份不分来源的 CSS 大杂烩。

## 对当前问题的直接回答

当前空按钮只是最先暴露出的 Font Awesome 缺失。若坚持当前“纯兼容、不要过早优化”的方向，下一步应补齐：

1. SmartTheme 与基础颜色变量；
2. Noto 字体；
3. `style.css` 及递归 imports；
4. `st-tailwind.css` 和 `index.html` 其余静态 CSS；
5. 扩展自身声明及运行时注入的 CSS。

这五项构成完整兼容环境的主干。以后若性能、冲突或体积真的成为问题，再用真实人物卡覆盖率把完整环境裁剪为最小包；当前不应提前优化。
