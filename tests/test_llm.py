"""Provider transport contracts; no real credentials or paid API calls."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from promptscope.agent import llm_json
from scripts import start_deepseek
from promptscope.llm_settings import LLMSettings, SettingsInput
from promptscope.jobs import safe_error


class LLMTransportTests(unittest.TestCase):
    def call(self, base, content='{"ok":true}', finish="stop"):
        response = httpx.Response(200, json={"choices": [
            {"message": {"content": content}, "finish_reason": finish}]})
        env = {"PROMPTSCOPE_LLM_API_KEY": "test-only-key",
               "PROMPTSCOPE_LLM_MODEL": "test-model", "PROMPTSCOPE_LLM_BASE_URL": base}
        with patch.dict(os.environ, env), patch("promptscope.agent.httpx.post", return_value=response) as post:
            result = llm_json("Return JSON.", {"goal": "test"})
        return result, post.call_args

    def test_deepseek_transport_uses_max_tokens_and_non_thinking_json(self):
        result, call = self.call("https://api.deepseek.com/")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(call.args[0], "https://api.deepseek.com/chat/completions")
        body = call.kwargs["json"]
        self.assertEqual(body["max_tokens"], 1600)
        self.assertNotIn("max_completion_tokens", body)
        self.assertEqual(body["thinking"], {"type": "disabled"})
        self.assertEqual(body["response_format"], {"type": "json_object"})

    def test_other_provider_keeps_existing_contract(self):
        _, call = self.call("https://example.test/v1")
        self.assertEqual(call.kwargs["json"]["max_completion_tokens"], 1600)
        self.assertNotIn("thinking", call.kwargs["json"])

    def test_blank_or_truncated_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "empty JSON"):
            self.call("https://api.deepseek.com", "   ")
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.call("https://api.deepseek.com", '{"ok":', "length")

    def test_launcher_requires_key_then_uses_isolated_data(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ), patch.object(start_deepseek, "ROOT", Path(tmp)):
            example = Path(__file__).resolve().parents[1] / "deepseek.example.json"
            (Path(tmp) / "deepseek.example.json").write_bytes(example.read_bytes())
            with self.assertRaisesRegex(ValueError, "Fill api_key"):
                start_deepseek.configure()
            local = Path(tmp) / "deepseek.local.json"
            local.write_text(local.read_text().replace('"api_key": ""', '"api_key": "test-only-key"'))
            self.assertEqual(start_deepseek.configure(), 8766)
            self.assertEqual(os.environ["PROMPTSCOPE_DATA_DIR"], str(Path(tmp) / "data" / "api-test"))
            self.assertEqual(os.environ["PROMPTSCOPE_LLM_MODEL"], "deepseek-flash")

    def test_enabled_thinking_reaches_provider_and_redaction_uses_snapshot(self):
        response=httpx.Response(200,json={"choices":[{"message":{"content":'{"ok":true}'}}]})
        config={"base_url":"https://api.deepseek.com","api_key":"test-private-value","model":"deepseek-flash","thinking":"enabled","reasoning_effort":"max"}
        with patch("promptscope.agent.httpx.post",return_value=response) as post:
            llm_json("JSON",{},config)
        body=post.call_args.kwargs["json"]
        self.assertEqual(body["thinking"],{"type":"enabled"})
        self.assertEqual(body["reasoning_effort"],"max")
        self.assertEqual(body["max_tokens"],8192)
        self.assertNotIn(config["api_key"],safe_error(RuntimeError(config["api_key"]),config))

    def test_settings_roundtrip_and_no_key_reuse_across_destinations(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{},clear=True):
            service=LLMSettings(Path(tmp))
            body=SettingsInput(provider="deepseek",base_url="https://api.deepseek.com",model="deepseek-flash",api_key="private-test-key",thinking="disabled")
            public=service.save(body)
            self.assertTrue(public["api_key_set"])
            self.assertNotIn("private-test-key",str(public))
            body.api_key=""
            self.assertTrue(service.save(body)["api_key_set"])
            restarted=LLMSettings(Path(tmp))
            self.assertEqual(restarted.snapshot()["api_key"],"private-test-key")
            other=SettingsInput(provider="custom",base_url="https://another.example/v1",model="test")
            self.assertEqual(restarted.resolve(other)["api_key"],"")
            body.clear_key=True
            self.assertFalse(restarted.save(body)["configured"])

    def test_models_uses_requested_endpoint_without_saving_or_generating(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{},clear=True):
            service=LLMSettings(Path(tmp))
            body=SettingsInput(provider="custom",base_url="https://example.test/v1",api_key="private-test-key")
            response=httpx.Response(200,json={"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"}]})
            with patch("promptscope.llm_settings.httpx.get",return_value=response) as get:
                self.assertEqual(service.models(body),["model-a","model-b"])
            self.assertEqual(get.call_args.args[0],"https://example.test/v1/models")
            self.assertFalse(service.path.exists())


if __name__ == "__main__":
    unittest.main()
