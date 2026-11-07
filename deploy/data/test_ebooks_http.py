import tempfile
import unittest
from pathlib import Path
from aiohttp.test_utils import TestClient, TestServer
from server import create_app
from test_ebooks import epub_fixture
from ebooks import parse_epub


class EbookHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name) / 'test.sqlite3')
        self.service = self.app['ebooks']
        self.service.catalog['nextCheckAt'] = 9999999999999
        self.issue = self.service.catalog['issues'][0]
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_catalog_cached_read_and_chapter_are_isolated_from_learning_data(self):
        catalog = await (await self.client.get('/ebooks/catalog')).json()
        self.assertEqual(len(catalog['issues']),162)
        chapters = parse_epub(epub_fixture())
        self.service.write(self.service.cache_path(self.issue),chapters)
        route = '/ebooks/issues/' + self.issue['id']
        status = await (await self.client.post(route)).json()
        self.assertEqual(status['status'],'ready')
        self.assertNotIn('text',status['chapters'][0])
        response = await self.client.get(route + '/chapters/' + chapters[0]['id'])
        article = await response.json()
        self.assertEqual(article['text'],chapters[0]['text'])
        self.assertEqual(article['sourceIssueId'],self.issue['id'])
        snapshot = self.app['storage'].snapshot()
        self.assertEqual(snapshot['entries'],{})

    async def test_unknown_resources_and_cross_origin_download_are_rejected(self):
        self.assertEqual((await self.client.get('/ebooks/issues/unknown')).status,404)
        response = await self.client.post('/ebooks/issues/' + self.issue['id'],headers={'Origin':'https://example.invalid'})
        self.assertEqual(response.status,403)
        self.assertFalse(self.service.jobs)


if __name__ == '__main__':
    unittest.main()
