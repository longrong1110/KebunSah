"""一条命令起本地 API：python scripts/run_api.py
读仓库根的 .env（GEMINI_API_KEY、模拟器地址等），连本机 Firestore / Auth 模拟器，监听 127.0.0.1:8000。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ("core", "api", "ai-worker"):
    sys.path.insert(0, str(ROOT / sub))
os.chdir(ROOT)  # .env 和 BLOBS_DIR 都按仓库根解析

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("app.main:create_app_from_env", factory=True, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
