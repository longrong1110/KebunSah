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
