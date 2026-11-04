"""每日文章拉取：Wikinews / Simple English Wikipedia / Project Gutenberg，
可选通过 LibreTranslate 生成中文对照，写入 nginx 可静态访问的 feed 目录。

产物（挂在 /usr/share/nginx/html/dicts/en/article/feed）：
- index.json          文章市场的目录条目（客户端合并展示）
- wikinews.json       每日新闻（累积，最多 MAX_PER_BOOK 篇）
- simplewiki.json     简单英语百科短文
- gutenberg.json      公版短篇

运行方式：容器内常驻，启动即跑一次，之后每天 SCHEDULE_HOUR 点再跑。
"""

import hashlib
import json
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

FEED_DIR = os.environ.get("FEED_DIR", "/feed")
LT_URL = os.environ.get("LIBRETRANSLATE_URL", "").rstrip("/")
TRANSLATE_PROVIDER = os.environ.get("TRANSLATE_PROVIDER", "mymemory").strip().lower()
TRANSLATE_ENABLED = os.environ.get("TRANSLATE_ENABLED", "1").lower() not in ("0", "false", "no")
DAILY_COUNT = int(os.environ.get("DAILY_COUNT", "3"))
MAX_PER_BOOK = int(os.environ.get("MAX_PER_BOOK", "200"))
SCHEDULE_HOUR = int(os.environ.get("SCHEDULE_HOUR", "6"))  # UTC
RUN_ON_START = os.environ.get("RUN_ON_START", "1").lower() not in ("0", "false", "no")
USER_AGENT = os.environ.get("HTTP_USER_AGENT", "TypeWordsFeed/1.0 (local study app)")
translation_retry_after = 0

BOOKS = {
    "wikinews": {
        "id": "feed-wikinews",
        "name": "新闻阅读（Wikinews）",
        "description": "每日检查来源更新，保留原始报道日期；来源可能没有新内容，并非今日新闻。中文为机器翻译，仅供参考。",
        "category": "每日更新",
        "tags": ["新闻", "每日更新", "双语对照"],
        "level": "B2",
        "icon": "N",
        "accent": "blue",
        "source": "Wikinews (CC BY 2.5)",
        "license": "CC BY 2.5",
    },
    "simplewiki": {
        "id": "feed-simplewiki",
        "name": "简单英语百科（Simple Wikipedia）",
        "description": "用基础英语写的百科条目，题材广、难度平稳，适合每天读两篇。",
        "category": "每日更新",
        "tags": ["百科", "每日更新", "双语对照"],
        "level": "B1",
        "icon": "S",
        "accent": "mint",
        "source": "Simple English Wikipedia (CC BY-SA 4.0)",
        "license": "CC BY-SA 4.0",
    },
    "gutenberg": {
        "id": "feed-gutenberg",
        "name": "公版短篇（Project Gutenberg）",
        "description": "来自 Project Gutenberg 的公版文学作品片段，一次拉取多篇，长期库存。",
        "category": "经典文学",
        "tags": ["文学", "公版", "双语对照"],
        "level": "C1",
        "icon": "G",
        "accent": "amber",
        "source": "Project Gutenberg (public domain)",
        "license": "Public domain",
    },
}


# ---------------- HTTP ----------------
def with_retry(func, attempts=3, delay=2.0):
    last = None
    for index in range(attempts):
        try:
            return func()
        except (urllib.error.URLError, TimeoutError, ssl.SSLError, ConnectionError, OSError) as error:
            last = error
            if index < attempts - 1:
                time.sleep(delay * (index + 1))
    raise last


def http_json(url, timeout=30):
    def call():
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    return with_retry(call)


def http_text(url, timeout=60, encoding="utf-8"):
    def call():
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode(encoding, errors="replace")
    return with_retry(call)


# ---------------- 抓取 ----------------
def fetch_wikinews(limit):
    api = "https://en.wikinews.org/w/api.php"
    params = {
        "action": "query", "format": "json", "list": "categorymembers",
        "cmtitle": "Category:Published", "cmlimit": "20", "cmnamespace": "0",
        "cmsort": "timestamp", "cmdir": "desc",
    }
    data = http_json(api + "?" + urllib.parse.urlencode(params))
    titles = [item["title"] for item in data.get("query", {}).get("categorymembers", []) if ":" not in item["title"]]
    articles = []
    for title in titles[: max(limit * 2, 6)]:
        if len(articles) >= limit:
            break
        try:
            page_title, text = fetch_wikinews_page(title)
        except Exception:
            continue
        if len(text.split()) >= 80:
            articles.append(as_article(page_title, text[:6000]))
    return articles


def fetch_wikinews_page(title):
    api = "https://en.wikinews.org/w/api.php"
    params = {
        "action": "query", "format": "json", "prop": "extracts",
        "explaintext": "1", "exsectionformat": "plain", "titles": title, "redirects": "1",
    }
    data = http_json(api + "?" + urllib.parse.urlencode(params))
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    text = page.get("extract", "") or ""
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return title, text


def fetch_simplewiki(limit):
    api = "https://simple.wikipedia.org/w/api.php"
    params = {"action": "query", "format": "json", "list": "random", "rnnamespace": "0", "rnlimit": str(limit)}
    data = http_json(api + "?" + urllib.parse.urlencode(params))
    titles = [item["title"] for item in data.get("query", {}).get("random", [])]
    results = []
    for title in titles:
        params = {"action": "query", "format": "json", "prop": "extracts", "explaintext": "1", "titles": title, "redirects": "1"}
        page = next(iter(http_json(api + "?" + urllib.parse.urlencode(params))["query"]["pages"].values()), {})
        text = re.sub(r"\n{3,}", "\n\n", (page.get("extract") or "")).strip()
        if len(text.split()) >= 80:
            results.append(as_article(title, text))
    return results


GUTENBERG_IDS = [1952, 2148, 31, 74, 3186, 1232, 844, 2313, 5200, 2852]


def fetch_gutenberg(limit):
    """公版文本直接从 gutenberg.org 取（gutendex 在这台机器上会超时）。"""
    results = []
    day = datetime.now(timezone.utc).timetuple().tm_yday
    for offset in range(len(GUTENBERG_IDS)):
        if len(results) >= limit:
            break
        book_id = GUTENBERG_IDS[(day + offset) % len(GUTENBERG_IDS)]
        url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
        try:
            raw = http_text(url, timeout=40)
        except Exception as error:
            print(f"[gutenberg] {book_id} failed: {error}", flush=True)
            continue
        title_match = re.search(r"^Title:\s*(.+)$", raw, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else f"Project Gutenberg #{book_id}"
        body = raw.split("*** START OF", 1)[-1]
        body = re.split(r"\*\*\* END OF", body)[0]
        paragraphs = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", body)]
        passages = [p for p in paragraphs if 200 <= len(p) <= 1200]
        if not passages:
            continue
        results.append(as_article(title, "\n\n".join(passages[:3])))
    return results


# ---------------- 翻译 ----------------
def translate(text):
    if not TRANSLATE_ENABLED or not text.strip():
        return ""
    # Preserve the paragraph/line boundaries consumed by genArticleSectionData.
    # API-sized chunks must never become new paragraphs or disappear on failure.
    paragraphs = []
    for paragraph in text.split("\n\n"):
        lines = []
        for line in paragraph.split("\n"):
            remaining, chunks = line.strip(), []
            while remaining:
                cut = len(remaining)
                if cut > 450:
                    sentence_end = max(remaining.rfind(mark, 0, 450) for mark in (". ", "! ", "? "))
                    cut = sentence_end + 1 if sentence_end >= 0 else remaining.rfind(" ", 0, 450)
                    if cut <= 0:
                        cut = 450
                chunks.append(remaining[:cut])
                remaining = remaining[cut:].strip()
            translated = [translate_chunk(chunk) for chunk in chunks]
            lines.append("".join(translated) if all(translated) else "[本段翻译暂不可用]")
        paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs)


def translate_chunk(chunk):
    global translation_retry_after
    if time.time() < translation_retry_after:
        return ""
    if TRANSLATE_PROVIDER == "libretranslate" and LT_URL:
        try:
            body = json.dumps({"q": chunk, "source": "en", "target": "zh", "format": "text"}).encode("utf-8")
            request = urllib.request.Request(
                LT_URL + "/translate", data=body, method="POST",
                headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8")).get("translatedText", "")
        except Exception as error:
            print("libretranslate failed:", error, flush=True)
            return ""
    # 默认：MyMemory 免费接口（无需 key，约 500 字符/次）
    params = {"q": chunk[:480], "langpair": "en|zh-CN"}
    email = os.environ.get("MYMEMORY_EMAIL", "").strip()
    if email:
        params["de"] = email
    try:
        data = with_retry(lambda: http_json("https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(params), timeout=30))
        value = (data.get("responseData") or {}).get("translatedText") or ""
        if data.get("responseStatus") not in (200, "200"):
            print("mymemory status:", data.get("responseStatus"), data.get("responseDetails"), flush=True)
            return ""
        return value
    except urllib.error.HTTPError as error:
        if error.code == 429:
            translation_retry_after = time.time() + 3600
        print("mymemory unavailable:", error, flush=True)
        return ""
    except Exception as error:
        print("mymemory failed:", error, flush=True)
        return ""


# ---------------- 组装 ----------------
def as_article(title, text):
    title = (title or "").strip()
    text = (text or "").strip()
    return {
        "id": int(hashlib.sha1((title + text[:60]).encode("utf-8")).hexdigest()[:8], 16),
        "title": title,
        "titleTranslate": "",
        "text": text,
        "textTranslate": "",
        "sections": [],
        "newWords": [],
        "audioSrc": "",
        "audioFileId": "",
        "lrcPosition": [],
        "questions": [],
        "nameList": [],
    }


def enrich(articles, book_key):
    for article in articles:
        article["titleTranslate"] = (translate(article["title"]) if TRANSLATE_ENABLED else "") or article.get("titleTranslate", "")
        previous = article.get("textTranslate", "") if article.get("translationVersion") == 2 else ""
        translated = translate(article["text"])
        if previous:
            old_lines = previous.split("\n")
            translated = "\n".join(
                old_lines[index] if line == "[本段翻译暂不可用]" and index < len(old_lines) and old_lines[index] else line
                for index, line in enumerate(translated.split("\n"))
            ) if translated else previous
        article["textTranslate"] = translated
        article["translationIncomplete"] = not article["textTranslate"] or "[本段翻译暂不可用]" in article["textTranslate"]
        article["source"] = BOOKS[book_key]["source"]
        article["translationVersion"] = 2
    return articles


def load_book(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, ValueError):
        return []


def save_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    os.replace(tmp, path)


def run_once():
    os.makedirs(FEED_DIR, exist_ok=True)
    catalog = load_book(os.path.join(FEED_DIR, "index.json"))
    fetchers = {"wikinews": fetch_wikinews, "simplewiki": fetch_simplewiki, "gutenberg": fetch_gutenberg}
    for key, fetcher in fetchers.items():
        checked_at = datetime.now(timezone.utc).isoformat()
        status = "ok"
        # Publish the check immediately, even when the source or translator is slow.
        for item in catalog:
            if item.get("id") == BOOKS[key]["id"]:
                item.update(name=BOOKS[key]["name"], description=BOOKS[key]["description"],
                            checkedAt=checked_at, fetchStatus="checking")
        save_json(os.path.join(FEED_DIR, "index.json"), catalog)
        try:
            fresh = fetcher(DAILY_COUNT)
        except Exception as error:
            print(f"[{key}] fetch failed: {error}", flush=True)
            fresh = []
            status = "error"
        fresh = [item for item in fresh if item["text"].strip()]
        path = os.path.join(FEED_DIR, f"{key}.json")
        existing = load_book(path)
        seen = {(item.get("title"), item.get("text", "")[:80]) for item in existing}
        additions = [item for item in fresh if (item.get("title"), item.get("text", "")[:80]) not in seen]
        merged = existing + enrich(additions, key)
        merged = merged[-MAX_PER_BOOK:]
        for article in merged:
            if article.get("translationVersion") != 2 or (TRANSLATE_ENABLED and article.get("translationIncomplete")):
                enrich([article], key)
        save_json(path, merged)
        meta = BOOKS[key]
        previous = next((item for item in catalog if item.get("id") == meta["id"]), {})
        catalog = [item for item in catalog if item.get("id") != meta["id"]]
        catalog.append({
            "id": meta["id"], "enName": meta["id"], "name": meta["name"],
            "description": meta["description"], "category": meta["category"], "tags": meta["tags"],
            "level": meta["level"], "levelNote": "参考难度，非官方 CEFR 评级",
            "icon": meta["icon"], "accent": meta["accent"],
            "url": f"feed/{key}.json", "length": len(merged), "type": "article",
            "language": "en", "translateLanguage": "zh-CN", "version": 1,
            "source": meta["source"], "license": meta["license"], "featured": False,
            "updatedAt": checked_at if fresh else previous.get("updatedAt"),
            "checkedAt": checked_at, "fetchStatus": status,
            "newCount": sum((item.get("title"), item.get("text", "")[:80]) not in seen for item in fresh),
        })
        # 每完成一个源就落一次目录，避免后面的源卡住导致整轮不可见
        save_json(os.path.join(FEED_DIR, "index.json"), catalog)
    save_json(os.path.join(FEED_DIR, "index.json"), catalog)
    print(f"[feed] catalog={len(catalog)} articles={sum(item['length'] for item in catalog)}", flush=True)


def loop():
    if RUN_ON_START:
        run_once()
    while True:
        now = datetime.now(timezone.utc)
        next_run = now.replace(hour=SCHEDULE_HOUR, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run = next_run.replace(day=now.day) + __import__("datetime").timedelta(days=1)
        time.sleep(max(60, (next_run - now).total_seconds()))
        try:
            run_once()
        except Exception as error:
            print("[feed] run failed:", error, flush=True)


if __name__ == "__main__":
    if os.environ.get("RUN_MODE") == "once":
        run_once()
    else:
        threading.Thread(target=loop, daemon=False).start()
