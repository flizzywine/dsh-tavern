# 用户自创工具与 Skill 的持久保存

用户扩展与程序安装目录分开。默认根目录为 `~/.dsh/profile-data/tavern/data/`；设置了 `DSH_HOME` 时跟随该目录。卡片工作台会向 Agent 提供实际绝对路径。

| 内容 | 用户目录内的位置 |
| --- | --- |
| 工具、插件源码及依赖 | `tools/` |
| 工具加载清单 | `tools.cordis.yml` |
| Skill 与配套文件 | `skills/<名称>/` |

## 创建持久工具

1. 在 `tools/<名称>/` 中保存 Cordis 插件源码，推荐使用 `.mjs`。需要第三方依赖时在该目录单独管理依赖，不依赖 Tavern 程序目录的 `node_modules`。
2. 读取已有 `tools.cordis.yml`，保留其他配置，追加条目，例如：

```yaml
- id: user-example
  name: ./tools/example/index.mjs
  config: {}
```

3. 校验模块和 YAML。重启 DSH 后，Tavern preset 通过原生 Cordis include 重新加载清单；在新卡片工作台中检查工具并实际调用验证。仅写入文件不代表已经加载成功。

插件的导出、工具注册接口以当前安装的 DSH 为准。相对模块路径从清单所在目录解析。清单中的条目会随 Tavern preset 加载，插件作者应按需处理作用域及资源释放。

## 更新边界

- 初始化只在清单不存在时创建空清单；安装、升级及启动不会重写已有清单、工具代码或用户 Skill。
- 即使清单格式错误也保留原文，由原生加载器报错，不用空配置覆盖它。
- 程序安装目录里的内置文件仍随版本更新；自创内容应保存在上述用户目录。
- 已有工具若仍在程序目录，需要在确认源码和依赖后迁入用户目录并更新清单；系统不会猜测哪些程序文件属于用户，也不会自动搬动未知代码。
- `cordis_define` / `cordis_run` 注册的临时插件只存在于当前进程，不会自动转成持久插件。源码未保存的历史临时工具无法靠这项改动恢复。

## 验证

普通回归：`node --test tests/user-extensions.test.mjs`。

真实加载器验证：指定已安装 DSH 的 `dsh-app-boot/lib/index.js`，执行：

```sh
DSH_BOOT_MODULE=/absolute/path/to/dsh-app-boot/lib/index.js node --expose-internals --test tests/user-extensions-native.test.mjs
```

该测试使用临时目录和真实 DSH 工具注册表，验证调用、切换程序目录后冷启动以及损坏清单保留，不请求模型、不操作运行中的用户会话。
