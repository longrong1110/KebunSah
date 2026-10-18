# 仿真证件照（10 张）

地契、MPOB 执照、MSPO 证书的**自制样本照片**，给屏 3／4（拍文件）、屏 8（确认字段）、AI 读取（Gemini）和演示视频用。

- **全部是虚构的**：姓名、身份证号、地契号、执照号、证书号都取自 `seed/data/`（虚构），每张都有对角的「SIMULATED / CONTOH」水印、「Dokumen simulasi…」页脚和「CONTOH SIMULASI」章。
- **不仿真官方印章、徽章、条形码**，版式是按 `contract/schema.sql` 的字段和企划书 §8 里的「表格样本」画的示意，**不是**真实证件的样子（企划书也写了：真实证件我们没见过，要请合作社遮住个人信息后给几张核实）。
- 字段值与种子里这几块演示地块的 `documents.fields` 一致，读出的结果可以直接对照。
- 照片是「放在桌上拍的」：有桌面、阴影、光线不均、暗角、噪点，有的歪、有的模糊、有的偏暗。1200×1650，JPEG，每张 250–430 KB。

| 文件 | 内容 | 对应的种子文档 | 用来测什么 |
| --- | --- | --- | --- |
| `title-1-clear.jpg` | 地契第 1 页，HSM 2217/91、Lot 2217、**3.04 Hektar** | 黄色地块 `land_title` 第 1 页（`seed/p2/title-1.jpg`） | 清晰样本：地契号、Lot、面积、权属、用途 |
| `title-2-proprietor.jpg` | 地契第 2 页，持有人 AHMAD ZAKI BIN ROSLI、K/P 800512-08-5231 | 黄色地块 `land_title` 第 2 页（`seed/p2/title-2.jpg`） | 持有人与姓名匹配（CC-03）、身份证号读出后打码 |
| `title-3-handwritten-area.jpg` | 地契第 1 页，GRN 51234、Lot 1052、4.20 Hektar，旁边有**手写批注**「± 4.2 ha (ukur semula 2026)」，纸略歪 | 绿色地块 `land_title` 第 1 页 | 手写字与印刷字混在一起时的读取；低置信度提示 |
| `title-4-deceased-father.jpg` | 地契第 2 页，持有人 RAMAN A/L SUBRAMANIAM（已故父亲，tanah pusaka） | 红色地块 `land_title` 第 2 页 | 姓名不符（`name_mismatch`）的场景 |
| `licence-1-clear.jpg` | MPOB 小园主执照，810200000022，**05/12/2026** | 黄色地块 `mpob_licence` | 清晰样本：执照号、有效期（58 天后到期） |
| `licence-2-blurry.jpg` | 同一张执照，**模糊、歪、偏暗、噪点多** | 黄色地块 `mpob_licence`（`valid_until` 置信度 0.64，由外勤确认） | 低置信度 → 屏 8「确认字段」、「重拍」提示 |
| `licence-3-expired.jpg` | MPOB 执照，810200000033，**30/04/2026**（已过期） | 红色地块 `mpob_licence` | 已过期（`expired`）的场景 |
| `mspo-cert-1-clear.jpg` | MSPO 团体证书，MSPO 900001，到期 28/02/2029 | MSPO 证书 `e0000000-…-000000000001` | 清晰样本：证书号、持有团体、到期日 |
| `mspo-cert-2-dark-tilted.jpg` | 同一张证书，**偏暗、歪 3.6°、有斜向阴影带** | 同上 | 光线差、有阴影时的读取 |
| `title-5-single-page.jpg` | 地契**单页**：HSM 2217/91、Lot 2217、**3.04 Hektar**、持有人 AHMAD ZAKI BIN ROSLI 都在同一页（由 `scripts/make_test_title.py` 生成，不是 `render.mjs` 画的） | 黄色地块（与 title-1／title-2 合起来的内容一致） | 屏 3 每种文件只能放一张照片；上面的地契分两页，单传任何一页评估都会因缺面积或缺持有人变成「需人工复核」，测试主线用这一张 |

## 重新生成

```bash
node seed/photos/render.mjs      # 起本机小服务（端口 4310）
```

然后用 Chrome／Edge 打开 <http://127.0.0.1:4310/>：页面（`generate.html`）用 canvas 画出 9 张图，逐张 POST 回服务存成 `seed/photos/*.jpg`，全部存完服务自动退出。字体用系统字体（`Times New Roman`／`Courier New`／`Ink Free`），所以换一台机器画出来的字形会略有差别；随机数有固定的 seed，同一台机器上重画结果相同。

样本清单、每张图的拍照效果（歪斜角度、模糊程度、亮度、噪点）都在 `render.mjs` 的 `SAMPLES` 里；要加一张就加一项。

## 没做的

- 企划书 10/14 的待办还写着「其中 1–2 块地的坐标落在真实有森林变化的区域」：这要用 Earth Engine／Global Forest Watch 查真实的森林变化数据来选坐标，前端这边没有办法验证，留给队友的 Earth Engine 联调（TODO「Earth Engine 先让 1 块地查通」）。
- 照片还**没有上传到 Storage**，也**没有接进 `documents`**：上传要走后端的签名网址（`contract/api.md` 的 `POST /api/plots/{id}/documents` 还是「待定」）。现在它们只是文件，可以在屏 3／4 用「从相册选」测，或给后端联调用。
