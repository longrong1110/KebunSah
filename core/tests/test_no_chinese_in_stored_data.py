"""写进 Firestore 的数据里不能有中文：种子数据整体扫一遍（界面和数据库内容一律马来语／英语）。"""
import json
import re
from pathlib import Path

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]")
SEED = Path(__file__).resolve().parents[2] / "seed" / "data"


def _strings(value, path=""):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v, f"{path}[]")


def test_seed_data_has_no_chinese():
    offenders = []
    for f in sorted(SEED.glob("*.json")):
        if f.name == "_manifest.json":  # 说明文件，不会写进 Firestore
            continue
        for row in json.loads(f.read_text(encoding="utf8")):
            for field, text in _strings(row.get("data", row)):
                if CJK.search(text):
                    offenders.append(f"{row.get('path')} :: {field} :: {text[:40]}")
    assert not offenders, "种子数据里有中文：\n" + "\n".join(offenders[:10])
