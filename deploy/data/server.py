import asyncio
import os

from aiohttp import web
from github_sync import GithubSync
from storage import Conflict, Storage


@web.middleware
async def origin_check(request, handler):
    origin = request.headers.get("Origin")
    if request.method != "GET" and origin and origin != f"{request.scheme}://{request.host}":
        raise web.HTTPForbidden(text="Cross-origin writes are not permitted")
    try:
        return await handler(request)
    except Conflict as error:
        return web.json_response({"error": str(error)}, status=409)


async def payload(request):
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text="Invalid JSON")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="Expected an object")
    items = body.get("items", {})
    if not isinstance(items, dict) or len(items) > 1000 or any(not isinstance(k, str) or len(k) > 200 for k in items):
        raise web.HTTPBadRequest(text="Invalid storage keys")
    return body


async def state(request):
    return web.json_response(await asyncio.to_thread(request.app["storage"].snapshot), headers={"Cache-Control": "no-store"})


async def initialize(request):
    body = await payload(request)
    result = await asyncio.to_thread(request.app["storage"].initialize, body.get("items", {}))
    request.app["github"].schedule()
    return web.json_response(result)


async def update(request):
    body = await payload(request)
    revisions = body.get("revisions")
    if not isinstance(revisions, dict) or any(type(v) is not int or v < 0 for v in revisions.values()):
        raise web.HTTPBadRequest(text="Invalid revisions")
    result = await asyncio.to_thread(request.app["storage"].update, body.get("items", {}), revisions, body.get("id"))
    request.app["github"].schedule()
    return web.json_response({"revisions": result})


async def archives(request):
    if request.method == "GET":
        return web.json_response(await asyncio.to_thread(request.app["storage"].list_archives))
    body = await payload(request)
    result = await asyncio.to_thread(request.app["storage"].archive, body.get("items", {}), "迁移或重新载入前的浏览器副本")
    return web.json_response({"id": result})


async def archive(request):
    result = await asyncio.to_thread(request.app["storage"].get_archive, request.match_info["id"])
    if result is None:
        raise web.HTTPNotFound()
    return web.json_response({"format": "typewords-server-storage-v1", "items": result})


async def restore(request):
    body = await payload(request)
    if type(body.get("revision")) is not int or "items" not in body:
        raise web.HTTPBadRequest(text="Expected a snapshot and server revision")
    return web.json_response(await asyncio.to_thread(request.app["storage"].restore, body["items"], body["revision"]))


def create_app(path):
    app = web.Application(middlewares=[origin_check], client_max_size=128 * 1024 * 1024)
    app["storage"] = Storage(path)
    app["github"] = GithubSync(app["storage"])

    async def github_status(request):
        return web.json_response(request.app["github"].status())

    async def github_config(request):
        if request.method == "DELETE":
            return web.json_response(request.app["github"].clear_config())
        body = await payload(request)
        return web.json_response(request.app["github"].save_config(body))

    async def github_backup(request):
        try:
            return web.json_response(await asyncio.to_thread(request.app["github"].push))
        except Exception as error:
            return web.json_response({"error": f"{type(error).__name__}: {error}"}, status=502)

    async def github_restore(request):
        try:
            return web.json_response(await asyncio.to_thread(request.app["github"].pull))
        except Exception as error:
            return web.json_response({"error": f"{type(error).__name__}: {error}"}, status=502)

    app.add_routes([web.get("/state", state), web.post("/initialize", initialize), web.put("/state", update),
                    web.get("/archives", archives), web.post("/archives", archives), web.get("/archives/{id:\\d+}", archive),
                    web.post("/restore", restore),
                    web.get("/github/status", github_status), web.post("/github/backup", github_backup),
                    web.post("/github/restore", github_restore),
                    web.post("/github/config", github_config), web.delete("/github/config", github_config)])
    return app


if __name__ == "__main__":
    web.run_app(create_app(os.environ.get("DATA_FILE", "/data/learning.sqlite3")), host="0.0.0.0", port=8000, access_log=None)
