import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import onnxruntime as ort
import soundfile
from aiohttp import web
from kokoro_onnx import Kokoro

MODEL_DIR = Path(__file__).resolve().parent / "model"
ENGINE = web.AppKey("kokoro", Kokoro)
SYNTHESIS_WORKER = web.AppKey("synthesis_worker", ThreadPoolExecutor)

# Existing IDs are stored in browser settings and used in saved audio URLs.
VOICES = {
    "en-US-AriaNeural": ("af_heart", "Kokoro Heart", "en-US", "female"),
    "en-US-GuyNeural": ("am_michael", "Kokoro Michael", "en-US", "male"),
    "en-GB-SoniaNeural": ("bf_emma", "Kokoro Emma", "en-GB", "female"),
    "en-GB-RyanNeural": ("bm_george", "Kokoro George", "en-GB", "male"),
    # 中文音色:voices-v1.0.bin 自带 8 个 zh 前缀音色,与 Edge 的 zh-CN 声音一一对应。
    "zh-CN-XiaobeiNeural": ("zf_xiaobei", "Kokoro 小贝", "zh-CN", "female"),
    "zh-CN-XiaoniNeural": ("zf_xiaoni", "Kokoro 小妮", "zh-CN", "female"),
    "zh-CN-XiaoxiaoNeural": ("zf_xiaoxiao", "Kokoro 晓晓", "zh-CN", "female"),
    "zh-CN-XiaoyiNeural": ("zf_xiaoyi", "Kokoro 晓伊", "zh-CN", "female"),
    "zh-CN-YunjianNeural": ("zm_yunjian", "Kokoro 云健", "zh-CN", "male"),
    "zh-CN-YunxiNeural": ("zm_yunxi", "Kokoro 云希", "zh-CN", "male"),
    "zh-CN-YunxiaNeural": ("zm_yunxia", "Kokoro 云夏", "zh-CN", "male"),
    "zh-CN-YunyangNeural": ("zm_yunyang", "Kokoro 云扬", "zh-CN", "male"),
}


def load_engine():
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(MODEL_DIR / "kokoro-v1.0.onnx"),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    return Kokoro.from_session(session, str(MODEL_DIR / "voices-v1.0.bin"))


async def engine_context(app):
    worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="kokoro")
    try:
        app[SYNTHESIS_WORKER] = worker
        app[ENGINE] = await asyncio.get_running_loop().run_in_executor(worker, load_engine)
        yield
    finally:
        await asyncio.to_thread(worker.shutdown, cancel_futures=True)


# espeak-ng 的语言代码与 BCP-47 locale 不同:普通话是 cmn 而非 zh-cn。
LANG_ALIASES = {"zh-cn": "cmn"}


def synthesize(engine, text, voice, locale):
    lang = LANG_ALIASES.get(locale.lower(), locale.lower())
    samples, sample_rate = engine.create(text, voice=voice, lang=lang)
    if samples.size == 0:
        return b""

    audio = BytesIO()
    soundfile.write(audio, samples, sample_rate, format="MP3")
    return audio.getvalue()


async def voices(request):
    return web.json_response([
        {"id": voice_id, "name": name, "lang": locale, "gender": gender}
        for voice_id, (_, name, locale, gender) in VOICES.items()
    ])


async def speak(request):
    text = request.query.get("text", "").strip()
    voice_id = request.query.get("voice", "en-US-AriaNeural")
    if not text or len(text) > 2000 or voice_id not in VOICES:
        raise web.HTTPBadRequest(text="Invalid text or voice")

    voice, _, locale, _ = VOICES[voice_id]
    try:
        job = asyncio.get_running_loop().run_in_executor(
            request.app[SYNTHESIS_WORKER], synthesize, request.app[ENGINE], text, voice, locale
        )
        audio = await asyncio.wait_for(job, timeout=20)
    except Exception as error:
        logging.error("Kokoro speech synthesis failed (%s)", type(error).__name__)
        raise web.HTTPBadGateway(text="Speech service unavailable") from error
    if not audio:
        raise web.HTTPBadGateway(text="No speech audio returned")
    return web.Response(
        body=audio,
        content_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


async def health(request):
    return web.json_response({"status": "ok"})


def create_app():
    app = web.Application()
    app.cleanup_ctx.append(engine_context)
    app.add_routes([web.get("/health", health), web.get("/voices", voices), web.get("/speak", speak)])
    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=8000, access_log=None)
