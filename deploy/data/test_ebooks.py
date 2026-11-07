import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from ebooks import ChapterText, Ebooks, catalog_from_tree, parse_epub, safe_member


def epub_fixture(first=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>')
        archive.writestr("OEBPS/book.opf", '<package><manifest><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="nav"/><itemref idref="two"/><itemref idref="one"/></spine></package>')
        archive.writestr("OEBPS/one.xhtml", first or '<html><head><title>First title</title><style>secretstyle</style></head><body><h1>First story</h1><script>secretscript</script><p>' + 'English word ' * 40 + '</p></body></html>')
        archive.writestr("OEBPS/two.xhtml", '<html><h1>Second story</h1><p>' + 'Different text ' * 40 + '</p></html>')
    return buffer.getvalue()


class EbooksTests(unittest.TestCase):
    def test_spine_order_nav_and_duplicate_filtering_without_active_html(self):
        chapters = parse_epub(epub_fixture())
        self.assertEqual([c["title"] for c in chapters], ["First story", "Second story"])
        self.assertNotIn("secretscript", chapters[0]["text"])
        self.assertNotIn("secretstyle", chapters[0]["text"])
        self.assertNotIn("<", chapters[0]["text"])
        self.assertEqual(chapters[0]["id"], parse_epub(epub_fixture())[0]["id"])

    def test_long_chapter_keeps_all_words_and_limits_each_part(self):
        text = 'Englishword ' * 6500
        chapters = parse_epub(epub_fixture('<html><h1>Long text</h1><p>' + text + '</p></html>'))
        self.assertTrue(all(len(c["text"]) <= 30000 for c in chapters))
        self.assertEqual(sum(c["text"].count('Englishword') for c in chapters), 6500)

    def test_invalid_zip_and_path_escape_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_epub(b'not a zip')
        for path in ('../../outside.xhtml', 'https://example.com/file', '/etc/passwd', '%2e%2e/%2e%2e/outside'):
            with self.assertRaises(ValueError):
                safe_member('OEBPS', path)
        self.assertEqual(safe_member('OEBPS','Text/one.xhtml#x'), 'OEBPS/Text/one.xhtml')

    def test_seed_has_four_publications_and_downloads_are_pinned_to_commit(self):
        seed = json.loads(Path(__file__).with_name('ebook-catalog.seed.json').read_text())
        catalog = catalog_from_tree(seed)
        self.assertEqual(len({i['publication'] for i in catalog['issues']}),4)
        self.assertEqual(len(catalog['issues']),162)
        self.assertTrue(all(len({f['format'] for f in i['files']}) == len(i['files']) for i in catalog['issues']))
        for issue in catalog['issues']:
            for file in issue['files']:
                self.assertIn('/' + catalog['revision'] + '/',file['url'])
                self.assertTrue(file['url'].startswith('https://raw.githubusercontent.com/giftgoy/awesome-english-ebooks/'))
        with self.assertRaises(ValueError):
            catalog_from_tree({**seed,'truncated':True})

    def test_cached_issue_survives_service_recreation(self):
        with tempfile.TemporaryDirectory() as folder:
            service = Ebooks(folder)
            issue = service.catalog['issues'][0]
            service.write(service.cache_path(issue),parse_epub(epub_fixture()))
            restored = Ebooks(folder)
            status = restored.status(issue)
            self.assertEqual(status['status'],'ready')
            self.assertEqual(len(status['chapters']),2)
            self.assertNotIn('text',status['chapters'][0])


if __name__ == '__main__':
    unittest.main()
