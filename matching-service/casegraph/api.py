"""Loopback-only FastAPI interface for local semantic complaint candidates."""

from __future__ import annotations

from contextlib import asynccontextmanager
import hmac
import os
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from inference import (
    MAX_COMPLAINTS,
    MAX_ID_LENGTH,
    MAX_REQUEST_BYTES,
    MAX_TEXT_LENGTH,
    MODEL_ID,
    SCORE_SEMANTICS,
    InputValidationError,
    LocalSemanticMatcher,
    ModelUnavailableError,
    load_local_matcher,
)


class ComplaintInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    original_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)

    @field_validator("id", "original_text")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class MatchesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    complaints: list[ComplaintInput] = Field(min_length=2, max_length=MAX_COMPLAINTS)
    threshold: float = Field(ge=-1.0, le=1.0)


class HealthResponse(BaseModel):
    status: Literal["running"] = "running"
    model_ready: bool
    model_id: str = MODEL_ID


class MatchPairResponse(BaseModel):
    pair_id: str
    complaint_a_id: str
    complaint_b_id: str
    similarity: float


class MatchesResponse(BaseModel):
    model_id: str
    score_type: Literal["cosine_similarity"] = "cosine_similarity"
    score_semantics: str = SCORE_SEMANTICS
    threshold: float
    matches: list[MatchPairResponse]


class RequestBodyLimitMiddleware:
    """Bound buffered JSON requests even when a client omits Content-Length."""

    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or scope.get("method") != "POST" or scope.get("path") != "/api/v1/matches":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > self.max_bytes:
                body = b'{"detail":"Request body exceeds the local service limit."}'
                await send({"type": "http.response.start", "status": 413, "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ]})
                await send({"type": "http.response.body", "body": body})
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        delivered = False

        async def replay_body() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, replay_body, send)


def create_app(
    *,
    matcher: Any | None = None,
    matcher_loader: Any = load_local_matcher,
) -> FastAPI:
    initial_matcher = matcher

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if application.state.matcher is None:
            try:
                application.state.matcher = matcher_loader()
            except ModelUnavailableError:
                # Health remains available so callers can distinguish a running service
                # from a process whose local model cache is not ready.
                application.state.matcher = None
        yield

    application = FastAPI(
        title="CaseGraph Local Matching Service",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    application.state.matcher = initial_matcher

    application.add_middleware(RequestBodyLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)

    @application.exception_handler(RequestValidationError)
    async def request_validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        # Do not echo request content, which can include complaint text, in validation errors.
        return JSONResponse(status_code=422, content={"detail": "Invalid match request."})

    @application.get("/health", response_model=HealthResponse)
    def health(request: Request) -> HealthResponse:
        return HealthResponse(model_ready=request.app.state.matcher is not None)

    @application.post("/api/v1/matches", response_model=MatchesResponse)
    def matches(payload: MatchesRequest, request: Request) -> MatchesResponse:
        configured_key = os.environ.get("CASEGRAPH_API_KEY", "")
        supplied = request.headers.get("authorization", "")
        bearer = supplied[7:].strip() if supplied.lower().startswith("bearer ") else ""
        if not configured_key or not bearer or not hmac.compare_digest(bearer, configured_key):
            raise HTTPException(status_code=401, detail="Authentication required.")
        local_matcher: LocalSemanticMatcher | None = request.app.state.matcher
        if local_matcher is None:
            raise HTTPException(status_code=503, detail="Local matching model is not ready.")
        try:
            results = local_matcher.match(
                [item.model_dump() for item in payload.complaints],
                threshold=payload.threshold,
            )
        except InputValidationError:
            raise HTTPException(status_code=422, detail="Invalid match request.") from None
        except Exception:
            # Do not expose exception details or complaint text to clients or logs.
            raise HTTPException(status_code=500, detail="Local inference failed.") from None
        return MatchesResponse(
            model_id=local_matcher.model_id,
            threshold=payload.threshold,
            matches=[MatchPairResponse(**result.__dict__) for result in results],
        )

    return application


app = create_app()
