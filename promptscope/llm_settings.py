"""Server-only provider settings. Public responses never include API keys."""
import json
import os
import threading
from typing import Literal
from urllib.parse import urlparse

import httpx
from pydantic import Field, field_validator, model_validator
from .schemas import StrictModel


class SettingsInput(StrictModel):
    provider: Literal["deepseek", "openai", "custom"]
    provider_name: str = Field(default="", max_length=80)
    base_url: str = Field(min_length=1, max_length=500)
    model: str = Field(default="", max_length=160)
    api_key: str = Field(default="", max_length=8192, repr=False)
    thinking: Literal["default", "disabled", "enabled"] = "default"
    reasoning_effort: Literal["low", "medium", "high", "max"] = "high"
    clear_key: bool = False

    @field_validator("base_url")
    @classmethod
    def endpoint(cls, value):
        value = value.strip().rstrip("/")
        parsed = urlparse(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("接口地址必须是有效的基础 URL，不能包含账号、密码或查询参数。")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError("接口需要 HTTPS；本机服务可使用 localhost HTTP。")
        if parsed.path.endswith(("/chat/completions", "/models")):
            raise ValueError("请填写基础地址，不要附加 /chat/completions 或 /models。")
        return value

    @model_validator(mode="after")
    def provider_options(self):
        official = {"deepseek": "https://api.deepseek.com", "openai": "https://api.openai.com/v1"}
        if self.provider in official and self.base_url != official[self.provider]:
            raise ValueError("使用其他接口地址时，请选择「自定义兼容服务」。")
        if self.thinking == "enabled":
            allowed = ("low", "high", "max") if self.provider == "deepseek" else ("low", "medium", "high")
            if self.reasoning_effort not in allowed:
                raise ValueError("该运营商不支持所选思考强度。")
        return self


def environment_settings():
    base = os.getenv("PROMPTSCOPE_LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    provider = "deepseek" if urlparse(base).hostname == "api.deepseek.com" else "openai" if base == "https://api.openai.com/v1" else "custom"
    return {"provider": provider, "provider_name": {"deepseek":"DeepSeek","openai":"OpenAI","custom":"自定义服务"}[provider], "base_url": base, "model": os.getenv("PROMPTSCOPE_LLM_MODEL", ""),
            "api_key": os.getenv("PROMPTSCOPE_LLM_API_KEY", ""),
            "thinking": "disabled" if provider == "deepseek" else "default", "reasoning_effort": "high"}


class LLMSettings:
    def __init__(self, root):
        self.path = root / "llm-settings.json"
        self.lock = threading.RLock()
        self.value = environment_settings()
        if self.path.exists():
            try:
                self.value = SettingsInput.model_validate_json(self.path.read_text(encoding="utf-8")).model_dump(exclude={"clear_key"})
            except Exception:
                raise ValueError("本地 API 配置文件无效，请检查数据目录中的 llm-settings.json。") from None

    def snapshot(self):
        with self.lock:
            return dict(self.value)

    def public(self):
        value = self.snapshot()
        return {**{k: v for k, v in value.items() if k != "api_key"},
                "api_key_set": bool(value["api_key"]), "configured": bool(value["api_key"] and value["model"])}

    def resolve(self, body):
        previous = self.snapshot()
        value = body.model_dump(exclude={"clear_key"})
        same_destination = (value["provider"], value["base_url"]) == (previous["provider"], previous["base_url"])
        value["model"] = value["model"].strip()
        value["api_key"] = "" if body.clear_key else (value["api_key"].strip() or (previous["api_key"] if same_destination else ""))
        return value

    def save(self, body):
        with self.lock:
            value = self.resolve(body)
            if not value["model"]:
                raise ValueError("请选择或填写模型 ID。")
            temporary = self.path.with_suffix(".tmp")
            fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(value, file, ensure_ascii=False, indent=2)
            temporary.replace(self.path)
            self.value = value
            return self.public()

    def models(self, body):
        value = self.resolve(body)
        if not value["api_key"]:
            raise ValueError("请先填写这个运营商的 API Key。")
        try:
            response = httpx.get(value["base_url"] + "/models", timeout=20,
                                 headers={"Authorization": "Bearer " + value["api_key"]})
            if response.status_code != 200:
                raise ValueError(f"获取模型失败（HTTP {response.status_code}）。请检查地址、密钥和权限；也可直接填写模型 ID。")
            models = response.json()["data"]
            if not isinstance(models, list):
                raise ValueError("接口未返回标准模型列表，可直接填写模型 ID。")
            return sorted({item["id"] for item in models if isinstance(item, dict) and isinstance(item.get("id"), str) and len(item["id"]) <= 160})[:500]
        except ValueError:
            raise
        except Exception:
            raise ValueError("无法获取模型列表。检查网络和接口地址，或直接填写模型 ID。") from None
