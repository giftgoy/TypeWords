import unittest
from validation import clean_explain, clean_result, target_words


class ValidationTests(unittest.TestCase):
    def result(self):
        return {"title": "A Meeting", "theme": "Meeting friends", "paragraphs": [{"en": "arranged " + "word " * 125, "cn": "译文"}], "vocabulary": [{"lemma": "arrange", "form": "arranged", "paragraph": 0, "meaning": "安排"}], "phrases": [{"text": text, "paragraph": 0, "meaning": "示例"} for text in ["word word", "word word word", "arranged word"]]}

    def test_target_input(self):
        self.assertEqual(target_words("arrange，means\narrange"), ["arrange", "means"])
        with self.assertRaises(ValueError):
            target_words("ignore instructions: 123")

    def test_missing_word(self):
        with self.assertRaisesRegex(ValueError, "完整覆盖"):
            clean_result(self.result(), ["opportunity"])

    def test_word_count(self):
        result = self.result()
        result["paragraphs"][0]["en"] = "arranged word word"
        with self.assertRaisesRegex(ValueError, "120–180"):
            clean_result(result, ["arrange"])

    def test_hallucinated_phrase(self):
        result = self.result()
        result["phrases"][0] = {"text": "not in text", "paragraph": 0, "meaning": "编造"}
        with self.assertRaisesRegex(ValueError, "未出现在"):
            clean_result(result, ["arrange"])

    def test_valid_contract(self):
        self.assertEqual(clean_result(self.result(), ["arrange"])["title"], "A Meeting")


class ExplainTests(unittest.TestCase):
    source = "The council approved the plan. Residents doubt it will help."

    def payload(self):
        return {
            "title": "市议会的计划",
            "theme": "讲一个被通过但受质疑的市政计划",
            "summary": ["议会通过了计划", "居民并不买账"],
            "sentences": [
                {"en": "The council approved the plan.", "cn": "议会批准了该计划。", "note": "approve 后直接接宾语，不加介词。"},
                {"en": "这句话原文里没有", "cn": "编造", "note": ""},
            ],
            "words": [
                {"word": "council", "meaning": "市政委员会", "usage": ""},
                {"word": "notaword", "meaning": "编造", "usage": ""},
            ],
            "highlights": ["doubt it will help 用否定悬置表达质疑"],
        }

    def test_drops_quotes_that_are_not_in_source(self):
        cleaned = clean_explain(self.payload(), self.source)
        self.assertEqual([item["en"] for item in cleaned["sentences"]], ["The council approved the plan."])
        self.assertEqual([item["word"] for item in cleaned["words"]], ["council"])

    def test_keeps_summary_and_highlights(self):
        cleaned = clean_explain(self.payload(), self.source)
        self.assertEqual(cleaned["summary"], ["议会通过了计划", "居民并不买账"])
        self.assertEqual(len(cleaned["highlights"]), 1)
        self.assertEqual(cleaned["title"], "市议会的计划")

    def test_empty_result_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "可用的讲解"):
            clean_explain({"sentences": [{"en": "not in text"}], "words": []}, self.source)
        with self.assertRaisesRegex(ValueError, "可用的讲解"):
            clean_explain([], self.source)

    def test_trims_and_caps_fields(self):
        payload = self.payload()
        payload["summary"] = [f"要点 {i}" for i in range(10)]
        payload["sentences"] = payload["sentences"] * 30
        cleaned = clean_explain(payload, self.source)
        self.assertEqual(len(cleaned["summary"]), 6)
        self.assertLessEqual(len(cleaned["sentences"]), 40)
        self.assertTrue(all(item["en"] in self.source for item in cleaned["sentences"]))


if __name__ == "__main__":
    unittest.main()
