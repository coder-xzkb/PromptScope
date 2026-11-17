import argparse
import uvicorn
from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="PromptScope local visual experiment workbench")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(f"PromptScope: http://127.0.0.1:{args.port} · Ctrl+C to stop", flush=True)
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
