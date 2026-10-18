from __future__ import annotations

import hmac
import json
import os
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from starlette.responses import JSONResponse

from acoustic import AcousticEngine, InvalidAudio, MAX_FILE_BYTES, MODEL_ID, MODEL_REVISION

engine = AcousticEngine()
app = FastAPI(title="Heartbeat acoustic analysis", version="0.1.0", docs_url=None, redoc_url=None)


class RequestTooLarge(HTTPException):
    def __init__(self):
        super().__init__(status_code=413, detail="Request exceeds 12 MiB audio limit.")


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        size = 0
        limit = MAX_FILE_BYTES + 128 * 1024
        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length")
        if raw_length:
            try:
                if int(raw_length) > limit:
                    await JSONResponse({"detail": "Request exceeds 12 MiB audio limit."}, status_code=413)(scope, receive, send)
                    return
            except ValueError:
                await JSONResponse({"detail": "Invalid content length."}, status_code=400)(scope, receive, send)
                return

        async def limited_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > limit:
                raise RequestTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestTooLarge:
            await JSONResponse({"detail": "Request exceeds 12 MiB audio limit."}, status_code=413)(scope, receive, send)


app.add_middleware(BodyLimitMiddleware)


def authorize(authorization: str | None) -> None:
    expected = os.environ.get("ACOUSTIC_API_KEY", "")
    if expected and not hmac.compare_digest(authorization or "", f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="Invalid service credentials.")


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": engine.loaded, "model": {"id": MODEL_ID, "revision": MODEL_REVISION}}


@app.post("/analyze")
def analyze(
    file: Annotated[UploadFile, File()],
    caller_channel: Annotated[int | None, Form()] = None,
    speaker_segments: Annotated[str, Form()] = "[]",
    authorization: Annotated[str | None, Header()] = None,
):
    authorize(authorization)
    if len(speaker_segments) > 64 * 1024:
        raise HTTPException(status_code=400, detail="speaker_segments is too large.")
    try:
        segments = json.loads(speaker_segments)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="speaker_segments must be a JSON array.") from exc
    if not isinstance(segments, list) or len(segments) > 1000 or not all(isinstance(item, dict) for item in segments):
        raise HTTPException(status_code=400, detail="speaker_segments must contain at most 1000 objects.")
    data = file.file.read(MAX_FILE_BYTES + 1)
    try:
        return engine.analyze(data, caller_channel, segments)
    except InvalidAudio as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8019)
    parser.add_argument("--warmup", action="store_true", help="Download pinned weights and load the model before serving.")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.environ.get("ACOUSTIC_API_KEY"):
        parser.error("ACOUSTIC_API_KEY is required when binding a non-loopback interface.")
    if args.warmup:
        engine.load()
    uvicorn.run(app, host=args.host, port=args.port, access_log=False)
