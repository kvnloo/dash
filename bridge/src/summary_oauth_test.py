"""Transport contract tests; no credentials, network or Hermes install needed."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

spec = importlib.util.spec_from_file_location("summary_oauth", Path(__file__).with_name("summary-oauth.py"))
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Stream:
    def __init__(self, events):
        self.events = events
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def __iter__(self):
        return iter(self.events)


class Client:
    base_url = "https://chatgpt.com/backend-api/codex"

    def __init__(self, response_model="gpt-6-luna", item_type="message"):
        self.calls = []
        self.closed = False
        self.responses = self
        self.stream = Stream([
            NS(type="response.output_item.done", item=NS(type=item_type, content=[NS(type="output_text", text="Planned a demo fix.")])),
            NS(type="response.completed", response=NS(model=response_model)),
        ])

    def with_options(self, **kwargs):
        self.options = kwargs
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.stream

    def close(self):
        self.closed = True


class TransportTests(unittest.TestCase):
    request = {"model": "openai-codex/gpt-6-luna", "prompt": "Synthetic demo only"}

    def resolver(self, client, resolved="gpt-6-luna"):
        def resolve(provider, **kwargs):
            self.assertEqual(provider, "openai-codex")
            self.assertEqual(kwargs, {"model": "gpt-6-luna", "raw_codex": True})
            return client, resolved
        return resolve

    def test_exact_provider_model_no_tools_no_retry_no_store(self):
        client = Client()
        self.assertEqual(module.complete(self.request, self.resolver(client)), {"ok": True, "model": self.request["model"], "text": "Planned a demo fix."})
        self.assertEqual(client.options, {"max_retries": 0, "timeout": 12})
        self.assertEqual(len(client.calls), 1)
        body = client.calls[0]
        self.assertEqual(body["model"], "gpt-6-luna")
        self.assertEqual(body["tools"], [])
        self.assertEqual(body["tool_choice"], "none")
        self.assertFalse(body["store"])
        self.assertTrue(client.closed)
        self.assertTrue(client.stream.closed)

    def test_missing_credentials_fails_closed(self):
        with self.assertRaisesRegex(module.SummaryError, "credential_unavailable"):
            module.complete(self.request, self.resolver(None))

    def test_model_mismatch_rejected(self):
        client = Client(response_model="other-model")
        with self.assertRaisesRegex(module.SummaryError, "model_mismatch"):
            module.complete(self.request, self.resolver(client))
        self.assertTrue(client.closed)

    def test_resolver_substitution_rejected_before_upload(self):
        client = Client()
        with self.assertRaisesRegex(module.SummaryError, "transport_unavailable"):
            module.complete(self.request, self.resolver(client, "other-model"))
        self.assertEqual(client.calls, [])

    def test_nonofficial_endpoint_rejected_before_upload(self):
        client = Client()
        client.base_url = "https://other-provider.invalid/v1"
        with self.assertRaisesRegex(module.SummaryError, "transport_unavailable"):
            module.complete(self.request, self.resolver(client))
        self.assertEqual(client.calls, [])

    def test_unexpected_tool_output_is_not_executed(self):
        client = Client(item_type="function_call")
        with self.assertRaisesRegex(module.SummaryError, "invalid_response"):
            module.complete(self.request, self.resolver(client))
        self.assertTrue(client.stream.closed)

    def test_other_provider_rejected_without_resolution(self):
        with self.assertRaisesRegex(module.SummaryError, "transport_unavailable"):
            module.complete({**self.request, "model": "anthropic/claude-haiku"}, lambda *a, **kw: self.fail("wrong provider"))


if __name__ == "__main__":
    unittest.main()
