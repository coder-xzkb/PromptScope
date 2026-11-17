"""Download official weights and record a real, reproducible sample experiment."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from promptscope.detector import GroundingDetector, ROOT

detector = GroundingDetector()
image = Image.open(ROOT / "web/assets/astronaut.png").convert("RGB")
runs = []
for prompt in ("person. helmet.", "astronaut. helmet."):
    result = detector.predict(image, prompt, "tiny", 0.25, lambda m: print(m, flush=True))
    runs.append({**result, "prompt": prompt, "model": "tiny", "text_threshold": 0.25,
                 "source": "recorded_inference"})
    print(prompt, result["elapsed_ms"], "ms", len(result["detections"]), "candidates", flush=True)
(ROOT / "examples/sample-runs.json").write_text(json.dumps(runs, indent=2), encoding="utf-8")
print("Saved genuine model outputs to examples/sample-runs.json", flush=True)
