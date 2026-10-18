# 仿真证件照（16 张）

地契、MPOB 执照、MSPO 证书的**自制样本照片**，给演示视频、屏 3／4（拍文件）、屏 8（确认字段）和 Gemini 读取用。

- **全部是虚构的**：姓名、身份证号、地契号、执照号、证书号都取自 `seed/src/demo.mjs`（虚构的演示地块）。每张都有斜铺的「CONTOH · SIMULATED」水印、页脚「Dokumen simulasi…」和「CONTOH SIMULASI」章。
- **不仿真官方徽章和条形码**：版式（防伪底纹、双线边框、测绘图、圆章、日期章、手写批注、签名、全息贴）是按这几类文件的常见版面画的示意，**不是**真实证件的样子。
- **桌上拍照的效果**：木纹桌面、纸张折痕、污渍、透视、阴影、灯光不均、暗角、噪点；有的歪、有的模糊、有的偏暗。1400×1900，JPEG，每张 170–340 KB。
- **已用线上同款的 Gemini 抽取实测**：16 张共 40 个字段全部读对（`python scripts/gemini_smoke.py`）。

## 演示三块地怎么选图

| 场景 | 地契 | 执照 | MSPO 证书 | 预期结果 |
| --- | --- | --- | --- | --- |
| **绿**：TAN AH KOW，GRN 51234、Lot 1052、4.20 公顷 | `green-3-title-single-page`（或 `green-1` + `green-2` 两页） | `green-4-licence`（31/03/2027） | `mspo-cert-clear` | 画一块约 4.2 公顷的地 → 全部通过，绿色 |
| **黄**：AHMAD ZAKI BIN ROSLI，HSM 2217/91、Lot 2217、3.04 公顷 | `yellow-3-title-single-page`（或 `yellow-1` + `yellow-2`） | `yellow-4-licence`（05/12/2026，不到 90 天） | `mspo-cert-clear` | 执照快到期 → 黄色；画大一点（约 3.5 公顷）还会多一条「面积不符」 |
| **红**：MUTHU A/L RAMAN，GRN 30977、Lot 88、2.00 公顷，地契在已故父亲 RAMAN A/L SUBRAMANIAM 名下 | `red-3-title-single-page`（或 `red-1` + `red-2`） | `red-4-licence-expired`（30/04/2026，已过期） | 不传 | 姓名不符、执照已过期 → 红色 |

每个场景里，地契「单页」版（持有人、面积都在同一页）最省事；「两页」版用来演示一份文件可以拍多张。

额外的几张：

| 文件 | 用来演示 |
| --- | --- |
| `green-extra-title-handwritten` | 地契上有手写批注「± 4.2 ha (ukur semula 2026)」，纸略歪、略糊：印刷字和手写字混在一起 |
| `yellow-extra-licence-blurry` | 同一张黄色执照，模糊、歪、偏暗：「重拍」提示、低置信度字段让外勤确认 |
| `mspo-cert-extra-dark-tilted` | MSPO 证书，偏暗、歪 3.4°、有斜向阴影带：光线差也能读 |

## 重新生成

模板是一份网页（`kit/template.html`）：把一张纸用 HTML／SVG／CSS 画出来，再「放到桌上拍」；数据和每张的拍照参数在 `kit/render-kit.mjs`（`SAMPLES`）。用 puppeteer-core 和 Chrome 渲染：

```bash
PUPPETEER_DIR=<装了 puppeteer-core 的目录> node seed/photos/kit/render-kit.mjs            # 全部
PUPPETEER_DIR=<…> node seed/photos/kit/render-kit.mjs red-4 mspo                        # 名字含这些片段的
```

字体（Libre Baskerville、Special Elite、Caveat）从 Google Fonts 加载，渲染时要联网；没有网会退回系统字体，样子会差一点。要加一张就在 `SAMPLES` 里加一项。

## 没做的

- 真实证件我们没见过，版式是示意；请合作社遮住个人信息后给几张核实。
- 照片是文件，不会自动进 `documents`：演示时在屏 3 用「从相册选」上传。
