# MVU 加载恢复

官方 MVU Core 的下载与执行分离。下载失败不再立刻终止本轮结算；保持运行时未就绪，由现有 pendingSubmission 队列保存提交。

- 每轮最多下载三次：初次失败后，间隔 1 秒、2 秒自动重试；每次下载（含响应体）限时 10 秒。
- 三次均失败后暂停，显示“重新加载 MVU”。手动重试继续同一沙箱中的下载，不重建沙箱、不提前运行配套脚本，也不并发启动多次。
- 下载成功后，使用现有页面模块加载器执行已下载的内容一次，保留文档基准 URL；等待 MVU 就绪后才运行配套脚本。
- 执行开始后，不再自动或手动重跑初始化。执行异常或初始化超时仍为终止性错误，提示刷新或重启。这个恢复入口不保证基础依赖、配套脚本或执行阶段的网络错误可恢复。
- 下载等待期间由下载器管理超时；执行阶段恢复初始化超时检测。切换会话、释放执行租约或离开页面后，旧沙箱与迟到消息不能操作新会话。
- 运行时就绪后，已有结算队列接续保存的提交，沿用 branch/revision 检查，不重新生成正文或调用模型。正常的 MVU 初始化可能补写 schema，这不等于重复应用结算。

验证入口：`tests/mvu-load-recovery.test.mjs`、`tests/card-runtime-lifecycle.test.mjs`、`tests/helper-module-loading.test.mjs`、现有结算恢复测试。真实浏览器夹具为 `tests/fixtures/mvu-initialization-browser-smoke.mjs`，参数 `mode=manual|auto|unsafe`，加 `sandbox=1` 验证隔离模式。
