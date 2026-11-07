import tempfile
import unittest
import copy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from growth import Growth, GrowthError, DELAYS, KEY
from storage import Storage, Conflict


class GrowthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Storage(Path(self.temp.name) / "learning.sqlite3")
        self.now = 1800000000000
        self.growth = Growth(self.storage, lambda: self.now)
        self.ids = ["coat", "ticket", "umbrella", "kitchen", "chair"]

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        response = self.growth.run({"op": "create", "words": self.ids, "confidence": 0, "requestId": "create-one"})
        return response["createdId"]

    def round(self, rid):
        return next(r for r in self.growth.read()["rounds"] if r["id"] == rid)

    def raw(self, rid):
        with self.storage.connect() as db:
            return next(r for r in self.growth.load(db)["rounds"] if r["id"] == rid)

    def start(self, rid, mode):
        return self.growth.run({"op": "start", "roundId": rid, "mode": mode})["attempt"]

    def finish(self, rid, mode, correct=5):
        a = self.start(rid, mode)
        for index in range(5):
            raw = next(row for row in self.raw(rid)["attempts"] if row["id"] == a["id"])
            q = raw["questions"][index]
            if a["stage"] == 4:
                self.growth.run({"op": "audio", "roundId": rid, "attemptId": a["id"], "questionId": q["id"]})
            value = q["word"] if index < correct else "not-the-answer"
            a = self.growth.run({"op": "answer", "roundId": rid, "attemptId": a["id"], "questionId": q["id"], "value": value})["attempt"]
        return a

    def advance(self, rid, end):
        for stage in range(1, end + 1):
            if stage in (1, 4, 5, 6):
                self.finish(rid, "practice")
            self.now = self.round(rid)["conditions"]["eligibleAt"]
            self.finish(rid, "validation")

    def test_seven_stages_real_delays_and_single_awards(self):
        rid = self.create()
        for stage in range(1, 8):
            if stage in (1, 4, 5, 6):
                self.finish(rid, "practice")
                self.assertEqual(len(self.round(rid)["awards"]), stage - 1)
            ready = self.round(rid)["conditions"]["eligibleAt"]
            if DELAYS[stage - 1]:
                self.now = ready - 1
                with self.assertRaises(GrowthError):
                    self.start(rid, "validation")
            self.now = ready
            done = self.finish(rid, "validation", 4)
            self.assertTrue(done["result"]["passed"])
            self.assertEqual(done["result"]["count"], 4)
            self.assertEqual(len(self.round(rid)["awards"]), stage)
            last = self.raw(rid)["attempts"][-1]["answers"][-1]
            again = self.growth.run({"op": "answer", "roundId": rid, "attemptId": done["id"], "questionId": last["questionId"], "value": last["value"]})
            self.assertEqual(len(again["rounds"][0]["awards"]), stage)
        self.growth.run({"op": "confidence", "roundId": rid, "value": 6})
        self.assertEqual(self.round(rid)["confidenceBefore"], 0)
        self.assertEqual(self.round(rid)["confidenceAfter"], 6)

    def test_failure_correction_recovery_and_no_combined_scores(self):
        rid = self.create()
        self.finish(rid, "practice")
        self.finish(rid, "validation", 3)
        self.assertFalse(self.round(rid)["awards"])
        self.finish(rid, "practice")
        self.assertFalse(self.round(rid)["awards"])
        with self.assertRaises(GrowthError):
            self.start(rid, "validation")
        self.now += 600000
        done = self.finish(rid, "validation")
        self.assertEqual(len(done["result"]["recovered"]), 2)
        self.assertEqual(len(self.round(rid)["awards"]), 1)

    def test_contact_restarts_delay_and_contaminates_open_validation(self):
        rid = self.create()
        self.advance(rid, 1)
        self.now += 599999
        self.growth.run({"op": "contact", "words": ["coat"], "eventId": "ordinary-practice"})
        self.now += 1
        with self.assertRaises(GrowthError):
            self.start(rid, "validation")
        self.now += 600000
        a = self.start(rid, "validation")
        self.growth.run({"op": "contact", "words": ["coat"], "eventId": "extra-hint"})
        for q in self.raw(rid)["attempts"][-1]["questions"]:
            out = self.growth.run({"op": "answer", "roundId": rid, "attemptId": a["id"], "questionId": q["id"], "value": q["word"]})
        self.assertFalse(out["attempt"]["result"]["passed"])
        self.assertEqual(len(self.round(rid)["awards"]), 1)

    def test_contexts_are_new_and_exhaustion_does_not_reuse(self):
        rid = self.create()
        self.advance(rid, 5)
        self.finish(rid, "practice")
        seen = set()
        for _ in range(4):
            self.now += DELAYS[5]
            done = self.finish(rid, "validation", 0)
            raw = next(a for a in self.raw(rid)["attempts"] if a["id"] == done["id"])
            ids = {q["context"] for q in raw["questions"]}
            self.assertFalse(seen & ids)
            seen |= ids
        self.now += DELAYS[5]
        with self.assertRaisesRegex(GrowthError, "没有未见过"):
            self.start(rid, "validation")
        self.assertEqual(len(self.round(rid)["awards"]), 5)

    def test_audio_failure_does_not_score_and_hints_do_not_award(self):
        rid = self.create()
        self.advance(rid, 3)
        a = self.start(rid, "practice")
        with self.assertRaisesRegex(GrowthError, "音频"):
            self.growth.run({"op": "answer", "roundId": rid, "attemptId": a["id"], "questionId": a["question"]["id"], "value": "coat"})
        self.growth.run({"op": "assist", "roundId": rid, "attemptId": a["id"]})
        self.assertEqual(len(self.round(rid)["awards"]), 3)

    def test_milestones_exact_boundaries_duplicate_settlement_and_claim(self):
        targets = [f"word{i}" for i in range(125)]
        self.growth.run({"op": "plan", "dictionaryId": "dict", "targets": targets, "name": "测试词典", "historicalPercent": 80})
        self.growth.run({"op": "settle", "dictionaryId": "dict", "words": targets[:12], "sessionId": "one"})
        self.assertFalse(self.growth.read()["plans"]["dict"]["milestones"])  # 9.6% cannot earn 10%.
        self.growth.run({"op": "settle", "dictionaryId": "dict", "words": targets, "sessionId": "two"})
        self.growth.run({"op": "settle", "dictionaryId": "dict", "words": targets, "sessionId": "two"})
        self.assertEqual(len(self.growth.read()["plans"]["dict"]["milestones"]), 5)
        self.assertEqual(len(self.growth.run({"op": "claimMilestones"})["notifications"]), 5)
        self.assertFalse(self.growth.run({"op": "claimMilestones"})["notifications"])

    def test_backup_restore_and_reserved_key(self):
        rid = self.create()
        self.advance(rid, 1)
        backup = self.growth.export()
        fresh = Growth(Storage(Path(self.temp.name) / "restored.sqlite3"), lambda: self.now)
        fresh.restore(backup)
        self.assertEqual(fresh.read()["rounds"][0]["awards"], self.round(rid)["awards"])
        self.assertEqual(fresh.read()["rounds"][0]["wordIds"], self.ids)
        snap = self.storage.snapshot()
        with self.assertRaises(Conflict):
            self.storage.update({KEY: {"type": "value", "value": "{}"}}, {KEY: snap["entries"][KEY]["revision"]}, snap["id"])
        self.assertIn(KEY, snap["entries"])

    def test_malformed_restore_keeps_original_and_prompts_are_once_optional(self):
        rid = self.create()
        self.advance(rid, 1)
        first = self.growth.run({"op": "methodPrompt", "roundId": rid, "stage": 1})
        self.assertTrue(first["showMethodQuestion"])
        self.assertFalse(self.growth.run({"op": "methodPrompt", "roundId": rid, "stage": 1})["showMethodQuestion"])
        self.growth.run({"op": "method", "roundId": rid, "stage": 1, "methods": None})
        original = self.growth.export()
        for broken in (None, {}, {"wordIds": [[]] * 5}, {"wordIds": self.ids, "awards": [None]}):
            backup = copy.deepcopy(original)
            backup["data"]["rounds"] = [broken]
            with self.assertRaises(GrowthError):
                self.growth.restore(backup)
            self.assertEqual(self.growth.export()["data"], original["data"])

    def test_two_windows_cannot_duplicate_first_answer_or_award(self):
        rid = self.create()
        self.finish(rid, "practice")
        a = self.start(rid, "validation")
        for index in range(5):
            q = self.raw(rid)["attempts"][-1]["questions"][index]
            body = {"op": "answer", "roundId": rid, "attemptId": a["id"], "questionId": q["id"], "value": q["word"]}
            with ThreadPoolExecutor(2) as pool:
                list(pool.map(self.growth.run, [body, body]))
        self.assertEqual(len(self.raw(rid)["attempts"][-1]["answers"]), 5)
        self.assertEqual(len(self.round(rid)["awards"]), 1)

    def test_resuming_an_old_round_does_not_claim_unobserved_retention(self):
        rid = self.create()
        self.advance(rid, 1)
        self.now += 600000
        active = self.start(rid, "validation")
        self.growth.run({"op": "create", "words": self.ids, "requestId": "another"})
        self.now += 86400000
        self.growth.run({"op": "resume", "roundId": rid})
        self.assertEqual(self.round(rid)["conditions"]["eligibleAt"], self.now + 600000)
        self.assertTrue(self.raw(rid)["attempts"][-1]["contaminated"])
        self.assertEqual(len(self.round(rid)["awards"]), 1)

    def test_frozen_denominator_and_deferred_queue_survive_filter_changes(self):
        self.growth.run({"op": "plan", "dictionaryId": "dict", "targets": self.ids, "name": "原计划"})
        self.create()
        self.assertEqual(set(self.growth.read()["plans"]["dict"]["deferred"]), set(self.ids))
        self.growth.run({"op": "plan", "dictionaryId": "dict", "targets": ["coat"], "excluded": 4})
        self.assertEqual(len(self.growth.read()["plans"]["dict"]["targets"]), 5)
        self.growth.run({"op": "settle", "dictionaryId": "dict", "words": ["coat"], "sessionId": "actual"})
        plan = self.growth.read()["plans"]["dict"]
        self.assertEqual(plan["covered"], ["coat"])
        self.assertNotIn("coat", plan["deferred"])
        self.assertEqual([m["threshold"] for m in plan["milestones"]], [10])


if __name__ == "__main__":
    unittest.main()
