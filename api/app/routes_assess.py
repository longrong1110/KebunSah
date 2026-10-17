"""POST /api/plots/{id}/assess：先写一条 queued 的评估，立刻回 202；流水线在响应之后的后台任务里跑。
前端靠订阅 Firestore 看进度，不轮询接口。将来换成 Cloud Tasks 只改 add_task 这一行。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends

from worker.pipeline import plot_area_ha, run_assessment

from .access import conflict, load_plot
from .auth import User, get_user
from .deps import Deps, get_deps
from .errors import unprocessable

router = APIRouter()


def _as_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _is_stale(assessment: dict, now: datetime, after_s: int) -> bool:
    """超过 after_s 秒没结束的 queued / running 当残留（Cloud Run 实例被回收后留下的）。时间读不出来也按残留处理。"""
    created = _as_datetime(assessment.get("createdAt"))
    return created is None or now - created > timedelta(seconds=after_s)


@router.post("/api/plots/{plot_id}/assess", status_code=202)
def assess(plot_id: str, background: BackgroundTasks, user: User = Depends(get_user), deps: Deps = Depends(get_deps)):
    plot = load_plot(deps.store, user, plot_id)
    if plot_area_ha(plot) is None:
        raise unprocessable("geometry_missing", "save the plot boundary (or a point with its area) before assessing")
    now = deps.now()
    base = f"plots/{plot_id}/assessments"
    for old_id, old in deps.store.list(base, [("runStatus", "in", ["queued", "running"])]):
        if _is_stale(old, now, deps.settings.stale_after_s):
            deps.store.update(f"{base}/{old_id}", {"runStatus": "failed", "finishedAt": now,
                                                   "errorMessage": "abandoned: did not finish in time"})
            continue
        raise conflict("assessment_in_progress", "this plot already has an assessment running", assessmentId=old_id)
    assessment_id = deps.new_id()
    deps.store.set(f"{base}/{assessment_id}", {
        "plotId": plot_id, "coopId": plot.get("coopId"), "runStatus": "queued", "result": None, "createdAt": now,
        "startedAt": None, "finishedAt": None, "ruleResults": [], "gaps": [], "forestRisk": None,
        "forestCover2020Pct": None, "forestLossAfter2020Ha": None, "forestDataset": None, "summaryText": None,
        "summaryLang": None, "errorMessage": None, "modelVersion": None, "rulesVersion": None, "inputSnapshot": None,
        "isSynthetic": False})
    background.add_task(run_assessment, deps, plot_id, assessment_id)
    return {"assessmentId": assessment_id}
