# 阿芙拉 · 最小 DSH 人物卡示例

一张几十 KB 的完整 DSH 人物卡，照着它做你自己的卡。制作说明见 [DSH 人物卡制作指南](https://github.com/flizzywine/dsh-tavern/wiki/DSH-%E4%BA%BA%E7%89%A9%E5%8D%A1%E5%88%B6%E4%BD%9C)。

- 人物卡文字来自仓库里的原创示例卡 [阿芙拉](../avra/cards/avra-complete.json)。
- `assets/`：卡面头像和一张立绘（导入后成为「角色素材」里 neutral 情绪的立绘）。
- `plugin/`：卡内插件。宿主侧每轮在后台结算里顺带判断这一幕的氛围并按轮保存，本局设置里有一个开关；浏览器侧用 `registerStatusSection` 在「酒馆状态」里加一节「本幕氛围」，底色跟着氛围变。
- `build.mjs`：打包。

```sh
node examples/dshcard-hello/build.mjs
```

生成 `examples/dshcard-hello/阿芙拉.dshcard`（不进仓库）。在 DSH Tavern 测试版的人物卡库导入、刷新页面，用阿芙拉开一局。
