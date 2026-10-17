"""统一错误格式：{"error": {"code": "snake_case", "message": "英文一句话"}}。message 前端不显示，界面文案按 code 生成。"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, extra: dict[str, Any] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra or {}

    def body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message}, **self.extra}


def not_found(code: str, message: str) -> ApiError:
    return ApiError(404, code, message)


def forbidden(message: str = "not allowed to access this resource") -> ApiError:
    return ApiError(403, "forbidden", message)


def unprocessable(code: str, message: str) -> ApiError:
    return ApiError(422, code, message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.body())

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        return JSONResponse(status_code=422, content={"error": {
            "code": "invalid_request", "message": f"invalid request: {where or 'body'} {first.get('msg', '')}".strip()}})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": code, "message": str(exc.detail)}})
