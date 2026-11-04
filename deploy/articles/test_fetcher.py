import tempfile
import unittest
from urllib.error import HTTPError
from unittest.mock import patch
import fetcher


class FeedTests(unittest.TestCase):
    def test_retry_keeps_valid_translation_when_provider_is_unavailable(self):
        article = {"title": "Title", "text": "First.\n\nLast.", "titleTranslate": "标题", "textTranslate": "已翻译的首段\n\n[本段翻译暂不可用]", "translationVersion": 2}
        with patch.object(fetcher, 'translate', side_effect=['', '[本段翻译暂不可用]\n\n[本段翻译暂不可用]']):
            fetcher.enrich([article], 'wikinews')
        self.assertEqual(article['titleTranslate'], '标题')
        self.assertEqual(article['textTranslate'], '已翻译的首段\n\n[本段翻译暂不可用]')
        self.assertTrue(article['translationIncomplete'])

    def test_rate_limit_stops_following_translation_requests(self):
        with patch.object(fetcher, 'translation_retry_after', 0), patch.object(fetcher, 'with_retry', side_effect=HTTPError('https://example.test', 429, 'limited', {}, None)) as request:
            self.assertEqual(fetcher.translate_chunk('First.'), '')
            self.assertEqual(fetcher.translate_chunk('Next.'), '')
            self.assertEqual(request.call_count, 1)

    def test_translation_preserves_paragraphs_and_lines(self):
        source = ('A complete sentence. ' * 60).strip() + '\nSecond line.\n\nLast paragraph.'
        with patch.object(fetcher, 'TRANSLATE_ENABLED', True), patch.object(fetcher, 'translate_chunk', return_value='译文') as translate:
            result = fetcher.translate(source)
        self.assertEqual([len(p.split('\n')) for p in result.split('\n\n')], [2, 1])
        self.assertTrue(all(len(call.args[0]) <= 450 for call in translate.call_args_list))

    def test_failed_chunk_does_not_shift_following_paragraph(self):
        with patch.object(fetcher, 'TRANSLATE_ENABLED', True), patch.object(fetcher, 'translate_chunk', side_effect=['', '末段']):
            self.assertEqual(fetcher.translate('First.\n\nLast.'), '[本段翻译暂不可用]\n\n末段')

    def test_failed_source_preserves_catalog_and_last_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(fetcher, 'FEED_DIR', directory):
            fetcher.save_json(directory + '/index.json', [{'id': 'feed-wikinews', 'updatedAt': 'previous', 'length': 0}, {'id': 'other-source', 'length': 0}])
            with patch.object(fetcher, 'fetch_wikinews', side_effect=OSError('offline')), patch.object(fetcher, 'fetch_simplewiki', return_value=[]), patch.object(fetcher, 'fetch_gutenberg', return_value=[]):
                fetcher.run_once()
            catalog = fetcher.load_book(directory + '/index.json')
            news = next(item for item in catalog if item['id'] == 'feed-wikinews')
            self.assertEqual(news['fetchStatus'], 'error')
            self.assertEqual(news['updatedAt'], 'previous')
            self.assertTrue(news['checkedAt'])
            self.assertTrue(any(item['id'] == 'other-source' for item in catalog))


if __name__ == '__main__':
    unittest.main()
