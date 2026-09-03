# 产品介绍页：本地预览

入口为 `docs/index.html`，纯静态 HTML / CSS / JavaScript，无构建依赖。网页功能文案根据 [功能清单](feature-inventory.md) 编写，截图复用仓库已有演示图，并在常见问题中说明版本差异。

在项目根目录启动：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs
```

访问 <http://127.0.0.1:4173/>。本地预览期间修改文件后刷新即可。

后续确认发布时，可将 GitHub Pages 来源设为 `main` 分支的 `/docs` 目录。现阶段未修改仓库 Pages 设置、未推送或发布。社交分享图片地址按计划中的 `https://flizzywine.github.io/dsh-tavern/` 填写，发布前不会在该公网地址可用。

页面所有功能正文都在 HTML 中，关闭 JavaScript 仍可阅读；脚本仅负责从链接自动展开功能目录。资源采用相对路径，兼容项目子目录。

验证：`node --test tests/product-site.test.mjs` 检查静态资源、锚点、无脚本内容、退休功能文案和目录展开行为。该检查不替代浏览器视觉验收。
