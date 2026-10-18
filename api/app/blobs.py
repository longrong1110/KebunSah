"""证件照的存取适配器。线上是 GCS 的 V4 签名网址（浏览器直传，不经过 API）；本地是一个目录，由 API 的开发用路由收上传。"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Protocol


class Blobs(Protocol):
    def upload_url(self, path: str, content_type: str, expires_in: int = 900) -> str:
        """前端用 PUT + 同样的 Content-Type 往这个网址传。"""

    def read_url(self, path: str, expires_in: int = 900) -> str: ...

    def exists(self, path: str) -> bool: ...

    def read_bytes(self, path: str) -> bytes: ...

    def delete(self, path: str) -> None:
        """删除这个对象；本来就不存在也不报错。"""


class LocalBlobs:
    """开发用：文件放在本地目录里。对前端看起来和签名网址一样（PUT 到一个 URL）。"""

    def __init__(self, root: str | Path, public_base_url: str):
        self.root = Path(root).resolve()
        self.base = public_base_url.rstrip("/")

    def _resolve(self, path: str) -> Path:
        target = (self.root / path).resolve()
        if self.root != target and self.root not in target.parents:
            raise ValueError("path escapes the blob directory")
        return target

    def upload_url(self, path: str, content_type: str, expires_in: int = 900) -> str:
        self._resolve(path)
        return f"{self.base}/dev/blobs/{path}"

    def read_url(self, path: str, expires_in: int = 900) -> str:
        self._resolve(path)
        return f"{self.base}/dev/blobs/{path}"

    def exists(self, path: str) -> bool:
        return self._resolve(path).is_file()

    def read_bytes(self, path: str) -> bytes:
        return self._resolve(path).read_bytes()

    def delete(self, path: str) -> None:
        self._resolve(path).unlink(missing_ok=True)

    def write(self, path: str, data: bytes) -> None:
        target = self._resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


class GcsBlobs:
    """线上：Cloud Run 服务账号签名。要求这个服务账号对自己有 Service Account Token Creator 权限，bucket 要配 CORS（PUT）。"""

    def __init__(self, bucket: str):
        from google.cloud import storage

        self._client = storage.Client()
        self._bucket = self._client.bucket(bucket)

    def _signing_kwargs(self) -> dict:
        import google.auth
        import google.auth.transport.requests

        credentials, _ = google.auth.default()
        credentials.refresh(google.auth.transport.requests.Request())
        return {"service_account_email": credentials.service_account_email, "access_token": credentials.token}

    def upload_url(self, path: str, content_type: str, expires_in: int = 900) -> str:
        return self._bucket.blob(path).generate_signed_url(
            version="v4", expiration=timedelta(seconds=expires_in), method="PUT", content_type=content_type,
            **self._signing_kwargs())

    def read_url(self, path: str, expires_in: int = 900) -> str:
        return self._bucket.blob(path).generate_signed_url(
            version="v4", expiration=timedelta(seconds=expires_in), method="GET", **self._signing_kwargs())

    def exists(self, path: str) -> bool:
        return self._bucket.blob(path).exists()

    def read_bytes(self, path: str) -> bytes:
        return self._bucket.blob(path).download_as_bytes()

    def delete(self, path: str) -> None:
        from google.api_core.exceptions import NotFound

        try:
            self._bucket.blob(path).delete()
        except NotFound:
            pass
