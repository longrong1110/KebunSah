"""把 seed/data 灌进 Firestore，并按 users 里的 uid + 手机号在 Firebase Auth 里建账号。
给线上项目用（seed/load-emulator.mjs 故意只允许写本机模拟器）；也能对模拟器用，方便测这个脚本本身。

用法（仓库根目录；线上二选一：gcloud auth application-default login，或者加 --gcloud-token 直接用 gcloud auth login 的令牌）：
  线上：  python scripts/load_seed.py --project <项目ID> [--gcloud-token] [--yes]
  模拟器：FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \\
          python scripts/load_seed.py --project demo-kebunsah --emulator

安全：
- 灌的全是虚构的模拟数据（isSynthetic=true），但仍然是往线上写，所以不加 --yes 会先打印要写什么、让你敲 yes。
- 同 ID 的文档整篇覆盖，重跑不会重复；不会删任何文档，也不会动你自己新建的地块。
- 设了模拟器环境变量却没加 --emulator（或反过来）就拒绝，免得写错地方。
- demo- 开头的项目 ID 只能配 --emulator（它在线上不存在）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "seed" / "data"
ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
BATCH = 400  # Firestore 一批最多 500 个写入


def timestamp_fields() -> frozenset[str]:
    """与 seed/src/shape.mjs 的 TIMESTAMP_FIELDS 同一份（直接从那个文件读，不会两边漂移）"""
    text = (ROOT / "seed" / "src" / "shape.mjs").read_text(encoding="utf8")
    block = re.search(r"TIMESTAMP_FIELDS = new Set\(\[(.*?)\]\)", text, re.S)
    if not block:
        raise SystemExit("读不到 seed/src/shape.mjs 里的 TIMESTAMP_FIELDS")
    return frozenset(re.findall(r"'([A-Za-z]+)'", block[1]))


def convert(value, key: str, stamps: frozenset[str]):
    from datetime import datetime, timezone

    if isinstance(value, str) and key in stamps and ISO_TIMESTAMP.match(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    if isinstance(value, list):
        return [convert(v, key, stamps) for v in value]
    if isinstance(value, dict):
        return {k: convert(v, k, stamps) for k, v in value.items()}
    return value


def gcloud_token() -> str:
    """gcloud auth login 登录后的访问令牌（命令行里用 gcloud 的完整路径也行：先找 PATH，再找默认安装位置）"""
    import shutil
    import subprocess

    exe = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not exe:
        default = Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Cloud SDK" / "google-cloud-sdk" / "bin" / "gcloud.cmd"
        exe = str(default) if default.exists() else None
    if not exe:
        raise SystemExit("找不到 gcloud。先安装并 gcloud auth login。")
    out = subprocess.run([exe, "auth", "print-access-token"], capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit(f"拿不到令牌：{out.stderr.strip()[:300]} 先执行 gcloud auth login。")
    return out.stdout.strip()


def import_auth_users_rest(project: str, token: str, users: list[dict]) -> int:
    """用 REST 的 accounts:batchCreate 建账号（uid = users 文档 id，手机号 = phone）。已存在的跳过。返回失败个数。"""
    import httpx

    body = {"users": [{"localId": d["path"].split("/")[1], "phoneNumber": d["data"]["phone"]} for d in users]}
    res = httpx.post(
        f"https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts:batchCreate",
        headers={"Authorization": f"Bearer {token}", "x-goog-user-project": project}, json=body, timeout=30)
    if res.status_code != 200:
        print(f"  Auth：失败 HTTP {res.status_code} {res.text[:300]}")
        return len(users)
    errors = res.json().get("error", [])
    existing = [e for e in errors if "exist" in (e.get("message", "")).lower()]
    failed = [e for e in errors if e not in existing]
    print(f"  Auth：新建 {len(users) - len(errors)}，已存在 {len(existing)}，失败 {len(failed)}")
    for e in failed:
        print(f"    失败：{users[e.get('index', 0)]['path']} — {e.get('message')}")
    return len(failed)


def load_documents() -> list[dict]:
    docs: list[dict] = []
    for f in sorted(DATA.glob("*.json")):
        if f.name == "_manifest.json":
            continue
        docs.extend(json.loads(f.read_text(encoding="utf8")))
    return docs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="Firebase / GCP 项目 ID")
    parser.add_argument("--emulator", action="store_true", help="写本机模拟器（要设 FIRESTORE_EMULATOR_HOST）")
    parser.add_argument("--yes", action="store_true", help="不再问确认（线上）")
    parser.add_argument("--skip-auth", action="store_true", help="只灌 Firestore，不建 Auth 账号")
    parser.add_argument("--gcloud-token", action="store_true",
                        help="用 `gcloud auth print-access-token` 的令牌（不需要 application-default login；令牌约 1 小时有效）")
    args = parser.parse_args()

    emulator_env = bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))
    if args.emulator != emulator_env:
        print("拒绝：--emulator 和 FIRESTORE_EMULATOR_HOST 必须同时有或同时没有，免得写错地方。")
        return 2
    if args.project.startswith("demo-") and not args.emulator:
        print("拒绝：demo- 开头的项目只存在于模拟器里，线上写不进去。")
        return 2
    if not args.emulator and not args.skip_auth and os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        print("拒绝：设了 FIREBASE_AUTH_EMULATOR_HOST 但没加 --emulator。")
        return 2

    stamps = timestamp_fields()
    docs = load_documents()
    users = [d for d in docs if d["path"].startswith("users/") and d["data"].get("phone")]
    where = "本机模拟器" if args.emulator else "线上 Firestore（真的）"
    print(f"项目 {args.project} → {where}")
    print(f"  Firestore 文档 {len(docs)} 个（整篇覆盖同 ID 文档，不删任何东西）")
    print(f"  Auth 账号 {len(users)} 个：" + ", ".join(f"{d['path'].split('/')[1]}={d['data']['phone']}" for d in users))
    if not args.emulator and not args.yes and input("确认写入？输入 yes：").strip().lower() != "yes":
        print("已取消。")
        return 1

    from google.cloud import firestore

    token = gcloud_token() if args.gcloud_token else None
    if token:
        from google.oauth2.credentials import Credentials

        creds = Credentials(token=token, quota_project_id=args.project)
        db = firestore.Client(project=args.project, credentials=creds)
    else:
        db = firestore.Client(project=args.project)
    done = 0
    for i in range(0, len(docs), BATCH):
        batch = db.batch()
        for d in docs[i : i + BATCH]:
            batch.set(db.document(d["path"]), convert(d["data"], "", stamps))
        batch.commit()
        done += len(docs[i : i + BATCH])
        print(f"  已写入 {done} / {len(docs)}")

    expected: dict[str, int] = {}
    for d in docs:
        col = d["path"].split("/")[-2]
        expected[col] = expected.get(col, 0) + 1
    bad = 0
    for col, n in expected.items():
        got = sum(1 for _ in db.collection_group(col).select([]).stream())
        # 集合组计数含用户自己新建的文档，所以只要不少于种子的数量就算一致
        ok = got >= n
        bad += not ok
        print(f"  {'一致' if ok else '不一致'}  {col}: 种子 {n}，现有 {got}")

    if not args.skip_auth and token:
        bad += import_auth_users_rest(args.project, token, users)
    elif not args.skip_auth:
        import firebase_admin
        from firebase_admin import auth

        if not firebase_admin._apps:
            firebase_admin.initialize_app(options={"projectId": args.project})
        records = [auth.ImportUserRecord(uid=d["path"].split("/")[1], phone_number=d["data"]["phone"]) for d in users]
        result = auth.import_users(records)
        existing = [e for e in result.errors if "exist" in (e.reason or "").lower()]
        failed = [e for e in result.errors if e not in existing]
        print(f"  Auth：新建 {result.success_count}，已存在 {len(existing)}，失败 {len(failed)}")
        for e in failed:
            print(f"    失败：{records[e.index].uid} — {e.reason}")
        bad += len(failed)
    print("完成。" if not bad else "有不一致或失败，见上面。")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
