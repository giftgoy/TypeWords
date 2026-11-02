import asyncio
import logging

import edge_tts
from aiohttp import ClientError, web

VOICES = [
    {"id": "en-US-AriaNeural", "name": "Aria", "lang": "en-US", "gender": "female"},
    {"id": "en-US-GuyNeural", "name": "Guy", "lang": "en-US", "gender": "male"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia", "lang": "en-GB", "gender": "female"},
    {"id": "en-GB-RyanNeural", "name": "Ryan", "lang": "en-GB", "gender": "male"},
]


async def voices(request):
    return web.json_response(VOICES)


async def speak(request):
    text = request.query.get("text", "").strip()
    voice = request.query.get("voice", "en-US-AriaNeural")
    if not text or len(text) > 2000 or voice not in {v["id"] for v in VOICES}:
        raise web.HTTPBadRequest(text="Invalid text or voice")

    async def synthesize():
        chunks = []
        async for chunk in edge_tts.Communicate(text, voice).stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)

    try:
        audio = await asyncio.wait_for(synthesize(), timeout=20)
    except (TimeoutError, edge_tts.exceptions.EdgeTTSException, ClientError, OSError):
        logging.exception("Speech synthesis failed")
        raise web.HTTPBadGateway(text="Speech service unavailable")
    if not audio:
        raise web.HTTPBadGateway(text="No speech audio returned")
    return web.Response(
        body=audio,
        content_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


app = web.Application()
app.add_routes([web.get("/voices", voices), web.get("/speak", speak)])
if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8000, access_log=None)
