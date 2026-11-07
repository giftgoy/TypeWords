import tempfile
import unittest
from pathlib import Path
from aiohttp.test_utils import TestClient, TestServer
from server import create_app


class GrowthHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.client = TestClient(TestServer(create_app(Path(self.temp.name) / "test.sqlite3")))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_catalog_is_training_only_and_requests_have_clear_errors(self):
        response = await self.client.get("/growth/catalog")
        catalog = await response.json()
        self.assertEqual(len(catalog), 3)
        for pack in catalog:
            for word in pack["words"]:
                self.assertEqual(len(word["examples"]), 2)
                self.assertTrue(all(e["training"] for e in word["examples"]))
        bad = await self.client.post("/growth", json={"op": "create", "words": [[]] * 5})
        self.assertEqual(bad.status, 400)
        self.assertIn("error", await bad.json())
        invalid = await self.client.post("/growth/backup", json={"format": "wrong"})
        self.assertEqual(invalid.status, 400)
        self.assertEqual((await (await self.client.get("/growth")).json())["rounds"], [])

    async def test_cross_origin_cannot_write_growth_records(self):
        response = await self.client.post("/growth", json={"op": "create"}, headers={"Origin": "https://example.invalid"})
        self.assertEqual(response.status, 403)


if __name__ == "__main__":
    unittest.main()
