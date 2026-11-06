# 字体库

舞台皮肤用 id 选这里的字体（`font.body` / `name` / `ui`，字面的 `fallback`）。目录格式与接口见 `Wiki「设计：cast-presentation」`「字体库（舞台 core 36/N 的前置）」。

| id | 字体 | 许可证 | 来源 |
| --- | --- | --- | --- |
| `neo-xihei-screen` | 霞鹜新晰黑 屏幕阅读版（LXGW Neo XiHei Screen） | IPA Font License 1.0 | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/tag/26.08.21 |
| `neo-zhisong-screen` | 霞鹜新致宋 屏幕阅读版（LXGW Neo ZhiSong Screen） | IPA Font License 1.0 | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/tag/26.08.21 |
| `resource-han-rounded` | Resource Han Rounded CN | SIL OFL 1.1 | https://github.com/CyanoHao/Resource-Han-Rounded/releases/tag/v0.990 |
| `noto-sans-sc` | Noto Sans SC | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/notosanssc |
| `noto-serif-sc` | Noto Serif SC | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/notoserifsc |

- 每个文件夹里的 `LICENSE.txt` 是该字体的许可证全文。这些字体按各自的许可证分发，不属于本仓库的 AGPL-3.0。
- IPA 两款直接分发上述版本的官方 TTF 原件，逐字节不修改，不转换 WOFF2、不取子集、不改名称表；内部家族名分别是 `LXGW Neo XiHei Screen`、`LXGW Neo ZhiSong Screen`。`index.json` 的 `family` 是网页注册时用的 CSS 家族别名，不改文件内的家族名。按 IPA Font License 1.0 第 3 条第 2 款分发原许可程序，附完整许可证，不在本项目另制派生字体。
- 官方发布提供的是独立 TTF 文件，不是字体压缩包；下载边界记录如下（SHA-256 只对下载的发布文件计算一次）：

  | 官方下载 URL | 字节数 | SHA-256 |
  | --- | ---: | --- |
  | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/download/26.08.21/LXGWNeoXiHeiScreen.ttf | 7,666,968 | `6f69412d8307c055b7f247e67669b0e4ab4b79bf199fe58ee93545429b586092` |
  | https://github.com/lxgw/LxgwNeoXiZhi-Screen/releases/download/26.08.21/LXGWNeoZhiSongScreen.ttf | 11,922,650 | `4e071b63ee221e72309ec720259f264024336991d1ee0bce42e80d1fb3855a1c` |

- OFL 三款保持 WOFF2：保留全部 Unicode 映射、字形、度量和名称表（不做子集）。Noto 可变字体按 wght 400 / 500 / 700 取静态实例；Resource Han Rounded 用稳定版的静态 Regular / Medium / Bold。`index.json` 保留这些文件已有的来源和摘要。
- 共 11 个字体文件（2 个原始 TTF、9 个 OFL WOFF2），64,785,178 字节（61.8 MiB，不含 manifest 与许可证）。只收开源许可证允许再分发的字体，不收商业字体或改过字形的字体。
