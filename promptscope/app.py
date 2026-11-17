"""Local-only FastAPI application. Start with python -m promptscope."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError
from . import agent
from .analysis import compare, evaluate
from .detector import GroundingDetector
from .jobs import Jobs, safe_error
from .schemas import InferenceRequest, ImportRequest, PlanRequest, CompareRequest, EvaluationRequest
from .store import Store

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        total = 0

        async def limited():
            nonlocal total
            message = await receive()
            total += len(message.get("body", b""))
            if total > MAX_BYTES:
                raise HTTPException(413, "Request exceeds 12 MiB")
            return message
        await self.app(scope, limited, send)


def create_app(data_dir=None, detector=None):
    store = Store(data_dir or os.getenv("PROMPTSCOPE_DATA_DIR", ROOT / "data"))
    engine = detector or GroundingDetector()
    jobs = Jobs(store, engine)

    @asynccontextmanager
    async def lifespan(app):
        yield
        jobs.pool.shutdown(wait=True, cancel_futures=False)

    app = FastAPI(title="PromptScope", version="0.1.0", lifespan=lifespan)
    app.state.store, app.state.jobs = store, jobs
    app.add_middleware(BodyLimit)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def local_guard(request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("x-promptscope") != "1":
                return JSONResponse({"detail": "Missing local-client header"}, status_code=403)
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
                return JSONResponse({"detail": "Cross-origin writes are disabled"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
        return response

    def get(kind, identifier):
        try:
            return store.get(kind, identifier)
        except KeyError:
            raise HTTPException(404, f"{kind} not found")

    def add_image(raw, name):
        if len(raw) > 8 * 1024 * 1024:
            raise HTTPException(413, "Image exceeds 8 MiB")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValueError("Use JPEG, PNG or WebP")
                if image.width * image.height > 24_000_000:
                    raise ValueError("Image exceeds 24 megapixels")
                normalized = ImageOps.exif_transpose(image).convert("RGB")
                data = io.BytesIO()
                normalized.save(data, format="PNG")
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
            raise HTTPException(400, "Invalid image: " + str(exc))
        blob = data.getvalue()
        sha = hashlib.sha256(blob).hexdigest()
        existing = next((r for r in store.list("image") if r["sha256"] == sha), None)
        if existing:
            return existing
        record = store.put("image", {"name": Path(name).name[:120], "width": normalized.width,
                                    "height": normalized.height, "sha256": sha})
        (store.root / "images" / (record["id"] + ".png")).write_bytes(blob)
        return record

    @app.get("/api/status")
    def status():
        return {"version": "0.1.0", "detector": engine.status(), "llm_configured": agent.configured(),
                "llm_model": os.getenv("PROMPTSCOPE_LLM_MODEL") if agent.configured() else None}

    @app.get("/api/images")
    def images():
        return store.list("image")

    @app.post("/api/images")
    async def upload(request: Request):
        try:
            body = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise HTTPException(422, "Expected a valid JSON object")
        if not isinstance(body, dict) or not isinstance(body.get("data"), str):
            raise HTTPException(422, "Expected {name, data: base64}")
        try:
            raw = base64.b64decode(body["data"], validate=True)
        except ValueError:
            raise HTTPException(422, "Invalid base64 image")
        return add_image(raw, str(body.get("name", "image")))

    @app.get("/api/images/{image_id}/file")
    def image_file(image_id: str):
        get("image", image_id)
        return FileResponse(store.root / "images" / (image_id + ".png"), media_type="image/png")

    @app.post("/api/sample")
    def sample():
        image = add_image((ROOT / "web/assets/astronaut.png").read_bytes(), "NASA · astronaut.png")
        sample_file = ROOT / "examples/sample-runs.json"
        if sample_file.exists():
            for item in json.loads(sample_file.read_text(encoding="utf-8")):
                marker = "sample-v1-" + item["prompt"]
                if not store.cached(marker):
                    store.put("run", {**item, "image_id": image["id"], "image_sha256": image["sha256"], "cache_key": marker})
        return image

    @app.get("/api/runs")
    def runs(image_id: str | None = None):
        return [r for r in store.list("run") if image_id is None or r["image_id"] == image_id]

    @app.post("/api/runs/import")
    def import_run(body: ImportRequest):
        image = get("image", body.image_id)
        return store.put("run", {**body.model_dump(), "source": "imported", "elapsed_ms": None,
                                 "image_sha256": image["sha256"], "candidate_floor": None})

    @app.post("/api/jobs")
    def start_job(body: InferenceRequest):
        get("image", body.image_id)
        try:
            return jobs.submit(body.model_dump())
        except RuntimeError as exc:
            raise HTTPException(429, str(exc))

    @app.get("/api/jobs")
    def list_jobs():
        return store.list("job")[:100]

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str):
        return get("job", job_id)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        get("job", job_id)
        jobs.cancel(job_id)
        return {"message": "Cancellation requested; current model call will finish first."}

    @app.post("/api/compare")
    def compare_runs(body: CompareRequest):
        a, b = get("run", body.run_a), get("run", body.run_b)
        if a["image_id"] != b["image_id"]:
            raise HTTPException(422, "Only runs on the same image can be compared")
        return compare(a["detections"], b["detections"], body.threshold, body.iou_threshold)

    @app.post("/api/evaluate")
    def evaluate_run(body: EvaluationRequest):
        run = get("run", body.run_id)
        return evaluate(run["detections"], [g.model_dump() for g in body.ground_truth], body.label_map,
                        body.threshold, body.iou_threshold)

    @app.post("/api/agent/plan")
    def plan(body: PlanRequest):
        try:
            result = agent.make_plan(body.goal, body.target, body.mode)
            return store.put("plan", result)
        except (ValueError, RuntimeError, ValidationError) as exc:
            raise HTTPException(422, safe_error(exc))
        except Exception:
            raise HTTPException(502, "LLM connection failed. Check endpoint and connectivity; no experiment executed.")

    @app.post("/api/agent/execute/{plan_id}")
    def execute_plan(plan_id: str, body: InferenceRequest):
        plan = get("plan", plan_id)
        get("image", body.image_id)
        req = InferenceRequest(**{**body.model_dump(), "prompts": [x["prompt"] for x in plan["experiments"]]})
        try:
            return jobs.submit(req.model_dump(), plan)
        except RuntimeError as exc:
            raise HTTPException(429, str(exc))

    app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
    return app
