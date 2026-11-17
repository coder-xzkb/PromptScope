"""Lazy, inference-only Hugging Face backend with a single resident model."""
import gc
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HUB_CACHE", str(ROOT / "models"))
REVISIONS = json.loads((Path(__file__).with_name("model_revisions.json")).read_text())
FLOOR = 0.05


class GroundingDetector:
    def __init__(self):
        self.model = self.processor = None
        self.variant = None
        self.device = "not loaded"
        self.state = "idle"

    def status(self):
        return {"installed": all(importlib.util.find_spec(x) for x in ("torch", "transformers", "torchvision")),
                "loaded": self.variant, "device": self.device, "state": self.state,
                "models": {v: {"id": f"IDEA-Research/grounding-dino-{v}", "revision": r}
                           for v, r in REVISIONS.items()}, "candidate_floor": FLOOR}

    def load(self, variant, progress=lambda _: None):
        if self.variant == variant and self.model is not None:
            return
        if not self.status()["installed"]:
            raise RuntimeError("Model dependencies missing. Run: python -m pip install -r requirements-model.txt")
        import torch
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        self.model = self.processor = None
        self.variant = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self.device = os.environ.get("PROMPTSCOPE_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
        torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
        self.state = "loading"
        progress(f"Loading Grounding DINO {variant} on {self.device}; checking local weights.")
        kwargs = {"revision": REVISIONS[variant],
                  "cache_dir": str(ROOT / "models"), "local_files_only": os.getenv("PROMPTSCOPE_OFFLINE") == "1"}
        model_id = f"IDEA-Research/grounding-dino-{variant}"
        def cached_first(factory, **options):
            # Pinned snapshots need no network check once all required files exist.
            try:
                return factory.from_pretrained(model_id, **{**kwargs, "local_files_only": True}, **options)
            except OSError:
                if kwargs["local_files_only"]:
                    raise
                progress(f"Downloading missing official {variant} files; network access required.")
                return factory.from_pretrained(model_id, **kwargs, **options)
        try:
            self.processor = cached_first(AutoProcessor)
            self.model = cached_first(AutoModelForZeroShotObjectDetection,
                                      use_safetensors=True).to(self.device).eval()
            self.variant = variant
            self.state = "ready"
        except Exception:
            self.state = "error"
            self.model = self.processor = None
            raise

    def key(self, image_sha, prompt, variant, text_threshold):
        data = ["v1", image_sha, prompt, variant, REVISIONS[variant], text_threshold, FLOOR, "4.53.3"]
        return hashlib.sha256(json.dumps(data).encode()).hexdigest()

    def predict(self, image, prompt, variant, text_threshold, progress=lambda _: None):
        self.load(variant, progress)
        import torch
        start = time.perf_counter()
        # Reject truncation: a truncated experiment would not test its recorded prompt.
        ids = self.processor.tokenizer(prompt, add_special_tokens=True)["input_ids"]
        if len(ids) > self.model.config.max_text_len:
            raise ValueError("Prompt exceeds the model token limit; shorten it.")
        inputs = self.processor(images=image, text=prompt, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            outputs = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids, box_threshold=FLOOR, text_threshold=text_threshold,
            target_sizes=[image.size[::-1]])[0]
        width, height = image.size
        labels = result["text_labels"] if "text_labels" in result else result["labels"]
        detections = []
        for box, score, label in zip(result["boxes"].cpu().tolist(), result["scores"].cpu().tolist(), labels):
            coords = [max(0.0, min(1.0, value / scale)) for value, scale in zip(box, [width, height, width, height])]
            if coords[0] < coords[2] and coords[1] < coords[3]:
                detections.append({"label": str(label) or "(unresolved phrase)", "score": float(score), "box": coords})
        return {"detections": sorted(detections, key=lambda d: -d["score"]),
                "elapsed_ms": round((time.perf_counter()-start)*1000), "device": self.device,
                "revision": REVISIONS[variant], "candidate_floor": FLOOR,
                "transformers_version": "4.53.3", "torch_version": torch.__version__}
