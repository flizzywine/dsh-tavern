# 客户端源码

`main.js` 保留宿主入口、RPC、会话视图协调和插件装配。其余代码按职责组织：

- `features/`：侧栏、人物卡库、世界书库、预设库、游玩操作和设置等完整功能。
- `runtime/`：Helper、脚本执行、会话生命周期、宿主挂载和消息 iframe 生命周期。
- `ui/`：错误中心和消息展示。
- `modules/` 及本目录其他文件：已有的独立工厂、共享算法和浏览器兼容实现。
  `modules/conversation-settings.js` 独立管理本局设置，显式接收 RPC、视图通知与共享设置面板。

`node bin/build-tavern-client.mjs` 从 `main.js` 递归展开 `@include`，生成
`tavern-plugin/lib/client.js`。include 路径始终相对于本目录；
`@include-domain` 则相对于 `lib/domain`。不要直接修改生成产物。

这些源码片段仍处于宿主的同一个 factory 作用域，不能当作 ES 模块单独导入。
入口中的无缩进 include 保留迁移代码的原有缩进，使此次拆分的构建产物逐字节不变。
不要随意移动初始化语句、重复 include，或改变工厂内的注册顺序。
新增功能优先使用接收明确依赖的工厂；现有工厂的依赖整理与源码迁移分别验证。

修改后运行构建、`node bin/build-tavern-client.mjs --check` 和相关测试。
需要执行客户端函数的测试读取构建产物，避免依赖函数位于哪个源码片段。
