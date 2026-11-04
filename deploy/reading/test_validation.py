import unittest
from validation import clean_result, target_words


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


if __name__ == "__main__":
    unittest.main()
