# 字体库

舞台皮肤用 id 选这里的字体（`font.body` / `name` / `ui`，字面的 `fallback`）。目录格式与接口见 `docs/design/cast-presentation.md`「字体库（舞台 core 36/N 的前置）」。

| id | 字体 | 许可证 | 来源 |
| --- | --- | --- | --- |
| `neo-xihei-screen` | 霞鹜新晰黑 屏幕版 | IPA Font License 1.0 | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/tag/26.08.21 |
| `neo-zhisong-screen` | 霞鹜新致宋 屏幕版 | IPA Font License 1.0 | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/tag/26.08.21 |
| `resource-han-rounded` | Resource Han Rounded CN | SIL OFL 1.1 | https://github.com/CyanoHao/Resource-Han-Rounded/releases/tag/v0.990 |
| `noto-sans-sc` | Noto Sans SC | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/notosanssc |
| `noto-serif-sc` | Noto Serif SC | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/notoserifsc |

- 每个文件夹里的 `LICENSE.txt` 是该字体的许可证全文。这些字体按各自的许可证分发，不属于本仓库的 AGPL-3.0。
- 转换：只把原发布文件重新封装为 WOFF2，保留全部 Unicode 映射、字形、度量和名称表（不做子集）。Noto 可变字体按 wght 400 / 500 / 700 取静态实例；Resource Han Rounded 用稳定版的静态 Regular / Medium / Bold；霞鹜两款是原发布的单一字重。`index.json` 记有每个文件和源文件的 SHA-256。
- 只收开源许可证允许再分发的字体，不收商业字体或改过字形的字体。
