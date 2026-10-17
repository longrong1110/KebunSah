# 后端计划 1／3：工程骨架与 `core/`（规则、定级、几何）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建好 Python 工程骨架，并把不依赖任何云服务的 `core/` 做完：确定性规则 CC-01/02/03、定级与缺口、面积换算、椭球面积与质心、姓名相似度、身份证打码，且用种子里 200 个地块的预期评估做黄金测试。

**Architecture:** `core/kebunsah_core/` 是纯 Python 包，API（计划 2）和评估流水线（计划 3）共用。规则逻辑照 `seed/src/rules.mjs` 移植，输出的期望值／实际值字符串与种子逐字相同（前端会严格解析其中的数字）；与种子不同的两点是 CC-02 每份文件一条，以及缺文件时不抛错而是产出 `missing_doc` 缺口。

**Tech Stack:** Python 3.11、pytest、rapidfuzz（姓名）、shapely（多边形校验与质心）、pyproj（WGS84 椭球面积）。

> 这是三份计划的第一份。计划 2（API：鉴权、六个接口、`Store`／`Blobs` 适配器、模拟器集成测试）和计划 3（流水线：Gemini 抽取、森林初筛、解释、Dockerfile 与部署）依赖本计划产出的真实接口，等本计划合并后再写，避免按猜的接口写。依据：[docs/superpowers/specs/2026-10-13-backend-design.md](../specs/2026-10-13-backend-design.md)。

## Global Constraints

- Python **3.11**（Windows 上用 `py -3.11`；Cloud Run 镜像将用 `python:3.11-slim`）。
- `core/` **不得 import 任何云服务**（firebase、google-cloud、google-genai、earthengine）。
- 规则阈值默认值取自 `contract/schema.sql` 的 `rule_params`：面积容差 10% 与 0.1 公顷取较大者、超出 50% 不通过、有效期 90 天内警告、姓名相似度 ≥ 0.85、读出置信度 < 0.7 要确认、只记一个点须 < 4 公顷。
- 面积 **4 位小数**（公顷），坐标 **6 位小数**，多边形只有一个外环、WGS84、`[经度, 纬度]`、环首尾闭合。
- 状态值只用 `contract/status.md` 的字符串：`pending` / `green` / `yellow` / `red` / `needs_review`；规则结果 `pass` / `warn` / `fail` / `needs_review`；缺口轻重 `high` / `medium` / `low`。
- Firestore 文档字段名 **camelCase**（`RuleResult.to_doc()`、`Gap.to_doc()` 输出这个形状）。
- 分支前缀：后端 `be/…`，合同 `contract/…`，基础设施 `infra/…`；一个分支一件事；不直接推 `main`，走 PR，Squash merge。改 `contract/` 或 `infra/` 要对方（`@longrong1110`）Approve，所以它们各自单独一个分支。
- 提交信息用中文约定式（`feat(core): …`），末尾加 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- 本地没装 `gh`：开 PR 用浏览器。

## File Structure

```
requirements.txt             运行时依赖（rapidfuzz、shapely、pyproj）
requirements-dev.txt         + pytest
pyproject.toml               只放 pytest 配置（pythonpath、testpaths）
core/kebunsah_core/
  __init__.py                RULES_VERSION
  units.py                   面积换算；JS 风格取整与格式化（js_round、to_ha、to_ten_thousandths、fmt_fixed、fmt_num）
  dates.py                   ISO 日期整数天（day_number、diff_days）
  names.py                   姓名归一化与相似度
  masking.py                 身份证打码与哈希
  params.py                  Params 阈值与 params_from_config
  geo.py                     parse_polygon、check_point、GeometryError、PolygonInfo
  rules.py                   RuleResult；cc01、cc02、cc02_missing_licence、cc03、is_unconfirmed_low、to_needs_review
  grading.py                 Gap；aggregate、derive_gaps、summarize
  evaluate.py                PlotFacts、Evaluation、evaluate_plot（流水线和黄金测试的入口）
core/tests/
  test_package.py
  test_units_dates_names.py
  test_masking_params.py
  test_geo.py
  test_rules.py
  test_grading_evaluate.py
  test_golden_seed.py        对 seed/data 的 200 个地块做黄金对照
```

分支与 PR 安排：任务 1–7 在分支 `be/core`；任务 8 在分支 `infra/pr-check-pytest`；任务 9 在分支 `contract/rule-results-doc-type`。每个分支都从最新的 `main` 拉出。

---

### Task 1: 工程骨架

**Files:**
- Create: `requirements.txt`、`requirements-dev.txt`、`pyproject.toml`
- Create: `core/kebunsah_core/__init__.py`
- Create: `core/tests/test_package.py`
- Modify: `.gitignore`、`.github/CODEOWNERS`、`README.md`（目录表加一行）、`api/README.md`、`ai-worker/README.md`

**Interfaces:**
- Produces: 可导入的包 `kebunsah_core`（`pythonpath = ["core"]`），常量 `kebunsah_core.RULES_VERSION == "rules-0.2"`；所有后续任务用 `python -m pytest` 跑测试。

- [ ] **Step 1: 建分支和虚拟环境**

```bash
git switch main && git pull
git switch -c be/core
py -3.11 -m venv .venv
```

激活（PowerShell：`.venv\Scripts\Activate.ps1`；Git Bash：`source .venv/Scripts/activate`）。之后所有 `python`、`pytest` 命令都在已激活的终端里跑。

- [ ] **Step 2: 写依赖文件和 pytest 配置**

`requirements.txt`：

```
rapidfuzz>=3.9,<4
shapely>=2.0,<3
pyproj>=3.6,<4
```

`requirements-dev.txt`：

```
-r requirements.txt
pytest>=8,<10
```

`pyproject.toml`：

```toml
# 只放工具配置。依赖在 requirements*.txt；代码按目录分开（core/ api/ ai-worker/），不打包成一个发行包。
[tool.pytest.ini_options]
pythonpath = ["core"]
testpaths = ["core/tests"]
```

```bash
python -m pip install -r requirements-dev.txt
```

Expected: 安装成功（rapidfuzz、shapely、pyproj、pytest）。

- [ ] **Step 3: 写失败的测试**

`core/tests/test_package.py`：

```python
import kebunsah_core


def test_rules_version_is_declared():
    assert kebunsah_core.RULES_VERSION == "rules-0.2"
```

- [ ] **Step 4: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_package.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core'`

- [ ] **Step 5: 写最小实现**

`core/kebunsah_core/__init__.py`：

```python
"""KebunSah 共用核心：规则、定级、单位与日期、姓名相似度、几何。不 import 任何云服务。"""

RULES_VERSION = "rules-0.2"
```

- [ ] **Step 6: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_package.py -v`
Expected: PASS（1 passed）

- [ ] **Step 7: 补文档和忽略规则**

`.gitignore`：把

```
# 编辑器与系统
```

替换成

```
# Python
.venv/
__pycache__/
*.pyc
.pytest_cache/

# 编辑器与系统
```

`.github/CODEOWNERS`：在 `/ai-worker/  @TianXian-123` 这行后面加一行

```
/core/       @TianXian-123
```

`README.md`（根目录，目录表）：在 `` | `ai-worker/` | Gemini 抽取、规则引擎、Earth Engine → Cloud Run `kebunsah-ai` | 后端 | `` 这行后面加一行

```
| `core/` | 共用核心：规则、定级、几何、姓名相似度（纯 Python，不依赖云服务，API 与评估流水线共用） | 后端 |
```

`api/README.md` 整个替换为：

```markdown
# api：Python FastAPI（后端）

部署到 Cloud Run 服务 `kebunsah-api`（asia-southeast1）。接口清单见 `contract/api.md`。

本地起步：仓库根目录 `py -3.11 -m venv .venv`，激活后 `python -m pip install -r requirements-dev.txt`，`python -m pytest` 跑测试。
共用的规则与几何在 `core/`；整体设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`。
```

`ai-worker/README.md` 整个替换为：

```markdown
# ai-worker：评估流水线（后端）

Gemini 抽取、规则引擎（在 `core/`）、Earth Engine 森林初筛、缺口清单与红黄绿定级。
`assessments`、`rule_results`、`gaps` 和 `plots.status` 只由这里写。目前与 `api/` 合在一个 Cloud Run 服务里跑（进程内异步），
将来要拆成 `kebunsah-ai` 只改 Dockerfile 和 `infra/cloudbuild/deploy.yaml`，接口不变。设计见 `docs/superpowers/specs/2026-10-13-backend-design.md`。
```

- [ ] **Step 8: 提交**

```bash
git add requirements.txt requirements-dev.txt pyproject.toml core/ .gitignore .github/CODEOWNERS README.md api/README.md ai-worker/README.md
git commit -m "feat(core): Python 工程骨架（pytest、依赖、core 包），README 去掉过时的 dotnet 说明" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 单位、日期、姓名

**Files:**
- Create: `core/kebunsah_core/units.py`、`core/kebunsah_core/dates.py`、`core/kebunsah_core/names.py`
- Test: `core/tests/test_units_dates_names.py`

**Interfaces:**
- Produces:
  - `units.js_round(x: float, digits: int) -> float`
  - `units.to_ha(value: float, unit: str) -> float`（`unit` ∈ `ha|sqm|acre|sqft`，否则 `ValueError`）
  - `units.to_ten_thousandths(ha: float) -> int`
  - `units.fmt_fixed(x: float, digits: int) -> str`（等同 JS `toFixed`）
  - `units.fmt_num(x: float) -> str`（`50.0 → "50"`）
  - `dates.day_number(iso: str) -> int`、`dates.diff_days(frm: str, to: str) -> int`
  - `names.normalize_name(s: str) -> str`、`names.similarity(a: str, b: str) -> float`

- [ ] **Step 1: 写失败的测试**

`core/tests/test_units_dates_names.py`：

```python
import pytest

from kebunsah_core.dates import diff_days
from kebunsah_core.names import normalize_name, similarity
from kebunsah_core.units import fmt_fixed, fmt_num, to_ha, to_ten_thousandths


def test_to_ha_converts_every_unit():
    assert to_ha(4.2, "ha") == 4.2
    assert to_ha(40000, "sqm") == 4.0
    assert to_ha(10, "acre") == 4.0469
    assert to_ha(1000, "sqft") == 0.0093


def test_to_ha_rejects_unknown_unit():
    with pytest.raises(ValueError):
        to_ha(1, "ruai")


def test_to_ten_thousandths_is_an_integer():
    assert to_ten_thousandths(3.04) == 30400
    assert to_ten_thousandths(4.23) == 42300


def test_fmt_fixed_rounds_half_away_from_zero_like_javascript():
    assert fmt_fixed(0.125, 2) == "0.13"  # Python 的 format 会给 0.12
    assert fmt_fixed(2.5, 0) == "3"
    assert fmt_fixed(3.04, 4) == "3.0400"
    assert fmt_fixed(14.8148, 1) == "14.8"


def test_fmt_num_drops_trailing_zero():
    assert fmt_num(50.0) == "50"
    assert fmt_num(0.5) == "0.5"


def test_diff_days_counts_calendar_days():
    assert diff_days("2026-10-09", "2026-12-05") == 57
    assert diff_days("2026-10-09", "2026-10-09") == 0
    assert diff_days("2026-10-09", "2026-04-30") == -162
    assert diff_days("2028-02-28", "2028-03-01") == 2  # 闰年


def test_normalize_name_uppercases_and_collapses_spaces():
    assert normalize_name("  tan   ah kow ") == "TAN AH KOW"


def test_similarity_is_edit_distance_over_longer_length():
    assert similarity("TAN AH KOW", "tan ah  kow") == 1.0
    assert similarity("AHMAD ZAKI BIN ROSLI", "AHMAD ZAKI B ROSLI") == pytest.approx(0.9)
    assert similarity("TAN AH KOW", "TAN AH KAU") == pytest.approx(0.8)  # 低于 0.85，会被判不通过
    assert similarity("", "") == 1.0
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_units_dates_names.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core.dates'`

- [ ] **Step 3: 写实现**

`core/kebunsah_core/units.py`：

```python
"""面积换算与取整。公式与 contract/schema.sql 的 land_titles.area_ha 生成列、seed/src/units.mjs 一致。

取整故意模仿 JavaScript（Math.round、toFixed），这样和种子生成的评估字符串逐字相同
（前端会严格解析其中的数字）。
"""
from __future__ import annotations

import math
import sys
from decimal import ROUND_HALF_UP, Decimal

ACRE_HA = 0.40468564224
SQFT_HA = 0.09290304 / 10000


def js_round(x: float, digits: int) -> float:
    """seed 的 round()：(x + EPSILON*sign) * 10^d 后按 Math.round（半数向正无穷）取整。"""
    f = 10**digits
    sign = (x > 0) - (x < 0)
    return math.floor((x + sys.float_info.epsilon * sign) * f + 0.5) / f


def to_ha(value: float, unit: str) -> float:
    if unit == "ha":
        return js_round(value, 4)
    if unit == "sqm":
        return js_round(value / 10000, 4)
    if unit == "acre":
        return js_round(value * ACRE_HA, 4)
    if unit == "sqft":
        return js_round(value * SQFT_HA, 4)
    raise ValueError(f"未知面积单位：{unit}")


def to_ten_thousandths(ha: float) -> int:
    """规则比较一律用"万分之一公顷"的整数，避免浮点误差让边界样本翻转。"""
    return math.floor(ha * 10000 + 0.5)


def fmt_fixed(x: float, digits: int) -> str:
    """等同 JavaScript 的 x.toFixed(digits)（半数远离 0），Python 的 format 是半数取偶，会差 1。"""
    quantum = Decimal(1).scaleb(-digits)
    return str(Decimal(x).quantize(quantum, rounding=ROUND_HALF_UP))


def fmt_num(x: float) -> str:
    """50.0 → "50"，0.5 → "0.5"，和 JavaScript 把 number 放进模板字符串一致。"""
    return str(int(x)) if float(x).is_integer() else str(x)
```

`core/kebunsah_core/dates.py`：

```python
"""日期计算：全部按 ISO 日期字符串（YYYY-MM-DD）的整数天算，不读系统时钟、不受时区影响。"""
from __future__ import annotations

from datetime import date


def day_number(iso: str) -> int:
    return date.fromisoformat(iso).toordinal()


def diff_days(frm: str, to: str) -> int:
    """frm → to 相隔几天（to 在后为正）。"""
    return day_number(to) - day_number(frm)
```

`core/kebunsah_core/names.py`：

```python
"""姓名相似度：归一化后的编辑距离比，范围 0–1。算法与 seed/src/similarity.mjs 相同（1 - 编辑距离 / 较长长度）。"""
from __future__ import annotations

from rapidfuzz.distance import Levenshtein


def normalize_name(s: str) -> str:
    return " ".join(s.upper().split())


def similarity(a: str, b: str) -> float:
    x, y = normalize_name(a), normalize_name(b)
    if max(len(x), len(y)) == 0:
        return 1.0
    return Levenshtein.normalized_similarity(x, y)
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_units_dates_names.py -v`
Expected: PASS（8 passed）

- [ ] **Step 5: 提交**

```bash
git add core/kebunsah_core/units.py core/kebunsah_core/dates.py core/kebunsah_core/names.py core/tests/test_units_dates_names.py
git commit -m "feat(core): 面积换算、JS 风格取整、整数天日期差、姓名相似度" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 身份证打码与阈值

**Files:**
- Create: `core/kebunsah_core/masking.py`、`core/kebunsah_core/params.py`
- Test: `core/tests/test_masking_params.py`

**Interfaces:**
- Produces:
  - `masking.mask_ic(last4: str) -> str`（`"******-**-5117"`）
  - `masking.last4_of(ic: str) -> str`
  - `masking.hash_ic(ic: str, pepper: str = "") -> str`（SHA-256 十六进制；`pepper` 为空时与种子里的哈希相同）
  - `masking.mask_ic_in_text(text: str) -> str`
  - `params.Params`（冻结 dataclass，字段：`area_tolerance_pct`、`area_tolerance_min_ha`、`area_fail_over_pct`、`expiry_warn_days`、`name_similarity_min`、`confidence_min`、`point_max_ha`、`smallholder_max_ha`）
  - `params.DEFAULT_PARAMS: Params`
  - `params.params_from_config(doc: Mapping | None) -> Params`

- [ ] **Step 1: 写失败的测试**

`core/tests/test_masking_params.py`：

```python
from kebunsah_core.masking import hash_ic, last4_of, mask_ic, mask_ic_in_text
from kebunsah_core.params import DEFAULT_PARAMS, params_from_config


def test_hash_ic_without_pepper_matches_the_seed():
    # seed 里 TAN AH KOW（虚构）的 ic_hash
    assert hash_ic("720304075117") == "264097fe0da9af30e5b9c2b1e3a71df3ac16ba8ea651a179eb0438742a4475cd"


def test_hash_ic_ignores_dashes_and_changes_with_pepper():
    assert hash_ic("720304-07-5117") == hash_ic("720304075117")
    assert hash_ic("720304075117", pepper="s3cret") != hash_ic("720304075117")


def test_last4_and_mask():
    assert last4_of("720304-07-5117") == "5117"
    assert mask_ic("5117") == "******-**-5117"


def test_mask_ic_in_text_masks_full_numbers_only():
    assert mask_ic_in_text("IC 720304-07-5117 dan 800512085231.") == "IC ******-**-5117 dan ******-**-5231."
    assert mask_ic_in_text("Lot 2217, 3.04 Hektar, MSPO 570158") == "Lot 2217, 3.04 Hektar, MSPO 570158"
    assert mask_ic_in_text("licence 810268659837") == "licence ******-**-9837"  # 12 位数字一律当身份证号打码


def test_default_params_match_schema_rule_params():
    p = DEFAULT_PARAMS
    assert (p.area_tolerance_pct, p.area_tolerance_min_ha, p.area_fail_over_pct) == (10, 0.1, 50)
    assert (p.expiry_warn_days, p.name_similarity_min, p.confidence_min) == (90, 0.85, 0.7)
    assert (p.point_max_ha, p.smallholder_max_ha) == (4, 40.46)


def test_params_from_config_reads_values_and_falls_back():
    doc = {"CC-01": {"area_tolerance_pct": {"value": 12, "unit": "%", "basis": "team", "note": "x"}},
           "CC-02": {"expiry_warn_days": {"value": 60}}, "bogus": 1}
    p = params_from_config(doc)
    assert p.area_tolerance_pct == 12 and p.expiry_warn_days == 60
    assert p.name_similarity_min == 0.85  # 没给的用默认值
    assert params_from_config(None) == DEFAULT_PARAMS
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_masking_params.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core.masking'`

- [ ] **Step 3: 写实现**

`core/kebunsah_core/masking.py`：

```python
"""身份证号：打码与哈希。完整号码不入库，只存哈希和末四位。"""
from __future__ import annotations

import hashlib
import re

_IC_IN_TEXT = re.compile(r"(?<!\d)(\d{6})-?(\d{2})-?(\d{4})(?!\d)")


def mask_ic(last4: str) -> str:
    return f"******-**-{last4}"


def last4_of(ic: str) -> str:
    return re.sub(r"\D", "", ic)[-4:]


def hash_ic(ic: str, pepper: str = "") -> str:
    """SHA-256(pepper + 纯数字)。pepper 为空时与 seed 里的哈希相同；上线前必须配服务端秘密值。"""
    digits = re.sub(r"\D", "", ic)
    return hashlib.sha256((pepper + digits).encode("ascii")).hexdigest()


def mask_ic_in_text(text: str) -> str:
    """把文本里出现的完整 12 位身份证号（带不带短横线都行）换成 ******-**-1234。"""
    return _IC_IN_TEXT.sub(lambda m: mask_ic(m.group(3)), text)
```

`core/kebunsah_core/params.py`：

```python
"""规则阈值。默认值取自 contract/schema.sql 的 rule_params；线上从 config/ruleParams 文档读。"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Mapping


@dataclass(frozen=True)
class Params:
    area_tolerance_pct: float = 10
    area_tolerance_min_ha: float = 0.1
    area_fail_over_pct: float = 50
    expiry_warn_days: float = 90
    name_similarity_min: float = 0.85
    confidence_min: float = 0.7
    point_max_ha: float = 4
    smallholder_max_ha: float = 40.46


DEFAULT_PARAMS = Params()

# (规则编号, 参数名) → Params 字段名
_KEYS = {
    ("CC-01", "area_tolerance_pct"): "area_tolerance_pct",
    ("CC-01", "area_tolerance_min_ha"): "area_tolerance_min_ha",
    ("CC-01", "area_fail_over_pct"): "area_fail_over_pct",
    ("CC-02", "expiry_warn_days"): "expiry_warn_days",
    ("CC-03", "name_similarity_min"): "name_similarity_min",
    ("EXTRACT", "confidence_min"): "confidence_min",
    ("PLOT", "point_max_ha"): "point_max_ha",
    ("PLOT", "smallholder_max_ha"): "smallholder_max_ha",
}


def params_from_config(doc: Mapping[str, Any] | None) -> Params:
    """config/ruleParams 文档 → Params。文档形如 {"CC-01": {"area_tolerance_pct": {"value": 10, ...}}, ...}。
    缺的键用默认值，不认识的键忽略。"""
    if not doc:
        return DEFAULT_PARAMS
    updates: dict[str, Any] = {}
    for (rule_code, key), field_name in _KEYS.items():
        entry = (doc.get(rule_code) or {}).get(key)
        if isinstance(entry, Mapping) and isinstance(entry.get("value"), (int, float)):
            updates[field_name] = entry["value"]
    return replace(DEFAULT_PARAMS, **updates)
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_masking_params.py -v`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add core/kebunsah_core/masking.py core/kebunsah_core/params.py core/tests/test_masking_params.py
git commit -m "feat(core): 身份证打码与哈希、规则阈值（含从 config/ruleParams 读取）" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 几何（椭球面积、质心、校验）

**Files:**
- Create: `core/kebunsah_core/geo.py`
- Test: `core/tests/test_geo.py`

**Interfaces:**
- Consumes: `params.Params`、`params.DEFAULT_PARAMS`（`point_max_ha`）。
- Produces:
  - `geo.GeometryError(code: str, message: str)`，属性 `.code`，取值 `"geometry_invalid"` 或 `"point_area_too_large"`（接口层映射成 422）
  - `geo.PolygonInfo(ring: list[list[float]], area_ha: float, centroid_lat: float, centroid_lng: float)`（冻结 dataclass）
  - `geo.parse_polygon(geojson) -> PolygonInfo`
  - `geo.check_point(lat, lng, area_ha_declared, params=DEFAULT_PARAMS) -> tuple[float, float, float]`（返回规范化的 `(lat, lng, 手填面积)`）
  - `geo.MIN_AREA_HA = 0.005`

- [ ] **Step 1: 写失败的测试**

`core/tests/test_geo.py`：

```python
import json
from pathlib import Path

import pytest

from kebunsah_core.geo import GeometryError, check_point, parse_polygon

SQUARE = {"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895],
                                                [101.149037, 4.310895], [101.149037, 4.309105]]]}
SEED_PLOTS = Path(__file__).resolve().parents[2] / "seed" / "data" / "plots.json"


def test_parse_polygon_returns_area_and_centroid():
    info = parse_polygon(SQUARE)
    assert info.area_ha == pytest.approx(4.23, abs=0.02)
    assert (info.centroid_lat, info.centroid_lng) == (4.31, 101.15)
    assert info.ring[0] == info.ring[-1]


def test_parse_polygon_rounds_coordinates_to_six_decimals():
    ring = [[101.1490371234, 4.3091051234], [101.150963, 4.309105], [101.150963, 4.310895], [101.1490371234, 4.3091051234]]
    assert parse_polygon({"type": "Polygon", "coordinates": [ring]}).ring[0] == [101.149037, 4.309105]


@pytest.mark.parametrize("bad", [
    {"type": "Point", "coordinates": [101, 4]},
    {"type": "Polygon", "coordinates": []},
    {"type": "Polygon", "coordinates": [[[101, 4], [101.1, 4], [101.1, 4.1]]]},  # 没闭合、点太少
    {"type": "Polygon", "coordinates": [[[101, 4], [101.1, 4], [101.1, 4.1], [101, 4.2]]]},  # 没闭合
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},  # 蝴蝶结自交
    {"type": "Polygon", "coordinates": [[[200, 4], [101.1, 4], [101.1, 4.1], [200, 4]]]},  # 经度越界
    {"type": "Polygon", "coordinates": [[[101, 4], [101.0000001, 4], [101, 4.0000001], [101, 4]]]},  # 太小
    {"type": "Polygon", "coordinates": [[["a", 4], [101.1, 4], [101.1, 4.1], ["a", 4]]]},
])
def test_parse_polygon_rejects_bad_geometry(bad):
    with pytest.raises(GeometryError) as err:
        parse_polygon(bad)
    assert err.value.code == "geometry_invalid"


def test_area_is_within_one_percent_of_the_seed_spherical_area():
    # 种子用球面公式（与前端 @turf/area 同口径），后端用 WGS84 椭球，半岛纬度上约小 0.7%
    plots = [p["data"] for p in json.loads(SEED_PLOTS.read_text(encoding="utf8")) if p["data"]["geometryType"] == "polygon"]
    assert len(plots) == 178
    for d in plots:
        info = parse_polygon(json.loads(d["polygonGeojson"]))
        assert info.area_ha == pytest.approx(d["areaHaComputed"], rel=0.01)
        assert info.centroid_lat == pytest.approx(d["centroidLat"], abs=1e-4)
        assert info.centroid_lng == pytest.approx(d["centroidLng"], abs=1e-4)


def test_check_point_accepts_a_small_declared_area():
    assert check_point(4.3, 101.1, 2.5) == (4.3, 101.1, 2.5)


def test_check_point_rejects_four_hectares_or_more():
    with pytest.raises(GeometryError) as err:
        check_point(4.3, 101.1, 4)
    assert err.value.code == "point_area_too_large"


@pytest.mark.parametrize("area", [0, -1, True, "2"])
def test_check_point_rejects_nonpositive_or_non_numeric_area(area):
    with pytest.raises(GeometryError) as err:
        check_point(4.3, 101.1, area)
    assert err.value.code == "geometry_invalid"
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_geo.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core.geo'`

- [ ] **Step 3: 写实现**

`core/kebunsah_core/geo.py`：

```python
"""地块几何：校验 GeoJSON 多边形，按 WGS84 椭球算面积，算质心。后端重算，不信前端传来的数。

前端屏 5 预览用的是球面算法（@turf/area），椭球算法在半岛纬度大约小 0.7%，所以最终数字可能与预览略有出入。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from pyproj import Geod
from shapely.geometry import Polygon

from .params import DEFAULT_PARAMS, Params

GEOD = Geod(ellps="WGS84")
MIN_AREA_HA = 0.005  # 与前端屏 5 的校验一致


class GeometryError(ValueError):
    """几何不合法。code 给接口层映射成 422 的错误码。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PolygonInfo:
    ring: list[list[float]]  # [[lng, lat], ...]，首尾闭合，6 位小数
    area_ha: float  # 4 位小数
    centroid_lat: float
    centroid_lng: float


def _invalid(message: str) -> GeometryError:
    return GeometryError("geometry_invalid", message)


def _coord(pair: Any) -> list[float]:
    if not isinstance(pair, (list, tuple)) or len(pair) < 2:
        raise _invalid("coordinate must be [lng, lat]")
    lng, lat = pair[0], pair[1]
    for v in (lng, lat):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise _invalid("coordinate must be a finite number")
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise _invalid("coordinate out of range")
    return [round(float(lng), 6), round(float(lat), 6)]


def parse_polygon(geojson: Any) -> PolygonInfo:
    if not isinstance(geojson, dict) or geojson.get("type") != "Polygon":
        raise _invalid("geometry must be a GeoJSON Polygon")
    rings = geojson.get("coordinates")
    if not isinstance(rings, list) or len(rings) != 1:
        raise _invalid("polygon must have exactly one ring (no holes)")
    ring = [_coord(p) for p in rings[0]]
    if len(ring) < 4:
        raise _invalid("ring needs at least 3 distinct vertices")
    if ring[0] != ring[-1]:
        raise _invalid("ring is not closed")
    if len({tuple(p) for p in ring[:-1]}) < 3:
        raise _invalid("ring needs at least 3 distinct vertices")
    poly = Polygon(ring)
    if not poly.is_valid:
        raise _invalid("ring is self-intersecting")
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    area_ha = round(abs(GEOD.polygon_area_perimeter(lons, lats)[0]) / 10000, 4)
    if area_ha < MIN_AREA_HA:
        raise _invalid("polygon area is too small")
    centroid = poly.centroid
    if not poly.contains(centroid):
        centroid = poly.representative_point()
    return PolygonInfo(ring=ring, area_ha=area_ha, centroid_lat=round(centroid.y, 6), centroid_lng=round(centroid.x, 6))


def check_point(lat: Any, lng: Any, area_ha_declared: Any, params: Params = DEFAULT_PARAMS) -> tuple[float, float, float]:
    """只记一个点：返回规范化后的 (lat, lng, 手填面积)。面积必须 >0 且 < point_max_ha（EUDR：4 公顷以下才能只给一个点）。"""
    lng_, lat_ = _coord([lng, lat])
    if isinstance(area_ha_declared, bool) or not isinstance(area_ha_declared, (int, float)) or not math.isfinite(area_ha_declared):
        raise _invalid("declared area must be a number")
    if area_ha_declared <= 0:
        raise _invalid("declared area must be greater than 0")
    if area_ha_declared >= params.point_max_ha:
        raise GeometryError("point_area_too_large", f"point mode needs an area below {params.point_max_ha} ha")
    return lat_, lng_, round(float(area_ha_declared), 4)
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_geo.py -v`
Expected: PASS（17 passed：2 + 8 参数化 + 1 + 1 + 1 + 4 参数化）

- [ ] **Step 5: 提交**

```bash
git add core/kebunsah_core/geo.py core/tests/test_geo.py
git commit -m "feat(core): 多边形校验、WGS84 椭球面积与质心、只记一个点的校验" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 规则 CC-01 / CC-02 / CC-03 与置信度

**Files:**
- Create: `core/kebunsah_core/rules.py`
- Test: `core/tests/test_rules.py`

**Interfaces:**
- Consumes: `dates.diff_days`、`names.similarity`、`params.Params/DEFAULT_PARAMS`、`units.fmt_fixed/fmt_num/to_ten_thousandths`。
- Produces:
  - `rules.RuleResult`（dataclass，字段 `rule_code, result, expected_value, actual_value, params_used, detail, doc_type=None, evidence=[], meta={}`；方法 `to_doc() -> dict`，camelCase，`docType` 仅在非 `None` 时出现，不含 `meta`）
  - `rules.cc01(*, title_ha: float | None, plot_ha: float, params=DEFAULT_PARAMS) -> RuleResult`
  - `rules.cc02(*, as_of: str, doc_type: str, label: str, expiry_date: str, params=DEFAULT_PARAMS) -> RuleResult`
  - `rules.cc02_missing_licence(params=DEFAULT_PARAMS) -> RuleResult`
  - `rules.cc03(*, operator_name: str, title_names: list[str], licence_name: str | None = None, member_name: str | None = None, params=DEFAULT_PARAMS) -> RuleResult`
  - `rules.is_unconfirmed_low(field_doc: Mapping | None, params=DEFAULT_PARAMS) -> bool`
  - `rules.to_needs_review(base: RuleResult, field_doc: Mapping, doc_type: str) -> RuleResult`
  - `meta["kind"]` 取值：CC-01 `area|missing`；CC-02 `ok|expiring|expired|missing`；CC-03 `name|missing`；任何被降级的 `low_confidence`（此时 `meta["doc_type"]` 是被读不准的那份文件）。

- [ ] **Step 1: 写失败的测试**

`core/tests/test_rules.py`：

```python
import pytest

from kebunsah_core.rules import (cc01, cc02, cc02_missing_licence, cc03, is_unconfirmed_low,
                                 to_needs_review)

AS_OF = "2026-10-09"


# ---- CC-01 面积 ----
def test_cc01_passes_within_tolerance():
    r = cc01(title_ha=4.2, plot_ha=4.23)
    assert (r.result, r.expected_value, r.actual_value) == ("pass", "4.2000 ha", "4.2300 ha")
    assert r.detail == "Beza 0.03 ha, dalam had yang dibenarkan"


def test_cc01_warns_above_tolerance():
    r = cc01(title_ha=3.04, plot_ha=3.49)
    assert (r.result, r.expected_value, r.actual_value) == ("warn", "3.0400 ha", "3.4900 ha")
    assert r.detail == "Lebih 0.45 ha (+14.8%), melebihi had 0.304 ha"


def test_cc01_fails_above_fifty_percent():
    r = cc01(title_ha=2.0, plot_ha=3.4)
    assert r.result == "fail"
    assert r.detail == "Lebih 70%, melebihi had 50%"


def test_cc01_tolerance_is_the_larger_of_ten_percent_and_a_tenth_of_a_hectare():
    assert cc01(title_ha=0.5, plot_ha=0.6).result == "pass"  # 10% = 0.05 < 0.1，容差取 0.1，刚好 0.1 通过
    assert cc01(title_ha=0.5, plot_ha=0.6001).result == "warn"


def test_cc01_does_not_judge_a_smaller_plot():
    assert cc01(title_ha=3.0, plot_ha=2.0).result == "pass"


def test_cc01_without_a_title_is_a_missing_document():
    r = cc01(title_ha=None, plot_ha=3.0)
    assert (r.result, r.doc_type, r.meta["kind"]) == ("fail", "land_title", "missing")


# ---- CC-02 有效期 ----
def test_cc02_passes_with_plenty_of_time():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2027-03-31")
    assert (r.result, r.actual_value, r.expected_value, r.doc_type) == ("pass", "173 hari", ">= 90 hari", "mpob_licence")
    assert r.detail == "MPOB tamat pada 2027-03-31, 173 hari lagi"


def test_cc02_warns_when_under_ninety_days():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-12-05")
    assert (r.result, r.actual_value) == ("warn", "57 hari")


@pytest.mark.parametrize("expiry,result", [
    ("2027-01-07", "pass"),  # 刚好 90 天：不足 90 天才警告
    ("2027-01-06", "warn"),  # 89 天
    ("2026-10-09", "warn"),  # 到期当天算未过期
    ("2026-10-08", "fail"),  # 前一天已过期
])
def test_cc02_boundaries(expiry, result):
    assert cc02(as_of=AS_OF, doc_type="mspo_cert", label="MSPO", expiry_date=expiry).result == result


def test_cc02_expired_writes_a_date_prefixed_actual_value():
    r = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-04-30")
    assert (r.result, r.actual_value) == ("fail", "2026-04-30 telah tamat")
    assert r.meta["days"] == -162


def test_cc02_missing_licence_warns():
    r = cc02_missing_licence()
    assert (r.result, r.doc_type, r.actual_value) == ("warn", "mpob_licence", "Tiada lesen MPOB")


# ---- CC-03 姓名 ----
def test_cc03_passes_when_all_names_match():
    r = cc03(operator_name="TAN AH KOW", title_names=["TAN AH KOW"], licence_name="TAN AH KOW", member_name="TAN AH KOW")
    assert (r.result, r.actual_value, r.expected_value) == ("pass", "1.00", ">= 0.85")


def test_cc03_fails_when_the_title_is_in_the_late_father_name():
    r = cc03(operator_name="MUTHU A/L RAMAN", title_names=["RAMAN A/L SUBRAMANIAM"], licence_name="MUTHU A/L RAMAN")
    assert r.result == "fail"
    assert r.meta["label"] == "geran" and r.meta["name"] == "RAMAN A/L SUBRAMANIAM"


def test_cc03_picks_the_closest_of_several_proprietors():
    r = cc03(operator_name="AHMAD ZAKI BIN ROSLI", title_names=["SITI BINTI ALI", "AHMAD ZAKI BIN ROSLI"])
    assert r.result == "pass"


def test_cc03_takes_the_worst_of_title_licence_and_member_list():
    r = cc03(operator_name="TAN AH KOW", title_names=["TAN AH KOW"], licence_name="LIM MEI LING")
    assert (r.result, r.meta["label"]) == ("fail", "lesen MPOB")


def test_cc03_without_title_names_needs_review():
    r = cc03(operator_name="TAN AH KOW", title_names=[])
    assert (r.result, r.meta["kind"]) == ("needs_review", "missing")


# ---- 读出置信度 ----
@pytest.mark.parametrize("field,expected", [
    ({"confidence": 0.64}, True),
    ({"confidence": 0.69}, True),
    ({"confidence": 0.70}, False),  # 恰好 0.7 不算低于
    ({"confidence": 0.95}, False),
    ({"confidence": 0.64, "confirmedValue": "2026-12-05"}, False),  # 用户确认过
    ({"normalizedValue": "x"}, True),  # 有字段但没有置信度，按低处理
    (None, False),
])
def test_is_unconfirmed_low(field, expected):
    assert is_unconfirmed_low(field) is expected


def test_to_needs_review_keeps_expected_value_and_records_the_doc_type():
    base = cc01(title_ha=3.04, plot_ha=3.05)
    r = to_needs_review(base, {"confidence": 0.59}, "land_title")
    assert (r.result, r.actual_value, r.expected_value) == ("needs_review", "keyakinan bacaan 0.59", "3.0400 ha")
    assert r.meta["kind"] == "low_confidence" and r.meta["doc_type"] == "land_title"
    assert base.result == "pass"  # 不改原对象


def test_rule_result_to_doc_uses_the_firestore_shape():
    doc = cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-12-05").to_doc()
    assert set(doc) == {"ruleCode", "result", "expectedValue", "actualValue", "paramsUsed", "evidence", "detail", "docType"}
    assert doc["paramsUsed"] == {"warn_days": 90} and doc["evidence"] == []
    assert "docType" not in cc01(title_ha=3.0, plot_ha=3.0).to_doc()
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_rules.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core.rules'`

- [ ] **Step 3: 写实现**

`core/kebunsah_core/rules.py`：

```python
"""确定性规则：CC-01 面积、CC-02 有效期、CC-03 姓名，加上"读出置信度"。

逻辑与 seed/src/rules.mjs 一致（它是种子生成器用的实现），区别有两处，都是企划书 §11 / spec 的决定：
- CC-02 每份文件一条（带 doc_type），而不是只留最差的一条；
- 缺地契、缺执照按"缺文件"处理，不抛错。
说明文字（detail）用马来语，是兜底文案；前端不显示它们，按 gapCode 自己生成。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any, Mapping

from .dates import diff_days
from .names import similarity
from .params import DEFAULT_PARAMS, Params
from .units import fmt_fixed, fmt_num, to_ten_thousandths


@dataclass
class RuleResult:
    rule_code: str
    result: str  # pass | warn | fail | needs_review
    expected_value: str
    actual_value: str
    params_used: dict[str, Any]
    detail: str
    doc_type: str | None = None  # 只有 CC-02（以及缺文件的行）带
    evidence: list[dict[str, str]] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)  # 给 derive_gaps 用，不进 Firestore

    def to_doc(self) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "ruleCode": self.rule_code,
            "result": self.result,
            "expectedValue": self.expected_value,
            "actualValue": self.actual_value,
            "paramsUsed": dict(self.params_used),
            "evidence": [dict(e) for e in self.evidence],
            "detail": self.detail,
        }
        if self.doc_type is not None:
            doc["docType"] = self.doc_type
        return doc


def _ha4(x: float) -> str:
    return fmt_fixed(x, 4)


def cc01(*, title_ha: float | None, plot_ha: float, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """地图面积比地契多出多少。多出不超过"地契面积的 10% 与 0.1 公顷中较大者"→ 通过；超出 → 黄；多出超过 50% → 红。
    面积偏小不判（企划书 §8.6 未定，保守按通过）。"""
    used = {
        "tol_pct": params.area_tolerance_pct,
        "tol_min_ha": params.area_tolerance_min_ha,
        "fail_over_pct": params.area_fail_over_pct,
    }
    if title_ha is None:
        return RuleResult("CC-01", "fail", "Geran ada", "Tiada geran", used, "Geran belum dimuat naik",
                          doc_type="land_title", meta={"kind": "missing"})
    t = to_ten_thousandths(title_ha)
    p = to_ten_thousandths(plot_ha)
    over = p - t
    tol = max(t * params.area_tolerance_pct / 100, params.area_tolerance_min_ha * 10000)
    result = "pass"
    if over * 100 > t * params.area_fail_over_pct:
        result = "fail"
    elif over > tol:
        result = "warn"
    over_ha = over / 10000
    pct = over / t * 100
    if result == "pass":
        detail = f"Beza {fmt_fixed(over_ha, 2)} ha, dalam had yang dibenarkan"
    elif result == "warn":
        detail = f"Lebih {fmt_fixed(over_ha, 2)} ha (+{fmt_fixed(pct, 1)}%), melebihi had {fmt_fixed(tol / 10000, 3)} ha"
    else:
        detail = f"Lebih {fmt_fixed(pct, 0)}%, melebihi had {fmt_num(params.area_fail_over_pct)}%"
    return RuleResult("CC-01", result, f"{_ha4(title_ha)} ha", f"{_ha4(plot_ha)} ha", used, detail,
                      meta={"kind": "area", "over_ha": over_ha, "pct": pct})


def _expiry_used(params: Params) -> dict[str, Any]:
    return {"warn_days": params.expiry_warn_days}


def cc02(*, as_of: str, doc_type: str, label: str, expiry_date: str, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """一份文件的有效期。已过期(<0 天) → 红；不足 warn_days(<90) → 黄；其余通过。到期当天按未过期。
    actualValue 的格式前端会解析：剩余天数写 "58 hari"，已过期写以 YYYY-MM-DD 开头的 "2026-04-30 telah tamat"。"""
    days = diff_days(as_of, expiry_date)
    if days < 0:
        result, kind = "fail", "expired"
    elif days < params.expiry_warn_days:
        result, kind = "warn", "expiring"
    else:
        result, kind = "pass", "ok"
    if kind == "expired":
        detail = f"{label} tamat pada {expiry_date}, telah tamat tempoh {-days} hari"
        actual = f"{expiry_date} telah tamat"
    else:
        detail = f"{label} tamat pada {expiry_date}, {days} hari lagi"
        actual = f"{days} hari"
    return RuleResult("CC-02", result, f">= {fmt_num(params.expiry_warn_days)} hari", actual, _expiry_used(params), detail,
                      doc_type=doc_type, meta={"kind": kind, "days": days, "date": expiry_date, "label": label})


def cc02_missing_licence(params: Params = DEFAULT_PARAMS) -> RuleResult:
    """缺 MPOB 执照记黄（团队约定，企划书屏 11 线框有 "MPOB licence missing" 一行）。"""
    return RuleResult("CC-02", "warn", "Lesen MPOB ada", "Tiada lesen MPOB", _expiry_used(params),
                      "Lesen MPOB belum dimuat naik", doc_type="mpob_licence", meta={"kind": "missing"})


def cc03(*, operator_name: str, title_names: list[str], licence_name: str | None = None,
         member_name: str | None = None, params: Params = DEFAULT_PARAMS) -> RuleResult:
    """园主姓名与三处纸面对得上吗。地契取各持有人中最像的一位；执照、MSPO 名单有才比；三段取最低。
    不采用"身份证哈希相同即同一人"的捷径（企划书里仍待确认）。"""
    used = {"min_similarity": params.name_similarity_min}
    expected = f">= {fmt_fixed(params.name_similarity_min, 2)}"
    if not title_names:
        return RuleResult("CC-03", "needs_review", expected, "Tiada geran", used, "Geran belum dimuat naik",
                          meta={"kind": "missing"})
    best = max(title_names, key=lambda n: similarity(operator_name, n))
    parts = [("geran", best)]
    if licence_name is not None:
        parts.append(("lesen MPOB", licence_name))
    if member_name is not None:
        parts.append(("senarai MSPO", member_name))
    scored = [(label, name, similarity(operator_name, name)) for label, name in parts]
    label, name, sim = min(scored, key=lambda s: s[2])
    result = "pass" if sim >= params.name_similarity_min else "fail"
    detail = ("Nama pada geran, lesen dan senarai sepadan" if result == "pass"
              else f"Nama pada {label} ialah {name}, berbeza daripada pengusaha {operator_name}")
    return RuleResult("CC-03", result, expected, fmt_fixed(sim, 2), used, detail,
                      meta={"kind": "name", "sim": sim, "label": label, "name": name})


def is_unconfirmed_low(field_doc: Mapping[str, Any] | None, params: Params = DEFAULT_PARAMS) -> bool:
    """置信度低于阈值（0.7）且用户还没确认 → 这个字段读不准，依赖它的规则只能"需人工复核"。
    没有字段（文件没读到）不算；有字段但没有置信度按低处理。"""
    if not field_doc:
        return False
    if field_doc.get("confirmedValue") is not None:
        return False
    confidence = field_doc.get("confidence")
    if confidence is None:
        return True
    return math.floor(confidence * 100 + 0.5) < math.floor(params.confidence_min * 100 + 0.5)


def to_needs_review(base: RuleResult, field_doc: Mapping[str, Any], doc_type: str) -> RuleResult:
    confidence = field_doc.get("confidence")
    shown = fmt_fixed(confidence, 2) if confidence is not None else "?"
    return replace(
        base,
        result="needs_review",
        actual_value=f"keyakinan bacaan {shown}",
        detail="Bacaan gambar kurang jelas, perlu disahkan",
        meta={**base.meta, "kind": "low_confidence", "doc_type": doc_type},
    )
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_rules.py -v`
Expected: PASS（28 passed：CC-01 6、CC-02 8（含 4 个边界参数化）、CC-03 5、置信度 7 个参数化 + 1 + 1）

- [ ] **Step 5: 提交**

```bash
git add core/kebunsah_core/rules.py core/tests/test_rules.py
git commit -m "feat(core): 规则 CC-01 面积、CC-02 有效期（每份文件一条）、CC-03 姓名、读出置信度" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 定级、缺口与单个地块的评估入口

**Files:**
- Create: `core/kebunsah_core/grading.py`、`core/kebunsah_core/evaluate.py`
- Test: `core/tests/test_grading_evaluate.py`

**Interfaces:**
- Consumes: `rules.RuleResult/cc01/cc02/cc02_missing_licence/cc03/is_unconfirmed_low/to_needs_review`、`params.Params/DEFAULT_PARAMS`、`units.fmt_fixed`。
- Produces:
  - `grading.Gap`（dataclass，字段 `gap_code, severity, doc_type, description, suggested_action, citation=None, status="open"`；`to_doc()` 返回 camelCase 字典）
  - `grading.aggregate(rule_results: list[RuleResult], gaps: list[Gap]) -> str`
  - `grading.derive_gaps(rule_results: list[RuleResult], *, not_in_mspo: bool) -> list[Gap]`
  - `grading.summarize(status: str, gaps: list[Gap]) -> str`
  - `evaluate.PlotFacts`（冻结 dataclass）：`operator_name: str`、`plot_ha: float`、`title_ha: float | None = None`、`title_names: tuple[str, ...] = ()`、`lease_expiry: str | None = None`、`licence_valid_until: str | None = None`、`licence_name: str | None = None`、`cert_expiry: str | None = None`、`member_name: str | None = None`、`in_mspo: bool = False`
  - `evaluate.Evaluation`：`results: list[RuleResult]`、`gaps: list[Gap]`、`status: str`
  - `evaluate.evaluate_plot(facts: PlotFacts, critical: Mapping | None = None, *, as_of: str, params=DEFAULT_PARAMS) -> Evaluation`；`critical` 的键是 `area`、`valid_until`、`name`，值是读出的字段字典（含 `confidence`、可选 `confirmedValue`）或 `None`。

- [ ] **Step 1: 写失败的测试**

`core/tests/test_grading_evaluate.py`：

```python
from kebunsah_core.evaluate import PlotFacts, evaluate_plot
from kebunsah_core.grading import Gap, aggregate, derive_gaps, summarize
from kebunsah_core.rules import RuleResult, cc01, cc02, cc02_missing_licence, cc03

AS_OF = "2026-10-09"
OK = {"confidence": 0.95}


def rr(code, result, **meta):
    return RuleResult(code, result, "", "", {}, "", meta=meta)


# ---- aggregate ----
def test_aggregate_orders_red_over_review_over_yellow_over_green():
    assert aggregate([rr("CC-01", "pass"), rr("CC-02", "pass")], []) == "green"
    assert aggregate([rr("CC-01", "warn")], []) == "yellow"
    assert aggregate([rr("CC-01", "pass")], [Gap("not_in_mspo", "medium", None, "", "")]) == "yellow"
    assert aggregate([rr("CC-01", "warn"), rr("CC-03", "needs_review")], []) == "needs_review"
    assert aggregate([rr("CC-03", "needs_review"), rr("CC-02", "fail")], []) == "red"


def test_aggregate_ignores_resolved_gaps():
    assert aggregate([rr("CC-01", "pass")], [Gap("x", "low", None, "", "", status="resolved")]) == "green"


# ---- derive_gaps ----
def test_derive_gaps_for_each_failing_rule():
    results = [
        cc01(title_ha=2.0, plot_ha=3.4),
        cc02(as_of=AS_OF, doc_type="mpob_licence", label="MPOB", expiry_date="2026-04-30"),
        cc03(operator_name="MUTHU A/L RAMAN", title_names=["RAMAN A/L SUBRAMANIAM"]),
    ]
    gaps = derive_gaps(results, not_in_mspo=True)
    assert [(g.gap_code, g.severity, g.doc_type) for g in gaps] == [
        ("area_mismatch", "high", None),
        ("expired", "high", "mpob_licence"),
        ("name_mismatch", "high", "land_title"),
        ("not_in_mspo", "medium", "mspo_member_list"),
    ]


def test_expiring_gap_points_at_the_document_that_expires():
    gaps = derive_gaps([cc02(as_of=AS_OF, doc_type="mspo_cert", label="MSPO", expiry_date="2026-12-05")], not_in_mspo=False)
    assert [(g.gap_code, g.doc_type) for g in gaps] == [("expiring", "mspo_cert")]
    assert "Sijil MSPO" in gaps[0].description


def test_missing_licence_and_missing_title_become_missing_doc_gaps():
    gaps = derive_gaps([cc01(title_ha=None, plot_ha=3.0), cc02_missing_licence(),
                        cc03(operator_name="A", title_names=[])], not_in_mspo=False)
    assert [(g.gap_code, g.severity, g.doc_type) for g in gaps] == [
        ("missing_doc", "high", "land_title"), ("missing_doc", "medium", "mpob_licence")]  # CC-03 缺地契不重复报


def test_gap_to_doc_uses_the_firestore_shape():
    doc = Gap("expired", "high", "mpob_licence", "d", "a").to_doc()
    assert doc == {"gapCode": "expired", "severity": "high", "docType": "mpob_licence", "description": "d",
                   "suggestedAction": "a", "citation": None, "status": "open"}


def test_summarize():
    assert summarize("green", []) == "Semua semakan lulus."
    gaps = [Gap("a", "low", None, "Satu", ""), Gap("b", "low", None, "Dua", "")]
    assert summarize("yellow", gaps) == "Satu. Dua."


# ---- evaluate_plot ----
GREEN = PlotFacts(operator_name="TAN AH KOW", plot_ha=4.23, title_ha=4.2, title_names=("TAN AH KOW",),
                  licence_valid_until="2027-03-31", licence_name="TAN AH KOW", cert_expiry="2029-02-28",
                  member_name="TAN AH KOW", in_mspo=True)


def test_evaluate_green():
    ev = evaluate_plot(GREEN, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "green" and ev.gaps == []
    assert [(r.rule_code, r.doc_type) for r in ev.results] == [
        ("CC-01", None), ("CC-02", "mpob_licence"), ("CC-02", "mspo_cert"), ("CC-03", None)]


def test_evaluate_yellow_area_and_expiring_licence():
    facts = PlotFacts(operator_name="AHMAD ZAKI BIN ROSLI", plot_ha=3.49, title_ha=3.04,
                      title_names=("AHMAD ZAKI BIN ROSLI",), licence_valid_until="2026-12-05",
                      licence_name="AHMAD ZAKI BIN ROSLI", cert_expiry="2029-02-28",
                      member_name="AHMAD ZAKI BIN ROSLI", in_mspo=True)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": {"confidence": 0.64, "confirmedValue": "2026-12-05"}, "name": OK},
                       as_of=AS_OF)
    assert ev.status == "yellow"
    assert sorted(g.gap_code for g in ev.gaps) == ["area_mismatch", "expiring"]


def test_evaluate_red_for_the_deceased_father_title():
    facts = PlotFacts(operator_name="MUTHU A/L RAMAN", plot_ha=3.4, title_ha=2.0, title_names=("RAMAN A/L SUBRAMANIAM",),
                      licence_valid_until="2026-04-30", licence_name="MUTHU A/L RAMAN", in_mspo=False)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "red"
    assert sorted(g.gap_code for g in ev.gaps) == ["area_mismatch", "expired", "name_mismatch", "not_in_mspo"]


def test_evaluate_unconfirmed_low_confidence_needs_review():
    ev = evaluate_plot(GREEN, {"area": OK, "valid_until": OK, "name": {"confidence": 0.59}}, as_of=AS_OF)
    assert ev.status == "needs_review"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [("low_confidence", "land_title")]


def test_evaluate_without_documents_is_red_not_a_crash():
    facts = PlotFacts(operator_name="TAN AH KOW", plot_ha=3.0)
    ev = evaluate_plot(facts, {}, as_of=AS_OF)
    assert ev.status == "red"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [
        ("missing_doc", "land_title"), ("missing_doc", "mpob_licence"), ("not_in_mspo", "mspo_member_list")]


def test_evaluate_lease_expiry_gets_its_own_row():
    facts = PlotFacts(operator_name="TAN AH KOW", plot_ha=4.2, title_ha=4.2, title_names=("TAN AH KOW",),
                      lease_expiry="2026-11-01", licence_valid_until="2027-06-01", licence_name="TAN AH KOW",
                      cert_expiry="2029-02-28", member_name="TAN AH KOW", in_mspo=True)
    ev = evaluate_plot(facts, {"area": OK, "valid_until": OK, "name": OK}, as_of=AS_OF)
    assert ev.status == "yellow"
    assert [(g.gap_code, g.doc_type) for g in ev.gaps] == [("expiring", "land_title")]
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `python -m pytest core/tests/test_grading_evaluate.py -v`
Expected: FAIL，`ModuleNotFoundError: No module named 'kebunsah_core.evaluate'`

- [ ] **Step 3: 写实现**

`core/kebunsah_core/grading.py`：

```python
"""定级与缺口：由规则结果推出缺口清单、整块地的红黄绿。逻辑与 seed/src/rules.mjs 的 aggregate / deriveGaps / summarize 一致。

gapCode、severity、docType 由规则确定，不让模型决定；description / suggestedAction 是马来语兜底文案
（前端不显示，按 gapCode 自己生成；Gemini 写出更好的文案时覆盖这两个字段）。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .rules import RuleResult
from .units import fmt_fixed

DOC_LABEL = {"mpob_licence": "Lesen MPOB", "mspo_cert": "Sijil MSPO", "land_title": "Pajakan tanah"}


@dataclass
class Gap:
    gap_code: str
    severity: str  # high | medium | low
    doc_type: str | None
    description: str
    suggested_action: str
    citation: str | None = None
    status: str = "open"

    def to_doc(self) -> dict[str, Any]:
        return {
            "gapCode": self.gap_code,
            "severity": self.severity,
            "docType": self.doc_type,
            "description": self.description,
            "suggestedAction": self.suggested_action,
            "citation": self.citation,
            "status": self.status,
        }


def aggregate(rule_results: list[RuleResult], gaps: list[Gap]) -> str:
    """有 fail → red；否则有 needs_review → needs_review；否则有 warn 或未解决的缺口 → yellow；否则 green。"""
    if any(r.result == "fail" for r in rule_results):
        return "red"
    if any(r.result == "needs_review" for r in rule_results):
        return "needs_review"
    if any(r.result == "warn" for r in rule_results) or any(g.status == "open" for g in gaps):
        return "yellow"
    return "green"


def _expiry_gap(r: RuleResult) -> Gap:
    m = r.meta
    label = DOC_LABEL.get(r.doc_type or "", "Dokumen")
    is_licence = r.doc_type == "mpob_licence"
    if m["kind"] == "expired":
        action = ("Perbaharui lesen dahulu (fi lewat dikenakan), kemudian muat naik lesen baharu." if is_licence
                  else f"Perbaharui {label} dahulu, kemudian muat naik salinan baharu.")
        return Gap("expired", "high", r.doc_type, f"{label} telah tamat tempoh {-m['days']} hari", action)
    action = ("Mohon pembaharuan lebih awal, kemudian muat naik lesen baharu." if is_licence
              else f"Mohon pembaharuan lebih awal, kemudian muat naik {label} baharu.")
    return Gap("expiring", "medium", r.doc_type, f"{label} tamat dalam {m['days']} hari", action)


def derive_gaps(rule_results: list[RuleResult], *, not_in_mspo: bool) -> list[Gap]:
    """从非通过的规则结果推出缺口；不在 MSPO 名单是单独一条（没有对应规则）。"""
    gaps: list[Gap] = []
    for r in rule_results:
        if r.result == "pass":
            continue
        m = r.meta
        kind = m.get("kind")
        if kind == "low_confidence":
            gaps.append(Gap("low_confidence", "medium", m.get("doc_type"),
                            "Tulisan pada gambar kurang jelas, nilai perlu disahkan",
                            "Sahkan nilai di skrin semakan, atau ambil gambar semula yang lebih jelas."))
        elif r.rule_code == "CC-01":
            if kind == "missing":
                gaps.append(Gap("missing_doc", "high", "land_title", "Geran belum dimuat naik",
                                "Ambil gambar geran tanah dan muat naik."))
            else:
                gaps.append(Gap("area_mismatch", "high" if r.result == "fail" else "medium", None,
                                f"Luas pada peta lebih besar {fmt_fixed(m['over_ha'], 2)} ha ({fmt_fixed(m['pct'], 0)}%) daripada geran",
                                "Lukis semula sempadan, atau semak sama ada tanah telah dipecahkan atau ada geran bersebelahan."))
        elif r.rule_code == "CC-02":
            if kind == "missing":
                gaps.append(Gap("missing_doc", "medium", "mpob_licence", "Lesen MPOB belum dimuat naik",
                                "Ambil gambar lesen MPOB dan muat naik."))
            else:
                gaps.append(_expiry_gap(r))
        elif r.rule_code == "CC-03":
            if kind == "missing":
                continue  # 缺地契已由 CC-01 的 missing_doc 说明
            gaps.append(Gap("name_mismatch", "high", "land_title",
                            f"Nama pada {m['label']} ialah {m['name']}, berbeza daripada pengusaha",
                            "Sediakan dokumen pusaka (surat kuasa mentadbir atau perintah faraid) atau surat kuasa wakil "
                            "daripada semua waris, kemudian muat naik salinan yang jelas pada skrin Dokumen."))
    if not_in_mspo:
        gaps.append(Gap("not_in_mspo", "medium", "mspo_member_list",
                        "Pengusaha tiada dalam senarai ahli skim kumpulan MSPO",
                        "Sahkan dengan koperasi sama ada sudah menyertai skim kumpulan MSPO."))
    return gaps


def summarize(status: str, gaps: list[Gap]) -> str:
    if status == "green":
        return "Semua semakan lulus."
    return " ".join(f"{g.description}." for g in gaps)
```

`core/kebunsah_core/evaluate.py`：

```python
"""把一个地块的事实喂给三条规则，得到规则结果、缺口和红黄绿。评估流水线和黄金测试都从这里进。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .grading import Gap, aggregate, derive_gaps
from .params import DEFAULT_PARAMS, Params
from .rules import (RuleResult, cc01, cc02, cc02_missing_licence, cc03, is_unconfirmed_low,
                    to_needs_review)


@dataclass(frozen=True)
class PlotFacts:
    """评估一个地块用到的、已经规范化的事实。缺的文件用 None / 空表示。"""
    operator_name: str
    plot_ha: float  # 多边形的重算面积，或只记一个点时手填的面积
    title_ha: float | None = None  # 地契面积（已换算成公顷）；None = 没有地契
    title_names: tuple[str, ...] = ()  # 地契上登记的全部持有人
    lease_expiry: str | None = None  # 仅租约
    licence_valid_until: str | None = None  # None = 没有 MPOB 执照
    licence_name: str | None = None
    cert_expiry: str | None = None  # 园主在 MSPO 名单上时才给
    member_name: str | None = None
    in_mspo: bool = False


@dataclass
class Evaluation:
    results: list[RuleResult] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    status: str = "pending"


def evaluate_plot(facts: PlotFacts, critical: Mapping[str, Mapping | None] | None = None, *, as_of: str,
                  params: Params = DEFAULT_PARAMS) -> Evaluation:
    """critical 是三个关键字段的读出结果（含 confidence、confirmedValue），键为 area / valid_until / name；
    置信度低于阈值又没确认的，依赖它的规则降为 needs_review。"""
    critical = critical or {}
    r1 = cc01(title_ha=facts.title_ha, plot_ha=facts.plot_ha, params=params)
    if facts.title_ha is not None and is_unconfirmed_low(critical.get("area"), params):
        r1 = to_needs_review(r1, critical["area"], "land_title")

    r2: list[RuleResult] = []
    if facts.licence_valid_until is None:
        r2.append(cc02_missing_licence(params))
    else:
        row = cc02(as_of=as_of, doc_type="mpob_licence", label="MPOB", expiry_date=facts.licence_valid_until, params=params)
        if is_unconfirmed_low(critical.get("valid_until"), params):
            row = to_needs_review(row, critical["valid_until"], "mpob_licence")
        r2.append(row)
    if facts.lease_expiry is not None:
        r2.append(cc02(as_of=as_of, doc_type="land_title", label="sewaan", expiry_date=facts.lease_expiry, params=params))
    if facts.cert_expiry is not None:
        r2.append(cc02(as_of=as_of, doc_type="mspo_cert", label="MSPO", expiry_date=facts.cert_expiry, params=params))

    r3 = cc03(operator_name=facts.operator_name, title_names=list(facts.title_names),
              licence_name=facts.licence_name, member_name=facts.member_name, params=params)
    if facts.title_names and is_unconfirmed_low(critical.get("name"), params):
        r3 = to_needs_review(r3, critical["name"], "land_title")

    results = [r1, *r2, r3]
    gaps = derive_gaps(results, not_in_mspo=not facts.in_mspo)
    return Evaluation(results=results, gaps=gaps, status=aggregate(results, gaps))
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `python -m pytest core/tests/test_grading_evaluate.py -v`
Expected: PASS（13 passed）

- [ ] **Step 5: 提交**

```bash
git add core/kebunsah_core/grading.py core/kebunsah_core/evaluate.py core/tests/test_grading_evaluate.py
git commit -m "feat(core): 定级、缺口、单个地块的评估入口 evaluate_plot（缺文件按 missing_doc 处理）" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 黄金测试（200 个种子地块）并开 PR

**Files:**
- Test: `core/tests/test_golden_seed.py`

**Interfaces:**
- Consumes: `evaluate.PlotFacts`、`evaluate.evaluate_plot`、`params.params_from_config`；读 `seed/data/{_manifest,config,persons,titles,mpobLicences,mspoCertificates,mspoMembers,documents,assessments,plots}.json`。

- [ ] **Step 1: 写测试**

`core/tests/test_golden_seed.py`：

```python
"""黄金测试：用 seed/data 里 200 个地块的原始事实重算，结果必须和种子生成器存下来的评估一致。

种子里的评估由 seed/src/rules.mjs 生成，前端按它解析；这里证明 Python 规则与它逐项对得上
（结果、期望值、实际值、缺口、红黄绿）。演示用的 3 个地块是手写评估（日期按 10/8 算），只比结果和状态。
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from kebunsah_core.evaluate import PlotFacts, evaluate_plot
from kebunsah_core.params import params_from_config

SEED = Path(__file__).resolve().parents[2] / "seed" / "data"
AS_OF = json.loads((SEED / "_manifest.json").read_text(encoding="utf8"))["asOf"]
DEMO_PLOT_IDS = {f"90000000-0000-4000-8000-00000000000{n}" for n in (1, 2, 3)}


def _load(name: str) -> list[dict]:
    return json.loads((SEED / f"{name}.json").read_text(encoding="utf8"))


def _by_id(name: str) -> dict[str, dict]:
    return {d["path"].rsplit("/", 1)[1]: d["data"] for d in _load(name)}


PERSONS = _by_id("persons")
TITLES = _by_id("titles")
LICENCES = _by_id("mpobLicences")
CERTS = _by_id("mspoCertificates")
MEMBERS = _by_id("mspoMembers")
PARAMS = params_from_config(_load("config")[0]["data"])

DOCS: dict[str, list[dict]] = {}
for _d in _load("documents"):
    DOCS.setdefault(_d["path"].split("/")[1], []).append(_d["data"])

ASSESSMENTS = {a["data"]["plotId"]: a["data"] for a in _load("assessments")}
PLOTS = [(p["path"].split("/")[1], p["data"]) for p in _load("plots")]


def _facts_and_critical(plot_id: str, plot: dict):
    operator = PERSONS[plot["operatorPersonId"]]
    title = TITLES[plot["landTitleId"]]
    licence = LICENCES.get(plot["mpobLicenceId"]) if plot.get("mpobLicenceId") else None
    cert = CERTS.get(plot["mspoCertificateId"]) if plot.get("mspoCertificateId") else None
    member = MEMBERS.get(plot["mspoMemberId"]) if plot.get("mspoMemberId") else None
    plot_ha = plot["areaHaComputed"] if plot["geometryType"] == "polygon" else plot["areaHaDeclared"]
    facts = PlotFacts(
        operator_name=operator["fullName"],
        plot_ha=plot_ha,
        title_ha=title["areaHa"],
        title_names=tuple(p["nameAsPrinted"] for p in title["proprietors"]),
        lease_expiry=title.get("leaseExpiry"),
        licence_valid_until=licence["validUntil"] if licence else None,
        licence_name=licence["holderName"] if licence else None,
        cert_expiry=cert["expiryDate"] if cert else None,
        member_name=member["memberName"] if member else None,
        in_mspo=member is not None,
    )
    docs = DOCS[plot_id]
    p1 = next(d for d in docs if d["docType"] == "land_title" and d["pageNo"] == 1)
    p2 = next(d for d in docs if d["docType"] == "land_title" and d["pageNo"] == 2)
    lic_doc = next((d for d in docs if d["docType"] == "mpob_licence"), None)
    operator_prop = next((p for p in title["proprietors"] if p["personId"] == plot["operatorPersonId"]), title["proprietors"][0])
    critical = {
        "area": p1["fields"]["land_title.area_value"],
        "valid_until": lic_doc["fields"]["mpob_licence.valid_until"] if lic_doc else None,
        "name": p2["fields"][f"land_title.proprietor_{operator_prop['seq']}_name"],
    }
    return facts, critical


def test_seed_is_the_expected_size():
    assert len(PLOTS) == 200
    assert len(ASSESSMENTS) == 200


@pytest.mark.parametrize("plot_id,plot", PLOTS, ids=[p[0][:8] for p in PLOTS])
def test_plot_matches_seed_assessment(plot_id, plot):
    facts, critical = _facts_and_critical(plot_id, plot)
    ev = evaluate_plot(facts, critical, as_of=AS_OF, params=PARAMS)
    stored = ASSESSMENTS[plot_id]

    assert ev.status == plot["status"] == stored["result"]

    for want in stored["ruleResults"]:
        code = want["ruleCode"]
        if code == "CC-02":
            # 种子只留"最差的一份"（始终是 MPOB 执照，或缺执照那一行）；我们每份文件一条
            got = next(r for r in ev.results if r.rule_code == "CC-02" and r.doc_type == "mpob_licence")
        else:
            got = next(r for r in ev.results if r.rule_code == code)
        assert got.result == want["result"], code
        if plot_id not in DEMO_PLOT_IDS:
            assert got.expected_value == want["expectedValue"], code
            assert got.actual_value == want["actualValue"], code

    got_gaps = Counter((g.gap_code, g.severity, g.doc_type) for g in ev.gaps)
    want_gaps = Counter((g["gapCode"], g["severity"], g["docType"]) for g in stored["gaps"])
    assert got_gaps == want_gaps
```

- [ ] **Step 2: 跑测试**

Run: `python -m pytest core/tests/test_golden_seed.py -q`
Expected: PASS（201 passed）。这份测试对着已经写好的实现，第一次就应当通过；如果有地块 FAIL，pytest 会指出是哪个 `plot_id`、哪条规则，先对照 `seed/src/rules.mjs` 找差异，不要改测试去迁就实现。

- [ ] **Step 3: 跑全部测试**

Run: `python -m pytest -q`
Expected: PASS（274 passed，0 failed）

> 数字核对：Task 1 的 1 + Task 2 的 8 + Task 3 的 6 + Task 4 的 17 + Task 5 的 28 + Task 6 的 13 = 73，加 Task 7 的 201（200 个地块 + 1 个规模检查）= 274。这些模块和测试文件已在临时目录里跑过（273 个，不含 Task 1 的 1 个冒烟测试）。

- [ ] **Step 4: 提交并推送**

```bash
git add core/tests/test_golden_seed.py
git commit -m "test(core): 用 seed 的 200 个地块做黄金测试（结果、期望值、实际值、缺口、红黄绿逐项一致）" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin be/core
```

- [ ] **Step 5: 开 PR**

用浏览器打开 `https://github.com/longrong1110/KebunSah/pull/new/be/core`，标题 `feat(core): Python 骨架与共用核心（规则、定级、几何）`，描述写：

```
计划 1／3：Python 工程骨架 + `core/`（不依赖任何云服务）。

- CC-01 面积、CC-02 有效期（每份文件一条，带 docType）、CC-03 姓名、读出置信度；定级与缺口；缺文件按 missing_doc 处理
- 多边形校验、WGS84 椭球面积与质心、只记一个点的校验（后端重算面积，不信前端）
- 身份证打码与哈希（pepper 上线前必须配）
- 黄金测试：seed 的 200 个地块，结果／期望值／实际值／缺口／红黄绿与种子逐项一致
- 只改 core/、README、CODEOWNERS，不碰 web/ 和 contract/
```

只改自己目录，PR 检查绿了就自己 Squash merge，合并后删分支。

---

### Task 8: PR 检查改跑 pytest（共管文件，单独分支）

**Files:**
- Modify: `infra/cloudbuild/pr.yaml`

**Interfaces:**
- Consumes: 仓库根目录的 `requirements-dev.txt`（Task 1）。找不到该文件时跳过，所以与 `be/core` 谁先合并无关。

- [ ] **Step 1: 建分支**

```bash
git switch main && git pull
git switch -c infra/pr-check-pytest
```

- [ ] **Step 2: 改 `infra/cloudbuild/pr.yaml`**

把

```yaml
  - id: api-test
    name: mcr.microsoft.com/dotnet/sdk:8.0
    entrypoint: bash
    args:
      - -c
      - |
        if ls api/*.sln api/*.csproj >/dev/null 2>&1; then cd api && dotnet test; else echo "api: 还没有代码，跳过"; fi
```

替换成

```yaml
  - id: backend-test
    name: python:3.11
    entrypoint: bash
    args:
      - -c
      - |
        if [ -f requirements-dev.txt ]; then pip install -q -r requirements-dev.txt && python -m pytest -q; else echo "backend: 还没有代码，跳过"; fi
```

- [ ] **Step 3: 本地模拟这一步**

要求 Docker Desktop 已启动，且 `be/core` 已合并到 `main`（否则没有 `requirements-dev.txt`，会走“跳过”分支）。

```bash
git pull origin main
docker run --rm -v "$PWD":/workspace -w /workspace python:3.11 bash -c 'if [ -f requirements-dev.txt ]; then pip install -q -r requirements-dev.txt && python -m pytest -q; else echo "backend: 还没有代码，跳过"; fi'
```

Expected: `be/core` 已合并时，末尾是 `… passed`、0 failed。

- [ ] **Step 4: 提交、推送、开 PR**

```bash
git add infra/cloudbuild/pr.yaml
git commit -m "ci: PR 检查的后端步骤从 dotnet test 换成 pytest" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin infra/pr-check-pytest
```

浏览器开 PR，标题 `ci: PR 检查的后端步骤换成 pytest`，**请 @longrong1110 Approve**（改的是共管的 `infra/`）。描述：`后端是 Python，之前的 dotnet test 骨架实际不会跑后端测试。找不到 requirements-dev.txt 时跳过，所以不依赖合并顺序。`

---

### Task 9: 合同：`rule_results` 加 `doc_type`，并答复 #14／#23（共管文件，单独分支）

**Files:**
- Modify: `contract/schema.sql`（`rule_results` 表、唯一约束、列注释）

**Interfaces:**
- Produces: `rule_results.doc_type`（取值同 `gaps.doc_type`，其余规则为空）；唯一约束改为 `(assessment_id, rule_code, COALESCE(doc_type, ''))`。Firestore 的 `ruleResults[]` 本来没有唯一约束，`docType` 是新增的可选字段。

- [ ] **Step 1: 建分支**

```bash
git switch main && git pull
git switch -c contract/rule-results-doc-type
```

- [ ] **Step 2: 改 `contract/schema.sql`（三处）**

(a) 把

```sql
-- 规则逐条结果（第 1 批）：每条规则一行：期望值、实际值、用了什么阈值、结果。看板的「查原因」读这张表。
CREATE TABLE rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code ~ '^CC-[0-9]{2}$'),
  result text NOT NULL CHECK (result IN ('pass','warn','fail','needs_review')),
  expected_value text,
  actual_value text,
  params_used jsonb,
  evidence jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, rule_code)
);
```

替换成

```sql
-- 规则逐条结果（第 1 批）：每条规则一行（有效期 CC-02 每份文件一行）：期望值、实际值、用了什么阈值、结果。看板的「查原因」读这张表。
CREATE TABLE rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code ~ '^CC-[0-9]{2}$'),
  doc_type text CHECK (doc_type IN ('land_title','mpob_licence','mspo_cert','mspo_member_list')),
  result text NOT NULL CHECK (result IN ('pass','warn','fail','needs_review')),
  expected_value text,
  actual_value text,
  params_used jsonb,
  evidence jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rule_results_unique_ux ON rule_results (assessment_id, rule_code, COALESCE(doc_type, ''));
```

(b) 在 `COMMENT ON COLUMN rule_results.result IS …` 这行**前面**加一行

```sql
COMMENT ON COLUMN rule_results.doc_type IS '[约] 这一条说的是哪份文件。有效期 CC-02 每份文件一条（MPOB 执照、MSPO 证书、地契租约）；其余规则为空';
```

(c) 文件开头注释里若有“17 张表”之类的计数不用动（表数量没变）。

- [ ] **Step 3: 在本地 PostgreSQL 里验证**

要求 Docker Desktop 已启动。

```bash
cd seed
npm run db:reset
npm run db:check
```

Expected: `db:reset` 无报错（`schema.sql` 整个跑通，包括末尾的演示数据 INSERT）；`db:check` 打印的每一项都是 `OK`，没有 `FAIL`。

再验证新约束。在仓库根目录建一个临时文件 `.tmp-rule-results-check.sql`（不要提交）：

```sql
DO $$
BEGIN
  INSERT INTO rule_results (assessment_id, rule_code, doc_type, result)
  VALUES ('70000000-0000-4000-8000-000000000002', 'CC-02', 'mspo_cert', 'pass');
  RAISE NOTICE 'OK    同一评估可以有第二条 CC-02（另一份文件）';
  BEGIN
    INSERT INTO rule_results (assessment_id, rule_code, doc_type, result)
    VALUES ('70000000-0000-4000-8000-000000000002', 'CC-02', 'mspo_cert', 'pass');
    RAISE NOTICE 'FAIL  同一份文件的第二条 CC-02 没有被拒绝';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK    同一份文件的第二条 CC-02 被拒绝';
  END;
  BEGIN
    INSERT INTO rule_results (assessment_id, rule_code, result)
    VALUES ('70000000-0000-4000-8000-000000000002', 'CC-02', 'pass');
    RAISE NOTICE 'FAIL  没有 doc_type 的重复 CC-02 没有被拒绝';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK    没有 doc_type 的重复 CC-02 被拒绝';
  END;
  BEGIN
    INSERT INTO rule_results (assessment_id, rule_code, doc_type, result)
    VALUES ('70000000-0000-4000-8000-000000000002', 'CC-02', 'passport', 'pass');
    RAISE NOTICE 'FAIL  非法 doc_type 没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    非法 doc_type 被拒绝';
  END;
END $$;
```

```bash
docker cp .tmp-rule-results-check.sql kebunsah-pg:/tmp/check.sql
docker exec kebunsah-pg psql -U kebunsah -d kebunsah -v ON_ERROR_STOP=1 -f /tmp/check.sql
```

Expected: 四行 `NOTICE:  OK …`，没有 `FAIL`。验证完删除临时文件：`rm .tmp-rule-results-check.sql`，并 `cd seed && npm run db:reset` 把库恢复成干净状态。

> 这段 SQL 在写计划时没能跑（那时 Docker 守护进程没启动），所以这一步是第一次真正验证；如果 `db:reset` 报错，先看是哪一行，通常是表达式唯一索引的写法或注释行位置。

- [ ] **Step 4: 提交、推送、开 PR**

```bash
git add contract/schema.sql
git commit -m "contract: rule_results 加 doc_type，CC-02 每份文件一条（唯一约束改为含 doc_type）" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin contract/rule-results-doc-type
```

浏览器开 PR，标题 `contract: rule_results 加 doc_type（CC-02 每份文件一条）`，**请 @longrong1110 Approve**。描述：

```
对应 #14 里“CC-02 每次评估只有一条，却覆盖多份文件”的问题：改成每份文件一条，ruleResults[] 的元素可带 docType（mpob_licence / mspo_cert / land_title）。
前端已有的行为不变：只有一份到期类缺口时和现在一样；不止一份时按 docType 逐份显示天数／日期。
schema.sql 已在本地 PostgreSQL 16 里跑通，db:check 全部 OK，另外验证了新唯一约束与 doc_type 的 CHECK。
```

- [ ] **Step 5: 在 PR #14 和 #23 里贴答复**

在 GitHub 上分别回复这两个 PR（同一段）：

```
乙（后端）答复：按这两个 PR 的提议实现。有几处我定了默认决定，有异议请直接回，没有就按这个做：

1. 评估文档带 `coopId`（来自 plots.coopId）。
2. `CC-02` 每份文件一条，`ruleResults[]` 的元素可带 `docType`（mpob_licence / mspo_cert / land_title）；schema.sql 的改动在 contract/rule-results-doc-type 那个 PR 里。
3. `users/{uid}` 首次登录由后端 `POST /api/me` 建档，只能建 smallholder；外勤、管理员由种子或 Admin SDK 预建。
4. 上传完成不用 object.finalize 触发器，也不加确认接口：评估开始时后端直接去 Storage 看对象在不在，不在按缺文件处理（missing_doc）。所以建文档时不写 `extractionStatus`，评估开始时才写 `uploaded`。
5. 原图读取：后端 `GET /api/documents/{id}/image` 返回 15 分钟有效的读取网址，不给前端开 Storage 读规则；裁剪框 `box` 本轮不写，前端先显示整张图。
6. `fields` 的键保持带点（land_title.lot_no），后端局部更新用转义的字段路径，不改键名。
7. 面积后端按 WGS84 椭球重算，半岛纬度上比前端预览（球面）小约 0.7%，屏 6／9 以后以后端的数为准。
8. 评估文档会多写两个字段，前端可读可不读：`steps[]`（每步日志）、`progress`（read／check／forest／actions，各为 pending／running／done／failed）。
```

---

## Self-Review（对照 spec）

**Spec 覆盖：**
- §3 `core/` 的 rules／units／geo／names／masking／params → Task 2–6；`pyproject.toml`、`CODEOWNERS` 补 `/core/` → Task 1。
- §3 `Dockerfile`、`api/`、`ai-worker/` 代码、适配器接口 → 计划 2、3（本计划不涉及，已在文首声明）。
- §6 默认决定 1（`coopId`）、3（`/api/me`）、4（不用触发器）、6（原图读取）→ 只是答复，在 Task 9 Step 5 贴出，代码在计划 2。决定 2（CC-02 每份文件一条）→ Task 5、6 的代码和 Task 9 的 schema。决定 5（面积偏小不判、`< 90` 才警告、取最低、不走哈希捷径）→ Task 5，由黄金测试守住。
- §7 测试：`core/` 的 TDD 与 200 地块黄金对照 → Task 2–7。`pr.yaml` 改 pytest → Task 8。API／模拟器／Gemini 冒烟 → 计划 2、3。
- §8 今晚的排期项：合同答复（Task 9）、骨架（Task 1）、`pr.yaml`（Task 8）、`core/rules`（Task 5–7）。
- §9 云端待办（AI Studio key、GCP 项目、Earth Engine）不是代码，不在计划里；文首之外由负责人（乙）自己去办。

**占位符扫描：** 无 TBD／TODO；每个代码步骤都有完整代码；每个命令都有预期输出，各任务的通过个数已按测试逐个数过。

**类型一致性：** `cc01(title_ha=, plot_ha=, params=)`、`cc02(as_of=, doc_type=, label=, expiry_date=, params=)`、`cc03(operator_name=, title_names=, licence_name=, member_name=, params=)`、`derive_gaps(rule_results, *, not_in_mspo)`、`evaluate_plot(facts, critical, *, as_of, params)` 在定义（Task 5、6）、测试和黄金测试里签名一致；`critical` 的键 `area`／`valid_until`／`name` 在 `evaluate.py` 与两份测试里一致；`meta["kind"]` 取值在 `rules.py` 与 `grading.py` 里一致。

**已知风险：** 种子里 `CC-02` 最差的一份始终是 MPOB 执照，黄金测试里“取 `doc_type == mpob_licence` 的那一行”依赖这个事实；如果以后种子重新生成出租约或证书最差的样本，该测试会失败，需要把对照改成“取各行最差”。

---

## 验证状态（写计划时）

- 任务 2–7 的全部模块和测试：已在临时目录（与仓库同样的目录结构，种子数据是仓库 `seed/data` 的副本）用 Python 3.11 跑过，273 个测试全部通过，其中黄金测试一次就全过。
- 任务 1（骨架、README、CODEOWNERS）、任务 8（`pr.yaml`）、任务 9（`schema.sql`）：**没有跑过**。任务 9 的 SQL 本该在 Docker 里验证，但写计划时 Docker 守护进程没有启动，所以第一次验证发生在执行时。

## 执行结果（2026-10-13 晚，subagent-driven）

任务 1–7 已在分支 `be/core` 完成，13 个本地提交，**未推送、未开 PR**；全套 `pytest` 433 个通过。任务 8、9 未做（单独分支，需要甲 Approve；任务 9 需要启动 Docker Desktop）。

**与本计划里的“逐字代码”不同的地方**（评审发现的缺陷，计划文本没有更新；以仓库里的代码为准）：
- `geo`：多边形的 ring 不是 list、超大整数坐标都抛 `GeometryError`（任务 4 修复轮）。
- `rules.cc01`：地契面积取整后 ≤ 0、非有限数、≥ 1e9 时返回 `needs_review` + `low_confidence`/`land_title`，不再除零（任务 5 修复轮及最终修复批次）。
- `grading.derive_gaps`：地契有面积但没有持有人姓名时补一条 `missing_doc`（medium，`land_title`）（任务 6 修复轮）。
- `masking`：`hash_ic(ic, pepper)` 的 `pepper` 必填，只认 ASCII 数字，必须正好 12 位，否则 `ValueError`；`mask_ic` 只收末四位。
- `rules`/`evaluate`：文件里读出来的乱值（坏日期、`None` 姓名、字符串或 NaN 置信度、非有限面积）一律产生 `needs_review` 行，不抛错；只有 `plot_ha`、`as_of`、`operator_name` 无效时抛 `ValueError`。到期日只认纯 `YYYY-MM-DD`。新增公开辅助 `rules.valid_area_ha` 和常量 `MAX_AREA_HA`。
- 其他：`to_needs_review` 复制容器；`check_point` 先取整再校验；`Mapping` 改从 `collections.abc` 导入；黄金测试钉住规则集；补了 `test_evaluate_total.py`、`test_no_cloud_imports.py`。

**交给计划 2／3 的事项**（评审时留下的）：
- `hash_ic` 的 `pepper` 必须来自服务端配置（Secret Manager）；`ValueError`（不是 12 位数字）要当作“读不出身份证”处理，不要把缺失的身份证哈希成常量。
- `parse_polygon` 有最小面积、没有最大面积：超大多边形会让 `evaluate_plot` 抛 `ValueError`。计划 2 要么在 `parse_polygon` 加上限（`geometry_invalid`），要么把这个 `ValueError` 映射成 422。
- `PATCH /api/documents/{id}/fields`：拒绝非正的面积和格式不对的日期（用户确认成 0 也会让 `low_confidence` 行清不掉）。
- `evaluate_plot` 的 `critical` 里的值必须是 `Mapping | None`；不是的话 `is_unconfirmed_low` 仍会抛 `AttributeError`（调用方自己组装的结构，不是文件读出值）。
- 流水线往规则行里追加 `evidence` 是安全的（`to_needs_review` 已复制容器）。
- 缺文件时的严重度不对称（缺地契 CC-01 = fail、CC-03 = needs_review、缺执照 CC-02 = warn）是 spec 的决定，需要和甲确认。
- 仍待办：任务 8（`pr.yaml` 改 pytest；根 `README.md` 里还有 `kebunsah-ai`、`dotnet test` 的旧说法）、任务 9（`schema.sql` 的 `rule_results.doc_type`，并在 PR #14／#23 里贴答复）。`api/README.md`、`ai-worker/README.md` 链接到未提交的 `docs/superpowers/specs/…`，合并前要把 `docs/superpowers/` 一并提交。
- 小项（可不修）：`is_unconfirmed_low` 对超大有限置信度（≥1e307）的判断与 5、1e300 不一致；黄金测试的参数化 id 对演示地块重名；`DOC_LABEL` 的 "Pajakan tanah" 与规则里的 "sewaan" 措辞不一致；`Evaluation.status` 默认值 "pending" 从不使用。
