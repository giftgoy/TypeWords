import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp.test_utils import TestClient, TestServer
import server
import test_validation as fixtures


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_contract_and_private_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(server, "CONFIG", Path(temp) / "reading.json"):
                client = TestClient(TestServer(server.app))
                await client.start_server()
                try:
                    response = await client.get('/settings')
                    self.assertFalse((await response.json())['configured'])
                    response = await client.post('/settings', json={"endpoint": server.DEFAULTS['endpoint'], "model": server.DEFAULTS['model'], "key": "test-only-secret"})
                    self.assertEqual(response.status, 200)
                    self.assertNotIn('key', await response.json())
                    response = await client.get('/settings')
                    self.assertNotIn('test-only-secret', await response.text())
                    response = await client.post('/settings', json={"endpoint": "https://other-provider.example/v1/chat/completions", "model": "other-model", "key": ""})
                    self.assertEqual(response.status, 422)
                    self.assertEqual(server.config()['endpoint'], server.DEFAULTS['endpoint'])
                    self.assertEqual(server.config()['key'], 'test-only-secret')
                    response = await client.post('/settings', json={"endpoint": server.DEFAULTS['endpoint'], "model": "another-model", "key": ""})
                    self.assertEqual(response.status, 200)
                    self.assertEqual(server.config()['key'], 'test-only-secret')
                    response = await client.post('/settings', json={"endpoint": "https://other-provider.example/v1/chat/completions", "model": "other-model", "key": "new-provider-secret"})
                    self.assertEqual(response.status, 200)
                    self.assertEqual(server.config()['key'], 'new-provider-secret')
                    response = await client.post('/generate', json={"words": "arrange"}, headers={"Origin": "https://unrelated.example"})
                    self.assertEqual(response.status, 403)
                    with patch.object(server, "model_json", AsyncMock(return_value=fixtures.ValidationTests().result())) as model:
                        response = await client.post('/generate', json={"words": "arrange"})
                        self.assertEqual(response.status, 200)
                        self.assertEqual((await response.json())['vocabulary'][0]['form'], 'arranged')
                        self.assertIn('B1-B2', model.call_args.args[0])
                        self.assertIn('120–180', model.call_args.args[0])
                        response = await client.post('/generate', json={"words": "opportunity"})
                        self.assertEqual(response.status, 422)
                finally:
                    await client.close()


if __name__ == '__main__':
    unittest.main()
