"""评估流水线：确认文件到了 → Gemini 抽取 → 拼事实、跑规则 → 森林初筛 → 写说明 → 一次写回 assessments 与 plots.status。

降级：任何一步的异常只降级那一项（文件标 failed、该项 needs_review、森林 unknown、说明回退模板），流程继续。
整条流水线崩了才把评估标 failed、地块标 needs_review。每步一条结构化日志，进 Cloud Logging，也进评估文档的 steps[]。
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from kebunsah_core import RULES_VERSION
from kebunsah_core.evaluate import evaluate_plot
from kebunsah_core.rules import valid_area_ha

from app.deps import Deps

from .explain import TemplateExplainer
from .facts import build_facts
from .forest import ForestResult, UnavailableForest
from .gemini import WrongDocument

log = logging.getLogger("kebunsah.pipeline")

EXTRACT_WORKERS = 4
MYT = timezone(timedelta(hours=8))
PROGRESS_KEYS = ("read", "check", "forest", "actions")


def plot_area_ha(plot: dict) -> float | None:
    value = plot.get("areaHaComputed") if plot.get("geometryType") == "polygon" else plot.get("areaHaDeclared")
    return value if valid_area_ha(value) else None


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class _Run:
    """一次评估的日志与进度，每次变化都写回评估文档（前端不读，视频的"智能体日志"画面用）。"""

    def __init__(self, deps: Deps, path: str):
        self.deps, self.path = deps, path
        self.steps: list[dict[str, Any]] = []
        self.progress = {k: "pending" for k in PROGRESS_KEYS}

    def flush(self) -> None:
        self.deps.store.update(self.path, {"steps": list(self.steps), "progress": dict(self.progress)})

    def start(self, key: str) -> float:
        self.progress[key] = "running"
        self.flush()
        return time.monotonic()

    def finish(self, key: str, t0: float, status: str, detail: str, *, ms: int | None = None, **extra: Any) -> None:
        ms = int((time.monotonic() - t0) * 1000) if ms is None else ms
        self.progress[key] = "done" if status in {"ok", "degraded"} else "failed"
        self.steps.append({"step": key, "status": status, "at": _iso(self.deps.now()), "ms": ms, "detail": detail, **extra})
        log.info("assessment step", extra={"assessment": self.path, "step": key, "status": status, "ms": ms, "detail": detail})
        self.flush()


def _read_documents(deps: Deps, plot_id: str, run: _Run) -> list[tuple[str, dict]]:
    """确认每份文件到了，没读过的交给 Gemini。返回"存在"的文件（照片到了，或之前已经读出过字段）。"""
    t0 = run.start("read")
    store, blobs = deps.store, deps.blobs
    current = [(i, d) for i, d in store.list(f"plots/{plot_id}/documents") if d.get("isCurrent") is not False]
    stats = {"extracted": 0, "reused": 0, "failed": 0, "missing": 0, "needs_review": 0}
    models: set[str] = set()
    reasons: list[str] = []  # 失败原因（日志和 steps[] 里要看得到，不然只知道「失败了」）

    def process(item: tuple[str, dict]) -> str:
        doc_id, doc = item
        path = f"plots/{plot_id}/documents/{doc_id}"
        has_fields = bool(doc.get("fields"))
        on_disk = blobs.exists(doc["storagePath"]) if doc.get("storagePath") else False
        if not on_disk and not has_fields:
            return "missing"  # 登记了但照片没传上来：按没有这份文件处理
        if has_fields:
            return "reused"  # 已经读过（含用户确认过的），不重读
        store.update(path, {"extractionStatus": "uploaded"})
        store.update(path, {"extractionStatus": "extracting"})
        t_doc = time.monotonic()
        try:
            image = blobs.read_bytes(doc["storagePath"])
            result = deps.extractor.extract(doc["docType"], image, doc.get("mimeType") or "image/jpeg")
        except WrongDocument as exc:
            store.update(path, {"extractionStatus": "needs_review", "extractedAt": deps.now()})
            log.warning("wrong document %s: %s", doc_id, exc)
            reasons.append(f"{doc.get('docType')}: {exc}")
            return "needs_review"
        except Exception as exc:  # 抽取失败只影响这份文件
            store.update(path, {"extractionStatus": "failed", "extractedAt": deps.now()})
            log.warning("extraction failed for %s (%s): %s", doc_id, doc.get("docType"), exc)
            reasons.append(f"{doc.get('docType')}: {exc}")
            return "failed"
        for key, value in result.fields.items():  # 键含点：逐项局部更新，不改键名
            store.update_nested(path, ("fields", key), value)
        low = any(f["confidence"] < deps.params.confidence_min for f in result.fields.values())
        status = "needs_review" if (low or not result.fields) else "extracted"
        store.update(path, {"extractionStatus": status, "extractedAt": deps.now(), "modelVersion": result.model,
                            "sha256": hashlib.sha256(image).hexdigest()})
        models.add(result.model)
        log.info("extracted", extra={"document": doc_id, "docType": doc["docType"], "seconds": round(time.monotonic() - t_doc, 2),
                                     "usage": result.usage})
        return "extracted"

    with ThreadPoolExecutor(max_workers=EXTRACT_WORKERS) as pool:
        for outcome in pool.map(process, current):
            stats[outcome] += 1
    present = [(i, d) for i, d in store.list(f"plots/{plot_id}/documents")
               if d.get("isCurrent") is not False and (d.get("fields") or d.get("extractionStatus") in {"failed", "needs_review"})]
    degraded = stats["failed"] or stats["needs_review"]
    run.finish("read", t0, "degraded" if degraded else "ok",
               (", ".join(f"{k}={v}" for k, v in stats.items() if v) or "no documents")
               + (f" | first error: {reasons[0][:200]}" if reasons else ""), models=sorted(models))
    return present


def run_assessment(deps: Deps, plot_id: str, assessment_id: str) -> None:
    """后台任务入口。永远不向外抛：崩了就把评估标 failed、地块标 needs_review。"""
    path = f"plots/{plot_id}/assessments/{assessment_id}"
    run = _Run(deps, path)
    try:
        _run(deps, plot_id, path, run)
    except Exception as exc:
        log.exception("assessment crashed", extra={"assessment": path})
        try:
            now = deps.now()
            run.steps.append({"step": "pipeline", "status": "failed", "at": _iso(now), "ms": 0,
                              "detail": f"{type(exc).__name__}: {exc}"[:300]})
            deps.store.update(path, {"runStatus": "failed", "result": None, "finishedAt": now,
                                     "errorMessage": f"{type(exc).__name__}: {exc}"[:500],
                                     "steps": run.steps, "progress": run.progress})
            deps.store.update(f"plots/{plot_id}", {"status": "needs_review", "lastAssessedAt": now, "updatedAt": now})
        except Exception:
            log.exception("could not record the failure", extra={"assessment": path})


def _run(deps: Deps, plot_id: str, path: str, run: _Run) -> None:
    store = deps.store
    started = deps.now()
    store.update(path, {"runStatus": "running", "startedAt": started})
    run.flush()

    plot = store.get(f"plots/{plot_id}")
    if plot is None:
        raise LookupError("plot disappeared")
    operator = store.get(f"persons/{plot['operatorPersonId']}")
    if operator is None:
        raise LookupError("operator person record is missing")
    plot_ha = plot_area_ha(plot)
    if plot_ha is None:
        raise ValueError("plot has no usable area")
    ring = None
    if plot.get("polygonGeojson"):
        ring = json.loads(plot["polygonGeojson"])["coordinates"][0]

    # 森林初筛与抽取并行（它们互不依赖）
    with ThreadPoolExecutor(max_workers=1) as pool:
        def screen() -> tuple[ForestResult, str, int]:
            t = time.monotonic()
            try:
                result, note = deps.forest.screen(plot.get("centroidLat"), plot.get("centroidLng"), ring, plot_ha), "ok"
            except Exception as exc:
                log.warning("forest screening failed", extra={"error": str(exc)})
                result, note = UnavailableForest().screen(0, 0, None), f"degraded: {type(exc).__name__}: {exc}"[:200]
            return result, note, int((time.monotonic() - t) * 1000)

        forest_future = pool.submit(screen)
        docs = _read_documents(deps, plot_id, run)
        forest, forest_note, forest_ms = forest_future.result()

    t0 = run.start("check")
    as_of = deps.settings.assess_as_of or deps.now().astimezone(MYT).date().isoformat()
    built = build_facts(store, plot, operator["fullName"], docs, plot_ha=plot_ha, params=deps.params)
    evaluation = evaluate_plot(built.facts, built.critical, as_of=as_of, params=deps.params)
    for r in evaluation.results:
        r.evidence = built.evidence.get(f"CC-02:{r.doc_type}" if r.rule_code == "CC-02" else r.rule_code, [])
    status = evaluation.status
    run.finish("check", t0, "ok", f"{len(evaluation.results)} rules, {len(evaluation.gaps)} gaps, as_of={as_of}")

    run.progress["forest"] = "running"
    forest_ok = forest.risk != "unknown"
    if not forest_ok and status == "green":
        status = "needs_review"  # 森林没查成，不能当作没有毁林
    elif forest.risk in {"medium", "high"} and status in {"green", "yellow"}:
        status = "needs_review"  # 2020 年后有森林损失的迹象：交给人复核（红色保持红色）
    run.finish("forest", time.monotonic(), "ok" if forest_ok else "degraded",
               f"risk={forest.risk}, dataset={forest.dataset}" + ("" if forest_note == "ok" else f" ({forest_note})"),
               ms=forest_ms)

    t0 = run.start("actions")
    try:
        explanation = deps.explainer.explain(status, evaluation.results, evaluation.gaps)
    except Exception as exc:
        log.warning("explainer failed", extra={"error": str(exc)})
        explanation = TemplateExplainer().explain(status, evaluation.results, evaluation.gaps)
        explanation.fallback_reason = f"{type(exc).__name__}: {exc}"
    run.finish("actions", t0, "degraded" if explanation.fallback_reason else "ok",
               f"model={explanation.model}" + (f", fallback: {explanation.fallback_reason}" if explanation.fallback_reason else ""),
               usage=explanation.usage)

    finished = deps.now()
    models = sorted({s_model for s in run.steps for s_model in s.get("models", [])})
    store.update(path, {
        "runStatus": "done", "result": status, "finishedAt": finished,
        "forestRisk": forest.risk, "forestCover2020Pct": forest.cover_2020_pct,
        "forestLossAfter2020Ha": forest.loss_after_2020_ha, "forestDataset": forest.dataset,
        "ruleResults": [r.to_doc() for r in evaluation.results], "gaps": [g.to_doc() for g in explanation.gaps],
        "summaryText": explanation.summary_text, "summaryLang": explanation.summary_lang,
        "summaryModel": explanation.model,  # "template" = 没调模型的兜底文案；界面只在是 Gemini 写的时候才标「AI 说明」
        "errorMessage": None,
        "modelVersion": ",".join(models) or None, "rulesVersion": RULES_VERSION,
        "inputSnapshot": {"asOf": as_of, "plotHa": plot_ha,
                          "documents": [{"documentId": i, "docType": d.get("docType"), "extractionStatus": d.get("extractionStatus")}
                                        for i, d in docs]},
        "steps": run.steps, "progress": run.progress,
    })
    store.update(f"plots/{plot_id}", {"status": status, "lastAssessedAt": finished, "updatedAt": finished})
