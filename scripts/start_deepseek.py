"""Load local DeepSeek settings and start an isolated API-test workbench."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def configure():
    config_path = ROOT / "deepseek.local.json"
    if not config_path.exists():
        config_path.write_bytes((ROOT / "deepseek.example.json").read_bytes())
    try:
        config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except (ValueError, OSError):
        raise ValueError("Cannot read deepseek.local.json. Keep valid JSON with double quotes.") from None
    if not isinstance(config, dict):
        raise ValueError("deepseek.local.json must contain a JSON object.")
    key = config.get("api_key", "")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("Fill api_key in deepseek.local.json, save it, then restart this launcher.")
    if config.get("base_url") != "https://api.deepseek.com":
        raise ValueError("This launcher requires the official https://api.deepseek.com endpoint.")
    if not isinstance(config.get("model"), str) or not config["model"].strip():
        raise ValueError("Set model in deepseek.local.json (default: deepseek-flash).")
    port = config.get("port", 8766)
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("port must be an integer between 1024 and 65535.")
    os.environ["PROMPTSCOPE_LLM_API_KEY"] = key.strip()
    os.environ["PROMPTSCOPE_LLM_BASE_URL"] = config["base_url"]
    os.environ["PROMPTSCOPE_LLM_MODEL"] = config["model"].strip()
    os.environ["PROMPTSCOPE_DATA_DIR"] = str(ROOT / "data" / "api-test")
    return port


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate settings without any network call")
    args = parser.parse_args()
    try:
        port = configure()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.check:
        print("Local settings valid. API key is not displayed. No API request was made.")
        return 0
    import uvicorn
    from promptscope.app import create_app
    print(f"PromptScope + DeepSeek: http://127.0.0.1:{port}", flush=True)
    print("Open Agent assistant and select LLM Agent. Keep this window open.", flush=True)
    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
