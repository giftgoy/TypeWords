"""固定 GitHub 来源的外刊目录、按需 EPUB 缓存与纯文本章节解析。"""
import asyncio
import hashlib
import io
import json
import os
import posixpath
import re
import time
import zipfile
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from xml.etree import ElementTree as ET

from aiohttp import ClientError, ClientSession, ClientTimeout, web

REPOSITORY = "giftgoy/awesome-english-ebooks"
SOURCE = "https://github.com/" + REPOSITORY
RAW = "https://raw.githubusercontent.com/" + REPOSITORY
PUBLICATIONS = {"01_economist": "经济学人", "02_new_yorker": "纽约客", "04_atlantic": "大西洋月刊", "05_wired": "连线"}
MAX_DOWNLOAD = 100 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_TEXT = 4 * 1024 * 1024
PARSER_VERSION = 1


def catalog_from_tree(payload):
    if payload.get("truncated") or not re.fullmatch(r"[a-f0-9]{40}", payload.get("sha", "")):
        raise ValueError("来源目录不完整，请稍后重试。")
    groups = {}
    for row in payload.get("tree", []):
        path = row.get("path", "")
        group = path.split("/")[0]
        suffix = path.rsplit(".", 1)[-1].lower()
        if group not in PUBLICATIONS or suffix not in ("epub", "pdf", "mobi", "json") or ".." in path.split("/"):
            continue
        if suffix == "json" and not path.endswith("_audios.json"):
            continue
        if not re.fullmatch(r"[a-f0-9]{40}", row.get("sha", "")) or type(row.get("size")) is not int:
            continue
        folder = posixpath.dirname(path)
        date = re.search(r"20\d{2}[._-]\d{2}[._-]\d{2}", folder)
        if not date:
            continue
        date = re.sub(r"[._]", "-", date.group())
        issue = groups.setdefault(folder, {"id": hashlib.sha256(folder.encode()).hexdigest()[:20], "folder": folder,
            "publication": group, "name": PUBLICATIONS[group], "date": date, "title": f"{PUBLICATIONS[group]} · {date}",
            "sourceUrl": SOURCE + "/tree/" + payload["sha"] + "/" + quote(folder, safe="/"), "files": []})
        issue["files"].append({"format": "audio-list" if suffix == "json" else suffix, "path": path,
            "sha": row["sha"], "size": row["size"], "url": RAW + "/" + payload["sha"] + "/" + quote(path, safe="/")})
    issues = [row for row in groups.values() if any(f["format"] == "epub" for f in row["files"])]
    for issue in issues:
        # 个别目录夹带上一期的副本，优先选择文件日期与该目录一致的版本。
        ordered = sorted(issue["files"], key=lambda f: (issue["date"].replace("-", ".") not in posixpath.basename(f["path"]), f["path"]))
        issue["files"] = list({f["format"]: f for f in reversed(ordered)}.values())
    if not issues:
        raise ValueError("来源暂未提供可解析的 EPUB。")
    return {"repository": REPOSITORY, "sourceUrl": SOURCE, "revision": payload["sha"], "issues": sorted(issues, key=lambda r: (r["date"], r["name"]), reverse=True)}


class ChapterText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = []
        self.heading = []
        self.in_heading = False
        self.title = []
        self.in_title = False
        self.anchor_depth = 0
        self.anchor_count = 0
        self.anchor_chars = 0
        self.body_chars = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        hidden = tag in ("script", "style", "nav", "svg", "noscript") or attrs.get("aria-hidden") == "true" or "hidden" in attrs
        if self.hidden or hidden:
            if tag not in ("br", "hr", "img", "meta", "link", "input", "source", "wbr"):
                self.hidden.append(tag)
            return
        if tag == "title":
            self.in_title = True
        if tag == "a":
            self.anchor_depth += 1
            self.anchor_count += 1
        if tag in ("h1", "h2") and not self.heading:
            self.in_heading = True
        if tag in ("p", "div", "section", "article", "h1", "h2", "h3", "h4", "li", "blockquote", "br", "hr"):
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if self.hidden:
            if tag in self.hidden:
                self.hidden = self.hidden[:len(self.hidden) - 1 - self.hidden[::-1].index(tag)]
            return
        if tag == "title":
            self.in_title = False
        if tag == "a":
            self.anchor_depth = max(0, self.anchor_depth - 1)
        if tag in ("h1", "h2"):
            self.in_heading = False
        if tag in ("p", "div", "section", "article", "h1", "h2", "h3", "h4", "li", "blockquote"):
            self.parts.append("\n\n")

    def handle_data(self, text):
        if self.hidden:
            return
        if self.in_title:
            self.title.append(text)
            return
        self.parts.append(text)
        self.body_chars += len(text.strip())
        if self.anchor_depth:
            self.anchor_chars += len(text.strip())
        if self.in_heading:
            self.heading.append(text)

    def result(self):
        paragraphs = [re.sub(r"\s+", " ", p).strip() for p in "".join(self.parts).split("\n\n")]
        text = unicodedata.normalize("NFKC", "\n\n".join(p for p in paragraphs if p)).replace("\u00ad", "").replace("\ufeff", "")
        return text, re.sub(r"\s+", " ", "".join(self.heading or self.title)).strip()


def safe_member(base, href):
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or "\\" in href:
        raise ValueError("EPUB 包含无效的章节路径。")
    path = posixpath.normpath(posixpath.join(base, unquote(parsed.path)))
    if path.startswith(("/", "../")) or path == "..":
        raise ValueError("EPUB 章节路径越界。")
    return path


def parse_epub(raw):
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise ValueError("下载的文件不是有效 EPUB。") from error
    with archive:
        files = archive.infolist()
        if len(files) > 15000 or sum(f.file_size for f in files) > MAX_EXPANDED:
            raise ValueError("EPUB 解压后过大，暂不支持此文件。")
        def read(path):
            info = archive.getinfo(path)
            if info.file_size > MAX_TEXT:
                raise ValueError("EPUB 中的单篇内容过大。")
            return archive.read(path)
        def xml(path):
            value = read(path)
            if b"<!DOCTYPE" in value.upper() or b"<!ENTITY" in value.upper():
                raise ValueError("EPUB 元数据格式不受支持。")
            return ET.fromstring(value)
        try:
            container = xml("META-INF/container.xml")
            rootfile = container.find(".//{*}rootfile")
            if rootfile is None:
                raise ValueError("EPUB 缺少书籍目录。")
            opf_path = safe_member("", rootfile.attrib["full-path"])
            opf = xml(opf_path)
            base = posixpath.dirname(opf_path)
            manifest = {item.attrib["id"]: item.attrib for item in opf.findall(".//{*}manifest/{*}item")}
            chapters = []
            seen = set()
            for ref in opf.findall(".//{*}spine/{*}itemref"):
                item = manifest.get(ref.attrib.get("idref"), {})
                if ref.attrib.get("linear") == "no" or "nav" in item.get("properties", "").split() or item.get("media-type") not in ("application/xhtml+xml", "text/html"):
                    continue
                path = safe_member(base, item["href"])
                if path in seen:
                    continue
                seen.add(path)
                parser = ChapterText()
                parser.feed(read(path).decode("utf-8-sig", errors="replace"))
                text, title = parser.result()
                if parser.anchor_count >= 4 and parser.anchor_chars > parser.body_chars * 0.6:
                    continue
                if len(re.findall(r"[A-Za-z]+", text)) < 25:
                    continue
                # 长篇按完整段落拆分；超长单段优先在空白处分开，不截掉余文。
                chunks = []
                current = ""
                parts = []
                for paragraph in text.split("\n\n"):
                    if len(paragraph) <= 30000:
                        parts.append(paragraph)
                    else:
                        remaining = paragraph
                        while len(remaining) > 30000:
                            cut = remaining.rfind(" ", 0, 30001)
                            cut = cut if cut > 0 else 30000
                            parts.append(remaining[:cut])
                            remaining = remaining[cut:].lstrip()
                        if remaining:
                            parts.append(remaining)
                for part in parts:
                    if current and len(current) + len(part) + 2 > 30000:
                        chunks.append(current)
                        current = ""
                    current += ("\n\n" if current else "") + part
                if current:
                    chunks.append(current)
                for index, chunk in enumerate(chunks):
                    identity = hashlib.sha256(f"{path}:{index}".encode()).hexdigest()[:20]
                    chapters.append({"id": identity, "title": (title or f"第 {len(chapters) + 1} 篇")[:240] + (f"（{index + 1}/{len(chunks)}）" if len(chunks) > 1 else ""),
                        "text": chunk, "wordCount": len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", chunk)), "path": path})
        except (KeyError, ET.ParseError, RuntimeError, zipfile.BadZipFile) as error:
            raise ValueError("EPUB 目录或章节损坏，无法解析。") from error
    if not chapters:
        raise ValueError("这份 EPUB 没有可提取的英文正文，原始资源仍可下载。")
    return chapters


class Ebooks:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.catalog_path = self.folder / "catalog.json"
        self.catalog = catalog_from_tree(json.loads(Path(__file__).with_name("ebook-catalog.seed.json").read_text()))
        self.catalog.update(checkedAt=None, error="", cached=True)
        if self.catalog_path.exists():
            try:
                self.catalog = json.loads(self.catalog_path.read_text())
            except (ValueError, OSError):
                pass
        self.jobs = {}
        self.refreshing = None
        self.limit = asyncio.Semaphore(2)

    def write(self, path, data):
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temp.replace(path)

    def issue(self, identity):
        issue = next((v for v in self.catalog["issues"] if v["id"] == identity), None)
        if issue is None:
            raise web.HTTPNotFound(text="找不到这份期刊，请刷新目录。")
        return issue

    async def refresh(self):
        now = int(time.time() * 1000)
        self.catalog["nextCheckAt"] = now + 600000
        try:
            headers = {"User-Agent": "TypeWords-Ebooks/1.0"}
            token = os.environ.get("EBOOKS_GITHUB_TOKEN", "").strip()
            if token:
                headers["Authorization"] = "Bearer " + token
            async with ClientSession(timeout=ClientTimeout(total=30), trust_env=True) as client:
                async with client.get(f"https://api.github.com/repos/{REPOSITORY}/git/trees/master?recursive=1", headers=headers, allow_redirects=False) as response:
                    if response.status != 200:
                        if response.status in (403, 429) and response.headers.get("X-RateLimit-Remaining") == "0":
                            reset = response.headers.get("X-RateLimit-Reset", "")
                            if reset.isdigit():
                                self.catalog["nextCheckAt"] = max(now + 600000, int(reset) * 1000)
                            raise ValueError("GitHub 匿名目录接口暂时限流，已保留现有目录，EPUB 仍可下载；请稍后更新。")
                        raise ValueError(f"GitHub 目录请求失败（HTTP {response.status}）。")
                    chunks = []
                    count = 0
                    async for chunk in response.content.iter_chunked(65536):
                        count += len(chunk)
                        if count > 4 * 1024 * 1024:
                            raise ValueError("来源目录过大。")
                        chunks.append(chunk)
                    result = catalog_from_tree(json.loads(b"".join(chunks)))
            result.update(checkedAt=int(time.time() * 1000), error="", cached=False)
            self.write(self.catalog_path, result)
            self.catalog = result
        except (ClientError, TimeoutError, ValueError, OSError) as error:
            self.catalog["error"] = str(error) if isinstance(error, ValueError) else "暂时无法更新 GitHub 目录，仍可浏览已保存的资源；请稍后重试。"
        return self.catalog

    def refresh_task(self):
        if self.refreshing is None or self.refreshing.done():
            self.refreshing = asyncio.create_task(self.refresh())
        return self.refreshing

    def cache_path(self, issue):
        epub = next(f for f in issue["files"] if f["format"] == "epub")
        return self.folder / f"{epub['sha']}-v{PARSER_VERSION}.json"

    def status(self, issue):
        cache = self.cache_path(issue)
        if cache.exists():
            chapters = json.loads(cache.read_text())
            return {"status": "ready", "issue": issue, "chapters": [{k: v for k, v in c.items() if k != "text"} for c in chapters]}
        job = self.jobs.get(issue["id"], {})
        return {"status": job.get("status", "idle"), "issue": issue, "received": job.get("received", 0), "total": job.get("total", 0), "error": job.get("error", "")}

    def open(self, issue):
        status = self.status(issue)
        if status["status"] not in ("ready", "loading"):
            job = {"status": "loading", "received": 0, "total": 0}
            self.jobs[issue["id"]] = job
            job["task"] = asyncio.create_task(self.download(issue, job))
            status = self.status(issue)
        return status

    async def download(self, issue, job):
        epub = next(f for f in issue["files"] if f["format"] == "epub")
        binary = self.folder / (epub["sha"] + ".epub")
        temporary = binary.with_suffix(".part")
        try:
            async with self.limit:
                if epub["size"] > MAX_DOWNLOAD:
                    raise ValueError("文件超过 100 MB，请使用原始资源下载。")
                if not binary.exists():
                    job["total"] = epub["size"]
                    async with ClientSession(timeout=ClientTimeout(total=240, sock_read=45), trust_env=True) as client:
                        async with client.get(epub["url"], headers={"User-Agent": "TypeWords-Ebooks/1.0"}, allow_redirects=False) as response:
                            if response.status != 200:
                                raise ValueError(f"EPUB 下载失败（HTTP {response.status}）。")
                            with temporary.open("wb") as target:
                                async for chunk in response.content.iter_chunked(65536):
                                    job["received"] += len(chunk)
                                    if job["received"] > MAX_DOWNLOAD:
                                        raise ValueError("文件过大，下载已停止。")
                                    target.write(chunk)
                    if job["received"] != epub["size"]:
                        raise ValueError("文件下载不完整，请重试。")
                    temporary.replace(binary)
                raw = await asyncio.to_thread(binary.read_bytes)
                git_sha = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
                if git_sha != epub["sha"]:
                    binary.unlink(missing_ok=True)
                    raise ValueError("文件校验失败，请重试下载。")
                chapters = await asyncio.to_thread(parse_epub, raw)
                await asyncio.to_thread(self.write, self.cache_path(issue), chapters)
                job["status"] = "ready"
        except (ClientError, TimeoutError, ValueError, OSError) as error:
            temporary.unlink(missing_ok=True)
            job.update(status="error", error=str(error) if isinstance(error, ValueError) else "连接中断，已有资源缓存保留，请重试。")

    async def close(self):
        tasks = [j["task"] for j in self.jobs.values() if not j["task"].done()]
        if self.refreshing and not self.refreshing.done():
            tasks.append(self.refreshing)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def register_ebooks(app, folder):
    ebooks = Ebooks(folder)
    async def catalog(request):
        if request.method == "POST":
            await ebooks.refresh_task()
        elif (ebooks.catalog.get("nextCheckAt") or 0) <= int(time.time() * 1000) and (ebooks.catalog.get("checkedAt") or 0) < int(time.time() * 1000) - 21600000:
            ebooks.refresh_task()
        return web.json_response(ebooks.catalog, headers={"Cache-Control": "no-store"})
    async def issue(request):
        item = ebooks.issue(request.match_info["id"])
        return web.json_response(ebooks.open(item) if request.method == "POST" else ebooks.status(item), headers={"Cache-Control": "no-store"})
    async def chapter(request):
        item = ebooks.issue(request.match_info["id"])
        if not ebooks.cache_path(item).exists():
            raise web.HTTPNotFound(text="请先下载并解析这份期刊。")
        rows = await asyncio.to_thread(lambda: json.loads(ebooks.cache_path(item).read_text()))
        row = next((c for c in rows if c["id"] == request.match_info["chapter"]), None)
        if row is None:
            raise web.HTTPNotFound(text="找不到这一篇文章。")
        return web.json_response({**row, "source": item["title"], "sourceUrl": item["sourceUrl"], "sourceIssueId": item["id"]}, headers={"Cache-Control": "no-store"})
    async def cleanup(_):
        await ebooks.close()
    app.on_cleanup.append(cleanup)
    app.add_routes([web.get("/ebooks/catalog", catalog), web.post("/ebooks/catalog", catalog),
        web.get("/ebooks/issues/{id}", issue), web.post("/ebooks/issues/{id}", issue),
        web.get("/ebooks/issues/{id}/chapters/{chapter}", chapter)])
    return ebooks
