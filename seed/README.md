# seed：模拟数据（前端）

200 个虚构地块和关联数据，摆成 Firestore 的形状，供前端屏 2–11 在后端就绪前使用。**所有文档带 `isSynthetic: true`**，姓名、身份证号、地契号、执照号、证书号全部虚构；界面和演示视频要标注「模拟数据」。

- 3 个演示地块（绿 / 黄 / 红）原样取自 `contract/schema.sql` 末尾，占 200 个里的前 3 个；其余 197 个由脚本生成。
- 状态比例：green 110 · yellow 50 · red 24 · needs_review 16（企划书 §8.10 的演示比例，**不是统计数据**）。没有 `pending` 地块。
- 每个地块的状态不是随机贴的：先定场景（面积多出、执照临期、地契在已故父亲名下……），再由规则引擎（CC-01/02/03 + 读出置信度）算出 `ruleResults`、`gaps` 和状态，对不上就报错。
- 固定基准日 **2026-10-09**，种子固定，重复运行逐字节相同。演示日在基准日前后 10 天内，各地块状态不变。
- 照片本身**不在 `seed/data/` 里生成**：`storagePath` 只是约定路径（`seed/<plotId>/…jpg`）。仿真证件照在 `seed/photos/`（9 张：清晰、手写、模糊、偏暗歪斜、已过期、已故父亲名下，带「SIMULATED / CONTOH」水印；用 `npm run photos` 重画），说明与对应的种子文档见 `photos/README.md`；它们还没有上传到 Storage、也没有接进 `documents`（上传接口合同待定）。

## 用法

需要 Node 20 以上，无需 `npm install`（零依赖）。

```bash
cd seed
npm run generate    # 生成 seed/data/*.json（先自检，不通过就不写）
npm run validate    # 独立校验：枚举、面积、多边形、引用、规则重算、身份证泄漏……
npm test            # 纯计算的单元测试
npm run all         # generate + validate
```

灌入本机模拟器（项目 `demo-kebunsah`；只允许回环地址，没设环境变量就什么都不做）：

```bash
cd web && npm run emulators          # 终端 1：Auth(9099) + Firestore(8080)，为什么这样启动见 web/README.md
cd seed                              # 终端 2：
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run load
# PowerShell：$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; npm run load
```

两个变量各管一步，**设了哪个就做哪一步**：`FIRESTORE_EMULATOR_HOST` 灌 Firestore（整篇覆盖同 ID 文档，重跑不产生重复）；`FIREBASE_AUTH_EMULATOR_HOST` 在 Auth 模拟器里建 `users` 里那 5 个账号（uid = `users` 文档 id，手机号 = `phone`），所以用测试号登录后 uid 能对上 `users/{uid}`。账号已存在就跳过，重跑不报错。两个变量都没设就什么都不做；任一主机不是回环地址就整体拒绝。模拟器一重启数据和账号都会清空，要重新灌入。

## 输出文件（`seed/data/`，已入库）

生成物直接提交进仓库，队友克隆后不用跑 Node 就能读到（前端也可以直接 import 这些 JSON 做界面）。改了 `src/` 之后要重新 `npm run generate` 并把变化一起提交；`seed/data/.gitattributes` 强制 JSON 用 LF 换行，所以 Windows 上 `autocrlf` 不会让校验器误报。

每个文件是数组，元素 `{ "path": "plots/<id>/documents/<docId>", "data": { … } }`；`_manifest.json` 记种子、基准日和各集合数量。

| 文件 | Firestore 路径 | 数量 |
| --- | --- | --- |
| `persons` | `persons/{id}` | 200 |
| `cooperatives` | `cooperatives/{id}` | 1 |
| `users` | `users/{uid}` | 5（2 个演示账号 + 3 个园主账号） |
| `titles` | `titles/{id}`，持有人在 `proprietors[]` | 200 |
| `mpobLicences` | `mpobLicences/{id}` | 195（5 个地块缺执照） |
| `mspoCertificates` | `mspoCertificates/{id}` | 4（1 个演示 + 3 个新增） |
| `mspoMembers` | `mspoCertificates/{cid}/members/{id}` | 181 |
| `plots` | `plots/{id}` | 200 |
| `documents` | `plots/{pid}/documents/{id}`，读出的字段在 `fields{}` | 约 990 |
| `assessments` | `plots/{pid}/assessments/{id}`，`ruleResults[]`、`gaps[]` | 200 |
| `config` | `config/ruleParams` | 1 |

字段名是 `schema.sql` 列名的 camelCase（`area_ha_computed` → `areaHaComputed`），枚举值原样取自 `schema.sql` / `contract/status.md`。`plots` 上按企划书 §8.9 复制了 `state`、`district`、`titleNo`。

## 需要和队友在合同里对齐的缺口

`contract/` 里还没有任何 Firestore 文档示例，下面这些是 seed 的**临时约定**，字段名和类型集中在 `src/shape.mjs`，合同定下后只改一处。建议开一个 `contract/…` PR 把它们写下来。

1. **字段名大小写**：本次 camelCase。
2. **`polygonGeojson` 存成 JSON 字符串**：Firestore 不允许数组直接嵌套数组，GeoJSON 的 `coordinates` 原样写不进去。**已实测**（2026-10-09，Firestore 模拟器 v1.22.0）：写入数组套数组返回 HTTP 400 `Nested arrays are not allowed`。`centroidLat`／`centroidLng` 是两个数字，不是 GeoPoint。
3. **`fields{}` 的键含点**（`land_title.lot_no`，沿用企划书 §8.5）：整篇写入时带点的键可以存、可以原样读回；但后端若用字段路径做局部更新（AI 写 raw/normalized/confidence，API 写 confirmed*），**已实测**（同上）未转义的路径 `fields.mpob_licence.valid_until.confidence` 不会更新这个带点的键，而是在 `fields` 下新建一个嵌套的同级键 `mpob_licence`，两种形状并存。需要转义路径或改键名（反引号转义的写法没测完）。`proprietor_N_*` 的 N 是否保留也要定。
4. **日期与时间戳**：日期列（`validUntil`、`leaseExpiry`、`expiryDate`…）存 `YYYY-MM-DD` 字符串；时间戳列在 JSON 里是 ISO 字符串，灌入时转成 Firestore Timestamp。`areaHa` 由写入方物化，公式必须和后端一致（ha；sqm÷10000；acre×0.40468564224；sqft×0.09290304÷10000；4 位小数）。
5. **子集合引用**：`plots` 增加了 `mspoCertificateId` 副本（成员在子集合里，只有成员 id 无法定位）；`sourceDocumentId` 改存 `sourceDocumentPath`（完整路径）；子文档保留 `plotId`／`certificateId`。
6. **`ruleResults[]`／`gaps[]` 元素结构**：本次是 SQL 列去掉 id 和 assessment_id。`gapCode` 取值表没定义：演示里有 `area_mismatch`／`expiring`／`expired`／`name_mismatch`／`not_in_mspo`，本次新增 `missing_doc`／`low_confidence`。`paramsUsed` 的键（`tol_pct`…）与 `rule_params` 的 `param_key`（`area_tolerance_pct`…）不一致。`evidence` 本次是 `[{documentId, fieldKey}]`。
7. **`config/ruleParams` 内部结构**：本次 `{ "CC-01": { area_tolerance_pct: {value, unit, basis, note}, … }, … }`。
8. **看板（屏 11）需要的 lotNo、成员姓名、主要问题**：`plots` 上只复制了 state／district／titleNo，其余要么前端 join，要么走 `/api/coop/dashboard`（响应还没定）。
9. **屏 7 分步进度、屏 8 原图裁剪框**在 schema 里没有对应字段。
10. **`users/{uid}` 的 uid** 必须等于 Firebase Auth 里的 uid。**已验证可行**（2026-10-09，Auth 模拟器）：`npm run load` 用 `accounts:batchCreate` 预建账号并指定 uid（如 `demo-officer-1`），之后用对应手机号走手机号登录，得到的 uid 就是它；没预建的号码得到随机 uid，读不到 `users/{uid}`。线上 Firebase Auth 不能这样预设，要么首次登录由后端按 uid 建 `users` 档，要么用 Admin SDK 预建账号。**首次登录谁建 `users` 档、`lastLoginAt` 谁写，合同还没有答案**，前端本次不创建（首页显示「Profil anda belum dibuat.」）。
11. **姓名相似度算法**没定义。seed 用归一化编辑距离，并在 (0.60, 0.90) 之间不造样本，后端换算法也不容易翻转。
12. **CC-02 边界**：schema 注释写「不足 90 天」，企划书 §8.6 写「90 天内」。seed 按 `< 90` 才警告，且不造 89／90／91 天的样本。

## 已知取舍

- 没有 `pending`、`queued`／`running`／`failed` 的样本：屏 2 的「Belum mula」和屏 7 要靠现场新建地块来演示。
- 生成地块的 `summaryText`／缺口文案用马来语；3 个演示地块的 `detail`／`description`／`suggestedAction` 和数值字符串（`58 hari`、`2026-04-30 telah tamat`）原是 `schema.sql` 里的中文，2026-10-11 起也换成马来语（数值与结论不变，格式与生成的地块一致）。虚构机构名后缀由「(虚构)」改成「(rekaan)」。数据里已没有中文。前端只解析天数、日期、公顷这几个数，不显示这些说明文字。
- 演示 3 块的多边形与它声明的 `areaHaComputed` 相差最多约 0.03 公顷（原值与球面实算有约 0.7% 的差），原样保留；生成地块的误差都在 0.01 公顷内。
- 坐标是把虚构地块撒在各县县城附近，卫星图上可能是森林、水域或市区；森林初筛的数值（`forestCover2020Pct` 等）是演示占位，`forestDataset` 为空。mukim／kampung 名称是示意，没有逐一核对。
- 身份证号只存 SHA-256 哈希（沿用 `schema.sql` 的做法）。上线前必须加服务端秘密值（pepper）；seed 全是虚构数据，不受影响。
- 身份证号出生日期合法性等性质在生成函数的单元测试里验证（输出里没有明文，无法在输出上验）。

## 目录

```
generate.mjs  validate.mjs  load-emulator.mjs   命令行入口
src/          rng · dates · units · geo · people · similarity · rules · scenarios · demo · entities · documents · build · shape · constants
test/         node --test
data/         生成物（已入库；改了 src/ 要重新生成）
photos/       仿真证件照（见 photos/README.md）
db/           本地 PostgreSQL（把 contract/schema.sql 建成真的数据库，见 db/README.md）
```
