"""core 是纯 Python 的共用包，不能依赖任何云服务或 Web 框架（api/、ai-worker/ 才能 import 它们）。"""
import ast
from pathlib import Path

import kebunsah_core

FORBIDDEN = {"firebase_admin", "google", "firebase", "ee", "earthengine", "vertexai", "genai",
             "fastapi", "starlette", "uvicorn"}
MODULES = sorted(Path(kebunsah_core.__file__).parent.glob("*.py"))


def _top_level_imports(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf8"), filename=str(path))):
        if isinstance(node, ast.Import):
            found |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".")[0])
    return found


def test_the_package_has_modules_to_check():
    assert {p.name for p in MODULES} >= {"rules.py", "evaluate.py", "geo.py", "masking.py"}


def test_core_imports_no_cloud_service_or_web_framework():
    offenders = {p.name: sorted(_top_level_imports(p) & FORBIDDEN) for p in MODULES if _top_level_imports(p) & FORBIDDEN}
    assert offenders == {}
