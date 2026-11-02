import unittest
from unittest.mock import patch

from aiohttp import ClientError, web
from aiohttp.test_utils import TestClient, TestServer

import server


class SpeechApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = web.Application()
        app.add_routes([web.get("/voices", server.voices), web.get("/speak", server.speak)])
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_rejects_invalid_requests_before_synthesis(self):
        with patch.object(server.edge_tts, "Communicate") as synthesize:
            for params in [{}, {"text": "x" * 2001}, {"text": "hello", "voice": "unknown"}]:
                response = await self.client.get("/speak", params=params)
                self.assertEqual(response.status, 400)
            synthesize.assert_not_called()

    async def test_serves_selected_voice_and_cacheable_audio(self):
        class Speech:
            async def stream(self):
                yield {"type": "WordBoundary", "text": "hello"}
                yield {"type": "audio", "data": b"mp3-audio"}

        with patch.object(server.edge_tts, "Communicate", return_value=Speech()) as synthesize:
            response = await self.client.get("/speak", params={"text": "hello", "voice": "en-GB-RyanNeural"})
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), b"mp3-audio")
            self.assertEqual(response.content_type, "audio/mpeg")
            self.assertEqual(response.headers["Cache-Control"], "private, max-age=86400")
            synthesize.assert_called_once_with("hello", "en-GB-RyanNeural")

    async def test_upstream_failure_returns_gateway_error(self):
        class Speech:
            async def stream(self):
                raise ClientError("upstream unavailable")
                yield

        with patch.object(server.edge_tts, "Communicate", return_value=Speech()), self.assertLogs(level="ERROR"):
            response = await self.client.get("/speak", params={"text": "hello"})
            self.assertEqual(response.status, 502)


if __name__ == "__main__":
    unittest.main()
