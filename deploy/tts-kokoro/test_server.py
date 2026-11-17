import unittest
from unittest.mock import Mock, patch

import numpy as np
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import server


class FakeAudio:
    def __init__(self):
        self.samples = np.zeros(1600, dtype=np.float32)
        self.sample_rate = 24000


class FakeTts:
    def generate(self, text, sid=None, speed=None):
        return FakeAudio()


class KokoroApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = web.Application()
        app.add_routes(
            [
                web.get("/health", server.health),
                web.get("/voices", server.voices),
                web.get("/speak", server.speak),
            ]
        )
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_health_reports_kokoro_engine(self):
        response = await self.client.get("/health")
        self.assertEqual(response.status, 200)
        body = await response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["engine"], "kokoro")

    async def test_voices_lists_english_and_chinese(self):
        response = await self.client.get("/voices")
        self.assertEqual(response.status, 200)
        voices = await response.json()
        self.assertEqual(
            [v["id"] for v in voices],
            ["af_maple", "af_sol", "bf_vale", "zf_001", "zm_009"],
        )
        self.assertEqual(voices[0]["lang"], "en-US")
        self.assertEqual(voices[0]["gender"], "female")
        zh = [v for v in voices if v["lang"] == "zh-CN"]
        self.assertEqual([v["id"] for v in zh], ["zf_001", "zm_009"])
        self.assertEqual(zh[0]["gender"], "female")

    async def test_rejects_invalid_requests_before_synthesis(self):
        server.cache.clear()
        with patch.object(server, "tts", FakeTts()):
            for params in [{}, {"text": "x" * 2001}, {"text": "hello", "voice": "unknown"}]:
                response = await self.client.get("/speak", params=params)
                self.assertEqual(response.status, 400)

    async def test_serves_voice_with_legacy_speaker_alias(self):
        server.cache.clear()
        mock_tts = Mock()
        mock_tts.generate.return_value = FakeAudio()
        with patch.object(server, "tts", mock_tts):
            response = await self.client.get("/speak", params={"text": "hello", "voice": "bf_vale"})
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "audio/wav")
            # 1600 samples * 2 bytes + 44 bytes WAV header
            self.assertEqual(len(await response.read()), 3244)
            mock_tts.generate.assert_called_once_with("hello", sid=2, speed=1.0)

            response = await self.client.get("/speak", params={"text": "hi", "speaker": "af_sol"})
            self.assertEqual(response.status, 200)
            mock_tts.generate.assert_called_with("hi", sid=1, speed=1.0)

    async def test_cache_hit_skips_synthesis(self):
        server.cache.clear()
        mock_tts = Mock()
        mock_tts.generate.return_value = FakeAudio()
        with patch.object(server, "tts", mock_tts):
            await self.client.get("/speak", params={"text": "hello"})
            response = await self.client.get("/speak", params={"text": "hello"})
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["X-Cache"], "hit")
            self.assertEqual(mock_tts.generate.call_count, 1)

    async def test_synthesis_failure_returns_gateway_error(self):
        server.cache.clear()

        class Broken(FakeTts):
            def generate(self, text, sid=None, speed=None):
                raise RuntimeError("model failure")

        with patch.object(server, "tts", Broken()), self.assertLogs(level="ERROR"):
            response = await self.client.get("/speak", params={"text": "hello"})
            self.assertEqual(response.status, 502)

    async def test_chinese_voices_accepted_in_speak(self):
        server.cache.clear()
        mock_tts = Mock()
        mock_tts.generate.return_value = FakeAudio()
        with patch.object(server, "tts", mock_tts):
            response = await self.client.get("/speak", params={"text": "你好", "voice": "zf_001"})
            self.assertEqual(response.status, 200)
            mock_tts.generate.assert_called_once_with("你好", sid=3, speed=1.0)

            response = await self.client.get("/speak", params={"text": "在", "voice": "zm_009"})
            self.assertEqual(response.status, 200)
            mock_tts.generate.assert_called_with("在", sid=58, speed=1.0)


if __name__ == "__main__":
    unittest.main()

