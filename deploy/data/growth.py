"""五词成长与词典里程碑：同一 SQLite 内事务提交，使用现有归档/备份封装。"""
import copy
import json
import math
import random
import time
import uuid

from growth_content import PACKS, WORDS

KEY = "typewords-growth-v1"
STAGES = ["我能认出", "我能再次想起", "我能隔天记住", "我能听懂", "我能拼出", "我能理解用法", "我能保持"]
DELAYS = [0, 600000, 86400000, 600000, 600000, 600000, 259200000]
METHODS = {"发音", "词根", "例句", "提取练习", "不确定"}
THRESHOLDS = [10, 30, 50, 80, 100]
MILESTONE_NAMES = ["起步成形", "稳步积累", "走过一半", "接近收尾", "完成首轮"]


class GrowthError(ValueError):
    pass


def normalized(value):
    return str(value).strip().lower()


def kind(stage):
    return "recognition" if stage <= 3 else {4: "audio", 5: "spelling", 6: "context", 7: "context"}[stage]


def blank_state():
    return {"version": 1, "revision": 0, "rounds": [], "plans": {}, "seen": {}}


class Growth:
    def __init__(self, storage, clock=None):
        self.storage = storage
        self.clock = clock or (lambda: int(time.time() * 1000))

    def load(self, db):
        row = db.execute("SELECT value FROM entries WHERE key=?", (KEY,)).fetchone()
        if not row:
            return blank_state()
        encoded = json.loads(row[0])
        if encoded.get("type") == "deleted":
            return blank_state()
        result = json.loads(encoded["value"])
        if result.get("version") != 1:
            raise GrowthError("成长记录版本不兼容，请先导出备份。")
        return result

    def save(self, db, state):
        self.storage.write(db, {KEY: {"type": "value", "value": json.dumps(state, ensure_ascii=False)}})

    def catalog(self):
        return [{**pack, "words": [{**w, "examples": w["examples"][:2]} for w in pack["words"]]} for pack in PACKS]

    def conditions(self, r, now):
        stage = min(7, len(r["awards"]) + 1)
        required = stage in (1, 4, 5, 6)
        prepared = str(stage) in r["prepared"]
        previous = r["awards"][-1]["at"] if r["awards"] else 0
        anchor = max(previous, r["contactAt"])
        delay = DELAYS[stage - 1]
        if stage == 1 and r.get("failedFirst"):
            delay = 600000
        ready_at = anchor + delay
        return {"stage": stage, "label": STAGES[stage - 1], "kind": kind(stage),
                "needsPractice": required and not prepared, "anchorAt": anchor,
                "eligibleAt": ready_at, "ready": (not required or prepared) and now >= ready_at}

    def public_attempt(self, state, r, a, now):
        result = {k: a.get(k) for k in ("id", "stage", "mode", "startedAt", "gap", "status", "result")}
        result["answered"] = len(a["answers"])
        if a["status"] != "active":
            return result
        q = a["questions"][len(a["answers"])]
        w = WORDS[q["word"]]
        task = kind(a["stage"])
        question = {"id": q["id"], "kind": task, "index": len(a["answers"]) + 1}
        if task == "recognition":
            question["prompt"] = w["word"]
        elif task == "audio":
            question["prompt"] = "听声音，选择这组词中对应的释义"
            question["audioUrl"] = "/api/tts/speak?voice=en-US-AriaNeural&text=" + w["word"]
        elif task == "spelling":
            question["prompt"] = "请写出本组中表示“" + w["meaning"] + "”的英文词"
        else:
            example = next(e for e in w["examples"] if e["id"] == q["context"])
            question["prompt"] = example["cloze"]
        if task != "spelling":
            question["options"] = [{"id": key, "label": WORDS[key]["word"] if task == "context" else WORDS[key]["meaning"]} for key in q["options"]]
        question["audioPlayed"] = bool(q.get("audioPlayed"))
        question["audioPlays"] = q.get("audioPlays", 0)
        if a["mode"] == "practice":
            question["learning"] = {"word": w["word"], "meaning": w["meaning"], "example": w["examples"][0]}
            question["previouslyWrong"] = f"{task}:{q['word']}" in r["failures"]
        result["question"] = question
        return result

    def view(self, state, now):
        rounds = []
        for r in state["rounds"]:
            item = {k: copy.deepcopy(v) for k, v in r.items() if k != "attempts"}
            item["conditions"] = self.conditions(r, now)
            item["words"] = [{"id": key, "word": WORDS[key]["word"], "meaning": WORDS[key]["meaning"], "examples": WORDS[key]["examples"][:2]} for key in r["wordIds"]]
            active = next((a for a in reversed(r["attempts"]) if a["status"] == "active"), None)
            item["activeAttempt"] = self.public_attempt(state, r, active, now) if active else None
            item["lastResult"] = next((a.get("result") for a in reversed(r["attempts"]) if a.get("result")), None)
            rounds.append(item)
        return {"version": 1, "revision": state.get("revision", 0), "now": now, "rounds": rounds, "plans": copy.deepcopy(state["plans"])}

    def read(self):
        with self.storage.connect() as db:
            return self.view(self.load(db), self.clock())

    def export(self):
        with self.storage.connect() as db:
            return {"format": "typewords-growth-backup-v1", "createdAt": self.clock(), "data": self.load(db)}

    def restore(self, body):
        data = body.get("data")
        if body.get("format") != "typewords-growth-backup-v1" or not isinstance(data, dict) or data.get("version") != 1:
            raise GrowthError("请选择有效的成长记录备份。")
        if not isinstance(data.get("rounds"), list) or not isinstance(data.get("plans"), dict) or not isinstance(data.get("seen"), dict):
            raise GrowthError("备份内容不完整。")
        try:
            self.validate_backup(data)
            self.view(data, self.clock())
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
            raise GrowthError("备份内容不兼容或缺少恢复所需的记录，现有进度未修改。") from error
        with self.storage.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            snapshot = self.storage.snapshot(db)
            self.storage.archive({k: row["value"] for k, row in snapshot["entries"].items()}, "恢复成长记录前的自动备份", db)
            data["revision"] = max(self.load(db).get("revision", 0), data.get("revision", 0)) + 1
            self.save(db, data)
        return self.read()

    def validate_backup(self, data):
        def require(condition):
            if not condition:
                raise ValueError("Invalid backup")
        def timestamp(value):
            require(type(value) in (int, float) and math.isfinite(value) and value >= 0)
        require(type(data.get("revision")) is int and data["revision"] >= 0)
        round_ids = set()
        current_count = 0
        for r in data["rounds"]:
            require(isinstance(r, dict) and isinstance(r["id"], str) and r["id"] not in round_ids)
            round_ids.add(r["id"])
            require(type(r["current"]) is bool)
            current_count += int(r["current"])
            ids = r["wordIds"]
            require(isinstance(ids, list) and len(ids) == 5 and all(isinstance(w, str) and w in WORDS for w in ids) and len(set(ids)) == 5)
            timestamp(r["createdAt"])
            timestamp(r["contactAt"])
            require(isinstance(r["prepared"], dict) and isinstance(r["failures"], dict))
            require(isinstance(r["awards"], list) and len(r["awards"]) <= 7)
            for index, award in enumerate(r["awards"], 1):
                require(award["stage"] == index and award["count"] in (4, 5) and isinstance(award["label"], str))
                timestamp(award["at"])
                timestamp(award["gap"])
            self.check_confidence(r["confidenceBefore"])
            self.check_confidence(r["confidenceAfter"])
            require(type(r["confidenceAfterAnswered"]) is bool and isinstance(r["attempts"], list))
            for a in r["attempts"]:
                require(isinstance(a["id"], str) and type(a["stage"]) is int and 1 <= a["stage"] <= 7)
                require(a["mode"] in ("practice", "validation") and a["status"] in ("active", "completed", "assisted"))
                require(isinstance(a["answers"], list) and len(a["answers"]) <= 5)
                require(isinstance(a["questions"], list) and len(a["questions"]) == 5)
                require({q["word"] for q in a["questions"]} == set(ids))
                for q in a["questions"]:
                    require(isinstance(q["id"], str) and isinstance(q["options"], list) and set(q["options"]).issubset(ids))
                    if kind(a["stage"]) == "context":
                        require(q["context"] in {e["id"] for e in WORDS[q["word"]]["examples"]})
                if a["status"] == "active":
                    require(len(a["answers"]) < 5)
        require(current_count <= 1)
        for key, seen in data["seen"].items():
            require(key in WORDS and isinstance(seen, list) and all(isinstance(e, str) for e in seen))
        for key, plan in data["plans"].items():
            require(plan["id"] == key and isinstance(plan["name"], str))
            for field in ("targets", "covered", "deferred", "settlements"):
                require(isinstance(plan[field], list) and all(isinstance(w, str) for w in plan[field]))
            require(set(plan["covered"]).issubset(plan["targets"]) and len(set(plan["targets"])) == len(plan["targets"]))
            require(isinstance(plan["milestones"], list))
            for m in plan["milestones"]:
                require(m["threshold"] in THRESHOLDS and 0 < m["total"] and 0 <= m["count"] <= m["total"])

    def find(self, state, body):
        r = next((r for r in state["rounds"] if r["id"] == body.get("roundId")), None)
        if not r:
            raise GrowthError("找不到这轮成长任务，请刷新后重试。")
        return r

    def run(self, body):
        if not isinstance(body, dict):
            raise GrowthError("请求格式不正确。")
        now = self.clock()
        with self.storage.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = self.load(db)
            before = json.dumps(state, sort_keys=True)
            extra = self.act(state, body, now)
            if json.dumps(state, sort_keys=True) != before:
                state["revision"] = state.get("revision", 0) + 1
                self.save(db, state)
            return {**self.view(state, now), **(extra or {})}

    def act(self, state, body, now):
        op = body.get("op")
        if op == "create":
            ids = body.get("words")
            if not isinstance(ids, list) or len(ids) != 5 or any(not isinstance(w, str) or w not in WORDS for w in ids) or len(set(ids)) != 5:
                raise GrowthError("请选择素材齐全的 5 个不同单词。")
            confidence = body.get("confidence")
            self.check_confidence(confidence)
            request_id = str(body.get("requestId", ""))[:100]
            old = next((r for r in state["rounds"] if request_id and r.get("requestId") == request_id), None)
            if old:
                return {"createdId": old["id"]}
            for old in state["rounds"]:
                old["current"] = False
            r = {"id": str(uuid.uuid4()), "requestId": request_id, "version": 1, "contentVersion": 1,
                 "wordIds": ids, "createdAt": now, "current": True, "contactAt": now,
                 "prepared": {}, "awards": [], "attempts": [], "failures": {},
                 "confidenceBefore": confidence, "confidenceBeforeAskedAt": now,
                 "confidenceAfter": None, "confidenceAfterAnswered": False, "dictionaryId": body.get("dictionaryId")}
            state["rounds"].append(r)
            self.defer(state, r)
            return {"createdId": r["id"]}
        if op == "plan":
            return self.plan(state, body, now)
        if op == "settle":
            return self.settle(state, body, now)
        if op == "claimMilestones":
            claimed = []
            for plan in state["plans"].values():
                if body.get("dictionaryId") and plan["id"] != body["dictionaryId"]:
                    continue
                for mark in plan["milestones"]:
                    if not mark.get("notified"):
                        mark["notified"] = True
                        claimed.append({**mark, "dictionaryName": plan["name"]})
            return {"notifications": claimed}
        if op == "contact":
            if not isinstance(body.get("words"), list) or any(not isinstance(w, str) for w in body["words"]):
                raise GrowthError("接触记录格式不正确。")
            keys = {normalized(w) for w in body.get("words", [])[:100]}
            event = str(body.get("eventId", ""))[:120]
            for r in state["rounds"]:
                if not r["current"] or len(r["awards"]) == 7 or not keys.intersection(r["wordIds"]):
                    continue
                if body.get("roundId") and r["id"] != body["roundId"]:
                    continue
                if event and event == r.get("lastContactEvent"):
                    continue
                r["contactAt"] = now
                r["lastContactEvent"] = event
                for a in r["attempts"]:
                    if a["status"] == "active" and a["mode"] == "validation":
                        a["contaminated"] = True
            return
        r = self.find(state, body)
        if op == "resume":
            if not r["current"]:
                # 离开本轮期间的接触无法完整归因，恢复时保守重算间隔。
                r["contactAt"] = now
                for a in r["attempts"]:
                    if a["status"] == "active" and a["mode"] == "validation":
                        a["contaminated"] = True
            for candidate in state["rounds"]:
                candidate["current"] = candidate["id"] == r["id"]
            self.defer(state, r)
            return
        if op == "confidence":
            if len(r["awards"]) != 7:
                raise GrowthError("完成第七次验证后再记录结束信心。")
            self.check_confidence(body.get("value"))
            if not r["confidenceAfterAnswered"]:
                r.update(confidenceAfter=body.get("value"), confidenceAfterAnswered=True, confidenceAfterAt=now)
            return
        if op == "confidencePrompt":
            show = len(r["awards"]) == 7 and not r.get("confidenceAfterAskedAt") and not r["confidenceAfterAnswered"]
            if show:
                r["confidenceAfterAskedAt"] = now
            return {"showConfidenceQuestion": show}
        if op == "methodPrompt":
            award = next((a for a in r["awards"] if a["stage"] == body.get("stage")), None)
            show = bool(award and not award.get("methodAskedAt") and not award.get("methodAnswered"))
            if show:
                award["methodAskedAt"] = now
            return {"showMethodQuestion": show}
        if op == "method":
            methods = body.get("methods")
            stage = body.get("stage")
            if methods is not None and (not isinstance(methods, list) or any(not isinstance(m, str) or m not in METHODS for m in methods) or ("不确定" in methods and len(methods) > 1)):
                raise GrowthError("请选择有效的方法，或跳过。")
            award = next((a for a in r["awards"] if a["stage"] == stage), None)
            if not award:
                raise GrowthError("还没有这项成功记录。")
            if not award.get("methodAnswered"):
                award.update(methods=methods, methodAnswered=True)
            return
        if op in ("answer", "audio"):
            completed = next((a for a in r["attempts"] if a["id"] == body.get("attemptId") and a["status"] != "active"), None)
            if completed:
                return {"attempt": self.public_attempt(state, r, completed, now)}
        if len(r["awards"]) == 7:
            raise GrowthError("这轮已完成，可以开始下一组。")
        if not r["current"]:
            raise GrowthError("请先继续这轮任务，再进行练习。")
        if op == "start":
            return self.start(state, r, body, now)
        active = next((a for a in r["attempts"] if a["id"] == body.get("attemptId")), None)
        if not active:
            raise GrowthError("找不到本次作答，请重新载入。")
        if op == "assist":
            if active["status"] == "active":
                active["status"] = "assisted"
                r["contactAt"] = now
                if active["stage"] == 1 and active["mode"] == "validation":
                    r["failedFirst"] = True
            return
        if op == "audio":
            if active["status"] != "active":
                return
            q = active["questions"][len(active["answers"])]
            if q["id"] != body.get("questionId") or kind(active["stage"]) != "audio":
                raise GrowthError("音频题目已变化。")
            if q.get("audioPlays", 0) >= 2:
                raise GrowthError("本题已播放两次，可以作答或先练习。")
            q.update(audioPlayed=True, audioPlays=q.get("audioPlays", 0) + 1)
            return
        if op == "answer":
            return self.answer(state, r, active, body, now)
        raise GrowthError("不支持的成长操作。")

    def start(self, state, r, body, now):
        mode = body.get("mode")
        if mode not in ("practice", "validation"):
            raise GrowthError("请选择练习或独立验证。")
        old = next((a for a in r["attempts"] if a["status"] == "active"), None)
        if old:
            raise GrowthError("还有未完成的作答，可继续或先转为练习。")
        cond = self.conditions(r, now)
        if mode == "validation" and not cond["ready"]:
            raise GrowthError("请先完成相应练习，并等待要求的间隔。")
        rng = random.SystemRandom()
        order = rng.sample(r["wordIds"], 5)
        if mode == "practice":
            order.sort(key=lambda key: f"{cond['kind']}:{key}" not in r["failures"])
        questions = []
        for key in order:
            choices = rng.sample([w for w in r["wordIds"] if w != key], 3) + [key]
            rng.shuffle(choices)
            q = {"id": str(uuid.uuid4()), "word": key, "options": choices}
            if cond["kind"] == "context":
                examples = WORDS[key]["examples"]
                seen = state["seen"].get(key, [])
                available = examples[:2] if mode == "practice" else [e for e in examples[2:] if e["id"] not in seen]
                if not available:
                    raise GrowthError("目前没有未见过的新测试例句。进度已保存，可继续练习或今天结束。")
                q["context"] = rng.choice(available)["id"]
            questions.append(q)
        a = {"id": str(uuid.uuid4()), "stage": cond["stage"], "mode": mode, "startedAt": now,
             "gap": max(0, now - cond["anchorAt"]), "anchorAt": cond["anchorAt"], "status": "active", "questions": questions, "answers": []}
        r["attempts"].append(a)
        r["contactAt"] = now
        self.mark_served(state, a)
        return {"attempt": self.public_attempt(state, r, a, now)}

    def mark_served(self, state, a):
        if a["status"] == "active" and a["mode"] == "validation":
            q = a["questions"][len(a["answers"])]
            if q.get("context"):
                used = state["seen"].setdefault(q["word"], [])
                if q["context"] not in used:
                    used.append(q["context"])

    def answer(self, state, r, a, body, now):
        duplicate = next((row for row in a["answers"] if row["questionId"] == body.get("questionId")), None)
        if duplicate or a["status"] != "active":
            return {"attempt": self.public_attempt(state, r, a, now)}
        q = a["questions"][len(a["answers"])]
        if q["id"] != body.get("questionId"):
            raise GrowthError("题目已变化，已提交的首答会保留。")
        if kind(a["stage"]) == "audio" and not q.get("audioPlayed"):
            raise GrowthError("请先成功听完本题音频；播放故障不算答错。")
        value = body.get("value")
        if not isinstance(value, str) or len(value) > 120:
            raise GrowthError("答案格式不正确。")
        correct = normalized(value) == q["word"]
        a["answers"].append({"questionId": q["id"], "word": q["word"], "value": value, "correct": correct, "at": now})
        r["contactAt"] = now
        practice_feedback = None
        if a["mode"] == "practice":
            w = WORDS[q["word"]]
            practice_feedback = {"correct": correct, "word": w["word"], "meaning": w["meaning"], "label": "已纠正（练习记录）" if correct else "已查看答案，可再练一遍"}
        if len(a["answers"]) == 5:
            count = sum(row["correct"] for row in a["answers"])
            independent = a["mode"] == "validation" and not a.get("contaminated")
            passed = independent and count >= 4
            recovered = []
            if independent:
                for row in a["answers"]:
                    failure_key = f"{kind(a['stage'])}:{row['word']}"
                    if row["correct"] and r["failures"].pop(failure_key, None):
                        recovered.append(row["word"])
                    elif not row["correct"]:
                        r["failures"][failure_key] = row["questionId"]
            if passed and len(r["awards"]) + 1 == a["stage"]:
                r["awards"].append({"stage": a["stage"], "label": STAGES[a["stage"] - 1], "count": count,
                                    "gap": a["gap"], "at": now, "attemptId": a["id"], "methodAnswered": False})
            if a["mode"] == "practice":
                r["prepared"][str(a["stage"])] = now
            elif a["stage"] == 1 and not passed:
                r["failedFirst"] = True
            a["status"] = "completed"
            a["result"] = {"attemptId": a["id"], "stage": a["stage"], "mode": a["mode"], "count": count,
                           "independent": independent, "passed": passed, "gap": a["gap"], "recovered": recovered,
                           "contaminated": bool(a.get("contaminated")),
                           "answers": [{**row, "meaning": WORDS[row["word"]]["meaning"]} for row in a["answers"]]}
        else:
            self.mark_served(state, a)
        return {"attempt": self.public_attempt(state, r, a, now), "practiceFeedback": practice_feedback}

    def check_confidence(self, value):
        if value is not None and (type(value) is not int or not 0 <= value <= 10):
            raise GrowthError("信心评分应为 0～10 的整数，也可以跳过。")

    def plan(self, state, body, now):
        identity = str(body.get("dictionaryId", ""))[:120]
        targets = body.get("targets")
        if not identity or not isinstance(targets, list) or len(targets) > 30000 or any(not isinstance(w, str) or len(w) > 120 for w in targets):
            raise GrowthError("词典计划格式不正确。")
        if identity not in state["plans"]:
            if type(body.get("excluded", 0)) is not int:
                raise GrowthError("排除词数格式不正确。")
            words = list(dict.fromkeys(normalized(w) for w in targets if normalized(w)))
            history = body.get("historicalPercent", 0)
            state["plans"][identity] = {"id": identity, "name": str(body.get("name", "词典"))[:120],
                "targets": words, "covered": [], "milestones": [], "settlements": [], "deferred": [],
                "historicalPercent": max(0, min(100, float(history))) if isinstance(history, (int, float)) and math.isfinite(history) else 0,
                "excluded": max(0, int(body.get("excluded", 0))), "createdAt": now}
        for r in state["rounds"]:
            if r["current"] and len(r["awards"]) < 7:
                self.defer(state, r)

    def defer(self, state, r):
        for plan in state["plans"].values():
            for key in r["wordIds"]:
                if key in plan["targets"] and key not in plan["covered"] and key not in plan["deferred"]:
                    plan["deferred"].append(key)

    def settle(self, state, body, now):
        plan = state["plans"].get(body.get("dictionaryId"))
        if not plan:
            raise GrowthError("词典计划还没有准备好，请重试保存。")
        session = str(body.get("sessionId", ""))[:160]
        if not session:
            raise GrowthError("缺少本次学习结算标识。")
        if session in plan["settlements"]:
            return
        words = body.get("words", [])
        if not isinstance(words, list) or len(words) > 30000 or any(not isinstance(w, str) for w in words):
            raise GrowthError("学习结算格式不正确。")
        old = set(plan["covered"])
        covered = old | (set(normalized(w) for w in words) & set(plan["targets"]))
        plan["covered"] = sorted(covered)
        plan["deferred"] = [w for w in plan["deferred"] if w not in covered]
        plan["settlements"].append(session)
        total = len(plan["targets"])
        count = len(covered)
        if total and covered != old:
            for threshold, name in zip(THRESHOLDS, MILESTONE_NAMES):
                if count * 100 >= threshold * total and not any(m["threshold"] == threshold for m in plan["milestones"]):
                    plan["milestones"].append({"id": f"{plan['id']}:{threshold}", "threshold": threshold,
                        "name": name, "count": count, "total": total, "percent": count * 100 / total, "at": now, "notified": False})
