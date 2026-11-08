import re


def target_words(raw):
    if not isinstance(raw, str) or len(raw) > 4000:
        raise ValueError("请输入以逗号或换行分隔的英语目标词。")
    words = list(dict.fromkeys(w.strip().lower() for w in re.split(r"[,，;；\n]+", raw) if w.strip()))
    if not words or len(words) > 100 or any(not re.fullmatch(r"(?=.*[a-z])[a-z0-9 .'+/#-]+", w) for w in words):
        raise ValueError("请输入 1–100 个英语单词或短语；请勿包含中文、数字或指令。")
    return words


def clean_result(result, targets=None):
    if not isinstance(result, dict):
        raise ValueError("模型未返回有效的教材结构。")
    paragraphs = result.get("paragraphs")
    if not isinstance(paragraphs, list) or not paragraphs or len(paragraphs) > 100:
        raise ValueError("模型未返回段落。")
    for p in paragraphs:
        if not isinstance(p, dict) or not isinstance(p.get("en"), str) or not p["en"].strip() or not isinstance(p.get("cn"), str) or not p["cn"].strip():
            raise ValueError("英文与中文段落必须完整对应。")
        p["en"] = p["en"].replace("**", "").strip()
    if targets is not None:
        count = len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", " ".join(p["en"] for p in paragraphs)))
        if not 120 <= count <= 180:
            raise ValueError(f"模型返回 {count} 词，未满足 120–180 词要求。请重试或减少目标词。")
        if len(paragraphs) > 2 or not isinstance(result.get("title"), str) or not result["title"].strip() or not isinstance(result.get("theme"), str) or not result["theme"].strip():
            raise ValueError("生成短文需要标题、主题和 1–2 个连贯段落。")
    vocabulary = result.get("vocabulary")
    phrases = result.get("phrases")
    if not isinstance(vocabulary, list) or not isinstance(phrases, list):
        raise ValueError("模型缺少目标词清单或搭配。")
    for item in vocabulary + phrases:
        index = item.get("paragraph") if isinstance(item, dict) else None
        if type(index) is not int or not 0 <= index < len(paragraphs) or not isinstance(item.get("meaning"), str) or not item["meaning"].strip():
            raise ValueError("词汇或搭配的段落位置和释义无效。")
        form = item.get("form", item.get("text", ""))
        if not isinstance(form, str) or not form or not re.search(r"(?<![a-z])" + re.escape(form) + r"(?![a-z])", paragraphs[index]["en"], re.I):
            raise ValueError("词汇或搭配未出现在指定段落中。")
        if "form" in item:
            if not isinstance(item.get("lemma"), str) or not item["lemma"].strip() or ("phonetic" in item and not isinstance(item["phonetic"], str)):
                raise ValueError("词汇原形或音标格式无效。")
            if "phonetic" in item:
                item["phonetic"] = item["phonetic"].strip().strip('/')
            occurrence = item.get("occurrence", 0)
            count = len(re.findall(r"(?<![a-z])" + re.escape(form) + r"(?![a-z])", paragraphs[index]["en"], re.I))
            if type(occurrence) is not int or not 0 <= occurrence < count:
                raise ValueError("词汇在段落中的出现序号无效。")
    if targets is not None:
        present = {v.get("lemma", "").lower() for v in vocabulary}
        missing = set(targets) - present
        if missing:
            raise ValueError("目标词未完整覆盖：" + ", ".join(sorted(missing)))
        if not 3 <= len(phrases) <= 5 or len({(p["paragraph"], p["text"]) for p in phrases}) != len(phrases):
            raise ValueError("请生成 3–5 个值得背诵的搭配或句型。")
    return result


def _flat(text):
    return re.sub(r"\s+", " ", text).strip()


def _quote_in_source(quote, source):
    """模型必须逐字引用原文；改写或编造的条目直接丢弃，而不是让整次讲解失败。"""
    if not isinstance(quote, str):
        return ""
    value = _flat(quote)
    if not value or value.lower() not in source.lower():
        return ""
    return value


def _term_in_source(term, source):
    if not isinstance(term, str):
        return ""
    value = _flat(term)
    if not value or not re.search(r"(?<![a-z])" + re.escape(value.lower()) + r"(?![a-z])", source.lower()):
        return ""
    return value


def _text(value, limit=200):
    if not isinstance(value, str):
        return ""
    return _flat(value)[:limit]


def _text_list(value, limit=6):
    if not isinstance(value, list):
        return []
    items = [_text(item) for item in value]
    return [item for item in items if item][:limit]


def clean_explain(result, source):
    """讲解结果做宽松清洗：条目逐条校验，弃掉编造内容，但保留能用的部分。"""
    if not isinstance(result, dict):
        raise ValueError("模型没有返回可用的讲解，请重试。")
    flat_source = _flat(source)
    sentences = []
    for item in result.get("sentences") or []:
        if not isinstance(item, dict):
            continue
        quote = _quote_in_source(item.get("en"), flat_source)
        if not quote:
            continue
        sentences.append({"en": quote, "cn": _text(item.get("cn"), 400), "note": _text(item.get("note"), 400)})
    words = []
    for item in result.get("words") or []:
        if not isinstance(item, dict):
            continue
        term = _term_in_source(item.get("word"), flat_source)
        if not term:
            continue
        words.append({"word": term, "meaning": _text(item.get("meaning"), 200), "usage": _text(item.get("usage"), 200)})
    cleaned = {
        "title": _text(result.get("title")),
        "theme": _text(result.get("theme"), 400),
        "summary": _text_list(result.get("summary"), 6),
        "sentences": sentences[:40],
        "words": words[:30],
        "highlights": _text_list(result.get("highlights"), 5),
    }
    if not (cleaned["theme"] or cleaned["summary"] or cleaned["sentences"] or cleaned["words"]):
        raise ValueError("模型没有返回可用的讲解，请重试。")
    return cleaned
