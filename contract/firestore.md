# Firestore 文档形状（评估为主）

> **已定（2026-10-18），后端已按此写入**（乙拍板，用真 Gemini 在本地模拟器上跑通）。下面是前端**实际按它解析**的形状：以 `seed/data/` 里的种子为准，三份完整示例在 `examples/`（取自演示地块）。后端比示例多写的字段：评估文档的 `coopId`、`steps[]`、`progress`；`ruleResults[].docType`（见下）；文件文档的 `documentId`。
> 字段名是 camelCase（`schema.sql` 的 snake_case 转换而来，规则见企划书 §8.9）；时间在 Firestore 里是 Timestamp，示例里写成 ISO 字符串。

## `plots/{plotId}/assessments/{assessmentId}`

每次点「开始评估」生成一条，保留历史；**只有后端写**，前端只读（实时订阅）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `plotId` | string | 评估哪块地（等于路径里的 `{plotId}`） |
| `runStatus` | string | `queued` → `running` → `done` 或 `failed`（`status.md`）。**一创建就写 `queued`**，屏 7 才读得到 |
| `result` | string \| null | `done` 时必填：`green`／`yellow`／`red`／`needs_review`（`status.md`），同步写到 `plots.status` |
| `createdAt` | Timestamp | **必须写**：前端按它取「最新一次评估」（缺则退回 `startedAt`、`finishedAt`） |
| `startedAt`／`finishedAt` | Timestamp \| null | 开始与结束时间；屏 9 的「Disemak pada …」用 `finishedAt` |
| `forestRisk` | string \| null | `low`／`medium`／`high`；其余值（含 `unknown`、缺失）前端按「未能检查」处理，**不会**当成没有损失 |
| `forestCover2020Pct`／`forestLossAfter2020Ha` | number \| null | 森林初筛数值；`null` 前端不当 0 |
| `ruleResults` | array | 规则逐条结果，见下 |
| `gaps` | array | 缺口清单，见下 |
| `summaryText`／`summaryLang` | string | 一句话总结与语言。**前端不显示** |
| `modelVersion`／`rulesVersion`／`inputSnapshot`／`forestDataset`／`errorMessage` | — | 审计字段。**前端不显示** |
| `isSynthetic` | boolean | 模拟数据一律 `true` |

### `ruleResults[]`

| 字段 | 说明 |
| --- | --- |
| `ruleCode` | `CC-01` 面积、`CC-02` 有效期、`CC-03` 姓名（`schema.sql` 的 `^CC-[0-9]{2}$`）。同一评估里每个编号只有一条 |
| `result` | `pass`／`warn`／`fail`／`needs_review` |
| `expectedValue`／`actualValue` | **给人看的字符串，但前端会严格解析其中的数字**，格式见下 |
| `paramsUsed`／`evidence`／`detail` | 阈值、证据（`documentId`＋`fieldKey`）、说明。**前端不显示** `detail` |

**前端会解析的数值格式**（认不出就退回不带数字的句子，不会显示 NaN）：

- `CC-01`：`expectedValue` 是地契面积、`actualValue` 是地图量出的面积，写成 `"3.0400 ha"`（也认没有单位的 `"3.04"`）。
- `CC-02`：`actualValue` 写剩余天数 `"58 hari"`（也认 `"58 天"`、`"58 days"`），**已过期时写以 `YYYY-MM-DD` 开头的字符串**，如 `"2026-04-30 telah tamat"`（日期前缀被解析，后面的文字随意）。
- **`CC-02` 每份文件一条（已定，与 `schema.sql` 的 `UNIQUE (assessment_id, rule_code, COALESCE(doc_type, ''))` 一致）**：行里带 `docType`（`mpob_licence`／`mspo_cert`／`land_title` 的租约），缺执照时那一行 `docType` 也是 `mpob_licence`。前端按缺口的 `docType` 找对应那一行取天数／日期；同一规则编号有多行时，「通过」要每一行都通过，规则的总结果取最重的一行。种子里的评估只有一条 `CC-02`（没有 `docType`），前端仍照老办法读。

### `gaps[]`

| 字段 | 说明 |
| --- | --- |
| `gapCode` | 前端认得的：`area_mismatch`、`expiring`、`expired`、`name_mismatch`、`not_in_mspo`、`low_confidence`、`missing_doc`。**别的值前端走通用文案**（「Perkara perlu disemak」），不会崩 |
| `severity` | `high`／`medium`／`low`，前端按这个顺序排（别的值排最后） |
| `docType` | `land_title`／`mpob_licence`／`mspo_cert`／`mspo_member_list`／`null`；用来写「哪份文件」 |
| `status` | `open` 才算没解决；**没写 `status` 也按没解决**（看不出已解决） |
| `description`／`suggestedAction`／`citation` | 后端写的说明文字。**前端不显示**：它们可能含第三人姓名或「已故父亲」这类推断，也可能是任意语言；前端按 `gapCode` 自己生成标题、说明、建议 |

> 同一评估里 `gapCode` 重复时，前端用 `gapCode~docType`（再重复加 `~序号`）当屏 10 的路由参数。

## 已定的几条（2026-10-18）

1. **评估文档自带 `coopId`**（冗余自 `plots.coopId`）——**已做**。看板用 collection group 一次读全部评估，现在靠文档路径 `plots/{id}/assessments/{aid}` 认地块；`firestore.rules` 收紧时，collection group 要单独写规则，评估带 `coopId` 才能写成「只能读本合作社的」。
2. **逐步进度字段（可选）**：屏 7 的四步（读文件／核对／森林／行动清单）现在**只能推导**（文件还有没读完的 → 第 1 步；评估 `running` 且文件读完 → 第 2 步；第 3、4 步在结束前保持未开始）。**后端已写** `progress: { read, check, forest, actions }`（各为 `pending`／`running`／`done`／`failed`），另有 `steps[]`（每步一条日志：`step`、`status`、`at`、`ms`、`detail`，给演示视频的「智能体日志」画面用，前端不读）。前端可以改读 `progress`，不改也行。
3. **谁创建 `users/{uid}`、`lastLoginAt` 谁写**：后端，`POST /api/me`（见 `api.md`），前端登录后调用。没有档案的账号屏 2 显示「Profil anda belum dibuat.」。
4. **示例**：`examples/` 有三份评估（绿／黄／红）；`documents`、`plots` 的示例照 `seed/data/` 的同名文件。

## `plots/{plotId}/documents/{docId}`

用户拍下来的原件照片；一份证件可有多页（多条记录）。**后端写**（登记、读取结果），前端只读（实时订阅）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `plotId` | string | 属于哪块地（等于路径里的 `{plotId}`） |
| `docType` | string | `land_title`／`mpob_licence`／`mspo_cert`／`mspo_member_list`（`status.md`） |
| `pageNo` | number | 第几页（地契正面、背面各一条） |
| `isCurrent` | boolean | 重拍后旧照片改成 `false`、不删除。前端**只数 `isCurrent !== false` 的** |
| `extractionStatus` | string | `uploaded` → `extracting` → `extracted`，或 `failed`／`needs_review`（`status.md`）。屏 7 靠它判断「还有没有文件没读完」（`uploaded`／`extracting` 算没读完，其余都算读完） |
| `storagePath`／`mimeType`／`sha256`／`source`／`uploadedBy`／`capturedAt`／`extractedAt`／`modelVersion` | — | 审计与存储字段。**前端不显示** |
| `fields` | map | 读出的逐项字段，见下 |
| `isSynthetic` | boolean | 模拟数据一律 `true` |

### `fields`（key 是 `<docType>.<字段名>`，如 `land_title.area_value`、`mpob_licence.valid_until`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rawText` | string | 纸面上的原文（身份证号读出后先打码） |
| `normalizedValue` | string | 规范化后的值（面积 `"3.0400"`、日期 `"2026-12-05"`） |
| `confidence` | number | 0–1，Gemini 给的置信度；**低于 0.70**（`rule_params` 的 `EXTRACT.confidence_min`）要请用户确认 |
| `confirmedValue`／`confirmedBy`／`confirmedAt` | string／string／Timestamp | 用户在屏 8 确认或改过的值，**优先于 `normalizedValue`**；没确认过就没有这三个字段 |

屏 8（确认字段，待做）的读法：只列 `confidence < 0.70` 且还没有 `confirmedValue` 的字段；显示值取 `confirmedValue ?? normalizedValue`；读得准的字段不打扰用户。

**已定：原图裁剪怎么显示。** Storage 规则不对前端开放读，后端给一个 15 分钟有效的签名读取网址（`GET /api/documents/{id}/image`，见 `api.md`）。裁剪的坐标（字段在图上的位置）本轮不写（`box` 不存在），前端先显示整张图。
