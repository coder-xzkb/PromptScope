"""Explicit official-model download. Does not run inference or training."""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from promptscope.detector import GroundingDetector

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["tiny", "base"], default="tiny")
    args = parser.parse_args()
    GroundingDetector().load(args.model, lambda m: print(m, flush=True))
    print("Official weights cached. Set PROMPTSCOPE_OFFLINE=1 for offline use.")
