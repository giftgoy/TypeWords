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
                client = TestClient(TestServer(server.create_app()))
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

    async def test_explain_uses_saved_model_and_cleans_output(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(server, "CONFIG", Path(temp) / "reading.json"):
                client = TestClient(TestServer(server.create_app()))
                await client.start_server()
                try:
                    response = await client.post('/explain', json={"text": "The council approved the plan."})
                    self.assertEqual(response.status, 422)
                    await client.post('/settings', json={"endpoint": server.DEFAULTS['endpoint'], "model": server.DEFAULTS['model'], "key": "test-only-secret"})
                    model_result = {
                        "theme": "市政计划",
                        "summary": ["计划通过"],
                        "sentences": [
                            {"en": "The council approved the plan.", "cn": "议会批准了计划。", "note": ""},
                            {"en": "不存在的一句", "cn": "编造", "note": ""},
                        ],
                        "words": [{"word": "council", "meaning": "市政委员会", "usage": ""}],
                        "highlights": ["approve 直接接宾语"],
                    }
                    with patch.object(server, "model_json", AsyncMock(return_value=model_result)) as model:
                        response = await client.post('/explain', json={"text": "The council approved the plan.", "mode": "sentence", "language": "bilingual"})
                        self.assertEqual(response.status, 200)
                        data = await response.json()
                        self.assertEqual(len(data['sentences']), 1)
                        self.assertEqual(data['words'][0]['word'], 'council')
                        instruction = model.call_args.args[0]
                        self.assertIn('中英对照', instruction)
                        self.assertIn('只讲这一句', instruction)
                        self.assertEqual(model.call_args.kwargs['max_tokens'], 1400)
                    response = await client.post('/explain', json={"text": "x" * 7000})
                    self.assertEqual(response.status, 422)
                finally:
                    await client.close()

    def test_truncated_model_output_is_repaired_or_reported(self):
        complete = '{"theme":"市政计划","summary":["计划通过"],"sentences":[{"en":"The council approved the plan.","cn":"议会批准了计划。","note":""}],"words":[],"highlights":[]}'
        self.assertEqual(server.parse_model_json(complete)['theme'], '市政计划')
        # 在 words 数组中间被截断：退回最后一个完整对象，其余由校验层丢弃
        truncated = complete[:-2]
        self.assertEqual(server.parse_model_json(truncated)['sentences'][0]['en'], 'The council approved the plan.')
        with self.assertRaisesRegex(ValueError, '完整的 JSON'):
            server.parse_model_json('{"theme": "只写了一半')

    def test_article_chunks_stay_contiguous_and_bounded(self):
        text = "\n\n".join(f"Paragraph {index} text." for index in range(5))
        chunks = server.split_article_chunks(text)
        self.assertLessEqual(len(chunks), 4)
        self.assertGreater(len(chunks), 1)
        # 分片必须拼回原文，且不切断段落
        self.assertEqual("\n\n".join(chunks), text)
        self.assertEqual(server.split_article_chunks("Only one paragraph."), ["Only one paragraph."])

    def test_merge_orders_sentences_and_dedupes_words(self):
        source = "Alpha one. Beta two. Gamma three."
        merged = server.merge_explanations(
            {"theme": "主题", "summary": ["要点"], "highlights": ["亮点"]},
            [
                {"sentences": [{"en": "Gamma three.", "cn": "三"}], "words": [{"word": "Gamma", "meaning": "伽马"}]},
                {"sentences": [{"en": "Alpha one.", "cn": "一"}], "words": [{"word": "gamma", "meaning": "重复"}, {"word": "Alpha", "meaning": "阿尔法"}]},
            ],
            source,
        )
        self.assertEqual([item["en"] for item in merged["sentences"]], ["Alpha one.", "Gamma three."])
        self.assertEqual([item["word"] for item in merged["words"]], ["Gamma", "Alpha"])
        self.assertEqual(merged["theme"], "主题")

    async def test_long_article_explain_runs_parts_concurrently(self):
        # 必须超过 ARTICLE_SPLIT_MIN_CHARS 才会走并发分段
        text = "\n\n".join(
            f"Paragraph {index} is here. It explains the neighbourhood in enough detail to pass the split threshold, "
            f"because a short paragraph would be handled by a single request instead of the concurrent path. "
            f"Residents keep asking for shorter routes, safer crossings and more benches along the way."
            for index in range(4)
        )
        self.assertGreaterEqual(len(text), server.ARTICLE_SPLIT_MIN_CHARS)
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(server, "CONFIG", Path(temp) / "reading.json"):
                client = TestClient(TestServer(server.create_app()))
                await client.start_server()
                try:
                    await client.post('/settings', json={"endpoint": server.DEFAULTS['endpoint'], "model": server.DEFAULTS['model'], "key": "test-only-secret"})
                    calls = []

                    async def fake_model(instruction, payload, session, max_tokens=7000):
                        calls.append(session)
                        if session.endswith('-overview'):
                            return {"title": "标题", "theme": "主题", "summary": ["要点一"], "highlights": ["亮点"], "sentences": [], "words": []}
                        sentence = payload['text'].split('. ')[0] + '.'
                        return {"sentences": [{"en": sentence, "cn": "中文", "note": ""}], "words": [{"word": sentence.split()[0], "meaning": "释义", "usage": ""}]}

                    with patch.object(server, 'model_json', fake_model):
                        response = await client.post('/explain', json={"text": text, "mode": "article", "session": "test"})
                        self.assertEqual(response.status, 200)
                        data = await response.json()
                        self.assertEqual(data['theme'], '主题')
                        self.assertEqual(len(data['sentences']), 4)
                        # 每段都给了词条；重复词形会合并，这里只要求非空
                        self.assertGreaterEqual(len(data['words']), 1)
                        # 一次总览 + 每段一次，而不是整篇一个大请求
                        self.assertEqual(len(calls), 1 + len(server.split_article_chunks(text)))
                        self.assertTrue(any(call.endswith('-overview') for call in calls))
                finally:
                    await client.close()


if __name__ == '__main__':
    unittest.main()
