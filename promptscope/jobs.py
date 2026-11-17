"""One inference worker, bounded queue, durable status and cooperative cancellation."""
import threading
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from .analysis import compare
from . import agent


class Jobs:
    def __init__(self, store, detector, settings=None):
        self.store, self.detector = store, detector
        self.settings = settings
        self.llm_configs = {}
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="promptscope")
        self.slots = threading.BoundedSemaphore(3)
        self.cancelled = set()
        self.lock = threading.Lock()
        for job in store.list("job"):
            if job["status"] in ("queued", "running"):
                store.put("job", {**job, "status": "interrupted", "message": "Server restarted; completed runs are preserved."})

    def update(self, job_id, **changes):
        with self.lock:
            job = self.store.get("job", job_id)
            return self.store.put("job", {**job, **changes})

    def submit(self, request, plan=None):
        if not self.slots.acquire(blocking=False):
            raise RuntimeError("Queue is full (3 jobs). Wait for a job to finish.")
        job = self.store.put("job", {"status": "queued", "message": "Waiting for inference worker", "run_ids": [],
                                    "request": request, "plan": plan, "events": [], "completed": 0})
        self.llm_configs[job["id"]] = self.settings.snapshot() if self.settings else None
        self.pool.submit(self.run, job["id"])
        return job

    def event(self, job_id, stage, message):
        with self.lock:
            job = self.store.get("job", job_id)
            job["events"].append({"stage": stage, "message": message})
            self.store.put("job", {**job, "message": message})

    def cancel(self, job_id):
        self.store.get("job", job_id)
        with self.lock:
            self.cancelled.add(job_id)

    def run(self, job_id):
        config = self.llm_configs.get(job_id)
        try:
            job = self.update(job_id, status="running")
            req, runs = job["request"], []
            image_meta = self.store.get("image", req["image_id"])
            with Image.open(self.store.root / "images" / (req["image_id"] + ".png")) as img:
                image = img.convert("RGB")
            for index, prompt in enumerate(req["prompts"]):
                if job_id in self.cancelled:
                    self.update(job_id, status="cancelled", message="Cancelled between experiments.")
                    return
                self.event(job_id, "detect", f"{index+1}/{len(req['prompts'])} · {prompt}")
                key = self.detector.key(image_meta["sha256"], prompt, req["model"], req["text_threshold"])
                run = self.store.cached(key)
                if run:
                    self.event(job_id, "cache", "Reused identical image, prompt, model revision and parameters.")
                    # Same pixels may have been uploaded under another image id.
                    if run["image_id"] != req["image_id"]:
                        run = self.store.put("run", {k: v for k, v in {**run, "image_id": req["image_id"],
                                                  "cached_from": run["id"]}.items() if k not in ("id", "created_at")})
                else:
                    result = self.detector.predict(image, prompt, req["model"], req["text_threshold"],
                                                   lambda m: self.event(job_id, "model", m))
                    run = self.store.put("run", {**result, "image_id": req["image_id"], "prompt": prompt,
                        "model": req["model"], "text_threshold": req["text_threshold"], "cache_key": key,
                        "source": "inference", "image_sha256": image_meta["sha256"]})
                runs.append(run)
                self.update(job_id, run_ids=[r["id"] for r in runs], completed=len(runs))
            comparisons = [{"baseline": runs[0]["id"], "variant": r["id"],
                            **compare(runs[0]["detections"], r["detections"])} for r in runs[1:]]
            self.event(job_id, "compare", "Compared every variant to the first prompt at score ≥ 0.25 / IoU ≥ 0.50.")
            report = {"comparisons": comparisons, "summary": "未提供真值标注。空间匹配、模型分数和检测数量不等于准确率。",
                      "next_step": "复查新增与消失的框；需要评价准确性时，导入标注并检查类别映射。", "source": "deterministic"}
            if job["plan"] and job["plan"]["mode"] == "llm" and job_id not in self.cancelled:
                self.event(job_id, "analyze", "Sending prompts and structured results to the configured LLM; image stays local.")
                try:
                    report.update(agent.summarize(job["plan"], runs, comparisons, config))
                    report["source"] = "llm"
                    if config:
                        report["llm_model"] = config["model"]
                except Exception as exc:
                    report["llm_error"] = safe_error(exc, config)
            self.update(job_id, status="complete", message="Experiment complete; results saved locally.", report=report)
            self.event(job_id, "report", "Saved reproducible experiment report.")
        except Exception as exc:
            self.update(job_id, status="failed", message=safe_error(exc, config))
        finally:
            with self.lock:
                self.cancelled.discard(job_id)
                self.llm_configs.pop(job_id, None)
            self.slots.release()


def safe_error(exc, config=None):
    message = str(exc)[:1600]
    # Provider keys must not enter browser state or saved reports.
    import os
    key = os.getenv("PROMPTSCOPE_LLM_API_KEY")
    if key:
        message = message.replace(key, "[redacted]")
    if config and config.get("api_key"):
        message = message.replace(config["api_key"], "[redacted]")
    return f"{type(exc).__name__}: {message}"
