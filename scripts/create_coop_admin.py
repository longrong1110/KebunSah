"""给合作社看板（电脑登录）建一个演示管理员：邮箱＋密码。

做三件事（都走 REST，用你已登录的 gcloud 的令牌，不需要服务账号密钥）：
  1. 在 Firebase Authentication 开通「邮箱／密码」登录（已开就不动）；
  2. 建这个邮箱账号（已存在就改成这个密码）；
  3. 在 Firestore 写 users/{uid}：role=coop_admin、归演示合作社（和手机号管理员同一个合作社）。

用法（仓库根目录）：
  CLOUDSDK_PYTHON=<python 3.10+> python scripts/create_coop_admin.py --project kebunsah \
      --email koperasi@kebunsah.demo --password <密码>
演示账号，数据全是模拟的；密码写在 README 和登录页的「评委试用」里是有意的。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

import httpx

for _stream in (sys.stdout, sys.stderr):
    _stream.reconfigure(encoding="utf-8", errors="replace")

COOP_ID = "c0000000-0000-4000-8000-000000000001"  # 演示合作社（seed/data/cooperatives.json 的第一个）


def token() -> str:
    out = subprocess.run("gcloud auth print-access-token", shell=True, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--language", default="ms", choices=["ms", "en"])
    args = parser.parse_args()
    if args.project.startswith("demo-"):
        raise SystemExit("demo- 开头的是模拟器项目，这个脚本只给线上项目用")

    headers = {"Authorization": f"Bearer {token()}", "X-Goog-User-Project": args.project}
    client = httpx.Client(headers=headers, timeout=30)

    # 1. 开通邮箱／密码登录
    cfg_url = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{args.project}/config"
    cfg = client.get(cfg_url).raise_for_status().json()
    if not (cfg.get("signIn", {}).get("email", {}).get("enabled")):
        client.patch(cfg_url, params={"updateMask": "signIn.email"},
                     json={"signIn": {"email": {"enabled": True, "passwordRequired": True}}}).raise_for_status()
        print("• 已开通邮箱／密码登录")
    else:
        print("• 邮箱／密码登录本来就开着")

    # 2. 建账号（已存在：按邮箱找到，改密码）
    accounts = f"https://identitytoolkit.googleapis.com/v1/projects/{args.project}/accounts"
    created = client.post(accounts, json={"email": args.email, "password": args.password, "emailVerified": True,
                                          "displayName": "Pentadbir koperasi (demo)"})
    if created.status_code == 200:
        uid = created.json()["localId"]
        print("• 已建账号", uid)
    elif "EMAIL_EXISTS" in created.text:
        found = client.post(f"{accounts}:lookup", json={"email": [args.email]}).raise_for_status().json()
        uid = found["users"][0]["localId"]
        client.post(f"{accounts}:update", json={"localId": uid, "password": args.password, "emailVerified": True}).raise_for_status()
        print("• 账号已存在，已把密码改成给定的", uid)
    else:
        raise SystemExit(f"建账号失败：{created.status_code} {created.text[:300]}")

    # 3. users/{uid}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    doc = {"fields": {
        "email": {"stringValue": args.email}, "role": {"stringValue": "coop_admin"},
        "language": {"stringValue": args.language}, "personId": {"nullValue": None},
        "coopId": {"stringValue": COOP_ID}, "lastLoginAt": {"nullValue": None},
        "isSynthetic": {"booleanValue": True}, "createdAt": {"timestampValue": now}}}
    url = f"https://firestore.googleapis.com/v1/projects/{args.project}/databases/(default)/documents/users/{uid}"
    client.patch(url, content=json.dumps(doc)).raise_for_status()
    print("• 已写 users/" + uid)
    print("完成。电脑登录：/coop/login，邮箱", args.email)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
